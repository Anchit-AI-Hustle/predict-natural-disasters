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

/* ---------------------------------- a benchmark is the claim it froze, only */

test('the benchmark in the feed is the claim its commit froze', async () => {
  /* ND-001 was given a forecastScope nine days after the commit that froze
     it. The scope is part of what identifies a claim, so the feed presented a
     new claim under the old id - still citing that commit as proof - and the
     next run of the job recorded it as frozen on 13 September. */
  const { events } = await feed();
  const nd = events.find(e => e.id === 'ND-001');
  const rows = require(path.join(ROOT, 'data', 'outlook-ledger.json')).filter(r => r.id === 'ND-001');
  assert.equal(rows.length, 1, 'the frozen benchmark is recorded under more than one set of terms');
  assert.equal(H.claimKey(nd), H.claimKey(rows[0]),
    'the feed serves ND-001 under terms other than the ones it was frozen with');
  assert.equal(nd.locationPrecision, 'regional',
    'the corridor should still be described as a region, not a point');
});

test('a revised claim is not backdated to the commit that froze the original', () => {
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const original = ledger.find(r => r.id === 'ND-001');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-revision-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'ledger.json');
  /* The feed as it was: new terms, and the commit named as their proof. */
  const revised = Object.assign({}, original, { forecast: true, forecastScope: 'regional',
    freezeTimestamp: '2026-09-13T19:20:03Z', freezeEvidenced: true,
    freezeBasis: 'First verifiable timestamp: the commit that introduced this record.' });
  delete revised.recordedAt;
  fs.writeFileSync(eventsPath, JSON.stringify({ events: [revised] }));
  fs.writeFileSync(ledgerPath, JSON.stringify([original], null, 2));
  require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-outlooks.js'), eventsPath, ledgerPath], { stdio: 'pipe' });
  const after = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(after.length, 2, 'the revision should be recorded as its own row');
  const row = after.find(r => r.forecastScope === 'regional');
  assert.equal(row.freezeTimestamp, row.recordedAt,
    'a revision recorded today was given the freeze of the claim it revised');
  assert.match(row.freezeBasis, /Revised terms/);
  assert.deepEqual(after.find(r => r !== row), original, 'the original row was touched');
});

