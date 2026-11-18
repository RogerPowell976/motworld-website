// Public: creates an MOT booking in Mentor's service diary.
// The customer gives only the date and time, registration, mobile and email.
// Make, model, fuel, first registration date and last MOT mileage are looked
// up from the registration on the server; anything not found is sent as "Unknown".
//
// Vehicle lookup settings (Netlify > Environment variables), all optional:
//   DVSA MOT history (best: gives make AND model):
//     DVSA_CLIENT_ID, DVSA_CLIENT_SECRET, DVSA_API_KEY, DVSA_TOKEN_URL
//   DVLA vehicle enquiry (fallback: make, fuel and year, no model):
//     DVLA_API_KEY
const { mentor, isConfigured, getMotPrice, getDays } = require('./lib/mentor');

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (statusCode, obj) => ({ statusCode, headers: JSON_H, body: JSON.stringify(obj) });
const clean = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const isTestSystem = () => /qa|demo|test/i.test(process.env.MENTOR_BASE_URL || '');

const UNKNOWN = 'Unknown';
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();

function mapFuel(f) {
  const s = String(f || '').toLowerCase();
  if (!s) return UNKNOWN;
  if (s.includes('hybrid')) return 'Hybrid';
  if (s.includes('electric')) return 'Electric';
  if (s.includes('diesel')) return 'Diesel';
  if (s.includes('petrol')) return 'Petrol';
  return 'Other';
}

// DVSA MOT history API: make, model, fuel, first used date, last MOT mileage.
async function lookupDvsa(reg) {
  const { DVSA_CLIENT_ID, DVSA_CLIENT_SECRET, DVSA_API_KEY, DVSA_TOKEN_URL } = process.env;
  if (!DVSA_CLIENT_ID || !DVSA_CLIENT_SECRET || !DVSA_API_KEY || !DVSA_TOKEN_URL) return null;
  const tok = await fetch(DVSA_TOKEN_URL.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DVSA_CLIENT_ID.trim(),
      client_secret: DVSA_CLIENT_SECRET.trim(),
      scope: 'https://tapi.dvsa.gov.uk/.default',
    }).toString(),
  });
  if (!tok.ok) throw new Error('DVSA sign-in failed (' + tok.status + ')');
  const { access_token } = await tok.json();
  const res = await fetch('https://history.mot.api.gov.uk/v1/trade/vehicles/registration/' + encodeURIComponent(reg), {
    headers: { Authorization: 'Bearer ' + access_token, 'X-API-Key': DVSA_API_KEY.trim(), Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const v = await res.json();
  const tests = Array.isArray(v.motTests) ? v.motTests : [];
  const withMiles = tests.find((t) => t.odometerValue && String(t.odometerResultType || 'READ').toUpperCase() === 'READ');
  let mileage = null;
  if (withMiles) {
    mileage = parseInt(withMiles.odometerValue, 10);
    if (String(withMiles.odometerUnit || '').toUpperCase() === 'KM') mileage = Math.round(mileage * 0.621371);
  }
  return {
    make: titleCase(v.make) || UNKNOWN,
    model: titleCase(v.model) || UNKNOWN,
    fuel: mapFuel(v.fuelType),
    regDate: v.firstUsedDate || v.registrationDate || null,
    mileage,
    source: 'DVSA',
  };
}

// DVLA vehicle enquiry: make, fuel and year only (no model).
async function lookupDvla(reg) {
  const key = process.env.DVLA_API_KEY;
  if (!key) return null;
  const res = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key.trim() },
    body: JSON.stringify({ registrationNumber: reg }),
  });
  if (!res.ok) return null;
  const v = await res.json();
  return {
    make: titleCase(v.make) || UNKNOWN,
    model: UNKNOWN,
    fuel: mapFuel(v.fuelType),
    regDate: v.monthOfFirstRegistration ? v.monthOfFirstRegistration + '-01'
      : (v.yearOfManufacture ? v.yearOfManufacture + '-01-01' : null),
    mileage: null,
    source: 'DVLA',
  };
}

