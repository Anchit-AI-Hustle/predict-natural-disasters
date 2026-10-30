'use strict';
/*
 * Launch audit D: the browse and info pages (regions, region-detail,
 * hazard-types, hazard-detail, directory, entity-detail, source-detail,
 * resources, about) and the shared nav and footer. One test, or a few, per
 * finding D1 to D32, named for it, so a regression points at the finding.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows, fixtureFeed } = require('./render.js');

test.after(closeAllWindows);
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
const filled = id => d => { const el = d.getElementById(id); return el && !/^(-|Loading…)?$/.test(el.textContent.trim()); };
const N = require(path.join(ROOT, 'country-names.js'));

/* A small world: the cases the audit found, and nothing else. */
const WORLD = [
  { id: 'ng1', title: 'Wildfire in Nigeria', type: 'Wildfire', country: 'Nigeria', countries: ['Nigeria'], source: 'NASA EONET' },
  { id: 'ng2', title: 'Wildfire in Nigeria and Cameroon', type: 'Wildfire', country: 'Nigeria, Cameroon', countries: ['Nigeria', 'Cameroon'], source: 'NASA EONET' },
  { id: 'ne1', title: 'Flood in Niger', type: 'Flood', country: 'Niger', countries: ['Niger'], source: 'GDACS', alert: 'Orange' },
  { id: 'in1', title: 'Flood in India', type: 'Flood', country: 'India', countries: ['India'], source: 'GDACS', details: 'Also felt in Niger and Japan' },
  { id: 'ridge', title: 'M 5.1 - Western Indian-Antarctic Ridge', type: 'Earthquake', country: 'Western Indian-Antarctic Ridge', countries: ['Western Indian-Antarctic Ridge'], source: 'USGS', lat: -50, lon: 120 },
  { id: 'mx1', title: 'M 4.6 - Oaxaca, MX', type: 'Earthquake', country: 'MX', countries: ['MX'], source: 'USGS' },
  { id: 'mx2', title: 'M 4.2 - Guerrero, México', type: 'Earthquake', country: 'México', countries: ['México'], source: 'USGS' },
  { id: 'mx3', title: 'Flood in Mexico', type: 'Flood', country: 'Mexico', countries: ['Mexico'], source: 'GDACS' },
  { id: 'jp1', title: 'M 4.4 - Japan region', type: 'Earthquake', country: 'Japan region', countries: ['Japan region'], source: 'USGS' },
  { id: 'jp2', title: 'M 5.0 - Honshu, Japan', type: 'Earthquake', country: 'Japan', countries: ['Japan'], source: 'USGS', alert: 'Red' },
  { id: 'ir1', title: 'Flood in Iran', type: 'Flood', country: 'Islamic Republic of Iran', countries: ['Islamic Republic of Iran'], source: 'GDACS' },
  { id: 'ir2', title: 'M 4.9 - Iran', type: 'Earthquake', country: 'Iran', countries: ['Iran'], source: 'USGS' },
  { id: 'mm1', title: 'Flood in Burma', type: 'Flood', country: 'Burma (Myanmar)', countries: ['Burma (Myanmar)'], source: 'GDACS' },
  { id: 'vo1', title: 'Volcano Ruang', type: 'Volcano', country: 'Indonesia', countries: ['Indonesia'], source: 'GDACS' },
  { id: 'vo2', title: 'Kilauea', type: 'Volcano', country: 'United States', countries: ['United States'], source: 'USGS Volcano Hazards Program' },
  { id: 'ss1', title: 'Severe storm over Chile', type: 'Severe Storm', country: 'Chile', countries: ['Chile'], source: 'NASA EONET' },
  { id: 'nhc1', title: 'Hurricane Vance', type: 'Tropical Cyclone', country: '', countries: [], sea: 'Eastern Pacific Ocean', source: 'NOAA National Hurricane Center', lat: 15, lon: -110 },
  { id: 'fc1', title: 'Storm risk from Hurricane Vance - 5-day forecast', type: 'Tropical Cyclone', forecast: true, sourceType: 'model',
    source: 'Predict Natural Disasters · derived from GDACS', country: 'Mexico', countries: ['Mexico'] },
  { id: 'fc2', title: 'Aftershock risk near Iran - 7-day forecast', type: 'Earthquake aftershock sequence', forecast: true, sourceType: 'model',
    source: 'Predict Natural Disasters · derived from USGS', country: 'Iran', countries: ['Iran'] },
  { id: 'fc3', title: 'Extreme heat in India', type: 'Extreme Heat', forecast: true, sourceType: 'model',
    source: 'Predict Natural Disasters · forecast model', country: 'India', countries: ['India'] }
];
const feed = (extra, meta, more) => fixtureFeed(WORLD.concat(extra || []), meta, more);

