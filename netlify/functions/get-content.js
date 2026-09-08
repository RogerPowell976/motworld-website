// Returns the currently saved site content (pricing, offers, business
// details) from shared storage, so every visitor sees the same thing.
// Public/no login needed -- this is just the published page content.
const { getStore } = require('@netlify/blobs');

function contentStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({ name: 'site-content', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  }
  return getStore('site-content');
}

exports.handler = async () => {
  try {
    const content = await contentStore().get('content', { type: 'json' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content || {}),
    };
  } catch (e) {
    console.error('get-content: Blobs read failed:', e.message);
    // Fail soft -- an empty object means the page just falls back to its
    // built-in defaults, rather than the page breaking entirely.
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' };
  }
};
