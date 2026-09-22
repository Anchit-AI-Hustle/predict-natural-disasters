'use strict';
/*
 * Which forecasts may be called predictions.
 *
 * The project published a single hit rate over everything it had graded. Of
 * the 475 recorded forecast windows, 463 are outlooks written about hazards
 * that were already in the feed, 11 are aftershock outlooks following an
 * observed mainshock, and one is a benchmark written 19 hours after its own
 * window opened. None of them is a prediction of something nobody knew about,
 * and the published "17% (1 of 6)" was computed entirely from them.
 *
 * The other half is causality. A derived outlook inherited its window start
 * from the upstream signal's timestamp - the moment the hazard was reported,
 * which is before the outlook existed at all - so a window could be graded
 * from hours before anything had been written down.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../hazard-model.js');
const V = require('../verdicts.js');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async () => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
const CLASSES = ['independent-prospective', 'warning-derived', 'continuation-outlook',
  'post-event-conditional', 'retrospective-benchmark', 'invalid-post-event'];
const ms = v => Date.parse(v || '');

/* -------------------------------------------- every forecast gets a class */

test('the taxonomy is exactly the six classes, and only one reaches a headline', () => {
  assert.deepEqual(Object.keys(H.FORECAST_CLASSES).sort(), CLASSES.slice().sort());
  const headline = Object.keys(H.FORECAST_CLASSES).filter(k => H.FORECAST_CLASSES[k].headline);
  assert.deepEqual(headline, ['independent-prospective'],
    'something other than an independent prospective forecast may reach the headline figure');
});

test('every forecast the feed serves is classified, and says why', async () => {
  const { events, meta } = await feed();
  const forecasts = events.filter(e => e.forecast);
  assert.ok(forecasts.length > 5, 'fixture should contain forecasts');
  const unclassified = forecasts.filter(e => !CLASSES.includes(e.forecastClass));
  assert.deepEqual(unclassified.map(e => e.title + ' -> ' + e.forecastClass), [],
    'these forecasts carry no recognised class');
  const unexplained = forecasts.filter(e => !e.classificationReason);
  assert.deepEqual(unexplained.map(e => e.title), [], 'a classification with no stated reason cannot be checked');
  const rollup = forecasts.reduce((m, e) => { m[e.forecastClass] = (m[e.forecastClass] || 0) + 1; return m; }, {});
  assert.deepEqual(meta.forecastClass, rollup, 'meta counts a different set than it serves');
});

test('a forecast derived from something already in the feed is never a prediction', async () => {
  const { events } = await feed();
  const derived = events.filter(e => e.forecast && e.forecastOf);
  assert.ok(derived.length > 0, 'fixture should contain derived outlooks');
  // Without this the test passes on a feed that answers the question nowhere,
  // which is the state it was written against.
  for (const e of derived) {
    assert.equal(typeof e.countsTowardHeadlineAccuracy, 'boolean',
      e.title + ' does not say whether it counts toward the headline figure');
  }
  const claiming = derived.filter(e => e.countsTowardHeadlineAccuracy);
  assert.deepEqual(claiming.map(e => e.title), [],
    'an outlook derived from a hazard already reported was counted as an independent prediction');
});

test('an aftershock outlook is conditional on the quake it followed', async () => {
  const { events } = await feed();
  const after = events.filter(e => e.forecastKind === 'aftershock-sequence');
  assert.ok(after.length > 0, 'fixture should contain aftershock outlooks');
  for (const e of after) assert.equal(e.forecastClass, 'post-event-conditional', e.title);
});

test('an outlook behind an official warning is named as warning-derived', async () => {
  const { events } = await feed();
  const byId = new Map(events.map(e => [e.id, e]));
  const fromWarning = events.filter(e => e.forecast && e.forecastOf &&
    (byId.get(e.forecastOf) || {}).evidenceState === 'official-warning');
  assert.ok(fromWarning.length > 0, 'fixture should contain an outlook derived from a warning');
  for (const e of fromWarning) assert.equal(e.forecastClass, 'warning-derived', e.title);
});

