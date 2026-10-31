'use strict';
/**
 * The function and data-accuracy audit of 20 Oct 2026 (findings P1 to P18),
 * each held to what a reader sees on the rendered page.
 *
 * Measured on the production feed, the site told a reader there was nothing
 * happening in Asia, Europe, the Americas or Oceania; that 17 Extreme Heat
 * forecasts were extreme cold; that 17 official warnings were 338; that a
 * forecast graded "partly correct" was not yet checked; and that a record
 * quiet for 48 days was live. Each test below names the finding it guards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = require(path.join(ROOT, 'continents.js'));
const H = require(path.join(ROOT, 'hazard-model.js'));
const filled = id => d => { const el = d.getElementById(id); return el && el.textContent && el.textContent !== '-' && !/Loading/.test(el.textContent); };
const live = async () => (await sampleEvents()).filter(e => e.live !== false);
const observed = async () => (await live()).filter(e => !e.forecast);

/* ------------------------------------------------------------------ P1 */

test('P1: a continent is the countries on it', () => {
  assert.deepEqual(C.continentsOf({ country: 'Japan' }), ['Asia']);
  assert.deepEqual(C.continentsOf({ countries: ['Guam', 'Japan'] }).sort(), ['Asia', 'Oceania']);
  assert.deepEqual(C.continentsOf({ country: 'United States of America' }), ['North America']);
  assert.deepEqual(C.continentsOf({ country: 'New Zealand region' }), ['Oceania']);
  // A record at sea names no country and is on no continent.
  assert.deepEqual(C.continentsOf({ country: 'Central Mid-Atlantic Ridge' }), []);
  assert.equal(C.continentNamed('north america'), 'North America');
  assert.equal(C.continentNamed('Nepal'), '');
});

test('P1: every continent the home page links to shows its events, not a false all-clear', async () => {
  const obs = await observed();
  for (const name of ['Asia', 'Europe', 'Africa', 'North America', 'South America']) {
    const want = obs.filter(e => C.onContinent(e, name)).length;
    assert.ok(want > 0, 'the fixture feed has nothing on ' + name);
    const r = await renderPage('region-detail.html', { url: '/regions/' + encodeURIComponent(name), search: '', waitFor: filled('kEvents') });
    const d = r.document;
    assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
    assert.equal(d.getElementById('kEvents').textContent, String(want), name + ' events');
    assert.doesNotMatch(d.getElementById('events').textContent, /No current events here/, name);
    assert.match(d.title, new RegExp(name));
    r.close();
  }
});

/* ------------------------------------------------------------------ P2 */

test('P2: a hazard page shows that hazard, matched whole', async () => {
  const obs = await observed();
  for (const [asked, shown] of [['Extreme Heat', 'Extreme Heat'], ['Volcanic Eruption', 'Volcano'], ['Extreme Cold', 'Extreme Cold']]) {
    const r = await renderPage('hazard-detail.html', { search: '?type=' + encodeURIComponent(asked), waitFor: filled('kEvents') });
    const d = r.document;
    assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
    assert.equal(d.getElementById('hazSel').value, shown, asked + ' fell back to another hazard');
    assert.doesNotMatch(d.getElementById('title').textContent, /Flood/, asked + ' rendered the Flood page');
    const want = obs.filter(e => H.hazardOf(e.type) === H.hazardOf(shown)).length;
    assert.equal(d.getElementById('kEvents').textContent, String(want), asked);
    // Extreme Cold must not list Extreme Heat.
    if (asked === 'Extreme Cold') assert.doesNotMatch(d.getElementById('events').textContent, /heat/i);
    r.close();
  }
});