/* ------------------------------------------------------------------ D1 */

test('D1: a source page counts only that agency’s own reports, never our forecasts', async () => {
  const r = await renderPage('source-detail.html', { search: '?source=GDACS', beforeParse: feed(), waitFor: filled('kRecords') });
  const gdacs = WORLD.filter(e => e.source === 'GDACS' && !e.forecast).length;
  assert.equal(r.document.getElementById('kRecords').textContent, String(gdacs));
  assert.doesNotMatch(text(r.document.getElementById('events')), /forecast/i);
  assert.match(text(r.document.body), /1 of our current forecasts? starts? from/i, 'the forecasts started from GDACS reports are not said apart');
  r.close();
  const u = await renderPage('source-detail.html', { search: '?source=USGS', beforeParse: feed(), waitFor: filled('kRecords') });
  assert.equal(u.document.getElementById('kRecords').textContent, String(WORLD.filter(e => e.source === 'USGS').length),
    'USGS took in the volcano programme or our derived forecasts');
  u.close();
});

/* ------------------------------------------------------------------ D2 */

test('D2: a country page matches the country exactly, never inside another name or a description', async () => {
  const r = await renderPage('region-detail.html', { search: '?region=Niger', beforeParse: feed(), waitFor: filled('kEvents') });
  assert.equal(r.document.getElementById('kEvents').textContent, '1', 'Niger took in Nigeria, or a description naming Niger');
  assert.doesNotMatch(text(r.document.getElementById('events')), /Nigeria/);
  r.close();
  const i = await renderPage('region-detail.html', { search: '?region=India', beforeParse: feed(), waitFor: filled('kEvents') });
  assert.equal(i.document.getElementById('kEvents').textContent, '1', 'India took in the Western Indian-Antarctic Ridge');
  i.close();
  for (const [q, n] of [['Guinea', 0], ['Sudan', 0], ['Oman', 0], ['Mali', 0], ['Japan', 2], ['Mexico', 3], ['Iran', 2]]) {
    assert.equal(WORLD.filter(e => !e.forecast).filter(e => N.inPlace(e, q)).length, n, q);
  }
  assert.equal(N.inPlace({ country: 'Papua New Guinea', countries: ['Papua New Guinea'] }, 'Guinea'), false);
  assert.equal(N.inPlace({ country: 'South Sudan', countries: ['South Sudan'] }, 'Sudan'), false);
  assert.equal(N.inPlace({ country: 'Romania', countries: ['Romania'] }, 'Oman'), false);
  assert.equal(N.inPlace({ region: 'Anchorage, Alaska', country: 'United States', countries: ['United States'] }, 'Alaska'), true);
});

/* ------------------------------------------------------------------ D3 */

test('D3: one name per country, and ocean features are at sea', () => {
  for (const n of ['Mexico', 'México', 'MX']) assert.equal(N.canonical(n), 'Mexico', n);
  for (const n of ['Iran', 'Islamic Republic of Iran', 'Iran (Islamic Republic of)']) assert.equal(N.canonical(n), 'Iran', n);
  for (const n of ['Myanmar', 'Burma (Myanmar)', 'Burma']) assert.equal(N.canonical(n), 'Myanmar', n);
  assert.deepEqual(N.place(['Japan region']), { countries: ['Japan'] });
  assert.deepEqual(N.place(['Japan Region', 'Japan']), { countries: ['Japan'] });
  assert.deepEqual(N.place(['Reykjanes Ridge']), { countries: [], sea: 'Reykjanes Ridge' });
  assert.deepEqual(N.place(['South of Fiji Islands']), { countries: [], sea: 'South of Fiji Islands' });
  assert.deepEqual(N.place(['Balleny Islands region']), { countries: [], sea: 'Balleny Islands region' });
  assert.equal(N.countryCount(WORLD.filter(e => !e.forecast)), 11);
});

