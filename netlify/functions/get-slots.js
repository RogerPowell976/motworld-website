const { getStore } = require('@netlify/blobs');

function bookingsStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'bookings', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('bookings');
}

const WORK_START_MIN = 8 * 60;
const WORK_END_MIN = 17 * 60;
const SLOT_MINUTES = 45;

function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function isValidSlotTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  const mins = h * 60 + m;
  if (mins < WORK_START_MIN || mins + SLOT_MINUTES > WORK_END_MIN) return false;
  return (mins - WORK_START_MIN) % SLOT_MINUTES === 0;
}

// Sends the customer a confirmation email via Resend. Fails silently (logs
// only) if RESEND_API_KEY isn't set yet, or if Resend rejects the send --
// a booking should still succeed even if the email couldn't go out.
async function sendConfirmationEmail(booking) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'MOT World <bookings@motworld.co.uk>';
  if (!apiKey || !booking.email) return;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: booking.email,
        subject: 'Your MOT booking request — MOT World',
        html: `
          <p>Hi ${booking.name || 'there'},</p>
          <p>Thanks for your booking request with MOT World. Here's what you sent us:</p>
          <ul>
            <li><strong>Date:</strong> ${booking.date}</li>
            <li><strong>Time:</strong> ${booking.time}</li>
            <li><strong>Vehicle:</strong> ${booking.reg}${booking.makeModel ? ' — ' + booking.makeModel : ''}</li>
          </ul>
          <p>We'll be in touch shortly to confirm. If anything's wrong, just reply to this email or give us a call.</p>
          <p>MOT World</p>
        `,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('book-slot: Resend send failed:', res.status, text);
    }
  } catch (e) {
    console.error('book-slot: Resend send threw:', e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { date, time, name, phone, reg, makeModel, email, notes } = data;

  if (!date || !time || !name || !phone || !reg) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isWeekday(date)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or non-working date' }) };
  }
  if (!isValidSlotTime(time)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid time slot' }) };
  }

  let store, booked;
  try {
    store = bookingsStore();
    booked = (await store.get(date, { type: 'json' })) || {};
  } catch (e) {
    console.error('book-slot: Blobs read failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Storage unavailable', detail: e.message }) };
  }

  if (booked[time]) {
    return {
      statusCode: 409,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'That slot has just been booked by someone else. Please choose another.' }),
    };
  }

  const bookingRecord = {
    name: String(name).slice(0, 100),
    phone: String(phone).slice(0, 30),
    email: email ? String(email).slice(0, 100) : '',
    reg: String(reg).toUpperCase().slice(0, 12),
    makeModel: makeModel ? String(makeModel).slice(0, 100) : '',
    notes: notes ? String(notes).slice(0, 500) : '',
    bookedAt: new Date().toISOString(),
  };
  booked[time] = bookingRecord;

  try {
    await store.setJSON(date, booked);
  } catch (e) {
    console.error('book-slot: Blobs write failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save booking', detail: e.message }) };
  }

  await sendConfirmationEmail({ ...bookingRecord, date, time });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};

const { getStore } = require('@netlify/blobs');

function bookingsStore() {
  // Falls back to explicit credentials if Netlify's automatic context isn't
  // available in this environment (a known quirk with some deploy setups).
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'bookings', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('bookings');
}

const WORK_START_MIN = 8 * 60;
const WORK_END_MIN = 17 * 60;
const SLOT_MINUTES = 45;

function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function generateSlotTimes() {
  const slots = [];
  for (let mins = WORK_START_MIN; mins + SLOT_MINUTES <= WORK_END_MIN; mins += SLOT_MINUTES) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}

exports.handler = async (event) => {
  const date = event.queryStringParameters && event.queryStringParameters.date;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a date as ?date=YYYY-MM-DD' }) };
  }
  if (!isWeekday(date)) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: [], closed: true }) };
  }

  let booked = {};
  try {
    const store = bookingsStore();
    const raw = await store.get(date, { type: 'json' });
    if (raw) booked = raw;
  } catch (e) {
    // Log so it shows up under this function's logs in the Netlify dashboard
    // -- if slots never load, check here first.
    console.error('get-slots: Blobs read failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Storage unavailable', detail: e.message }) };
  }

  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = generateSlotTimes().map((time) => {
    const [h, m] = time.split(':').map(Number);
    const mins = h * 60 + m;
    const isPast = isToday && mins <= nowMinutes;
    return { time, available: !booked[time] && !isPast };
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots, closed: false }),
  };
};

const { getStore } = require('@netlify/blobs');

function bookingsStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'bookings', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('bookings');
}

const ADMIN_PIN = '1996';

exports.handler = async (event) => {
  const pin = event.queryStringParameters && event.queryStringParameters.pin;
  if (pin !== ADMIN_PIN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = bookingsStore();
    const { blobs } = await store.list();
    const todayStr = new Date().toISOString().split('T')[0];

    const results = [];
    for (const b of blobs) {
      if (b.key < todayStr) continue;
      const dayData = await store.get(b.key, { type: 'json' });
      if (!dayData) continue;
      for (const [time, booking] of Object.entries(dayData)) {
        results.push({ date: b.key, time, ...booking });
      }
    }
    results.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookings: results }),
    };
  } catch (e) {
    console.error('list-bookings: Blobs failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Storage unavailable', detail: e.message }) };
  }
};
