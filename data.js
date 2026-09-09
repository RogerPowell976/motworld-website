// Shared site content for MOT World. Admin edits are saved to a shared
// server-side store (via get-content.js / save-content.js) so every visitor
// sees the same pricing and offers, not just the browser that made the edit.
const DEFAULT_CONTENT = {
  location: "Bordon, Hampshire",
  hours: "Mon–Fri 8:00–17:00",
  phone: "01420 384293",
  heroTitle: "Professional MOT Testing & Vehicle Services",
  heroSubtitle: "Fast, fair, and reliable MOT testing with over 25 years of expertise. Book your appointment today.",
  primaryOfferPrice: "£29.95",
  primaryOfferRrp: "£54.85",
  primaryOfferDetail: "Covers Class 4 MOTs. Bring registration document to qualify for this offer.",
  secondOfferTitle: "MOT and Service from £189",
  secondOfferDetail: "Complete MOT and full service in one visit",
  healthCheckDetail: "Comprehensive check and report",
  tradingSince: "1996",
  familyRun: "LMC of Farnham Ltd",
};

async function loadContent() {
  try {
    const res = await fetch("/.netlify/functions/get-content");
    if (res.ok) {
      const saved = await res.json();
      return { ...DEFAULT_CONTENT, ...saved };
    }
  } catch (e) {
    // Network issue -- fall back to defaults below rather than breaking the page.
  }
  return { ...DEFAULT_CONTENT };
}

// sessionToken is the admin session token from check-pin.js (see admin.html).
async function saveContent(content, sessionToken) {
  const res = await fetch("/.netlify/functions/save-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(content),
  });
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.error || "Could not save");
  }
  return true;
}
