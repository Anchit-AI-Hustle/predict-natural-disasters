#!/usr/bin/env node
'use strict';
/**
 * What is normal for each place: the history the forecast models judge the
 * coming week against.
 *
 *   node tools/build-climatology.js [out.json]
 *
 * For each place below, the last thirty complete years of daily weather
 * (1996-2025) from NASA POWER, which is built on the MERRA-2
 * reanalysis and serves any point on Earth without a key. From it:
 *
 *   heat   the 90th, 95th and 99th percentiles of daily maximum temperature
 *          for each day of the year, over a 15-day window, fitted with an
 *          annual cycle (forecast-models.js says why);
 *   rain   the 99th percentile of daily rain and of three-day totals, by month;
 *   soil   deciles of surface soil wetness by month, to say how wet the ground
 *          is now compared with usual;
 *   fire   the 90th and 95th percentiles of the Fire Weather Index by month,
 *          computed from the same thirty years.
 *
 * Places are named here and located by GeoNames through Open-Meteo's
 * geocoding service, so no coordinate in the output is typed by hand; the
 * GeoNames id is kept so each can be checked. They are large cities chosen to
 * cover every inhabited continent and the regions most exposed to heat, flood
 * and fire. A place the services cannot answer for is left out and listed,
 * not filled in.
 *
 * Needs network access to power.larc.nasa.gov and geocoding-api.open-meteo.com.
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'forecast-models.js'));
const G = require(path.join(__dirname, 'io-guard.js'));

const OUT = process.argv[2] || path.join(__dirname, '..', 'data', 'climatology.json');
/* The most recent thirty complete years. The WMO's 1991-2020 normal is a
   decade older, and measured against it a warming climate exceeds its 95th
   percentile on 15-25% of days rather than 5% (checked on Mumbai, Kolkata
   and London for August-October 2026), so an alert built on it fires for
   weather that is merely the new usual. */
const START = '19960101', END = '20251231';

/* [name, ISO country code]. Order is not significant. */
const PLACES = [
  ['Delhi', 'IN'], ['Mumbai', 'IN'], ['Kolkata', 'IN'], ['Chennai', 'IN'], ['Ahmedabad', 'IN'], ['Hyderabad', 'IN'],
  ['Lucknow', 'IN'], ['Patna', 'IN'], ['Guwahati', 'IN'], ['Bhubaneswar', 'IN'], ['Jaipur', 'IN'], ['Nagpur', 'IN'],
  ['Dhaka', 'BD'], ['Chittagong', 'BD'], ['Karachi', 'PK'], ['Lahore', 'PK'], ['Kathmandu', 'NP'], ['Colombo', 'LK'],
  ['Kabul', 'AF'], ['Tehran', 'IR'], ['Baghdad', 'IQ'], ['Riyadh', 'SA'], ['Dubai', 'AE'], ['Muscat', 'OM'],
  ['Manila', 'PH'], ['Jakarta', 'ID'], ['Surabaya', 'ID'], ['Ho Chi Minh City', 'VN'], ['Hanoi', 'VN'], ['Da Nang', 'VN'],
  ['Bangkok', 'TH'], ['Yangon', 'MM'], ['Kuala Lumpur', 'MY'], ['Singapore', 'SG'], ['Guangzhou', 'CN'], ['Shanghai', 'CN'],
  ['Beijing', 'CN'], ['Wuhan', 'CN'], ['Chongqing', 'CN'], ['Hong Kong', 'HK'], ['Taipei', 'TW'], ['Seoul', 'KR'],
  ['Tokyo', 'JP'], ['Osaka', 'JP'], ['Sydney', 'AU'], ['Melbourne', 'AU'], ['Brisbane', 'AU'], ['Perth', 'AU'],
  ['Adelaide', 'AU'], ['Auckland', 'NZ'], ['Cairo', 'EG'], ['Khartoum', 'SD'], ['Addis Ababa', 'ET'], ['Nairobi', 'KE'],
  ['Mogadishu', 'SO'], ['Kinshasa', 'CD'], ['Lagos', 'NG'], ['Accra', 'GH'], ['Dakar', 'SN'], ['Niamey', 'NE'],
  ['Luanda', 'AO'], ['Johannesburg', 'ZA'], ['Cape Town', 'ZA'], ['Maputo', 'MZ'], ['Antananarivo', 'MG'], ['Istanbul', 'TR'],
  ['Athens', 'GR'], ['Rome', 'IT'], ['Madrid', 'ES'], ['Seville', 'ES'], ['Lisbon', 'PT'], ['Marseille', 'FR'],
  ['Paris', 'FR'], ['London', 'GB'], ['Berlin', 'DE'], ['Warsaw', 'PL'], ['Bucharest', 'RO'], ['Kyiv', 'UA'],
  ['Moscow', 'RU'], ['Los Angeles', 'US'], ['San Francisco', 'US'], ['Phoenix', 'US'], ['Las Vegas', 'US'], ['Denver', 'US'],
  ['Houston', 'US'], ['Dallas', 'US'], ['New Orleans', 'US'], ['Miami', 'US'], ['Atlanta', 'US'], ['Chicago', 'US'],
  ['New York', 'US'], ['Toronto', 'CA'], ['Vancouver', 'CA'], ['Mexico City', 'MX'], ['Monterrey', 'MX'], ['Guatemala City', 'GT'],
  ['Havana', 'CU'], ['Port-au-Prince', 'HT'], ['Bogota', 'CO'], ['Caracas', 'VE'], ['Lima', 'PE'], ['Quito', 'EC'],
  ['Santiago', 'CL'], ['Buenos Aires', 'AR'], ['Sao Paulo', 'BR'], ['Rio de Janeiro', 'BR'], ['Manaus', 'BR'], ['Recife', 'BR']
];

