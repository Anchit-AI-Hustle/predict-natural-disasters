'use strict';
/**
 * ReliefWeb through its v2 API when an approved appname is configured.
 *
 * Production lost ReliefWeb on its public feeds: every one answers
 * HTTP 406 "Blocked due to bot activity" (meta.sources.reliefweb, 17 October
 * 2026). The v2 API serves the same disasters, but since 1 November 2025 it
 * needs an appname ReliefWeb has approved (apidoc.reliefweb.int); an
 * unapproved one gets 403 "You are not using an approved appname".
 *
 * With RELIEFWEB_APPNAME set, the handler asks the API for disasters with
 * status "current" (the disasters fields table lists 'current', 'alert' and
 * 'past'; "alert" is a disaster expected, not one that has happened, and this
 * provider reports disasters that have). If the API fails it falls back to
 * the feeds. Every failure says what to set. The appname itself is never
 * echoed into the response.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeFetch, mockRes } = require('./mock-upstreams.js');
const handler = require(path.join(__dirname, '..', 'api', 'events.js'));

const APPNAME = 'pnd-test-appname-7f3c';

async function run(opts, appname) {
  const before = process.env.RELIEFWEB_APPNAME;
  if (appname === undefined) delete process.env.RELIEFWEB_APPNAME; else process.env.RELIEFWEB_APPNAME = appname;
  const realFetch = global.fetch;
  const fetch = makeFetch(opts || {});
  global.fetch = fetch;
  try {
    const res = mockRes();
    await handler({ method: 'GET', url: '/api/events', headers: {} }, res);
    return { res, calls: fetch.calls };
  } finally {
    global.fetch = realFetch;
    if (before === undefined) delete process.env.RELIEFWEB_APPNAME; else process.env.RELIEFWEB_APPNAME = before;
  }
}
const api = calls => calls.filter(u => u.includes('api.reliefweb.int'));
const feeds = calls => calls.filter(u => /\/\/reliefweb\.int\/disasters/.test(u));

test('with an appname, disasters come from the API: current ones only, and the feeds are not asked', async () => {
  const { res, calls } = await run({}, APPNAME);
  const asked = api(calls);
  assert.equal(asked.length, 1, 'the API was not asked once: ' + asked.join(' | '));
  const u = new URL(asked[0]);
  assert.equal(u.origin + u.pathname, 'https://api.reliefweb.int/v2/disasters');
  assert.equal(u.searchParams.get('appname'), APPNAME);
  assert.equal(u.searchParams.get('filter[field]'), 'status');
  assert.deepEqual(u.searchParams.getAll('filter[value]'), ['current']);
  for (const f of ['name', 'status', 'date.changed', 'url', 'url_alias', 'primary_country.name', 'primary_type.name', 'description']) {
    assert.ok(u.searchParams.getAll('fields[include][]').includes(f), 'field not asked for: ' + f);
  }
  assert.deepEqual(u.searchParams.getAll('sort[]'), ['date.changed:desc']);
  assert.deepEqual(feeds(calls), [], 'the feeds were asked although the API answered');

  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, true, JSON.stringify(rw));
  assert.equal(rw.via, 'api');
  assert.equal(rw.endpoint, 'https://api.reliefweb.int/v2/disasters');
  assert.equal(rw.records, 2, 'Nepal and the Philippines are placeable');
  assert.equal(rw.unplacedCountries, 1, 'Atlantis has no coordinates');
  assert.equal(rw.withoutDateOrLink, 1, 'a record with no date and no link is left out, and counted');

  const recs = res.body.events.filter(e => e.sourceType === 'official' && /ReliefWeb/.test(e.source));
  assert.equal(recs.length, 2);
  const nepal = recs.find(e => /Nepal/.test(e.title));
  assert.equal(nepal.title, 'Nepal: Floods and Landslides - Sep 2026');
  assert.equal(nepal.country, 'Nepal');
  assert.equal(nepal.type, 'Flood');
  assert.equal(nepal.precision, 'country');
  assert.ok(Math.abs(nepal.lat - 28.16667) < 0.01 && Math.abs(nepal.lon - 84.25) < 0.01, 'country coordinates were not applied');
  assert.equal(nepal.updated, '2026-09-13T08:00:00.000Z', 'updated must be the record\'s own last change');
  assert.equal(nepal.sourceUrl, 'https://reliefweb.int/disaster/fl-2026-000167-npl');
  assert.match(nepal.details, /country level, not at an incident location/);
  assert.equal(recs.find(e => /Philippines/.test(e.title)).type, 'Tropical Cyclone');

  /* The scan names the API as the provider's endpoint. */
  const scan = res.body.meta.scan.providers.find(p => p.provider === 'reliefweb');
  assert.equal(scan.endpoint, 'https://api.reliefweb.int/v2/disasters');
  assert.ok(!JSON.stringify(res.body).includes(APPNAME), 'the appname was echoed into the response');
});

test('an appname the API refuses falls back to the feeds, and says why', async () => {
  const { res, calls } = await run({ reliefwebApiStatus: 403 }, APPNAME);
  assert.equal(api(calls).length, 1);
  assert.ok(feeds(calls).length >= 1, 'the feeds were not tried after the API refused');
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, true, 'the feeds still answered');
  assert.equal(rw.via, 'feed');
  assert.match(rw.apiError, /HTTP 403/);
  assert.match(rw.apiError, /RELIEFWEB_APPNAME/);
  assert.equal(rw.records, 2);
  assert.ok(!JSON.stringify(res.body).includes(APPNAME), 'the appname was echoed into the response');
});