test('D3: the feed fills countries with one name each and moves seas out', async () => {
  const src = read('api/events.js');
  assert.match(src, /require\('\.\.\/country-names\.js'\)\.place\(where\.countries\)/, 'api/events.js does not name countries through country-names.js');
});

test('D3: /regions groups each country once, and records at sea in their own group', async () => {
  const r = await renderPage('regions.html', { beforeParse: feed(), waitFor: d => d.querySelectorAll('#regionGrid .reg').length > 0 });
  const names = [...r.document.querySelectorAll('#regionGrid .reg h3')].map(h => h.textContent);
  for (const dup of ['México', 'MX', 'Japan region', 'Islamic Republic of Iran', 'Burma (Myanmar)', 'Western Indian-Antarctic Ridge']) {
    assert.ok(!names.includes(dup), dup + ' is listed as a place of its own');
  }
  assert.ok(names.includes('Mexico') && names.includes('Japan') && names.includes('Iran') && names.includes('Myanmar'));
  assert.ok(names.includes('At sea'), 'records at sea have no group of their own');
  const mexico = [...r.document.querySelectorAll('#regionGrid .reg')].find(a => a.querySelector('h3').textContent === 'Mexico');
  assert.match(text(mexico), /(^|\D)3 current events\b/);
  assert.equal(r.document.getElementById('kRegions').textContent, String(N.countryCount(WORLD.filter(e => !e.forecast))));
  r.close();
});

test('D3: every page that counts or groups countries loads country-names.js before using it', () => {
  const bad = [];
  for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html'))) {
    const s = read(f);
    const at = s.indexOf('<script src="/country-names.js"></script>');
    for (const dep of ['/search.js', '/portal.js', '/continents.js']) {
      const d = s.indexOf('<script src="' + dep + '"');
      if (d >= 0 && (at < 0 || at > d)) bad.push(f + ' loads ' + dep + ' without country-names.js first');
    }
  }
  assert.deepEqual(bad, []);
  assert.match(read('portal.js'), /countryCount\(list\)\{const N=.*PNDCountries/, 'PND.countryCount does not use the shared module');
  assert.match(read('search.js'), /countryCount\(list\)\{const N=.*PNDCountries/, 'PNDSearch.countryCount does not use the shared module');
});

/* ------------------------------------------------------------------ D4 */

test('D4: /regions lists every place, and the search filters the cards and the counts', async () => {
  const OTHERS = N.NAMES.filter(n => !/^(Japan|Mexico|Iran|Myanmar|India|Niger|Nigeria|Cameroon|Indonesia|United States|Chile)$/.test(n));
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'c' + i, title: 'Flood ' + i, type: 'Flood',
    country: OTHERS[i], countries: [OTHERS[i]], source: 'GDACS' }));
  const r = await renderPage('regions.html', { beforeParse: feed(many), waitFor: d => d.querySelectorAll('#regionGrid .reg').length > 0 });
  const d = r.document;
  const total = d.querySelectorAll('#regionGrid .reg').length;
  assert.ok(total >= 70, 'only ' + total + ' places listed');
  assert.match(text(d.getElementById('placeCount')), new RegExp('\\b' + total + ' places'));
  const q = d.getElementById('q');
  q.value = 'Japan';
  q.dispatchEvent(new r.window.Event('input', { bubbles: true }));
  await new Promise(res => setTimeout(res, 400));
  const shown = [...d.querySelectorAll('#regionGrid .reg h3')].map(h => h.textContent);
  assert.deepEqual(shown, ['Japan']);
  assert.match(text(d.getElementById('placeCount')), new RegExp('Showing 1 of ' + total + ' places'));
  assert.equal(d.getElementById('kEvents').textContent, '2', 'the headline count did not follow the search');
  r.close();
});

/* ------------------------------------------------------------------ D5 */

