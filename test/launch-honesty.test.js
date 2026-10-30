'use strict';
/*
 * The track record a forecasting scientist will open first (launch audit C).
 *
 * Every figure on /accuracy and the forecast pages has to be one a reader can
 * reproduce from the committed ledgers, under the rule the site publishes.
 * Each block below is one finding of that audit, written as the behaviour
 * the site must have now.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../verification-model.js');
const OBS = require('../observed-model.js');
const { closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const FULL_COVER = { from: '2000-01-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };
const prediction = over => Object.assign({
  id: 'OUT-test-1', type: 'Flood', title: '3-day Flood risk outlook - Nepal',
  country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3,
  forecastScope: 'country', forecastClass: 'continuation-outlook',
  freezeTimestamp: '2026-09-04T00:00:00Z',
  targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
}, over || {});
const disaster = over => Object.assign({
  canonicalEventId: 'OBS-flood-NEP-20260903T0000-n28e085',
  hazard: 'flood', significant: true, onset: '2026-09-03T00:00:00Z',
  geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
}, over || {});
const grade = (p, events, opts) => V.verify(p, events, Object.assign(
  { now: Date.parse('2026-09-10T00:00:00Z'), hazardFamilyOf: OBS.familyOf, observedCoverage: FULL_COVER }, opts || {}));

/* ------------------------------------------------------------------ C1 */

test('C1: an agency still listing the hazard does not make a restated alert correct', () => {
  for (const cls of ['continuation-outlook', 'warning-derived']) {
    const listed = disaster({
      impactLastUpdated: '2026-09-05T12:00:00Z',
      lastSeenAt: '2026-09-06T00:00:00Z',
      sightings: [{ from: '2026-09-03T00:00:00Z', to: '2026-09-09T00:00:00Z', fromScan: 's1', toScan: 's9' }]
    });
    const v = grade(prediction({ forecastClass: cls }), [listed]);
    assert.notEqual(v.classification, 'HIT', cls + ' was graded correct because the agency kept listing it');
    assert.notEqual(v.classification, 'PARTIAL_HIT', cls);
    /* With sources whose silence counts, no new impact is the forecast not coming true. */
    assert.equal(v.classification, 'MISS_FALSE_POSITIVE', cls);
    assert.match(v.classificationReason, /no new (damage|impact)/i);
  }
});

test('C1: a new impact reported inside the window is what bears a restated alert out', () => {
  const v = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 3, to: 11 }] })]);
  assert.equal(v.classification, 'HIT');
  assert.match(v.classificationReason, /deaths rose to 11/);
  /* A figure revised down is not a new impact. */
  const down = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 11, to: 3 }] })]);
  assert.notEqual(down.classification, 'HIT');
});

test('C1: where no source could show an absence, a restated alert stays ungraded rather than failed', () => {
  const v = grade(prediction(), [disaster({ lastSeenAt: '2026-09-06T00:00:00Z' })],
    { observedCoverage: { from: null, to: null } });
  assert.equal(v.classification, 'PENDING');
  assert.equal(v.gradeable, false);
});

test('C1: the checker version moved with the rule', () => {
  assert.equal(V.VERIFICATION_VERSION, 'verify-1.4.0');
  assert.equal(V.CONTINUATION_EVIDENCE['continuation-outlook'], 'new-impact');
  assert.equal(V.CONTINUATION_EVIDENCE['warning-derived'], 'new-impact');
});

test('C1: the methodology publishes the rule the checker applies', () => {
  const html = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.match(html, /still listing|still lists/i, 'methodology does not say an agency still listing a hazard is not a hit');
  assert.match(html, /new (damage|impact)/i);
  assert.match(html, /verify-1\.4\.0/);
});

/* ------------------------------------------------------------ C3, C7, C8 */

