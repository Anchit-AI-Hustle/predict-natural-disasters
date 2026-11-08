'use strict';
/**
 * Launch audit B (29 to 30 Oct 2026), the feed half: what api/events.js
 * publishes about cyclones, earthquakes, places, NWS products and staleness.
 * Each test names the finding it holds.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join(__dirname, '..', 'api', 'events.js'));

/* ------------------------------------------------------------------ B2 */

test('B2: a GDACS cyclone publishes its peak wind, never GDACS\'s storm-class word', () => {
  const m = api.gdacsMeasurement({ severity: 222, severityunit: 'km/h',
    severitytext: 'Tropical Storm (maximum wind speed of 222 km/h)' }, 'TC');
  assert.ok(Math.abs(m.windKt - 119.87) < 0.1);
  assert.equal(m.severityText, 'Peak wind 222 km/h (120 kt)');
  for (const word of ['Tropical Storm', 'Tropical Depression', 'Hurricane']) {
    assert.ok(!m.severityText.includes(word), word);
  }
  const polo = api.gdacsMeasurement({ severity: 287, severityunit: 'Kph', severitytext: 'Tropical Depression (maximum wind speed of 287 km/h)' }, 'TC');
  assert.doesNotMatch(polo.severityText, /Depression/);
  // A speed in a unit nobody can read is not published at all.
  assert.equal(api.gdacsMeasurement({ severity: 90, severityunit: 'furlongs', severitytext: 'Tropical Storm' }, 'TC').severityText, undefined);
});

test('B2/B11: a cyclone is live for 24 hours after its provider last updated it, not three days', () => {
  const now = Date.parse('2026-10-29T19:19:00Z');
  const arnab = { type: 'Tropical Cyclone', updated: '2026-10-28T06:00:00Z' };
  const fresh = { type: 'Tropical Cyclone', updated: '2026-10-29T06:00:00Z' };
  api.markLive([arnab, fresh], now);
  assert.equal(arnab.live, false, 'Arnab, 37 h quiet, was still "Live"');
  assert.equal(arnab.quietHours, 37);
  assert.equal(fresh.live, true);
  assert.equal(api.liveLimitHours({ type: 'Tropical Cyclone' }), 24);
  assert.equal(api.liveLimitHours({ type: 'Volcano' }), 14 * 24);
  assert.equal(api.liveLimitHours({ type: 'Earthquake' }), 7 * 24);
  // An observatory's level is a status in force until it is changed.
  assert.equal(api.liveLimitHours({ type: 'Volcano', alertLevel: 'ADVISORY' }), Infinity);
  const chikurachki = { type: 'Volcano', updated: '2026-09-21T00:00:00Z' };
  api.markLive([chikurachki], now);
  assert.equal(chikurachki.live, false, 'an eruption report 39 days quiet was "happening now"');
  const drought = { type: 'Drought', startedAt: '2022-09-21T00:00:00Z', updated: '2026-10-27T00:00:00Z' };
  api.markLive([drought], now);
  assert.equal(drought.live, true);
  assert.equal(drought.ongoingSince, '2022-09-21T00:00:00Z');
});

/* ------------------------------------------------------------------ B3 */

test('B3: an NWS watch or advisory ranks below a warning, and says which it is', () => {
  assert.equal(api.nwsProduct('Flash Flood Warning'), 'warning');
  assert.equal(api.nwsProduct('Freeze Watch'), 'watch');
  assert.equal(api.nwsProduct('Flood Watch'), 'watch');
  assert.equal(api.nwsProduct('Wind Advisory'), 'advisory');
  assert.equal(api.nwsAlertLevel({ event: 'Flash Flood Warning', severity: 'Severe' }), 'Orange');
  assert.equal(api.nwsAlertLevel({ event: 'Tornado Warning', severity: 'Extreme' }), 'Red');
  assert.equal(api.nwsAlertLevel({ event: 'Freeze Watch', severity: 'Severe' }), 'Yellow');
  assert.equal(api.nwsAlertLevel({ event: 'Hurricane Watch', severity: 'Extreme' }), 'Orange');
});

test('B3: a volcano observatory\'s ADVISORY is an advisory, not a warning', () => {
  const kilauea = api.readerFields({ type: 'Volcano', alertLevel: 'ADVISORY', region: 'Hawaiian Volcano Observatory', country: 'United States' });
  assert.equal(kilauea.officialProduct, 'advisory');
  assert.equal(api.readerFields({ type: 'Volcano', alertLevel: 'WARNING' }).officialProduct, 'warning');
});

/* ------------------------------------------------------------------ B5 */