test('D5: every card and tile on the browse pages is a real link', async () => {
  const pages = [
    ['regions.html', '', '#regionGrid', '.reg'],
    ['region-detail.html', '?region=World', '#events', 'a'],
    ['region-detail.html', '?region=World', '#hazards', 'a.haz'],
    ['hazard-detail.html', '?type=Earthquake', '#events', 'a'],
    ['directory.html', '', '#cards', 'a.event-card']
  ];
  for (const [page, search, box, sel] of pages) {
    const r = await renderPage(page, { search, beforeParse: feed(), waitFor: d => d.querySelector(box + ' ' + sel) });
    const el = r.document.querySelector(box);
    assert.equal(el.querySelectorAll('[onclick]').length, 0, page + ' ' + box + ' still uses onclick');
    const items = [...el.querySelectorAll(sel)];
    assert.ok(items.length, page + ' ' + box + ' has no links');
    for (const a of items) assert.ok(a.tagName === 'A' && a.getAttribute('href'), page + ': ' + a.outerHTML.slice(0, 80));
    r.close();
  }
  assert.match(read('regions.html') + read('region-detail.html'), /\.reg:focus-visible|\.haz:focus-visible/);
});

/* ------------------------------------------------------------------ D6 */

test('D6: the directory’s hazard filter is built from the data, and Volcano and Severe Storm work', async () => {
  const r = await renderPage('directory.html', { beforeParse: feed(), waitFor: d => d.querySelectorAll('#type option').length > 2 });
  const d = r.document;
  const sel = d.getElementById('type');
  const opts = [...sel.options].map(o => o.value);
  for (const want of ['Volcano', 'Severe Storm', 'Tropical Cyclone', 'Extreme Heat', 'Earthquake aftershock sequence']) {
    assert.ok(opts.includes(want), want + ' is not offered');
  }
  for (const [v, n] of [['Volcano', 2], ['Severe Storm', 1]]) {
    sel.value = v; sel.dispatchEvent(new r.window.Event('change'));
    assert.equal(d.querySelectorAll('#cards a.event-card').length, n, v);
  }
  assert.match(read('collection.js'), /PND\.sameHazard\(e\.type,/);
  r.close();
});

/* ------------------------------------------------------------------ D7, D8, D21 */

test('D7: the About page says who made it, why, how data flows, what it is not, feedback and privacy', async () => {
  const s = read('about.html');
  const r = await renderPage('about.html', { beforeParse: feed(), waitFor: filled('aCountries') });
  const d = r.document;
  const heads = [...d.querySelectorAll('main h2')].map(h => h.textContent.toLowerCase());
  for (const want of ['who made this', 'why', 'how the data flows', 'what this is not', 'feedback and corrections', 'privacy']) {
    assert.ok(heads.some(h => h.startsWith(want)), 'no section "' + want + '": ' + heads.join(' | '));
  }
  const body = text(d.querySelector('main'));
  assert.match(body, /Built by Anchit Tandon/);
  assert.ok(d.querySelector('main a[href="https://anchit-tandon.com/"]'), 'no link to the author’s site');
  assert.ok(d.querySelector('main a[href="https://github.com/Anchit-AI-Hustle/predict-natural-disasters/issues"]'), 'no feedback route');
  for (const w of ['about every minute', 'daily', 'IMD', 'NDMA', 'GDACS', 'Nominatim', 'BigDataCloud', 'Esri', 'NASA', 'browser']) {
    assert.ok(body.includes(w), 'About does not mention ' + w);
  }
  assert.doesNotMatch(s, /[\w.+-]+@[\w-]+\.[\w.]+/, 'an email address is written into the page');
  r.close();
});

test('D8: About counts countries as every other page does, and says Loading… rather than a dash', async () => {
  const s = read('about.html');
  assert.match(s, /id="aCountries"[^>]*>Loading…</);
  assert.match(s, /id="aHazards"[^>]*>Loading…</);
  const r = await renderPage('about.html', { beforeParse: feed(), waitFor: filled('aCountries') });
  assert.equal(r.document.getElementById('aCountries').textContent, String(N.countryCount(WORLD.filter(e => !e.forecast))));
  r.close();
  const keep = [s, read('entity-detail.html')].map(x => (x.match(/keep (\w+) things apart/) || [])[1]);
  assert.equal(keep[0], keep[1], 'About and the mission page disagree: ' + keep.join(' vs '));
});

test('D21: About uses the shared header, footer and skip link', async () => {
  const s = read('about.html');
  assert.match(s, /<div id="nav"><\/div>/);
  assert.doesNotMatch(s, /<header class="top">/);
  assert.doesNotMatch(s, /<footer/);
  const r = await renderPage('about.html', { beforeParse: feed(), waitFor: d => d.querySelector('.sitefoot') && d.querySelector('#nav .top') });
  const d = r.document;
  assert.equal(d.querySelector('#nav a.logo').getAttribute('href'), '/');
  assert.ok(d.querySelector('a.skip'), 'no skip link');
  assert.match(text(d.querySelector('.sitefoot')), /How it works/);
  assert.doesNotMatch(text(d.querySelector('.sitefoot')), /Calamities|Methodology/);
  r.close();
});

/* ------------------------------------------------------------------ D9 */

test('D9: hazard and region pages invent no event card, and send no position for one', async () => {
  for (const [page, search] of [['hazard-detail.html', '?type=Tsunami'], ['region-detail.html', '?region=India'], ['hazard-detail.html', '?type=Flood']]) {
    const r = await renderPage(page, { search, beforeParse: feed(), waitFor: d => d.getElementById('helplinesBody') && filled('kEvents')(d) });
    await new Promise(res => setTimeout(res, 300));
    const d = r.document;
    assert.equal(d.getElementById('whenWhereBody'), null, page + search + ' has a "When and where it happened" card');
    assert.doesNotMatch(text(d.body), /0\.0000, 0\.0000|Where it started/);
    const asked = r.apiCalls.filter(u => /event-enrichment/.test(u));
    assert.ok(asked.length, page + ' asked for no help information');
    for (const u of asked) assert.doesNotMatch(u, /[?&](lat|lon)=/, page + ' sent a position: ' + u);
    r.close();
  }
});

/* ------------------------------------------------------------------ D10 */

test('D10: an unknown hazard is not found, and a known one reads "What counts as a flood"', async () => {
  const r = await renderPage('hazard-detail.html', { search: '?type=Zombie%20Apocalypse', beforeParse: feed(), waitFor: d => /not found/i.test(d.getElementById('title').textContent) });
  assert.match(r.document.getElementById('title').textContent, /Hazard type not found/);
  assert.ok(r.document.querySelector('a[href="/hazard-types"]'));
  r.close();
  const f = await renderPage('hazard-detail.html', { search: '?type=Flood', beforeParse: feed(), waitFor: filled('kEvents') });
  assert.equal(f.document.getElementById('hazDefName').textContent, 'What counts as a flood');
  assert.equal(f.document.title.split(' | ')[0], f.document.getElementById('title').textContent);
  f.close();
});

/* ------------------------------------------------------------------ D11 */

test('D11: an unknown place is said to be unknown, and a known one is spelled properly', async () => {
  const r = await renderPage('region-detail.html', { search: '?region=Xyzzyland', beforeParse: feed(), waitFor: d => /recognise/.test(d.getElementById('title').textContent) });
  assert.match(r.document.getElementById('title').textContent, /We don.t recognise this place/);
  r.close();
  const j = await renderPage('region-detail.html', { search: '?region=japan', beforeParse: feed(), waitFor: filled('kEvents') });
  assert.equal(j.document.getElementById('title').textContent, 'Disasters in Japan');
  j.close();
  const g = await renderPage('region-detail.html', { search: '?region=Georgia', beforeParse: feed(), waitFor: filled('kEvents') });
  assert.match(text(g.document.body), /the country/i);
  g.close();
});

/* ------------------------------------------------------------------ D12, D28, D31 */

test('D12: every source the site names has a profile keyed to its feed', async () => {
  const r = await renderPage('source-detail.html', { search: '?source=ReliefWeb', beforeParse: feed(), waitFor: filled('kStatus') });
  const d = r.document;
  assert.doesNotMatch(d.getElementById('title').textContent, /not found/i);
  assert.equal(d.getElementById('kStatus').textContent, 'Working');
  const others = [...d.querySelectorAll('#others a')].map(a => a.textContent.replace(/\s*→$/, ''));
  assert.ok(others.length >= 10, 'only ' + others.length + ' other sources');
  assert.ok(!others.some(o => /WMO/.test(o)), 'WMO is listed as a source');
  r.close();
  const n = await renderPage('source-detail.html', { search: '?source=NHC', beforeParse: feed(), waitFor: filled('kStatus') });
  assert.equal(n.document.getElementById('kStatus').textContent, 'Working', 'NHC status not read from meta.sources.nhc');
  assert.doesNotMatch(text(n.document.getElementById('coverage')), /Depends on the source/);
  n.close();
  for (const s of ['Open-Meteo', 'NASA POWER', 'EMSC', 'USGS Volcanoes', 'NWS', 'OpenStreetMap']) {
    const p = await renderPage('source-detail.html', { search: '?source=' + encodeURIComponent(s), beforeParse: feed(), waitFor: filled('kClass') });
    assert.doesNotMatch(p.document.getElementById('title').textContent, /not found/i, s);
    p.close();
  }
  assert.match(read('portal.css'), /\[hidden\]\{display:none!important\}/);
});

test('D28: a source’s type is a whole label, not two words cut from a sentence', async () => {
  const r = await renderPage('source-detail.html', { search: '?source=GDACS', beforeParse: feed(), waitFor: filled('kClass') });
  assert.equal(r.document.getElementById('kClass').textContent, 'Official agency');
  r.close();
});

test('D31: the WMO page shows its limits', async () => {
  const r = await renderPage('source-detail.html', { search: '?source=WMO', beforeParse: feed(), waitFor: filled('kClass') });
  assert.ok(text(r.document.getElementById('limitations')).length > 10);
  assert.equal(r.document.getElementById('kClass').textContent, 'Reference only');
  r.close();
});

/* ------------------------------------------------------------------ D13, D14, D29 */

test('D13: hazard-types links each hazard to its page, with observed and forecast counts apart', async () => {
  const r = await renderPage('hazard-types.html', { beforeParse: feed(), waitFor: d => d.querySelectorAll('#hazTiles a').length > 0 });
  const d = r.document;
  const tiles = [...d.querySelectorAll('#hazTiles a')];
  assert.ok(tiles.every(a => /^\/(hazard-detail\?type=|hazards\/)/.test(a.getAttribute('href'))));
  const eq = tiles.find(a => a.querySelector('b').textContent === 'Earthquake');
  assert.match(text(eq), /(^|\D)6 current events\b/);
  const heat = tiles.find(a => /Extreme heat/i.test(a.querySelector('b').textContent));
  assert.match(text(heat), /0 current events.*1 open forecast/);
  assert.equal(d.getElementById('pageTitle').textContent, d.title.split(' | ')[0]);
  r.close();
});

test('D14 and D29: the directory counts our forecasts apart and explains high alert', async () => {
  const r = await renderPage('directory.html', { beforeParse: feed(), waitFor: d => /forecast/.test(d.getElementById('statusLine').textContent) });
  const obs = WORLD.filter(e => !e.forecast).length;
  assert.match(r.document.getElementById('statusLine').textContent, new RegExp(obs + ' events · 3 forecasts'));
  assert.match(text(r.document.body), /High alert means/);
  r.close();
});

/* ------------------------------------------------------------------ D15 */

test('D15: coming back to hazard-detail shows the hazard in its address', async () => {
  const r = await renderPage('hazard-detail.html', { search: '?type=Earthquake', beforeParse: feed(), waitFor: filled('kEvents') });
  const d = r.document;
  assert.equal(d.getElementById('hazSel').getAttribute('autocomplete'), 'off');
  d.getElementById('hazSel').value = 'Volcano';
  d.getElementById('region').value = 'Japan';
  r.window.dispatchEvent(new r.window.Event('pageshow'));
  await new Promise(res => setTimeout(res, 300));
  assert.equal(d.getElementById('hazSel').value, 'Earthquake');
  assert.equal(d.getElementById('region').value, '');
  assert.match(d.getElementById('title').textContent, /^Earthquake/);
  r.close();
});

/* ------------------------------------------------------------------ D16 */

test('D16: the hazard facts are right and match the code', () => {
  global.window = global.window || undefined;
  const src = read('hazard-model.js');
  assert.doesNotMatch(src, /not forecast by any model/);
  assert.match(src, /warning centres[^.']*model arrival times/);
  assert.match(src, /IMD/);
  assert.doesNotMatch(src, /must never be published with one/);
  assert.doesNotMatch(read('hazard-detail.html'), /or our forecast rates it/);
});

/* ------------------------------------------------------------------ D17 */

test('D17: /resources does not deny the forecasts it starts from a source', async () => {
  const providers = [{ provider: 'gdacs', label: 'GDACS', status: 'SCANNED', inputKind: 'observation', hazards: ['Flood'],
    inputBasis: 'GDACS raises alerts on events it has already detected.', endpoint: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP' },
  { provider: 'usgs', label: 'USGS', status: 'INCOMPLETE_SCAN', inputKind: 'observation', hazards: ['Earthquake'],
    failureReason: 'GDACS was not read in full for floods: the search failed or every page asked for came back full.' }];
  const r = await renderPage('resources.html', { beforeParse: feed([], { scan: { providers } }), waitFor: d => d.querySelectorAll('#cards article').length >= 2 });
  const body = text(r.document.getElementById('cards'));
  assert.doesNotMatch(body, /no forecast can be made from it/);
  assert.match(body, /1 of our current forecasts? starts? from/);
  assert.doesNotMatch(body, /came back full/);
  assert.match(body, /Raw data feed/);
  assert.match(body, /2 of 2 sources working/);
  r.close();
});

/* ------------------------------------------------------------------ D18 */

test('D18: titles and figures have their space before the data arrives', () => {
  for (const f of ['hazard-types.html', 'resources.html', 'directory.html']) {
    assert.match(read(f), /<h1 id="pageTitle">[^<]+<\/h1>/, f + ' has an empty title');
    assert.match(read(f), /<p id="pageSub">[^<]+<\/p>/, f + ' has an empty subtitle');
  }
  assert.match(read('portal.css'), /\.stat strong\{[^}]*min-height/);
});

/* ------------------------------------------------------------------ D19 */

test('D19: the legacy zone names read as their current ones', async () => {
  for (const [zone, label] of [['Asia/Calcutta', 'IST'], ['Asia/Katmandu', 'GMT+5:45'], ['Asia/Saigon', 'GMT+7']]) {
    const r = await renderPage('regions.html', { beforeParse: feed([], null, w => { w.localStorage.setItem('pnd_timezone', zone); }),
      waitFor: d => d.getElementById('pndTimezone') });
    const w = r.window;
    assert.equal(w.PND.tzLabel(zone), label, zone);
    const opts = [...r.document.getElementById('pndTimezone').options].map(o => o.textContent);
    assert.equal(opts.filter(o => /· India$|Calcutta|Kolkata/.test(o)).length, 1, opts.slice(0, 5).join(' | '));
    assert.ok(!opts.some(o => /Calcutta|Katmandu|Saigon/.test(o)), 'a legacy name is shown');
    r.close();
  }
});

/* ------------------------------------------------------------------ D20, D27, D30 */

test('D20: a map that shows only some events says so', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: 'm' + i, title: 'Fire ' + i, type: 'Wildfire', country: 'Australia', countries: ['Australia'], source: 'NASA EONET', lat: -30 + i * 0.01, lon: 140 }));
  const r = await renderPage('regions.html', { beforeParse: feed(many), waitFor: d => /Showing/.test(text(d.getElementById('mapCap'))) });
  assert.match(text(r.document.getElementById('mapCap')), /Showing 250 of \d+ reports and forecasts on the map/);
  r.close();
  const g = read('globe.js');
  assert.doesNotMatch(g, /'MGRS ' \+/);
  assert.doesNotMatch(g, /label: '(NVG|FLIR|CRT)'/);
  assert.match(read('map-setup.js'), /interactive: false, 'keyboard': LABEL_KEYS/);
  assert.match(read('map-setup.js'), /var LABEL_KEYS = false;/);
});

