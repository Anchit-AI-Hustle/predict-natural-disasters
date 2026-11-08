'use strict';
/**
 * The accessibility, SEO, performance and layout audit of 20 Oct 2026: the
 * findings that were in the site before the trust note, each held here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

test('a phone, a touch screen or save-data opens on the flat map and downloads no globe', async () => {
  const r = await renderPage('live-map.html', {
    timeoutMs: 4000,
    beforeParse(w) { w.matchMedia = q => ({ matches: /max-width/.test(q), media: q, addListener() {}, removeListener() {} }); }
  });
  const w = r.window;
  assert.equal(w.PNDGlobe.prefers(), 'flat');
  assert.equal((w.__pndViewers || []).length, 0, 'the globe was built on a phone nobody asked it of');
  assert.equal(w.document.querySelectorAll('script[src*="cesium"]').length, 0, 'the 3D library was requested');
  r.close();
  // A choice once made is kept, phone or not.
  const kept = await renderPage('live-map.html', {
    timeoutMs: 4000, storage: { pnd_map_view: 'globe' },
    beforeParse(w2) { w2.matchMedia = q => ({ matches: true, media: q }); }
  });
  assert.equal(kept.window.PNDGlobe.prefers(), 'globe');
  kept.close();
});

test('map markers are not tab stops, and take a tap at least 24px across', async () => {
  const r = await renderPage('live-map.html', { waitFor: (d, w) => (w.__pndMaps || []).some(m => m.__layers.some(l => (l.__kids || []).length)), timeoutMs: 9000 });
  const markers = r.window.__pndMaps.flatMap(m => m.__layers.flatMap(l => l.__kids || [])).filter(k => k.options && k.options.pndLevel);
  assert.ok(markers.length > 0, 'no markers drawn');
  r.close();
  // jsdom's map is a stub with no marker elements; Chromium checks the tabindex itself.
  assert.match(read('map-setup.js'), /el\.setAttribute\('tabindex', '-1'\)/);
  assert.match(read('map-setup.js'), /var hit = Math\.max\(24, icon\.iconSize\[0\]\)/);
});

test('smooth scrolling waits for reduced motion, and focus is kept clear of the fixed bars', () => {
  for (const f of ['portal.css', 'app-pages.css', 'index.html']) {
    const s = read(f);
    const bare = s.replace(/@media \(prefers-reduced-motion:no-preference\)\{html\{scroll-behavior:smooth\}\}/g, '');
    assert.ok(!/scroll-behavior:smooth/.test(bare), f + ' scrolls smoothly under reduced motion');
    assert.match(s, /scroll-padding-bottom:calc\(66px \+ env\(safe-area-inset-bottom\)\)/, f);
    assert.match(s, /scroll-padding-top:80px/, f);
  }
  /* portal.css holds it whether or not the header has arrived, at each width's
     own height (launch audit A11, test/launch-map.test.js). */
  for (const f of ['portal.css', 'app-pages.css']) assert.match(read(f), /#nav(?::empty)?\{min-height:69px\}/, f + ' does not hold the header height');
  assert.match(read('app-pages.css'), /\.top-search input:focus-visible\{outline:2px solid/);
});

test('every page has a skip link and keeps its content in named landmarks', async () => {
  const r = await renderPage('event-detail.html', { search: '?id=usgs-us7000abcd', waitFor: d => d.getElementById('kMode').textContent !== '-' });
  const d = r.document;
  const skip = d.querySelector('a.skip');
  assert.ok(skip, 'no skip link');
  assert.equal(d.body.firstElementChild, skip, 'the skip link is not first');
  assert.ok(d.querySelector(skip.getAttribute('href')), 'the skip link points nowhere');
  for (const sec of d.querySelectorAll('body > section')) {
    assert.ok(sec.hasAttribute('aria-label') || sec.hasAttribute('aria-labelledby'), 'an unnamed section sits outside <main>: ' + sec.className);
  }
  r.close();
});

