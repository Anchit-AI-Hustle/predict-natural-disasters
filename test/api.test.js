'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { makeFetch, mockRes } = require('./mock-upstreams.js');
const eventsHandler = require(path.join(__dirname, '..', 'api', 'events.js'));
const enrichHandler = require(path.join(__dirname, '..', 'api', 'event-enrichment.js'));
const support = require(path.join(__dirname, '..', 'api', '_lib', 'verified-support.js'));

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
    'outlook ids changed between refreshes - detail links would 404');
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

test('ReliefWeb disasters come from the public feed with no credential', async () => {
  const res = await runEvents();
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, true, 'the public feed needs no appname');
  assert.match(rw.endpoint, /reliefweb\.int\/disasters/, 'the answering feed URL should be recorded');
  assert.equal(rw.records, 2, 'two of the feed items are placeable');

  const recs = res.body.events.filter(e => e.sourceType === 'official' && e.source.includes('ReliefWeb'));
  assert.equal(recs.length, 2);
  const nepal = recs.find(e => /Nepal/.test(e.title));
  assert.ok(nepal, 'Nepal disaster missing');
  assert.equal(nepal.country, 'Nepal');
  assert.equal(nepal.type, 'Flood', 'hazard type should come from the title');
  assert.ok(Math.abs(nepal.lat - 28.16667) < 0.01 && Math.abs(nepal.lon - 84.25) < 0.01,
    'country coordinates were not applied');
  assert.equal(nepal.precision, 'country', 'country-level placement must be flagged');
  assert.match(nepal.details, /country level, not at an incident location/);
  assert.equal(nepal.sourceUrl, 'https://reliefweb.int/disaster/fl-2026-000167-npl');

  const ph = recs.find(e => /Philippines/.test(e.title));
  assert.equal(ph.type, 'Tropical Cyclone');
});

test('a ReliefWeb record whose country cannot be located is left out', async () => {
  const res = await runEvents();
  assert.equal(res.body.meta.sources.reliefweb.unplacedCountries, 1);
  assert.ok(!res.body.events.some(e => /Atlantis/.test(e.title)),
    'an unlocatable country must not be placed somewhere plausible');
});

test('a feed URL that answers without items falls through to the next candidate', async () => {
  // A Drupal miss returns 200 with an HTML page; that must not be accepted as
  // an empty feed, which would look like "online, no disasters".
  /* The last candidate was /disasters/feed until it was removed for answering
     404; the fall-through is now from the ongoing view to the full feed. */
  const res = await runEvents({ reliefwebEmpty: ['view=ongoing'] });
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, true);
  assert.equal(rw.endpoint, 'https://reliefweb.int/disasters/rss.xml');
  assert.equal(rw.records, 2);
});

test('ReliefWeb is offline when no candidate feed yields items', async () => {
  const res = await runEvents({ reliefwebEmptyUntil: '/nothing-matches' });
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, false);
  assert.match(rw.error, /no <item> elements/);
  assert.equal(rw.tried, 2, "both candidate feeds (the dead /disasters/feed was the third) were tried");
});

test('ReliefWeb degrades to offline when its feed is unreachable', async () => {
  const res = await runEvents({ down: ['reliefweb'] });
  assert.equal(res.body.meta.sources.reliefweb.ok, false);
  assert.match(res.body.meta.sources.reliefweb.error, /HTTP 503/);
  assert.ok(res.body.meta.sourceCount >= 7, 'the other providers carry on');
});

test('ReliefWeb records still resolve when the geocoder is down', async () => {
  const res = await runEvents({ down: ['geocode'] });
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, true, 'the feed itself still parsed');
  assert.equal(rw.records, 0);
  assert.equal(rw.unplacedCountries, 3, 'nothing is placed without coordinates');
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

  // Only recognised newsrooms and official agencies are admitted. On a page
  // people may read during an emergency, an unvetted outlet carries a cost a
  // "not established" label does not cover.
  assert.ok(d.news.every(x => x.established === true), 'an unvetted outlet was admitted');
  assert.ok(!d.news.some(x => /example-local-news\.test/.test(x.link)),
    'the unvetted fixture outlet is still being shown');
});