test('P2/P11: the home strip counts reports only, so no forecast is labelled observed', async () => {
  const obs = await observed();
  const r = await renderPage('index.html', { waitFor: d => d.getElementById('hazardStrip').children.length > 0 });
  const chips = [...r.document.getElementById('hazardStrip').children];
  const quake = chips.find(c => /Earthquake/.test(c.querySelector('b').textContent) && !/aftershock/i.test(c.textContent));
  assert.ok(quake, 'no earthquake chip');
  assert.equal(Number(quake.querySelector('span').textContent.replace(/\D+/g, '')), obs.filter(e => e.type === 'Earthquake').length);
  assert.ok(!chips.some(c => /aftershock/i.test(c.textContent)), 'an aftershock forecast reached the live events strip');
  r.close();
});

/* ------------------------------------------------------------------ P3 */

test('P3: one definition of an official warning on the tile and the pages it opens', async () => {
  const want = (await live()).filter(e => e.evidenceState === 'official-warning').length;
  assert.ok(want > 0);
  const home = await renderPage('index.html', { waitFor: filled('kWarnings') });
  assert.equal(home.document.getElementById('kWarnings').textContent, String(want));
  assert.match(home.document.querySelector('#kWarnings ~ .delta').textContent, /in force/);
  home.close();
  for (const page of ['official-warnings.html', 'alerts-notifications.html']) {
    const r = await renderPage(page, { waitFor: d => d.getElementById('cards').children.length > 0 });
    const cards = r.document.querySelectorAll('#cards .event-card').length;
    assert.equal(cards, want, page + ' lists a different set');
    assert.match(r.document.getElementById('statusLine').textContent, new RegExp('\\b' + want + ' '));
    assert.match(r.document.getElementById('pageSub').textContent, /already happened/);
    r.close();
  }
});

/* ------------------------------------------------------------------ P4 */

test('P4: searching My places with Enter keeps the place’s country', async () => {
  const hit = [{ lat: '27.8', lon: '66.6', name: 'Khuzdar', addresstype: 'city', display_name: 'Khuzdar, Balochistan, Pakistan',
    address: { city: 'Khuzdar', state: 'Balochistan', country: 'Pakistan', country_code: 'pk' } }];
  const r = await renderPage('personal-risk.html', {
    waitFor: d => !!d.getElementById('placeName'),
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (u, o) => /nominatim/.test(String(u))
        ? { ok: true, status: 200, headers: { get: () => null }, json: async () => hit, text: async () => JSON.stringify(hit) }
        : real(u, o);
    }
  });
  const { document: d, window: w } = r;
  const box = d.getElementById('placeName');
  box.focus();
  box.value = 'Khuzdar';
  box.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  for (let i = 0; i < 50 && !/Chosen/.test(d.getElementById('placeResult').textContent); i++) await new Promise(res => setTimeout(res, 20));
  assert.match(d.getElementById('placeResult').textContent, /Chosen/);
  // Leaving the box fires "change" for the value the search put there.
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.doesNotMatch(d.getElementById('placeResult').textContent, /no longer know its country/);
  d.getElementById('f').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const saved = JSON.parse(w.localStorage.getItem('pnd_saved_locations') || '[]');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].country, 'Pakistan');
  r.close();
});

/* ------------------------------------------------------------------ P5 */

test('P5: a graded forecast shows its grade, not "not yet checked"', async () => {
  const r = await renderPage('forecast-detail.html', { search: '?id=ND-001', waitFor: d => /Checked/.test(d.getElementById('state').textContent), timeoutMs: 9000 });
  const d = r.document;
  assert.equal(d.getElementById('state').textContent, 'Checked: Partly correct');
  assert.match(d.getElementById('mxTimingWhy').textContent, /has been checked\. Result: Partly correct/);
  r.close();
});

/* ------------------------------------------------------------------ P6 */

test('P6: a record its provider stopped updating is not labelled live', async () => {
  const quiet = (await sampleEvents()).find(e => e.live === false);
  assert.ok(quiet, 'the fixture feed has no record marked live:false');
  const r = await renderPage('event-detail.html', { search: '?id=' + encodeURIComponent(quiet.id), waitFor: filled('kMode') });
  const d = r.document;
  assert.notEqual(d.getElementById('eyebrow').textContent, 'LIVE EVENT');
  assert.equal(d.getElementById('kMode').textContent, 'Not updated recently');
  assert.doesNotMatch(d.getElementById('recordState').textContent, /^Live/);
  r.close();
});

