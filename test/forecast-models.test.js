'use strict';
/**
 * The science in forecast-models.js, checked against published values where
 * they exist and against properties that must hold where they do not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../forecast-models.js');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

test('the Fire Weather Index reproduces the standard test data (Van Wagner & Pickett 1985)', () => {
  /* Start-up codes 85 / 6 / 15 in April, northern mid-latitudes. The expected
     codes are the published reference values the cffdrs package is tested
     against: FFMC, DMC, DC, ISI, BUI, FWI. */
  const days = [
    [[17, 42, 25, 0], [87.69, 8.55, 19.01, 10.85, 8.49, 10.10]],
    [[20, 21, 25, 2.4], [86.2, 10.4, 23.6, 8.8, 10.4, 9.3]],
    [[8.5, 40, 17, 0], [87.0, 11.8, 26.1, 6.5, 11.7, 7.6]],
    [[6.5, 25, 6, 0], [88.8, 13.2, 28.2, 4.9, 13.1, 6.2]]
  ];
  let p = M.FWI_START;
  for (const [[temp, rh, wind, rain], want] of days) {
    p = M.fwiDay(p, { temp, rh, wind, rain }, 4, 46);
    const got = [p.ffmc, p.dmc, p.dc, p.isi, p.bui, p.fwi];
    const tol = want[0] === 87.69 ? 0.01 : 0.06;
    ['FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'].forEach((k, i) => near(got[i], want[i], tol, k));
  }
});

test('rain resets the fire codes, and a broken day restarts them rather than guessing', () => {
  const dry = M.fwiDay({ ffmc: 92, dmc: 60, dc: 400 }, { temp: 30, rh: 20, wind: 20, rain: 0 }, 7, 40);
  const wet = M.fwiDay({ ffmc: 92, dmc: 60, dc: 400 }, { temp: 30, rh: 20, wind: 20, rain: 40 }, 7, 40);
  assert.ok(wet.ffmc < dry.ffmc && wet.dmc < dry.dmc && wet.dc < dry.dc && wet.fwi < dry.fwi);
  const s = M.fwiSeries(['2026-07-01', '2026-07-02', '2026-07-03'],
    [{ temp: 30, rh: 20, wind: 20, rain: 0 }, { temp: NaN, rh: 20, wind: 20, rain: 0 }, { temp: 30, rh: 20, wind: 20, rain: 0 }], 40);
  assert.equal(s[1], null, 'a day with no temperature was given an index');
  assert.ok(Math.abs(s[2] - s[0]) < 1e-9, 'the chain did not restart from the standard values after the gap');
});

test('the FWI danger classes are the EFFIS ones', () => {
  assert.equal(M.fwiClass(4), 'low');
  assert.equal(M.fwiClass(21.3), 'very high');
  assert.equal(M.fwiClass(40), 'extreme');
  assert.equal(M.fwiClass(55), 'very extreme');
});

test('aftershock chances follow the generic Reasenberg-Jones model', () => {
  /* A larger aftershock than the mainshock within a week: the commonly quoted
     figure is a few to ten per cent, which the generic model gives. */
  const larger = M.rjProbability(6, 6, 0, 7);
  assert.ok(larger > 0.05 && larger < 0.15, `P(M>=6 after an M6) = ${larger}`);
  // More likely for smaller thresholds, bigger mainshocks and longer windows; never above 1.
  assert.ok(M.rjProbability(6, 5, 0, 7) > M.rjProbability(6, 6, 0, 7));
  assert.ok(M.rjProbability(7, 5, 0, 7) > M.rjProbability(6, 5, 0, 7));
  assert.ok(M.rjProbability(6, 5, 0, 30) > M.rjProbability(6, 5, 0, 7));
  assert.ok(M.rjProbability(6, 5, 7, 14) < M.rjProbability(6, 5, 0, 7), 'the rate did not decay with time');
  assert.ok(M.rjProbability(9, 4, 0, 7) <= 1);
  // Expected counts add up across adjacent windows.
  near(M.rjExpected(6.5, 5, 0, 3) + M.rjExpected(6.5, 5, 3, 7), M.rjExpected(6.5, 5, 0, 7), 1e-9, 'additivity');
});

