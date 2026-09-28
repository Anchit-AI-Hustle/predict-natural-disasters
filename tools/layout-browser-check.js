#!/usr/bin/env node
'use strict';
/**
 * Does any page scroll sideways?
 *
 * jsdom has no layout engine — every rectangle it reports is zero — so the
 * offline suite cannot answer this, and for a long time nothing did. Measured
 * in a real browser, every page in this repository overflowed its viewport
 * somewhere: 252px on /alerts and /forecasts at 360px, 230px on the homepage
 * at 1280px. Three separate causes, none of which any test could see:
 *
 *   - the header was a non-wrapping flex row, so the timezone picker and the
 *     Live chip were simply pushed off the right edge;
 *   - a grid item will not shrink below its content, and .map asks for a
 *     600px minimum (width:100% with aspect-ratio 2/1 and a 300px height
 *     floor cannot be narrower than twice that floor), so one panel holding a
 *     map dragged its whole column to 602px on a 390px phone;
 *   - and the two other copies of the header, in app-pages.css and in
 *     index.html's own stylesheet, had the same defect as the first.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/layout-browser-check.js
 *
 * CHROMIUM overrides the executable. PAGES and WIDTHS override what is
 * measured. Exits non-zero if any page overflows at any width, naming the
 * element whose right edge is furthest past it.
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

const PAGES = (process.env.PAGES ||
  '/,/alerts,/live-map,/forecasts,/personal-risk,/accuracy,/events,/regions,/methodology,/about,/insights,/calamities,/dashboard,/hazard-types,/official-warnings,/resources,/historical-events,/compare-locations,/forecast-calendar,/alerts-notifications,/recent-events'
).split(',').map(s => s.trim()).filter(Boolean);
/* Handsets, a tablet and two desktops. The homepage only ever overflowed at
   the desktop widths and /alerts only at the handset widths, so a sweep that
   stops at either end reports a clean bill of health it has not earned. */
const WIDTHS = (process.env.WIDTHS || '360,390,430,768,1024,1280')
  .split(',').map(Number).filter(Boolean);
const PORT = Number(process.env.PORT || 8188);

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

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));

  let failures = 0, checked = 0;
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      try { await pg.goto('http://localhost:' + PORT + page, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
      catch (e) { /* measure whatever rendered */ }
      await pg.waitForTimeout(700);

      const result = await pg.evaluate(w => {
        const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        if (over <= 0) return { over };
        let worst = null;
        document.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect();
          /* An element inside its own scroll container is clipped, not
             spilling onto the page: the accuracy ledger is a 960px table in
             an overflow:auto wrapper and is not this page's problem. */
          let clipped = false;
          for (let a = el.parentElement; a; a = a.parentElement) {
            const ov = getComputedStyle(a).overflowX;
            if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { clipped = true; break; }
          }
          if (clipped || r.width <= 0 || r.right <= w + 1) return;
          if (!worst || r.right > worst.right) {
            worst = { right: Math.round(r.right),
              what: el.tagName + (el.id ? '#' + el.id : '') +
                (el.className ? '.' + String(el.className).split(' ')[0] : '') };
          }
        });
        return { over, worst };
      }, width);
      await ctx.close();

      checked++;
      const label = (page + ' @ ' + width).padEnd(30);
      if (result.over > 0) {
        failures++;
        console.log('  FAIL ' + label + result.over + 'px of sideways scroll' +
          (result.worst ? ' — furthest out: ' + result.worst.what : ''));
      } else {
        console.log('  ok   ' + label + 'no sideways scroll');
      }
    }
  }

  console.log('\nchecks: ' + checked + ' page/width combinations, failing: ' + failures);
  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAILED: ' + (e && e.message || e)); process.exit(2); });
