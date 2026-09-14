'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { makeFetch, mockRes } = require('./mock-upstreams.js');
const eventsHandler = require(path.join(__dirname, '..', 'api', 'events.js'));
const enrichHandler = require(path.join(__dirname, '..', 'api', 'event-enrichment.js'));
const support = require(path.join(__dirname, '..', 'api', 'verified-support.js'));

const realFetch = global.fetch;
function withFetch(mock, fn) {
  global.fetch = mock;
  return Promise.resolve(fn()).finally(() => { global.fetch = realFetch; });
}

async function runEvents(opts) {
  const res = mockRes();
  await withFetch(makeFetch(opts || {}), () => eventsHandler({ query: {}, url: '/api/events' }, res));
  return res;
}

async function runEnrichment(query, opts) {
  const res = mockRes();
  await withFetch(makeFetch(opts || {}), () => enrichHandler({ query, url: '/api/event-enrichment' }, res));
  return res;
}

/* ----------------------------------------------------- module system guard */

test('every api module loads as CommonJS and exports a handler', () => {
  assert.equal(typeof eventsHandler, 'function', 'events handler must be a function');
  assert.equal(typeof enrichHandler, 'function', 'enrichment handler must be a function');
  assert.equal(typeof support.supportFor, 'function');
  // The default export alias keeps both Vercel invocation styles working.
  assert.equal(typeof eventsHandler.default, 'function');
  assert.equal(typeof enrichHandler.default, 'function');
});

/* ------------------------------------------------------------ /api/events */

test('events feed returns records from every online source', async () => {
  const res = await runEvents();
  assert.equal(res.statusCode, 200);
  const d = res.body;
  const sources = d.meta.sources;
  for (const key of ['gdacs', 'usgs', 'eonet', 'nhc', 'nws', 'reliefweb', 'usgs_volcano', 'emsc']) {
    assert.ok(sources[key], 'missing source status: ' + key);
    assert.equal(sources[key].ok, true, key + ' should be online');
  }
  assert.equal(d.meta.sourceCount, 8);
  assert.ok(d.meta.live);
  assert.ok(d.events.length >= 15, 'expected a populated feed, got ' + d.events.length);
});

test('every event carries the fields the detail pages read', async () => {
  const res = await runEvents();
  for (const e of res.body.events) {
    assert.ok(e.id, 'event without id');
    assert.ok(e.title, 'event without title: ' + e.id);
    assert.ok(e.type, 'event without type: ' + e.id);
    assert.ok(e.source, 'event without source: ' + e.id);
    assert.ok(e.updated, 'event without updated: ' + e.id);
    assert.equal(typeof e.lat, 'number');
    assert.equal(typeof e.lon, 'number');
    assert.ok(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180, 'bad coords on ' + e.id);
    assert.ok(['official', 'forecast'].includes(e.sourceType), 'bad sourceType on ' + e.id);
  }
});

test('event ids are unique so every detail page resolves to one record', async () => {
  const res = await runEvents();
  const ids = res.body.events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate event ids: ' +
    ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
});

test('many experimental outlooks are produced, not just one', async () => {
  const res = await runEvents();
  const forecasts = res.body.events.filter(e => e.forecast);
  assert.ok(forecasts.length >= 5,
    'expected several forecasts, got ' + forecasts.length + ': ' + forecasts.map(f => f.id).join(', '));
  assert.ok(forecasts.some(f => f.id === 'ND-001'), 'frozen benchmark must be retained');
  assert.ok(forecasts.some(f => f.forecastKind === 'signal-derived-outlook'));
  assert.ok(forecasts.some(f => f.forecastKind === 'aftershock-sequence'),
    'M5.5+ quakes should produce an aftershock-sequence outlook');
  assert.equal(res.body.meta.outlooks, forecasts.length - 1);
});

test('outlook ids are deterministic across refreshes', async () => {
  const a = await runEvents();
  const b = await runEvents();
  const ids = r => r.body.events.filter(e => e.forecast).map(e => e.id).sort();
  assert.deepEqual(ids(a), ids(b),
    'outlook ids changed between refreshes — detail links would 404');
});

test('every outlook explains its evidence, confidence and grading rule', async () => {
  const res = await runEvents();
  for (const f of res.body.events.filter(e => e.forecast)) {
    assert.ok(f.evidence, 'outlook without evidence: ' + f.id);
    assert.ok(f.confidence, 'outlook without confidence: ' + f.id);
    assert.ok(f.verificationRule, 'outlook without verification rule: ' + f.id);
    assert.ok(f.targetStart && f.targetEnd, 'outlook without a window: ' + f.id);
  }
});

