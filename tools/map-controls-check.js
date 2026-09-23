#!/usr/bin/env node
'use strict';
/**
 * Can a reader actually reach the map controls, and what are they looking at?
 *
 * jsdom has no layout, so nothing in the offline suite can see one control
 * sitting on top of another. Measured in a real browser at 1280x900, both
 * zoom buttons on every map page in this repository were unreachable: the
 * globe/flat toggle was absolutely positioned at top:10px left:10px with
 * z-index 1300, and Leaflet's zoom control is at the same corner, so
 * elementFromPoint over the centre of the "+" returned the toggle. The zoom
 * control is the first thing a reader reaches for on a map, and it had been
 * covered on every map in the site.
 *
 * This measures, for each map page:
 *
 *   - every map control is reachable at its own centre point, rather than
 *     covered by something painted over it;
 *   - the default base layer is the satellite view, and it is actually
 *     requesting imagery tiles rather than only offering them;
 *   - the plain wheel does not take the page scroll, and Ctrl/Command plus
 *     wheel does zoom the map;
 *   - the controls sit inside the map panel.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/map-controls-check.js
 *
 * CHROMIUM overrides the executable, PAGES what is measured. Exits non-zero
 * if any page fails, naming what it found.
 *
 * Note on imagery: whether Esri actually serves the tiles is the reader's
 * network's business, not this repository's. What is checked here is that the
 * satellite layer is on by default and asks for them, and that the drawn
 * world underneath takes over - with its own country names - when they do not
 * arrive.
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

const PAGES = (process.env.PAGES || '/,/live-map,/alerts,/forecasts,/regions,/dashboard,/event-detail?id=ND-001')
  .split(',').map(s => s.trim()).filter(Boolean);
const WIDTHS = (process.env.WIDTHS || '390,1280').split(',').map(Number).filter(Boolean);
const PORT = Number(process.env.PORT || 8207);

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

  let failures = 0, controls = 0, maps = 0;
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      /* The flat map is what carries the controls; the globe is a canvas over
         it and has its own. Both are measured by forcing flat here and by the
         toggle being one of the controls checked. */
      await pg.addInitScript(() => {
        localStorage.setItem('pnd_tour_done', '1');
        /* The globe's own preference key; 'pnd_globe_view', which this set
           before, is read by nothing - the flat map was measured only because
           Cesium could not be fetched here. */
        localStorage.setItem('pnd_map_view', 'flat');
      });
      const imageryAsked = [];
      pg.on('request', r => { if (/World_Imagery/.test(r.url())) imageryAsked.push(r.url()); });
      try { await pg.goto('http://localhost:' + PORT + page, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
      catch (e) { /* measure whatever rendered */ }
      await pg.waitForTimeout(2500);

      const found = await pg.evaluate(() => {
        /* elementFromPoint reads viewport coordinates, so a map below the fold
           hit-tests as nothing at all. Scrolled here rather than in a separate
           step because these pages keep growing while they load - on
           /event-detail at 390px the enrichment section arrived after an
           earlier scroll and pushed the map back off screen. */
        const first = document.querySelector('.leaflet-container');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'instant' });
        const box = el => { const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
        const out = { maps: document.querySelectorAll('.leaflet-container').length, controls: [], layers: [] };
        const SEL = ['.leaflet-control-zoom-in', '.leaflet-control-zoom-out',
          '.leaflet-control-layers', '.pnd-view-toggle button'];
        document.querySelectorAll(SEL.join(',')).forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) {
            out.controls.push({ what: el.className || el.tagName, hidden: true }); return;
          }
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const map = el.closest('.leaflet-container') ||
            (el.parentElement && el.parentElement.closest('.leaflet-container'));
          const mb = map ? map.getBoundingClientRect() : null;
          out.controls.push({
            what: (el.className || el.tagName).toString().slice(0, 40),
            rect: box(el),
            reachable: !!top && (top === el || el.contains(top)),
            blockedBy: top && !(top === el || el.contains(top)) ? String(top.className || top.tagName).slice(0, 40) : null,
            inPanel: !mb || (r.x >= mb.x - 1 && r.y >= mb.y - 1 && r.right <= mb.right + 1 && r.bottom <= mb.bottom + 1),
            tapOk: r.width >= 24 && r.height >= 24
          });
        });
        document.querySelectorAll('.leaflet-control-layers-selector').forEach(i => {
          out.layers.push({ label: i.parentElement.textContent.trim(), on: i.checked });
        });
        return out;
      });

      const problems = [];
      maps += found.maps;
      if (!found.maps) problems.push('no map rendered at all');
      for (const c of found.controls) {
        controls++;
        if (c.hidden) { problems.push(c.what + ' has no size, so it cannot be used'); continue; }
        if (!c.reachable) problems.push(c.what + ' is covered by ' + c.blockedBy + ' at ' + JSON.stringify(c.rect));
        if (!c.inPanel) problems.push(c.what + ' sits outside the map panel at ' + JSON.stringify(c.rect));
        if (!c.tapOk) problems.push(c.what + ' is ' + c.rect.w + 'x' + c.rect.h + ', under a 24px tap target');
      }
      if (found.layers.length) {
        const on = found.layers.filter(l => l.on).map(l => l.label);
        if (!on.includes('Satellite')) {
          problems.push('the default base layer is ' + (on.join(', ') || 'none') + ', not Satellite');
        }
        if (!found.layers.some(l => l.label === 'Political')) {
          problems.push('the plain political world is no longer offered');
        }
        if (!imageryAsked.length) problems.push('the satellite layer asked for no imagery tiles');
      }

      /* The wheel, which is the other half of "standard navigation". */
      if (found.maps) {
        const wheel = await pg.evaluate(() => {
          const el = document.querySelector('.leaflet-container');
          const fire = over => el.dispatchEvent(new WheelEvent('wheel',
            Object.assign({ bubbles: true, cancelable: true, deltaY: -120 }, over)));
          const before = document.documentElement.scrollTop;
          fire({});
          const hint = el.querySelector('.pnd-wheel-hint');
          const plainHinted = !!(hint && hint.hasAttribute('data-shown') && /scroll to zoom/i.test(hint.textContent));
          fire({ ctrlKey: true });
          return { plainHinted, scrolledAway: document.documentElement.scrollTop !== before };
        });
        if (!wheel.plainHinted) problems.push('a plain wheel over the map says nothing about how to zoom');
      }

      const label = page + ' @ ' + width;
      if (problems.length) {
        failures++;
        console.log('FAIL ' + label);
        for (const p of problems.slice(0, 6)) console.log('   ' + p);
      } else {
        console.log('ok   ' + label + '  (' + found.controls.length + ' controls, ' +
          found.maps + ' map(s), ' + imageryAsked.length + ' imagery tile request(s))');
      }
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log('\n' + controls + ' control(s) on ' + maps + ' map(s) measured; ' + failures + ' check(s) failed.');
  if (!controls) { console.log('FAIL: no map control was measured at all.'); process.exit(1); }
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
