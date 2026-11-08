#!/usr/bin/env node
'use strict';
/**
 * Build docs/native-parity/test-vectors.json by running the website's own JS.
 *
 *   node tools/make-parity-vectors.js          write the file
 *   node tools/make-parity-vectors.js --check  exit 1 if the file is stale
 *
 * The native apps (Android and iOS) load test-vectors.json in their unit tests
 * and assert that their ports give the same output for the same input. Every
 * output here is produced by the site's code, never typed by hand:
 *
 * - The shared scripts (hazard-model.js, risk.js, search.js, continents.js,
 *   place-risk.js, alert-rules.js, portal.js, verdicts.js, observed-model.js,
 *   verification-model.js, place-search.js, glossary.js) are evaluated in
 *   jsdom with Date.now() fixed to meta.now.
 * - Page logic that lives inline in a page (the official-warning list filter
 *   in collection.js, the region match in region-detail.html, the hazard match
 *   and hazard choice in hazard-detail.html, the grade lookup in
 *   forecast-detail.html, the status words in event-detail.html and
 *   calamity-detail.html) is cut out of that page's source by name and run
 *   as it is, so a change to the page changes the vectors.
 * - The home page (index.html) is rendered whole through test/render.js with
 *   a fixed feed, and its tiles, tables and lists are read back from the DOM.
 *
 * Nothing here reads data/: the bot rewrites those files several times a day,
 * and a vector that moved with them would be stale on every run.
 * test/parity-vectors.test.js rebuilds this in memory and fails when the
 * committed file no longer matches the site.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'native-parity', 'test-vectors.json');
const { JSDOM } = require(path.join(ROOT, 'test', 'node_modules', 'jsdom'));

const NOW = Date.parse('2026-10-20T12:00:00Z');
/* Every vector without its own `tz` was run with this zone chosen. The site's
   default is the visitor's own zone (portal.timezoneDefault), which would make
   the output depend on the machine that runs this. */
const TZ = 'Asia/Kolkata';
const SCRIPTS = ['country-names.js', 'hazard-model.js', 'risk.js', 'search.js', 'continents.js', 'place-risk.js', 'alert-rules.js',
  'portal.js', 'verdicts.js', 'observed-model.js', 'verification-model.js', 'place-search.js', 'glossary.js'];

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WINDOWS = [];
/* Number.toLocaleString() with no locale follows the machine's (de_DE writes
   1.234). The spec tells the apps to group as en-US always (logic.md §1), and
   the vectors must not change with the machine that builds them. */
const EN_US_NUMBERS = '(function(){var f=Number.prototype.toLocaleString;Number.prototype.toLocaleString=function(l,o){return f.call(this,l||"en-US",o)}})()';

/** A window with the site's shared scripts loaded. */
function env(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><select id="sortBy"></select></body></html>',
    { url: 'https://predict-natural-disasters.anchit-tandon.com/events', runScripts: 'outside-only' });
  const w = dom.window;
  WINDOWS.push(w);
  if (opts.tz !== null) w.localStorage.setItem('pnd_timezone', opts.tz || TZ);
  w.eval(EN_US_NUMBERS);
  if (opts.before) opts.before(w);
  w.eval('Date.now=function(){return ' + (opts.now || NOW) + '};');
  for (const f of SCRIPTS) w.eval(read(f) + '\n//# sourceURL=' + f);
  return w;
}

/* ----------------------------------------------- page code, cut out by name */

/** The source from `start` to the brace that closes the first block after it. */
function block(src, start, file) {
  const at = src.indexOf(start);
  if (at < 0) throw new Error(file + ': cannot find ' + JSON.stringify(start));
  let i = src.indexOf('{', at), depth = 0;
  const skipString = q => { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } };
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') { skipString(c); continue; }
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let d = 1; i += 2;
          while (i < src.length && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; if (d) i++; }
        }
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(file + ': unbalanced block after ' + JSON.stringify(start));
}
/** One statement, from `start` to the first `;` at depth 0. */
function statement(src, start, file) {
  const at = src.indexOf(start);
  if (at < 0) throw new Error(file + ': cannot find ' + JSON.stringify(start));
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') { i++; while (src[i] !== c) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(file + ': no end to ' + JSON.stringify(start));
}

const J = x => JSON.parse(JSON.stringify(x === undefined ? null : x));