/* ------------------------------------------------------------------ P7 */

test('P7: every page says the live data is unavailable when the feed fails', async () => {
  for (const [page, search, sel] of [
    ['event-detail.html', '?id=usgs-us7000abcd', 'title'],
    ['forecast-detail.html', '?id=ND-001', 'title'],
    ['region-detail.html', '?region=Japan', 'kEvents'],
    ['hazard-detail.html', '?type=Flood', 'kEvents'],
    ['forecasts.html', '', 'changes'],
    ['live-map.html', '', 'statusLine'],
    ['alerts.html', '', 'alerts']
  ]) {
    const r = await renderPage(page, { search, feedDown: true, timeoutMs: 3000 });
    const t = r.document.getElementById(sel).textContent;
    assert.match(t, /unavailable/i, page + ' #' + sel + ' reads "' + t.slice(0, 80) + '"');
    assert.doesNotMatch(t, /Loading/, page);
    const h = r.document.getElementById('title');
    if (h) assert.doesNotMatch(h.textContent, /Loading/, page + ' heading still says it is loading');
    r.close();
  }
  const home = await renderPage('index.html', { feedDown: true, timeoutMs: 3000 });
  const d = home.document;
  assert.doesNotMatch(d.getElementById('forecastRows').textContent, /Loading/);
  assert.match(d.getElementById('forecastRows').textContent, /unavailable/i);
  assert.match(d.getElementById('kEventsNote').textContent, /unavailable/i);
  home.close();
});

/* ------------------------------------------------------------------ P8 */

test('P8: /events?region= lists only that region', async () => {
  const want = (await live()).filter(e => /Indonesia/.test([e.country].concat(e.countries || []).join(' '))).length;
  const r = await renderPage('events.html', { search: '?region=Indonesia', waitFor: d => d.getElementById('cards').children.length > 0 });
  const d = r.document;
  assert.equal(d.querySelectorAll('#cards .event-card').length, want);
  assert.match(d.getElementById('regionScope').textContent, /Showing only Indonesia/);
  r.close();
  const asia = await renderPage('events.html', { search: '?region=Asia', waitFor: d2 => d2.getElementById('cards').children.length > 0 });
  const inAsia = (await live()).filter(e => C.onContinent(e, 'Asia')).length;
  assert.equal(asia.document.querySelectorAll('#cards .event-card').length, inAsia);
  asia.close();
});

/* ------------------------------------------------------------------ P9 */

test('P9: the home "Live events" card lists reports only, in the order its own control sets', async () => {
  const byId = new Map((await live()).map(e => [String(e.id), e]));
  const r = await renderPage('index.html', { waitFor: d => d.getElementById('topEvents').children.length > 1 });
  const { document: d, window: w } = r;
  const ids = () => [...d.querySelectorAll('#topEvents .event')].map(x => x.dataset.id);
  assert.ok(ids().every(id => byId.get(id) && !byId.get(id).forecast), 'a forecast is listed among live events');
  const sel = d.getElementById('sortBy');
  sel.value = 'oldest';
  sel.dispatchEvent(new w.Event('change'));
  const times = ids().map(id => Date.parse(byId.get(id).updated || ''));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'oldest first did not order this card');
  r.close();
});

/* ----------------------------------------------------------------- P10 */