test('quantiles, rolling sums and runs', () => {
  assert.equal(M.quantile([1, 2, 3, 4, 5], 0.5), 3);
  near(M.quantile([0, 10], 0.95), 9.5, 1e-9, 'interpolation');
  assert.equal(M.quantile([3, NaN, 1, 2], 0.5), 2, 'missing values were counted');
  assert.deepEqual(M.rollingSum([1, 2, 3, 4], 3).map(v => isFinite(v) ? v : null), [null, null, 6, 9]);
  assert.deepEqual(M.rollingSum([1, NaN, 3, 4, 5], 2).map(v => isFinite(v) ? v : null), [null, null, null, 7, 9]);
  assert.deepEqual(M.runs([false, true, true, false, true]), [[1, 2], [4, 4]]);
  assert.equal(M.dayOfYear('2024-12-31'), 366);
  assert.equal(M.dayOfYear('2025-03-01'), 60);
});

test('the seasonal threshold fit recovers a known annual cycle', () => {
  const truth = d => 25 + 8 * Math.cos(2 * Math.PI * (d - 200) / 366) + 1.5 * Math.sin(4 * Math.PI * d / 366);
  const vals = Array.from({ length: 366 }, (_, i) => truth(i + 1));
  const fit = M.fitHarmonics(vals);
  assert.equal(fit.coef.length, 1 + 2 * M.HARMONICS);
  assert.ok(fit.rms < 0.01, `rms ${fit.rms}`);
  for (const d of [1, 100, 200, 300]) near(M.harmonicAt(fit.coef, d), truth(d), 0.02, 'day ' + d);
});

test('daily percentiles pool a fifteen-day window across years', () => {
  const days = [], vals = [];
  for (let y = 2000; y < 2010; y++) for (let d = 0; d < 365; d++) {
    const t = new Date(Date.UTC(y, 0, 1) + d * 864e5).toISOString().slice(0, 10);
    days.push(t); vals.push(d % 10); // values 0..9 everywhere in the year
  }
  const p = M.dailyPercentiles(days, vals, 0.95);
  assert.equal(p.length, 366);
  assert.ok(p.slice(0, 365).every(v => v >= 8 && v <= 9), 'percentile of a uniform 0..9 pool should be near 9');
});

test("bias correction uses the recent days only, needs enough of them, and rain is corrected by a bounded ratio", () => {
  const days = Array.from({ length: 30 }, (_, i) => 'd' + i);
  const fc = days.map(() => 31), ref = days.map(() => 29);
  assert.deepEqual(M.biasDelta(days, fc, ref), { delta: 2, n: M.BIAS_WINDOW }, 'only the recent window should count');
  assert.equal(M.biasDelta(days.slice(0, 10), fc, ref).delta, null, 'corrected from too few days');
  // The recent days decide: an older season with a different gap does not.
  const shifting = days.map((_, i) => i < 9 ? 35 : 30);
  assert.equal(M.biasDelta(days, shifting, ref).delta, 1);
  // A gap larger than a correction can bridge is refused, and says so.
  const far = M.biasDelta(days, days.map(() => 34), ref, M.MAX_SHIFT_C);
  assert.equal(far.delta, null); assert.equal(far.tooLarge, 5);
  assert.equal(M.rainRatio(days, days.map(() => 1), days.map(() => 10)).ratio, 2, 'ratio was not capped');
  assert.equal(M.rainRatio(days, days.map(() => 0), days.map(() => 0)).ratio, 1);
});

/* A place whose thresholds are flat, so the models can be checked by hand. */
function flatClimate() {
  const flat = v => [v, 0, 0, 0, 0, 0, 0];
  return {
    heat: { p95: flat(40), p99: flat(43) },
    rain: { p99: Array(12).fill(50), p99x3: Array(12).fill(90) },
    fire: { p95: Array(12).fill(30) }
  };
}
const week = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];

