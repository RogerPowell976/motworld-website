// Shared helpers for paid online MOT bookings (used by pay-start.js and pay-confirm.js).
//
// Settings (Netlify > Environment variables):
//   STRIPE_SECRET_KEY   sk_test_... while testing, sk_live_... when live
//   plus the Mentor and DVSA settings already used by mentor-book.js
const { getStore } = require('@netlify/blobs');
const { mentor, getMotPrice, getDays } = require('./mentor');

const UNKNOWN = 'Unknown';
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
const clean = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function store(name) {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore(name);
}

// "Today's MOT price" exactly as set on the admin page (primaryOfferPrice, e.g. "£39.95").
async function todaysMotPrice() {
  const content = await store('site-content').get('content', { type: 'json' });
  const m = String((content && content.primaryOfferPrice) || '').match(/(\d+(?:\.\d{1,2})?)/);
  const price = m ? parseFloat(m[1]) : NaN;
  if (!(price > 0 && price < 1000)) throw new Error("Today's MOT price is not set on the admin page");
  return price;
}

// Checks and tidies what the customer typed. Returns { error } or { details }.
function readDetails(b) {
  const email = clean(b.email, 120);
  let phone = clean(b.phone, 25).replace(/[^0-9]/g, '');
  if (/^447\d{9}$/.test(phone)) phone = '0' + phone.slice(2);
  const reg = clean(b.reg, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please enter a valid email address.' };
  if (!/^[A-Z0-9]{2,8}$/.test(reg)) return { error: 'Please enter the vehicle registration.' };
  if (!/^07\d{9}$/.test(phone)) return { error: 'Please enter a UK mobile number, e.g. 07700 900123.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(\d{2}:\d{2})?$/.test(time)) return { error: 'Please choose a date and time.' };
  return { details: { email, phone, reg, date, time } };
}

// Is the chosen slot still free in Mentor? Returns { ok, p, d }.
async function slotIsFree(date, time) {
  const p = await getMotPrice();
  const d = await getDays(p.location, p.id);
  const times = d.days[date];
  const ok = !!times && (!d.slots || times.includes(time));
  return { ok, p, d };
}

// ---- Vehicle lookup (same as mentor-book.js): DVSA first, then DVLA ----
function mapFuel(f) {
  const s = String(f || '').toLowerCase();
  if (!s) return UNKNOWN;
  if (s.includes('hybrid')) return 'Hybrid';
  if (s.includes('electric')) return 'Electric';
  if (s.includes('diesel')) return 'Diesel';
  if (s.includes('petrol')) return 'Petrol';
  return 'Other';
}

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
      console.error('booking: vehicle lookup:', e.message);
    }
  }
  return { make: UNKNOWN, model: UNKNOWN, fuel: UNKNOWN, regDate: null, mileage: null, source: 'none' };
}

// Creates the Mentor booking for a PAID online MOT. Returns { ok, jobNumber, vehicle } or { ok:false, error }.
async function createPaidBooking(details, { price, paymentRef }) {
  const { date, time, reg, phone, email } = details;
  const { ok, p, d } = await slotIsFree(date, time);
  if (!ok) return { ok: false, error: 'slot_taken' };

  const v = await lookupVehicle(reg);
  const notes = [
    'PAID ONLINE £' + price.toFixed(2) + ' by card (Stripe ' + paymentRef + ')',
    'Booked online at motworld.co.uk with registration, mobile and email only',
    'Vehicle details from ' + (v.source === 'none' ? 'nowhere (no lookup available)' : v.source),
    'Customer name not asked for',
  ];
  if (!v.regDate) notes.push('Registration date unknown');
  if (v.mileage === null) notes.push('Mileage unknown');
  notes.push('Gearbox unknown');

  const payload = {
    location: p.location,
    loanCarRequired: false,
    deliveryRequired: false,
    hasServicePlan: false,
    isMotability: false,
    booking_date: d.slots ? date + ' ' + time : date,
    totalQuotedPrice: price.toFixed(2),
    Notes: notes.join('. ') + '.',
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
    return { ok: true, jobNumber: r.data.jobNumber, vehicle: { make: v.make, model: v.model } };
  }
  const err = String((r.data && r.data.error) || JSON.stringify(r.data) || '');
  console.error('booking: Mentor refused (' + r.status + '):', err);
  return { ok: false, error: /not available/i.test(err) ? 'slot_taken' : 'mentor_refused', detail: err.slice(0, 300) };
}

// ---- Stripe (plain HTTPS calls; no extra package needed) ----
function stripeKey() { return (process.env.STRIPE_SECRET_KEY || '').trim(); }

function toForm(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const [k, val] of Object.entries(obj)) {
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (val === undefined || val === null) continue;
    if (typeof val === 'object') toForm(val, key, out);
    else out.append(key, String(val));
  }
  return out;
}

async function stripe(path, { method = 'GET', form } = {}) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + stripeKey(),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? toForm(form).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Stripe ' + path + ' failed (' + res.status + '): ' + ((data.error && data.error.message) || ''));
  return data;
}

module.exports = { store, todaysMotPrice, readDetails, slotIsFree, createPaidBooking, stripe, stripeKey };