test('a recognised outlet is admitted even when the link is a Google News redirect', async () => {
  // Google News <link> values are news.google.com/rss/... redirects, so the
  // domain allowlist cannot match them. Admission has to recognise the outlet
  // name carried in the feed's own <source> element, or nearly every Google
  // result is rejected on its host alone.
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'event-enrichment.js'), 'utf8');
  const allow = src.match(/const ESTABLISHED_OUTLETS = \[[\s\S]*?\];/)[0];
  const fnSrc = src.match(/const OUTLET_KEYS[\s\S]*?\n\}/)[0];
  const isEstablished = new Function('hostOf', allow + '\n' + fnSrc + '\nreturn isEstablished;')(
    u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } });

  const via = 'https://news.google.com/rss/articles/CBMiXyZ';
  for (const outlet of ['The Hindu', 'CNN', 'Bangkok Post', 'Rappler', 'Kyodo News', 'Reuters']) {
    assert.equal(isEstablished(via, outlet), true, outlet + ' was rejected');
  }
  for (const outlet of ['Random Blog', 'Local News Daily', '']) {
    assert.equal(isEstablished(via, outlet), false, outlet + ' was admitted');
  }
});

test('rejecting an outlet does not delete the admitted copy of the same story', async () => {
  // Deduping before filtering let a rejected copy take the title key and remove
  // the admitted copy that linked straight to the outlet.
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'event-enrichment.js'), 'utf8');
  const filterAt = src.indexOf('.filter(x => x.established)');
  const dedupeAt = src.indexOf('dedupe(', src.indexOf('const news ='));
  const keyAt = src.indexOf("x => (x.title || '').toLowerCase()");
  assert.ok(filterAt > dedupeAt && filterAt < keyAt,
    'the admission filter must run inside dedupe\'s argument, before the key function');

  const d = (await runEnrichment(NEPAL)).body;
  const titles = d.news.map(x => x.title);
  assert.equal(new Set(titles).size, titles.length, 'duplicate stories survived');
});