test('heat needs two days in a row at the 95th percentile, and the 99th makes it severe', () => {
  const C = flatClimate();
  assert.deepEqual(M.heatModel(C, week, [41, 30, 41, 30, 41, 30, 41]), [], 'single hot days made an outlook');
  const out = M.heatModel(C, week, [30, 41, 42, 44, 30, 30, 30]);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, '2026-06-02'); assert.equal(out[0].end, '2026-06-04');
  assert.equal(out[0].severe, true); assert.equal(out[0].peak, 44);
  assert.equal(M.heatModel(C, week, [41, 41, 30, 30, 30, 30, 30])[0].severe, false);
});

test('rain flags one wet day or a wet three days, and wet soil makes it severe', () => {
  const C = flatClimate();
  assert.equal(M.rainModel(C, week, [0, 0, 55, 0, 0, 0, 0], 0.5).length, 1);
  assert.equal(M.rainModel(C, week, [0, 30, 30, 31, 0, 0, 0], 0.5).length, 1, 'a 91 mm three-day total was missed');
  assert.equal(M.rainModel(C, week, [0, 20, 20, 20, 0, 0, 0], 0.5).length, 0);
  assert.equal(M.rainModel(C, week, [0, 0, 55, 0, 0, 0, 0], 0.9)[0].severe, true);
  assert.equal(M.rainModel(C, week, [0, 0, 55, 0, 0, 0, 0], NaN)[0].soilPercentile, null);
});

test('fire weather needs the very-high class and the local 95th percentile', () => {
  const C = flatClimate();
  assert.equal(M.fireModel(C, week, [35, 35, 0, 0, 0, 0, 0]).length, 1);
  assert.equal(M.fireModel(C, week, [25, 25, 0, 0, 0, 0, 0]).length, 0, 'below the local percentile');
  C.fire.p95 = Array(12).fill(10);
  assert.equal(M.fireModel(C, week, [15, 15, 0, 0, 0, 0, 0]).length, 0, 'below the very-high floor');
  assert.equal(M.fireModel(C, week, [40, 40, 0, 0, 0, 0, 0])[0].severe, true);
});

test('relative humidity from dew point', () => {
  near(M.rhFrom(20, 20), 100, 0.01, 'saturated');
  near(M.rhFrom(30, 10), 28.5, 1, '30 C with a 10 C dew point');
});

/* The backtest's scoring, on made-up weather where the right answer is known. */
const BT = require('../tools/backtest-models.js');
function synthetic(warmBy) {
  const place = { lat: 40, heat: { p95: [30, 0, 0, 0, 0, 0, 0] }, rain: { p99: Array(12).fill(20) }, fire: { p95: Array(12).fill(25) } };
  const truth = {};
  for (let i = 0; i < 160; i++) {
    const d = new Date(Date.UTC(2026, 2, 1) + i * 864e5).toISOString().slice(0, 10);
    truth[d] = { tmax: 25 + 8 * Math.sin(i / 5), dew: 8, wind: 15, rain: i % 7 === 0 ? 30 : 0 };
  }
  const all = Object.keys(truth), recent = all.slice(-92);
  const series = (key, shift) => Object.fromEntries(recent.map(d => [d, truth[d][key] + (key === 'tmax' ? shift : 0)]));
  const run = shift => ({ tmax: series('tmax', shift), dew: series('dew', 0), rain: series('rain', 0), wind: series('wind', 0) });
  const arc = { now: run(warmBy) };
  for (const L of BT.LEADS) arc[L] = run(warmBy);
  const obs = d => truth[d] || { tmax: NaN, dew: NaN, wind: NaN, rain: NaN };
  return { place, arc, obs };
}

test('a perfect forecast scores perfectly in the backtest, every hazard and lead', () => {
  const { place, arc, obs } = synthetic(0);
  const T = BT.blankTallies();
  assert.ok(BT.scorePlace(place, arc, obs, T) > 0, 'no day was scored');
  for (const [k, t] of Object.entries(T)) {
    const s = BT.scores(t);
    assert.ok(s.days > 0, k + ' scored no days');
    assert.equal(t.misses, 0, k + ' missed'); assert.equal(t.falseAlarms, 0, k + ' raised a false alarm');
    if (!k.startsWith('fire')) assert.ok(t.hits > 0, k + ' had nothing to hit');
  }
});

