// Shared helper for talking to the Mentor DMS API. Always runs on the server
// (Netlify Functions), never in the customer's browser, so the login is safe.
//
// Settings (Netlify > Environment variables):
//   MENTOR_BASE_URL       e.g. https://api-qa.mentordms.co.uk/v1/   (test)
//   MENTOR_API_USERNAME   API username
//   MENTOR_API_PASSWORD   API password
//   MENTOR_LOCATION       optional; defaults to the location Mentor returns

function username() { return (process.env.MENTOR_API_USERNAME || process.env.MENTOR_USERNAME || '').trim(); }
function password() { return (process.env.MENTOR_API_PASSWORD || process.env.MENTOR_PASSWORD || '').trim(); }

function isConfigured() {
  return !!(process.env.MENTOR_BASE_URL && username() && password());
}

async function mentor(path, opts) {
  const { method = 'GET', params, body } = opts || {};
  const base = (process.env.MENTOR_BASE_URL || '').trim().replace(/\/+$/, '');
  const url = base + path + (params ? '?' + new URLSearchParams(params).toString() : '');
  const headers = { username: username(), password: password(), Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { error: 'Unreadable reply from Mentor' }; }
  return { status: res.status, data };
}

// Mentor's price step needs a vehicle, but the MOT price does not depend on it,
// so a fixed sample vehicle is used purely to ask for the current MOT price.
async function getMotPrice() {
  const r = await mentor('/service/service-prices', {
    params: { make: 'Ford', model: 'Fiesta', fuel: 'Petrol', transmission: 'Manual', regDate: '2018-03-01', mileage: '45000' },
  });
  if (r.status !== 200 || !Array.isArray(r.data)) {
    throw new Error('Mentor price step failed (' + r.status + ')');
  }
  const item = r.data.find((p) => String(p.type).toUpperCase() === 'MOT');
  if (!item || !item.options || !item.options.length) throw new Error('No MOT price found in Mentor');
  const opt = item.options.find((o) => o.matched) || item.options[0];
  const rrp = parseFloat(opt.rrp);
  const dealer = opt.dealer_price !== undefined && opt.dealer_price !== null ? parseFloat(opt.dealer_price) : NaN;
  const price = !isNaN(dealer) && dealer > 0 ? dealer : rrp;
  const location = (process.env.MENTOR_LOCATION || '').trim() || (item.locations && item.locations[0]);
  if (!location) throw new Error('No location found in Mentor');
  return { id: String(item.service_price_id), location, rrp, price };
}

// Returns { 'YYYY-MM-DD': ['08:45', ...] } (slots on) or { 'YYYY-MM-DD': [] } (slots off).
async function getDays(location, priceId) {
  const r = await mentor('/service/booking-days', { params: { location, priceIds: priceId } });
  if (r.status !== 200) throw new Error('Mentor booking days failed (' + r.status + ')');
  if (Array.isArray(r.data)) {
    const out = {};
    r.data.forEach((d) => { out[d] =
