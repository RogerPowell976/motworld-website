// Read-only test of the Mentor API connection. It creates nothing in Mentor.
// Visit: https://motworld.co.uk/.netlify/functions/mentor-check
// It reports what Mentor returns for the MOT price, the workshop location
// name and the available booking days. Passwords are never shown.
// This is a temporary helper: it is deleted once the booking link is built.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Uses the newer MENTOR_API_* settings first, then falls back to the older names.
function mentorUsername() { return (process.env.MENTOR_API_USERNAME || process.env.MENTOR_USERNAME || '').trim(); }
function mentorPassword() { return (process.env.MENTOR_API_PASSWORD || process.env.MENTOR_PASSWORD || '').trim(); }

async function callMentor(path, params) {
  const base = (process.env.MENTOR_BASE_URL || '').trim().replace(/\/+$/, '');
  const url = base + path + (params ? '?' + new URLSearchParams(params).toString() : '');
  const res = await fetch(url, {
    headers: {
      username: mentorUsername(),
      password: mentorPassword(),
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = { notJson: text.slice(0, 300) }; }
  return { status: res.status, body };
}

exports.handler = async (event) => {
  const missing = [];
  if (!process.env.MENTOR_BASE_URL) missing.push('MENTOR_BASE_URL');
  if (!mentorUsername()) missing.push('MENTOR_API_USERNAME');
  if (!mentorPassword()) missing.push('MENTOR_API_PASSWORD');
  if (missing.length) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, problem: 'These settings are missing in Netlify (or the site has not been redeployed since they were added)', missing }, null, 2),
    };
  }

  const out = { ok: true, baseUrl: process.env.MENTOR_BASE_URL, usingNewSettings: !!(process.env.MENTOR_API_USERNAME && process.env.MENTOR_API_PASSWORD) };

  try {
    // Sample vehicle, only used to ask Mentor for prices. Nothing is booked.
    const prices = await callMentor('/service/service-prices', {
      make: 'Ford', model: 'Fiesta', fuel: 'Petrol', transmission: 'Manual',
      regDate: '2018-03-01', mileage: '45000',
    });
    out.pricesStatus = prices.status;

    if (prices.status === 403) {
      out.ok = false;
      out.problem = 'Mentor refused the username/password (403). Check MENTOR_API_USERNAME and MENTOR_API_PASSWORD.';
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(out, null, 2) };
    }
    if (!Array.isArray(prices.body)) {
      out.ok = false;
      out.problem = 'Unexpected reply from the price step';
      out.reply = prices.body;
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(out, null, 2) };
    }

    out.items = prices.body.map((p) => ({
      id: p.service_price_id,
      type: p.type,
      locations: p.locations,
      notesRequired: p.notesRequired,
      options: (p.options || []).map((o) => ({
        matched: o.matched, rrp: o.rrp, dealer_price: o.dealer_price,
        service_number: o.service_number,
      })),
    }));

    const mot = prices.body.find((p) => String(p.type).toUpperCase() === 'MOT');
    if (!mot) {
      out.ok = false;
      out.problem = 'No MOT item came back. Check the MOT web price exists in Mentor and is set for this vehicle.';
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(out, null, 2) };
    }

    const location = (event.queryStringParameters && event.queryStringParameters.location) || (mot.locations && mot.locations[0]);
    out.motItemId = mot.service_price_id;
    out.locationUsed = location;

    const days = await callMentor('/service/booking-days', { location, priceIds: String(mot.service_price_id) });
    out.daysStatus = days.status;
    if (Array.isArray(days.body)) {
      out.slotMode = 'whole days (time slots are switched off)';
      out.firstDays = days.body.slice(0, 10);
      out.totalDays = days.body.length;
    } else if (days.body && typeof days.body === 'object' && !days.body.error) {
      out.slotMode = 'time slots are switched on';
      const dates = Object.keys(days.body);
      out.totalDays = dates.length;
      out.firstDays = dates.slice(0, 3).reduce((acc, d) => { acc[d] = days.body[d]; return acc; }, {});
    } else {
      out.ok = false;
      out.problem = 'Booking days step returned an error';
      out.reply = days.body;
    }
  } catch (e) {
    out.ok = false;
    out.problem = 'Could not reach Mentor: ' + e.message;
  }

  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(out, null, 2) };
};