test('the backtest removes a steady warm bias before scoring, as the live run does', () => {
  const { place, arc, obs } = synthetic(2);
  const T = BT.blankTallies();
  BT.scorePlace(place, arc, obs, T);
  for (const L of BT.LEADS) {
    const t = T['heat@' + L];
    assert.ok(t.hits > 0); assert.equal(t.falseAlarms, 0, 'a 2 C warm forecast was not corrected');
  }
});

test('the backtest scores nothing where nothing was measured, and fire needs a month of record first', () => {
  const { place, arc } = synthetic(0);
  const none = () => ({ tmax: NaN, dew: NaN, wind: NaN, rain: NaN });
  assert.equal(BT.scorePlace(place, arc, none, BT.blankTallies()), 0);
  // Measurements only from the archive's first day: too short a chain for fire on its early days.
  const { obs } = synthetic(0), first = Object.keys(arc.now.tmax).sort()[0];
  const T = BT.blankTallies();
  BT.scorePlace(place, arc, d => d >= first ? obs(d) : none(), T);
  const fireDays = BT.scores(T['fire@3']).days, heatDays = BT.scores(T['heat@3']).days;
  assert.ok(fireDays < heatDays, 'fire was scored without a month of measured weather behind it');
});

/* ------------------------------------------------ warming since the record */
/*
 * The heat line is each place's 95th percentile of 1996-2025, a record whose
 * middle is 2011. Over 12 Jul to 12 Oct 2026 it was crossed on 14% of days
 * tested, not 5%: the climate the line was drawn from is fifteen years cooler
 * than the one it is applied to. The record's own warming trend, fitted to
 * 1996-2025 alone, moves the line to the year it is used in.
 */
function warmingRecord(perYear, years) {
  const days = [], tmax = [];
  for (let y = 1996; y < 1996 + years; y++) {
    for (let d = 0; d < 365; d++) {
      const t = Date.UTC(y, 0, 1) + d * 864e5;
      days.push(new Date(t).toISOString().slice(0, 10));
      /* A seasonal cycle, a steady trend, and day-to-day noise that repeats each year. */
      tmax.push(25 + 8 * Math.sin(2 * Math.PI * d / 365) + perYear * (y + d / 365 - 2011) + 3 * Math.sin(d * 1.7));
    }
  }
  return { days, tmax };
}

test('the warming trend is fitted from the record alone, robustly', () => {
  const r = warmingRecord(0.04, 30);
  const t = M.warmingTrend(r.days, r.tmax);
  near(t.perYear, 0.04, 0.003, 'trend per year');
  near(t.refYear, 2011, 0.01, 'middle of the record');
  assert.equal(t.years, 30);
  /* One freak year does not drag a median-of-slopes fit. */
  const bad = r.tmax.slice(); for (let i = 0; i < 365; i++) bad[i] += 6;
  near(M.warmingTrend(r.days, bad).perYear, 0.04, 0.006, 'trend with one outlier year');
  /* Too short a record gives no trend rather than a guess. */
  const short = warmingRecord(0.04, 15);
  assert.equal(M.warmingTrend(short.days, short.tmax), null);
  /* A year with weeks missing is not a year. */
  const gappy = r.tmax.slice(); for (let i = 0; i < 365 * 30; i++) if (i % 365 < 40) gappy[i] = NaN;
  assert.equal(M.warmingTrend(r.days, gappy), null, 'years with 40 days missing were averaged');
});

test('the heat line moves by the trend to the year it is used in, within bounds', () => {
  const C = { heat: { trend: { perYear: 0.04, refYear: 2011 } } };
  near(M.heatShift(C, '2026-07-02'), 0.04 * (2026 + 182.5 / 365 - 2011), 0.005, 'shift in July 2026');
  assert.equal(M.heatShift({ heat: {} }, '2026-07-02'), 0, 'no trend, no shift');
  assert.equal(M.heatShift({ heat: { trend: { perYear: 1, refYear: 2011 } } }, '2026-07-02'), M.MAX_HEAT_SHIFT_C);
  assert.equal(M.heatShift({ heat: { trend: { perYear: -1, refYear: 2011 } } }, '2026-07-02'), -M.MAX_HEAT_SHIFT_C);
});