test('D27 and D30: the map key scrolls by keyboard, and Globe/Flat clears the zoom on a phone', () => {
  const m = read('map-setup.js');
  assert.match(m, /body\.setAttribute\('tabindex', '0'\)/);
  assert.match(m, /body\.setAttribute\('role', 'region'\)/);
  assert.match(m, /@media \(max-width:760px\)\{\.pnd-view-toggle\{top:/);
});

/* ------------------------------------------------------------------ D22 */

test('D22: the footer agency links go where they say, without redirects or doubled names', async () => {
  const t = read('trust.js');
  assert.doesNotMatch(t, /wmo\.int\/about\/governance\/wmo-members/);
  assert.match(t, /https:\/\/worldweather\.wmo\.int\/en\/members\.html/);
  assert.doesNotMatch(t, /volcanoes\.usgs\.gov/);
  const r = await renderPage('regions.html', { beforeParse: feed(), waitFor: d => d.querySelector('.trust-foot') });
  await new Promise(res => setTimeout(res, 200));
  assert.doesNotMatch(text(r.document.querySelector('.trust-foot')), /\(United States Geological Survey\)/);
  assert.ok(r.document.querySelector('.trust-foot').hasAttribute('data-keep-acronyms'));
  r.close();
});

/* ------------------------------------------------------------------ D23 */

test('D23: the sitemap lists the country and hazard pages', () => {
  const s = read('sitemap.xml');
  for (const u of ['/hazard-types', '/hazards/Flood', '/hazards/Earthquake', '/regions/India', '/regions/Japan', '/regions/Asia']) {
    assert.ok(s.includes('<loc>https://predict-natural-disasters.anchit-tandon.com' + u + '</loc>'), u);
  }
});

/* ------------------------------------------------------------------ D24 */

test('D24: topic pages carry no ids, filler or stale notes, and an unknown kind is not echoed', async () => {
  const s = read('entity-detail.html');
  assert.doesNotMatch(s, /Topic ID/);
  assert.doesNotMatch(s, /The links on this page lead to live events/);
  assert.doesNotMatch(s, /kUpdated/);
  assert.match(s, /<aside class="trust"/);
  const r = await renderPage('entity-detail.html', { search: '?kind=bogus&id=nothing', beforeParse: feed(), waitFor: d => d.getElementById('title').textContent !== 'Details' });
  assert.match(r.document.getElementById('title').textContent, /Topic not found/);
  assert.doesNotMatch(text(r.document.querySelector('main')) + text(r.document.querySelector('.hero')), /bogus/i);
  r.close();
});

/* ------------------------------------------------------------------ D25 */

test('D25: the abbreviations are folded under one line, and name nothing hidden', async () => {
  const r = await renderPage('region-detail.html', { search: '?region=World', beforeParse: feed(), waitFor: filled('kEvents') });
  const d = r.document;
  /* A term only in a hidden element is not one the reader sees. */
  d.querySelector('main').insertAdjacentHTML('beforeend', '<p hidden>Sent by PAGASA.</p>');
  await new Promise(res => setTimeout(res, 300));
  const note = d.getElementById('pnd-acronym-note');
  assert.ok(note, 'no abbreviation note');
  assert.equal(note.tagName, 'DETAILS', 'the definitions are printed as a paragraph again');
  assert.equal(note.open, false);
  assert.match(note.querySelector('summary').textContent, /^Abbreviations on this page \(\d+\)$/);
  assert.doesNotMatch(note.textContent, /PAGASA stands for/);
  r.close();
});

/* ------------------------------------------------------------------ D26 */

test('D26: body text is 12px or more and badges 11px or more', () => {
  const css = read('portal.css');
  for (const [sel, min] of [['.event-card p', 12], ['.source', 11], ['.statusbar', 12], ['.logo small', 11], ['.badge', 11], ['.sev', 11]]) {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*font-size:(\\d+)px').exec(css);
    assert.ok(m, sel);
    assert.ok(+m[1] >= min, sel + ' is ' + m[1] + 'px');
  }
});

/* ------------------------------------------------------------------ D32 */

test('D32: /regions has one Go button: a country opens its page, anything else is searched', async () => {
  const r = await renderPage('regions.html', { beforeParse: feed(), waitFor: d => d.querySelector('#regionGrid .reg') });
  const d = r.document, w = r.window;
  assert.ok(d.getElementById('goBtn'));
  assert.ok(!d.getElementById('openRegionBtn') && !d.getElementById('findAreaBtn'), 'two buttons for one box');
  const t = v => JSON.stringify(w.goTarget(v));
  assert.equal(t('japan'), '{"region":"Japan"}');
  assert.equal(t('Asia'), '{"region":"Asia"}');
  assert.equal(t('MX'), '{"region":"Mexico"}');
  assert.equal(t('Kyoto'), '{"search":"Kyoto"}');
  r.close();
});
