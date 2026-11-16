// Public: creates an MOT booking in Mentor's service diary.
// The price and location are always looked up on the server from Mentor,
// never taken from the customer's browser.
const { mentor, isConfigured, getMotPrice, getDays } = require('./lib/mentor');

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (statusCode, obj) => ({ statusCode, headers: JSON_H, body: JSON.stringify(obj) });
const clean = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!isConfigured()) return reply(503, { error: 'Online booking is not available right now. Please call us.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Invalid request' }); }

  // Honeypot: real customers never fill this in.
  if (b.website) return reply(200, { ok: true });

  const firstName = clean(b.firstName, 60);
  const lastName = clean(b.lastName, 60);
  const phone = clean(b.phone, 25);
  const email = clean(b.email, 120);
  const reg = clean(b.reg, 12).toUpperCase();
  const make = clean(b.make, 40);
  const model = clean(b.model, 60);
  const fuel = clean(b.fuel, 20);
  const transmission = clean(b.transmission, 20);
  const regYear = parseInt(b.regYear, 10);
  const mileage = parseInt(b.mileage, 10);
  const notes = clean(b.notes, 500);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const c = b.contact || {};

  if (!firstName || !lastName) return reply(400, { error: 'Please enter your first and last name.' });
  if (!/^[0-9 +()-]{7,25}$/.test(phone)) return reply(400, { error: 'Please enter a valid phone number.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Please enter a valid email address.' });
  if (!/^[A-Z0-9 ]{2,10}$/.test(reg)) return reply(400, { error: 'Please enter the vehicle registration.' });
  if (!make || !model) return reply(400, { error: 'Please enter the make and model.' });
  if (!fuel || !transmission) return reply(400, { error: 'Please choose the fuel and transmission.' });
  const thisYear = new Date().getFullYear();
  if (!(regYear >= 1950 && regYear <= thisYear + 1)) return reply(400, { error: 'Please enter the year the car was first registered.' });
  if (!(mileage >= 0 && mileage <= 999999)) return reply(400, { error: 'Please enter the approximate mileage.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return reply(400, { error: 'Please choose a date and time.' });

  try {
    const p = await getMotPrice();

    // Check the slot is still free before booking (Mentor checks again on creation).
    const d = await getDays(p.location, p.id);
    const times = d.days[date];
    if (!times || (d.slots && !times.includes(time))) {
      return reply(409, { error: 'Sorry, that time has just been taken. Please choose another.' });
    }

    const noteParts = ['Booked online at motworld.co.uk'];
    noteParts.push('Registration year given by customer: ' + regYear);
    if (notes) noteParts.push('Customer notes: ' + notes);

    const payload = {
      location: p.location,
      loanCarRequired: false,
      deliveryRequired: false,
      hasServicePlan: false,
      isMotability: false,
      booking_date: d.slots ? date + ' ' + time : date,
      totalQuotedPrice: p.price.toFixed(2),
      Notes: noteParts.join('. '),
      customer: {
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
        contact_preferences: { email: !!c.email, sms: !!c.sms, phone: !!c.phone, letter: !!c.letter },
      },
      vehicle: {
        make, model, reg,
        reg_date: regYear + '-01-01',
        current_mileage: mileage,
        fuel, transmission,
      },
      items: [{ service_price_id: p.id }],
    };

    const r = await mentor('/service/create-booking', { method: 'POST', body: payload });
    if (r.status === 200 && r.data && r.data.result) {
      return reply(200, { ok: true, jobNumber: r.data.jobNumber, price: p.price });
    }

    const err = String((r.data && r.data.error) || '');
    console.error('mentor-book: Mentor refused (' + r.status + '):', err);
    if (/not available/i.test(err)) return reply(409, { error: 'Sorry, that time is no longer available. Please choose another.' });
    if (/disabled/i.test(err)) return reply(503, { error: 'Online booking is temporarily unavailable. Please call us on 01420 384293.' });
    return reply(502, { error: 'We could not complete your booking online. Please call us on 01420 384293.' });
  } catch (e) {
    console.error('mentor-book:', e.message);
    return reply(502, { error: 'We could not reach the booking system. Please call us on 01420 384293.' });
  }
};