test('when the API and the feeds both fail, the error gives both reasons and what to set', async () => {
  const { res } = await run({ reliefwebApiStatus: 403, down: ['reliefweb'] }, APPNAME);
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, false);
  assert.match(rw.error, /HTTP 503/, 'the feed failure is missing');
  assert.match(rw.apiError, /HTTP 403/, 'the API failure is missing');
  assert.match(rw.apiError, /approved/);
});

test('without an appname the API is never asked, and a feed failure says what to set', async () => {
  const { res, calls } = await run({ down: ['reliefweb'] }, undefined);
  assert.deepEqual(api(calls), []);
  const rw = res.body.meta.sources.reliefweb;
  assert.equal(rw.ok, false);
  assert.match(rw.error, /HTTP 503/);
  assert.match(rw.hint, /RELIEFWEB_APPNAME/, 'nothing says how to get ReliefWeb back');
  /* A blank value is no appname. */
  const blank = await run({}, '   ');
  assert.deepEqual(api(blank.calls), []);
  assert.equal(blank.res.body.meta.sources.reliefweb.via, 'feed');
});

/* ------------------------------------------- situation reports on a page */

const enrich = require(path.join(__dirname, '..', 'api', 'event-enrichment.js'));
const enrichFn = typeof enrich === 'function' ? enrich : enrich.default;
async function runEnrich(opts, appname) {
  const before = process.env.RELIEFWEB_APPNAME;
  if (appname === undefined) delete process.env.RELIEFWEB_APPNAME; else process.env.RELIEFWEB_APPNAME = appname;
  const realFetch = global.fetch;
  const fetch = makeFetch(opts || {});
  global.fetch = fetch;
  try {
    const res = mockRes();
    await enrichFn({ method: 'GET', url: '/api/event-enrichment?title=Floods&country=Nepal&type=Flood&lat=28.2&lon=84.2', headers: {} }, res);
    return { res, calls: fetch.calls };
  } finally {
    global.fetch = realFetch;
    if (before === undefined) delete process.env.RELIEFWEB_APPNAME; else process.env.RELIEFWEB_APPNAME = before;
  }
}
const rwSource = body => body.sources.find(s => /ReliefWeb/.test(s.name));

test('with an appname, situation reports come from the API search, newest first', async () => {
  const { res, calls } = await runEnrich({}, APPNAME);
  const asked = calls.filter(u => u.includes('api.reliefweb.int'));
  assert.equal(asked.length, 1, asked.join(' | '));
  const u = new URL(asked[0]);
  assert.equal(u.origin + u.pathname, 'https://api.reliefweb.int/v2/reports');
  assert.equal(u.searchParams.get('appname'), APPNAME);
  assert.equal(u.searchParams.get('query[value]'), 'Floods Nepal');
  assert.equal(u.searchParams.get('query[operator]'), 'AND', 'every word must match, as on the site');
  for (const f of ['title', 'url', 'url_alias', 'source.shortname', 'source.name', 'date.created']) {
    assert.ok(u.searchParams.getAll('fields[include][]').includes(f), 'field not asked for: ' + f);
  }
  assert.deepEqual(u.searchParams.getAll('sort[]'), ['date.created:desc']);
  assert.deepEqual(calls.filter(x => x.includes('reliefweb.int/updates/rss')), [], 'the feed was asked although the API answered');

  const d = res.body;
  assert.equal(d.situationReports.length, 2);
  const first = d.situationReports[0];
  assert.equal(first.title, 'Nepal: Floods and Landslides Situation Report No. 4');
  assert.equal(first.link, 'https://reliefweb.int/report/nepal/sitrep-4');
  assert.equal(first.outlet, 'OCHA');
  assert.equal(first.via, 'ReliefWeb (UN OCHA)');
  assert.equal(first.publishedAt, '2026-09-13T12:00:00+00:00');
  assert.ok(d.situationReports.every(x => x.established));
  assert.equal(rwSource(d).items, 2);
  assert.equal(rwSource(d).note, undefined);
  assert.ok(!JSON.stringify(d).includes(APPNAME), 'the appname was echoed into the response');
});

test('situation reports fall back to the feed when the API refuses, and say why', async () => {
  const { res } = await runEnrich({ reliefwebApiStatus: 403 }, APPNAME);
  const d = res.body;
  assert.ok(d.situationReports.length >= 2, 'the feed still supplies reports');
  assert.match(rwSource(d).note, /HTTP 403/);
  assert.match(rwSource(d).note, /RELIEFWEB_APPNAME/);
  assert.ok(!JSON.stringify(d).includes(APPNAME), 'the appname was echoed into the response');
});

test('a ReliefWeb feed failure is said, not shown as no reports', async () => {
  const { res, calls } = await runEnrich({ down: ['reliefweb_rss'] }, undefined);
  assert.deepEqual(calls.filter(u => u.includes('api.reliefweb.int')), []);
  const d = res.body;
  assert.equal(d.situationReports.length, 0);
  assert.equal(rwSource(d).items, 0);
  assert.match(rwSource(d).note, /HTTP 503/, 'the failure is not reported');
  assert.match(rwSource(d).note, /RELIEFWEB_APPNAME/);
  /* A feed that answered with nothing found is not a failure. */
  const ok = await runEnrich({}, undefined);
  assert.equal(rwSource(ok.res.body).note, undefined);
});
