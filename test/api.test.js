'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { makeFetch, mockRes } = require('./mock-upstreams.js');
const eventsHandler = require(path.join(__dirname, '..', 'api', 'events.js'));
const enrichHandler = require(path.join(__dirname, '..', 'api', 'event-enrichment.js'));
const support = require(path.join(__dirname, '..', 'api', 'verified-support.js'));

// ReliefWeb v2 requires a pre-approved appname; exercise the configured path
// here and the unconfigured path in its own test below.
process.env.RELIEFWEB_APPNAME = 'pnd-test-appname';

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

test('ReliefWeb is reported as unconfigured rather than failing silently', async () => {
  const saved = process.env.RELIEFWEB_APPNAME;
  delete process.env.RELIEFWEB_APPNAME;
  try {
    const res = await runEvents();
    const rw = res.body.meta.sources.reliefweb;
    assert.equal(rw.ok, false);
    assert.match(rw.error, /RELIEFWEB_APPNAME/);
    assert.match(rw.hint, /reliefweb\.int\/help\/api/);
    // The other seven providers carry on.
    assert.ok(res.body.meta.sourceCount >= 7);
  } finally { process.env.RELIEFWEB_APPNAME = saved; }
});

test('a rejected NWS parameter falls back instead of losing the provider', async () => {
  const res = await runEvents();
  const nws = res.body.meta.sources.nws;
  assert.equal(nws.ok, true);
  assert.ok(nws.query, 'the query that answered should be recorded');
  assert.equal(nws.placedViaZoneLookup, 1, 'the zone-based alert should be placed from its zone');
  assert.equal(nws.unplaceable, 1, 'the alert with neither polygon nor zone stays unplaced');
});

test('NWS keeps working when the API rejects a query parameter', async () => {
  // Production answered HTTP 400 to the message_type query; the ladder must
  // drop down to a query the API accepts rather than lose the provider.
  const res = await runEvents({ nwsRejects: ['message_type'] });
  const nws = res.body.meta.sources.nws;
  assert.equal(nws.ok, true, 'provider should survive a rejected parameter');
  assert.equal(nws.query, 'status=actual&severity=Extreme,Severe');
  assert.ok(res.body.events.some(e => e.source.includes('National Weather Service')));
});

test('NWS is reported offline only when every query is rejected', async () => {
  const res = await runEvents({ nwsRejects: ['alerts/active'] });
  assert.equal(res.body.meta.sources.nws.ok, false);
  assert.match(res.body.meta.sources.nws.error, /HTTP 400/);
});