test('the unvetted outlet really is in the feed, so the filter is doing work', async () => {
  // Guards the premise of the test above: if the fixture stopped serving an
  // unrecognised outlet, that assertion would pass without proving anything.
  const raw = fs.readFileSync(path.join(__dirname, 'mock-upstreams.js'), 'utf8');
  assert.match(raw, /example-local-news\.test/,
    'the fixture no longer contains an unrecognised outlet to exclude');
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
  assert.match(d.donationPolicy, /do not show donation links until real harm is confirmed/i);
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

test('situation reports come from the public ReliefWeb feed', async () => {
  const d = (await runEnrichment(NEPAL)).body;
  assert.ok(d.situationReports.length >= 2, 'the public RSS feed should supply reports');
  assert.ok(d.situationReports.every(x => x.link.includes('reliefweb.int')));
  assert.equal(d.situationReports[0].via, 'ReliefWeb (UN OCHA)');
  assert.equal(d.situationReports[0].outlet, 'OCHA');
  assert.ok(d.situationReports.every(x => x.established), 'ReliefWeb items are authoritative');
});

/* ------------------------------- restored: video shapes & volcano placement */

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
  // which also describes Shishaldin - the volcano must be matched by identity,
  // not by whichever coordinate pair the walker happens to reach first.
  const sitkin = volc.find(e => /Great Sitkin/.test(e.title));
  assert.ok(Math.abs(sitkin.lat - 52.076) < 0.01,
    'Great Sitkin was placed at ' + sitkin.lat + ',' + sitkin.lon + ' - wrong volcano in the notice');
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

/* ------------------------------------------- one earthquake, one feed entry */

const { mergeSeismicReports } = eventsHandler;

function quake(over) {
  return Object.assign({
    id: 'q', type: 'Earthquake', source: 'USGS', title: 'M 6.5',
    magnitude: 6.5, lat: -5.9, lon: 106.6,
    startedAt: '2026-09-11T04:12:00Z', updated: '2026-09-11T05:00:00Z'
  }, over);
}

test('the same earthquake reported by two agencies collapses to one record', () => {
  const out = mergeSeismicReports([
    quake({ id: 'us7000abcd', sourceUrl: 'https://earthquake.usgs.gov/x', country: 'Indonesia' }),
    quake({ id: 'emsc-1', source: 'EMSC', title: 'M 6.5 JAVA, INDONESIA', magnitude: 6.5, lat: -6.1, lon: 106.9, startedAt: '2026-09-11T04:12:23Z' })
  ]);
  assert.equal(out.length, 1, 'two solutions for one quake should be one record');
  assert.equal(out[0].source, 'USGS', 'the fuller record should survive');
  assert.deepEqual(out[0].corroboratedBy, ['EMSC'], 'the other agency must still be credited');
});

test('genuinely distinct earthquakes are never merged', () => {
  const cases = {
    'magnitude half a unit apart is still one quake': [quake(), quake({ id: 'b', source: 'EMSC', magnitude: 6.4 })],
    'magnitude a full unit apart': [quake(), quake({ id: 'b', source: 'EMSC', magnitude: 5.2 })],
    'same instant, opposite sides of the planet': [quake(), quake({ id: 'b', source: 'EMSC', lat: 38.2, lon: 26.1 })],
    'same place, ninety minutes later': [quake(), quake({ id: 'b', source: 'EMSC', startedAt: '2026-09-11T05:42:00Z' })],
    'same place, two minutes later': [quake(), quake({ id: 'b', source: 'EMSC', startedAt: '2026-09-11T04:14:00Z' })]
  };
  for (const [name, pair] of Object.entries(cases)) {
    const expected = name.startsWith('magnitude half') ? 1 : 2;
    assert.equal(mergeSeismicReports(pair).length, expected, name);
  }
});

test('non-seismic records are left alone by the seismic merge', () => {
  const flood = { id: 'f1', type: 'Flood', source: 'GDACS', title: 'Flood', lat: 27.7, lon: 85.3, startedAt: '2026-09-11T04:12:00Z' };
  const sitrep = Object.assign({}, flood, { id: 'f2', source: 'ReliefWeb' });
  assert.equal(mergeSeismicReports([flood, sitrep]).length, 2,
    'a flood alert and a situation report about it are different documents');

  // A forecast about a quake is not a report of one and must not absorb it.
  assert.equal(mergeSeismicReports([quake(), quake({ id: 'p', source: 'EMSC', forecast: true })]).length, 2);
});

test('merging preserves the order of the feed it was given', () => {
  const ordered = [
    { id: 'newest', type: 'Flood', source: 'GDACS', startedAt: '2026-09-14T00:00:00Z' },
    quake({ id: 'us7000abcd', sourceUrl: 'https://earthquake.usgs.gov/x' }),
    quake({ id: 'emsc-1', source: 'EMSC', lat: -6.1, lon: 106.9, startedAt: '2026-09-11T04:12:23Z' }),
    { id: 'oldest', type: 'Flood', source: 'GDACS', startedAt: '2026-09-01T00:00:00Z' }
  ];
  assert.deepEqual(mergeSeismicReports(ordered).map(e => e.id),
    ['newest', 'us7000abcd', 'oldest'],
    'the merged record must keep its place, not be appended to the end');
});

test('the live feed merges the cross-agency earthquake it is given', async () => {
  const res = await runEvents();
  /* Selected by what the record is, not by the day it happened: the fixture
     quakes are dated relative to the run so their aftershock windows stay
     open, and a calendar-pinned filter would stop matching the moment they
     moved. */
  const java = res.body.events.filter(e =>
    e.type === 'Earthquake' && Math.abs(e.magnitude - 6.5) < 0.01 &&
    /Teluknaga|JAVA/i.test(String(e.title)));
  assert.equal(java.length, 1,
    'the Teluknaga quake is reported by two agencies and must appear once, got ' +
      JSON.stringify(java.map(e => e.source + ' ' + e.title)));
  assert.deepEqual(java[0].corroboratedBy, ['EMSC']);
  // Two merging pairs in the fixture now: this one, and the Cianjur quake
  // GDACS also reports, which covers what a merge must not discard.
  assert.equal(res.body.meta.mergedSeismicReports, 2);
  const cianjur = res.body.events.filter(e =>
    e.type === 'Earthquake' && Math.abs(e.magnitude - 5.6) < 0.01);
  assert.equal(cianjur.length, 1, 'the Cianjur quake should also appear once');

  // The unrelated Aegean quake from the same agency must survive untouched.
  assert.ok(res.body.events.some(e => /AEGEAN/i.test(e.title || '')),
    'an unrelated EMSC earthquake was swallowed by the merge');

  // The headline count the homepage prints is the merged count.
  assert.equal(res.body.meta.eventCount, res.body.events.length);
});

test('the feed stays in the order it was sorted into after merging', async () => {
  const res = await runEvents();
  const risk = { Red: 4, Orange: 3, High: 3, Moderate: 2, Watch: 1, Green: 1 };
  const ev = res.body.events;
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i];
    const ra = risk[a.alert] || 0, rb = risk[b.alert] || 0;
    assert.ok(ra >= rb, 'alert ranking broke at index ' + i);
    if (ra === rb) {
      assert.ok(new Date(a.updated) >= new Date(b.updated),
        'newest-first order broke at index ' + i + ': ' + a.updated + ' before ' + b.updated);
    }
  }
});

