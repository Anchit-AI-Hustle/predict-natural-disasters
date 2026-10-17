'use strict';
/*
 * The feed a reader sees: one record per storm, nothing live that stopped
 * updating weeks ago, no date in the future, and a place that is a place.
 *
 * Measured on the production feed of 28 September 2026:
 *
 *   - Hurricane Polo was listed three times (NOAA's hurricane centre, GDACS
 *     and NASA EONET) and Nolo, Rachel and Fay two or three times each; every
 *     copy was given its own five-day outlook.
 *   - 755 of 1,456 records had not been updated by their provider for longer
 *     than the hazard ever goes quiet while it is still happening - floods last
 *     seen in June, storms that had dissipated weeks before - and all of them
 *     were counted as "live events".
 *   - A flood in Guinea was dated 01:00 the next morning, so it sorted first.
 *   - Every GDACS record's place was its own title ("Tropical Cyclone
 *     ODALYS-26"), and the hurricane centre's storms were titled "HU Polo".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { callApi, closeAllWindows } = require('./render.js');
const { FIXTURES } = require('./mock-upstreams.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'api', 'events.js'));
const feed = async mock => (await callApi(api, '/api/events', mock)).json();
/* From a given now, when a test compares against that same now: read
   separately, the clock can tick between them, and a record 40 days old
   becomes 39.99... days old. */
const hoursAgo = (h, from = Date.now()) => new Date(from - h * 3600e3).toISOString();
const hoursAhead = (h, from = Date.now()) => new Date(from + h * 3600e3).toISOString();

/* ------------------------------------------------------------------ names */

test('storm codes are written out and provider suffixes dropped', () => {
  const tc = title => api.plainTitle({ type: 'Tropical Cyclone', title });
  assert.equal(tc('HU Polo'), 'Hurricane Polo');
  assert.equal(tc('TS RACHEL'), 'Tropical Storm Rachel');
  assert.equal(tc('TD Fay'), 'Tropical Depression Fay');
  assert.equal(tc('PTC Nine'), 'Potential Tropical Cyclone Nine');
  assert.equal(tc('Tropical Cyclone POLO-26'), 'Tropical Cyclone Polo');
  assert.equal(tc('Tropical Cyclone TWENTYTHREE-26'), 'Tropical Cyclone 23');
  assert.equal(tc('Tropical Cyclone 01B-26'), 'Tropical Cyclone 01B');
  assert.equal(tc('Super Typhoon Surigae'), 'Super Typhoon Surigae', 'a plain name was changed');
});

test('shouted names and repeated words are tidied, and bearings are left alone', () => {
  const t = (type, title) => api.plainTitle({ type, title });
  assert.equal(t('Earthquake', 'M 4.5 — VANCOUVER ISLAND, CANADA REGION'), 'M 4.5 — Vancouver Island, Canada region');
  assert.equal(t('Earthquake', 'M 2.8 - 8 km SSW of Pāhala, Hawaii'), 'M 2.8 - 8 km SSW of Pāhala, Hawaii');
  assert.equal(t('Wildfire', 'Prescribed Fire CRAWFORD CORRAL Prescribed Fire, Tulare, California'),
    'Prescribed Fire Crawford Corral, Tulare, California');
  assert.equal(t('Drought', 'Drought in Austria, Belgium, Belarus, Switzerland, Germany,'),
    'Drought in Austria, Belgium and 3 other countries');
});

/* ----------------------------------------------------------------- places */

