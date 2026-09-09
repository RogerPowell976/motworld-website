// Saves site content (pricing, offers, business details) to shared storage
// so changes show up for every visitor, not just the browser that saved
// them. Requires a valid admin session token from check-pin.js.
const { getStore } = require('@netlify/blobs');
const { verifySession } = require('./check-pin');

function contentStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'site-content', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('site-content');
}

function getToken(event) {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authed = await verifySession(getToken(event));
  if (!authed) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Please unlock the admin page again.' }) };
  }

  let content;
  try {
    content = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid content' }) };
  }

  try {
    await contentStore().setJSON('content', content);
  } catch (e) {
    console.error('save-content: Blobs write failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save', detail: e.message }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