test('B5: no basin code or observatory name is published as a place', () => {
  const vance = { type: 'Tropical Cyclone', title: 'Tropical Storm Vance', region: 'Vance (eastern Pacific system 2)',
    country: '', affectedCountries: 'México', lat: 21.6, lon: -108.8 };
  vance.place = api.placeLabel(vance);
  const areas = api.areasOf(vance);
  assert.deepEqual(areas, ['Eastern Pacific Ocean (may affect Mexico)']);
  const kilauea = api.areasOf({ type: 'Volcano', region: 'Hawaiian Volcano Observatory', country: 'United States' });
  assert.deepEqual(kilauea, ['Hawaii', 'United States']);
  const sitkin = api.areasOf({ type: 'Volcano', region: 'Alaska Volcano Observatory', country: 'United States' });
  assert.ok(!sitkin.join(' ').includes('Observatory'));
});

test('B5: a storm at sea "may affect" the country GDACS names, it is not in it', () => {
  const infa = { type: 'Tropical Cyclone', title: 'Super Typhoon In-fa', country: 'Marshall Islands', region: '', lat: 16.6, lon: 151.3 };
  infa.place = api.placeLabel(infa);
  assert.deepEqual(api.areasOf(infa), ['Western Pacific Ocean (may affect Marshall Islands)']);
});

/* ------------------------------------------------------------------ B6 */

const quake = over => Object.assign({ type: 'Earthquake', magnitude: 6.5, lat: 27.7953, lon: 139.6184 }, over);

test('B6: GDACS\'s day-early copy of the Bonin Islands quake merges with USGS and NEIC\'s GDACS copy', () => {
  const usgs = quake({ id: 'usgs-us6000u4r9', source: 'USGS', startedAt: '2026-10-25T02:09:23.818Z', updated: '2026-10-29T02:12:55Z', sourceUrl: 'u', depthKm: 492.4 });
  const neic = quake({ id: 'gdacs-EQ-1573709', source: 'GDACS', gdacsOrigin: 'NEIC', startedAt: '2026-10-25T02:09:23Z', updated: '2026-10-25T02:09:23Z' });
  const ptwc = quake({ id: 'gdacs-EQ-1573848', source: 'GDACS', gdacsOrigin: 'PTWC', magnitude: 7, lat: 28, lon: 139.9,
    startedAt: '2026-10-24T02:09:00Z', updated: '2026-10-24T02:09:00Z' });
  const out = api.mergeSeismicReports([usgs, neic, ptwc]);
  assert.equal(out.length, 1, JSON.stringify(out.map(e => e.id)));
  assert.equal(out[0].id, 'usgs-us6000u4r9');
  assert.equal(out[0].startedAt, '2026-10-25T02:09:23.818Z');
  assert.deepEqual(out[0].mergedFrom.map(m => m.id).sort(), ['gdacs-EQ-1573709', 'gdacs-EQ-1573848', 'usgs-us6000u4r9']);
  // Two GDACS records from the same detecting agency are that agency's two quakes.
  const twin = api.mergeSeismicReports([neic, quake({ id: 'gdacs-EQ-2', source: 'GDACS', gdacsOrigin: 'NEIC', startedAt: '2026-10-25T02:09:40Z' })]);
  assert.equal(twin.length, 2);
});

test('B6: EMSC and GDACS reports of one quake a few minutes apart merge (Reykjanes Ridge)', () => {
  const emsc = quake({ id: 'emsc-20261028_0000315', source: 'EMSC', magnitude: 4.7, lat: 58.26, lon: -32.01, startedAt: '2026-10-28T18:41:59.7Z' });
  const gdacs = quake({ id: 'gdacs-EQ-1574398', source: 'GDACS', magnitude: 4.7, lat: 58.5, lon: -31.6, startedAt: '2026-10-28T18:44:30Z' });
  assert.equal(api.mergeSeismicReports([emsc, gdacs]).length, 1);
  const gdacs2 = quake({ id: 'gdacs-EQ-1574333', source: 'GDACS', magnitude: 5.0, lat: 0, lon: 0, startedAt: '2026-10-28T11:56:00Z' });
  const emsc2 = quake({ id: 'emsc-x', source: 'EMSC', magnitude: 4.5, lat: 0.5, lon: 0.2, startedAt: '2026-10-28T11:52:31Z' });
  assert.equal(api.mergeSeismicReports([emsc2, gdacs2]).length, 1);
  // GDACS may trail, never lead, and two catalogues still need the origin time.
  assert.equal(api.seismicSameOrigin(gdacs, emsc), true);
  assert.equal(api.seismicSameOrigin(quake({ source: 'GDACS', startedAt: '2026-10-28T18:38:00Z' }), emsc), false);
  assert.equal(api.seismicSameOrigin(quake({ source: 'USGS', startedAt: '2026-10-28T18:44:30Z' }), emsc), false);
  // A magnitude 0.7 apart and 100 km are the published edges.
  assert.equal(api.mergeSeismicReports([emsc, quake({ id: 'g3', source: 'GDACS', magnitude: 5.6, lat: 58.26, lon: -32.01, startedAt: '2026-10-28T18:42:10Z' })]).length, 2);
});

