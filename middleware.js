/*
 * Share previews for record pages (launch audit B9).
 *
 * Every /disasters/:id, /alerts/:id, /calamities/:id and /history/:slug page
 * is one static template filled in by JavaScript, and a crawler such as
 * LinkedIn's does not run JavaScript: every shared event previewed as "Event
 * details | Predict Natural Disasters". This is Vercel Routing Middleware (a
 * middleware.js at the project root, for a project that is not Next.js; the
 * API is a default-exported function given a standard Request, and a config
 * export with a matcher). It writes the record's own <title>, description,
 * Open Graph and canonical tags into the static page.
 *
 * - History entries come from history-data.js, a static file, for everyone.
 * - Live records come from the cached /api/events, with a short timeout, and
 *   only for crawlers and link-preview bots: the feed is large, and a reader's
 *   browser fills the same tags in itself a moment later.
 * - Anything that fails (a timeout, a bad answer, a page without the tags)
 *   returns nothing, and the request continues to the static page unchanged.
 * - An id the feed (or the archive) does not hold is served with
 *   robots noindex and status 404, only once the lookup itself succeeded.
 *   An old history slug, from before accents were folded, is redirected.
 *
 * Nothing about the visitor is sent anywhere: the only requests are to this
 * site's own origin.
 */

export const config = {
  matcher: ['/disasters/:id*', '/alerts/:id*', '/calamities/:id*', '/history/:slug*']
};

export const SITE = 'https://predict-natural-disasters.anchit-tandon.com';
const SUFFIX = ' | Predict Natural Disasters';
const TEMPLATES = { disasters: '/event-detail', alerts: '/alert-detail', calamities: '/calamity-detail', history: '/historical-event-detail' };
export const FEED_TIMEOUT_MS = 1500;
const PAGE_TIMEOUT_MS = 1500;
/* Asked for by this middleware, so its own fetches are never handled twice. */
const LOOP_HEADER = 'x-pnd-share-preview';

/* Crawlers and the link-preview fetchers of the networks a launch is shared on. */
const BOT = /bot\b|crawler|spider|crawl|slurp|facebookexternalhit|linkedin|twitterbot|slackbot|discord|whatsapp|telegram|embedly|preview|skype|pinterest|redditbot|applebot|bingbot|googlebot|duckduckbot|yandex|baiduspider|mastodon|bluesky|iframely|vkshare|outbrain|quora link preview/i;
export function isPreviewBot(ua) { return BOT.test(String(ua || '')); }