test('the frozen benchmark is a benchmark and counts toward no prediction figure', async () => {
  const { events } = await feed();
  const nd = events.find(e => e.id === 'ND-001');
  assert.ok(nd, 'the frozen benchmark should still be served');
  assert.equal(nd.forecastClass, 'retrospective-benchmark');
  assert.equal(nd.countsTowardHeadlineAccuracy, false);
  // Its own record says it was written after the window opened; the classifier
  // must not be reading that from the window, which is the part a later edit
  // could move.
  assert.ok(ms(nd.freezeTimestamp) > ms(nd.targetStart),
    'control: this benchmark is only interesting because its freeze is after its window opened');
});

/* --------------------------------------------------------------- causality */

test('a forecast is only credited from the moment it can be shown to have existed', async () => {
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast && e.targetStart && e.freezeTimestamp);
  assert.ok(forecasts.length > 0);
  for (const e of forecasts) {
    const expected = Math.max(ms(e.targetStart), ms(e.freezeTimestamp));
    assert.equal(ms(e.effectiveForecastStart), expected,
      e.title + ': effective start is not max(targetStart, freezeTimestamp)');
    assert.ok(ms(e.effectiveForecastStart) >= ms(e.freezeTimestamp),
      e.title + ': credited from before anything recorded it');
  }
});

test('an observation before the freeze cannot verify the forecast', () => {
  const f = { targetStart: '2026-09-11T00:00:00Z', targetEnd: '2026-09-18T00:00:00Z',
    freezeTimestamp: '2026-09-15T12:54:01Z' };
  assert.equal(H.effectiveForecastStart(f), '2026-09-15T12:54:01Z');
  assert.equal(H.observationCanVerify(f, '2026-09-12T00:00:00Z'), false,
    'an impact observed before the forecast was written verified it');
  assert.equal(H.observationCanVerify(f, '2026-09-16T00:00:00Z'), true);
  assert.equal(H.observationCanVerify(f, '2026-09-20T00:00:00Z'), false, 'after the window');
  // The claimed window is 168 h; only what follows the freeze may be credited.
  assert.equal(Math.round(H.creditedWindowHours(f)), 59);
  assert.equal(Math.round((ms(f.targetEnd) - ms(f.targetStart)) / 3600e3), 168,
    'control: the record claims a 168-hour window');
});

test('the freeze is the earliest proof, not the first one to hand', async () => {
  const { events } = await feed();
  const nd = events.find(e => e.id === 'ND-001');
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const row = ledger.find(r => r.id === 'ND-001');
  assert.ok(row, 'the benchmark should also be in the outlook ledger');
  assert.ok(ms(nd.freezeTimestamp) <= ms(row.recordedAt),
    'the ledger row was taken as the freeze although the record names an earlier commit');
  assert.match(nd.freezeBasis, /commit/i, 'the basis should name the earlier record it used');
  assert.equal(nd.freezeEvidenced, true);
});

test('a freeze nothing can check is never treated as a prediction', () => {
  const unproven = { forecast: true, targetStart: '2099-01-01T00:00:00Z',
    freezeTimestamp: '2026-01-01T00:00:00Z', freezeEvidenced: false };
  assert.equal(H.classifyForecast(unproven).forecastClass, 'invalid-post-event');
  // The same record, once something records it, is a prediction.
  const proven = Object.assign({}, unproven, { freezeEvidenced: true });
  assert.equal(H.classifyForecast(proven).forecastClass, 'independent-prospective');
});

test('the feed marks which freezes are evidenced and which are only a clock reading', async () => {
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast);
  for (const e of forecasts) {
    assert.equal(typeof e.freezeEvidenced, 'boolean', e.title + ' does not say whether its freeze is evidenced');
    assert.ok(e.freezeBasis, e.title + ' gives no basis for its freeze');
  }
  assert.ok(forecasts.some(e => e.freezeEvidenced === true), 'nothing in the feed has an evidenced freeze');
});

/* ------------------------------------------------------------- the ledger */