async function lookupVehicle(reg) {
  for (const fn of [lookupDvsa, lookupDvla]) {
    try {
      const v = await fn(reg);
      if (v) return v;
    } catch (e) {
      console.error('mentor-book: vehicle lookup:', e.message);
    }
  }
  return { make: UNKNOWN, model: UNKNOWN, fuel: UNKNOWN, regDate: null, mileage: null, source: 'none' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!isConfigured()) return reply(503, { error: 'Online booking is not available right now. Please call us.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Invalid request' }); }

  // Honeypot: real customers never fill this in.
  if (b.website) return reply(200, { ok: true });

  const email = clean(b.email, 120);
  let phone = clean(b.phone, 25).replace(/[^0-9]/g, '');
  if (/^447\d{9}$/.test(phone)) phone = '0' + phone.slice(2);
  const regTyped = clean(b.reg, 12).toUpperCase();
  const reg = regTyped.replace(/[^A-Z0-9]/g, '');
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Please enter a valid email address.' });
  if (!/^[A-Z0-9]{2,8}$/.test(reg)) return reply(400, { error: 'Please enter the vehicle registration.' });
  if (!/^07\d{9}$/.test(phone)) return reply(400, { error: 'Please enter a UK mobile number, e.g. 07700 900123.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(\d{2}:\d{2})?$/.test(time)) return reply(400, { error: 'Please choose a date and time.' });

  try {
    const p = await getMotPrice();

    // Check the slot is still free before booking (Mentor checks again on creation).
    const d = await getDays(p.location, p.id);
    const times = d.days[date];
    if (!times || (d.slots && !times.includes(time))) {
      return reply(409, { error: 'Sorry, that time has just been taken. Please choose another.' });
    }

    const v = await lookupVehicle(reg);

    const noteParts = ['Booked online at motworld.co.uk with registration, mobile and email only'];
    noteParts.push('Vehicle details from ' + (v.source === 'none' ? 'nowhere (no lookup available)' : v.source));
    noteParts.push('Customer name not asked for');
    if (!v.regDate) noteParts.push('Registration date unknown');
    if (v.mileage === null) noteParts.push('Mileage unknown');
    noteParts.push('Gearbox unknown');

    const payload = {
      location: p.location,
      loanCarRequired: false,
      deliveryRequired: false,
      hasServicePlan: false,
      isMotability: false,
      booking_date: d.slots ? date + ' ' + time : date,
      totalQuotedPrice: p.price.toFixed(2),
      Notes: noteParts.join('. ') + '.',
      customer: {
        first_name: 'Online',
        last_name: 'Customer',
        phone,
        email,
        contact_preferences: { email: false, sms: false, phone: false, letter: false },
      },
      vehicle: {
        make: v.make,
        model: v.model,
        reg,
        reg_date: v.regDate || '2000-01-01',
        // Mentor refuses 0 as "No mileage specified", so 1 stands in for unknown (see the note).
        current_mileage: v.mileage ? v.mileage : 1,
        fuel: v.fuel,
        transmission: UNKNOWN,
      },
      items: [{ service_price_id: p.id }],
    };

    const r = await mentor('/service/create-booking', { method: 'POST', body: payload });
    if (r.status === 200 && r.data && r.data.result) {
      return reply(200, { ok: true, jobNumber: r.data.jobNumber, price: p.price, vehicle: { make: v.make, model: v.model } });
    }

    const err = String((r.data && r.data.error) || '');
    console.error('mentor-book: Mentor refused (' + r.status + '):', err);
    // On Mentor's test system, pass Mentor's own message back so it shows on the page.
    const detail = isTestSystem() ? (err || JSON.stringify(r.data)).slice(0, 300) : undefined;
    if (/not available/i.test(err)) return reply(409, { error: 'Sorry, that time is no longer available. Please choose another.', detail });
    if (/disabled/i.test(err)) return reply(503, { error: 'Online booking is temporarily unavailable. Please call us on 01420 384293.', detail });
    return reply(502, { error: 'We could not complete your booking online. Please call us on 01420 384293.', detail });
  } catch (e) {
    console.error('mentor-book:', e.message);
    return reply(502, { error: 'We could not reach the booking system. Please call us on 01420 384293.', detail: isTestSystem() ? e.message : undefined });
  }
};
