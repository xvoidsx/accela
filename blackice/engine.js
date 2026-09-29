// Accela blackice engine — native ad/tracker blocking via Electron webRequest.
// Shares filter philosophy with the blackice MV3 extension: block ads, trackers,
// and annoyances. Filter lists are embedded; custom rules can be added.

const BLOCKED_PATTERNS = [
  // Ads
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /adservice\.google\./i,
  /ads\.yahoo\.com/i,
  /amazon-adsystem\.com/i,
  /adsrvr\.org/i,
  /criteo\.com/i,
  /outbrain\.com/i,
  /taboola\.com/i,
  /revcontent\.com/i,
  // Trackers
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.net\/tr/i,
  /connect\.facebook\.net/i,
  /hotjar\.com/i,
  /fullstory\.com/i,
  /segment\.(com|io)/i,
  /mixpanel\.com/i,
  /amplitude\.com/i,
  /newrelic\.com/i,
  // Annoyances
  /cookiebot\.com/i,
  /onetrust\.com/i,
];

let blockedCount = 0;
const blockedByTab = new Map();

function shouldBlock(url) {
  try {
    return BLOCKED_PATTERNS.some(p => p.test(url));
  } catch { return false; }
}

function initBlackice(sess) {
  // Block ads/trackers before they load
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (shouldBlock(details.url)) {
      blockedCount++;
      callback({ cancel: true });
    } else {
      callback({});
    }
  });

  // Strip tracking params and harden headers
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    // Remove common tracking headers
    delete headers['X-Client-Data'];
    callback({ requestHeaders: headers });
  });

  console.log('[blackice] native adblocking active');
}

function getStats() {
  return { blockedCount };
}

module.exports = { initBlackice, getStats, shouldBlock };