const M = require('../forecast-models.js');
const MG = require('../tools/model-grades.js');
const readData = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n), 'utf8'));
const town = () => ({ id: 'rain-town', lat: 10, lon: 10,
  heat: { p95: [40, 0, 0, 0, 0, 0, 0], p99: [43, 0, 0, 0, 0, 0, 0] },
  rain: { p99: Array(12).fill(20), p99x3: Array(12).fill(40) }, fire: { p95: Array(12).fill(30) } });
const dayList = (from, n) => Array.from({ length: n }, (_, i) => M.windowDays(from + 'T00:00:00Z', from + 'T23:59:59Z')[0])
  .map((d, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
const dry = n => Array.from({ length: n }, () => ({ tmax: 30, rain: 0, dew: 15, wind: 10 }));
const rainForecast = (id, start, end, issued) => ({ id, issuedAt: issued, recordedAt: issued,
  targetStart: start + 'T00:00:00Z', targetEnd: end + 'T23:59:59Z', model: { hazard: 'rain', placeId: 'rain-town' } });

test('C3: the committed grades are exactly what the committed inputs give', () => {
  const ledger = readData('model-ledger.json'), runs = readData('model-runs.json');
  const clim = readData('climatology.json'), archive = readData('model-measured.json');
  const published = readData('model-verdicts.json');
  const again = MG.buildVerdicts(ledger, runs, clim, archive);
  assert.deepEqual(published.counts, again.counts, 'data/model-verdicts.json does not follow from the committed files');
  assert.deepEqual(published.outlooks.map(o => o.id + ':' + o.verdict), again.outlooks.map(o => o.id + ':' + o.verdict));
  /* missedDays is the misses recomputed now, not a list only ever added to. */
  assert.equal(published.counts.missedDays, published.misses.length);
  assert.equal(published.counts.missedDays, again.misses.length);
  /* And it is gradePublished over the settled measurements, per hazard. */
  const placeBy = Object.fromEntries(clim.places.map(p => [p.id, p]));
  const known = new Set(ledger.map(o => o.id));
  const pub = runs.filter(r => (r.outlooks || []).every(id => known.has(id)));
  let misses = 0;
  for (const hz of ['heat', 'rain', 'fire']) {
    const observed = {};
    for (const pid of Object.keys(archive.places)) {
      const ob = placeBy[pid] && M.observedFromArchive(placeBy[pid], archive.places[pid]);
      if (ob) observed[pid] = { measured: hz === 'fire' ? ob.fireMeasured : ob.measured, heat: ob.heat, rain: ob.rain, fire: ob.fire };
    }
    const canon = ledger.filter(o => o.model.hazard === hz).map(o => Object.assign({}, o, { model: Object.assign({}, o.model, { placeId: M.placeIdOf(o.model.placeId) }) }));
    const runsC = pub.map(r => Object.assign({}, r, { checked: (r.checked || []).map(M.placeIdOf) }));
    misses += M.gradePublished(canon, observed, runsC).misses.filter(m => m.hazard === hz).length;
  }
  assert.equal(published.counts.missedDays, misses);
  /* Every graded verdict names the measurements it was graded on. */
  for (const o of published.outlooks.filter(x => x.verdict !== 'pending')) {
    assert.ok(Array.isArray(o.measured) && o.measured.length === o.windowDays, o.id + ' does not show what was measured');
  }
});

test('C3: a provisional measurement neither makes a hit nor a miss; a settled one is never revised', () => {
  /* The 27 Oct withdrawn rain hits: eight forecasts graded correct on rain
     POWER later revised away (Toronto, 16 to 18 Oct: more than 10 mm a day,
     revised to 7.5 mm, 0 and 0). Graded on provisional values, the hits
     came and went, while misses graded the same way were kept for good. */
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: '2026-06-20T10:00:00Z', places: { 'rain-town': {} } };
  const wet = dry(20); wet[9] = { tmax: 30, rain: 35, dew: 15, wind: 10 };   // 10 June
  M.mergeMeasured(archive.places['rain-town'], days, wet, '2026-06-20');      // 10 days old: provisional
  const ledger = [rainForecast('model-rain-rain-town-2026-06-10', '2026-06-10', '2026-06-10', '2026-06-08T09:00:00Z'),
    rainForecast('model-rain-rain-town-2026-06-12', '2026-06-12', '2026-06-12', '2026-06-08T09:00:00Z')];
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ledger.map(o => o.id) }];
  const clim = { places: [town()] };
  let g = M.gradeModelRecord(ledger, runs, clim, archive);
  assert.equal(g.outlooks[0].verdict, 'pending', 'a forecast was graded on a provisional measurement');
  assert.equal(g.counts.missedDays, 0);
  /* POWER revises the day before it settles: the rain was never there. */
  const revised = dry(20);
  M.mergeMeasured(archive.places['rain-town'], days, revised, '2026-06-25');  // 15 days old: settles
  g = M.gradeModelRecord(ledger, runs, clim, archive);
  assert.equal(g.outlooks[0].verdict, 'false alarm');
  /* A later fetch cannot move a settled day, in either direction. */
  M.mergeMeasured(archive.places['rain-town'], days, wet, '2026-07-01');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, archive).outlooks[0].verdict, 'false alarm');
  /* And misses follow the same rule: a provisional wet day at 11 June that
     is revised before it settles leaves no miss behind. */
  const a2 = { updatedAt: '2026-06-21T10:00:00Z', places: { 'rain-town': {} } };
  const wet11 = dry(20); wet11[10] = { tmax: 30, rain: 35, dew: 15, wind: 10 };
  M.mergeMeasured(a2.places['rain-town'], days, wet11, '2026-06-21');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a2).counts.missedDays, 0, 'a provisional day became a miss');
  M.mergeMeasured(a2.places['rain-town'], days, dry(20), '2026-06-26');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a2).counts.missedDays, 0, 'a stale miss survived the revision');
  M.mergeMeasured(a2.places['rain-town'], days, wet11, '2026-06-20');
  const a3 = { updatedAt: 'x', places: { 'rain-town': {} } };
  M.mergeMeasured(a3.places['rain-town'], days, wet11, '2026-06-26');
  assert.equal(M.gradeModelRecord(ledger, runs, clim, a3).counts.missedDays, 1, 'a settled crossing nobody forecast was not a miss');
});