test('the feed does not cite a commit as proof of terms added after it', () => {
  /* The same rule where the feed attaches freezes: once the ledger holds an id
     under other terms, the record's own provenance proves those, not these. */
  const Module = require('node:module');
  const ledgerFile = require.resolve(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const apiFile = require.resolve(path.join(ROOT, 'api', 'events.js'));
  const saved = { ledger: require.cache[ledgerFile], api: require.cache[apiFile] };
  const real = require(ledgerFile).find(r => r.id === 'ND-001');
  const fake = new Module(ledgerFile);
  fake.filename = ledgerFile; fake.loaded = true;
  fake.exports = [Object.assign({}, real, { region: 'Somewhere the commit never named' })];
  require.cache[ledgerFile] = fake;
  delete require.cache[apiFile];
  return callApi(require(apiFile), '/api/events').then(r => r.json()).then(({ events }) => {
    const nd = events.find(e => e.id === 'ND-001');
    assert.equal(nd.freezeEvidenced, false,
      'the benchmark cited its commit as proof of terms the ledger records otherwise');
    assert.match(nd.freezeBasis, /earlier terms/);
  }).finally(() => {
    if (saved.ledger) require.cache[ledgerFile] = saved.ledger; else delete require.cache[ledgerFile];
    if (saved.api) require.cache[apiFile] = saved.api; else delete require.cache[apiFile];
  });
});

test('no recorded row claims a freeze from before it was written, unless it is the first for its id', () => {
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const first = new Map();
  for (const r of ledger) {
    if (!first.has(r.id) || ms(r.recordedAt) < ms(first.get(r.id).recordedAt)) first.set(r.id, r);
  }
  const backdated = ledger.filter(r => r.freezeTimestamp && ms(r.freezeTimestamp) < ms(r.recordedAt) &&
    first.get(r.id) !== r);
  assert.deepEqual(backdated.map(r => r.id + ' ' + r.recordedAt), [],
    'these rows revise a recorded claim and carry a freeze older than themselves');
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

  /* A row is the claim it recorded, so that is what identifies it: an id and
     a window start are shared by every re-issue and by any revision of the
     other terms. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const key = r => H.claimKey(r);
  const was = new Map(before.map(r => [key(r), JSON.stringify(r)]));
  const changed = after.filter(r => was.has(key(r)) && was.get(key(r)) !== JSON.stringify(r));
  assert.deepEqual(changed.map(r => r.id), [], 'these recorded forecasts were edited after the fact');
  assert.equal(after.filter(r => was.has(key(r))).length, before.length, 'a recorded forecast was dropped');
  /* Every original row survives exactly as written, whatever else was added
     beside it. */
  for (const r of before) {
    assert.ok(after.some(x => JSON.stringify(x) === JSON.stringify(r)),
      'a recorded forecast no longer appears as it was written: ' + r.id);
  }

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

test('a recorded row derived from a warning is not read as a hazard we had seen', async () => {
  /* The ledger records an outlook, not the record it was derived from, and
     that record leaves the rolling feed within days - so classifying a row
     had no parent to consult and fell through to continuation-outlook, which
     says "written after the hazard existed, forecasting that it continues".
     For the 110 rows derived from National Weather Service warnings and the
     14 from volcano alert levels that is a stronger claim than the record
     supports: a warning says severe weather is EXPECTED. Measured on the
     committed ledger, 124 rows carried the wrong one of the two. */
  const ledger = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
  const derived = ledger.filter(r => r.forecastOf && !r.forecastClass &&
    r.forecastKind !== 'aftershock-sequence');
  assert.ok(derived.length > 0, 'the ledger holds no derived row written before the taxonomy');

  const fromWarning = derived.filter(r => H.WARNING_PROVIDERS.test(String(r.source || '')));
  assert.ok(fromWarning.length > 0,
    'fixture: the ledger should hold rows derived from a warning-publishing provider');
  for (const r of fromWarning.slice(0, 40)) {
    assert.equal(V.forecastClassOf(r), 'warning-derived',
      r.id + ' is derived from ' + r.source + ' and is classified ' + V.forecastClassOf(r));
  }
  /* And the rest are still continuation outlooks: this does not relabel
     everything derived. */
  const rest = derived.filter(r => !H.WARNING_PROVIDERS.test(String(r.source || '')));
  assert.ok(rest.length > 0, 'fixture: every derived row now matches a warning provider');
  for (const r of rest.slice(0, 40)) {
    assert.equal(V.forecastClassOf(r), 'continuation-outlook',
      r.id + ' is derived from ' + r.source + ' and is classified ' + V.forecastClassOf(r));
  }
  /* Neither class reaches a headline figure, so this changes no rate - it
     changes what the record says each outlook was. */
  assert.equal(fromWarning.some(r => V.headlineEligible(r)), false);
});

test('the list of warning-publishing providers is the feed\u2019s own classification', async () => {
  /* The reconstruction above reads a provider name off the row. That is only
     faithful while the feed still classifies that provider's records as
     warnings, so it is pinned here rather than left to go stale: every source
     the feed calls an official warning must be one this list knows, and every
     source it calls an observation must not be. */
  const { events } = await feed();
  const records = events.filter(e => !e.forecast);
  const warning = new Set(records.filter(e => e.evidenceState === 'official-warning')
    .map(e => e.source));
  const observed = new Set(records.filter(e => e.evidenceState === 'observed').map(e => e.source));
  assert.ok(warning.size > 0 && observed.size > 0,
    'fixture: the feed should carry both warnings and observations');
  for (const src of warning) {
    assert.equal(H.WARNING_PROVIDERS.test(src), true,
      src + ' publishes warnings, and a recorded outlook derived from it would be read as a hazard already seen');
  }
  for (const src of observed) {
    assert.equal(H.WARNING_PROVIDERS.test(src), false,
      src + ' publishes observations, and an outlook derived from it would be read as merely echoing a warning');
  }
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
  assert.equal(get('ipPrecision'), 'Cannot be calculated');
  assert.ok(Number(get('cdTotal')) > 0, 'the conditional outlooks should still be counted and shown');
  assert.match(get('ipNote'), /no hit rate for advance disaster forecasts/i);
  const note = get('classBreak');
  assert.match(note, /Follows an ongoing event: \d+/);
  assert.match(note, /Test case, not made in advance: \d+/);
  // The two performances are headed separately and never added together.
  assert.match(r.text(), /How our advance forecasts did/);
  assert.match(r.text(), /How our other forecasts did/);
  r.close();
});
