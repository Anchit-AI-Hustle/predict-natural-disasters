'use strict';
/**
 * Ready to be shared.
 *
 * A full pass over the live site - every page at desktop and phone width,
 * every button, dropdown, search box and link - found what a stranger opening
 * a shared link would meet first: no preview picture and no tab icon, a risk
 * filter that emptied the Alerts list, three to thirteen seconds of dashes and
 * "Loading…", old home layouts still reachable and wider than a phone, and
 * links to relief organisations that had moved. Each is pinned here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const SITE = 'https://predict-natural-disasters.anchit-tandon.com';

/* ------------------------------------------------------ the shared link */

test('every page gives a shared link a picture, and the picture exists', () => {
  const png = fs.readFileSync(path.join(ROOT, 'og-image.png'));
  assert.equal(png.slice(1, 4).toString(), 'PNG', 'og-image.png is not a PNG');
  assert.equal(png.readUInt32BE(16), 1200, 'the preview is not 1200 wide');
  assert.equal(png.readUInt32BE(20), 630, 'the preview is not 630 high');
  const missing = [];
  for (const f of PAGES) {
    const head = read(f).split('</head>')[0];
    for (const [what, re] of [
      ['og:image', new RegExp('<meta property="og:image" content="' + SITE + '/og-image.png">')],
      ['og:image:alt', /<meta property="og:image:alt" content="[^"]{20,}">/],
      ['twitter:image', new RegExp('<meta name="twitter:image" content="' + SITE + '/og-image.png">')],
      ['twitter:card', /<meta name="twitter:card" content="summary_large_image">/],
      ['og:title', /<meta property="og:title" content="[^"]+">/],
      ['og:description', /<meta property="og:description" content="[^"]{40,}">/]
    ]) if (!re.test(head)) missing.push(f + ': no ' + what);
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('every page names an icon, and /favicon.ico is one', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico is not an icon file');
  const n = ico.readUInt16LE(4);
  assert.ok(n >= 2, 'favicon.ico holds ' + n + ' size(s)');
  for (let i = 0; i < n; i++) {
    const off = ico.readUInt32LE(6 + 16 * i + 12);
    assert.equal(ico.slice(off + 1, off + 4).toString(), 'PNG', 'entry ' + i + ' is not a PNG');
  }
  const missing = PAGES.filter(f => !/<link rel="icon" href="\/favicon\.ico"/.test(read(f).split('</head>')[0]));
  assert.deepEqual(missing, [], 'these pages name no icon: ' + missing.join(', '));
});

test('the homepage describes itself as what it is', () => {
  const head = read('index.html').split('</head>')[0];
  const og = (head.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '';
  assert.match(og, /as official agencies report them/);
  assert.match(og, /experimental forecasts/, 'the forecasts are not called experimental');
  assert.doesNotMatch(og, /every minute/, 'a refresh rate the feed does not keep is promised');
});

/* ------------------------------------------------------ the Alerts filter */

test('the risk filter on Alerts shows the alerts at that level, not none', async () => {
  /* It compared the provider's colour word ("Red", "Orange") with the
     scale's level keys, so every level but "All" showed an empty list -
     while "Most serious first" put an Extreme typhoon at the top. */
  const r = await renderPage('alerts.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#alerts article').length > 0 });
  const { document: d, window } = r;
  const PND = window.PND;
  const sel = d.getElementById('level');
  const levels = [...sel.options].map(o => o.value).filter(Boolean);
  assert.ok(levels.length >= 4, 'the filter offers ' + levels.length + ' levels');
  const all = [...d.querySelectorAll('#alerts article')].length;
  let shownSomewhere = 0;
  for (const lv of levels) {
    sel.value = lv;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    sel.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise(res => setTimeout(res, 20));
    const cards = [...d.querySelectorAll('#alerts article')];
    const badges = cards.map(c => (c.querySelector('.risk') || {}).textContent);
    if (cards.length) shownSomewhere++;
    const label = [...sel.options].find(o => o.value === lv).textContent.trim();
    /* A level that is an agency's impact estimate names the agency after
       the level (launch audit A6): "Moderate expected impact (GDACS orange)". */
    for (const b of badges) assert.ok(b.trim() === label || b.trim().startsWith(label + ' expected impact ('), 'filtered to ' + label + ' but a card reads ' + b);
    assert.ok(cards.length <= all);
  }
  assert.ok(shownSomewhere >= 1, 'no level shows a single alert');
  assert.equal(typeof PND.matchesRiskLevel, 'function');
  r.close();
});

/* ------------------------------------------------ what a page shows first */

/* The edge window was 30 s fresh plus 60 s stale, and these asserted that
   value. Launch audit E2 changed it on purpose: 60 s fresh, an hour stale
   while revalidating, a day stale on error (test/launch-hardening.test.js). */
test('the feed is shared at the edge for 60 seconds, never kept in a browser', async () => {
  const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
  const res = await callApi(eventsHandler, '/api/events');
  assert.match(res.headers.get('cache-control'), /no-store/, 'a browser may keep the feed');
  assert.equal(res.headers.get('vercel-cdn-cache-control'), 'max-age=60, stale-while-revalidate=3600, stale-if-error=86400');
  const d = await res.json();
  assert.match(d.meta.refreshTarget, /60 seconds/);
  assert.match(d.meta.refreshTarget, /show when it was made/, 'a page is not told that an older copy may be served');
});

/* Refresh used to add ?ts= and so go past the edge copy; launch audit E3
   made it re-read that copy instead, so a click no longer costs a fan-out
   to every provider. */
test('pages read the shared copy, and so does Refresh', async () => {
  const r = await renderPage('alerts.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#alerts article').length > 0 });
  const first = r.apiCalls.filter(u => u.includes('/api/events'));
  assert.ok(first.length >= 1);
  assert.ok(first.every(u => !/[?&]ts=/.test(u)), 'a page load skipped the shared copy: ' + first.join(', '));
  const before = r.apiCalls.length;
  r.document.getElementById('refresh').click();
  await new Promise(res => setTimeout(res, 100));
  const after = r.apiCalls.slice(before).filter(u => u.includes('/api/events'));
  assert.ok(after.length >= 1, 'Refresh fetched nothing');
  assert.equal(after[0], '/api/events', 'Refresh asked past the shared copy');
  r.close();
});