test('C7: an ended forecast is graded whether or not a later run checked its place', () => {
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: 'x', places: { 'rain-town': {} } };
  M.mergeMeasured(archive.places['rain-town'], days, dry(20), '2026-07-01');
  const ledger = [rainForecast('model-rain-rain-town-2026-06-10', '2026-06-10', '2026-06-11', '2026-06-08T09:00:00Z')];
  /* Every run after the one that issued it skipped the place. */
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: [ledger[0].id] },
    { at: '2026-06-09T09:00:00Z', checked: [], leadDays: [1, 7], outlooks: [] }];
  const g = M.gradeModelRecord(ledger, runs, { places: [town()] }, archive);
  assert.equal(g.outlooks[0].verdict, 'false alarm', 'a skipped place kept its false alarm pending');
  /* And run-models measures such a place even when the forecast run skips it. */
  assert.deepEqual([...MG.needsGrading(ledger, { outlooks: [] }, '2026-06-20')], ['rain-town']);
  assert.deepEqual([...MG.needsGrading(ledger, { outlooks: [{ id: ledger[0].id, verdict: 'false alarm' }] }, '2026-06-20')], []);
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-models.js'), 'utf8');
  assert.match(src, /needsGrading/);
  assert.doesNotMatch(src, /prev && prev\.misses/, 'misses are still carried over from the previous file');
});

