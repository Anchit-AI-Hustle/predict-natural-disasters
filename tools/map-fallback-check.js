#!/usr/bin/env node
'use strict';
/**
 * Does a page still work when the map library does not arrive?
 *
 * Every map page's script begins `const map = L.map('map')`, so a library
 * that fails to load throws on the first statement and everything after it
 * never runs. Measured here with that request blocked, before the fix:
 *
 *     /alerts       5 records shown, stuck on "Loading…"   (25 with the library)
 *     /forecasts    6 records shown, stuck on "Loading…"   (31 with the library)
 *
 * The library is served from this origin now rather than a CDN, and
 * map-setup.js stands in for one that still fails to arrive. This measures
 * both halves: the page renders the same records either way, and when the
 * library is missing the map panel says so rather than sitting empty.
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/map-fallback-check.js
 *
 * Exits non-zero if blocking the library costs a page any of its records, or
 * if a blocked page does not say the map is unavailable.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.SITE_ROOT || process.cwd();
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = (process.env.PAGES || '/,/alerts,/live-map,/forecasts,/regions,/dashboard')
  .split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8193);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = {};
    const fake = { status() { return fake; }, setHeader() {}, json(b) { out.b = b; }, end() {} };
    try { await eventsHandler({ query: {}, url: req.url, method: 'GET', headers: {} }, fake); }
    catch (e) { out.b = { events: [], meta: {} }; }
    finally { global.fetch = realFetch; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.b || { events: [], meta: {} }));
    return;
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const measure = () => ({
  records: document.querySelectorAll('.card,.row,tbody tr,.item,article').length,
  maps: document.querySelectorAll('.leaflet-container').length,
  stuck: /Loading…/.test(document.body.innerText),
  notice: (document.querySelector('[data-map-unavailable]') || {}).textContent || ''
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));

  const run = async (page, blocked) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => localStorage.setItem('pnd_tour_done', '1'));
    const errors = [];
    pg.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await pg.route(u => /\/vendor\/leaflet\//.test(u.href), r => blocked ? r.abort() : r.continue());
    try { await pg.goto('http://localhost:' + PORT + page, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch (e) { errors.push('navigation: ' + e.message); }
    await pg.waitForTimeout(1500);
    const m = await pg.evaluate(measure);
    await ctx.close();
    return Object.assign(m, { errors: errors });
  };

  let failures = 0;
  for (const page of PAGES) {
    const withLib = await run(page, false);
    const without = await run(page, true);
    const problems = [];
    if (without.records < withLib.records) {
      problems.push('shows ' + without.records + ' of its ' + withLib.records + ' records without the map library');
    }
    if (without.stuck && !withLib.stuck) problems.push('is stuck on "Loading…" without the map library');
    if (!/could not be loaded/i.test(without.notice)) problems.push('does not say the map is unavailable');
    if (without.errors.length) problems.push('threw: ' + without.errors[0]);
    if (withLib.maps < 1) problems.push('has no map even when the library loads');
    if (problems.length) {
      failures++;
      console.log('FAIL ' + page);
      for (const p of problems) console.log('       ' + p);
    } else {
      console.log('  ok ' + page.padEnd(12) + ' ' + withLib.records + ' records with the library, ' +
        without.records + ' without, and it says why the map is missing');
    }
  }

  await browser.close();
  server.close();
  console.log('\npages checked: ' + PAGES.length + ', failing: ' + failures);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