test('a detail page states its key facts in a description list', async () => {
  const r = await renderPage('event-detail.html', { search: '?id=usgs-us7000abcd', waitFor: d => /Where it started/.test((d.getElementById('whenWhereBody') || {}).textContent || ''), timeoutMs: 9000 });
  const body = r.document.getElementById('whenWhereBody');
  assert.ok(body.querySelector('dl'), 'no <dl>');
  assert.ok([...body.querySelectorAll('dt,dd')].every(x => x.parentElement.tagName === 'DL'), 'a dt or dd outside a dl');
  r.close();
});

test('every detail page is titled for its record, not its template', async () => {
  for (const [page, search, re] of [
    ['alert-detail.html', '?id=nws-urn%3Aoid%3A2.49.0.1.840.0.aaa', /^(?!Alert details)/],
    ['forecast-detail.html', '?id=ND-001', /Vietnam/],
    ['region-detail.html', '?region=Nepal', /Nepal/],
    ['hazard-detail.html', '?type=Wildfire', /Wildfire/],
    ['source-detail.html', '?source=USGS', /^USGS/],
    ['location-detail.html', '?location=Nepal', /Nepal/],
    ['historical-event-detail.html', '?id=0', /^(?!Past disaster details)/]
  ]) {
    const r = await renderPage(page, { search, timeoutMs: 6000, waitFor: d => !/details \|/i.test(d.title) });
    assert.match(r.document.title, re, page + ' is titled "' + r.document.title + '"');
    assert.doesNotMatch(r.document.title, /details \|/i, page);
    r.close();
  }
});

test('a source chip inside a card link is not a second, nested link', async () => {
  const r = await renderPage('events.html', { waitFor: d => d.querySelectorAll('#cards .event-card').length > 0 });
  const nested = [...r.document.querySelectorAll('a[href] [role="link"], a[href] [tabindex="0"]')];
  assert.deepEqual(nested.map(x => x.outerHTML.slice(0, 80)), []);
  r.close();
});

test('the sitemap lists no noindex page and dates every entry', () => {
  const s = read('sitemap.xml');
  assert.doesNotMatch(s, /\/dashboard</);
  assert.equal((s.match(/<url>/g) || []).length, (s.match(/<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/g) || []).length);
});

test('every page offers the manifest, which has separate plain and maskable icons', () => {
  const missing = PAGES.filter(f => !/<link rel="manifest" href="\/manifest\.webmanifest">/.test(read(f)));
  assert.deepEqual(missing, []);
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(!m.icons.some(i => /any maskable/.test(i.purpose)), 'one icon is both plain and maskable');
  for (const p of ['any', 'maskable']) assert.ok(m.icons.some(i => i.purpose === p), 'no ' + p + ' icon');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src + ' is missing');
  assert.equal(m.theme_color, '#02110d');
});

test('scripts, styles and data are cached briefly and revalidated, and portal.js is still never stored', () => {
  const v = JSON.parse(read('vercel.json'));
  const rule = src => v.headers.find(h => h.source === src);
  const js = v.headers.find(h => /\\\.js$/.test(h.source) && /collection/.test(h.source));
  assert.ok(js && /max-age=60/.test(js.headers[0].value), 'no cache rule for the scripts');
  assert.ok(!/portal|\bsw\b/.test(js.source), 'portal.js and sw.js keep their own rules');
  assert.match(rule('/data/(.*)').headers[0].value, /must-revalidate/);
  assert.match(rule('/portal.js').headers[0].value, /no-store/);
  assert.doesNotMatch(read('accuracy.html'), /\?ts='\+Date\.now\(\)/, '/accuracy still re-downloads 4.7 MB on every visit');
});

test('dates are formatted exactly as before, from a formatter made once', async () => {
  const r = await renderPage('events.html', { waitFor: (d, w) => !!w.PND });
  const P = r.window.PND;
  const when = '2026-10-20T11:23:54Z';
  const direct = new Date(when).toLocaleString('en-IN', { timeZone: P.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM') + ' ' + P.tzLabel();
  assert.equal(P.fmtDate(when), direct);
  assert.equal(P.fmtWhen('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z'), '20 Oct 2026');
  r.close();
});