test('P10: /alerts says how many it shows and shows the rest on request', async () => {
  const features = Array.from({ length: 70 }, (_, i) => ({
    id: 'ustest' + i,
    properties: { place: (10 + i) + ' km N of Testville ' + i + ', Japan', mag: 4 + (i % 10) / 10, time: Date.now() - (i + 1) * 36e5,
      updated: Date.now() - (i + 1) * 36e5, title: 'M 4.' + (i % 10) + ' - Testville ' + i + ', Japan', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/ustest' + i, tsunami: 0 },
    geometry: { coordinates: [130 + i / 10, 33 + i / 20, 10] }
  }));
  const r = await renderPage('alerts.html', { mock: { feeds: { usgs: { features } } }, waitFor: d => d.querySelectorAll('#alerts .al').length > 0, timeoutMs: 10000 });
  const d = r.document;
  const total = Number(d.getElementById('kOfficial').textContent);
  assert.ok(total > 40, 'the fixture should hold more than one page: ' + total);
  assert.equal(d.querySelectorAll('#alerts .al').length, 40);
  assert.match(d.getElementById('alerts').textContent, new RegExp('Showing 40 of ' + total));
  d.getElementById('showMore').click();
  assert.equal(d.querySelectorAll('#alerts .al').length, Math.min(80, total));
  r.close();
});

/* ----------------------------------------------------------------- P11 */

test('P11: the same quantity reads the same on every page', async () => {
  const home = await renderPage('index.html', { waitFor: filled('kCountries') });
  const h = id => home.document.getElementById(id).textContent;
  const k = { events: h('kEvents'), forecasts: h('kForecasts'), countries: h('kCountries') };
  home.close();
  const fc = await renderPage('forecasts.html', { waitFor: filled('kForecasts') });
  assert.equal(fc.document.getElementById('kForecasts').textContent, k.forecasts, 'open forecasts');
  fc.close();
  const world = await renderPage('region-detail.html', { search: '?region=World', waitFor: filled('kEvents') });
  assert.equal(world.document.getElementById('kEvents').textContent, k.events, 'World events');
  world.close();
  const regions = await renderPage('regions.html', { waitFor: filled('kRegions') });
  assert.equal(regions.document.getElementById('kRegions').textContent, k.countries, 'countries');
  regions.close();
  const list = await renderPage('forecast-list.html', { url: '/forecast-list', waitFor: d => /open/.test(d.getElementById('statusLine').textContent) });
  assert.match(list.document.getElementById('statusLine').textContent, new RegExp('\\b' + k.forecasts + ' open'));
  list.close();
});

/* ----------------------------------------------------------------- P12 */

test('P12: the forecasts hazard filter counts forecasts only', async () => {
  const n = (await live()).filter(e => e.forecast).length;
  const r = await renderPage('forecasts.html', { waitFor: d => d.getElementById('type').options.length > 1 });
  const opts = [...r.document.getElementById('type').options];
  assert.equal(opts[0].textContent, 'All hazards (' + n + ')');
  const sum = opts.slice(1).reduce((s, o) => s + Number((/\((\d+)\)$/.exec(o.textContent) || [])[1] || 0), 0);
  assert.equal(sum, n, 'the per-hazard counts do not add up to the forecasts');
  r.close();
});

/* ----------------------------------------------------------------- P13 */

test('P13: a live map search moves the map to what it found, and says when nothing matched', async () => {
  const r = await renderPage('live-map.html', { waitFor: d => d.getElementById('cards').children.length > 0, timeoutMs: 10000 });
  const { document: d, window: w } = r;
  const map = w.__pndMaps[0];
  let fitted = 0;
  const realFit = map.fitBounds;
  map.fitBounds = function () { fitted++; return realFit.apply(this, arguments); };
  const q = d.getElementById('q');
  q.value = 'Indonesia';
  q.dispatchEvent(new w.Event('input'));
  assert.equal(fitted, 1, 'the map did not move to the matches');
  assert.match(d.getElementById('searchNote').textContent, /match/);
  q.value = 'zzqqnothing';
  q.dispatchEvent(new w.Event('input'));
  assert.match(d.getElementById('searchNote').textContent, /No event matches/);
  r.close();
});

/* ----------------------------------------------------------------- P14 */

test('P14: list pages offer every hazard type present', async () => {
  const types = [...new Set((await live()).map(e => e.type))];
  const r = await renderPage('events.html', { waitFor: d => d.getElementById('type').options.length > 1 });
  const offered = [...r.document.getElementById('type').options].map(o => o.value);
  for (const t of types) assert.ok(offered.includes(t), 'no option for ' + t);
  // And choosing one matches it exactly.
  const sel = r.document.getElementById('type');
  sel.value = 'Flood';
  sel.dispatchEvent(new r.window.Event('change'));
  const want = (await live()).filter(e => e.type === 'Flood').length;
  assert.equal(r.document.querySelectorAll('#cards .event-card').length, want);
  r.close();
});

/* ----------------------------------------------------------------- P15 */

test('P15: a record that does not exist says so plainly', async () => {
  const fc = await renderPage('forecast-detail.html', { search: '?id=NOPE-XYZ', waitFor: d => /not found/.test(d.getElementById('title').textContent), timeoutMs: 9000 });
  assert.equal(fc.document.title, 'Forecast not found | Predict Natural Disasters');
  assert.ok(fc.document.querySelector('main.wrap').hidden, 'the empty forecast layout is still shown');
  fc.close();
  const src = await renderPage('source-detail.html', { search: '?source=Nope', waitFor: d => /not found/.test(d.getElementById('title').textContent) });
  assert.equal(src.document.getElementById('title').textContent, 'Source not found');
  src.close();
  const ent = await renderPage('entity-detail.html', { waitFor: d => d.getElementById('title').textContent !== '' });
  assert.equal(ent.document.getElementById('title').textContent, 'Topic not found');
  ent.close();
});

/* ----------------------------------------------------------------- P16 */

test('P16: "ending soonest" puts windows that already ended last', async () => {
  const r = await renderPage('events.html', { waitFor: (d, w) => !!w.PND });
  const P = r.window.PND, now = Date.now(), iso = t => new Date(t).toISOString();
  const rows = [{ id: 'ended', targetEnd: iso(now - 30 * 864e5), windowClosed: true },
    { id: 'later', targetEnd: iso(now + 5 * 864e5) }, { id: 'soon', targetEnd: iso(now + 864e5) }];
  assert.deepEqual(P.applySort(rows, 'windowEnd').map(x => x.id), ['soon', 'later', 'ended']);
  r.close();
});

/* ----------------------------------------------------------------- P17 */

test('P17: the dead ReliefWeb RSS address is gone from the feed and the sources page', async () => {
  assert.doesNotMatch(read('api/events.js'), /reliefweb\.int\/disasters\/feed/);
  const r = await renderPage('resources.html', { waitFor: d => d.querySelectorAll('#cards .event-card').length > 0 });
  assert.doesNotMatch(r.document.getElementById('cards').innerHTML, /disasters\/feed/);
  r.close();
});

/* ----------------------------------------------------------------- P18 */

test('P18: the track record cannot widen a phone screen, and the old home layouts are redirected', () => {
  // Measured in Chromium at 390px; jsdom lays nothing out, so the rules that fixed it are held here.
  assert.match(read('accuracy.html'), /\.split>\*\{min-width:0\}\.status-title,\.sub\{overflow-wrap:anywhere\}/);
  /* The old layouts are deleted, so what holds now is that every address they
     had lands on the homepage. */
  const cfg = JSON.parse(read('vercel.json')), redirects = cfg.redirects || [];
  for (const f of ['home', 'home-v2', 'home-v3']) {
    for (const asked of ['/' + f, '/' + f + '/', '/' + f + '.html']) {
      /* With trailingSlash:false, /home/ is sent to /home before any route. */
      const src = cfg.trailingSlash === false ? asked.replace(/\/$/, '') : asked;
      const r = redirects.find(x => x.source === src);
      assert.ok(r && r.destination === '/', asked + ' is not redirected to /');
    }
  }
});
