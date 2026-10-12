#!/usr/bin/env node
'use strict';
/**
 * How the forecast models would have done over the last three months, with
 * forecasts that were really issued at the time.
 *
 *   node tools/backtest-models.js [climatology.json] [out.json]
 *
 * Open-Meteo keeps what its forecast said one to seven days before each hour
 * (the "previous runs" archive). For every place and every day of the last
 * ~90, this takes the forecast issued 3 days and 5 days before, corrects it
 * exactly as the live run does - with only the measurements that existed on
 * the day it was issued, POWER being about three days behind - and asks the
 * same questions the models ask: a day at the 95th percentile for heat, at
 * the 99th for rain, a Fire Weather Index at "very high" and the 95th.
 * Then it compares each answer with what NASA POWER measured that day.
 *
 * The result is a contingency table per hazard and lead time: hits, misses,
 * false alarms and correct negatives, with the standard scores - probability
 * of detection, false alarm ratio, frequency bias, critical success index.
 * It is a hindcast: it says how the method behaves, not how the published
 * forecasts did, which only the ledger can say. It is published as such.
 *
 * Day by day rather than outlook by outlook: the outlooks add a rule (two
 * hot days in a row) on top of these daily calls, and scoring the daily calls
 * keeps the sample large enough to mean something. Fire is scored with the
 * index's moisture codes carried from measured weather to the day before,
 * and the forecast used only for the day itself, which is kinder than the
 * live run; this is said in the output.
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'forecast-models.js'));

const ROOT = path.join(__dirname, '..');
const CLIM = process.argv[2] || path.join(ROOT, 'data', 'climatology.json');
const OUT = process.argv[3] || path.join(ROOT, 'data', 'model-backtest.json');
const LEADS = [3, 5], POWER_LAG = 3, PAST = 92;

const wait = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'predict-natural-disasters backtest' } });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
      if (r.status !== 429 && r.status < 500) throw last;
    } catch (e) { last = e; if (/HTTP 4(?!29)/.test(e.message)) throw e; }
    await wait(2000 * Math.pow(2, i));
  }
  throw last;
}
const ymd = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => ymd(Date.parse(d + 'T00:00:00Z') + n * 864e5);

/** Hourly archive values folded into UTC days. */
function daily(times, vals, how) {
  const by = {};
  times.forEach((t, i) => { const d = t.slice(0, 10), v = vals[i]; if (v === null || v === undefined) return; (by[d] = by[d] || []).push(v); });
  const out = {};
  for (const [d, a] of Object.entries(by)) {
    if (a.length < 20) continue; // a day with most hours missing is not a day
    out[d] = how === 'max' ? Math.max(...a) : how === 'sum' ? a.reduce((s, v) => s + v, 0) : a.reduce((s, v) => s + v, 0) / a.length;
  }
  return out;
}

async function archive(p) {
  const v = ['temperature_2m', 'dew_point_2m', 'precipitation', 'wind_speed_10m'];
  const vars = v.concat(...LEADS.map(L => v.map(x => x + '_previous_day' + L)));
  const u = 'https://previous-runs-api.open-meteo.com/v1/forecast?timezone=GMT&forecast_days=1&past_days=' + PAST +
    '&latitude=' + p.lat + '&longitude=' + p.lon + '&hourly=' + vars.join(',');
  const h = (await getJson(u)).hourly;
  const pick = suffix => ({
    tmax: daily(h.time, h['temperature_2m' + suffix], 'max'),
    dew: daily(h.time, h['dew_point_2m' + suffix], 'mean'),
    rain: daily(h.time, h['precipitation' + suffix], 'sum'),
    wind: daily(h.time, h['wind_speed_10m' + suffix], 'mean')
  });
  const out = { now: pick('') };
  for (const L of LEADS) out[L] = pick('_previous_day' + L);
  return out;
}