test('the heat model judges the coming week against the shifted line', () => {
  const C = flatClimate();
  /* 41 °C is past a 40 °C line, but not past one moved up by about 1.5 °C. */
  assert.equal(M.heatModel(C, week, [41, 41, 30, 30, 30, 30, 30]).length, 1);
  C.heat.trend = { perYear: 0.1, refYear: 2011 };
  assert.deepEqual(M.heatModel(C, week, [41, 41, 30, 30, 30, 30, 30]), [], 'the shift was ignored');
  const out = M.heatModel(C, week, [42, 42, 30, 30, 30, 30, 30]);
  assert.equal(out.length, 1);
  near(out[0].detail[0].p95, 40 + M.heatShift(C, '2026-06-01'), 0.05, 'the recorded line is the shifted one');
});

test('the backtest moves the line for the forecast and the observation alike', () => {
  const { place, arc, obs } = synthetic(0);
  const plain = BT.blankTallies(); BT.scorePlace(place, arc, obs, plain);
  const warmed = Object.assign({}, place, { heat: Object.assign({}, place.heat, { trend: { perYear: 0.1, refYear: 2011 } }) });
  const moved = BT.blankTallies(); BT.scorePlace(warmed, arc, obs, moved);
  for (const L of BT.LEADS) {
    const a = plain['heat@' + L], b = moved['heat@' + L];
    assert.ok(b.hits + b.misses < a.hits + a.misses, 'a higher line was crossed as often');
    assert.equal(b.misses + b.falseAlarms, 0, 'forecast and observation were judged against different lines');
  }
});

/* --------------------------------------------- grading published forecasts */
/*
 * Model forecasts are published on /forecasts. Each is graded once its days
 * have been measured, by the rule it carries: correct if the line was crossed
 * on at least one day of its window, a false alarm if not. A crossing the
 * models were watching for and did not forecast is a miss. "Crossing" is the
 * models' own event, read off the measurements: two hot days in a row past
 * the heat line, a day or three days of rain past the rain line, two days in
 * a row of fire weather.
 */
const heatPlace = () => Object.assign(flatClimate(), { id: 'x-city' });
const days10 = Array.from({ length: 10 }, (_, i) => '2026-06-' + String(i + 1).padStart(2, '0'));

test('observed events are the models\' own events, found in the measurements', () => {
  const C = heatPlace();
  const tmax = [30, 41, 41, 30, 41, 30, 30, 30, 42, 42];
  const ev = M.observedEvents(C, days10, { tmax, rain: Array(10).fill(0), fwi: Array(10).fill(0) });
  assert.deepEqual([...ev.heat].sort(), ['2026-06-02', '2026-06-03', '2026-06-09', '2026-06-10'], 'a lone hot day counted, or a pair was lost');
  assert.equal(ev.rain.size, 0);
  const wet = M.observedEvents(C, days10, { tmax: Array(10).fill(30), rain: [0, 60, 0, 0, 0, 0, 0, 0, 0, 0], fwi: Array(10).fill(0) });
  assert.deepEqual([...wet.rain], ['2026-06-02']);
});

test('a published forecast is graded by its own window, and waits until every day is measured', () => {
  const ledger = [
    { id: 'hit', model: { hazard: 'heat', placeId: 'x-city' }, issuedAt: '2026-05-31T20:00:00Z', targetStart: '2026-06-02T00:00:00Z', targetEnd: '2026-06-04T23:59:59Z' },
    { id: 'false', model: { hazard: 'heat', placeId: 'x-city' }, issuedAt: '2026-05-31T20:00:00Z', targetStart: '2026-06-05T00:00:00Z', targetEnd: '2026-06-07T23:59:59Z' },
    { id: 'open', model: { hazard: 'heat', placeId: 'x-city' }, issuedAt: '2026-06-05T20:00:00Z', targetStart: '2026-06-09T00:00:00Z', targetEnd: '2026-06-12T23:59:59Z' },
    { id: 'blind', model: { hazard: 'rain', placeId: 'nowhere' }, issuedAt: '2026-05-31T20:00:00Z', targetStart: '2026-06-02T00:00:00Z', targetEnd: '2026-06-02T23:59:59Z' }
  ];
  const observed = { 'x-city': { from: '2026-06-01', through: '2026-06-10', heat: new Set(['2026-06-02', '2026-06-03', '2026-06-09', '2026-06-10']), rain: new Set(), fire: new Set() } };
  const g = M.gradePublished(ledger, observed, []);
  const v = Object.fromEntries(g.outlooks.map(o => [o.id, o.verdict]));
  assert.deepEqual(v, { hit: 'correct', false: 'false alarm', open: 'pending', blind: 'pending' });
  assert.deepEqual(g.outlooks.find(o => o.id === 'hit').crossed, ['2026-06-02', '2026-06-03']);
  assert.equal(g.counts.correct, 1); assert.equal(g.counts.falseAlarms, 1); assert.equal(g.counts.pending, 2);
});

