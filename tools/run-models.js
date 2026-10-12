#!/usr/bin/env node
'use strict';
/**
 * Run the forecast models: the coming week against each place's own history.
 *
 *   node tools/run-models.js [climatology.json] [out.json] [runs.json]
 *
 * For every place in the climatology:
 *
 *  1. the next nine days, plus the last sixty, from the Open-Meteo forecast
 *     API (daily maximum temperature, rain, mean dew point, mean 10 m wind);
 *  2. the last sixty days from NASA POWER, the dataset the thresholds were
 *     built from, including how wet the topsoil is;
 *  3. the two compared over the days both cover, and the average difference
 *     removed from the forecast (forecast-models.js, biasDelta), so the coming
 *     week is judged on the same scale as the thirty years behind it;
 *  4. the heat, rain and fire-weather models run on days 1 to 7 ahead.
 *
 * Whatever they flag is written to out.json as a forecast whose window starts
 * no earlier than the next UTC day. The refresh job records it in the
 * append-only ledger in the same commit, so the ledger row - which is the
 * proof it was made in advance - always predates the window it names.
 *
 * Every run, including one that flags nothing, is appended to runs.json with
 * what was checked and what was skipped and why. That is what lets a missed
 * event be told apart from a place that was not being watched.
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'forecast-models.js'));

const ROOT = path.join(__dirname, '..');
const CLIM = process.argv[2] || path.join(ROOT, 'data', 'climatology.json');
const OUT = process.argv[3] || path.join(ROOT, 'data', 'model-outlooks.json');
const RUNS = process.argv[4] || path.join(ROOT, 'data', 'model-runs.json');
const PAST = 60, AHEAD = 9, LEAD_MIN = 1, LEAD_MAX = 7, MAX_RUNS_KEPT = 1000;

const wait = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'predict-natural-disasters forecast models' } });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status);
      if (r.status !== 429 && r.status < 500) throw last;
    } catch (e) { last = e; if (/HTTP 4(?!29)/.test(e.message)) throw e; }
    await wait(1500 * Math.pow(2, i));
  }
  throw last || new Error('no answer');
}
const ymd = t => new Date(t).toISOString().slice(0, 10);
const compact = d => d.replace(/-/g, '');

/** The forecast service's days for a batch of places, past and future. */
async function forecasts(places) {
  const u = 'https://api.open-meteo.com/v1/forecast?timezone=GMT&past_days=' + PAST + '&forecast_days=' + AHEAD +
    '&daily=temperature_2m_max,precipitation_sum,dew_point_2m_mean,wind_speed_10m_mean' +
    '&latitude=' + places.map(p => p.lat).join(',') + '&longitude=' + places.map(p => p.lon).join(',');
  const j = await getJson(u);
  return (Array.isArray(j) ? j : [j]).map(x => x.daily);
}

/** POWER's record of the same recent days. */
async function recent(p, from, to) {
  const u = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,PRECTOTCORR,T2MDEW,WS10M,GWETTOP' +
    '&community=AG&latitude=' + p.lat + '&longitude=' + p.lon + '&start=' + compact(from) + '&end=' + compact(to) + '&format=JSON';
  const P = (await getJson(u)).properties.parameter;
  const v = (k, d) => { const x = P[k] && P[k][compact(d)]; return x === undefined || x <= -900 ? NaN : x; };
  return { tmax: d => v('T2M_MAX', d), rain: d => v('PRECTOTCORR', d), dew: d => v('T2MDEW', d), wind: d => v('WS10M', d) * 3.6, soil: d => v('GWETTOP', d) };
}

function soilPercentile(clim, days, ref) {
  for (let i = days.length - 1; i >= 0; i--) {
    const s = ref.soil(days[i]);
    if (isFinite(s)) {
      const dec = clim.soil.deciles[M.monthOf(days[i]) - 1];
      if (!dec) return { p: NaN, day: days[i], value: s };
      return { p: dec.filter(q => q <= s).length / 10, day: days[i], value: M.round(s, 3) };
    }
  }
  return { p: NaN };
}

const HAZARD = {
  heat: { type: 'Extreme Heat', word: 'Extreme heat', unit: '°C', what: 'daily maximum temperature' },
  rain: { type: 'Flood', word: 'Heavy rain and flooding', unit: 'mm', what: 'rainfall' },
  fire: { type: 'Wildfire', word: 'Wildfire weather', unit: '', what: 'Fire Weather Index' }
};

const fmtDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function span(a, b) { return a === b ? fmtDay(a) : fmtDay(a) + ' to ' + fmtDay(b); }