test('C8: overlapping re-issues are one claim, and every rate has a denominator and a chance figure', () => {
  const days = dayList('2026-06-01', 20);
  const archive = { updatedAt: 'x', places: { 'rain-town': {} } };
  const w = dry(20); w[10] = { tmax: 30, rain: 35, dew: 15, wind: 10 };       // 11 June
  M.mergeMeasured(archive.places['rain-town'], days, w, '2026-07-05');
  const ledger = [rainForecast('a', '2026-06-10', '2026-06-12', '2026-06-08T09:00:00Z'),
    rainForecast('b', '2026-06-11', '2026-06-13', '2026-06-09T09:00:00Z'),
    rainForecast('c', '2026-06-18', '2026-06-18', '2026-06-12T09:00:00Z')];
  const runs = [{ at: '2026-06-08T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['a'] },
    { at: '2026-06-09T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['b'] },
    { at: '2026-06-12T09:00:00Z', checked: ['rain-town'], leadDays: [1, 7], outlooks: ['c'] }];
  const g = M.gradeModelRecord(ledger, runs, { places: [town()] }, archive);
  assert.equal(g.counts.correct, 2, 'control: each forecast id has its own verdict');
  assert.deepEqual({ total: g.events.total, correct: g.events.correct, falseAlarms: g.events.falseAlarms }, { total: 2, correct: 1, falseAlarms: 1 },
    'two re-issues of one rainy spell counted as two successes');
  const t = g.days.rain;
  assert.equal(t.hits + t.falseAlarms + t.misses + t.correctNegatives, t.days);
  assert.equal(t.hits, 1); assert.equal(t.misses, 0);
  assert.equal(t.baseRate, Math.round(1 / t.days * 1e4) / 1e4);
  const a = g.outlooks.find(o => o.id === 'a');
  assert.equal(a.chance, Math.round((1 - Math.pow(1 - t.baseRate, 3)) * 1000) / 1000);
  assert.deepEqual(a.leadDays, [2, 4]);
});

test('C8: the confidence line quotes the lead the window covers', () => {
  const b = readData('model-backtest.json');
  const s = M.skillText(b, 'heat', 1, 7);
  assert.match(s, /days 1 to 7 ahead/);
  assert.match(s, /tested only on forecasts made 3 and 5 days ahead/);
  assert.match(s, /beyond 5 ahead were not tested/);
  assert.doesNotMatch(s, new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"));
  assert.match(M.skillText(b, 'fire', 2, 3), /only the last day/);
});

test('C11: model hazards are named for what they measure', () => {
  assert.equal(M.MODEL_HAZARDS.heat.word, 'Unusually hot days');
  assert.equal(M.MODEL_HAZARDS.rain.word, 'Unusually heavy rain');
  assert.equal(M.MODEL_HAZARDS.fire.word, 'High fire-weather index');
  const old = { title: 'Extreme heat forecast for Lima, 30 Oct to 5 Nov', model: { hazard: 'heat' } };
  assert.equal(M.modelDisplay(old).title, 'Unusually hot days forecast for Lima, 30 Oct to 5 Nov');
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-models.js'), 'utf8');
  assert.doesNotMatch(src, /usual worst/);
  assert.doesNotMatch(src, /'Heavy rain and flooding'|'Extreme heat'|'Wildfire weather'/);
});

/* ------------------------------------------------------- C2, C5, E16 */

const { renderPage } = require('./render.js');

test('C2/C5: the committed summary is what the committed ledgers give', () => {
  const { build } = require('../tools/build-accuracy-summary.js');
  const { summary, verdicts } = build();
  const committed = readData('accuracy-summary.json');
  assert.deepEqual(committed.model, summary.model, 'run node tools/build-accuracy-summary.js');
  assert.deepEqual(committed.restated, summary.restated);
  assert.deepEqual(committed.answer, summary.answer);
  const rows = readData('forecast-verdicts.json').outlooks;
  assert.equal(rows.length, verdicts.outlooks.length);
  /* One row per forecast id: OUT-gdacs-TC-1001325 was counted 23 times. */
  const ids = rows.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  const tc = rows.find(o => o.id === 'OUT-gdacs-TC-1001325');
  if (tc) assert.ok(tc.versions > 1, 'control: this forecast was recorded more than once');
  /* The restated alerts are graded on new impact: the headline holds none of
     the "still listed by the agency" hits. */
  assert.ok(summary.restated.correct + summary.restated.partlyCorrect < 20,
    'restated alerts are being credited for the agency still listing them');
  assert.equal(summary.model.issued, readData('model-ledger.json').length);
});

test('E16: /accuracy draws its headline from the summary and leaves the 8 MB of ledgers until asked', async () => {
  const r = await renderPage('accuracy.html', { timeoutMs: 20000,
    waitFor: d => (d.getElementById('aIssued') || {}).textContent !== '-' && (d.getElementById('modelRows') || {}).children.length > 1 });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const big = ['outlook-ledger.json', 'observed-disasters.json', 'scan-ledger.json'];
  for (const f of big) assert.ok(!r.apiCalls.some(u => u.includes(f)), f + ' was downloaded before anyone asked for the full record');
  assert.ok(r.apiCalls.some(u => u.includes('accuracy-summary.json')));
  assert.match(r.document.getElementById('answerLead').textContent, /forecasts in advance/);
  /* C4: every published model forecast is listed, paged, each linking to its own page. */
  const links = [...r.document.querySelectorAll('#modelRows a')].map(a => a.getAttribute('href'));
  assert.equal(links.length, 25);
  assert.ok(links.every(h => /^\/forecasts\/model-/.test(h)));
  assert.match(r.document.getElementById('modelPager').textContent, /Showing 25 of \d+/);
  /* C20: the record can be downloaded. */
  assert.ok(r.document.getElementById('csvModel'));
  assert.ok(r.document.querySelector('a[href="/data/model-ledger.json"]'));
  /* C25: the chart has a table alternative with the same figures. */
  assert.equal(r.document.querySelectorAll('#outcomeRows tr').length, 3);
  assert.equal(r.document.getElementById('outcomeChart').getAttribute('aria-hidden'), 'true');
  /* Opening the full record is what loads it. */
  const full = r.document.getElementById('fullRecord');
  full.open = true; full.dispatchEvent(new r.window.Event('toggle'));
  const until = Date.now() + 60000;
  while (Date.now() < until && (r.document.getElementById('mTotal') || {}).textContent === '-') await new Promise(x => setTimeout(x, 100));
  assert.ok(r.apiCalls.some(u => u.includes('outlook-ledger.json')));
  assert.notEqual(r.document.getElementById('mTotal').textContent, '-');
  r.close();
});

/* ------------------------------------------------ C4, C10, C11, C12, C17 */

const detail = (url, until) => renderPage('forecast-detail.html', { url, timeoutMs: 20000,
  waitFor: d => until(d) });
const visibleText = d => [...d.querySelectorAll('body *')]
  .filter(x => !x.closest('[hidden]') && !x.closest('script') && x.tagName !== 'SCRIPT' && x.children.length === 0)
  .map(x => x.textContent).join(' ');

test('C4/C10: a model forecast opens from the model ledger, in its own template', async () => {
  const r = await detail('/forecasts/model-heat-mumbai-in-2026-10-15', d => (d.getElementById('mdRows') || {}).children.length > 0);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  assert.notEqual(d.getElementById('title').textContent, 'Forecast not found');
  assert.match(d.getElementById('title').textContent, /^Unusually hot days forecast for Mumbai/);
  /* C7: graded although every run since skipped Mumbai. */
  assert.equal(d.getElementById('state').textContent, 'False alarm');
  assert.equal(d.getElementById('mdRows').children.length, 2, 'the window is 2 days, one row each');
  const text = visibleText(d);
  for (const bad of [/lives lost/i, /within 1,000 km/i, /follows a report/i, /120 hours/, /Set to India/, /usual worst/i, /outdoor workers/i]) {
    assert.doesNotMatch(text, bad, 'the model template still says ' + bad);
  }
  assert.match(d.getElementById('mdWhere').textContent, /one .*grid cell/i);
  assert.match(d.getElementById('mdDays').textContent, /2 days/);
  assert.match(d.getElementById('mdRule').textContent, /not checked against reported disasters/i);
  assert.match(d.getElementById('mdSkill').textContent, /days? 1 to 2 ahead|day 1 ahead/);
  r.close();
});

test('C12: an outlook shows the same verdict as /accuracy', async () => {
  const rows = readData('forecast-verdicts.json').outlooks.filter(o => o.state === 'FALSE_ALARM' || o.state === 'VERIFIED');
  assert.ok(rows.length, 'control: some outlook has a verdict');
  const o = rows[0];
  const r = await detail('/forecasts/' + encodeURIComponent(o.id), d => /Checked:/.test((d.getElementById('state') || {}).textContent || ''));
  assert.equal(r.document.getElementById('state').textContent, 'Checked: ' + o.label);
  r.close();
});

test('C17: a bad id is a not-found page that asks not to be indexed, and no id is not ND-001', async () => {
  let r = await detail('/forecasts/does-not-exist', d => /not found/.test(d.getElementById('title').textContent));
  assert.equal(r.document.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex');
  r.close();
  r = await detail('/forecast-detail', d => !/Loading/.test(d.getElementById('title').textContent));
  assert.doesNotMatch(r.document.getElementById('title').textContent, /ND-001|Bihar|Vietnam/);
  assert.equal(r.document.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex');
  r.close();
});

/* ------------------------------------------------------- C9 and A6 */

test('C9: one level function, used by the badge, the filter and the map', () => {
  global.window = global.window || undefined;
  const R = require('../risk.js');
  const H = require('../hazard-model.js');
  /* A model forecast that crossed its 99th percentile reads High, not Moderate. */
  assert.equal(R.keyFor({ forecast: true, forecastKind: 'model-advance', alert: 'High', severity: H.severityOf({ forecastKind: 'model-advance', alert: 'High' }) }), 'HIGH');
  assert.equal(R.keyFor({ forecast: true, forecastKind: 'model-advance', alert: 'Moderate' }), 'MODERATE');
  /* A super typhoon is never Low, whatever colour GDACS gave its exposure. */
  const infa = { type: 'Tropical Cyclone', title: 'Storm risk from Super Typhoon In-fa - 5-day forecast', alert: 'Watch', forecast: true };
  infa.severity = H.severityOf(infa);
  assert.equal(R.keyFor(infa), 'EXTREME');
  assert.equal(R.keyFor({ type: 'Tropical Cyclone', title: 'Typhoon X', alert: 'Green' }), 'MODERATE');
  /* An agency's impact estimate says whose it is (A6). */
  assert.equal(R.describe({ type: 'Earthquake', magnitude: 6.5, pagerAlert: 'green', severity: 'Informational', source: 'USGS' }).text,
    'Low expected impact (USGS PAGER green)');
  assert.equal(R.keyFor({ type: 'Earthquake', magnitude: 6.9, severity: 'Informational', source: 'USGS' }), 'UNKNOWN',
    'an M6.9 with no impact assessment was given a level');
  /* The map marker takes the record, and the forecast pages pass it. */
  for (const f of ['forecasts.html', 'forecast-detail.html']) {
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /riskMarker\(\[e\.lat,e\.lon\],e,/, f);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'map-setup.js'), 'utf8'), /R\.keyFor\(value\)/);
  /* One scale on the page that explains it: six levels, the storm floor. */
  const m = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.match(m, /Low, Watch, Moderate, High, Severe and Extreme/);
  assert.match(m, /super typhoon Extreme/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'forecast-detail.html'), 'utf8'), /' of 5\)'/);
});

/* ---------------------------------------------- C6, C16, C21, C22 */

test('C6: the published method describes the weather models and both kinds of forecast', () => {
  const m = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  for (const t of [/id="weather-models"|Weather models/, /Open-Meteo/, /NASA POWER/, /21 days/, /3 °C/, /2\.5 °C/, /95th percentile/, /99th percentile/,
    /21\.3/, /settled/, /14 days/, /3 and 5 days ahead/, /17 Jul to 17 Oct 2026/]) assert.match(m, t, 'methodology does not say ' + t);
  assert.doesNotMatch(m, /No made-up percentages/);
  assert.doesNotMatch(m, /Each forecast starts from an official report/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'collection.js'), 'utf8'), /Each forecast is our own estimate, based on a current official report/);
  assert.match(fs.readFileSync(path.join(ROOT, 'verification.html'), 'utf8'), /NASA POWER/);
});

