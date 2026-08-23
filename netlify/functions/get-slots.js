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