test('the feed can report its counts without shipping every record', async () => {
  const full = await runEvents();
  const res = mockRes();
  await withFetch(makeFetch({}), () =>
    eventsHandler({ query: { summary: '1' }, url: '/api/events?summary=1' }, res));

  assert.equal(res.statusCode, 200);
  assert.ok(!('events' in res.body), 'the summary should carry no records');
  assert.equal(res.body.meta.eventCount, full.body.events.length);
  assert.equal(res.body.meta.mergedSeismicReports, full.body.meta.mergedSeismicReports);
  assert.ok(res.body.generatedAt, 'the summary should say when it was built');

  // The parameter is also read straight off the url, since not every runtime
  // hands the handler a parsed query.
  const fromUrl = mockRes();
  await withFetch(makeFetch({}), () =>
    eventsHandler({ url: '/api/events?summary=1' }, fromUrl));
  assert.ok(!('events' in fromUrl.body));

  // Anything else still returns the whole feed.
  const plain = mockRes();
  await withFetch(makeFetch({}), () =>
    eventsHandler({ query: { summary: '0' }, url: '/api/events?summary=0' }, plain));
  assert.ok(Array.isArray(plain.body.events) && plain.body.events.length > 0);
});

test('two earthquakes from the same agency are never merged into one', () => {
  // Found against the live feed: three same-agency pairs were being collapsed.
  // A catalogue already deduplicates itself, so two records from one agency
  // are two earthquakes by that agency's own determination.
  const doublets = {
    // Petrolia, California: 44 seconds apart, same spot, both from USGS.
    'a doublet 44 seconds apart': [
      quake({ id: 'p1', title: 'M 3.6 - 21 km W of Petrolia, CA', magnitude: 3.63, lat: 40.29, lon: -124.53, startedAt: '2026-09-10T01:24:48.040Z' }),
      quake({ id: 'p2', title: 'M 3.8 - 20 km WSW of Petrolia, CA', magnitude: 3.79, lat: 40.29, lon: -124.52, startedAt: '2026-09-10T01:24:04.400Z' })
    ],
    // Cobb, California: 21 seconds apart, a swarm, both from USGS.
    'a swarm pair 21 seconds apart': [
      quake({ id: 'c1', title: 'M 3.2 - 10 km WNW of Cobb, CA', magnitude: 3.15, lat: 38.86, lon: -122.83, startedAt: '2026-09-10T20:36:38.680Z' }),
      quake({ id: 'c2', title: 'M 3.0 - 10 km WNW of Cobb, CA', magnitude: 2.97, lat: 38.85, lon: -122.83, startedAt: '2026-09-10T20:36:17.230Z' })
    ]
  };
  for (const [name, pair] of Object.entries(doublets)) {
    const out = mergeSeismicReports(pair);
    assert.equal(out.length, 2, name + ' was merged into one record');
    assert.ok(out.every(e => !e.corroboratedBy), name + ' was credited as corroboration');
  }

  // A third agency still joins a pair that already holds two others.
  const three = mergeSeismicReports([
    quake({ id: 'u', source: 'USGS' }),
    quake({ id: 'e', source: 'EMSC', lat: -6.1, lon: 106.9, startedAt: '2026-09-11T04:12:23Z' }),
    quake({ id: 'g', source: 'GDACS', lat: -6.0, lon: 106.7, startedAt: '2026-09-11T04:12:10Z' })
  ]);
  assert.equal(three.length, 1, 'three agencies reporting one quake should be one record');
  assert.deepEqual(three[0].corroboratedBy.slice().sort(), ['EMSC', 'GDACS']);

  // A same-agency neighbour must not block a genuine cross-agency merge.
  const mixed = mergeSeismicReports([
    quake({ id: 'u1', source: 'USGS' }),
    quake({ id: 'u2', source: 'USGS', lat: 40.29, lon: -124.53 }),
    quake({ id: 'e1', source: 'EMSC', lat: -6.1, lon: 106.9, startedAt: '2026-09-11T04:12:23Z' })
  ]);
  assert.equal(mixed.length, 2, 'expected the two USGS records to stay and the EMSC one to merge');
  assert.equal(mixed.filter(e => e.corroboratedBy).length, 1);
});