test('recording a forecast never edits one already recorded', async () => {
  const { events } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-ledger-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'ledger.json');
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'outlook-ledger.json'), 'utf8'));
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify(before, null, 2));

  require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-outlooks.js'), eventsPath, ledgerPath], { stdio: 'pipe' });
  const after = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  const key = r => String(r.id) + '@' + String(r.targetStart);
  const was = new Map(before.map(r => [key(r), JSON.stringify(r)]));
  const changed = after.filter(r => was.has(key(r)) && was.get(key(r)) !== JSON.stringify(r));
  assert.deepEqual(changed.map(key), [], 'these recorded forecasts were edited after the fact');
  assert.equal(after.filter(r => was.has(key(r))).length, before.length, 'a recorded forecast was dropped');

  const added = after.filter(r => !was.has(key(r)));
  assert.ok(added.length > 0, 'nothing new was recorded, so this proves nothing');
  for (const r of added) {
    assert.ok(CLASSES.includes(r.forecastClass), 'a new row carries no class: ' + r.id);
    assert.ok(r.freezeTimestamp, 'a new row carries no freeze: ' + r.id);
    assert.ok(ms(r.effectiveForecastStart) >= ms(r.freezeTimestamp),
      'a new row is credited from before its own freeze: ' + r.id);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a row recorded before the taxonomy existed is still classified on read', () => {
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const old = ledger.filter(r => !r.forecastClass);
  assert.ok(old.length > 0, 'the ledger should still hold rows written before the taxonomy');
  const unclassified = old.filter(r => !CLASSES.includes(V.forecastClassOf(r)));
  assert.deepEqual(unclassified.slice(0, 5).map(r => r.id), [],
    'these recorded forecasts cannot be placed in the taxonomy');
  // And none of them is silently promoted.
  const promoted = old.filter(r => V.headlineEligible(r));
  assert.deepEqual(promoted.map(r => r.id), [],
    'a row with no recorded class was counted as an independent prediction');
});

/* ------------------------------------------------------- what is published */

test('the published hit rate is not a prediction hit rate', async () => {
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const ver = require(path.join(ROOT, 'data', 'verification-ledger.json'));
  const joined = V.joinVerdicts(ledger, ver.verifications || []);
  const observed = (ver.observedEvents || []).map(x => Object.assign({}, x, { status: x.status || 'MISSED_EVENT' }));
  const records = joined.records.concat(observed);
  const parts = V.partitionByClass(records);
  const now = Date.now();

  const mixed = V.tally(records, now);
  const headline = V.tally(parts.headline, now);
  const conditional = V.tally(parts.conditional, now);

  assert.ok(mixed.graded > 0, 'control: something has been graded');
  assert.equal(headline.graded, 0,
    'if an independent prediction has now been graded, this page must start reporting it');
  assert.equal(conditional.graded, mixed.graded,
    'every graded record today is a conditional or retrospective forecast');
  assert.equal(headline.precision.pct, null, 'a prediction hit rate was computed from no predictions');
  assert.ok(conditional.precision.pct !== null, 'control: the conditional rate is computable');
});

test('the accuracy page separates predictions from conditional forecasts', async () => {
  const r = await renderPage('accuracy.html', {
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '\u2014'
  });
  const get = id => (r.document.getElementById(id) || {}).textContent;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  // Nothing this project has recorded is an independent prospective
  // prediction, and the page must say so rather than borrowing the
  // conditional outlooks' record to stand in for one.
  assert.equal(get('ipTotal'), '0');
  assert.equal(get('ipPrecision'), 'Not computable');
  assert.ok(Number(get('cdTotal')) > 0, 'the conditional outlooks should still be counted and shown');
  assert.match(get('ipNote'), /no prediction hit rate/i);
  const note = get('classBreak');
  assert.match(note, /Continuation outlook: \d+/);
  assert.match(note, /Retrospective benchmark: \d+/);
  // The two performances are headed separately and never added together.
  assert.match(r.text(), /Independent prediction performance/);
  assert.match(r.text(), /Conditional \/ continuation outlook performance/);
  r.close();
});