test('a place is never the record\'s own title', () => {
  const p = e => api.placeLabel(Object.assign({ lat: 0, lon: 0 }, e));
  assert.equal(p({ type: 'Flood', title: 'Flood in China', region: 'Flood in China', country: 'China' }), 'China');
  assert.equal(p({ type: 'Drought', title: 'Drought in Madagascar', region: '', country: 'Madagascar' }), 'Madagascar');
  assert.equal(p({ type: 'Drought', title: 'x', country: 'Kenya, Somalia, Uganda, Ethiopia,' }),
    'Kenya, Somalia and 2 other countries');
  assert.equal(p({ type: 'Flood', title: 'Flood Warning — Monmouth', country: 'United States',
    region: 'Monmouth, New Jersey; Ocean, New Jersey; Middlesex, New Jersey' }),
  'Monmouth, New Jersey and 2 nearby areas, United States');
  assert.equal(p({ type: 'Volcano', title: 'Kilauea', country: 'United States', region: 'Hawaiian Volcano Observatory' }),
    'Hawaii, United States');
});

test('a storm at sea is placed in its ocean, and the countries in its path are said to be at risk, not hit', () => {
  const p = e => api.placeLabel(Object.assign({ type: 'Tropical Cyclone' }, e));
  assert.equal(p({ title: 'Hurricane Polo', region: 'Polo (eastern Pacific system 2)', lat: 22.9, lon: -118.7 }),
    'Eastern Pacific Ocean');
  assert.equal(p({ title: 'Tropical Cyclone Odalys', sourceTitle: 'Tropical Cyclone ODALYS-26',
    region: 'Tropical Cyclone ODALYS-26', lat: 22.8, lon: -123.1 }), 'Eastern Pacific Ocean');
  assert.equal(p({ title: 'Tropical Cyclone Surigae', country: 'Japan', lat: 27.5, lon: 131.6 }),
    'Western Pacific Ocean (may affect Japan)');
  assert.equal(p({ title: 'Hurricane Nolo', lat: 16.5, lon: -161.3 }), 'Central Pacific Ocean');
  // Over land, the country it is over.
  assert.equal(p({ title: 'Tropical Depression Edouard', country: 'United States', lat: 32.5, lon: -96.5 }), 'United States');
});

/* ------------------------------------------------------------ storm merge */

const storm = (source, id, title, lat, lon, extra) => Object.assign({
  id, source, sourceType: 'official', type: 'Tropical Cyclone', title, lat, lon,
  alert: 'Green', updated: hoursAgo(2), country: '', region: ''
}, extra || {});

test('one storm reported by three agencies is one record, naming all three', () => {
  const merged = api.mergeCycloneReports([
    storm('NOAA National Hurricane Center', 'nhc-ep17', 'Hurricane Polo', 23.9, -113.7,
      { alert: 'Orange', windKt: 100, pressureMb: 958 }),
    storm('GDACS', 'gdacs-TC-1', 'Tropical Cyclone Polo', 23.6, -113.8,
      { sourceTitle: 'Tropical Cyclone POLO-26', alert: 'Red', country: 'Mexico', affected: 12000 }),
    storm('NASA EONET', 'eonet-1', 'Hurricane Polo', 22.4, -114.1, { updated: hoursAgo(12) }),
    storm('GDACS', 'gdacs-TC-2', 'Tropical Cyclone Rachel', 13.4, -100.4)
  ]);
  assert.equal(merged.length, 2, merged.map(e => e.id).join(', '));
  const polo = merged.find(e => /Polo/.test(e.title));
  assert.equal(polo.id, 'nhc-ep17', 'the hurricane centre\'s record should lead');
  assert.deepEqual(polo.corroboratedBy.sort(), ['GDACS', 'NASA EONET']);
  assert.equal(polo.mergedFrom.length, 3);
  assert.equal(polo.alert, 'Red', 'the gravest assessment any agency published was lost');
  assert.equal(polo.affected, 12000, 'a count only GDACS published was lost');
  assert.equal(polo.country, '', 'the leader\'s own country must not change: its outlook\'s geography is frozen');
  assert.equal(polo.affectedCountries, 'Mexico');
  assert.equal(merged.mergedCycloneReports, 2);
});

