// content/universal.js — NeuroAgi auto-capture content script
// Runs on every page. When the student lands on an academic portal page, it asks
// the background worker to sync — which uses the SAME API-first → scrape-fallback
// flow as the popup button. The content script itself can't reach the page's JS
// (window.ENV / M.cfg) or run scripting, so the background does the actual work.
// Throttled so normal browsing doesn't re-sync on every page load.

const SYNC_THROTTLE_MS = 20 * 60 * 1000;   // at most once per 20 min

// Only fire on URLs that clearly belong to a known LMS — this is an AUTOMATIC
// trigger, so we must not run on arbitrary sites. The background's API sync grabs
// everything regardless of which LMS page you're on, so broad in-portal matching
// isn't needed; the scrape fallback is reserved for unsupported LMS portals.
const PORTAL_HINTS = [
  /\/d2l\//i,                          // Brightspace / D2L
  /instructure\.com/i,                 // Canvas (hosted)
  /\/course\/view\.php|\/my\/.*moodle|\/moodle\//i,  // Moodle
  /blackboard\.com|\/ultra\/|\/webapps\/blackboard/i, // Blackboard
];

function looksLikePortal(url) {
  return PORTAL_HINTS.some(re => re.test(url));
}

async function tryCapture() {
  // After an extension reload, content scripts already injected into open tabs
  // are orphaned — their chrome.* context is invalidated and chrome.storage
  // becomes undefined. Bail silently instead of throwing; a tab refresh loads
  // the fresh script.
  if (!chrome?.storage?.local) return;

  const { neuroagi_user, neuroagi_last_autosync = 0 } =
    await chrome.storage.local.get(["neuroagi_user", "neuroagi_last_autosync"]);
  if (!neuroagi_user) return;                       // not logged in
  if (!looksLikePortal(location.href)) return;       // not an academic page
  if (Date.now() - neuroagi_last_autosync < SYNC_THROTTLE_MS) return;  // throttled

  // Claim the throttle slot up-front so two tabs don't sync at once.
  await chrome.storage.local.set({ neuroagi_last_autosync: Date.now() });

  chrome.runtime.sendMessage(
    { type: "NEUROAGI_AUTO_SYNC", userId: neuroagi_user.id },
    (res) => {
      // If the sync didn't actually do anything (e.g. not a real portal), release
      // the throttle so a later, genuine portal page can sync sooner.
      if (!res?.ok) chrome.storage.local.set({ neuroagi_last_autosync: 0 });
    }
  );
}

// Wait a moment after load for JS-rendered portals (D2L web components, etc.)
function scheduleCapture() { setTimeout(tryCapture, 2500); }

if (document.readyState === "complete") {
  scheduleCapture();
} else {
  window.addEventListener("load", scheduleCapture);
}