async function measured(p, from, to) {
  const c = d => d.replace(/-/g, '');
  const u = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,PRECTOTCORR,T2MDEW,WS10M' +
    '&community=AG&latitude=' + p.lat + '&longitude=' + p.lon + '&start=' + c(from) + '&end=' + c(to) + '&format=JSON';
  const P = (await getJson(u)).properties.parameter;
  const v = (k, d) => { const x = P[k][c(d)]; return x === undefined || x <= -900 ? NaN : x; };
  return d => ({ tmax: v('T2M_MAX', d), rain: v('PRECTOTCORR', d), dew: v('T2MDEW', d), wind: v('WS10M', d) * 3.6 });
}

const blank = () => ({ hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0 });
function tally(t, fc, obs) {
  if (fc && obs) t.hits++; else if (!fc && obs) t.misses++; else if (fc && !obs) t.falseAlarms++; else t.correctNegatives++;
}
function scores(t) {
  const n = t.hits + t.misses + t.falseAlarms + t.correctNegatives;
  const obs = t.hits + t.misses, fc = t.hits + t.falseAlarms;
  const r = v => v === null ? null : Math.round(v * 1000) / 1000;
  return Object.assign({}, t, {
    days: n, observedRate: n ? r(obs / n) : null, forecastRate: n ? r(fc / n) : null,
    pod: obs ? r(t.hits / obs) : null, far: fc ? r(t.falseAlarms / fc) : null,
    frequencyBias: obs ? r(fc / obs) : null, csi: (t.hits + t.misses + t.falseAlarms) ? r(t.hits / (t.hits + t.misses + t.falseAlarms)) : null
  });
}

/* The fire index needs this many days of unbroken measured weather before the
   day it is scored on: the drought code takes weeks to forget its start-up
   values, so a chain restarted the week before would score the start-up. */
const FIRE_SPINUP = 30, FIRE_CHAIN = 60;

/**
 * Score one place: every day in the previous-runs archive, at every lead.
 * arc is { now: {tmax, dew, rain, wind}, 3: {...}, 5: {...} }, each a map of
 * day -> value; obs(day) gives what POWER measured, NaN where it has nothing.
 * Adds to the tallies in T and returns how many days it scored.
 */
function scorePlace(p, arc, obs, T) {
  let scored = 0;
  const days = Object.keys(arc.now.tmax).sort();
  for (const L of LEADS) {
    for (const D of days) {
      const issue = addDays(D, -L);
      const lastMeasured = addDays(issue, -POWER_LAG);
      // The correction, from the days the run would have had on the issue date.
      const win = []; for (let k = 40; k >= 0; k--) win.push(addDays(lastMeasured, -k));
      const bt = M.biasDelta(win, win.map(d => arc.now.tmax[d]), win.map(d => obs(d).tmax), M.MAX_SHIFT_C);
      const rr = M.rainRatio(win, win.map(d => arc.now.rain[d]), win.map(d => obs(d).rain));
      const f = arc[L], o = obs(D);
      if (!f || !isFinite(o.tmax)) continue;
      const doy = M.dayOfYear(D), m = M.monthOf(D) - 1;
      // Heat
      if (bt.delta !== null && isFinite(f.tmax[D])) {
        const p95 = M.harmonicAt(p.heat.p95, doy);
        tally(T['heat@' + L], f.tmax[D] - bt.delta >= p95, o.tmax >= p95); scored++;
      }
      // Rain
      const one = p.rain.p99[m];
      if (rr.ratio !== null && isFinite(f.rain[D]) && isFinite(o.rain) && one !== null) {
        const thr = Math.max(one, 10);
        tally(T['rain@' + L], f.rain[D] * rr.ratio >= thr, o.rain >= thr); scored++;
      }
      // Fire: codes from measured weather to the day before, then one day.
      const p95f = p.fire.p95[m];
      if (bt.delta !== null && p95f !== null && isFinite(f.tmax[D]) && isFinite(f.dew[D]) && isFinite(f.wind[D]) && isFinite(f.rain[D])) {
        const chainDays = []; for (let k = FIRE_CHAIN; k >= 1; k--) chainDays.push(addDays(D, -k));
        let st = M.FWI_START, clean = 0;
        for (const d of chainDays) {
          const w = obs(d), rh = M.rhFrom(w.tmax, w.dew);
          if (![w.tmax, rh, w.wind, w.rain].every(isFinite)) { st = M.FWI_START; clean = 0; continue; }
          st = M.fwiDay(st, { temp: w.tmax, rh, wind: w.wind, rain: w.rain }, M.monthOf(d), p.lat); clean++;
        }
        if (clean >= FIRE_SPINUP && [o.tmax, o.dew, o.wind, o.rain].every(isFinite)) {
          const t = f.tmax[D] - bt.delta, dw = f.dew[D];
          const fcDay = M.fwiDay(st, { temp: t, rh: M.rhFrom(t, dw), wind: f.wind[D], rain: f.rain[D] * (rr.ratio || 1) }, m + 1, p.lat);
          const obDay = M.fwiDay(st, { temp: o.tmax, rh: M.rhFrom(o.tmax, o.dew), wind: o.wind, rain: o.rain }, m + 1, p.lat);
          const thr = Math.max(p95f, M.FIRE_FLOOR);
          tally(T['fire@' + L], fcDay.fwi >= thr, obDay.fwi >= thr); scored++;
        }
      }
    }
  }
  return scored;
}

