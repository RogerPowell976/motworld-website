// Verifies the admin PIN server-side (the real PIN is never sent to the
// browser) and issues a short-lived session token for subsequent admin
// requests. Also locks out an IP address for a cooldown period after too
// many wrong attempts, to stop PIN-guessing.
const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function lockoutStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'admin-lockout', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('admin-lockout');
}

function sessionStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'admin-sessions', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('admin-sessions');
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours

function getClientId(event) {
  return event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
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

  const pin = String(data.pin || '');
  const clientId = getClientId(event);
  const store = lockoutStore();
  const now = Date.now();

  let record;
  try {
    record = (await store.get(clientId, { type: 'json' })) || { attempts: 0 };
  } catch (e) {
    record = { attempts: 0 };
  }

  // Currently locked out?
  if (record.attempts >= MAX_ATTEMPTS && record.lockedAt && (now - record.lockedAt) < LOCKOUT_MS) {
    const minutesLeft = Math.ceil((LOCKOUT_MS - (now - record.lockedAt)) / 60000);
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: `Too many incorrect attempts. Please try again in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
      }),
    };
  }

  // Lockout window has passed -- reset.
  if (record.attempts >= MAX_ATTEMPTS && record.lockedAt && (now - record.lockedAt) >= LOCKOUT_MS) {
    record = { attempts: 0 };
  }

  const correctPin = process.env.ADMIN_PIN;
  if (!correctPin) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Admin PIN is not configured on the server.' }) };
  }

  if (pin !== correctPin) {
    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts >= MAX_ATTEMPTS) {
      record.lockedAt = now;
    }
    try { await store.setJSON(clientId, record); } catch (e) { /* non-critical */ }
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect PIN — try again.' }) };
  }

  // Correct PIN: clear any lockout record for this IP and issue a session token.
  try { await store.delete(clientId); } catch (e) { /* non-critical */ }

  const token = crypto.randomBytes(24).toString('hex');
  try {
    await sessionStore().setJSON(token, { createdAt: now, expiresAt: now + SESSION_MS });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start a session — please try again.' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, expiresAt: now + SESSION_MS }),
  };
};

// Shared helper other admin functions can use to verify a session token.
// (Node will only export this when required directly, e.g. from list-bookings.js.)
module.exports.verifySession = async function verifySession(token) {
  if (!token) return false;
  try {
    const record = await sessionStore().get(token, { type: 'json' });
    if (!record) return false;
    if (Date.now() > record.expiresAt) return false;
    return true;
  } catch (e) {
    return false;
  }
};
