// Shared site content for MOT World. Admin edits are saved to the browser's
// localStorage under the key "site-content" and read by every page.
//
// NOTE ON SCOPE: localStorage is per-browser, per-device. Saving here updates
// what THIS browser sees on index.html/booking.html/admin.html. It does not
// push changes to other visitors' phones/computers -- for that, pricing needs
// to live on a server (a small backend or a hosted database) rather than in
// the browser. See the note at the bottom of this file if you want that.
const STORAGE_KEY = "site-content";

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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_CONTENT, ...JSON.parse(raw) };
    }
  } catch (e) {
    // Private browsing / storage disabled -- fall back to defaults.
  }
  return { ...DEFAULT_CONTENT };
}

async function saveContent(content) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
  return true;
}

// To make admin changes visible to EVERY visitor (not just this browser),
// swap loadContent/saveContent above for calls to a real backend endpoint
// that reads/writes a shared database or file on your server.