test('outlooks still appear when GDACS is down', async () => {
  const res = await runEvents({ down: ['gdacs'] });
  assert.equal(res.body.meta.sources.gdacs.ok, false);
  const forecasts = res.body.events.filter(e => e.forecast && e.id !== 'ND-001');
  assert.ok(forecasts.length >= 3,
    'a GDACS outage must not collapse the outlook set, got ' + forecasts.length);
});

test('feed degrades safely when every upstream is down', async () => {
  const res = await runEvents({ down: 'all' });
  assert.equal(res.statusCode, 200, 'must still answer 200');
  assert.equal(res.body.meta.live, false);
  assert.equal(res.body.meta.sourceCount, 0);
  // Verified snapshots plus the frozen benchmark keep the UI meaningful.
  assert.ok(res.body.events.length >= 3, 'fallback records missing');
  assert.ok(res.body.events.some(e => e.id === 'ND-001'));
  assert.ok(res.body.meta.forecastNote.length > 10);
});

test('zone-only NWS alerts without geometry are skipped, mapped ones are kept', async () => {
  const res = await runEvents();
  const nws = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('National Weather Service'));
  assert.equal(nws.length, 1);
  assert.match(nws[0].title, /Flash Flood Warning/);
  assert.equal(nws[0].type, 'Flood');
  assert.ok(nws[0].expiresAt, 'NWS alerts should carry an expiry');
});

test('hazard types from every provider are normalised to one vocabulary', async () => {
  const res = await runEvents();
  const types = new Set(res.body.events.map(e => e.type));
  for (const t of ['Flood', 'Tropical Cyclone', 'Wildfire', 'Earthquake', 'Volcano', 'Drought']) {
    assert.ok(types.has(t), 'missing normalised type: ' + t + ' (have ' + [...types].join(', ') + ')');
  }
});

/* -------------------------------------------------- /api/event-enrichment */

const NEPAL = {
  title: 'Flood in Bagmati Province, Nepal', country: 'Nepal',
  region: 'Bagmati Province', type: 'Flood', updated: '2026-09-14T03:00:00Z',
  lat: '27.7', lon: '85.3'
};

test('enrichment rejects a request with no event context', async () => {
  const res = await runEnrichment({});
  assert.equal(res.statusCode, 400);
});

test('enrichment returns every block a detail page renders', async () => {
  const res = await runEnrichment(NEPAL);
  assert.equal(res.statusCode, 200);
  const d = res.body;
  for (const key of ['when', 'where', 'distressGroups', 'immediateNeeds', 'secondaryRisks',
    'safetyActions', 'news', 'situationReports', 'videos', 'helplines', 'authorities',
    'supportGroups', 'reliefGroups', 'directories', 'searches', 'sources', 'coverage', 'disclaimer']) {
    assert.ok(d[key] !== undefined, 'missing enrichment block: ' + key);
  }
  assert.equal(d.refreshSeconds, 300);
  assert.match(res.headers['cache-control'], /s-maxage=300/);
});

test('enrichment answers when and where the event happened', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.equal(d.when.reportedAt, '2026-09-14T03:00:00Z');
  assert.ok(d.where.resolvedPlace, 'coordinates should resolve to a named place');
  assert.equal(d.where.resolvedPlace.country, 'Nepal');
  assert.equal(d.where.resolvedPlace.state, 'Bagmati Province');
  assert.equal(d.where.resolvedPlace.city, 'Kathmandu');
  assert.match(d.where.originArea, /Kathmandu/);
  assert.ok(d.where.affectedRegions.length >= 2);
  assert.ok(d.where.mapLinks.openStreetMap.includes('27.7'));
});

test('enrichment merges news across providers, dedupes and flags outlets', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.ok(d.news.length >= 3, 'expected merged coverage, got ' + d.news.length);
  const reuters = d.news.filter(x => x.link.includes('reuters.com'));
  assert.equal(reuters.length, 1, 'duplicate headline across providers was not deduped');
  assert.equal(reuters[0].established, true);
  assert.equal(reuters[0].outlet, 'Reuters');
  assert.ok(d.news.every(x => x.title && x.link), 'every item needs a title and a link');
  assert.ok(d.news.some(x => x.established === false), 'non-established outlets are still shown');
});

test('enrichment returns official situation reports and videos', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.ok(d.situationReports.length >= 2);
  assert.equal(d.situationReports[0].outlet, 'OCHA');
  assert.ok(d.videos.length >= 2);
  assert.ok(d.videos.every(v => v.url.startsWith('https://www.youtube.com/watch?v=') && v.thumbnail));
});

