// Looks up basic vehicle details from the free DVLA Vehicle Enquiry Service.
// Requires an environment variable DVLA_API_KEY to be set in the Netlify
// site's dashboard (Project configuration -> Environment variables).
// Note: DVLA's data includes make, colour, fuel type and year -- but NOT
// the model name, which DVLA does not hold in this dataset.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.DVLA_API_KEY;
  if (!apiKey) {
    // Key not configured yet -- fail gracefully so the form still works
    // with manual entry instead of breaking.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ found: false, reason: 'lookup_not_configured' }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const reg = String(data.registrationNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!reg) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing registration number' }) };
  }

  try {
    const res = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ registrationNumber: reg }),
    });

    if (!res.ok) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ found: false, reason: 'not_found_or_error' }),
      };
    }

    const vehicle = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        make: vehicle.make || '',
        colour: vehicle.colour || '',
        fuelType: vehicle.fuelType || '',
        yearOfManufacture: vehicle.yearOfManufacture || '',
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ found: false, reason: 'lookup_failed' }),
    };
  }
};