/** The forecast record for one flagged run of days. */
function outlook(place, f, ctx) {
  const H = HAZARD[f.hazard];
  const where = place.name + (place.admin1 && place.admin1 !== place.name ? ', ' + place.admin1 : '') + ', ' + place.country;
  const days = f.detail.map(d => {
    if (f.hazard === 'heat') return fmtDay(d.day) + ': ' + d.value + ' °C against a usual worst of ' + d.p95 + ' °C';
    if (f.hazard === 'rain') return fmtDay(d.day) + ': ' + d.value + ' mm' + (d.threeDay !== null ? ' (' + d.threeDay + ' mm over three days)' : '') +
      ' against a usual worst of ' + d.p99 + ' mm in a day and ' + d.p99x3 + ' mm over three days';
    return fmtDay(d.day) + ': index ' + d.value + ' (' + d.level + ') against a usual worst of ' + d.p95;
  });
  const why = {
    heat: 'Forecast daily highs, corrected by ' + ctx.deltaT.toFixed(1) + ' °C for the difference between the forecast service and the 30-year record, reach this place\'s 95th percentile for the time of year on ' + f.days + ' days in a row' + (f.severe ? ', and its 99th on at least one' : '') + '.',
    rain: 'Forecast rain, scaled by ' + ctx.rainRatio.toFixed(2) + ' to match the 30-year record, reaches this place\'s 99th percentile for the month.' +
      (isFinite(ctx.soil.p) ? ' The topsoil was wetter than ' + Math.round(ctx.soil.p * 100) + '% of the same month in 1991-2020 when last measured (' + fmtDay(ctx.soil.day) + ')' + (f.severe ? ', so more of the rain is likely to run off.' : '.') : ' How wet the soil is now could not be measured.'),
    fire: 'The Fire Weather Index, computed from the last ' + PAST + ' days of measured weather and the corrected forecast, reaches the "very high" class and this place\'s 95th percentile for the month on ' + f.days + ' days in a row. Fire also needs fuel and a spark, which no weather index can see.'
  }[f.hazard];
  return {
    id: ['model', f.hazard, place.id, f.start].join('-'),
    source: 'Predict Natural Disasters · forecast model',
    sourceType: 'forecast',
    type: H.type,
    title: H.word + ' forecast for ' + place.name + ', ' + span(f.start, f.end),
    country: place.country, admin1: place.admin1 || '', region: where,
    lat: place.lat, lon: place.lon,
    alert: f.severe ? 'High' : 'Moderate',
    issuedAt: ctx.runAt, targetStart: f.start + 'T00:00:00Z', targetEnd: f.end + 'T23:59:59Z',
    forecast: true, forecastKind: 'model-advance', forecastScope: 'event', precision: 'city',
    confidence: f.severe ? 'Higher: past this place\'s 99th percentile, or on already-wet ground' : 'Moderate: past this place\'s 95th percentile',
    details: 'Our own forecast, made before the period it covers. ' + why + ' ' + days.join('. ') + '.',
    evidence: 'Open-Meteo forecast issued for ' + ctx.runDay + ', compared with NASA POWER daily records for ' + where + ', 1991-2020. Bias measured over ' + ctx.overlap + ' shared days.',
    verificationRule: 'Checked against the ' + H.what + ' NASA POWER records for these days once they are available: correct if the threshold was reached on at least one day of the window, a false alarm if it was not. Separately checked against any disaster others report there.',
    sourceUrl: '/accuracy',
    model: { hazard: f.hazard, days: f.detail, peak: f.peak, severe: f.severe, placeId: place.id, geonameId: place.geonameId,
      bias: { tmax: M.round(ctx.deltaT, 2), dew: M.round(ctx.deltaDew, 2), rainRatio: M.round(ctx.rainRatio, 2), windRatio: M.round(ctx.windRatio, 2), overlapDays: ctx.overlap },
      soil: isFinite(ctx.soil.p) ? { percentile: ctx.soil.p, value: ctx.soil.value, day: ctx.soil.day } : null }
  };
}