test('upstream failures record the reason, not just the status code', async () => {
  const res = await runEvents({ down: ['gdacs'] });
  assert.match(res.body.meta.sources.gdacs.error, /HTTP 503/);
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

test('NWS alerts are placed by polygon or zone, and never invented', async () => {
  const res = await runEvents();
  const nws = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('National Weather Service'));
  // Polygon alert + zone-resolved alert are kept; the one with neither is not.
  assert.equal(nws.length, 2);
  const flood = nws.find(e => /Flash Flood Warning/.test(e.title));
  assert.ok(flood, 'polygon-backed alert missing');
  assert.equal(flood.type, 'Flood');
  assert.ok(flood.expiresAt, 'NWS alerts should carry an expiry');
  const heat = nws.find(e => /Excessive Heat/.test(e.title));
  assert.ok(heat, 'zone-based alert was dropped instead of resolved');
  assert.ok(Math.abs(heat.lat - 33.45) < 0.1 && Math.abs(heat.lon + 112.1) < 0.1,
    'zone-resolved alert should sit inside its zone');
  assert.ok(!nws.some(e => /High Wind/.test(e.title)), 'unplaceable alert must not be invented a position');
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

test('situation reports fall back to the public ReliefWeb feed without an appname', async () => {
  const saved = process.env.RELIEFWEB_APPNAME;
  delete process.env.RELIEFWEB_APPNAME;
  try {
    const d = (await runEnrichment(NEPAL)).body;
    assert.ok(d.situationReports.length >= 2, 'the public RSS feed should still supply reports');
    assert.ok(d.situationReports.every(x => x.link.includes('reliefweb.int')));
    assert.equal(d.situationReports[0].via, 'ReliefWeb (UN OCHA)');
  } finally { process.env.RELIEFWEB_APPNAME = saved; }
});

test('the API-backed path is used when an appname is configured', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.ok(d.situationReports.length >= 2);
  assert.ok(d.situationReports.some(x => /Situation Report/i.test(x.title)));
});

/* ---------------------------------------------- video extraction shapes */

test('videos are extracted from every YouTube result shape', async () => {
  const cases = [
    [undefined, 'AAAAAAAAAAA', 'Nepal floods: rescue operations continue'],
    ['SimpleText', 'CCCCCCCCCCC', 'Flood rescue live'],
    ['Accessibility', 'DDDDDDDDDDD', 'Drone footage of the flooded valley']
  ];
  for (const [variant, id, title] of cases) {
    const d = (await runEnrichment(NEPAL, { youtubeVariant: variant })).body;
    assert.ok(d.videos.length >= 1, 'no videos for variant ' + variant);
    const hit = d.videos.find(v => v.id === id);
    assert.ok(hit, 'missing ' + id + ' for variant ' + variant);
    assert.equal(hit.title, title);
    assert.equal(hit.url, 'https://www.youtube.com/watch?v=' + id);
  }
});

test('a consent interstitial still yields openable videos', async () => {
  const d = (await runEnrichment(NEPAL, { youtubeVariant: 'IdsOnly' })).body;
  assert.equal(d.videos.length, 2);
  assert.ok(d.videos.every(v => v.url.startsWith('https://www.youtube.com/watch?v=')));
});

test('an unparsable video page is reported rather than shown as empty', async () => {
  const d = (await runEnrichment(NEPAL, { youtubeVariant: 'Empty' })).body;
  assert.deepEqual(d.videos, []);
  const yt = d.sources.find(s => s.name === 'YouTube');
  assert.equal(yt.items, 0);
  assert.match(yt.note, /no parsable results/i);
});

test('volcanoes are placed inline or by following the notice URL', async () => {
  const res = await runEvents();
  const volc = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('Volcano Hazards'));
  assert.equal(volc.length, 2, 'both elevated volcanoes should be mapped');
  assert.ok(volc.every(e => Number.isFinite(e.lat) && Number.isFinite(e.lon)));

  const kilauea = volc.find(e => /Kilauea/.test(e.title));
  assert.ok(Math.abs(kilauea.lat - 19.421) < 0.01, 'inline coordinates should be used as-is');
  assert.equal(kilauea.alert, 'Red', 'WARNING maps to red');

  // This one carries no coordinates at all; they come from the fetched notice,
  // which also describes Shishaldin — the volcano must be matched by identity,
  // not by whichever coordinate pair the walker happens to reach first.
  const sitkin = volc.find(e => /Great Sitkin/.test(e.title));
  assert.ok(Math.abs(sitkin.lat - 52.076) < 0.01,
    'Great Sitkin was placed at ' + sitkin.lat + ',' + sitkin.lon + ' — wrong volcano in the notice');
  assert.ok(Math.abs(sitkin.lon + 176.13) < 0.01);
  assert.ok(!volc.some(a => volc.some(b => a !== b && a.lat === b.lat && a.lon === b.lon)),
    'two volcanoes were placed at identical coordinates');
  assert.equal(sitkin.alert, 'Orange', 'WATCH maps to orange');
  assert.match(sitkin.updated, /^2026-09-13T18:56:31Z$/, 'sent_utc should be normalised to ISO');

  assert.equal(res.body.meta.sources.usgs_volcano.placedViaNotice, 1);
});

test('a volcano whose notice cannot be fetched is left unplaced, not invented', async () => {
  const res = await runEvents({ down: ['usgs_volcano_notice'] });
  const volc = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('Volcano Hazards'));
  assert.equal(volc.length, 1, 'only the inline-coordinate volcano should remain');
  assert.match(volc[0].title, /Kilauea/);
  assert.equal(res.body.meta.sources.usgs_volcano.placedViaNotice, 0);
});

test('a volcano that cannot be identified in its notice is left unplaced', async () => {
  // Notice describes two volcanoes and neither matches the record's identity:
  // guessing would put an alert at the wrong place, so it must be dropped.
  const res = await runEvents({ volcanoNoticeMismatch: true });
  const volc = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('Volcano Hazards'));
  assert.equal(volc.length, 1, 'only the inline-coordinate volcano should survive');
  assert.match(volc[0].title, /Kilauea/);
  assert.equal(res.body.meta.sources.usgs_volcano.unplaced, 1);
});