test('enrichment returns verified helplines, authorities and donation links', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.equal(d.helplines.matched, true);
  assert.equal(d.helplines.country, 'Nepal');
  assert.ok(d.helplines.emergency.length >= 3);
  assert.ok(d.helplines.emergency.every(x => /^[0-9+][0-9 ()+-]*$/.test(x.phone)), 'phone numbers must be dialable');
  assert.ok(d.authorities.length >= 2);
  assert.ok(d.authorities.every(a => a.url.startsWith('https://')));
  assert.ok(d.supportGroups.some(s => /Red Cross/i.test(s.name)));
  assert.ok(d.reliefGroups.length >= 8);
  assert.ok(d.reliefGroups.every(r => (r.donate || r.url).startsWith('https://')));
  const ifrc = d.reliefGroups.find(r => r.name.includes('IFRC'));
  assert.equal(ifrc.email, 'secretariat@ifrc.org');
  assert.ok(ifrc.phone);
});

test('enrichment never guesses a helpline for an unmapped country', async () => {
  const d = (await runEnrichment({ title: 'Flood somewhere', country: 'Nowhereland', type: 'Flood' })).body;
  assert.equal(d.helplines.matched, false);
  assert.deepEqual(d.helplines.emergency, []);
  assert.match(d.helplines.note, /never guessed|No verified national emergency number/i);
  // Global directories still give the reader a route to real help.
  assert.ok(d.directories.length >= 4);
  assert.ok(d.reliefGroups.length >= 8);
});

test('distress groups and needs are hazard-specific', async () => {
  const flood = (await runEnrichment(NEPAL)).body;
  const quake = (await runEnrichment({ title: 'M6.5 quake', country: 'Indonesia', type: 'Earthquake' })).body;
  assert.notDeepEqual(flood.distressGroups, quake.distressGroups);
  assert.ok(flood.distressGroups.some(g => /river|low-lying/i.test(g)));
  assert.ok(quake.distressGroups.some(g => /building/i.test(g)));
  assert.ok(quake.secondaryRisks.some(r => /aftershock/i.test(r)));
  assert.ok(quake.safetyActions.length >= 3);
});

test('donation prompts are withheld for forecast records', async () => {
  const d = (await runEnrichment(Object.assign({}, NEPAL, { forecast: 'true' }))).body;
  assert.deepEqual(d.reliefGroups, []);
  assert.match(d.donationPolicy, /withheld/i);
});

test('enrichment still answers when every external provider is down', async () => {
  const res = await runEnrichment(NEPAL, { down: 'all' });
  assert.equal(res.statusCode, 200);
  const d = res.body;
  assert.deepEqual(d.news, []);
  assert.deepEqual(d.videos, []);
  assert.equal(d.where.resolvedPlace, null);
  // Static verified data must survive an outage of every network provider.
  assert.ok(d.helplines.emergency.length >= 3);
  assert.ok(d.authorities.length >= 2);
  assert.ok(d.reliefGroups.length >= 8);
  assert.ok(d.distressGroups.length >= 3);
  assert.match(d.where.originArea, /Bagmati|Nepal/);
});

/* ------------------------------------------------------- support directory */

test('support directory resolves country names, ISO codes and aliases', () => {
  assert.equal(support.supportFor('Nepal').countryName, 'Nepal');
  assert.equal(support.supportFor('NPL').countryName, 'Nepal');
  assert.equal(support.supportFor('USA').countryName, 'United States');
  assert.equal(support.supportFor('United States of America').countryName, 'United States');
  assert.equal(support.supportFor('Viet Nam').countryName, 'Viet Nam');
  assert.equal(support.supportFor('Romania').emergency[0].phone, '112');
});

test('every stored contact and link is well formed', () => {
  let phones = 0, links = 0;
  for (const [key, rec] of Object.entries(support.COUNTRY_SUPPORT)) {
    assert.ok(rec.name, key + ' has no display name');
    for (const e of rec.emergency || []) {
      assert.ok(e.label, key + ' emergency entry without a label');
      assert.match(e.phone, /^[0-9+][0-9 ()+-]*$/, key + ' has a non-dialable number: ' + e.phone);
      phones++;
    }
    for (const a of (rec.authorities || []).concat(rec.relief || [])) {
      assert.ok(a.name, key + ' has an unnamed organisation');
      assert.match(a.url, /^https?:\/\//, key + ' bad url: ' + a.url);
      if (a.donate) assert.match(a.donate, /^https:\/\//, key + ' bad donate url: ' + a.donate);
      links++;
    }
  }
  assert.ok(phones >= 100, 'expected broad helpline coverage, got ' + phones);
  assert.ok(links >= 150, 'expected broad organisation coverage, got ' + links);
  for (const r of support.GLOBAL_RELIEF) {
    assert.match(r.url, /^https:\/\//);
    assert.match(r.donate, /^https:\/\//);
    if (r.email) assert.match(r.email, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  }
});