function blankTallies() {
  const T = {};
  for (const hz of ['heat', 'rain', 'fire']) for (const L of LEADS) T[hz + '@' + L] = blank();
  return T;
}

async function main() {
  const clim = JSON.parse(fs.readFileSync(CLIM, 'utf8'));
  const today = ymd(Date.now());
  const T = blankTallies();
  const skipped = [];
  let places = 0;
  const queue = clim.places.slice();
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        const arc = await archive(p);
        // Far enough back for the fire chain behind the oldest archived day.
        const obs = await measured(p, addDays(today, -PAST - FIRE_CHAIN - 5), today);
        if (scorePlace(p, arc, obs, T) === 0) throw new Error('no day could be scored');
        places++;
      } catch (e) { skipped.push({ id: p.id, why: e.message }); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const out = {
    note: 'Hindcast by tools/backtest-models.js: forecasts Open-Meteo really issued 3 and 5 days ahead, corrected as the live run corrects them with only the measurements available at issue time, scored day by day against NASA POWER. It shows how the method behaves; it is not the record of published forecasts.',
    generatedAt: new Date().toISOString(), climatologyPeriod: clim.period, places, skipped,
    window: { from: addDays(today, -PAST), to: today, leadsDays: LEADS },
    fireNote: 'Fire is scored with the index codes carried from at least ' + FIRE_SPINUP + ' days of measured weather to the day before, and the forecast used for the day itself only.',
    results: Object.fromEntries(Object.entries(T).map(([k, t]) => [k, scores(t)]))
  };
  console.log('backtest: ' + places + ' places, ' + skipped.length + ' skipped');
  for (const [k, r] of Object.entries(out.results)) {
    console.log(k.padEnd(8) + ' days ' + r.days + '  observed ' + r.observedRate + '  forecast ' + r.forecastRate +
      '  POD ' + r.pod + '  FAR ' + r.far + '  bias ' + r.frequencyBias + '  CSI ' + r.csi);
  }
  for (const s of skipped.slice(0, 10)) console.log('  skipped ' + s.id + ': ' + s.why);
  /* Scores from a few places would be read as the method's scores. Refuse to
     write them rather than publish a backtest of almost nothing. */
  if (places < clim.places.length / 2) throw new Error('only ' + places + ' of ' + clim.places.length + ' places could be scored; not writing ' + OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
}

module.exports = { scorePlace, blankTallies, scores, daily, LEADS, POWER_LAG };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