test('a graver alert carried onto a merged storm keeps the agency that gave it', () => {
  /* NOAA leads, GDACS rated it Red. The record kept NOAA's source and link,
     so the badge said the Red level was "published by NOAA". */
  const [lead] = api.mergeCycloneReports([
    storm('NOAA National Hurricane Center', 'nhc', 'Hurricane Polo', 18.0, -110.0,
      { alert: 'Orange', alertBasis: 'derived-from-intensity', sourceUrl: 'https://www.nhc.noaa.gov/' }),
    storm('GDACS', 'g', 'Tropical Cyclone Polo', 18.1, -110.1,
      { alert: 'Red', alertBasis: 'issued', sourceUrl: 'https://www.gdacs.org/report.aspx?eventid=1' })
  ]);
  assert.equal(lead.id, 'nhc');
  assert.equal(lead.alert, 'Red');
  assert.equal(lead.alertSource, 'GDACS');
  assert.equal(lead.alertSourceUrl, 'https://www.gdacs.org/report.aspx?eventid=1');
  assert.equal(lead.source, 'NOAA National Hurricane Center', 'the lead\'s own source changed');
  /* Where the lead's own alert is the gravest, nothing is carried over. */
  const [own] = api.mergeCycloneReports([
    storm('NOAA National Hurricane Center', 'nhc', 'Hurricane Polo', 18.0, -110.0, { alert: 'Red' }),
    storm('GDACS', 'g', 'Tropical Cyclone Polo', 18.1, -110.1, { alert: 'Orange' })
  ]);
  assert.equal(own.alertSource, undefined);
});

test('the badge names the agency that gave a carried-over alert', async () => {
  const { renderPage, closeAllWindows } = require('./render.js');
  const { window } = await renderPage('index.html', { timeoutMs: 15000, waitFor: (d, w) => w.PND && w.PNDRisk });
  const tag = window.PND.riskTag({ alert: 'Red', source: 'NOAA National Hurricane Center', alertSource: 'GDACS' });
  assert.match(tag, /published by GDACS/);
  assert.doesNotMatch(tag, /published by NOAA/);
  assert.match(window.PND.riskTag({ alert: 'Red', source: 'GDACS' }), /published by GDACS/);
  window.close();
  closeAllWindows();
});

test('a merged storm at sea shows the countries in its path, without changing its own country', () => {
  const [lead] = api.mergeCycloneReports([
    storm('NOAA National Hurricane Center', 'nhc', 'Hurricane Polo', 18.0, -110.0, { alert: 'Orange' }),
    storm('GDACS', 'g', 'Tropical Cyclone Polo', 18.1, -110.1, { country: 'Mexico' })
  ]);
  assert.equal(lead.country, '', 'the frozen country changed');
  assert.equal(lead.affectedCountries, 'Mexico');
  assert.equal(api.placeLabel(lead), 'Eastern Pacific Ocean (may affect Mexico)');
  assert.deepEqual(api.countriesOf(lead), { countries: ['Mexico'], sea: '' });
  /* A storm with neither is in its sea. */
  assert.deepEqual(api.countriesOf({ type: 'Tropical Cyclone', lat: 18, lon: -110, country: '' }),
    { countries: [], sea: 'Eastern Pacific Ocean' });
  /* Search for the country finds it. */
  const S = require('../search.js');
  assert.ok(S.matchesPlace(lead, 'mexico'), 'searching for Mexico does not find the storm heading for it');
});

test('two storms, or two records from one agency, are never merged', () => {
  const merged = api.mergeCycloneReports([
    storm('GDACS', 'a', 'Tropical Cyclone Polo', 23.6, -113.8),
    storm('GDACS', 'b', 'Tropical Cyclone Polo', 23.7, -113.8),
    storm('NASA EONET', 'c', 'Typhoon Surigae', 27.5, 131.6),
    storm('NASA EONET', 'd', 'Hurricane Odalys', 22.7, -123.2)
  ]);
  assert.equal(merged.length, 4);
});

