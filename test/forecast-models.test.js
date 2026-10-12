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