test('a crossing the models were watching and did not forecast is a miss; one they were not watching is not', () => {
  const observed = { 'x-city': { from: '2026-06-01', through: '2026-06-10', heat: new Set(['2026-06-02', '2026-06-03', '2026-06-09', '2026-06-10']), rain: new Set(), fire: new Set() } };
  const ledger = [{ id: 'hit', model: { hazard: 'heat', placeId: 'x-city' }, issuedAt: '2026-05-31T20:00:00Z', targetStart: '2026-06-02T00:00:00Z', targetEnd: '2026-06-03T23:59:59Z' }];
  /* One run on 31 May watched days 1 to 7 ahead: 1 to 7 June. 9 and 10 June were never watched. */
  const runs = [{ at: '2026-05-31T20:00:00Z', checked: ['x-city'], leadDays: [1, 7] }];
  let g = M.gradePublished(ledger, observed, runs);
  assert.deepEqual(g.misses, [], 'an unwatched crossing was counted as a miss, or a forecast one');
  /* A second run on 3 June watched 4 to 10 June: 9 and 10 June are now misses. */
  runs.push({ at: '2026-06-03T20:00:00Z', checked: ['x-city'], leadDays: [1, 7] });
  g = M.gradePublished(ledger, observed, runs);
  assert.deepEqual(g.misses.map(m => m.day), ['2026-06-09', '2026-06-10']);
  assert.equal(g.misses[0].hazard, 'heat'); assert.equal(g.counts.missedDays, 2);
  /* A place a run skipped is not watched by it. */
  g = M.gradePublished(ledger, observed, [{ at: '2026-06-03T20:00:00Z', checked: [], leadDays: [1, 7] }]);
  assert.deepEqual(g.misses, []);
});

test('a window with an unmeasured day stays pending, and an unmeasured day is never a miss', () => {
  const measured = new Set(['2026-06-01', '2026-06-02', '2026-06-04', '2026-06-05']); // 3 June missing
  const observed = { 'x-city': { measured, heat: new Set(), rain: new Set(), fire: new Set(['2026-06-03']) } };
  const ledger = [{ id: 'gap', model: { hazard: 'heat', placeId: 'x-city' }, issuedAt: '2026-05-31T20:00:00Z', targetStart: '2026-06-02T00:00:00Z', targetEnd: '2026-06-04T23:59:59Z' }];
  const g = M.gradePublished(ledger, observed, [{ at: '2026-05-31T20:00:00Z', checked: ['x-city'], leadDays: [1, 7] }]);
  assert.equal(g.outlooks[0].verdict, 'pending', 'a window with a day nobody measured was graded a false alarm');
  assert.deepEqual(g.misses, []);
});

test('the heat explanation says which way the line moved, and says nothing for no move', () => {
  assert.equal(M.heatShiftText(0.43), ' That line is moved up 0.4 °C for the warming this place\'s record shows since its middle year.');
  assert.equal(M.heatShiftText(-0.31), ' That line is moved down 0.3 °C for the cooling this place\'s record shows since its middle year.');
  /* A move that rounds to 0.0 °C is not worth a sentence, and never reads "-0.0". */
  for (const s of [0, 0.04, -0.04, NaN, undefined, null]) assert.equal(M.heatShiftText(s), '', String(s));
  assert.doesNotMatch(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tools', 'run-models.js'), 'utf8'),
    /moved up ' \+/, 'run-models.js still builds its own "moved up" sentence');
});
