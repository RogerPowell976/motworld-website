// Public: returns the days and times Mentor says are free for an MOT.
const { isConfigured, getMotPrice, getDays } = require('./lib/mentor');

exports.handler = async () => {
  if (!isConfigured()) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Booking system not set up' }) };
  }
  try {
    const p = await getMotPrice();
    const d = await getDays(p.location, p.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ slots: d.slots, days: d.days, price: p.price, rrp: p.rrp }),
    };
  } catch (e) {
    console.error('mentor-days:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Availability unavailable' }) };
  }
};