test('the homepage asks for the shared copy too', () => {
  const s = read('index.html');
  assert.match(s, /fetch\('\/api\/events'\)/);
  assert.doesNotMatch(s, /fetch\('\/api\/events\?ts='/);
});

test('the homepage tiles stop saying they are loading, whether the feed came or not', async () => {
  const html = read('index.html');
  assert.equal((html.match(/<strong id="k(?:Events|Warnings|Forecasts|Countries)" class="pending" aria-busy="true">-<\/strong>/g) || []).length, 4,
    'the tiles do not start out marked as loading');
  const ok = await renderPage('index.html', { timeoutMs: 8000,
    waitFor: d => d.getElementById('kEvents').textContent !== '-' });
  assert.equal(ok.document.querySelectorAll('.kpi strong.pending').length, 0, 'a tile still shows as loading after the feed came');
  assert.match(ok.document.getElementById('kEvents').textContent, /^\d+$/);
  ok.close();
  const down = await renderPage('index.html', { feedDown: true, timeoutMs: 3000 });
  assert.equal(down.document.querySelectorAll('.kpi strong.pending').length, 0, 'a tile shows as loading for ever when the feed is down');
  assert.equal(down.document.getElementById('kEvents').textContent, '-');
  down.close();
});

test('a count of events is a count of reports, the same on every page', async () => {
  /* Measured on the live site at one moment: the homepage and Regions read
     765 "live events" and Alerts 709 official reports. The 56 between them
     were our own forecasts, counted as events on one page and not on the
     other - and counted a second time in the homepage's forecast tile. */
  const { sampleEvents } = require('./render.js');
  const live = (await sampleEvents()).filter(e => e.live !== false);
  const reports = live.filter(e => !e.forecast).length;
  const forecasts = live.filter(e => e.forecast).length;
  assert.ok(forecasts > 0, 'the fixture feed needs forecasts for this to mean anything');
  const home = await renderPage('index.html', { timeoutMs: 8000,
    waitFor: d => /^\d+$/.test(d.getElementById('kEvents').textContent) });
  assert.equal(home.document.getElementById('kEvents').textContent, String(reports), 'the homepage counts forecasts as events');
  home.close();
  const regions = await renderPage('regions.html', { timeoutMs: 8000,
    waitFor: d => /^\d+$/.test(d.getElementById('kEvents').textContent) });
  assert.equal(regions.document.getElementById('kEvents').textContent, String(reports), 'Regions counts forecasts as events');
  /* And each place's card counts the same records as the headline above it. */
  const placesOf = e => (Array.isArray(e.countries) && e.countries.length ? e.countries : (e.sea ? [e.sea] : [String(e.country || '').trim()])).filter(Boolean);
  const perPlace = {};
  for (const e of live.filter(x => !x.forecast)) for (const n of placesOf(e)) perPlace[n] = (perPlace[n] || 0) + 1;
  const cards = [...regions.document.querySelectorAll('#regionGrid .reg')].map(c => [c.querySelector('h3').textContent, Number(c.querySelector('p b').textContent)]);
  assert.ok(cards.length > 0, 'Regions listed no places');
  for (const [name, n] of cards) assert.equal(n, perPlace[name], name + ' shows ' + n + ' current events; its reports number ' + perPlace[name]);
  const forecastOnly = [...new Set(live.filter(x => x.forecast).flatMap(placesOf))].filter(n => !perPlace[n]);
  for (const n of forecastOnly) assert.ok(!cards.some(c => c[0] === n), n + ' has only forecasts but is listed with current events');
  regions.close();
  const list = await renderPage('events.html', { timeoutMs: 8000,
    waitFor: d => /updated/.test(d.getElementById('statusLine').textContent) });
  const line = list.document.getElementById('statusLine').textContent;
  list.close();
  assert.match(line, new RegExp('\\b' + reports + ' events? · ' + forecasts + ' forecasts?\\b'),
    'the events list does not say how many are forecasts: ' + line);
});

/* ------------------------------------------------------- what is left over */

test('the old home layouts send a visitor to the homepage', () => {
  const cfg = JSON.parse(read('vercel.json'));
  for (const page of ['home', 'home-v2', 'home-v3']) {
    for (const src of ['/' + page, '/' + page + '.html']) {
      const r = (cfg.redirects || []).find(x => x.source === src);
      assert.ok(r, src + ' is still served');
      assert.equal(r.destination, '/');
      assert.equal(r.permanent, true, src + ' is not a permanent move');
    }
  }
});

test('the map’s layer menu keeps "NASA" short, and prose still spells it out', async () => {
  /* The glossary wrote the menu's "NASA today" out in full, which made the
     menu wider than a phone's map, and a change inside a map control set off
     a full pass over the page inside the click that caused it. */
  const { JSDOM } = require('jsdom');
  const src = read('glossary.js');
  const dom = new JSDOM('<main><div class="leaflet-control-layers"><label><span>NASA today (28 Sep 2026)</span></label></div>' +
    '<p>The picture comes from NASA.</p></main>', { runScripts: 'outside-only' });
  dom.window.eval(src);
  await new Promise(r => setTimeout(r, 50));
  const d = dom.window.document;
  assert.equal(d.querySelector('.leaflet-control-layers').textContent, 'NASA today (28 Sep 2026)');
  assert.match(d.querySelector('p').textContent, /National Aeronautics and Space Administration \(NASA\)/);
  /* Text added inside a control later is left alone as well. */
  const extra = d.createElement('span'); extra.textContent = ' NASA GIBS';
  d.querySelector('.leaflet-control-layers label').appendChild(extra);
  await new Promise(r => setTimeout(r, 50));
  assert.doesNotMatch(d.querySelector('.leaflet-control-layers').textContent, /Aeronautics/);
  dom.window.close();
});

test('the glow on a hero card sits behind its text', () => {
  const css = read('app-pages.css');
  assert.match(css, /\.hero-card:after\{[^}]*pointer-events:none/);
  assert.match(css, /\.hero-card>\*\{position:relative;z-index:1\}/,
    'the positioned glow paints over the heading beneath it');
});

test('Enter in the My places search box searches', async () => {
  const r = await renderPage('personal-risk.html', { timeoutMs: 6000 });
  const d = r.document, w = r.window;
  const before = d.getElementById('placeResult').textContent;
  let submitted = false;
  d.getElementById('f').addEventListener('submit', () => { submitted = true; });
  const box = d.getElementById('placeName');
  box.value = 'Mumbai';
  box.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await new Promise(res => setTimeout(res, 50));
  assert.equal(submitted, false, 'Enter submitted the save form');
  assert.notEqual(d.getElementById('placeResult').textContent, before, 'Enter did nothing a visitor could see');
  r.close();
});

test('no relief or authority link is one that answered 404', () => {
  /* Measured from a browser on 29 September 2026: each of these returned
     404 Not Found. A 403 or a timeout was not counted, because many of these
     sites refuse any automated visitor and that says nothing about the page. */
  const DEAD = [
    'https://mausam.imd.gov.in/responsive/contactus.php',
    'https://nrcs.org/donate/',
    'https://redcross.org.ph/donate/',
    'https://teamrubiconusa.org/donate/',
    'https://weather.gc.ca/warnings/index_e.html',
    'https://www.argentina.gob.ar/seguridad/proteccioncivil',
    'https://www.brac.net/donate',
    'https://www.care-international.org/our-work/emergencies',
    'https://www.dwd.de/EN/weather/warnings_landingpage/warnings_node.html',
    'https://www.gov.ie/en/campaigns/be-winter-ready/',
    'https://www.msf.org/crisis-updates',
    'https://www.nvoad.org/voad-members/',
    'https://www.redcross.or.ke/donate',
    'https://www.redcross.sg/donate.html'
  ];
  const src = read('api/_lib/verified-support.js');
  const still = DEAD.filter(u => src.includes("'" + u + "'"));
  assert.deepEqual(still, [], 'still linked: ' + still.join(', '));
});
