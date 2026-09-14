'use strict';
/**
 * Route coverage.
 *
 * A detail link that resolves to no route gives the visitor a bare platform
 * 404 with no way back, so every URL the app can build is checked against the
 * deployed routing table rather than spot-checked by hand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const pages = new Set(fs.readdirSync(ROOT).filter(f => f.endsWith('.html')));

/** How Vercel resolves a path: static file, cleanUrls alias, then rewrites in order. */
function resolveRoute(url) {
  const p = url.split('?')[0];
  const clean = p.replace(/^\//, '');
  if (p === '/') return 'index';           // index.html is the directory index
  if (pages.has(clean)) return 'file';
  if (cfg.cleanUrls && pages.has(clean + '.html')) return 'cleanUrl';
  for (const r of cfg.rewrites) {
    const re = new RegExp('^' + r.source.replace(/:[A-Za-z]+/g, '[^/]+') + '$');
    if (re.test(p)) return 'rewrite ' + r.source;
  }
  return null;
}

const enc = encodeURIComponent;
// An id with a hyphen, digits and an underscore — the shape EMSC actually emits.
const EVENT_ID = 'emsc-20260911_0000279';

const GENERATED = [
  ['eventUrl → incident', '/disasters/' + enc(EVENT_ID)],
  ['eventUrl → alert', '/alerts/' + enc(EVENT_ID)],
  ['eventUrl → outlook', '/forecasts/' + enc('OUT-gdacs-FL-1104124')],
  ['calamityUrl', '/calamities/' + enc(EVENT_ID)],
  ['historicalUrl', '/history/' + enc('thera-santorini-eruption')],
  ['regionUrl', '/regions/' + enc('Nepal')],
  ['locationUrl', '/locations/' + enc('Nepal')],
  ['hazardUrl', '/hazards/' + enc('Flood')],
  ['sourceDetailUrl', '/sources/' + enc('NASA EONET')]
];
for (const kind of ['insight', 'methodology', 'metric', 'resource', 'about', 'calendar', 'comparison', 'notification']) {
  GENERATED.push(['entityDetailUrl ' + kind, '/' + kind + '-detail']);
}
for (const [kind, url] of Object.entries({
  events: '/events', calamities: '/calamities', forecasts: '/forecast-list', alerts: '/official-warnings',
  regions: '/regions', historical: '/historical-events', hazards: '/hazard-types', sources: '/resources',
  verification: '/verification', calendar: '/forecast-calendar', compare: '/compare-locations',
  notifications: '/alerts-notifications', map: '/live-map'
})) GENERATED.push(['collectionUrl ' + kind, url]);
for (const p of ['/event-detail', '/alert-detail', '/calamity-detail', '/forecast-detail', '/region-detail',
  '/location-detail', '/hazard-detail', '/historical-event-detail', '/source-detail',
  '/verification-detail', '/entity-detail']) GENERATED.push(['canonical ' + p, p]);
for (const p of ['/', '/dashboard', '/live-map', '/forecasts', '/alerts', '/regions', '/verification',
  '/methodology', '/insights', '/about', '/directory']) GENERATED.push(['nav ' + p, p]);

test('every URL the app can build resolves to a route', () => {
  const missing = GENERATED.filter(([, url]) => !resolveRoute(url))
    .map(([label, url]) => label + ' -> ' + url);
  assert.deepEqual(missing, [], 'unroutable URLs:\n' + missing.join('\n'));
});

test('every detail page is reachable', () => {
  const orphans = [...pages].filter(f => f.endsWith('-detail.html'))
    .filter(f => !resolveRoute('/' + f.replace(/\.html$/, '')));
  assert.deepEqual(orphans, [], 'detail pages with no route: ' + orphans.join(', '));
});

/* The routing table below is what the deployment actually runs, and a table that
   passes review can still be dead in production. Every /alerts/<id> URL returned
   NOT_FOUND while the same suite reported full coverage, because cleanUrls strips
   .html from the build output: a rewrite pointing at /alert-detail.html aimed at a
   path the deployment no longer serves, so the rewrite resolved to nothing. */

test('no rewrite destination carries a .html extension while cleanUrls is on', () => {
  assert.equal(cfg.cleanUrls, true, 'these rules assume cleanUrls');
  const stale = cfg.rewrites.filter(r => /\.html($|\?)/.test(r.destination))
    .map(r => r.source + ' -> ' + r.destination);
  assert.deepEqual(stale, [], 'destinations the deployment does not serve:\n' + stale.join('\n'));
});

test('every rewrite destination resolves to a page the deployment serves', () => {
  const dangling = cfg.rewrites
    .filter(r => !resolveRoute(r.destination.split('?')[0]))
    .map(r => r.source + ' -> ' + r.destination);
  assert.deepEqual(dangling, [], 'rewrites pointing nowhere:\n' + dangling.join('\n'));
});

test('no rewrite shadows a file that cleanUrls already serves', () => {
  // Vercel checks the filesystem before rewrites, so such a rule never fires —
  // and once the .html is stripped from its destination it rewrites to itself.
  const inert = cfg.rewrites
    .filter(r => pages.has(r.source.replace(/^\//, '') + '.html'))
    .map(r => r.source + ' -> ' + r.destination);
  assert.deepEqual(inert, [], 'rewrites the filesystem already answers:\n' + inert.join('\n'));
});

test('ids containing hyphens, digits and underscores route the same as simple ids', () => {
  for (const id of ['abc', 'abc_def', EVENT_ID, 'gdacs-FL-1104124', 'OUT-aftershock-usgs-us7000tgrk', 'ND-001']) {
    assert.ok(resolveRoute('/alerts/' + enc(id)), 'id did not route: ' + id);
    assert.ok(resolveRoute('/disasters/' + enc(id)), 'id did not route: ' + id);
  }
});

test('a not-found page exists so unmatched paths are not a bare platform 404', () => {
  assert.ok(pages.has('404.html'), '404.html is missing');
});

/* --------------------------------------------- the 404 page's own behaviour

   The route table above is complete, but a visitor can still land on the
   not-found page: a negative response cached at the edge, a link to a record
   whose id changed upstream, a path typed by hand. Rendering 404.html at the
   address the visitor actually asked for is the only way to prove it recovers
   rather than dead-ends, so these run it exactly as production serves it. */

/** Where the rendered 404 page sends the reader, or null if it offers nowhere. */
async function forwardedTo(url) {
  const r = await renderPage('404.html', {
    url, timeoutMs: 8000,
    waitFor: doc => !doc.getElementById('onward').hidden
      || /no longer|not found|Could not reach/.test(doc.getElementById('headline').textContent)
  });
  const link = r.document.getElementById('onward');
  const dest = link.hidden ? null : link.getAttribute('href');
  const headline = r.document.getElementById('headline').textContent;
  r.close();
  return { dest, headline };
}

test('a live record reached through a stale 404 is forwarded to its detail page', async () => {
  const events = await sampleEvents();
  const alert = events.find(e => e.sourceType === 'official' && !e.forecast) || events[0];

  for (const [segment, page] of [['alerts', 'alert-detail'], ['disasters', 'event-detail'],
    ['calamities', 'calamity-detail']]) {
    const { dest } = await forwardedTo('/' + segment + '/' + encodeURIComponent(alert.id));
    assert.equal(dest, '/' + page + '?id=' + encodeURIComponent(alert.id),
      segment + ' did not forward to ' + page);
    // Forwarding back to the pretty URL would bounce off the same cached 404.
    assert.ok(!dest.startsWith('/' + segment + '/'), segment + ' forwarded into a redirect loop');
  }
});

test('an outlook reached through a stale 404 is forwarded to its outlook page', async () => {
  const events = await sampleEvents();
  const outlook = events.find(e => e.forecast);
  assert.ok(outlook, 'the mocked feed produced no outlook to test with');
  const { dest } = await forwardedTo('/forecasts/' + encodeURIComponent(outlook.id));
  assert.equal(dest, '/forecast-detail?id=' + encodeURIComponent(outlook.id));
});

test('catalog paths are forwarded without waiting on the live feed', async () => {
  for (const [url, dest] of [['/regions/Nepal', '/region-detail?region=Nepal'],
    ['/locations/Nepal', '/location-detail?location=Nepal'],
    ['/hazards/Flood', '/hazard-detail?type=Flood'],
    ['/sources/NASA%20EONET', '/source-detail?source=NASA%20EONET'],
    ['/history/thera-santorini-eruption', '/historical-event-detail?id=thera-santorini-eruption']]) {
    assert.equal((await forwardedTo(url)).dest, dest, url + ' did not forward correctly');
  }
});

test('an id that is genuinely gone gets an explanation, not a silent dead end', async () => {
  const { dest, headline } = await forwardedTo('/alerts/' + encodeURIComponent('no-such-record-12345'));
  assert.equal(dest, null, 'a missing record should not forward anywhere');
  assert.match(headline, /no longer in the live feed/);
});

test('dynamic detail routes are never edge-cached', () => {
  // A transient 404 held at the edge is what stranded a live alert on a bare
  // NOT_FOUND page while neighbouring ids resolved fine.
  const dynamic = cfg.headers.find(h => /disasters\|alerts\|forecasts/.test(h.source));
  assert.ok(dynamic, 'no cache policy for the pretty detail routes');
  assert.match(dynamic.headers.find(x => x.key === 'Cache-Control').value, /no-store/);

  const detail = cfg.headers.find(h => h.source === '/(.*)-detail');
  assert.ok(detail, 'no cache policy for the -detail routes');
  assert.match(detail.headers.find(x => x.key === 'Cache-Control').value, /no-store/);
});