async function runPlace(place, fc, runAt) {
  const today = ymd(runAt);
  const days = fc.time;
  const ref = await recent(place, days[0], today);
  const past = days.filter(d => d < today);
  const bt = M.biasDelta(past, past.map(d => fc.temperature_2m_max[days.indexOf(d)]), past.map(ref.tmax), M.MAX_SHIFT_C);
  const bd = M.biasDelta(past, past.map(d => fc.dew_point_2m_mean[days.indexOf(d)]), past.map(ref.dew), M.MAX_SHIFT_C * 2);
  const rr = M.rainRatio(past, past.map(d => fc.precipitation_sum[days.indexOf(d)]), past.map(ref.rain));
  if (bt.delta === null || bd.delta === null || rr.ratio === null) {
    return { skipped: bt.tooLarge !== undefined
      ? 'the forecast service and the 30-year record differ here by ' + bt.tooLarge.toFixed(1) + ' °C on average over the last ' + bt.n + ' days, more than a correction can be trusted to bridge'
      : 'only ' + bt.n + ' recent days that both datasets cover; at least ' + M.MIN_OVERLAP + ' are needed to correct the forecast' };
  }
  const fw = past.map(d => fc.wind_speed_10m_mean[days.indexOf(d)]), rw = past.map(ref.wind);
  const fwm = M.mean(fw.filter((v, i) => isFinite(v) && isFinite(rw[i]))), rwm = M.mean(rw.filter((v, i) => isFinite(v) && isFinite(fw[i])));
  const windRatio = fwm > 0 && rwm > 0 ? Math.max(0.5, Math.min(2, rwm / fwm)) : 1;

  /* One series on the climatology's scale: POWER's measurements where they
     exist, the corrected forecast service after that. */
  const series = days.map((d, i) => {
    const measured = d < today && isFinite(ref.tmax(d)) && isFinite(ref.dew(d)) && isFinite(ref.rain(d)) && isFinite(ref.wind(d));
    if (measured) return { day: d, tmax: ref.tmax(d), dew: ref.dew(d), rain: ref.rain(d), wind: ref.wind(d), measured: true };
    return { day: d, tmax: fc.temperature_2m_max[i] - bt.delta, dew: fc.dew_point_2m_mean[i] - bd.delta,
      rain: fc.precipitation_sum[i] * rr.ratio, wind: fc.wind_speed_10m_mean[i] * windRatio, measured: false };
  });
  const fwi = M.fwiSeries(days, series.map(s => ({ temp: s.tmax, rh: M.rhFrom(s.tmax, s.dew), wind: s.wind, rain: s.rain })), place.lat);
  const soil = soilPercentile(place, past, ref);

  const first = ymd(Date.parse(today) + LEAD_MIN * 864e5), last = ymd(Date.parse(today) + LEAD_MAX * 864e5);
  const ahead = days.map((d, i) => (d >= first && d <= last) ? i : -1).filter(i => i >= 0);
  const aDays = ahead.map(i => days[i]);
  const flagged = []
    .concat(M.heatModel(place, aDays, ahead.map(i => series[i].tmax)))
    /* Three-day totals reach back into the measured days, so rain that has
       already fallen counts towards a total that ends in the window. */
    .concat(M.rainModel(place, days, series.map(s => s.rain), soil.p).filter(r => r.start >= first && r.start <= last))
    .concat(M.fireModel(place, aDays, ahead.map(i => fwi[i])));
  const ctx = { runAt, runDay: today, deltaT: bt.delta, deltaDew: bd.delta, rainRatio: rr.ratio, windRatio, overlap: bt.n, soil };
  return { outlooks: flagged.map(f => outlook(place, f, ctx)), overlap: bt.n };
}

(async () => {
  const clim = JSON.parse(fs.readFileSync(CLIM, 'utf8'));
  const runAt = new Date().toISOString();
  const outlooks = [], skipped = [], checked = [];
  const places = clim.places;
  for (let b = 0; b < places.length; b += 50) {
    const batch = places.slice(b, b + 50);
    let daily;
    try { daily = await forecasts(batch); }
    catch (e) { batch.forEach(p => skipped.push({ id: p.id, why: 'forecast service: ' + e.message })); continue; }
    // A few places at a time: POWER answers one point per request.
    for (let i = 0; i < batch.length; i += 6) {
      await Promise.all(batch.slice(i, i + 6).map(async (p, k) => {
        try {
          const r = await runPlace(p, daily[i + k], runAt);
          if (r.skipped) skipped.push({ id: p.id, why: r.skipped });
          else { checked.push(p.id); outlooks.push(...r.outlooks); }
        } catch (e) { skipped.push({ id: p.id, why: e.message }); }
      }));
    }
  }
  const out = {
    note: 'Forecasts made in advance by tools/run-models.js from data/climatology.json. Replaced on every run; the ledger keeps every one ever issued.',
    generatedAt: runAt, period: clim.period, places: places.length, checked: checked.length,
    skipped, outlooks
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(RUNS, 'utf8')); if (!Array.isArray(runs)) runs = []; } catch (e) { runs = []; }
  runs.push({ at: runAt, checked, skipped: skipped.map(s => s.id), leadDays: [LEAD_MIN, LEAD_MAX],
    outlooks: outlooks.map(o => o.id) });
  fs.writeFileSync(RUNS, JSON.stringify(runs.slice(-MAX_RUNS_KEPT)) + '\n');
  console.log('models: ' + checked.length + '/' + places.length + ' places checked, ' + outlooks.length + ' forecast(s), ' + skipped.length + ' skipped');
  for (const o of outlooks) console.log('  + ' + o.id + '  ' + o.alert + '  ' + o.title);
  for (const s of skipped) console.log('  skipped ' + s.id + ': ' + s.why);
  if (!checked.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