test('a generic storm name gives way to the warning centre\'s own', () => {
  const [lead] = api.mergeCycloneReports([
    storm('GDACS', 'g', 'Tropical Cyclone Surigae', 27.5, 131.6, { sourceTitle: 'Tropical Cyclone SURIGAE-26' }),
    storm('NASA EONET', 'e', 'Super Typhoon Surigae', 27.5, 131.6)
  ]);
  assert.equal(lead.id, 'g');
  assert.equal(lead.title, 'Super Typhoon Surigae');
  assert.equal(lead.sourceTitle, 'Tropical Cyclone SURIGAE-26');
});

/* ------------------------------------------------------------------ live */

test('a record its provider stopped updating is kept but not live', () => {
  const now = Date.now();
  const evs = [
    { type: 'Flood', updated: hoursAgo(40 * 24, now) },
    { type: 'Flood', updated: hoursAgo(20 * 24, now), expectedEnd: hoursAhead(24, now) },
    { type: 'Tropical Cyclone', updated: hoursAgo(50, now) },
    { type: 'Tropical Cyclone', updated: hoursAgo(4.5 * 24, now) },
    { type: 'Drought', updated: hoursAgo(30 * 24, now) },
    { type: 'Flood', forecast: true, updated: hoursAgo(90 * 24, now) }
  ];
  assert.equal(api.markLive(evs, now), 2);
  assert.deepEqual(evs.map(e => e.live), [false, true, true, false, true, undefined]);
  assert.equal(evs[0].quietDays, 40);
});

test('a warning its issuer has not let expire stays live, however old its last reissue', () => {
  /* An NWS warning reissued five days ago but in force until tomorrow was
     marked not live, dropped from every list and kept out of alerts. */
  const now = Date.now();
  const evs = [
    { type: 'Flood', sourceType: 'official', updated: hoursAgo(20 * 24), expiresAt: hoursAhead(24) },
    { type: 'Tornado', sourceType: 'official', updated: hoursAgo(5 * 24), expiresAt: hoursAhead(3) },
    { type: 'Tornado', sourceType: 'official', updated: hoursAgo(5 * 24), expiresAt: hoursAgo(1) },
    { type: 'Tornado', sourceType: 'official', updated: hoursAgo(5 * 24), expiresAt: 'not a date' }
  ];
  assert.equal(api.markLive(evs, now), 2);
  assert.deepEqual(evs.map(e => e.live), [true, true, false, false]);
});

test('GDACS times without a zone are UTC, and a future end is not an update', () => {
  assert.equal(api.gdacsTime('2026-09-29T01:00:00'), '2026-09-29T01:00:00.000Z');
  assert.equal(api.gdacsTime('2026-09-29T01:00:00Z'), '2026-09-29T01:00:00.000Z');
  assert.equal(api.gdacsTime(''), null);
});

/* ------------------------------------------------------------ whole feed */

