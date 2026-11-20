// Public: step 1 of a paid online MOT booking.
// Checks the details and that the slot is still free, then starts a Stripe Checkout
// payment for Today's MOT price (from the admin page). NOTHING is booked in Mentor yet;
// that only happens in pay-confirm.js once Stripe says the payment succeeded.
const { isConfigured } = require('./lib/mentor');
const { todaysMotPrice, readDetails, slotIsFree, stripe, stripeKey } = require('./lib/booking');

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (statusCode, obj) => ({ statusCode, headers: JSON_H, body: JSON.stringify(obj) });

function niceDate(date, time) {
  const d = new Date(date + 'T12:00:00Z');
  const s = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return time ? s + ' at ' + time : s;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!isConfigured() || !stripeKey()) return reply(503, { error: 'Online booking is not available right now. Please call us on 01420 384293.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Invalid request' }); }
  if (b.website) return reply(400, { error: 'Invalid request' }); // honeypot

  const { error, details } = readDetails(b);
  if (error) return reply(400, { error });

  try {
    const price = await todaysMotPrice();
    const { ok } = await slotIsFree(details.date, details.time);
    if (!ok) return reply(409, { error: 'Sorry, that time has just been taken. Please choose another.' });

    const site = (process.env.URL || 'https://motworld.co.uk').replace(/\/+$/, '');
    const when = niceDate(details.date, details.time);
    const session = await stripe('/checkout/sessions', {
      method: 'POST',
      form: {
        mode: 'payment',
        customer_email: details.email,
        success_url: site + '/booking-mentor.html?paid={CHECKOUT_SESSION_ID}',
        cancel_url: site + '/booking-mentor.html?cancelled=1',
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe's minimum: 30 minutes
        line_items: {
          0: {
            quantity: 1,
            price_data: {
              currency: 'gbp',
              unit_amount: Math.round(price * 100),
              product_data: { name: 'MOT test – ' + details.reg + ' – ' + when, description: 'MOT World, Bordon (LMC of Farnham Ltd)' },
            },
          },
        },
        metadata: { ...details, price: price.toFixed(2) },
        payment_intent_data: {
          description: 'MOT ' + details.reg + ' ' + when,
          metadata: { ...details, price: price.toFixed(2) },
        },
      },
    });
    return reply(200, { url: session.url, price });
  } catch (e) {
    console.error('pay-start:', e.message);
    return reply(502, { error: 'We could not start the payment. Please try again or call us on 01420 384293.' });
  }
};
