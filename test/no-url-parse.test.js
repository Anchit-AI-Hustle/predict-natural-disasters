'use strict';
/**
 * No request handler reads req.query, so nothing calls the deprecated
 * url.parse().
 *
 * Vercel's error log carried "[DEP0169] DeprecationWarning: url.parse()" 325
 * times between 14 September and 17 October 2026, on /api/events and
 * /api/event-enrichment. Nothing in this repository calls url.parse(). Vercel's
 * Node runtime defines req.query as a lazy property, and the first read parses
 * req.url with url.parse() (@vercel/node-bridge 4.0.1, helpers.js,
 * getQueryParser). Both handlers read req.query before falling back to
 * req.url. They now read req.url with the WHATWG URL API and never touch the
 * getter.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'api', '_lib', 'http.js'));

/** A request whose req.query is a getter, as Vercel's runtime makes it. */
function vercelReq(url) {
  const req = { method: 'GET', url, headers: { host: 'localhost' } };
  let reads = 0;
  Object.defineProperty(req, 'query', { configurable: true, enumerable: true, get() { reads++; return {}; } });
  return { req, reads: () => reads };
}
function fakeRes() {
  return { statusCode: 200, headers: {}, body: undefined,
    status(c) { this.statusCode = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
    json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end(b) { if (b !== undefined) this.body = b; return this; } };
}

test('query parameters come from req.url, and the lazy req.query is never read', () => {
  const { req, reads } = vercelReq('/api/events?summary=1&cron=123&ledger=true&id=a%20b');
  assert.deepEqual(H.queryOf(req), { summary: '1', cron: '123', ledger: 'true', id: 'a b' });
  assert.equal(reads(), 0, 'req.query was read');
  /* Tests and internal calls pass a plain query object and no query string. */
  assert.deepEqual(H.queryOf({ url: '/api/events', query: { all: '1' } }), { all: '1' });
  assert.deepEqual(H.queryOf({ query: { id: 'x' } }), { id: 'x' });
  assert.deepEqual(H.queryOf({ url: '/x?id=from-url', query: { id: 'from-query' } }), { id: 'from-url' });
  assert.deepEqual(H.queryOf(null), {});
});

test('the events and enrichment handlers answer without reading req.query', async () => {
  const { makeFetch } = require('./mock-upstreams.js');
  const realFetch = global.fetch;
  global.fetch = makeFetch({});
  try {
    const events = require(path.join(ROOT, 'api', 'events.js'));
    const a = vercelReq('/api/events?summary=1');
    const r1 = fakeRes();
    await events(a.req, r1);
    assert.equal(a.reads(), 0, '/api/events read req.query');
    assert.ok(r1.body && r1.body.meta && !r1.body.events, '?summary=1 was not honoured when read from the URL');

    const enrich = require(path.join(ROOT, 'api', 'event-enrichment.js'));
    const fn = typeof enrich === 'function' ? enrich : enrich.default || enrich.handler;
    const b = vercelReq('/api/event-enrichment?id=ND-001');
    await fn(b.req, fakeRes());
    assert.equal(b.reads(), 0, '/api/event-enrichment read req.query');
  } finally { global.fetch = realFetch; }
});

test('no API file reads req.query directly', () => {
  const dir = path.join(ROOT, 'api');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f))
    .concat(fs.readdirSync(path.join(dir, '_lib')).filter(f => f.endsWith('.js')).map(f => path.join(dir, '_lib', f)));
  const bad = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/\breq\.query\b/.test(code)) bad.push(path.relative(ROOT, f));
    if (/\burl\.parse\s*\(|require\(['"](node:)?url['"]\)\.parse/.test(code)) bad.push(path.relative(ROOT, f) + ' (url.parse)');
  }
  assert.deepEqual(bad, []);
});

test('running the handlers raises no url.parse deprecation, even with pending deprecations on', () => {
  /* Node 22 raises DEP0169 only with --pending-deprecation; Node 24, which
     Vercel runs, raises it always. The child runs both handlers behind a
     getter that calls url.parse(), as Vercel's does. */
  const script = `
    const path = require('path'), url = require('url');
    const { makeFetch } = require(${JSON.stringify(path.join(__dirname, 'mock-upstreams.js'))});
    global.fetch = makeFetch({});
    const res = () => ({ status(){return this}, setHeader(){}, getHeader(){}, json(){return this}, send(){return this}, end(){return this} });
    const req = u => { const r = { method: 'GET', url: u, headers: {} };
      Object.defineProperty(r, 'query', { get() { return url.parse(u, true).query; } }); return r; };
    (async () => {
      await require(${JSON.stringify(path.join(ROOT, 'api', 'events.js'))})(req('/api/events?summary=1'), res());
      const e = require(${JSON.stringify(path.join(ROOT, 'api', 'event-enrichment.js'))});
      await (typeof e === 'function' ? e : e.default || e.handler)(req('/api/event-enrichment?id=ND-001'), res());
      console.log('done');
    })().catch(e => { console.error('failed: ' + e.message); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['--pending-deprecation', '-e', script], { encoding: 'utf8', timeout: 60000 });
  assert.match(r.stdout, /done/, r.stderr);
  assert.doesNotMatch(r.stderr, /DEP0169|url\.parse\(\)/, r.stderr);
});