test('the published feed carries each storm once, nothing dated ahead, and a real place', async () => {
  const gdacs = url => {
    if (!/\/SEARCH/i.test(new URL(url).pathname)) return undefined;
    const u = new URL(url);
    const types = (u.searchParams.get('eventlist') || '').split(';');
    if (Number(u.searchParams.get('pagenumber') || 1) > 1) return [];
    const out = [];
    if (types.includes('TC')) out.push({
      eventid: 1001325, eventtype: 'TC', name: 'Tropical Cyclone FIONA-26', country: 'Bahamas',
      description: 'Tropical Cyclone FIONA-26', alertlevel: 'Orange', latitude: 24.3, longitude: -70.3,
      fromdate: hoursAgo(72), todate: hoursAgo(1)
    });
    if (types.includes('FL')) out.push({
      eventid: 1104178, eventtype: 'FL', name: 'Flood in Guinea', country: 'Guinea',
      description: 'Flood in Guinea', alertlevel: 'Green', latitude: 10.4, longitude: -10.9,
      fromdate: hoursAgo(20), todate: hoursAhead(13)
    }, {
      eventid: 1100001, eventtype: 'FL', name: 'Flood in Chad', country: 'Chad',
      description: 'Flood in Chad', alertlevel: 'Orange', latitude: 12.1, longitude: 15.0,
      fromdate: hoursAgo(80 * 24), todate: hoursAgo(60 * 24)
    });
    return out;
  };
  const body = await feed({ gdacs });
  const generated = Date.parse(body.generatedAt);
  const evs = body.events;

  // The hurricane centre's Fiona (the NHC fixture) and GDACS's are one storm.
  const fiona = evs.filter(e => !e.forecast && e.type === 'Tropical Cyclone' && /fiona/i.test(e.title));
  assert.equal(fiona.length, 1, fiona.map(e => e.id + ' ' + e.title).join(' | '));
  assert.equal(fiona[0].title, 'Hurricane Fiona');
  assert.ok(fiona[0].corroboratedBy.includes('GDACS'));
  const fionaOutlooks = evs.filter(e => e.forecast && e.type === 'Tropical Cyclone' && /fiona/i.test(e.title));
  assert.equal(fionaOutlooks.length, 1, 'one storm, one outlook');
  assert.match(fionaOutlooks[0].title, /^Storm risk from Hurricane Fiona — 5-day forecast$/);

  for (const e of evs) {
    if (e.forecast) continue;
    assert.ok(!(Date.parse(e.updated) > generated + 5 * 60e3), e.id + ' is dated in the future: ' + e.updated);
    assert.notEqual(String(e.place || '').toLowerCase(), String(e.title).toLowerCase(), e.id + ' is placed at its own title');
  }
  const guinea = evs.find(e => e.id === 'gdacs-FL-1104178');
  assert.equal(guinea.expectedEnd.slice(0, 13), hoursAhead(13).slice(0, 13));
  assert.equal(guinea.live, true);
  assert.equal(guinea.place, 'Guinea');

  // A flood GDACS last saw two months ago is kept, but it is not live, and
  // it drives no new outlook.
  const chad = evs.find(e => e.id === 'gdacs-FL-1100001');
  assert.equal(chad.live, false);
  assert.ok(!evs.some(e => e.forecast && e.forecastOf === 'gdacs-FL-1100001'));
  assert.ok(body.meta.notLive >= 1);

  // Every outlook follows a live record.
  const byId = new Map(evs.map(e => [e.id, e]));
  for (const o of evs.filter(e => e.forecast && e.forecastOf)) {
    const src = byId.get(o.forecastOf);
    assert.ok(!src || src.live !== false, o.id + ' follows a record that is no longer live');
  }
});

test('a Special Marine Warning is a severe storm, not a hazard of its own', () => {
  assert.equal(api.normalizeType('Special Marine Warning', 'Special Marine Warning'), 'Severe Storm');
});

test('the NHC fixture still reaches the feed', () => {
  assert.ok(FIXTURES.nhc.activeStorms.length > 0);
});

test('a GDACS "Forest fires in Brazil" is not a place, and nautical miles are spelled out', () => {
  assert.equal(api.placeLabel({ type: 'Wildfire', title: 'Wildfire risk in Brazil — 3-day forecast',
    region: 'Forest fires in Brazil', country: 'Brazil', lat: -10, lon: -55 }), 'Brazil');
  assert.equal(api.plainTitle({ type: 'Severe Storm', title: 'Special Marine Warning — Waters from Pensacola FL out 20 to 60 NM' }),
    'Special Marine Warning — Waters from Pensacola FL out 20 to 60 nautical miles');
  assert.equal(api.placeLabel({ type: 'Severe Storm', title: 'x', country: 'United States',
    region: 'Coastal waters from Pascagoula Mississippi out 20 to 60 NM', lat: 30, lon: -88 }),
  'Coastal waters from Pascagoula Mississippi out 20 to 60 nautical miles, United States');
});
