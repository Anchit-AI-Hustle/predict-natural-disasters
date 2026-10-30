'use strict';
/**
 * Launch audit B (29 to 30 Oct 2026), the page half: the alerts, events,
 * calamities, detail and history pages, rendered against a snapshot of the
 * live feed (test/fixtures/launch-feed.json, 118 records cut from the feed the
 * audit read). Each test names the finding it holds.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const api = require(path.join(ROOT, 'api', 'events.js'));
const H = require(path.join(ROOT, 'hazard-model.js'));

/* The snapshot, passed through the reader-facing steps the feed now runs, so a
   page sees what the fixed feed would serve for the same records. */
function feed() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'launch-feed.json'), 'utf8'));
  const now = Date.parse(f.generatedAt);
  for (const e of f.events) { delete e.live; delete e.quietDays; }
  api.markLive(f.events, now);
  for (const e of f.events) api.readerFields(e);
  return f;
}
const FEED = feed();
const byId = id => FEED.events.find(e => e.id === id);
const text = d => d.body.textContent.replace(/\s+/g, ' ');

function historyList() {
  const s = read('history-data.js');
  return JSON.parse(s.slice(s.indexOf('PND_HISTORY=[') + 'PND_HISTORY='.length, s.lastIndexOf(']') + 1));
}

/* ------------------------------------------------------------------ B1 */

test('B1: a history page shows the archive only: no live advice, news, reports or videos, and the event\'s own date', async () => {
  const r = await renderPage('historical-event-detail.html', { url: '/history/thera-santorini-eruption', feed: FEED,
    waitFor: d => d.getElementById('title').textContent !== 'Past disaster' });
  const t = text(r.document);
  assert.equal(r.document.getElementById('title').textContent, 'Thera (Santorini) eruption');
  assert.ok(!r.apiCalls.some(u => u.includes('/api/event-enrichment')), 'the live enrichment was asked for an archive entry');
  for (const bad of ['Who may need help', 'Immediate needs', 'How to stay safe', 'Situation reports', 'Videos', 'News reports', 'Updated ', 'About these times']) {
    assert.ok(!t.includes(bad), 'history page shows "' + bad + '"');
  }
  assert.match(t, /c\. 1600 BCE/);
  assert.equal(r.document.getElementById('eventEnrichment'), null);
  r.close();
});

test('B1: the enrichment script refuses an archive entry, whichever page asks', async () => {
  const r = await renderPage('event-detail.html', { search: '?id=usgs-us7000tu2j', feed: FEED,
    waitFor: d => d.getElementById('kMode').textContent !== '-' });
  const w = r.window;
  const mount = r.document.getElementById('eventEnrichment');
  mount.innerHTML = ''; delete mount.dataset.ready;
  const calls = r.apiCalls.length;
  await w.PNDEventEnrichment.load({ title: 'Thera', historical: true, type: 'Volcanic Eruption' });
  await w.PNDEventEnrichment.load({ title: 'Thera', source: 'Historical disaster archive', type: 'Volcanic Eruption' });
  assert.equal(mount.innerHTML, '', 'an archive entry was given the live panels');
  assert.equal(r.apiCalls.length, calls);
  assert.equal(w.PNDEventEnrichment.isArchive({ historical: true }), true);
  r.close();
});

/* ------------------------------------------------------------------ B2 */

test('B2: a North Indian Ocean cyclone is classed on IMD\'s scale and links IMD, not "Category 4"', async () => {
  const arnab = byId('gdacs-TC-1001345');
  const cat = H.keyFacts(arnab).find(f => f.key === 'category');
  assert.equal(cat.label, 'IMD class');
  assert.equal(cat.value, 'Extremely Severe Cyclonic Storm');
  assert.equal(H.cycloneClass(130, 16.6, 151.3).value, 'Super typhoon');
  assert.equal(H.cycloneClass(120, 25, -70).value, 'Category 4');
  assert.equal(H.cycloneClass(120, 15, -110).scale, 'Saffir-Simpson category');
  assert.equal(H.cycloneAuthority(arnab).short, 'IMD');
  const r = await renderPage('alert-detail.html', { url: '/alerts/gdacs-TC-1001345', feed: FEED,
    waitFor: d => d.getElementById('title').textContent !== 'Loading alert…' });
  const t = text(r.document);
  assert.doesNotMatch(t, /Category 4/);
  assert.match(t, /Extremely Severe Cyclonic Storm/);
  const imd = r.document.getElementById('authorityLink');
  assert.ok(imd && imd.href === 'https://mausam.imd.gov.in/', 'no IMD link on an Indian Ocean storm');
  // 37 hours quiet is not live, and the page says how long.
  assert.match(r.document.getElementById('state').textContent, /^Not updated for 37 hours$/);
  r.close();
});

