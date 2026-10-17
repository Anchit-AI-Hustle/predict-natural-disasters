#!/usr/bin/env node
'use strict';
/**
 * How often days cross the heat line under four baselines, measured on NASA
 * POWER, so the heat model's choice of line can be checked again.
 *
 *   node tools/heat-baselines.js [climatology] [last day, YYYY-MM-DD]
 *
 * For every place in the climatology (default data/climatology.json) it
 * fetches daily highs from 1996 to the last day (default 2026-10-13) and
 * counts the share of days at or above each line, in 17 Jul to 13 Oct of
 * 2026 and of 2025. Every line comes from data before 2026:
 *   A  the 95th percentile for the date over 1996-2025
 *   B  A moved by the place's own trend (forecast-models.js heatLines, used)
 *   C  the 95th percentile over 2011-2025
 *   D  the 95th percentile over 2016-2025
 *
 * Run on 17 Oct 2026, 108 places:
 *            2025    2026
 *   A        6.0%   14.1%
 *   B        3.9%   10.6%
 *   C        4.6%   13.2%
 *   D        4.5%   13.0%
 * No baseline brings 2026 near 5%: those months were hotter than any recent
 * stretch of the record, not just than its average. B is closest.
 */
const path = require('node:path');
const M = require('../forecast-models.js');

const CLIM = process.argv[2] || path.join(__dirname, '..', 'data', 'climatology.json');
const LAST = process.argv[3] || '2026-10-13';
const PERIODS = [['2026', '2026-07-17', '2026-10-13'], ['2025', '2025-07-17', '2025-10-13']];

const wait = ms => new Promise(r => setTimeout(r, ms));
async function get(u) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(u); if (r.ok) return r.json(); } catch (e) { /* retried below */ }
    await wait(2000 * (i + 1));
  }
  throw new Error('NASA POWER did not answer: ' + u);
}

(async () => {
  const clim = require(path.resolve(CLIM));
  const tot = {};
  const add = (k, hit) => { tot[k] = tot[k] || [0, 0]; tot[k][0] += hit ? 1 : 0; tot[k][1]++; };
  let n = 0, failed = 0;
  for (const p of clim.places) {
    let j;
    try {
      j = await get('https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX&community=AG&latitude=' + p.lat +
        '&longitude=' + p.lon + '&start=19960101&end=' + LAST.replace(/-/g, '') + '&format=JSON');
    } catch (e) { failed++; console.error('skipped ' + p.id + ': ' + e.message); continue; }
    const P = j.properties.parameter.T2M_MAX, keys = Object.keys(P).sort();
    const days = keys.map(k => k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8));
    /* -999 is POWER's mark for a day it has no value for: missing, not cold. */
    const t = keys.map(k => P[k] <= -900 ? NaN : P[k]);
    const fit = (a, b) => {
      const d = [], v = [];
      days.forEach((x, i) => { if (x >= a && x <= b) { d.push(x); v.push(t[i]); } });
      return M.fitHarmonics(M.dailyPercentiles(d, v, 0.95)).coef;
    };
    const A = p.heat.p95, C = fit('2011-01-01', '2025-12-31'), D = fit('2016-01-01', '2025-12-31');
    for (const [label, from, to] of PERIODS) {
      days.forEach((d, i) => {
        if (d < from || d > to || !isFinite(t[i])) return;
        const doy = M.dayOfYear(d);
        add(label + ' A 1996-2025', t[i] >= M.harmonicAt(A, doy));
        add(label + ' B A+trend', t[i] >= M.heatLines(p, d).p95);
        add(label + ' C 2011-2025', t[i] >= M.harmonicAt(C, doy));
        add(label + ' D 2016-2025', t[i] >= M.harmonicAt(D, doy));
      });
    }
    n++;
    await wait(300);
  }
  console.log('places', n, failed ? '(' + failed + ' failed)' : '');
  for (const [k, [h, d]] of Object.entries(tot).sort()) console.log(k.padEnd(18), (100 * h / d).toFixed(1) + '%', 'of', d, 'days');
})().catch(e => { console.error(e.message); process.exit(1); });
