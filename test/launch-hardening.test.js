'use strict';
/*
 * The feed before a launch: what one slow provider, a burst of visitors and a
 * row of Refresh clicks can do to it (launch audit E1, E2, E3, E7, E11, E21).
 *
 * E1  The response used to wait for the slowest provider: one that hung kept
 *     every visitor on "Loading..." for as long as its fetch timeouts allowed,
 *     32 s measured with the weather service hanging. It now answers inside a
 *     fixed budget and says which providers did not answer in time.
 * E2  The edge copy went cold after 90 s of quiet in each region.
 * E3  Refresh added ?ts=, so every click was a fresh fan-out to every provider.
 * E7  /api/verified-support was a data file Vercel deployed as a function: 500.
 * E11 robots.txt hid /api/events from the crawler that renders the pages.
 * E21 /alerts/ served the page a second time instead of redirecting.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { makeFetch, mockRes } = require('./mock-upstreams.js');
const { renderPage, callApi } = require('./render.js');
const events = require(path.join(ROOT, 'api', 'events.js'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* One request, with the given fetch left in place for the whole call. */
async function run(fetchFn, url) {
  const realFetch = global.fetch;
  global.fetch = fetchFn;
  const res = mockRes();
  const t0 = Date.now();
  try {
    await events({ url: url || '/api/events', method: 'GET', headers: {} }, res);
  } finally {
    global.fetch = realFetch;
  }
  return { res, body: res.body, ms: Date.now() - t0 };
}

const fresh = () => { if (typeof events._resetMemo === 'function') events._resetMemo(); };

/* ------------------------------------------------------------- E1 deadline */

test('one provider hanging for 20 s does not hold the response past the budget', async () => {
  fresh();
  const f = makeFetch({ delay: u => (u.includes('eonet.gsfc.nasa.gov') ? 20000 : 0) });
  const { body, ms } = await run(f);
  assert.ok(ms < 5500, 'the feed waited ' + ms + ' ms for a provider that never answered');
  const s = body.meta.sources.eonet;
  assert.ok(s, 'the hung provider vanished from meta.sources instead of being reported');
  assert.equal(s.ok, false);
  assert.match(s.error, /did not answer in time/);
  /* "7 of 8 working" stays true: the late one is counted, and not as working. */
  assert.equal(body.meta.sourceTotal, 8);
  assert.equal(body.meta.sourceCount, 7);
  const p = body.meta.scan.providers.find(x => x.provider === 'eonet');
  assert.equal(p.status, 'DATA_UNAVAILABLE');
  assert.equal(p.success, false);
  assert.match(p.failureReason, /in time/);
  assert.ok(!body.events.some(e => /EONET/.test(e.source || '')), 'records from a provider reported late were served');
  /* Everything that did answer is there. */
  assert.ok(body.meta.sources.usgs.ok && body.meta.sources.gdacs.ok);
});

test('a provider whose requests together outlast the budget is reported late, and the rest are served', async () => {
  fresh();
  /* Each request answers inside its own timeout, but the weather service's
     alerts and then its zones, or the volcano list and then its notices,
     do not fit in the build's budget together. */
  const f = makeFetch({ delay: u => (/weather\.gov|volcanoes\.usgs|reliefweb|open-meteo/.test(u) ? 2500 : 0) });
  const { body, ms } = await run(f);
  assert.ok(ms < 5500, 'took ' + ms + ' ms');
  const late = Object.keys(body.meta.sources).filter(k => body.meta.sources[k].late);
  assert.ok(late.length >= 1, 'nothing was reported late: ' + JSON.stringify(body.meta.sources));
  for (const k of late) {
    assert.equal(body.meta.sources[k].ok, false);
    assert.match(body.meta.sources[k].error, /in time/);
    const p = body.meta.scan.providers.find(x => x.provider === k);
    assert.equal(p.status, 'DATA_UNAVAILABLE');
  }
  assert.deepEqual(body.meta.lateSources, late);
  assert.equal(body.meta.sourceTotal, 8);
  assert.equal(body.meta.sourceCount, 8 - late.length);
  assert.ok(body.meta.sources.usgs.ok && body.meta.sources.gdacs.ok && body.meta.sources.emsc.ok);
});