test('B2: the warnings lists say why GDACS cyclone levels are not on them', async () => {
  for (const page of ['official-warnings.html', 'alerts-notifications.html']) {
    const r = await renderPage(page, { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
    const n = r.document.getElementById('gdacsNote');
    assert.ok(n, page + ' has no GDACS note');
    assert.match(n.textContent, /GDACS red and orange levels/);
    assert.ok(n.querySelector('a[href="/alerts"]'));
    r.close();
  }
});

/* ------------------------------------------------------------------ B3 */

test('B3: Alerts counts official warnings only and calls the list reports', async () => {
  const r = await renderPage('alerts.html', { feed: FEED, waitFor: d => d.getElementById('kOfficial').textContent !== '-' });
  const d = r.document;
  const warnings = FEED.events.filter(e => e.live !== false && e.evidenceState === 'official-warning' && !e.forecast).length;
  assert.equal(d.getElementById('kOfficial').textContent, String(warnings));
  assert.match(text(d), /REPORTED EVENTS AND OFFICIAL ALERTS/);
  assert.match(text(d), /Latest reports/);
  assert.doesNotMatch(text(d), /Current official alerts/);
  assert.match(text(d), /RED OR ORANGE ALERTS/);
  r.close();
});

test('B3: a volcano at ADVISORY and an NWS watch are labelled as what they are', async () => {
  const r = await renderPage('event-detail.html', { url: '/disasters/usgs-volcano-332010', feed: FEED,
    waitFor: d => d.getElementById('kMode').textContent !== '-' });
  assert.equal(r.document.getElementById('eyebrow').textContent, 'OFFICIAL ADVISORY');
  assert.match(r.document.getElementById('aWho').textContent, /issuing an official advisory/);
  assert.doesNotMatch(text(r.document), /OFFICIAL WARNING|issuing an official warning/);
  r.close();
  const w = await renderPage('event-detail.html', { search: '?id=usgs-us7000tu2j', feed: FEED, waitFor: d => d.getElementById('kMode').textContent !== '-' });
  assert.equal(w.document.getElementById('eyebrow').textContent, 'REPORTED EVENT');
  const P = w.window.PND;
  assert.equal(P.provenance({ evidenceState: 'official-warning', officialProduct: 'watch' }), 'OFFICIAL WATCH');
  assert.equal(P.provenance({ evidenceState: 'official-warning', officialProduct: 'warning' }), 'OFFICIAL WARNING');
  w.close();
  // A watch ranks below a warning of the same severity.
  assert.ok(H.severityRank({ alert: 'Yellow' }) < H.severityRank({ alert: 'Orange' }));
});

/* ------------------------------------------------------------------ B4 */

test('B4: a small offshore quake gets no generic needs list, and says no damage was reported', async () => {
  const r = await renderPage('event-detail.html', { url: '/disasters/usgs-us7000tu2j', feed: FEED,
    waitFor: d => d.getElementById('kMode').textContent !== '-' });
  const d = r.document;
  assert.match(d.getElementById('actionSteps').textContent, /No damage reported by the source/);
  assert.doesNotMatch(d.getElementById('actionSteps').textContent, /Search and rescue/);
  assert.equal(d.getElementById('contextPanel').hidden, true);
  assert.equal(d.getElementById('lifeSafety').hidden, true);
  assert.equal(d.getElementById('actionHead').textContent, 'What this report says');
  const P = r.window.PND;
  assert.equal(P.lifeSafety({ evidenceState: 'official-warning', officialProduct: 'warning' }), true);
  assert.equal(P.lifeSafety({ deaths: 3 }), true);
  assert.equal(P.lifeSafety({ severity: 'Informational' }), false);
  r.close();
});

/* ------------------------------------------------------------------ B5 */

test('B5: no basin code or observatory name in a detail page\'s place fields', async () => {
  for (const [id, bad, want] of [['nhc-ep222026', /system 2/, /Eastern Pacific Ocean/], ['usgs-volcano-332010', /Volcano Observatory/, /Hawaii/],
    ['gdacs-TC-1001343', /WHERE\s*Marshall Islands/, /may affect Marshall Islands/]]) {
    const r = await renderPage('event-detail.html', { url: '/disasters/' + id, feed: FEED, waitFor: d => d.getElementById('kMode').textContent !== '-' });
    const where = r.document.getElementById('aWhere').textContent + ' | ' + r.document.getElementById('locationText').textContent;
    assert.doesNotMatch(where, bad, id + ': ' + where);
    assert.match(where, want, id + ': ' + where);
    r.close();
  }
});

/* ------------------------------------------------------------------ B6 */

test('B6: one aftershock forecast per merged quake', () => {
  const src = read('api/events.js');
  assert.match(src, /const ids = quakeIdentity\(e\);\s*\n\s*if \(ids\.some\(x => seenQuake\.has\(x\)\)\) continue;/);
});

/* ------------------------------------------------------------------ B7 */

test('B7: every card and related row is a link a keyboard can reach', async () => {
  const a = await renderPage('alerts.html', { feed: FEED, waitFor: d => d.querySelector('#alerts a.al') });
  assert.equal(a.document.querySelectorAll('#alerts article').length, 0);
  assert.ok([...a.document.querySelectorAll('#alerts a.al')].every(x => /^\/disasters\//.test(x.getAttribute('href'))));
  a.close();
  const c = await renderPage('calamities.html', { feed: FEED, waitFor: d => d.querySelector('#ongoing a.cal') });
  assert.equal(c.document.querySelectorAll('#ongoing article, [onclick*="location"]').length, 0);
  assert.ok(c.document.querySelectorAll('#timeline a.hist[href^="/history/"]').length >= 36);
  assert.equal(c.document.querySelectorAll('.coverage span[onclick]').length, 0, 'country chips are not buttons');
  c.close();
  const e = await renderPage('event-detail.html', { url: '/disasters/usgs-us6000u4r9', feed: FEED, waitFor: d => d.querySelector('#related a, #related .card') });
  assert.equal(e.document.querySelectorAll('#related article').length, 0);
  e.close();
  // The map's country names are labels, not tab stops.
  assert.match(read('map-setup.js'), /interactive: false, keyboard: false, pane: labelPane\(map\)/);
});

/* ------------------------------------------------------------------ B8 */

test('B8: history slugs fold accents, and the old slugs still open', async () => {
  for (const p of ['/history/tohoku-earthquake-and-tsunami', '/history/turkiye-syria-earthquakes', '/history/t-hoku-earthquake-and-tsunami', '/history/great-kant-earthquake']) {
    const r = await renderPage('historical-event-detail.html', { url: p, feed: FEED, waitFor: d => d.getElementById('title').textContent !== 'Past disaster' });
    assert.notEqual(r.document.getElementById('title').textContent, 'Past disaster not found', p);
    const canon = r.document.querySelector('link[rel="canonical"]').href;
    assert.match(canon, /\/history\/(tohoku-earthquake-and-tsunami|turkiye-syria-earthquakes|great-kanto-earthquake)$/, p + ' ' + canon);
    r.close();
  }
  const v = JSON.parse(read('vercel.json'));
  assert.ok(v.redirects.some(x => x.source === '/history/t-hoku-earthquake-and-tsunami' && x.destination === '/history/tohoku-earthquake-and-tsunami' && x.permanent));
});

test('B8: the sitemap lists every history page, and /historical-events is titled for what it shows', async () => {
  const s = read('sitemap.xml');
  const n = (s.match(/\/history\/[a-z0-9-]+<\/loc>/g) || []).length;
  assert.equal(n, historyList().length);
  assert.match(s, /\/history\/tohoku-earthquake-and-tsunami</);
  const r = await renderPage('historical-events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  assert.equal(r.document.getElementById('pageTitle').textContent, 'Recently ended events');
  const cards = [...r.document.querySelectorAll('#cards a.event-card')];
  const ended = FEED.events.filter(e => e.live === false && !e.forecast).length;
  assert.ok(cards.length > 0 && cards.length <= ended, cards.length + ' of ' + ended);
  assert.ok(r.document.querySelector('#historyNote a[href="/calamities?tab=history"]'));
  r.close();
});

/* ----------------------------------------------------------------- B9 */

test('B9: detail pages offer "Copy link", announced to screen readers, and name the canonical address', async () => {
  const r = await renderPage('alert-detail.html', { url: '/alerts/usgs-volcano-311120', feed: FEED,
    waitFor: d => d.getElementById('title').textContent !== 'Loading alert…',
    beforeParse(w) { w.navigator.clipboard = { writeText: async v => { w.__copied = v; } }; } });
  const d = r.document;
  const b = d.querySelector('[data-copy-link]');
  assert.ok(b, 'no copy link button');
  const toast = d.getElementById('copyToast');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.getAttribute('aria-live'), 'polite');
  b.click();
  await new Promise(res => setTimeout(res, 50));
  assert.equal(r.window.__copied, 'https://predict-natural-disasters.anchit-tandon.com/disasters/usgs-volcano-311120');
  assert.equal(toast.textContent, 'Link copied');
  assert.equal(d.querySelector('link[rel="canonical"]').href, 'https://predict-natural-disasters.anchit-tandon.com/disasters/usgs-volcano-311120');
  r.close();
});

async function mw() { return import(path.join(ROOT, 'middleware.js')); }
function fakeFetch(map) {
  return async url => {
    const u = new URL(url);
    const key = Object.keys(map).find(k => u.pathname === k);
    if (!key) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    const v = map[key];
    if (v === 'hang') return new Promise(() => {});
    if (v instanceof Error) throw v;
    return { ok: true, status: 200, text: async () => (typeof v === 'string' ? v : JSON.stringify(v)), json: async () => v };
  };
}
const req = (p, ua) => new Request('https://predict-natural-disasters.anchit-tandon.com' + p, { headers: { 'user-agent': ua || 'LinkedInBot/1.0 (compatible; Mozilla/5.0)' } });

test('B9: the middleware writes a record\'s own title, description, og tags and canonical into the page', async () => {
  const M = await mw();
  assert.deepEqual(M.config.matcher, ['/disasters/:id*', '/alerts/:id*', '/calamities/:id*', '/history/:slug*']);
  const pages = { '/event-detail': read('event-detail.html'), '/alert-detail': read('alert-detail.html'), '/calamity-detail': read('calamity-detail.html'),
    '/historical-event-detail': read('historical-event-detail.html'), '/history-data.js': read('history-data.js'), '/api/events': FEED };
  const res = await M.handle(req('/alerts/gdacs-TC-1001345'), { fetch: fakeFetch(pages) });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Tropical Cyclone Arnab \| Predict Natural Disasters<\/title>/);
  assert.match(html, /<meta property="og:title" content="Tropical Cyclone Arnab \| Predict Natural Disasters">/);
  assert.match(html, /<meta property="og:description" content="Reported event: Tropical Cyclone in [^"]+Source: GDACS, updated 28 Oct 2026\.[^"]*">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/predict-natural-disasters\.anchit-tandon\.com\/disasters\/gdacs-TC-1001345">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/predict-natural-disasters\.anchit-tandon\.com\/disasters\/gdacs-TC-1001345">/);
  assert.doesNotMatch(html, /Alert details \| Predict/);
  assert.match(html, /<script>nav\.innerHTML=PND\.nav\('Alerts'\);/, 'the page itself was changed');
  // History, for everyone: no bot needed, and escaping holds.
  const h = await M.handle(req('/history/tohoku-earthquake-and-tsunami', 'Mozilla/5.0 Chrome/130'), { fetch: fakeFetch(pages) });
  assert.equal(h.status, 200);
  const hh = await h.text();
  assert.match(hh, /<title>Tōhoku earthquake and tsunami \| Predict Natural Disasters<\/title>/);
  assert.match(hh, /<meta name="description" content="Tōhoku earthquake and tsunami, 11 Mar 2011, Japan\. Deaths: about 18,500\./);
  // An old slug is moved to the new one.
  const old = await M.handle(req('/history/t-hoku-earthquake-and-tsunami'), { fetch: fakeFetch(pages) });
  assert.equal(old.status, 301);
  assert.equal(old.headers.get('location'), '/history/tohoku-earthquake-and-tsunami');
  // An id with markup in it is escaped, not injected.
  const meta = M.eventMeta({ id: 'x', title: '<script>alert(1)</script>', type: 'Flood' });
  assert.doesNotMatch(M.injectMeta(read('event-detail.html'), meta), /<title><script>/);
});

test('B9/B20: an unknown id is noindex and 404; any failure leaves the static page alone', async () => {
  const M = await mw();
  const pages = { '/event-detail': read('event-detail.html'), '/historical-event-detail': read('historical-event-detail.html'),
    '/history-data.js': read('history-data.js'), '/api/events': FEED };
  const miss = await M.handle(req('/disasters/bogus-123'), { fetch: fakeFetch(pages) });
  assert.equal(miss.status, 404);
  assert.match(await miss.text(), /<meta name="robots" content="noindex">/);
  const hmiss = await M.handle(req('/history/bogus-event-xyz'), { fetch: fakeFetch(pages) });
  assert.equal(hmiss.status, 404);
  // A feed that fails, hangs past the timeout or answers nonsense: carry on unchanged.
  assert.equal(await M.handle(req('/disasters/usgs-us7000tu2j'), { fetch: fakeFetch(Object.assign({}, pages, { '/api/events': new Error('down') })) }), undefined);
  assert.equal(await M.handle(req('/disasters/usgs-us7000tu2j'), { fetch: fakeFetch(Object.assign({}, pages, { '/api/events': { nope: 1 } })) }), undefined);
  const t0 = Date.now();
  assert.equal(await M.handle(req('/disasters/usgs-us7000tu2j'), { fetch: (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('aborted'))); }) }), undefined);
  assert.ok(Date.now() - t0 < M.FEED_TIMEOUT_MS + 1000);
  // A template without the tags is served as it is.
  assert.equal(await M.handle(req('/disasters/usgs-us7000tu2j'), { fetch: fakeFetch(Object.assign({}, pages, { '/event-detail': '<html>no head</html>' })) }), undefined);
  // A reader's own browser is not slowed by the feed lookup; its own fetch is never re-handled.
  assert.equal(await M.handle(req('/disasters/usgs-us7000tu2j', 'Mozilla/5.0 (iPhone) Safari/604.1'), { fetch: () => { throw new Error('should not fetch'); } }), undefined);
  assert.equal(await M.handle(new Request('https://x.example/disasters/a', { headers: { 'x-pnd-share-preview': '1', 'user-agent': 'LinkedInBot' } }), { fetch: () => { throw new Error('loop'); } }), undefined);
  assert.equal(await M.handle(req('/disasters/'), { fetch: fakeFetch(pages) }), undefined);
  // A merged-away copy still finds the record it is part of.
  assert.equal(M.findEvent(FEED.events, 'gdacs-EQ-1573709').id, 'usgs-us6000u4r9');
  assert.equal(M.isPreviewBot('LinkedInBot/1.0'), true);
  assert.equal(M.isPreviewBot('Mozilla/5.0 (Macintosh) Chrome/130'), false);
});

/* ----------------------------------------------------------------- B10 */

test('B10: list pages reserve their space before the feed arrives', () => {
  for (const f of ['events.html', 'recent-events.html', 'historical-events.html', 'official-warnings.html', 'alerts-notifications.html']) {
    assert.match(read(f), /<div id="cards" class="event-grid skeleton-host" aria-busy="true">(<div class="event-card skeleton" aria-hidden="true"><\/div>){6}<\/div>/, f);
  }
  assert.match(read('alerts.html'), /<div id="alerts" class="alertGrid">(<div class="al skeleton" aria-hidden="true"><\/div>){6}/);
  assert.match(read('calamities.html'), /<div id="ongoing" class="ongoing skeleton-host">(<div class="cal skeleton" aria-hidden="true"><\/div>){6}/);
  assert.match(read('portal.css'), /\.trust-when\{min-height:2\.6em\}/);
});

/* ------------------------------------------------------------ B11, B12 */

test('B11: the benchmark and stale records are not "happening now"', async () => {
  const r = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const t = text(r.document);
  assert.doesNotMatch(t, /Central Vietnam flash-flood/);
  assert.doesNotMatch(t, /TEST CASE|Test case, not made in advance/i);
  assert.doesNotMatch(t, /Tropical Cyclone Arnab/, 'a storm 37 h quiet is listed as happening now');
  r.close();
  // The forecast list still shows it, labelled.
  const f = await renderPage('forecast-list.html', { feed: FEED, waitFor: d => /Central Vietnam|No forecasts/.test(d.body.textContent) });
  assert.match(text(f.document), /Central Vietnam/);
  f.close();
});

test('B12: ages over two months read as months or years, and no card says "U.s."', async () => {
  const r = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const P = r.window.PND;
  const ago = d => new Date(Date.now() - d * 864e5).toISOString();
  assert.equal(P.age(ago(40)), '40 d ago');
  assert.equal(P.age(ago(1500)), '4 years ago');
  assert.equal(P.age(ago(120)), '4 months ago');
  assert.doesNotMatch(text(r.document), /U\.s\./);
  r.close();
});

/* ----------------------------------------------------------------- B13 */

test('B13: a source that is down is said in words, never as its raw error', async () => {
  const r = await renderPage('calamities.html', { feed: FEED, waitFor: d => /RELIEFWEB/.test(d.getElementById('sourceHealth').textContent) });
  const t = r.document.getElementById('sourceHealth').textContent;
  assert.match(t, /ReliefWeb is not answering right now/);
  assert.doesNotMatch(t, /<item>|no <item|rss\.xml|RELIEFWEB_APPNAME/);
  r.close();
  const a = await renderPage('alerts.html', { feed: FEED, waitFor: d => /RELIEFWEB/.test(d.getElementById('sources').textContent) });
  assert.match(a.document.getElementById('sources').textContent, /ReliefWeb is not answering right now/);
  a.close();
});

/* ----------------------------------------------------------------- B14 */

test('B14: every history entry is dated, sourced and graded on a defined scale', () => {
  const list = historyList();
  assert.ok(list.length >= 36);
  for (const e of list) {
    assert.ok(e.date || /BCE/.test(e.year), e.name + ' has no date');
    assert.ok(/^https:\/\//.test(e.sourceUrl) && e.source, e.name + ' has no source');
    assert.ok('deaths' in e, e.name);
    assert.ok(['Catastrophic', 'Major'].includes(e.severity), e.name);
    assert.doesNotMatch(String(e.deaths || ''), /^0$/, e.name + ' invents a zero');
  }
  const named = n => list.find(e => e.name === n);
  assert.equal(named('Australian Black Summer').year, '2019 to 2020');
  assert.equal(named('Cyclone Nargis').type, 'Tropical Cyclone');
  assert.equal(named('Bhola cyclone').location, 'East Pakistan (now Bangladesh)');
  assert.doesNotMatch(named('Tangshan earthquake').summary, /struck a city/);
  for (const n of ['Gujarat (Bhuj) earthquake', 'Odisha super cyclone', 'Uttarakhand floods', 'Kerala floods']) assert.ok(named(n), n);
  assert.match(read('history-data.js'), /PND_HISTORY_SEVERITY=\{"Catastrophic":"A commonly cited toll of 10,000 deaths or more/);
});

/* ----------------------------------------------------------------- B15 */

test('B15: list card text is at least 12px', () => {
  const css = read('portal.css');
  assert.match(css, /\.event-card p,\.al p,\.cal p,\.related a p\{font-size:13px\}/);
  assert.match(css, /\.event-card \.risk,\.event-card \.source,\.event-card \.prov,[^{]*\{font-size:12px\}/);
});

/* ----------------------------------------------------------------- B16 */

test('B16: sorts that need a figure no record has are hidden, and Place sorts by country', async () => {
  const r = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const sel = r.document.getElementById('sortBy');
  const opt = v => [...sel.options].find(o => o.value === v);
  const anyDeaths = FEED.events.some(e => e.live !== false && Number(e.deaths) > 0);
  assert.equal(opt('deaths').hidden, !anyDeaths);
  const P = r.window.PND;
  const a = { countries: ['Philippines'], place: '1 km WSW of Butulan, Philippines' };
  const b = { countries: ['Argentina'], place: '10 km N of Esperanza, Argentina' };
  assert.ok(P.SORT_DEFS.country.cmp(b, a) < 0, 'Argentina sorts before the Philippines');
  r.close();
});

/* ----------------------------------------------------------------- B17 */

test('B17: "Turkey" finds Türkiye, and accents are optional', async () => {
  const r = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const S = r.window.PNDSearch;
  assert.equal(S.matches({ country: 'Türkiye' }, 'turkey'), true);
  assert.equal(S.matches({ country: 'Türkiye' }, 'turkiye'), true);
  assert.equal(S.matches({ country: 'Myanmar' }, 'burma'), true);
  assert.equal(S.matches({ country: 'Japan' }, 'turkey'), false);
  r.close();
});

/* ----------------------------------------------------------------- B18 */

test('B18: the calamities tabs are a tab list the address remembers', async () => {
  const r = await renderPage('calamities.html', { url: '/calamities?tab=history', feed: FEED, waitFor: d => d.querySelector('#timeline a.hist') });
  const d = r.document;
  assert.equal(d.querySelector('.tabs').getAttribute('role'), 'tablist');
  const [cur, hist] = d.querySelectorAll('[role="tab"]');
  assert.equal(hist.getAttribute('aria-selected'), 'true');
  assert.equal(cur.getAttribute('aria-selected'), 'false');
  assert.equal(d.getElementById('historyPane').style.display, 'block');
  cur.click();
  assert.equal(r.window.location.search, '');
  hist.dispatchEvent(new r.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(cur.getAttribute('aria-selected'), 'true');
  r.close();
});

test('B18/B19: /events keeps its filters in the address and shows 40 cards at a time', async () => {
  const r = await renderPage('events.html', { url: '/events?type=Earthquake&sort=severity', feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const d = r.document;
  assert.equal(d.getElementById('type').value, 'Earthquake');
  assert.equal(d.getElementById('sortBy').value, 'severity');
  assert.ok([...d.querySelectorAll('#cards a.event-card h3')].length <= 40);
  const level = d.getElementById('level');
  level.value = level.options[1].value; level.onchange();
  assert.match(r.window.location.search, /level=/);
  assert.match(r.window.location.search, /type=Earthquake/);
  r.close();
  const all = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const n = all.document.querySelectorAll('#cards a.event-card').length;
  assert.ok(n <= 40, n + ' cards drawn at once');
  const more = all.document.getElementById('showMore');
  assert.ok(more, 'no "Show more" with ' + FEED.events.length + ' records');
  more.click();
  assert.ok(all.document.querySelectorAll('#cards a.event-card').length > n);
  all.close();
});

/* ----------------------------------------------------------------- B20 */

test('B20: a bogus id is a not-found page: noindex, no empty stat boxes, a way on', async () => {
  for (const [page, url] of [['event-detail.html', '/disasters/bogus-123'], ['alert-detail.html', '/alerts/bogus-123'], ['calamity-detail.html', '/calamities/bogus-123']]) {
    const r = await renderPage(page, { url, feed: FEED, waitFor: d => /not found/i.test(d.getElementById('title').textContent) });
    const d = r.document;
    assert.match(d.getElementById('title').textContent, /not found/i, page);
    assert.equal(d.querySelector('meta[name="robots"]').content, 'noindex', page);
    const box = d.querySelector('.kpiRow, .hero .stats');
    assert.ok(box && box.hidden, page + ' shows its empty stat boxes');
    assert.ok(d.querySelector('#subtitle a[href="/events"]'), page);
    r.close();
  }
  const h = await renderPage('historical-event-detail.html', { url: '/history/bogus-event-xyz', feed: FEED, waitFor: d => /not found/.test(d.getElementById('title').textContent) });
  assert.equal(h.document.getElementById('main').hidden, true);
  assert.equal(h.document.getElementById('heroStats').hidden, true);
  assert.equal(h.document.querySelector('meta[name="robots"]').content, 'noindex');
  h.close();
});

/* ----------------------------------------------------------------- B21 */

test('B21: Notifications links to the place alerts and says what is in force', async () => {
  const r = await renderPage('alerts-notifications.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const d = r.document;
  assert.ok(d.querySelector('a[href="/personal-risk#alerts"]'));
  assert.match(d.getElementById('heading').textContent, /^In force now \(\d+\)$/);
  assert.notEqual(d.getElementById('heading').textContent, d.getElementById('pageTitle').textContent);
  r.close();
});

/* ---------------------------------------------------- B23, B24, B26, B28 */

test('B23/B24/B26/B28: glossary, dates and the source\'s own level', async () => {
  const r = await renderPage('events.html', { feed: FEED, waitFor: d => !d.querySelector('#cards .skeleton') });
  const w = r.window, P = w.PND;
  assert.doesNotMatch(P.fmtDate('2026-09-13T10:00:00Z'), /Sept/);
  assert.equal(P.fmtOf({ datePrecision: 'day', updated: '2026-10-28T00:00:00.000Z' }), '28 Oct 2026');
  assert.match(P.fmtOf({ updated: '2026-10-28T06:00:00.000Z' }), /\d:\d\d [AP]M/);
  assert.equal(P.tzMenuLabel('Asia/Kolkata'), 'India (IST)');
  assert.equal(P.tzLabel('Asia/Calcutta'), 'IST');
  const badge = P.sourceBadge({ source: 'GDACS', alert: 'Green', alertBasis: 'issued' });
  assert.match(badge, />GDACS: Green</);
  assert.doesNotMatch(P.sourceBadge({ source: 'USGS', alert: 'Green' }), /: Green/);
  assert.equal(P.eventUrl({ id: 'x', sourceType: 'official', alert: 'Red' }), '/disasters/x');
  const g = w.__pndGlossary;
  if (g && g.rewrite) assert.doesNotMatch(g.rewrite('U.S. Geological Survey (USGS) earthquake.usgs.gov'), /\(United States Geological Survey\)/);
  r.close();
  assert.match(read('glossary.js'), /introducedBefore\(whole\.slice/);
});

/* ----------------------------------------------------------------- B29 */

test('B29: three or more GDACS wildfires in one country and week are one card', async () => {
  const f = JSON.parse(JSON.stringify(FEED));
  const base = f.events.find(e => e.id === 'gdacs-WF-1033272');
  for (let i = 0; i < 4; i++) f.events.push(Object.assign({}, base, { id: 'gdacs-WF-x' + i }));
  const n = f.events.filter(e => e.type === 'Wildfire' && /Botswana/.test(e.place || e.country)).length;
  assert.ok(n >= 5);
  const r = await renderPage('events.html', { url: '/events?type=Wildfire', feed: f, waitFor: d => !d.querySelector('#cards .skeleton') });
  const cards = [...r.document.querySelectorAll('#cards h3')].map(h => h.textContent);
  assert.ok(cards.includes(n + ' wildfires in Botswana'), cards.join(' | '));
  assert.ok(!cards.includes('Forest fires in Botswana'));
  r.close();
  const open = await renderPage('events.html', { url: '/events?type=Wildfire&q=Botswana&group=0', feed: f, waitFor: d => !d.querySelector('#cards .skeleton') });
  assert.equal([...open.document.querySelectorAll('#cards a.event-card h3')].filter(h => /Forest fires in Botswana/.test(h.textContent)).length, n);
  open.close();
});

/* ----------------------------------------------------------------- B31 */

test('B31: the phone tab bar leaves the footer readable', () => {
  assert.match(read('portal.css'), /@media\(max-width:760px\)\{body\{padding-bottom:calc\(66px \+ env\(safe-area-inset-bottom\)\)\}\}/);
});

/* ----------------------------------------------------------------- B30 */

test('B30: a history page with no id goes to the timeline, and no table repeats the hero', () => {
  const src = read('historical-event-detail.html');
  assert.match(src, /if\(!key\)\{location\.replace\('\/calamities\?tab=history'\);\}/);
  assert.doesNotMatch(src, /<dt>Hazard type<\/dt>|<dt>Name<\/dt>/);
  assert.match(src, /sortBy\.hidden=relAll\.length<2/);
});
