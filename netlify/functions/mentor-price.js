// Public: returns the current MOT price from Mentor (offer price and normal price).
const { isConfigured, getMotPrice } = require('./lib/mentor');

exports.handler = async () => {
  if (!isConfigured()) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Booking system not set up' }) };
  }
  try {
    const p = await getMotPrice();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ price: p.price, rrp: p.rrp }),
    };
  } catch (e) {
    console.error('mentor-price:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Price unavailable' }) };
  }
};