test('C16: an unknown id on the verification page is a not-found page', async () => {
  const r = await renderPage('verification-detail.html', { search: '?id=nope', timeoutMs: 15000,
    waitFor: d => /not found/i.test(d.getElementById('title').textContent) });
  assert.equal(r.document.getElementById('title').textContent, 'Forecast not found');
  assert.equal(r.document.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex');
  assert.doesNotMatch(r.document.getElementById('title').textContent, /Checking forecast nope/);
  r.close();
});

test('C21: insights counts reports and forecasts apart, and its notes are not about ND-001', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'insights.html'), 'utf8');
  assert.doesNotMatch(src, /<div class="label">Events and forecasts</);
  assert.doesNotMatch(src, /Central Vietnam/);
  assert.doesNotMatch(src, /\(earthquakes\)/);
});

test('C22: copy: no repeated country, no stripped accents, one dash, one acronym expansion', () => {
  const M2 = require('../forecast-models.js');
  assert.equal(M2.placeSlug('Bogotá', 'CO'), 'bogota-co');
  assert.equal(M2.placeSlug('São Paulo', 'BR'), 'sao-paulo-br');
  assert.equal(M2.placeIdOf('bogot-co'), 'bogota-co');
  const ids = readData('climatology.json').places.map(p => p.id);
  assert.ok(ids.includes('bogota-co') && ids.includes('sao-paulo-br') && !ids.includes('bogot-co'));
  const portal = fs.readFileSync(path.join(ROOT, 'portal.js'), 'utf8');
  assert.match(portal, /\\u2012-\\u2015/, 'titleOf does not turn upstream dashes into hyphens');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'trust.js'), 'utf8'), /Geological Survey \(earthquakes\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'forecasts.html'), 'utf8'), /\[e\.region,e\.country\]\.filter\(Boolean\)\.join/, 'forecasts.html repeats the country');
  assert.match(fs.readFileSync(path.join(ROOT, 'forecast-table.js'), 'utf8'), /PND\.placeOf\(e,'Global'\)/);
});