test('B6: GDACS earthquake depth is read from its description, and the sentence is readable', () => {
  assert.equal(api.gdacsDepthKm('Magnitude 7M, Depth:473km'), 473);
  assert.equal(api.gdacsDepthKm('Magnitude 6.5M, Depth:492.376km'), 492.376);
  assert.equal(api.gdacsDepthKm('Magnitude 5M'), null);
  const m = api.gdacsMeasurement({ severity: 7, severityunit: 'M', severitytext: 'Magnitude 7M, Depth:473km' }, 'EQ');
  assert.equal(m.depthKm, 473);
  assert.equal(m.magnitude, 7);
  assert.equal(m.severityText, 'Magnitude 7, depth 473 km');
});

test('B6: gdacsTime reads every zone-less GDACS form as UTC, whatever the server zone', () => {
  assert.equal(api.gdacsTime('2026-10-25T02:09:23'), '2026-10-25T02:09:23.000Z');
  assert.equal(api.gdacsTime('2026-10-25 02:09:23'), '2026-10-25T02:09:23.000Z');
  assert.equal(api.gdacsTime('2026-10-25'), '2026-10-25T00:00:00.000Z');
  assert.equal(api.gdacsTime('Sun, 25 Oct 2026 02:09:23 GMT'), '2026-10-25T02:09:23.000Z');
  assert.equal(api.gdacsTime('25 Oct 2026 02:09:23'), '2026-10-25T02:09:23.000Z');
  assert.equal(api.gdacsTime('2026-10-25T02:09:23+09:00'), '2026-10-24T17:09:23.000Z');
});

/* ----------------------------------------------------------------- B12 */

test('B12: casing keeps "U.S.", and placeholder figures and empty list slots are gone', () => {
  assert.equal(api.unshout('CHRISTIANSTED, U.S. VIRGIN ISLANDS'), 'Christiansted, U.S. Virgin Islands');
  assert.equal(api.plainTitle({ type: 'Earthquake', title: 'M 4.5 - 10 km SSW of Christiansted, U.S. Virgin Islands' }),
    'M 4.5 - 10 km SSW of Christiansted, U.S. Virgin Islands');
  assert.equal(api.gdacsMeasurement({ severity: 0, severityunit: '', severitytext: 'Magnitude 0 ' }, 'FL').severityText, undefined);
  const dr = api.readerFields({ type: 'Drought', country: 'Aruba, , Brazil, Colombia, , French Guiana',
    details: 'Drought in Aruba, , Brazil, Colombia, , French Guiana · Agricultural drought over 1.55 million km²' });
  assert.doesNotMatch(dr.details, /, ,/);
  assert.deepEqual(dr.areas, ['Aruba', 'Brazil', 'Colombia', 'French Guiana']);
  const emsc = api.readerFields({ type: 'Earthquake', region: 'REYKJANES RIDGE', country: '', title: 'M 4.7 - Reykjanes Ridge' });
  assert.deepEqual(emsc.areas, ['Reykjanes Ridge']);
});

test('B12: wildfire and drought areas are stated as areas', () => {
  assert.equal(api.gdacsMeasurement({ severity: 8546, severityunit: 'ha', severitytext: 'Green impact for forestfire in 8546 ha' }, 'WF').severityText,
    'Burned area 85 km²');
  assert.equal(api.gdacsMeasurement({ severity: 1, severityunit: '', severitytext: 'Minor impact for agricultural drought in 1552123 km2' }, 'DR').severityText,
    'Agricultural drought over 1.55 million km²');
});

/* ----------------------------------------------------------------- B24 */

test('B24: Mexico has one spelling', () => {
  assert.equal(api.countryName('México'), 'Mexico');
  assert.deepEqual(api.countriesOf({ country: 'México' }).countries, ['Mexico']);
});

/* ----------------------------------------------------------------- B25 */

test('B25: an NWS record links to the warning, not to a point forecast', () => {
  const url = api.nwsAlertUrl({ event: 'Flash Flood Warning', geocode: { UGC: ['HIC009'] } }, { lat: 20.7753, lon: -156.1716 });
  assert.match(url, /^https:\/\/forecast\.weather\.gov\/showsigwx\.php\?/);
  assert.match(url, /product1=Flash\+Flood\+Warning/);
  assert.match(url, /warncounty=HIC009/);
  assert.doesNotMatch(url, /MapClick/);
  assert.equal(api.nwsAlertUrl({ event: 'Flood Watch' }, null), 'https://www.weather.gov/');
});

/* ----------------------------------------------------------------- B26 */

test('B26: a GDACS flood, drought or wildfire stamped at midnight is a date, not a time', () => {
  assert.deepEqual(api.gdacsDatePrecision({ rawType: 'FL', updated: '2026-10-28T00:00:00.000Z', startedAt: '2026-10-27T00:00:00.000Z' }), { datePrecision: 'day' });
  assert.deepEqual(api.gdacsDatePrecision({ rawType: 'FL', updated: '2026-10-28T01:00:00.000Z' }), {});
  assert.deepEqual(api.gdacsDatePrecision({ rawType: 'EQ', updated: '2026-10-28T00:00:00.000Z' }), {});
});