const wait = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'predict-natural-disasters climatology build' } });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    } catch (e) { if (i === tries - 1) throw e; }
    await wait(2000 * Math.pow(2, i));
  }
  throw new Error('no answer');
}

async function locate(name, cc) {
  const u = 'https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name=' + encodeURIComponent(name);
  const j = await getJson(u);
  const hits = (j.results || []).filter(h => h.country_code === cc)
    .sort((a, b) => (b.population || 0) - (a.population || 0));
  const h = hits[0];
  if (!h) return null;
  return { name: h.name, country: h.country, countryCode: h.country_code, admin1: h.admin1 || '',
    lat: M.round(h.latitude, 4), lon: M.round(h.longitude, 4), geonameId: h.id, population: h.population || null };
}

async function history(p) {
  const u = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,PRECTOTCORR,T2MDEW,WS10M,GWETTOP' +
    '&community=AG&latitude=' + p.lat + '&longitude=' + p.lon + '&start=' + START + '&end=' + END + '&format=JSON';
  const j = await getJson(u);
  const P = j.properties.parameter;
  const keys = Object.keys(P.T2M_MAX).sort();
  /* POWER marks a missing value with -999; it is missing, not a temperature. */
  const v = (k, d) => { const x = P[k][d]; return x === undefined || x <= -900 ? NaN : x; };
  const days = keys.map(k => k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8));
  return {
    days,
    tmax: keys.map(k => v('T2M_MAX', k)),
    rain: keys.map(k => v('PRECTOTCORR', k)),
    dew: keys.map(k => v('T2MDEW', k)),
    wind: keys.map(k => v('WS10M', k) * 3.6), // m/s to km/h, the FWI's unit
    soil: keys.map(k => v('GWETTOP', k))
  };
}

function climatology(p, h) {
  const fit = q => M.fitHarmonics(M.dailyPercentiles(h.days, h.tmax, q));
  const p90 = fit(0.90), p95 = fit(0.95), p99 = fit(0.99);
  const r3 = M.rollingSum(h.rain, 3);
  const deciles = [];
  for (let m = 1; m <= 12; m++) {
    const vals = h.soil.filter((v, i) => isFinite(v) && M.monthOf(h.days[i]) === m);
    deciles.push(vals.length >= 30 ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q => M.round(M.quantile(vals, q), 3)) : null);
  }
  const fwi = M.fwiSeries(h.days, h.days.map((d, i) => ({
    temp: h.tmax[i], rh: isFinite(h.dew[i]) ? M.rhFrom(h.tmax[i], h.dew[i]) : NaN, wind: h.wind[i], rain: h.rain[i]
  })), p.lat);
  const fwiVals = fwi.map(v => v === null ? NaN : v);
  const missing = h.tmax.filter(v => !isFinite(v)).length;
  return Object.assign({}, p, {
    id: (p.name + '-' + p.countryCode).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    days: h.days.length, missingDays: missing,
    heat: { p90: p90.coef, p95: p95.coef, p99: p99.coef, fitRms: { p90: p90.rms, p95: p95.rms, p99: p99.rms } },
    rain: { p99: M.monthlyPercentiles(h.days, h.rain, 0.99), p99x3: M.monthlyPercentiles(h.days, r3, 0.99) },
    soil: { deciles },
    fire: { p90: M.monthlyPercentiles(h.days, fwiVals, 0.90), p95: M.monthlyPercentiles(h.days, fwiVals, 0.95) }
  });
}

(async () => {
  const places = [], skipped = [];
  for (const [name, cc] of PLACES) {
    try {
      const loc = await locate(name, cc);
      if (!loc) { skipped.push(name + ' (' + cc + '): not found by GeoNames'); continue; }
      const h = await history(loc);
      if (h.days.length < 365 * 29) { skipped.push(name + ': only ' + h.days.length + ' days of history'); continue; }
      const c = climatology(loc, h);
      places.push(c);
      console.log('ok  ' + c.id.padEnd(22) + ' p95 rms ' + c.heat.fitRms.p95 + '  rain p99 Jul ' + c.rain.p99[6] + '  fire p95 Jul ' + c.fire.p95[6]);
    } catch (e) {
      skipped.push(name + ' (' + cc + '): ' + e.message);
      console.log('skip ' + name + ': ' + e.message);
    }
    await wait(800);
  }
  const out = {
    note: 'Thresholds for the forecast models in forecast-models.js, computed by tools/build-climatology.js. Not hand-edited.',
    source: 'NASA POWER daily point data (MERRA-2), community AG: T2M_MAX, PRECTOTCORR, T2MDEW, WS10M, GWETTOP',
    sourceUrl: 'https://power.larc.nasa.gov/',
    locatedBy: 'GeoNames via https://geocoding-api.open-meteo.com',
    period: START.slice(0, 4) + '-' + END.slice(0, 4),
    generatedAt: new Date().toISOString(),
    harmonics: M.HARMONICS,
    places, skipped
  };
  console.log('\n' + places.length + ' places built, ' + skipped.length + ' skipped');
  for (const s of skipped) console.log('  skipped: ' + s);
  const problems = G.climatologyProblems(out, PLACES.length);
  if (problems.length) throw new Error('not writing ' + OUT + ': ' + problems.slice(0, 10).join('; '));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log('written to ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
