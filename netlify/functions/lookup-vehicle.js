// Looks up basic vehicle details from a registration, for showing on the booking form.
//   1. DVSA MOT History API (make AND model). Needs DVSA_CLIENT_ID, DVSA_CLIENT_SECRET,
//      DVSA_API_KEY, DVSA_TOKEN_URL in Netlify > Project configuration > Environment variables.
//   2. DVLA Vehicle Enquiry Service (make, colour, fuel, year; no model). Needs DVLA_API_KEY.
// If neither is configured or the vehicle isn't found it replies { found: false }, so the
// booking form still works without it.
//
// Request:  POST { "registrationNumber": "AB12CDE" }
// Reply:    { found, make, model, colour, fuelType, yearOfManufacture, source }

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (obj, statusCode = 200) => ({ statusCode, headers: JSON_H, body: JSON.stringify(obj) });
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();

// Reuse the DVSA sign-in token while this function instance stays warm (tokens last ~1 hour).
let dvsaToken = null;
let dvsaTokenExpires = 0;

async function getDvsaToken() {
  if (dvsaToken && Date.now() < dvsaTokenExpires) return dvsaToken;
  const { DVSA_CLIENT_ID, DVSA_CLIENT_SECRET, DVSA_TOKEN_URL } = process.env;
  const res = await fetch(DVSA_TOKEN_URL.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DVSA_CLIENT_ID.trim(),
      client_secret: DVSA_CLIENT_SECRET.trim(),
      scope: 'https://tapi.dvsa.gov.uk/.default',
    }).toString(),
  });
  if (!res.ok) throw new Error('DVSA sign-in failed (' + res.status + ')');
  const t = await res.json();
  dvsaToken = t.access_token;
  dvsaTokenExpires = Date.now() + Math.max(0, (Number(t.expires_in) || 3600) - 120) * 1000;
  return dvsaToken;
}

async function lookupDvsa(reg) {
  const { DVSA_CLIENT_ID, DVSA_CLIENT_SECRET, DVSA_API_KEY, DVSA_TOKEN_URL } = process.env;
  if (!DVSA_CLIENT_ID || !DVSA_CLIENT_SECRET || !DVSA_API_KEY || !DVSA_TOKEN_URL) return null;
  const token = await getDvsaToken();
  const res = await fetch('https://history.mot.api.gov.uk/v1/trade/vehicles/registration/' + encodeURIComponent(reg), {
    headers: { Authorization: 'Bearer ' + token, 'X-API-Key': DVSA_API_KEY.trim(), Accept: 'application/json' },
  });
  if (res.status === 404) return { found: false, reason: 'not_found' };
  if (!res.ok) throw new Error('DVSA lookup failed (' + res.status + ')');
  const v = await res.json();
  const date = v.firstUsedDate || v.registrationDate || v.manufactureDate || '';
  return {
    found: true,
    make: titleCase(v.make),
    model: titleCase(v.model),
    colour: titleCase(v.primaryColour),
    fuelType: titleCase(v.fuelType),
    yearOfManufacture: date ? String(date).slice(0, 4) : '',
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
  if (!res.ok) return { found: false, reason: 'not_found_or_error' };
  const v = await res.json();
  return {
    found: true,
    make: titleCase(v.make),
    model: '',
    colour: titleCase(v.colour),
    fuelType: titleCase(v.fuelType),
    yearOfManufacture: v.yearOfManufacture ? String(v.yearOfManufacture) : '',
    source: 'DVLA',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch (e) { return reply({ error: 'Invalid request body' }, 400); }

  const reg = String(data.registrationNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(reg)) return reply({ error: 'Missing registration number' }, 400);

  let configured = false;
  let notFound = false;
  for (const fn of [lookupDvsa, lookupDvla]) {
    try {
      const r = await fn(reg);
      if (!r) continue;              // that service isn't configured
      configured = true;
      if (r.found) return reply(r);
      notFound = true;               // try the next service before giving up
    } catch (e) {
      configured = true;
      console.error('lookup-vehicle:', e.message);
    }
  }
  if (!configured) return reply({ found: false, reason: 'lookup_not_configured' });
  return reply({ found: false, reason: notFound ? 'not_found' : 'lookup_failed' });
};