test('the weather-service ladder fits the budget when the service hangs', async () => {
  fresh();
  const f = makeFetch({ delay: u => (u.includes('api.weather.gov') ? 20000 : 0) });
  const { body, ms } = await run(f);
  assert.ok(ms < 5500, 'the NWS fallbacks ran one after another for ' + ms + ' ms');
  assert.equal(body.meta.sources.nws.ok, false);
  /* A query that timed out is not one the API rejected: walking four more
     filters against a service that is not answering cannot help. */
  const asked = f.calls.filter(u => u.includes('api.weather.gov/alerts'));
  assert.ok(asked.length <= 2, 'the ladder kept retrying a service that was not answering: ' + asked.length + ' queries');
});

test('a late provider cannot change the response after it was sent', async () => {
  fresh();
  const f = makeFetch({ delay: u => (u.includes('eonet.gsfc.nasa.gov') ? 5000 : 0) });
  const { body } = await run(f);
  const n = body.events.length;
  const sources = JSON.stringify(body.meta.sources);
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(body.events.length, n);
  assert.equal(JSON.stringify(body.meta.sources), sources);
});

test('no upstream request starts once the response is on its way', async () => {
  fresh();
  let sent = false;
  const after = [];
  const inner = makeFetch({ delay: u => (u.includes('seismicportal.eu') ? 20000 : 0) });
  const f = (url, init) => { if (sent) after.push(String(url)); return inner(url, init); };
  await run(f);
  sent = true;
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(after, []);
});

test('the GDACS pages are fetched side by side, not one after another', async () => {
  fresh();
  /* Full pages, so every hazard is followed to its last page. */
  let id = 1;
  const page = () => Array.from({ length: 100 }, () => ({
    eventid: id++, eventtype: 'WF', name: 'Wildfire', country: 'Australia', alertlevel: 'Green',
    latitude: -30, longitude: 140, fromdate: new Date().toISOString(), todate: new Date().toISOString()
  }));
  const inner = makeFetch({ gdacs: u => (u.includes('SEARCH') ? page() : undefined),
    delay: u => (u.includes('gdacs.org') ? 1500 : 0) });
  const { body, ms } = await run(inner);
  assert.equal(body.meta.sources.gdacs.ok, true, JSON.stringify(body.meta.sources.gdacs));
  const pages = inner.calls.filter(u => u.includes('SEARCH'));
  assert.equal(pages.length, 18, 'six hazards, three pages each');
  /* Sequential paging was 3 x 1.5 s = 4.5 s at least. */
  assert.ok(ms < 3000, 'GDACS took ' + ms + ' ms for pages that each take 1.5 s');
});

test('each upstream fetch has its own shorter timeout', () => {
  const src = read('api/events.js');
  assert.match(src, /const FETCH_TIMEOUT_MS = 3000;/);
  assert.match(src, /const BUILD_BUDGET_MS = 4500;/);
  assert.match(src, /Promise\.race\(/);
});

test('vercel.json gives the feed function a duration ceiling', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.functions['api/events.js'].maxDuration, 15);
  assert.equal(v.functions['api/alerts-run.js'].maxDuration, 60);
});

/* ----------------------------------------------------------- E2 edge cache */

test('the edge keeps a copy for a minute, serves it stale for an hour and through errors for a day', async () => {
  fresh();
  const { res } = await run(makeFetch({}));
  assert.equal(res.headers['vercel-cdn-cache-control'], 'max-age=60, stale-while-revalidate=3600, stale-if-error=86400');
  /* The browser keeps nothing, so a reload always asks the edge. */
  assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['cache-control'], /max-age=0/);
});

/* --------------------------------------------------------- E3 cache bypass */

test('?ts= is served the copy this instance already built', async () => {
  fresh();
  const f = makeFetch({});
  await run(f, '/api/events');
  const before = f.calls.length;
  assert.ok(before > 0);
  const second = await run(f, '/api/events?ts=' + Date.now());
  assert.equal(f.calls.length, before, '?ts= started a new fan-out to every provider');
  assert.ok(second.body.events.length > 0);
});