test('one earthquake produces one aftershock outlook, however many agencies report it', async () => {
  /* The agencies' reports were merged only after the outlooks were built, and
     the guard that stops a swarm producing twenty outlooks rounds a position
     to the nearest degree - which two solutions of one earthquake straddle as
     easily as not. Measured: a USGS record at -5.9/106.6 and a GDACS record
     at -5.45/106.45, 52 km apart and the same event by the merge's own rule,
     produced two frozen claims about one sequence, both recorded in the
     append-only ledger and both counted in the conditional rate. The second
     also pointed at a record the feed then stopped serving, because its own
     agency's copy had been merged away. */
  const sameQuakeFromGdacs = {
    features: [{ properties: {
      eventid: 9001, eventtype: 'EQ', name: 'M 6.5 earthquake, Java', country: 'Indonesia',
      location: 'Banten', alertlevel: 'Orange', latitude: -5.45, longitude: 106.45,
      fromdate: new Date(Date.now() - 60 * 36e5).toISOString(), todate: new Date().toISOString(),
      description: 'Magnitude 6.5 earthquake',
      severitydata: { severity: 6.5, severitytext: 'Magnitude 6.5' }
    } }]
  };
  const body = (await runEvents({ feeds: { gdacs: sameQuakeFromGdacs } })).body;
  const quake = body.events.find(e => e.id === 'usgs-us7000abcd');
  assert.ok(quake, 'control: the USGS record should still be the one served');
  assert.ok((quake.corroboratedBy || []).includes('GDACS'),
    'control: the two agencies must be merged for this to prove anything');

  const aftershocks = body.events.filter(e => e.forecast && e.type === 'Earthquake aftershock sequence');
  const ids = aftershocks.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate outlook ids');
  assert.equal(ids.filter(id => /gdacs/i.test(id)).length, 0,
    'an aftershock outlook was derived from an agency copy that was merged away: ' + ids.join(', '));
  assert.equal(aftershocks.filter(o => o.forecastOf === quake.id).length, 1,
    'one earthquake, one aftershock outlook');

  /* And nothing derived points at a record the feed does not carry. */
  const served = new Set(body.events.map(e => e.id));
  for (const o of body.events.filter(e => e.forecast && e.forecastOf)) {
    assert.ok(served.has(o.forecastOf),
      o.id + ' is derived from ' + o.forecastOf + ', which the feed does not carry');
  }
});

test('two separate earthquakes in one degree cell each get their own outlook', () => {
  /* The other half of the test above, and the cost of how it used to be paid.
     A whole degree is about 111 km, so the guard that kept one quake from
     producing two outlooks also kept two quakes from producing one each -
     and which of the two happened was decided by where a degree boundary
     fell. Measured on two M6 shocks 46 km and ten hours apart - two records
     after the seismic merge, and two disasters by this project's own
     earthquake rule of 100 km and two hours - only the larger was given a
     sequence outlook, and the second quake's sequence was not published at
     all. (It is not a missed prediction: an earthquake onset is not
     forecastable and the recall side says so. It is a product this site
     publishes for one quake and silently withholds for its neighbour.) */
  const OBSM = require(path.join(__dirname, '..', 'observed-model.js'));
  const agoH = h => Date.now() - h * 3600e3;
  const shock = (id, mag, lat, lon, hoursAgo) => ({
    id, geometry: { coordinates: [lon, lat, 20] },
    properties: { place: 'Hindu Kush region, Afghanistan', mag, time: agoH(hoursAgo),
      updated: agoH(hoursAgo - 1), title: 'M ' + mag + ' - Hindu Kush region, Afghanistan',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/' + id, tsunami: 0, alert: 'orange' }
  });
  const a = shock('us-doublet-a', 6.2, 36.2, 70.2, 20);
  const b = shock('us-doublet-b', 6.0, 36.3, 69.7, 10);

  /* The fixture has to be two disasters and one cell, or it proves nothing. */
  assert.ok(OBSM.distanceKm(36.2, 70.2, 36.3, 69.7) > OBSM.MATCH.earthquake.km * 0.3 &&
    OBSM.distanceKm(36.2, 70.2, 36.3, 69.7) < OBSM.MATCH.earthquake.km,
    'fixture: the two shocks are no longer inside one degree cell and apart');
  assert.equal(Math.round(36.2) + ',' + Math.round(70.2), Math.round(36.3) + ',' + Math.round(69.7),
    'fixture: the two shocks no longer round to one cell');

  return runEvents({ feeds: { usgs: { features: [a, b] }, gdacs: [], eonet: { events: [] },
    nhc: { activeStorms: [] } } }).then(res => {
    const body = res.body;
    const quakes = ['usgs-us-doublet-a', 'usgs-us-doublet-b']
      .filter(id => body.events.some(e => e.id === id));
    assert.deepEqual(quakes, ['usgs-us-doublet-a', 'usgs-us-doublet-b'],
      'control: the two shocks were merged, so they are one disaster and this proves nothing');
    for (const id of quakes) {
      assert.equal(body.events.filter(e => e.forecastKind === 'aftershock-sequence' &&
        e.forecastOf === id).length, 1,
        'the sequence following ' + id + ' was not forecast at all');
    }
  });
});
