/**
 * Things that are not part of a page's layout: analytics, ads, session replay,
 * chat widgets and cookie banners. They are dropped from exports.
 */

/** Hostnames (and every subdomain of them) whose scripts, pixels and frames are removed */
const TRACKING_HOSTS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com',
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'g.doubleclick.net',
  'connect.facebook.net', 'hotjar.com', 'hotjar.io', 'clarity.ms', 'segment.com', 'segment.io',
  'mixpanel.com', 'amplitude.com', 'fullstory.com', 'heapanalytics.com', 'heap.io', 'mouseflow.com',
  'luckyorange.com', 'crazyegg.com', 'snap.licdn.com', 'px.ads.linkedin.com', 'analytics.tiktok.com',
  'static.ads-twitter.com', 'analytics.twitter.com', 'bat.bing.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'adsrvr.org', 'quantserve.com', 'scorecardresearch.com',
  'js.hs-scripts.com', 'js.hs-analytics.net', 'js.hsforms.net', 'track.hubspot.com', 'hs-banner.com',
  'newrelic.com', 'nr-data.net', 'sentry.io', 'optimizely.com', 'pingdom.net',
  // chat widgets
  'widget.intercom.io', 'intercomcdn.com', 'js.driftt.com', 'embed.tawk.to', 'client.crisp.chat',
  'widget.crisp.chat', 'livechatinc.com', 'zdassets.com',
  // cookie consent
  'cdn.cookielaw.org', 'cookielaw.org', 'cookiebot.com', 'consent.cookiebot.com', 'cookiefirst.com',
  'cookieyes.com', 'termly.io', 'iubenda.com', 'trustarc.com',
  // reCAPTCHA is behaviour, not layout
  'recaptcha.net',
];

/** Path-specific cases on hosts that also serve useful content */
const TRACKING_PATTERNS = [
  /^https?:\/\/(www\.)?facebook\.com\/tr[/?]/i,
  /^https?:\/\/(www\.)?google\.[a-z.]+\/(recaptcha|ads|pagead)\//i,
  /^https?:\/\/(www\.)?gstatic\.com\/recaptcha\//i,
  /^https?:\/\/[^/]+\/(gtag|gtm|fbevents|analytics|pixel)\.js(\?|$)/i,
];

export function isTrackingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  if (TRACKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return TRACKING_PATTERNS.some((re) => re.test(url));
}

/** Containers injected by well-known consent/chat/captcha tools. Only exact, well-known ids/classes. */
export const NOISE_SELECTORS = [
  '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#onetrust-consent-sdk', '#onetrust-banner-sdk',
  '#cookiefirst-root', '.cky-consent-container', '#hs-eu-cookie-confirmation', '#cookie-law-info-bar',
  '.grecaptcha-badge', '#hubspot-messages-iframe-container', '#intercom-container', '#drift-widget-container',
  '#tawkchat-container', '.crisp-client', '#fb-root', '#fb-customer-chat',
].join(',');