async function build() {
  const w = env();
  const P = w.PND, R = w.PNDRisk, H = w.PNDHazards, PR = w.PNDPlaceRisk, AR = w.PNDAlertRules, V = w.PNDVerdicts,
    S = w.PNDSearch, PS = w.PNDPlaceSearch, VER = w.PNDVerification, G = w.__pndGlossary, C = w.PNDContinents;
  const V_ = { meta: { now: new Date(NOW).toISOString(), timezoneDefault: TZ,
    note: 'Generated by tools/make-parity-vectors.js, which runs the website JS (country-names.js, hazard-model.js, risk.js, search.js, continents.js, portal.js, place-risk.js, alert-rules.js, verdicts.js, search.js, place-search.js, verification-model.js, glossary.js, and inline logic cut out of collection.js, index.html, region-detail.html, hazard-detail.html, forecast-detail.html, event-detail.html and calamity-detail.html) in jsdom with Date.now fixed to meta.now. Groups without a tz field ran with timezoneDefault selected; the site itself defaults to the browser zone (portal.timezoneDefault).' } };
  const vec = (name, fn, inputs) => {
    V_[name] = inputs.map(i => {
      let out;
      try { out = fn(...(Array.isArray(i) ? i : [i])); } catch (e) { out = { error: String(e.message) }; }
      return { in: J(i), out: J(out) };
    });
  };
  const avec = async (name, fn, inputs) => {
    V_[name] = [];
    for (const i of inputs) {
      let out;
      try { out = await fn(...(Array.isArray(i) ? i : [i])); } catch (e) { out = { error: String(e.message) }; }
      V_[name].push({ in: J(i), out: J(out) });
    }
  };

  // ---------- risk.js
  vec('risk.levelOf', v => R.levelOf(v), ['Red', 'Orange', 'Green', 'Yellow', 'Amber', 'Purple', 'Watch', 'Advisory', 'Minor', 'Elevated', 'High', 'Moderate', 'Severe', 'Critical', 'Extreme', 'Catastrophic', 'CATASTROPHIC', 'very high', 'Very  High', 'VeryHigh', 'Significant', 'Informational', 'Routine', 'Normal', 'Low', 'yellow-ish', 'Greenish', 'Lowland', 'Severe Thunderstorm Warning', 'High surf advisory', 'Moderate to severe', 'WARNING', 'ADVISORY', 'WATCH', '', null, 'Not rated', 'unknown', 3]);
  vec('risk.markerIcon', v => { const m = R.markerIcon(v, 'Flood in X'); return { level: m.level, colour: m.colour, iconSize: m.iconSize, label: m.label, className: m.className }; }, ['Green', 'Yellow', 'Orange', 'Red', 'Severe', 'Extreme', '', null]);

  // ---------- portal riskTag resolution
  const recs = [{ severity: 'Severe', alert: 'Orange' }, { alert: 'Orange' }, { alert: 'Red' }, { alert: 'Green' }, { severity: 'Informational', alert: 'Red' }, { severity: 'Moderate', alert: 'High' }, { alert: 'High' }, { alert: 'Watch' }, {}, { alert: 'Unknown', severity: '' }, { severity: 'Extreme' }];
  vec('portal.riskLabel', e => P.riskLabel(e), recs);
  vec('portal.matchesRiskLevel', (e, k) => P.matchesRiskLevel(e, k), [[{ severity: 'Severe', alert: 'Orange' }, 'SEVERE'], [{ severity: 'Severe', alert: 'Orange' }, 'MODERATE'], [{ alert: 'Orange' }, 'MODERATE'], [{}, 'UNKNOWN'], [{}, 'LOW'], [{ alert: 'Green' }, ''], [{ severity: 'Informational', alert: 'Red' }, 'LOW']]);
  vec('portal.riskTagHtml', e => P.riskTag(e), [{ severity: 'Severe', alert: 'Orange', source: 'GDACS' }, { alert: 'Red', alertSource: 'JTWC', source: 'NOAA National Hurricane Center' }, {}]);
  /* The one level function (launch audit C9 and A6): model forecasts, storm
     category floors, strong earthquakes with no assessment, and whose
     impact estimate a level is. */
  const levelRecs = [{ forecastKind: 'model-advance', alert: 'High', severity: 'Severe', forecast: true }, { forecastKind: 'model-advance', alert: 'Moderate', severity: 'Moderate', forecast: true },
    { type: 'Tropical Cyclone', title: 'Storm risk from Super Typhoon In-fa - 5-day forecast', alert: 'Watch', severity: 'Informational', forecast: true },
    { type: 'Tropical Cyclone', title: 'Typhoon Example', alert: 'Green', source: 'GDACS' }, { type: 'Tropical Cyclone', title: 'Hurricane Example (Category 3)', alert: 'Green' },
    { type: 'Earthquake', magnitude: 6.9, severity: 'Informational', source: 'USGS' }, { type: 'Earthquake', magnitude: 6.5, pagerAlert: 'green', severity: 'Informational', source: 'USGS' },
    { type: 'Flood', alert: 'Green', severity: 'Informational', source: 'GDACS' }, { type: 'Tropical Cyclone', alert: 'Orange', alertBasis: 'derived-from-intensity', severity: 'Moderate', source: 'GDACS' }, {}];
  vec('risk.keyFor', e => R.keyFor(e), levelRecs);
  vec('risk.describe', e => R.describe(e), levelRecs);
  vec('portal.riskTagHtml.levels', e => P.riskTag(e), levelRecs);
  vec('hazards.cycloneCategoryRank', e => H.cycloneCategoryRank(e), levelRecs.concat([{ type: 'Tropical Cyclone', category: 4 }, { type: 'Flood', title: 'Category 5 flood' }]));
  vec('portal.provenanceOf', e => P.provenanceOf(e), [{ forecast: true, forecastKind: 'model-advance' }, { forecast: true, forecastKind: 'signal-derived-outlook', forecastOf: 'x' }, { forecast: true, forecastKind: 'aftershock-sequence', forecastOf: 'q' }, { forecast: true, forecastKind: 'frozen-benchmark' }, { forecast: false }]);
  vec('portal.riskLevelOptions', () => R.LEVELS.slice().reverse().map(l => ({ value: l.key, label: l.label })).concat([{ value: 'UNKNOWN', label: 'Not rated' }]), [[]]);

  // ---------- hazard-model
  vec('hazards.hazardOf.name', t => H.hazardOf(t).name, ['Earthquake', 'Earthquake aftershock sequence', 'Aftershocks', 'Seismic activity', 'Tropical Cyclone', 'Hurricane', 'Typhoon', 'Tsunami', 'Tornado', 'Flood / Landslide', 'Flash flood and mudslide', 'Flood', 'Landslide', 'Wildfire', 'Bushfire', 'Forest fire', 'Drought', 'Volcano', 'Volcanic eruption', 'Extreme Heat', 'Heat wave', 'Extreme Cold', 'Winter storm', 'Frost', 'Severe Storm', 'Thunderstorm', 'Hail', 'High wind', 'Snow', 'Ice', 'Other', '', null]);
  vec('hazards.horizonHours', t => H.horizonHours(t), ['Earthquake', 'Earthquake aftershock sequence', 'Tropical Cyclone', 'Flood', 'Flood / Landslide', 'Landslide', 'Wildfire', 'Drought', 'Volcano', 'Extreme Heat', 'Extreme Cold', 'Severe Storm', 'Tornado', 'Tsunami', 'Ice']);
  vec('hazards.severityOf', e => ({ severity: H.severityOf(e), rank: H.severityRank(e), impactRank: H.impactRank(e), alertRank: H.alertRank(e) }), [
    {}, { magnitude: 4.7 }, { magnitude: 6.1, pagerAlert: 'yellow' }, { magnitude: 7.2, pagerAlert: 'red' }, { alert: 'Red' }, { alert: 'Orange' }, { alert: 'Green' }, { alert: 'High' }, { alert: 'Moderate' }, { alert: 'Watch' },
    { deaths: 1 }, { deaths: 10 }, { deaths: 100 }, { affected: 5 }, { affected: 10000 }, { affected: 100000 }, { affected: 1000000 }, { displaced: 1000 }, { displaced: 10000 }, { displaced: 100000 },
    { windKt: 40 }, { windKt: 64 }, { windKt: 96 }, { windKt: 113 }, { windKt: 50, alert: 'Red' }, { alert: 'Green', deaths: 42 }, { alert: 'Red', pagerAlert: 'yellow' }, { deaths: null, affected: '', displaced: '0' }]);
  vec('hazards.cycloneCategory', k => H.cycloneCategory(k), [0, 20, 33.9, 34, 63.9, 64, 82, 83, 95, 96, 112, 113, 136, 137, 160, null, '', -5]);
  vec('hazards.keyFacts', e => H.keyFacts(e).map(f => ({ key: f.key, label: f.label, reported: f.reported, value: f.value, note: f.note || null })), [
    { type: 'Earthquake', magnitude: 6.53, depthKm: 10.4, pagerAlert: 'yellow', tsunamiFlag: false, deaths: 0 },
    { type: 'Earthquake', magnitude: 5, source: 'EMSC' },
    { type: 'Tropical Cyclone', windKt: 105, pressureMb: 948, movementDirDeg: 315, movementKt: 12 },
    { type: 'Tropical Cyclone', windKt: 64.4, pressureMb: null, movementDirDeg: null, movementKt: null },
    { type: 'Tropical Cyclone', windKt: 63.82, movementDirDeg: 90 },
    { type: 'Wildfire', areaHa: 150 }, { type: 'Wildfire', areaHa: 3150 }, { type: 'Wildfire', areaHa: 2500000 },
    { type: 'Volcano', alertLevel: 'WARNING', aviationColour: 'ORANGE' }, { type: 'Volcano', alert: 'Green' },
    { type: 'Flood', deaths: 42, displaced: 5100, affected: 120000 },
    { type: 'Earthquake aftershock sequence', mainshockMagnitude: 6.5 },
    { type: 'Ice' }, {}
  ]);
  vec('portal.keyFactsLine', (e, m) => P.keyFactsLine(e, m), [[{ type: 'Tropical Cyclone', windKt: 105, pressureMb: 948 }, 3], [{ type: 'Earthquake', magnitude: 6.53, depthKm: 10.4 }, 3], [{ type: 'Flood', deaths: 42, displaced: 5100, affected: 120000 }, 3], [{ type: 'Flood' }, 3]]);
  vec('hazards.leadTimeText', e => ({ hours: H.leadTimeHours(e), text: H.leadTimeText(e) }), [
    { forecast: true, issuedAt: '2026-10-20T00:00:00Z', targetStart: '2026-10-20T00:00:00Z' },
    { forecast: true, issuedAt: '2026-10-20T00:00:00Z', targetStart: '2026-10-20T01:00:00Z' },
    { forecast: true, issuedAt: '2026-10-20T00:00:00Z', targetStart: '2026-10-21T12:00:00Z' },
    { forecast: true, issuedAt: '2026-10-20T00:00:00Z', targetStart: '2026-10-26T00:00:00Z' },
    { forecast: true, issuedAt: '2026-09-13T19:20:03Z', targetStart: '2026-09-13T00:00:00Z' },
    { forecast: false, issuedAt: '2026-10-20T00:00:00Z', targetStart: '2026-10-21T00:00:00Z' },
    { forecast: true, targetStart: '2026-10-21T00:00:00Z' }]);
  vec('hazards.classifyForecast', (f, p) => H.classifyForecast(f, p), [
    [{ forecast: true, forecastKind: 'frozen-benchmark' }], [{ forecast: true, forecastKind: 'aftershock-sequence' }],
    [{ forecast: true, forecastOf: 'x', source: 'Predict Natural Disasters · derived from GDACS' }],
    [{ forecast: true, forecastOf: 'x', source: 'Predict Natural Disasters · derived from NOAA / National Weather Service' }],
    [{ forecast: true, forecastOf: 'x' }, { evidenceState: 'official-warning' }],
    [{ forecast: true, freezeTimestamp: '2026-10-19T00:00:00Z', targetStart: '2026-10-20T00:00:00Z' }],
    [{ forecast: true, freezeTimestamp: '2026-10-21T00:00:00Z', targetStart: '2026-10-20T00:00:00Z' }],
    [{ forecast: true, freezeTimestamp: '2026-10-19T00:00:00Z', targetStart: '2026-10-20T00:00:00Z', freezeEvidenced: false }],
    [{ forecast: true }], [{ forecast: false }]]);
  vec('hazards.distanceKm', (a, b, c, d) => Math.round(H.distanceKm(a, b, c, d) * 1000) / 1000, [[28.6139, 77.209, 19.076, 72.8777], [0, 0, 0, 1], [51.5074, -0.1278, 40.7128, -74.006], [10, 179.5, 10, -179.5]]);
  const sq = { type: 'Polygon', coordinates: [[[-112.4, 33.2], [-111.8, 33.2], [-111.8, 33.7], [-112.4, 33.7], [-112.4, 33.2]]] };
  const holed = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  const wrap = { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]] };
  vec('hazards.geometryContains', (g, lat, lon) => H.geometryContains(g, lat, lon), [[sq, 33.45, -112.07], [sq, 34, -112.07], [holed, 5, 5], [holed, 2, 2], [wrap, 1, 180], [{ type: 'MultiPolygon', coordinates: [sq.coordinates, wrap.coordinates] }, 40, 0], [{ type: 'MultiPolygon', coordinates: [sq.coordinates, wrap.coordinates] }, 33.45, -112.07], [null, 1, 1], [{ type: 'Point', coordinates: [1, 1] }, 1, 1]]);

  // riskRow scenarios
  const home = { name: 'Home', kind: 'Home', lat: 27.70, lon: 85.32, country: 'Nepal', countryCode: 'NP' };
  const phx = { name: 'Phoenix', kind: 'Home', lat: 33.45, lon: -112.07, country: 'United States', countryCode: 'US' };
  const noCountry = { name: 'Pin', kind: 'Home', lat: 27.70, lon: 85.32, country: '', countryCode: '' };
  const deu = { name: 'Berlin', kind: 'Home', lat: 52.52, lon: 13.405, country: 'Deutschland', countryCode: '' };
  const deuCode = { name: 'Berlin', kind: 'Home', lat: 52.52, lon: 13.405, country: 'Deutschland', countryCode: 'DE' };
  const ev = {
    quakeNear: { id: 'usgs-1', type: 'Earthquake', source: 'USGS', sourceType: 'official', evidenceState: 'observed', lat: 27.8, lon: 85.4, proximityEligible: true, alert: 'Green', severity: 'Informational', magnitude: 4.6, updated: '2026-10-20T10:00:00Z', title: 'M 4.6 - 13 km NE of Kathmandu' },
    quakeNearRed: { id: 'usgs-2', type: 'Earthquake', source: 'USGS', sourceType: 'official', evidenceState: 'observed', lat: 27.9, lon: 85.6, proximityEligible: true, alert: 'Red', severity: 'Extreme', magnitude: 7.1, updated: '2026-10-20T10:00:00Z', title: 'M 7.1' },
    quake120: { id: 'usgs-3', type: 'Earthquake', source: 'USGS', sourceType: 'official', evidenceState: 'observed', lat: 28.6, lon: 85.9, proximityEligible: true, alert: 'Orange', severity: 'Severe', updated: '2026-10-20T10:00:00Z', title: 'M 6.2' },
    quake400: { id: 'usgs-4', type: 'Earthquake', source: 'USGS', sourceType: 'official', evidenceState: 'observed', lat: 30.5, lon: 83.0, proximityEligible: true, alert: 'Red', severity: 'Extreme', updated: '2026-10-20T10:00:00Z', title: 'M 7.4 far' },
    floodArea: { id: 'gdacs-FL-1', type: 'Flood', source: 'GDACS', sourceType: 'official', evidenceState: 'observed', lat: 27.7, lon: 85.3, proximityEligible: false, alert: 'Red', severity: 'Severe', updated: '2026-10-20T10:00:00Z', title: 'Flood in Bagmati' },
    nwsInside: { id: 'nws-1', type: 'Flood', source: 'NOAA / National Weather Service', sourceType: 'official', evidenceState: 'official-warning', lat: 33.45, lon: -112.1, geometry: sq, alert: 'Red', severity: 'Severe', expiresAt: '2026-10-21T00:00:00Z', updated: '2026-10-20T10:00:00Z', title: 'Flash Flood Warning' },
    nwsNoGeom: { id: 'nws-2', type: 'Severe Storm', source: 'NOAA / National Weather Service', sourceType: 'official', evidenceState: 'official-warning', lat: 33.6, lon: -112.2, alert: 'Orange', severity: 'Moderate', expiresAt: '2026-10-21T00:00:00Z', updated: '2026-10-20T10:00:00Z', title: 'Severe Thunderstorm Warning' },
    fcEvent: { id: 'OUT-x', type: 'Flood', forecast: true, forecastScope: 'event', lat: 27.75, lon: 85.35, alert: 'High', severity: 'Moderate', proximityEligible: false, title: 'Flood risk in Nepal - 3-day forecast' },
    fcCountryNP: { id: 'OUT-c', type: 'Extreme Heat', forecast: true, forecastScope: 'country', country: 'Nepal', lat: 28.3, lon: 84.1, alert: 'Watch', title: 'Heat risk in Nepal' },
    fcCountryDE: { id: 'OUT-d', type: 'Extreme Heat', forecast: true, forecastScope: 'country', country: 'Germany', lat: 51, lon: 10, alert: 'Watch', title: 'Heat risk in Germany' },
    fcCountryUS: { id: 'OUT-u', type: 'Extreme Heat', forecast: true, forecastScope: 'country', country: 'United States', lat: 27.9, lon: -82.5, alert: 'Watch', title: 'Heat risk in United States (anchored in Florida)' }
  };
  const rr = (e, p) => { const r = H.riskRow(e, p); return r && { band: r.band, distanceKm: r.distanceKm === null ? null : Math.round(r.distanceKm * 10) / 10, claimDistance: r.claimDistance, containment: r.containment, applicability: r.applicability }; };
  vec('hazards.riskRow', (ek, pk) => rr(ev[ek], { home, phx, noCountry, deu, deuCode }[pk]), [['quakeNear', 'home'], ['quakeNearRed', 'home'], ['quake120', 'home'], ['quake400', 'home'], ['floodArea', 'home'], ['nwsInside', 'phx'], ['nwsNoGeom', 'phx'], ['fcEvent', 'home'], ['fcCountryNP', 'home'], ['fcCountryNP', 'noCountry'], ['fcCountryNP', 'phx'], ['fcCountryUS', 'phx'], ['fcCountryDE', 'deu'], ['fcCountryDE', 'deuCode'], ['quakeNear', 'phx']]);
  V_['fixtures.places'] = { home, phx, noCountry, deu, deuCode }; V_['fixtures.events'] = ev;
  const asA = (p, list) => { const A = PR.assess(p, list, { generatedAt: '2026-10-20T11:59:00Z' }); const act = PR.actionsFor(A); return { level: A.level, headline: A.headline, why: A.why, leadId: A.lead && A.lead.e.id, leadBand: A.lead && A.lead.r.band, searchedKm: A.searchedKm, actions: act }; };
  vec('placeRisk.assess', (pk, ids) => asA({ home, phx, noCountry }[pk], ids.map(i => ev[i])), [
    ['home', []], ['home', ['floodArea']], ['home', ['quakeNear']], ['home', ['quakeNear', 'quakeNearRed']], ['home', ['quake120']], ['home', ['quake400']], ['home', ['fcEvent']], ['home', ['fcCountryNP', 'quakeNear']], ['phx', ['nwsInside']], ['phx', ['nwsNoGeom']], ['noCountry', ['fcCountryNP']]]);
  vec('placeRisk.nearLevel(table)', (lvl, km) => {
    const e = { id: 't', severity: lvl, proximityEligible: true, lat: 0, lon: 0 };
    const A = PR.assess({ lat: 0, lon: km / 111.195, name: 'p' }, [Object.assign({}, e, { evidenceState: 'observed', type: 'Earthquake' })]);
    return { level: A.level, distanceKm: A.lead ? Math.round(A.lead.d) : null };
  }, [].concat(...['Informational', 'Minor', 'Moderate', 'Severe', 'Extreme'].map(s => [10, 50, 100, 150, 151, 300, 500].map(k => [s, k]))));

  // alert-rules
  vec('alertRules.alertFor', (ek, pk, over) => AR.alertFor(Object.assign({}, ev[ek], over || {}), { home, phx }[pk], H, NOW), [
    ['quakeNear', 'home'], ['quakeNearRed', 'home'], ['quake120', 'home'], ['floodArea', 'home'], ['nwsInside', 'phx'], ['nwsNoGeom', 'phx'], ['fcEvent', 'home'],
    ['quakeNear', 'home', { updated: '2026-10-16T00:00:00Z' }], ['nwsInside', 'phx', { expiresAt: '2026-10-20T11:00:00Z' }], ['quakeNear', 'home', { cached: true }], ['quakeNear', 'home', { live: false }]]);
  vec('alertRules.alertsFor', () => AR.alertsFor([ev.quakeNear, ev.quakeNearRed, ev.floodArea, ev.nwsInside], [home, phx], H, NOW), [[]]);
  vec('alertRules.roundCoord', v => AR.roundCoord(v), [27.70456, -112.07499, '85.316', null, '', ' ', 0, 'abc']);
  vec('alertRules.urlFor', e => AR.urlFor(e), [{ id: 'OUT-1', forecast: true }, { id: 'gdacs-FL-1', sourceType: 'official', alert: 'Red' }, { id: 'usgs-1', sourceType: 'official', alert: 'Green' }, { id: 'a b/c' }]);

  // portal formatting
  vec('portal.titleOf', e => P.titleOf(e), [{ title: '3-day Flood risk outlook - Nepal' }, { title: '72-hour Wildfire risk outlook - Attica, Greece' }, { title: 'Aftershock-sequence outlook - Cianjur, Indonesia' }, { title: 'Aftershock-sequence outlook - 13 km NE of Kathmandu' }, { title: 'Flood risk in Nepal - 3-day forecast' }, {}, null]);
  vec('portal.placeOf', (e, f) => P.placeOf(e, f), [[{ place: 'Bagmati Province, Nepal ,' }], [{ title: 'Flood in China', region: 'Flood in China', country: 'China' }], [{ region: 'Bagmati Province', country: 'Nepal' }], [{ region: 'Bagmati Province, Nepal', country: 'Nepal' }], [{ region: 'Tropical Cyclone FAY-26', country: '' }, 'Global'], [{ region: 'Wildfire in Attica', country: 'Greece' }], [{ country: 'Nepal' }], [{}, 'Place not given'], [null, '-']]);
  vec('portal.shortSource', s => P.shortSource(s), ['GDACS', 'USGS', 'NOAA / National Weather Service', 'NOAA National Hurricane Center', 'USGS Volcano Hazards Program', 'ReliefWeb (UN OCHA)', 'Predict Natural Disasters', 'Predict Natural Disasters · derived from NOAA / National Weather Service', 'Predict Natural Disasters · derived from GDACS', 'Predict Natural Disasters · forecast model', 'European-Mediterranean Seismological Centre (EMSC)', 'NASA EONET', 'An extremely long agency name that will not fit', '', null]);
  vec('portal.provenance', e => P.provenance(e), [{ evidenceState: 'forecast' }, { forecast: true }, { forecast: true, forecastKind: 'frozen-benchmark' }, { evidenceState: 'official-warning' }, { evidenceState: 'observed' }, {}]);
  vec('portal.eventUrl', e => P.eventUrl(e), [{ id: 'OUT-1', forecast: true }, { id: 'gdacs-FL-1', sourceType: 'official', alert: 'Red' }, { id: 'gdacs-FL-2', sourceType: 'official', alert: 'Orange' }, { id: 'usgs-1', sourceType: 'official', alert: 'Green' }, { id: 'nws-1', sourceType: 'official', alert: 'Severe' }, { id: 'a b/c' }]);
  vec('portal.duration', (a, b) => P.duration(a, b), [['2026-10-20T00:00:00Z', '2026-10-20T00:30:00Z'], ['2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z'], ['2026-10-20T00:00:00Z', '2026-10-21T23:00:00Z'], ['2026-10-20T00:00:00Z', '2026-10-22T00:00:00Z'], ['2026-10-20T00:00:00Z', '2026-10-23T11:00:00Z'], ['2026-09-13T00:00:00Z', '2026-09-16T23:59:59Z'], ['2026-10-20T00:00:00Z', '2026-10-19T00:00:00Z'], ['', ''], ['2026-10-20T00:00:00Z', '2026-11-19T00:00:00Z']]);
  const tzCases = ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/Paris'];
  const dates = ['2026-10-20T11:24:19Z', '2026-10-20T00:00:00Z', '2026-01-05T18:05:00Z', '2026-10-20T23:59:59Z'];
  V_['portal.fmtDate'] = []; V_['portal.fmtTime'] = []; V_['portal.fmtWhen'] = []; V_['portal.windowText'] = []; V_['portal.horizonText'] = [];
  for (const tz of tzCases) {
    const wt = env({ tz });
    dates.concat(['', null, 'not a date']).forEach(d => { V_['portal.fmtDate'].push({ tz, in: d, out: wt.PND.fmtDate(d) }); });
    dates.forEach(d => V_['portal.fmtTime'].push({ tz, in: d, out: wt.PND.fmtTime(d) }));
    [['2026-10-20T00:00:00Z', '2026-10-22T23:59:59Z', undefined], ['2026-10-22T23:59:59Z', '2026-10-20T00:00:00Z', 'end'], ['2026-10-20T00:00:00Z', '2026-10-23T00:00:00Z', undefined], ['2026-10-23T00:00:00Z', '2026-10-20T00:00:00Z', 'end'], ['2026-10-20T00:00:00Z', '2026-10-23T11:24:19Z', undefined], ['2026-10-23T11:24:19Z', '2026-10-20T00:00:00Z', 'end'], ['2026-10-20T00:00:00.000Z', null, undefined], ['2026-11-19T00:00:00Z', null, 'end']].forEach(a => V_['portal.fmtWhen'].push({ tz, in: J(a), out: wt.PND.fmtWhen(...a) }));
    [{ targetStart: '2026-09-13T00:00:00Z', targetEnd: '2026-09-16T23:59:59Z' }, { targetStart: '2026-10-20T11:24:19.511Z', targetEnd: '2026-10-23T11:24:19.511Z' }, { targetStart: '2026-10-20T00:00:00Z', targetEnd: '2026-10-21T00:00:00Z' }, { startedAt: '2026-10-20T06:00:00Z' }, { updated: '2026-10-20T06:00:00Z', targetEnd: '2026-10-20T06:30:00Z' }, {}].forEach(e => V_['portal.windowText'].push({ tz, in: e, out: wt.PND.windowText(e) }));
    [{ forecastHorizon: { furthestWindowEnds: '2026-11-19T11:24:19.511Z', daysAhead: 30, windowLengthDays: [1, 2, 3, 4, 5, 7, 30] } }, { forecastHorizon: { furthestWindowEnds: '2026-10-22T23:59:59Z', daysAhead: 2.5, windowLengthDays: [3] } }, { forecastHorizon: { furthestWindowEnds: '2026-10-21T00:00:00Z', daysAhead: 0.5, windowLengthDays: [1] } }, { forecastHorizon: null }, null].forEach(m => V_['portal.horizonText'].push({ tz, in: m, out: wt.PND.horizonText(m) }));
  }
  vec('portal.age', v => P.age(v), ['2026-10-20T12:00:00Z', '2026-10-20T11:59:31Z', '2026-10-20T11:59:00Z', '2026-10-20T11:01:00Z', '2026-10-20T11:00:00Z', '2026-10-20T09:31:00Z', '2026-10-19T12:01:00Z', '2026-10-19T12:00:00Z', '2026-10-17T00:00:00Z', '2026-10-21T12:00:00Z', '', null]);
  vec('portal.countryCount', l => P.countryCount(l), [[[{ country: 'India, Nepal' }, { country: 'nepal' }, { country: ' Bangladesh ' }, { country: '' }, {}]]]);
  vec('portal.impactText', e => P.impactText(e), [{ deaths: 1234, displaced: 5100, affected: 120000 }, { deaths: 0, affected: 5 }, {}]);
  vec('portal.summary', (t, m) => P.summary(t, m), [['Widespread riverine flooding with continuing displacement. More text follows here.'], ['Short. Then more.'], ['Based on the GDACS report on flooding in the area. This is our own estimate, not an official warning.'], ['A very long description without any sentence ending that just goes on and on describing the flooding situation across several districts and provinces, with many rivers rising and roads closing in all directions', 80]]);
  vec('portal.quietNote', e => P.quietNote(e), [{ live: false, quietDays: 36, source: 'GDACS' }, { live: false, quietDays: 1, source: 'USGS' }, { live: false }, { live: true }]);
  vec('portal.statusText', m => P.statusText(m), [{ live: true, sources: { a: { ok: true }, b: { ok: false }, c: { ok: true } } }, { live: false, sources: { a: { ok: false } } }, null]);
  vec('portal.sourcesRatio', m => P.sourcesRatio(m), [{ sources: { a: { ok: true }, b: { ok: false }, c: { ok: true } } }, {}, null]);
  vec('portal.findEvent', (list, id) => { const e = P.findEvent(list, id); return e && e.id; }, [[[{ id: 'gdacs-FL-1104999', title: 'Flood in Nepal' }], 'gdacs-FL-1104999'], [[{ id: 'gdacs-FL-1104999', title: 'Flood in Nepal' }], 'gdacs-fl-1104999'], [[{ id: 'gdacs-FL-1104999', title: 'Flood in Nepal' }], 'gdacs%2DFL%2D1104999'], [[{ id: 'gdacs-FL-1104999', title: 'Flood in Nepal' }], 'flood-in-nepal'], [[{ id: 'gdacs-FL-1104999', title: 'Flood in Nepal' }], '1104999'], [[{ id: 'x' }], 'nothing']]);
  vec('portal.hazardOptions', (rs, sel) => P.hazardOptions(rs, sel), [[[{ type: 'Flood' }, { type: 'Flood' }, { type: 'Wildfire' }, { type: 'Earthquake' }, { type: 'Earthquake' }], ''], [[{ type: 'Flood' }], 'Drought']]);

  // sorting
  const S_LIST = [
    { id: 'a', title: 'Zeta flood', type: 'Flood', source: 'GDACS', country: 'Nepal', severityRank: 4, alert: 'Red', updated: '2026-10-20T10:00:00Z', deaths: 5, affected: 100, targetEnd: '2026-10-25T00:00:00Z' },
    { id: 'b', title: 'alpha quake', type: 'Earthquake', source: 'USGS', country: 'Japan', severityRank: 1, alert: 'Green', updated: '2026-10-20T11:00:00Z', deaths: 0, affected: 0, targetEnd: '2026-10-22T00:00:00Z' },
    { id: 'c', title: 'M 6.5 - near Teluknaga', type: 'Earthquake', source: 'EMSC', place: 'Teluknaga, Indonesia', severityRank: 3, alert: 'Orange', updated: '2026-10-19T08:00:00Z', deaths: 12, displaced: 300 },
    { id: 'd', title: 'Beta storm', type: 'Severe Storm', source: 'NOAA / National Weather Service', region: 'Texas', country: 'United States', alert: 'Moderate', updated: '', targetStart: '2026-10-21T00:00:00Z', affected: 100, displaced: 50 },
    { id: 'e', title: 'Gamma fire', type: 'Wildfire', source: 'NASA EONET', country: '', alert: 'Watch', updated: '2026-10-18T00:00:00Z', startedAt: '2026-10-10T00:00:00Z' }
  ];
  V_['portal.SORT_DEFS.labels'] = Object.fromEntries(Object.entries(P.SORT_DEFS).map(([k, v]) => [k, v.label]));
  V_['portal.EVENT_SORTS'] = J(P.EVENT_SORTS);
  V_['sort.fixture'] = S_LIST;
  V_['sort.results'] = Object.fromEntries(['severity', 'newest', 'oldest', 'deaths', 'affected', 'country', 'type', 'source', 'title', 'windowEnd'].map(k => [k, P.applySort(S_LIST, k).map(e => e.id)]));
  V_['sort.rankOf'] = S_LIST.map(e => ({ id: e.id, rank: P.rankOf(e) })).concat([{ id: 'alertOnly-High', rank: P.rankOf({ alert: 'High' }) }, { id: 'alertOnly-Severe', rank: P.rankOf({ alert: 'Severe' }) }, { id: 'rank0', rank: P.rankOf({ severityRank: 0, alert: 'orange' }) }]);
  V_['sort.timeOf'] = S_LIST.map(e => ({ id: e.id, t: P.timeOf(e) }));
  /* "Ending soonest first" with windows that already ended: open windows
     first, soonest end first, then ended ones, most recently ended first. */
  const END_LIST = [
    { id: 'ended-sep', targetEnd: '2026-09-16T23:59:59Z' },
    { id: 'open-22', targetEnd: '2026-10-22T00:00:00Z' },
    { id: 'closed-flag', targetEnd: '2026-10-21T00:00:00Z', windowClosed: true },
    { id: 'no-end' },
    { id: 'ended-oct1', targetEnd: '2026-10-01T00:00:00Z' },
    { id: 'open-25', targetEnd: '2026-10-25T00:00:00Z' },
    { id: 'ends-now', targetEnd: '2026-10-20T12:00:00Z' }
  ];
  V_['sort.windowEndEnded'] = { fixture: END_LIST, now: new Date(NOW).toISOString(), out: P.applySort(END_LIST, 'windowEnd').map(e => e.id) };

  // search
  vec('search.matches', (e, q) => S.matches(e, q), [[{ title: 'Flood in Bagmati Province, Nepal', type: 'Flood', country: 'Nepal', source: 'GDACS' }, 'nepal flood'], [{ title: 'Flood in Bagmati Province, Nepal', type: 'Flood', country: 'Nepal' }, 'india flood'], [{ title: 'M 5.6 - 10 km N of Ridgecrest, CA', type: 'Earthquake' }, 'magnitude'], [{ title: 'Wildfire near Austin, TX', type: 'Wildfire' }, 'texas'], [{ title: 'x' }, ''], [{ title: 'x', details: 'California coast' }, 'calif']]);
  vec('search.matchesPlace', (e, q) => S.matchesPlace(e, q), [[{ title: 'Flood in Nepal', country: 'Nepal' }, 'flood'], [{ title: 'Flood in Nepal', country: 'Nepal' }, 'nep'], [{ affectedCountries: 'India, Bangladesh' }, 'bangladesh']]);
  vec('search.emptyHtml', (q, pool, all, noun) => S.emptyHtml(q, pool, all, noun), [['', [], [], 'official alerts'], ['nepal', [], [{ title: 'Flood', country: 'Nepal' }, { title: 'Quake', country: 'Japan' }], 'official alerts'], ['mars', [], [{ title: 'Flood', country: 'Nepal' }, { title: 'Quake', country: 'Japan' }], 'forecasts']]);
  /* The "Right now we have N events from C countries" line counts reports
     only (no forecasts, no live:false), and a record naming two countries
     names two. */
  vec('search.emptyHtml.counts', (q, all) => S.emptyHtml(q, [], all, 'events'), [
    ['mars', [{ title: 'Flood', country: 'India, Nepal' }, { title: 'Quake', country: 'Japan' }, { title: 'Heat risk', country: 'Chile', forecast: true }, { title: 'Old', country: 'Peru', live: false }]],
    ['mars', [{ title: 'Flood', country: 'Nepal' }]]]);
  vec('search.countryCount', l => S.countryCount(l), [[[{ country: 'India, Nepal' }, { country: 'nepal' }, { country: ' Bangladesh ' }, { country: '' }, {}]]]);
  vec('glossary.expandAlways', t => G.expandAlways(t), ['M 6.5 - 126 km NNE of Tobelo, Indonesia', 'Magnitude 4.8 mb', '948 mb', 'Citrus, FL', 'Toronto, CA', 'M 5.0 mww', '12 km SW of Ridgecrest, CA']);

  // place-search
  vec('placeSearch.levelOf', r => PS.levelOf(r), [{ addresstype: 'suburb' }, { addresstype: 'city' }, { addresstype: 'county' }, { addresstype: 'state' }, { addresstype: 'country' }, { addresstype: 'road' }, { type: 'administrative', place_rank: 4 }, { type: 'administrative', place_rank: 8 }, { type: 'administrative', place_rank: 12 }, { type: 'administrative', place_rank: 16 }, { type: 'administrative', place_rank: 22 }, { type: 'administrative', place_rank: 28 }, {}]);
  vec('placeSearch.labelOf', r => PS.labelOf(r), [{ name: 'Koramangala', display_name: 'Koramangala, Bengaluru South, Bangalore Urban, Karnataka, 560034, India', address: { suburb: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', country: 'India' } }, { name: 'Mumbai', address: { city: 'Mumbai', state: 'Maharashtra', country: 'India' } }, { display_name: 'Somewhere, Far' }]);
  vec('placeSearch.candidates', l => PS.candidates(l), [[[{ lat: '12.93', lon: '77.62', name: 'Koramangala', display_name: 'Koramangala, Bengaluru, Karnataka, India', addresstype: 'suburb', address: { suburb: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', country: 'India', country_code: 'in' } }, { lat: '12.93', lon: '77.62', name: 'Koramangala', display_name: 'dup', addresstype: 'suburb', address: { city: 'Bengaluru', state: 'Karnataka', country: 'India' } }, { lat: 'x', lon: '1' }]]]);

  // verdicts
  vec('verdicts.normalise', s => V.normalise(s), ['VERIFIED', 'PARTIAL_VERIFICATION', 'partial', 'FALSE_ALARM', 'MISS_FALSE_POSITIVE', 'MISSED_EVENT', 'FALSE_NEGATIVE_UNPREDICTED_EVENT', 'COVERAGE_FAILURE', 'PENDING', '', null, 'BOGUS']);
  vec('verdicts.stateOf', r => V.stateOf(r, NOW), [{ status: 'VERIFIED' }, { outcome: 'MISS_FALSE_POSITIVE' }, { status: 'PENDING', targetEnd: '2026-10-25T00:00:00Z' }, { status: 'PENDING', targetEnd: '2026-10-01T00:00:00Z' }, { targetEnd: '2026-10-20T12:00:00Z' }, {}, { status: 'WEIRD' }]);
  vec('verdicts.engineState', v => V.engineState(v), [{ classification: 'HIT' }, { classification: 'PARTIAL_HIT' }, { classification: 'MISS_FALSE_POSITIVE' }, { classification: 'INVALID_POST_EVENT' }, { classification: 'PENDING', ungradeableReason: 'WINDOW_STILL_OPEN' }, { classification: 'PENDING', ungradeableReason: 'ABSENCE_NOT_ESTABLISHABLE' }, { classification: 'WHAT' }, {}, null]);
  vec('verdicts.rate', (h, t) => V.rate(h, t), [[0, 0], [1, 3], [2, 3], [5, 5]]);
  vec('verdicts.tally', l => V.tally(l, NOW), [[[{ status: 'VERIFIED', targetEnd: '2026-10-01T00:00:00Z' }, { status: 'PARTIAL', targetEnd: '2026-10-01T00:00:00Z' }, { status: 'FALSE_ALARM', targetEnd: '2026-10-01T00:00:00Z' }, { status: 'MISSED_EVENT' }, { status: 'COVERAGE_FAILURE' }, { targetEnd: '2026-10-30T00:00:00Z' }, { targetEnd: '2026-10-01T00:00:00Z' }, { _state: 'UNGRADEABLE', targetEnd: '2026-10-01T00:00:00Z' }, { _state: 'NOT_A_PREDICTION' }, { status: 'XYZ' }]]]);
  vec('verdicts.joinVerdicts', (rows, vs) => { const r = V.joinVerdicts(rows, vs); return { records: r.records.map(x => ({ id: x.id, targetStart: x.targetStart, status: x.status || null, region: x.region || null })), unattached: r.unattached.map(x => x.id) }; }, [[[{ id: 'A', targetStart: '2026-09-14T00:00:00Z', targetEnd: '2026-09-17T00:00:00Z', region: 'frozen' }, { id: 'A', targetStart: '2026-09-15T00:00:00Z', targetEnd: '2026-09-18T00:00:00Z' }, { id: 'B', targetStart: '2026-09-13T00:00:00Z', targetEnd: '2026-09-16T23:59:59Z', region: 'Hue-Da Nang' }], [{ id: 'A', targetStart: '2026-09-15T00:00:00Z', targetEnd: '2026-09-18T00:00:00Z', status: 'MISS_FALSE_POSITIVE' }, { id: 'B', targetStart: '2026-09-12T07:00:00Z', targetEnd: '2026-09-16T00:00:00Z', status: 'PARTIAL_VERIFICATION', region: 'wider corridor' }, { id: 'C', targetStart: 'x', status: 'VERIFIED' }]]]);
  vec('verification.score', (vs, as) => { const s = VER.score(vs, as); delete s.methodology; return s; }, [[[{ classification: 'HIT', gradeable: true, absenceEstablishable: true }, { classification: 'HIT', gradeable: true, absenceEstablishable: false }, { classification: 'PARTIAL_HIT', gradeable: true }, { classification: 'MISS_FALSE_POSITIVE', gradeable: true }, { classification: 'PENDING', gradeable: false, ungradeableReason: 'WINDOW_STILL_OPEN' }, { classification: 'PENDING', gradeable: false, ungradeableReason: 'ABSENCE_NOT_ESTABLISHABLE' }, { classification: 'INVALID_POST_EVENT', gradeable: true }], [{ falseNegative: false, matched: [{ result: 'HIT' }] }, { falseNegative: false, matched: [{ result: 'PARTIAL_HIT' }] }, { falseNegative: true, status: 'NOT_FORECASTABLE', matched: [] }, { falseNegative: true, status: 'COVERAGE_FAILURE', matched: [] }]], [[], []]]);
  vec('verification.predictingSince', p => VER.predictingSince(p), [[[{ forecastClass: 'independent-prospective', freezeTimestamp: '2026-10-05T00:00:00Z' }, { forecastClass: 'independent-prospective', recordedAt: '2026-10-03T00:00:00Z' }, { forecastClass: 'continuation-outlook', freezeTimestamp: '2026-09-01T00:00:00Z' }]], [[]]]);

  /* ================================================================
     Groups added after the website audit fixes (5992bf0, b9163f6 and
     4c11103). Each names the site function it was produced by.
     ================================================================ */

  // ---------- continents.js and PND.inPlace
  V_['continents.NAMES'] = J(C.NAMES);
  vec('continents.continentNamed', n => C.continentNamed(n), ['Asia', 'asia', ' Europe ', 'north america', 'North%20America', 'South America', 'Oceania', 'Africa', 'Antarctica', 'World', 'Japan', '', null]);
  const PLACES = [
    { id: 'jp', country: 'Japan' },
    { id: 'in-np', countries: ['India', 'Nepal'] },
    { id: 'in-bd', country: 'India, Bangladesh' },
    { id: 'ru', country: 'Russia' },
    { id: 'tr', country: 'Türkiye' },
    { id: 'nz-region', country: 'New Zealand region' },
    { id: 'sea', region: 'Pacific Ocean' },
    { id: 'us', country: 'United States', region: 'Texas' },
    { id: 'us-code', country: 'US' },
    { id: 'mx', country: 'México' },
    { id: 'br', countries: ['Brazil'], country: '' },
    { id: 'ci', country: "Côte d'Ivoire" },
    { id: 'aq', countries: ['Fr. S. Antarctic Lands'] },
    { id: 'gb', country: 'United Kingdom' },
    { id: 'title-only', title: 'Flood in Asia', details: 'Heavy rain across Asia' },
    { id: 'region-japan', region: 'Honshu, Japan' }
  ];
  V_['fixtures.places.continents'] = PLACES;
  vec('continents.continentsOf', id => C.continentsOf(PLACES.find(p => p.id === id)), PLACES.map(p => p.id));
  vec('continents.onContinent', (id, n) => C.onContinent(PLACES.find(p => p.id === id), n), [['jp', 'Asia'], ['jp', 'asia'], ['ru', 'Asia'], ['ru', 'Europe'], ['tr', 'Europe'], ['nz-region', 'Oceania'], ['sea', 'Oceania'], ['us', 'North America'], ['us-code', 'North America'], ['mx', 'North America'], ['br', 'South America'], ['ci', 'Africa'], ['aq', 'Antarctica'], ['title-only', 'Asia'], ['gb', 'Europe'], ['jp', 'World'], ['jp', 'Japan']]);
  vec('portal.inPlace', (id, q) => P.inPlace(PLACES.find(p => p.id === id), q), [['jp', 'Asia'], ['in-np', 'Asia'], ['in-np', 'nepal'], ['in-bd', 'bangladesh'], ['ru', 'Europe'], ['sea', 'Asia'], ['sea', 'pacific'], ['us', 'North America'], ['us', 'texas'], ['us', 'United'], ['br', 'Brazil'], ['br', 'braz'], ['title-only', 'Asia'], ['title-only', 'flood'], ['region-japan', 'Japan'], ['region-japan', 'Asia'], ['jp', 'World'], ['jp', ''], ['nz-region', 'Oceania']]);

  // ---------- region-detail.html matches(), cut out of the page
  const RD = read('region-detail.html');
  /* The place asked for, under its one name (country-names.js), then the matcher. */
  const rdContinent = ['const continent=window.PNDContinents', 'const atSea=', 'const world=', 'const country=', 'let region=']
    .map(st => statement(RD, st, 'region-detail.html')).join('');
  const rdMatches = block(RD, 'function matches(e){', 'region-detail.html');
  const regionMatcher = w.eval('(function(asked){' + rdContinent + rdMatches + 'return {region:region,matches:matches};})');
  vec('regionDetail.matches', (region, ids) => { const m = regionMatcher(region); return { region: m.region, ids: PLACES.filter(p => ids.includes(p.id)).filter(m.matches).map(p => p.id) }; },
    ['World', 'Asia', 'europe', 'North America', 'Oceania', 'Japan', 'Texas', 'Flood'].map(r => [r, PLACES.map(p => p.id)]));

  // ---------- PND.hazardKey / sameHazard
  vec('portal.hazardKey', t => P.hazardKey(t), ['Extreme Cold', 'Extreme Heat', 'Heat wave', 'Winter storm', 'Volcanic Eruption', 'Volcano', 'Earthquake', 'Earthquake aftershock sequence', 'Flood', 'Flood / Landslide', 'Flash flood and mudslide', 'Tropical Cyclone', 'Hurricane', 'Wildfire', 'Severe Storm', 'Severe Thunderstorm Warning', 'Special Marine Warning', 'Ice', 'Snow', 'Other', '  Drought  ', 'Tsunami', 'Tornado', '', null]);
  vec('portal.sameHazard', (a, b) => P.sameHazard(a, b), [['Extreme Cold', 'Extreme Heat'], ['Extreme Cold', 'Winter storm'], ['Heat wave', 'Extreme Heat'], ['Volcanic Eruption', 'Volcano'], ['Hurricane', 'Tropical Cyclone'], ['Ice', 'ice'], ['Ice', 'Snow'], ['Flood', 'Flood / Landslide'], ['Earthquake', 'Earthquake aftershock sequence'], ['Severe Thunderstorm Warning', 'Severe Storm'], ['Special Marine Warning', 'Severe Storm'], ['flood', 'FLOOD']]);

  // ---------- hazard-detail.html: the hazard choice and the match
  const HD = read('hazard-detail.html');
  const fillSrc = block(HD, 'function fillHazards(present){', 'hazard-detail.html');
  const hereSrc = statement(HD, 'const here=e=>', 'hazard-detail.html');
  const hazardChoice = w.eval('(function(type,present){const hazSel=document.createElement("select");' + fillSrc +
    'fillHazards([]);const first=hazSel.value;fillHazards(present);return {options:[...hazSel.options].map(o=>o.value),selectedAtStart:first,selected:hazSel.value};})');
  vec('hazardDetail.fillHazards', (type, present) => hazardChoice(type, present), [
    ['Flood', []], ['Extreme Heat', ['Extreme Heat', 'Flood']], ['Volcanic Eruption', ['Volcanic Eruption']], ['Special Marine Warning', ['Special Marine Warning', 'Ice']], ['Extreme Cold', ['Extreme Heat']]]);
  const HAZ_EVENTS = [
    { id: 'heat-fc', type: 'Extreme Heat', forecast: true, country: 'India', alert: 'High' },
    { id: 'heat-fc-ended', type: 'Extreme Heat', forecast: true, windowClosed: true, country: 'India' },
    { id: 'heat-obs', type: 'Heat wave', sourceType: 'official', country: 'India' },
    { id: 'cold-obs', type: 'Extreme Cold', sourceType: 'official', country: 'United States' },
    { id: 'winter', type: 'Winter storm', sourceType: 'official', country: 'Canada' },
    { id: 'volc', type: 'Volcanic Eruption', sourceType: 'official', country: 'Indonesia' },
    { id: 'volc2', type: 'Volcano', sourceType: 'official', country: 'Japan' },
    { id: 'quiet', type: 'Volcano', sourceType: 'official', country: 'Japan', live: false },
    { id: 'quake', type: 'Earthquake', sourceType: 'official', country: 'Japan' },
    { id: 'aftershock', type: 'Earthquake aftershock sequence', forecast: true, country: 'Japan' }
  ];
  V_['fixtures.events.hazards'] = HAZ_EVENTS;
  const hazardHere = w.eval('(function(value,rr){const hazSel={value:value};' + hereSrc + 'return here;})');
  vec('hazardDetail.select', (hazard, region) => {
    const here = hazardHere(hazard, String(region || '').trim());
    return { events: P.observed(HAZ_EVENTS).filter(here).map(e => e.id), openForecasts: P.openForecasts(HAZ_EVENTS).filter(here).map(e => e.id) };
  }, [['Extreme Cold', ''], ['Extreme Heat', ''], ['Extreme Heat', 'india'], ['Volcano', ''], ['Volcano', 'Asia'], ['Earthquake', ''], ['Earthquake aftershock sequence', ''], ['Flood', '']]);

  // ---------- official warnings, counts and status words (portal.js)
  const OW = [
    { id: 'nws-warn', evidenceState: 'official-warning', sourceType: 'official', alert: 'Moderate' },
    { id: 'observed-red', evidenceState: 'observed', sourceType: 'official', alert: 'Red', expiresAt: '2026-10-21T00:00:00Z' },
    { id: 'no-state-expires', sourceType: 'official', expiresAt: '2026-10-21T00:00:00Z' },
    { id: 'no-state-red', sourceType: 'official', alert: 'Red' },
    { id: 'usgs-orange', sourceType: 'official', source: 'USGS', alert: 'Orange', evidenceState: 'observed' },
    { id: 'forecast-warn', forecast: true, evidenceState: 'official-warning' },
    { id: 'empty-state-expires', evidenceState: '', sourceType: 'official', expiresAt: '2026-10-21T00:00:00Z' },
    { id: 'aggregator-expires', sourceType: 'aggregator', expiresAt: '2026-10-21T00:00:00Z' },
    { id: 'forecast-state', evidenceState: 'forecast', sourceType: 'official' },
    { id: 'quiet-warn', evidenceState: 'official-warning', live: false }
  ];
  V_['fixtures.events.warnings'] = OW;
  vec('portal.isOfficialWarning', id => P.isOfficialWarning(id === null ? null : OW.find(e => e.id === id)), OW.map(e => e.id).concat([null]));
  V_['portal.officialWarnings'] = { in: OW.map(e => e.id), out: P.officialWarnings(OW).map(e => e.id) };
  V_['portal.WARNING_MEANING'] = P.WARNING_MEANING;
  const MIX = [
    { id: 'report', sourceType: 'official', source: 'GDACS', alert: 'Red' },
    { id: 'report-high', source: 'NOAA / National Weather Service', alert: 'High' },
    { id: 'report-orange-quiet', source: 'GDACS', alert: 'Orange', live: false },
    { id: 'report-green', source: 'USGS', alert: 'Green' },
    { id: 'fc-open', forecast: true, alert: 'Red', source: 'Predict Natural Disasters' },
    { id: 'fc-ended', forecast: true, windowClosed: true, alert: 'High' },
    { id: 'fc-quiet', forecast: true, live: false },
    { id: 'cached', cached: true, source: 'USGS' },
    { id: 'no-source' }
  ];
  V_['fixtures.events.mixed'] = MIX;
  V_['portal.observed'] = { in: MIX.map(e => e.id), out: P.observed(MIX).map(e => e.id) };
  V_['portal.openForecasts'] = { in: MIX.map(e => e.id), out: P.openForecasts(MIX).map(e => e.id) };
  vec('portal.isHighAlert', id => P.isHighAlert(id === null ? null : MIX.find(e => e.id === id)), MIX.map(e => e.id).concat([null]));
  vec('portal.sourcesReporting', ids => P.sourcesReporting(MIX.filter(e => ids.includes(e.id))), [[MIX.map(e => e.id)], [['report', 'report-orange-quiet', 'report-green', 'cached']], [[]]]);
  vec('portal.liveWord', e => P.liveWord(e), [{ cached: true, forecast: true }, { forecast: true }, { forecast: true, live: false }, { live: false }, { live: true }, {}, null]);

  // ---------- record status words on the detail pages
  const ED = read('event-detail.html'), CD = read('calamity-detail.html');
  const eyebrowSrc = statement(ED, "eyebrow.textContent=e.forecast?", 'event-detail.html');
  const recordStateSrc = statement(ED, 'recordState.textContent=', 'event-detail.html');
  const tStateSrc = statement(CD, 'tState.textContent=', 'calamity-detail.html');
  const words = w.eval('(function(e){const eyebrow={},recordState={},tState={},kMode={};' + eyebrowSrc + recordStateSrc + tStateSrc +
    'kMode.textContent=PND.liveWord(e);return {eventEyebrow:eyebrow.textContent,eventDataStatus:kMode.textContent,eventRecordState:recordState.textContent,calamityStatus:tState.textContent};})');
  vec('detail.statusWords', e => words(e), [{ live: true, source: 'GDACS' }, { live: false, quietDays: 48, source: 'GDACS' }, { live: false }, { forecast: true }, { cached: true }, { cached: true, live: false }]);

  // ---------- collection.js: which records each list keeps
  const CO = read('collection.js');
  const keepSrc = block(CO, 'function keep(e){', 'collection.js');
  const scopedSrc = block(CO, 'function scoped(){', 'collection.js');
  const countSrc = block(CO, 'function countText(shown,noun){', 'collection.js');
  const collection = w.eval('(function(mode,all,regionScope){const forecastMode=mode==="forecast-list"||mode==="forecast-calendar";' + keepSrc + scopedSrc + countSrc +
    'const s=scoped();return {kept:all.filter(keep).map(e=>e.id),scoped:s.map(e=>e.id),countText:mode==="resources"?null:countText(s.length,"items")};})');
  const LIST = OW.concat(MIX.filter(e => e.forecast), PLACES.map(p => Object.assign({ sourceType: 'official' }, p)));
  V_['fixtures.events.collection'] = LIST;
  vec('collection.keep', (mode, region) => collection(mode, LIST, region || ''), [
    ['official-warnings'], ['alerts-notifications'], ['recent-events'], ['forecast-list'], ['events'], ['events', 'Asia'], ['events', 'Japan'], ['events', 'World'], ['official-warnings', 'North America']]);

  // ---------- verdict labels and the forecast page's grade
  V_['verdicts.LABELS'] = J(V.LABELS);
  vec('verdicts.label', s => V.LABELS[V.normalise(s)] || null, ['VERIFIED', 'PARTIAL_VERIFICATION', 'PARTIAL', 'FALSE_ALARM', 'MISS_FALSE_POSITIVE', 'MISSED_EVENT', 'COVERAGE_FAILURE', 'PENDING', 'BOGUS', '']);
  const FD = read('forecast-detail.html');
  const gradeSrc = block(FD, 'async function gradeOf(id){', 'forecast-detail.html');
  const gradeOf = w.eval('(function(fetch){' + gradeSrc + 'return gradeOf;})');
  const serve = files => async u => {
    const key = String(u).split('?')[0];
    if (!(key in files) || files[key] === 404) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(files[key])) };
  };
  const LEDGER = { verifications: [
    { id: 'ND-001', status: 'PARTIAL_VERIFICATION', summary: 'Heavy rain fell in the corridor, below the forecast severity.' },
    { id: 'OUT-pending', status: 'PENDING' },
    { id: 'OUT-bogus', status: 'BOGUS' },
    { id: 'OUT-miss', status: 'MISS_FALSE_POSITIVE' },
    { id: 'model-both', status: 'VERIFIED', summary: 'From the ledger.' }
  ] };
  const MODEL = { outlooks: [
    { id: 'model-heat-1', verdict: 'correct' },
    { id: 'model-rain-2', verdict: 'false alarm' },
    { id: 'model-fire-3', verdict: 'pending' },
    { id: 'model-both', verdict: 'false alarm' }
  ] };
  V_['fixtures.verdictFiles'] = { '/data/verification-ledger.json': LEDGER, '/data/model-verdicts.json': MODEL };
  await avec('forecastDetail.gradeOf', async (id, targetEnd, down) => {
    const files = down ? {} : { '/data/verification-ledger.json': LEDGER, '/data/model-verdicts.json': MODEL };
    const g = await gradeOf(serve(files))(id);
    /* STATUS: the page writes the ungraded word first, then the grade over it. */
    const base = targetEnd && Date.parse(targetEnd) < NOW ? 'Ended, not yet checked' : 'Active';
    return { grade: g, status: g ? 'Checked: ' + g.label : base };
  }, [['ND-001', '2026-09-16T23:59:59Z'], ['OUT-pending', '2026-10-01T00:00:00Z'], ['OUT-pending', '2026-10-30T00:00:00Z'], ['OUT-bogus', '2026-10-01T00:00:00Z'], ['OUT-miss', '2026-10-01T00:00:00Z'],
    ['model-heat-1', '2026-10-10T00:00:00Z'], ['model-rain-2', '2026-10-10T00:00:00Z'], ['model-fire-3', '2026-10-10T00:00:00Z'], ['model-both', '2026-10-10T00:00:00Z'], ['ND-001', '2026-09-16T23:59:59Z', true], ['OUT-unknown', null]]);

  // ---------- the browser-timezone default (portal.js PND.timezone)
  vec('portal.timezoneDefault', (stored, browserZone) => {
    const wz = env({ tz: null, before: x => {
      if (stored) x.localStorage.setItem('pnd_timezone', stored);
      x.eval('(function(){var R=Intl.DateTimeFormat.prototype.resolvedOptions;Intl.DateTimeFormat.prototype.resolvedOptions=function(){' +
        (browserZone === 'throws' ? 'throw new Error("no zone")' : 'var o=R.call(this);o.timeZone=' + JSON.stringify(browserZone) + ';return o') + '}})()');
    } });
    return { timezone: wz.PND.timezone, tzLabel: wz.PND.tzLabel(), fmtDate: wz.PND.fmtDate('2026-10-20T11:24:19Z') };
  }, [[null, 'America/New_York'], [null, 'Asia/Kolkata'], [null, 'Europe/London'], [null, 'Asia/Kathmandu'], [null, ''], [null, 'throws'], ['UTC', 'America/New_York'], ['Asia/Tokyo', 'Europe/Paris']]);

  // ---------- C27: the zone's label beside a time (portal.js tzLabel, tzMenuLabel)
  V_['portal.zoneLabel'] = [];
  for (const tz of ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Europe/Paris', 'America/Chicago', 'America/Phoenix', 'Etc/GMT+5']) {
    const wz = env({ tz });
    for (const at of ['2026-10-20T11:24:19Z', '2026-01-05T18:05:00Z']) {
      V_['portal.zoneLabel'].push({ in: { tz, at }, out: { label: wz.PND.tzLabel(tz, at), fmtDate: wz.PND.fmtDate(at), fmtTime: wz.PND.fmtTime(at), menuLabel: wz.PND.tzMenuLabel(tz, at) } });
    }
  }

  // ---------- whole pages, rendered with a fixed feed
  V_['home.render'] = await homeVectors();
  V_['home.placeAnswerStates'] = await placeAnswerVectors();
  V_['alerts.pager'] = await alertsPagerVectors();
  V_['verificationDetail.render'] = await verificationDetailVectors();

  for (const x of WINDOWS) { try { x.close(); } catch (e) { /* already closed */ } }
  WINDOWS.length = 0;
  return V_;
}

/* A page rendered by test/render.js, with /api/events and any /data file
   named in `files` answered from memory instead of the repository. */
async function renderWith(page, feed, files, waitFor, search) {
  const { renderPage } = require(path.join(ROOT, 'test', 'render.js'));
  return renderPage(page, {
    search,
    storage: { pnd_timezone: TZ },
    beforeParse(window) {
      window.eval(EN_US_NUMBERS);
      const orig = window.fetch;
      window.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        const key = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        const body = /^\/api\/events$/.test(key) ? feed : files && key in files ? files[key] : undefined;
        if (body !== undefined) {
          const copy = JSON.parse(JSON.stringify(body));
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => copy, text: async () => JSON.stringify(copy) };
        }
        return orig(input);
      };
    },
    waitFor,
    timeoutMs: 15000
  });
}

/* alerts.html shows 40 official reports at a time and says how many exist. */
async function alertsPagerVectors() {
  const events = Array.from({ length: 45 }, (_, i) => ({
    id: 'usgs-p' + i, type: 'Earthquake', title: 'M 4.' + (i % 10) + ' - Testville ' + i + ', Japan', source: 'USGS', sourceType: 'official',
    evidenceState: 'observed', alert: 'Green', severityRank: 1, country: 'Japan', lat: 33 + i / 20, lon: 130 + i / 10,
    updated: new Date(NOW - (i + 1) * 3600e3).toISOString()
  })).concat([{ id: 'eonet-x', type: 'Wildfire', title: 'Not official', source: 'NASA EONET', sourceType: 'aggregator', lat: 1, lon: 1, updated: new Date(NOW).toISOString() }]);
  const feed = { generatedAt: new Date(NOW).toISOString(), meta: { live: true, sources: { usgs: { ok: true } } }, events };
  const r = await renderWith('alerts.html', feed, null, d => d.querySelectorAll('#alerts .al').length > 0);
  const d = r.document;
  const state = () => ({
    shown: d.querySelectorAll('#alerts .al').length,
    note: (d.querySelector('#alerts .showmore p, #alerts > p.muted') || { textContent: '' }).textContent.trim(),
    button: d.getElementById('showMore') ? d.getElementById('showMore').textContent.trim() : null,
    kOfficial: d.getElementById('kOfficial').textContent.trim()
  });
  const out = { feedRecords: events.length, officialRecords: events.filter(e => e.sourceType === 'official').length, pageSize: 40, steps: [] };
  out.steps.push({ action: 'load', out: state() });
  d.getElementById('showMore').click();
  out.steps.push({ action: 'show more', out: state() });
  r.close();
  return out;
}

/* verification-detail.html (ND-001): the eight-row comparison and the stats. */
async function verificationDetailVectors() {
  const ND = { id: 'ND-001', forecast: true, forecastKind: 'frozen-benchmark', title: 'Central Vietnam flood and landslide forecast', type: 'Flood / Landslide',
    region: 'Hue to Da Nang corridor', country: 'Vietnam', alert: 'High', details: 'Extreme rain, then floods and landslides.',
    targetStart: '2026-09-13T00:00:00Z', targetEnd: '2026-09-16T23:59:59Z', updated: '2026-09-13T19:20:03Z', lat: 16.2, lon: 107.9 };
  const reports = [
    { id: 'gdacs-vn-1', type: 'Flood', title: 'Flood in Vietnam', source: 'GDACS', sourceType: 'official', country: 'Vietnam', region: 'Thua Thien Hue', alert: 'Orange', startedAt: '2026-09-13T06:00:00Z', updated: '2026-09-15T00:00:00Z', deaths: 7, lat: 16.4, lon: 107.6 },
    { id: 'rw-vn-2', type: 'Landslide', title: 'Landslides in Quang Nam', source: 'ReliefWeb (UN OCHA)', sourceType: 'official', country: 'Vietnam', alert: 'Red', startedAt: '2026-09-15T12:30:00Z', updated: '2026-09-16T00:00:00Z', deaths: 0, lat: 15.5, lon: 108 },
    { id: 'usgs-vn-3', type: 'Earthquake', title: 'M 4.6 - 30 km W of Quang Ngai, Vietnam', source: 'USGS', sourceType: 'official', country: 'Vietnam', alert: 'Green', updated: '2026-09-14T00:00:00Z', lat: 15.1, lon: 108.5 },
    { id: 'gdacs-ph', type: 'Flood', title: 'Flood in the Philippines', source: 'GDACS', sourceType: 'official', country: 'Philippines', alert: 'Orange', startedAt: '2026-09-14T00:00:00Z', updated: '2026-09-14T00:00:00Z', deaths: 3, lat: 14.6, lon: 121 }
  ];
  const cases = [
    { name: 'graded, with reports', events: [ND].concat(reports), ledger: { verifications: [{ id: 'ND-001', status: 'PARTIAL_VERIFICATION' }] } },
    { name: 'not graded, no matching report', events: [ND, reports[3]], ledger: { verifications: [{ id: 'ND-001', status: 'PENDING' }] } },
    { name: 'no ledger row', events: [ND], ledger: { verifications: [] } }
  ];
  const out = [];
  for (const c of cases) {
    const feed = { generatedAt: new Date(NOW).toISOString(), meta: { live: true, sources: { gdacs: { ok: true } } }, events: c.events };
    const r = await renderWith('verification-detail.html', feed, { '/data/verification-ledger.json': c.ledger },
      d => d.querySelectorAll('#compareRows tr').length === 8 && d.getElementById('kVerdict').textContent !== '-', '?id=ND-001');
    const d = r.document;
    const t = id => d.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
    out.push({ in: { name: c.name, events: c.events.map(e => e.id), ledger: c.ledger }, out: {
      kVerdict: t('kVerdict'), kEvidence: t('kEvidence'), kTarget: t('kTarget'), kWindow: t('kWindow'),
      rows: [...d.querySelectorAll('#compareRows tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim())),
      evidence: [...d.querySelectorAll('#evidence a.event-card')].map(a => decodeURIComponent(a.getAttribute('href')))
    } });
    r.close();
  }
  return { fixtures: { forecast: ND, reports }, cases: out };
}

/* index.html with a fixed feed: what its tiles, "Live events" card, tables,
   hazard strip and hazard filter show for each sort and hazard choice. */
async function homeVectors() {
  const T = h => new Date(NOW - h * 3600e3).toISOString();
  const EVENTS = [
    { id: 'usgs-jp', type: 'Earthquake', title: 'M 5.1 - 20 km E of Miyako, Japan', source: 'USGS', sourceType: 'official', evidenceState: 'observed', alert: 'Green', severity: 'Moderate', severityRank: 2, country: 'Japan', lat: 39.6, lon: 142.2, updated: T(1) },
    { id: 'gdacs-fl', type: 'Flood', title: 'Flood in India and Bangladesh', source: 'GDACS', sourceType: 'official', evidenceState: 'observed', alert: 'Red', severity: 'Extreme', severityRank: 5, country: 'India, Bangladesh', lat: 24, lon: 90, updated: T(5), deaths: 12 },
    { id: 'nws-ff', type: 'Flood', title: 'Flash Flood Warning', source: 'NOAA / National Weather Service', sourceType: 'official', evidenceState: 'official-warning', alert: 'Orange', severity: 'Severe', severityRank: 4, country: 'United States', region: 'Arizona', lat: 33.4, lon: -112, updated: T(2), expiresAt: new Date(NOW + 6 * 3600e3).toISOString() },
    { id: 'nws-cold', type: 'Extreme Cold', title: 'Extreme Cold Warning', source: 'NOAA / National Weather Service', sourceType: 'official', evidenceState: 'official-warning', alert: 'Moderate', severity: 'Moderate', severityRank: 3, country: 'United States', region: 'Alaska', lat: 64.8, lon: -147.7, updated: T(3), expiresAt: new Date(NOW + 30 * 3600e3).toISOString() },
    { id: 'nws-heat', type: 'Extreme Heat', title: 'Excessive Heat Warning', source: 'NOAA / National Weather Service', sourceType: 'official', evidenceState: 'official-warning', alert: 'Orange', severity: 'Severe', severityRank: 4, country: 'United States', region: 'Texas', lat: 29.4, lon: -98.5, updated: T(4) },
    { id: 'gdacs-vo', type: 'Volcano', title: 'Volcano Lewotobi', source: 'GDACS', sourceType: 'official', alert: 'Orange', severity: 'Severe', severityRank: 4, country: 'Indonesia', lat: -8.5, lon: 122.8, updated: T(6) },
    { id: 'expires-only', type: 'Severe Storm', title: 'Storm warning with an end time', source: 'Example agency', sourceType: 'official', alert: 'Moderate', severityRank: 3, country: 'Philippines', lat: 14.6, lon: 121, updated: T(7), expiresAt: new Date(NOW + 12 * 3600e3).toISOString() },
    { id: 'eonet-wf', type: 'Wildfire', title: 'Wildfire in Attica', source: 'NASA EONET', sourceType: 'aggregator', alert: 'Watch', country: 'Greece', lat: 38, lon: 23.7, updated: T(0.5) },
    { id: 'OUT-heat', type: 'Extreme Heat', title: '5-day Extreme Heat risk outlook - India', forecast: true, alert: 'High', severity: 'Severe', severityRank: 4, country: 'India', lat: 28.6, lon: 77.2, updated: T(0.25), targetStart: T(-6), targetEnd: T(-102), windowClosed: false },
    { id: 'OUT-after', type: 'Earthquake aftershock sequence', title: 'Aftershock-sequence outlook - 20 km E of Miyako, Japan', forecast: true, alert: 'Watch', severityRank: 2, country: 'Japan', lat: 39.6, lon: 142.2, updated: T(0.75), targetStart: T(1), targetEnd: T(-167) },
    { id: 'OUT-ended', type: 'Flood', title: '3-day Flood risk outlook - Nepal', forecast: true, alert: 'Moderate', severityRank: 3, country: 'Nepal', lat: 27.7, lon: 85.3, updated: T(80), targetStart: T(96), targetEnd: T(24), windowClosed: true },
    { id: 'quiet', type: 'Flood', title: 'Flood no longer updated', source: 'GDACS', sourceType: 'official', evidenceState: 'official-warning', alert: 'Red', severityRank: 5, country: 'Peru', lat: -12, lon: -77, updated: T(900), live: false }
  ];
  const feed = { generatedAt: new Date(NOW).toISOString(), meta: { live: true, sources: { gdacs: { ok: true }, usgs: { ok: true } } }, events: EVENTS };
  const r = await renderWith('index.html', feed, null, d => d.querySelector('#topEvents .event') && d.querySelector('#hazardStrip .hazard'));
  const d = r.document, win = r.window;
  const txt = id => d.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
  const rows = id => [...d.querySelectorAll('#' + id + ' tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
  const read = () => ({
    kEvents: txt('kEvents'), kEventsNote: txt('kEventsNote'), kWarnings: txt('kWarnings'),
    kForecasts: txt('kForecasts'), kForecastsNote: txt('kForecastsNote'), kCountries: txt('kCountries'),
    liveEvents: [...d.querySelectorAll('#topEvents .event')].map(x => x.dataset.id),
    latestEvents: rows('recentRows'), officialWarnings: rows('warningRows'), latestForecasts: rows('forecastRows'),
    hazardStrip: [...d.querySelectorAll('#hazardStrip .hazard')].map(x => ({
      hazard: x.querySelector('b').textContent.replace(/^\S+\s/, '').trim(),
      text: x.querySelector('span').textContent.replace(/\s+/g, ' ').trim(),
      link: (x.getAttribute('onclick') || '').replace(/^GO\('|'\)$/g, '')
    }))
  });
  const sortSel = d.getElementById('sortBy'), hazSel = d.getElementById('hazardFilter');
  const out = {
    feed: EVENTS,
    hazardFilterOptions: [...hazSel.options].map(o => ({ value: o.value, label: o.textContent })),
    sortOptions: [...sortSel.options].map(o => ({ value: o.value, label: o.textContent })),
    warningsTileNote: d.querySelector('#kWarnings').closest('.kpi').querySelector('.delta').textContent.trim(),
    warningsTileTitle: d.querySelector('#kWarnings').closest('.kpi').querySelector('.delta').getAttribute('title'),
    liveEventsHeading: [...d.querySelectorAll('h2, h3')].map(h => h.textContent.trim()).find(t => /live events/i.test(t)) || null,
    cases: []
  };
  for (const [hazard, sort] of [['', 'newest'], ['', 'severity'], ['', 'oldest'], ['', 'title'], ['Extreme Cold', 'newest'], ['Extreme Heat', 'newest'], ['Flood', 'severity'], ['Earthquake', 'newest']]) {
    hazSel.value = hazard;
    sortSel.value = sort;
    sortSel.dispatchEvent(new win.Event('change'));
    hazSel.dispatchEvent(new win.Event('change'));
    out.cases.push({ in: { hazardFilter: hazard, sort }, out: read() });
  }
  r.close();
  return out;
}

/* C26. The home page's answer for a saved place before, and after, the feed
   loads: "Checking…" while the first load is in flight, "Live data
   unavailable" when it failed, and a real answer once data arrives. */
async function placeAnswerVectors() {
  const { renderPage } = require(path.join(ROOT, 'test', 'render.js'));
  const place = { id: 'loc-1', kind: 'Home', name: 'Delhi home', lat: 28.61, lon: 77.21, country: 'India', countryCode: 'IN' };
  const hit = { id: 'usgs-dl', type: 'Earthquake', title: 'M 5.6 - 12 km N of Delhi, India', source: 'USGS', sourceType: 'official', evidenceState: 'observed', proximityEligible: true, magnitude: 5.6, alert: 'Orange', severity: 'Severe', severityRank: 4, country: 'India', region: 'Delhi', lat: 28.7, lon: 77.2, updated: new Date(NOW - 3600e3).toISOString() };
  const far = { id: 'usgs-jp', type: 'Earthquake', title: 'M 5.1 - 20 km E of Miyako, Japan', source: 'USGS', sourceType: 'official', evidenceState: 'observed', alert: 'Green', severityRank: 2, country: 'Japan', lat: 39.6, lon: 142.2, updated: new Date(NOW - 3600e3).toISOString() };
  const feedOf = events => ({ generatedAt: new Date(NOW).toISOString(), meta: { live: true, sources: { gdacs: { ok: true }, usgs: { ok: true } } }, events });
  const cases = [
    { state: 'loading', steps: ['hang'] },
    { state: 'failed', steps: ['fail'] },
    { state: 'loaded-empty', steps: [[far]] },
    { state: 'loaded-with-hits', steps: [[hit, far]] },
    { state: 'failed-then-loaded', steps: ['fail', [hit, far]] }
  ];
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
  /* Text as read: each text node apart, so "<b>Live data unavailable.</b><p>We…" keeps its space. */
  const words = el => { if (!el) return ''; const out = [], tw = el.ownerDocument.createTreeWalker(el, 4); while (tw.nextNode()) out.push(tw.currentNode.nodeValue); return clean(out.join(' ')); };
  const out = [];
  for (const c of cases) {
    let step = c.steps[0];
    const r = await renderPage('index.html', {
      storage: { pnd_timezone: TZ, pnd_saved_locations: JSON.stringify([place]) },
      beforeParse(w) {
        w.eval(EN_US_NUMBERS);
        /* "reported 1 hr ago" and "Last checked" read the clock. */
        w.eval('Date.now=function(){return ' + NOW + '};');
        const orig = w.fetch;
        w.fetch = async (input) => {
          const url = String(input && input.url ? input.url : input);
          if (!/\/api\/events(?:\?|$)/.test(url)) return orig(input);
          if (step === 'hang') return new Promise(() => {});
          if (step === 'fail') return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
          const copy = feedOf(JSON.parse(JSON.stringify(step)));
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => copy, text: async () => JSON.stringify(copy) };
        };
      },
      waitFor: d => { const p = d.getElementById('placeResult'); return p && !p.hidden && (step === 'hang' || !/Checking…/.test(p.textContent)); },
      timeoutMs: step === 'hang' ? 1500 : 15000
    });
    for (const s2 of c.steps.slice(1)) { step = s2; await r.window.load(); }
    const d = r.document;
    const block = h => { const b = [...d.querySelectorAll('#placeResult .pr-block')].find(x => clean(x.querySelector('h3').textContent) === h); return b || null; };
    const happening = block("What's happening"), why = block("Why we're showing this"), last = block('Last checked');
    out.push({ in: { state: c.state, place, feed: c.steps.map(s2 => Array.isArray(s2) ? s2.map(e => e.id) : s2) }, out: {
      eyebrow: clean(d.querySelector('#placeResult .pr-eyebrow').textContent),
      badge: clean(d.querySelector('#placeResult .pr-top .risk').textContent),
      heading: clean(d.querySelector('#placeResult h2').textContent),
      happening: happening ? [...happening.children].slice(1).map(words).join(' ') : '',
      unavailableCard: !!d.querySelector('#placeResult .card.unavailable'),
      why: why ? clean(why.querySelector('p').textContent) : null,
      steps: [...d.querySelectorAll('#placeResult .pr-block li')].map(li => clean(li.textContent)),
      lastChecked: last ? clean(last.querySelector('p').textContent) : null,
      busy: d.getElementById('placeResult').getAttribute('aria-busy')
    } });
    r.close();
  }
  return { placeAnswerStates: ['loading', 'failed', 'loaded'], cases: out };
}

const serialise = v => JSON.stringify(v, null, 1);

module.exports = { build, serialise, OUT };

if (require.main === module) {
  build().then(v => {
    const text = serialise(v);
    if (process.argv.includes('--check')) {
      const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
      if (cur !== text) { console.error(path.relative(ROOT, OUT) + ' is stale: run node tools/make-parity-vectors.js'); process.exit(1); }
      console.log(path.relative(ROOT, OUT) + ' is up to date (' + (Object.keys(v).length - 1) + ' groups)');
    } else {
      fs.writeFileSync(OUT, text);
      console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + (Object.keys(v).length - 1) + ' groups)');
    }
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