test('C15: the calendar moves through every date, in the badges’ colours, in en-GB dates', async () => {
  const r = await renderPage('forecast-calendar.html', { timeoutMs: 20000, waitFor: d => d.querySelectorAll('.tl-bar').length > 0 });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  const next = d.querySelector('[data-cal="7"]'), prev = d.querySelector('[data-cal="-7"]');
  assert.ok(next && prev && d.querySelector('[data-cal="0"]'), 'the calendar has no way to move through the dates');
  const range = () => d.querySelector('.tl-nav [role="status"]').textContent;
  const before = range();
  if (!next.disabled) { next.click(); assert.notEqual(range(), before, 'Next week did not move the dates'); }
  for (const row of d.querySelectorAll('.tl-row')) {
    const badge = row.querySelector('.tl-label .risk'), bar = row.querySelector('.tl-bar');
    const lv = c => (String(c).match(/risk-(low|watch|moderate|high|severe|extreme|unknown)/) || [])[1];
    assert.equal(lv(bar.className), lv(badge.className), 'a bar is a different level from its badge');
  }
  for (const s of d.querySelectorAll('.tl-bar span')) assert.doesNotMatch(s.textContent, /^[A-Z][a-z]{2} \d/, 'a US-style date: ' + s.textContent);
  r.close();
});
