// Public: step 2 of a paid online MOT booking.
// The booking page calls this when Stripe sends the customer back with ?paid=<session id>.
// It asks Stripe directly whether that payment really succeeded and, only if it did,
// creates the booking in Mentor. If the slot was taken meanwhile, the payment is refunded.
// Each payment is only ever booked once (results are remembered in the "paid-bookings" store).
const { isConfigured } = require('./lib/mentor');
const { store, createPaidBooking, stripe, stripeKey } = require('./lib/booking');

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (statusCode, obj) => ({ statusCode, headers: JSON_H, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!isConfigured() || !stripeKey()) return reply(503, { error: 'Online booking is not available right now. Please call us on 01420 384293.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Invalid request' }); }
  const sessionId = String(b.sessionId || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return reply(400, { error: 'Invalid payment reference' });

  const paid = store('paid-bookings');
  try {
    // Already handled (e.g. the customer refreshed the page)? Show the same result again.
    const done = await paid.get(sessionId, { type: 'json' });
    if (done && done.pending) return reply(202, { pending: true, error: 'We are still confirming your booking. Please wait a moment, then refresh this page.' });
    if (done) return reply(done.ok ? 200 : 409, done);

    const s = await stripe('/checkout/sessions/' + encodeURIComponent(sessionId));
    if (s.payment_status !== 'paid') {
      return reply(402, { error: 'Your payment has not gone through, so nothing has been booked. Please try again.' });
    }

    const m = s.metadata || {};
    const details = { date: m.date, time: m.time, reg: m.reg, phone: m.phone, email: m.email };
    const price = parseFloat(m.price);
    const paymentRef = String(s.payment_intent || sessionId);

    // Mark as in progress first, so a second click can't book twice.
    await paid.setJSON(sessionId, { ok: false, pending: true, at: new Date().toISOString() });

    const r = await createPaidBooking(details, { price, paymentRef });
    let result;
    if (r.ok) {
      result = { ok: true, jobNumber: r.jobNumber, vehicle: r.vehicle, price, ...details, paymentRef };
    } else {
      // Couldn't book: give the money back straight away.
      let refunded = false;
      try {
        await stripe('/refunds', { method: 'POST', form: { payment_intent: paymentRef, reason: 'requested_by_customer', metadata: { why: r.error } } });
        refunded = true;
      } catch (e) {
        console.error('pay-confirm: REFUND FAILED for', paymentRef, e.message);
      }
      result = {
        ok: false,
        refunded,
        error: r.error === 'slot_taken'
          ? 'Sorry, that time was taken while you were paying. ' + (refunded ? 'Your payment has been refunded in full.' : 'We will refund you; please call us on 01420 384293.') + ' Please choose another time.'
          : 'We took your payment but could not complete the booking. ' + (refunded ? 'Your payment has been refunded in full.' : 'We will refund you.') + ' Please call us on 01420 384293.',
      };
    }
    await paid.setJSON(sessionId, { ...result, at: new Date().toISOString() });
    return reply(result.ok ? 200 : 409, result);
  } catch (e) {
    console.error('pay-confirm:', e.message);
    return reply(502, { error: 'Your payment went through but we could not confirm the booking automatically. Please call us on 01420 384293 and we will sort it out.' });
  }
};
