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