test('a burst of requests shares one build', async () => {
  fresh();
  const f = makeFetch({ delay: () => 50 });
  const realFetch = global.fetch;
  global.fetch = f;
  try {
    const all = await Promise.all(Array.from({ length: 5 }, () => {
      const res = mockRes();
      return events({ url: '/api/events?ts=' + Math.random(), method: 'GET', headers: {} }, res).then(() => res);
    }));
    assert.ok(all.every(r => r.statusCode === 200 && r.body.events.length));
  } finally { global.fetch = realFetch; }
  const usgs = f.calls.filter(u => u.includes('earthquake.usgs.gov'));
  assert.equal(usgs.length, 1, 'five requests made ' + usgs.length + ' builds');
});

test('?cron= still gets a fresh build, but no more than once every 30 seconds', async () => {
  fresh();
  const f = makeFetch({});
  await run(f, '/api/events?cron=' + Date.now());
  const n1 = f.calls.length;
  assert.ok(n1 > 0, 'the first cron call did not build');
  await run(f, '/api/events?cron=' + Date.now());
  assert.equal(f.calls.length, n1, 'a cron call seconds after a build rebuilt anyway');
  const realNow = Date.now;
  Date.now = () => realNow() + 31000;
  try {
    const r = await run(f, '/api/events?cron=' + Date.now());
    assert.ok(f.calls.length > n1, 'a cron call 31 s after the last build was served the old copy');
    assert.ok(r.body.events.length > 0);
  } finally { Date.now = realNow; }
});

test('the scheduled job still asks with ?cron=', () => {
  const wf = read('.github/workflows/refresh-disaster-data.yml');
  assert.match(wf, /\/api\/events\?cron=\$\(date \+%s\)/);
});

test('no page or script asks for /api/events?ts=', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  const offenders = files.filter(f => /\/api\/events\?ts=/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('Refresh re-reads the feed through the edge copy', async () => {
  const r = await renderPage('alerts.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#alerts article').length > 0 });
  const before = r.apiCalls.length;
  r.document.getElementById('refresh').click();
  await new Promise(res => setTimeout(res, 100));
  const idx = r.apiCalls.map((u, i) => [u, i]).slice(before).filter(([u]) => u.includes('/api/events'));
  assert.ok(idx.length >= 1, 'Refresh fetched nothing');
  const [url, i] = idx[0];
  assert.equal(url, '/api/events', 'Refresh added a query string, which the edge treats as a new copy');
  assert.equal(r.apiInits[i].cache, 'no-cache');
  r.close();
});

/* ------------------------------------------------- E7 verified-support 500 */

test('every top-level api/*.js is a function Vercel can run', () => {
  const files = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f));
  for (const f of files) {
    const m = require(path.join(ROOT, 'api', f));
    const h = typeof m === 'function' ? m : m && m.default;
    assert.equal(typeof h, 'function', 'api/' + f + ' is deployed as a function but exports no handler');
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'api', '_lib', 'verified-support.js')), 'the directory data is not in api/_lib');
});

test('/api/verified-support answers 200', async () => {
  const h = require(path.join(ROOT, 'api', 'verified-support.js'));
  const r = await callApi(h, '/api/verified-support');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.globalRelief) && d.globalRelief.length);
  const one = await (await callApi(h, '/api/verified-support?country=Nepal')).json();
  assert.ok(one.country && one.country.globalRelief, 'a country lookup returned nothing');
});

/* --------------------------------------------------------------- E11 robots */

test('robots.txt lets crawlers read the feed the pages render from', () => {
  const lines = read('robots.txt').split(/\r?\n/).map(l => l.trim());
  assert.ok(lines.includes('Allow: /api/events'), 'the feed is still hidden from rendering crawlers');
  assert.ok(lines.includes('Allow: /api/event-enrichment'));
  assert.ok(lines.includes('Disallow: /api/'), 'the rest of /api/ is no longer disallowed');
});

/* ------------------------------------------------------ E21 trailing slash */

test('trailing slashes redirect, and no route depends on one', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.trailingSlash, false);
  assert.equal(v.cleanUrls, true);
  for (const r of [].concat(v.rewrites || [], v.redirects || [])) {
    assert.ok(r.source === '/' || !/\/$/.test(r.source), 'source ends in a slash: ' + r.source);
    assert.ok(r.destination === '/' || !/\/(\?|$)/.test(r.destination), 'destination ends in a slash: ' + r.destination);
  }
});