/** "/disasters/usgs-1" -> { kind: 'disasters', id: 'usgs-1' }, or null. */
export function parsePath(pathname) {
  const m = /^\/(disasters|alerts|calamities|history)\/([^/]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  let id = m[2];
  try { id = decodeURIComponent(id); } catch (e) { /* keep it as written */ }
  return { kind: m[1], id };
}

/* The site's own slug (portal.js PND.slug), and the one before accents were folded. */
export function slug(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function legacySlug(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The archive, read out of history-data.js without running it. */
export function historyFromScript(src) {
  const s = String(src || '');
  const at = s.indexOf('PND_HISTORY=[');
  if (at < 0) return null;
  const end = s.lastIndexOf(']');
  try {
    const list = JSON.parse(s.slice(at + 'PND_HISTORY='.length, end + 1));
    return Array.isArray(list) ? list : null;
  } catch (e) { return null; }
}

/** The history entry a slug names: { entry, redirect } or null. */
export function findHistory(list, key) {
  const k = String(key || '');
  const hit = list.find(x => slug(x.name) === k);
  if (hit) return { entry: hit, redirect: null };
  const old = list.find(x => legacySlug(x.name) === k || slug(x.name) === slug(k));
  return old ? { entry: old, redirect: '/history/' + slug(old.name) } : null;
}

/** As PND.findEvent in portal.js: by id, by a merged copy's id, then loosely. */
export function findEvent(events, id) {
  if (!Array.isArray(events) || !id) return null;
  const raw = String(id);
  const exact = events.find(e => String(e.id) === raw);
  if (exact) return exact;
  const merged = events.find(e => Array.isArray(e.mergedFrom) && e.mergedFrom.some(m => m && String(m.id) === raw));
  if (merged) return merged;
  const norm = v => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = norm(raw);
  if (!n) return null;
  return events.find(e => norm(e.id) === n) || events.find(e => norm(e.title) === n) ||
    events.find(e => norm(e.id).endsWith(n) || n.endsWith(norm(e.id))) || null;
}

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayText(v) {
  const t = Date.parse(v || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, '') + '…';
}

/** The tags for a live record. Its canonical address is always /disasters/:id. */
export function eventMeta(e) {
  const place = e.place || [e.region, e.country].filter(Boolean).join(', ');
  const kind = e.forecast ? 'Our forecast, not an official warning'
    : e.evidenceState === 'official-warning'
      ? ({ watch: 'Official watch', advisory: 'Official advisory', statement: 'Official statement', other: 'Official statement', normal: 'Official status' }[e.officialProduct] || 'Official warning')
      : 'Reported event';
  const updated = dayText(e.updated);
  const desc = [
    kind + ': ' + (e.type || 'natural hazard') + (place ? ' in ' + place : '') + '.',
    e.source ? 'Source: ' + e.source + (updated ? ', updated ' + updated : '') + '.' : '',
    e.live === false ? 'No longer updated by its source.' : ''
  ].filter(Boolean).join(' ');
  const path = (e.forecast ? '/forecasts/' : '/disasters/') + encodeURIComponent(e.id);
  return { title: clip(e.title || 'Natural hazard report', 90) + SUFFIX, description: clip(desc, 200), path };
}

/** The tags for a history entry. */
export function historyMeta(h) {
  const desc = [h.name + ', ' + (h.date || h.year) + ', ' + h.location + '.', h.deaths ? 'Deaths: ' + h.deaths + '.' : '', h.summary || '']
    .filter(Boolean).join(' ');
  return { title: clip(h.name, 90) + SUFFIX, description: clip(desc, 200), path: '/history/' + slug(h.name) };
}

function attr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The static page with its tags replaced. Returns null when the page does not
 * carry the tags this expects, so a page whose markup has changed is served
 * as it is rather than half rewritten.
 */
export function injectMeta(html, meta, opts) {
  const o = opts || {};
  let out = String(html || '');
  if (!/<title>[^<]*<\/title>/.test(out)) return null;
  const url = SITE + meta.path;
  out = out.replace(/<title>[^<]*<\/title>/, '<title>' + attr(meta.title) + '</title>');
  const set = (re, tag) => { out = re.test(out) ? out.replace(re, tag) : out.replace('</title>', '</title>\n' + tag); };
  set(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + attr(meta.description) + '">');
  set(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + attr(url) + '">');
  set(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + attr(meta.title) + '">');
  set(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + attr(meta.description) + '">');
  set(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + attr(url) + '">');
  set(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">');
  if (/<meta name="twitter:title" content="[^"]*">/.test(out)) out = out.replace(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + attr(meta.title) + '">');
  if (/<meta name="twitter:description" content="[^"]*">/.test(out)) out = out.replace(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + attr(meta.description) + '">');
  if (o.noindex) out = out.replace('</title>', '</title>\n<meta name="robots" content="noindex">');
  return out;
}

/** The not-found variant: the template's own tags, with noindex. */
export function noindexPage(html) {
  const s = String(html || '');
  if (!/<\/title>/.test(s)) return null;
  return s.replace('</title>', '</title>\n<meta name="robots" content="noindex">');
}

async function timed(fetchImpl, url, ms) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await fetchImpl(url, { headers: { [LOOP_HEADER]: '1' }, signal: ac ? ac.signal : undefined });
    if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    return r;
  } finally { if (t) clearTimeout(t); }
}

/* The security headers vercel.json gives every page, kept on a page this answers. */
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0, must-revalidate',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(self)',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload'
};

/**
 * The whole decision, with fetch passed in so it can be tested.
 * Resolves to a Response, or undefined to let the request carry on unchanged.
 */
export async function handle(request, deps) {
  const fetchImpl = (deps && deps.fetch) || fetch;
  try {
    if (request.method && request.method !== 'GET' && request.method !== 'HEAD') return undefined;
    if (request.headers.get(LOOP_HEADER)) return undefined;
    const url = new URL(request.url);
    const at = parsePath(url.pathname);
    if (!at) return undefined;
    const bot = isPreviewBot(request.headers.get('user-agent'));
    if (at.kind !== 'history' && !bot) return undefined;

    const origin = url.origin;
    const page = timed(fetchImpl, origin + TEMPLATES[at.kind] + '?id=' + encodeURIComponent(at.id), PAGE_TIMEOUT_MS).then(r => r.text());
    page.catch(() => {});   // awaited below; a failure before then is not unhandled
    let meta = null, missing = false;
    if (at.kind === 'history') {
      const list = historyFromScript(await (await timed(fetchImpl, origin + '/history-data.js', PAGE_TIMEOUT_MS)).text());
      if (!list) return undefined;
      const found = findHistory(list, at.id);
      if (found && found.redirect) {
        return new Response(null, { status: 301, headers: { location: found.redirect } });
      }
      if (found) meta = historyMeta(found.entry); else missing = true;
    } else {
      const feed = await (await timed(fetchImpl, origin + '/api/events', FEED_TIMEOUT_MS)).json();
      if (!feed || !Array.isArray(feed.events)) return undefined;
      const e = findEvent(feed.events, at.id);
      if (e) meta = eventMeta(e); else missing = true;
    }
    const html = await page;
    const body = missing ? noindexPage(html) : injectMeta(html, meta);
    if (!body) return undefined;
    return new Response(request.method === 'HEAD' ? null : body, { status: missing ? 404 : 200, headers: PAGE_HEADERS });
  } catch (e) {
    return undefined;
  }
}

export default function middleware(request) {
  return handle(request);
}
