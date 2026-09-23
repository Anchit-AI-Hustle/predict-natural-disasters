#!/usr/bin/env node
'use strict';
/**
 * Which satellite picture is on screen, how old it is, and whether the map
 * says so - measured in a real browser, in both views.
 *
 * jsdom has no layout, no tiles and no WebGL, so nothing in the offline suite
 * can see which imagery a reader is actually looking at. This loads the real
 * pages in Chromium and answers every tile host itself - NASA's daily imagery
 * in green, Esri's detailed mosaic in magenta - so the colour of the rendered
 * pixels says which picture reached the screen, rather than a layer's
 * configuration being taken to imply it. It then checks, per view:
 *
 *   - zoomed out, the picture is NASA's latest complete day, requested for
 *     the right date and never past the zoom it exists at;
 *   - zoomed in, it is the detailed mosaic, and the caption says that mosaic
 *     is not the scene now;
 *   - when NASA's host refuses every tile, the mosaic takes over and the
 *     caption says NASA's picture did not load - it never passes for today's;
 *   - on the Political view there is no photograph and no caption about one.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     CESIUM_BUILD=/path/to/cesium/Build/Cesium node tools/imagery-check.js
 *
 * CHROMIUM overrides the executable. Without CESIUM_BUILD the globe half is
 * skipped and says so. Exits non-zero if anything fails.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.SITE_ROOT || process.cwd();
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const CESIUM = process.env.CESIUM_BUILD || '';
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));
const PORT = Number(process.env.PORT || 8211);
const PAGE = process.env.PAGE || '/live-map';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.xml': 'text/xml', '.glb': 'model/gltf-binary' };

/* A solid 256x256 PNG, built here so no binary lives in the repository. */
function solidPng(r, g, b, a) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  const alpha = a !== undefined;
  const px = alpha ? [r, g, b, a] : [r, g, b];
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(256 * px.length).map((_, i) => px[i % px.length])]);
  const raw = Buffer.concat(Array.from({ length: 256 }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const GREEN = solidPng(0, 200, 0);      // NASA daily
const MAGENTA = solidPng(220, 0, 220);  // Esri detailed mosaic
/* The place-name layer is answered fully transparent. The 1x1 PNG this used
   first is the one every snippet copies, and it is not clear: it is a teal
   pixel, and stretched over the label layer it painted the whole map teal. */
const CLEAR = solidPng(0, 0, 0, 0);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    const realFetch = global.fetch; global.fetch = makeFetch({});
    const out = {};
    const fake = { status() { return fake; }, setHeader() {}, json(b) { out.b = b; }, end() {} };
    try { await eventsHandler({ query: {}, url: req.url, method: 'GET', headers: {} }, fake); }
    catch (e) { out.b = { events: [], meta: {} }; } finally { global.fetch = realFetch; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.b || { events: [], meta: {} })); return;
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

async function open(browser, { view, nasaDown }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const seen = { nasa: [], esri: [], errors: [] };
  page.on('pageerror', e => seen.errors.push(String(e)));
  await page.addInitScript(v => {
    localStorage.setItem('pnd_tour_done', '1');
    /* The globe's own preference key. The first version of this set
       'pnd_globe_view', which nothing reads - so with WebGL available the
       "flat" run was the globe, and every flat-map check measured it. */
    localStorage.setItem('pnd_map_view', v);
  }, view);
  await page.route(/gibs-?[abc]?\.earthdata\.nasa\.gov/, r => {
    seen.nasa.push(r.request().url());
    if (nasaDown) return r.abort('connectionrefused');
    r.fulfill({ status: 200, contentType: 'image/png', body: GREEN });
  });
  await page.route(/server\.arcgisonline\.com/, r => {
    seen.esri.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'image/png', body: MAGENTA });
  });
  await page.route(/services\.arcgisonline\.com/, r => r.fulfill({ status: 200, contentType: 'image/png', body: CLEAR }));
  await page.route(/terrain\.reearth\.land/, r => r.abort());
  await page.route(/unpkg\.com\/cesium@/, r => {
    if (!CESIUM) return r.abort();
    const rel = r.request().url().split('/Build/Cesium/')[1].split('?')[0];
    const f = path.join(CESIUM, rel);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto('http://localhost:' + PORT + PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return { ctx, page, seen };
}

const caption = page => page.evaluate(() => {
  const n = document.querySelector('.pnd-imagery-note');
  return n ? { hidden: n.hidden, source: n.getAttribute('data-source'), text: n.textContent } : null;
});
/* The colour a reader sees across the map panel, as rendered: a grid of
   points sampled from a screenshot, and the colour most of them agree on -
   so a marker, a tile seam or a country outline under one point cannot
   decide the answer. Returned with the samples, so a failure says what was
   actually on screen. */
async function screenColour(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return { verdict: null, samples: [] };
  await el.scrollIntoViewIfNeeded().catch(() => {});
  /* An element screenshot waits for the element to be still, which a WebGL
     globe never is; a viewport clip of the same rectangle does not wait. */
  let shot = await el.screenshot({ timeout: 5000 }).catch(() => null);
  if (!shot) {
    const r = await el.evaluate(n => { const b = n.getBoundingClientRect();
      return { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, innerWidth), height: Math.min(b.height, innerHeight - Math.max(0, b.y)) }; });
    if (r.width > 10 && r.height > 10) shot = await page.screenshot({ clip: r }).catch(() => null);
  }
  if (!shot) return { verdict: null, samples: [] };
  const samples = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const out = [];
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
      const d = g.getImageData(Math.round(img.width * i / 6), Math.round(img.height * j / 6), 1, 1).data;
      out.push([d[0], d[1], d[2]]);
    }
    return out;
  }, shot.toString('base64'));
  const green = samples.filter(c => looks(c, 'green')).length;
  const magenta = samples.filter(c => looks(c, 'magenta')).length;
  /* The right picture present and the wrong one absent. Not a majority: at
     world view the planet covers under half the panel on both the flat map
     and the globe, and the rest is space or ocean beyond the Mercator edge. */
  const verdict = green >= 5 && !magenta ? 'green' : magenta >= 5 && !green ? 'magenta' : 'neither';
  return { verdict, samples, green, magenta };
}
const shows = async (page, selector, want) => {
  const r = await screenColour(page, selector);
  const ok = r.verdict === want;
  if (!ok) console.log('         on screen: ' + r.green + '/25 green, ' + r.magenta + '/25 magenta; e.g. ' +
    JSON.stringify(r.samples.slice(10, 13)));
  return ok;
};
const looks = (rgb, want) => rgb && (want === 'green' ? rgb[1] > 150 && rgb[0] < 90 && rgb[2] < 90
  : rgb[0] > 150 && rgb[2] > 150 && rgb[1] < 90);
const zoomOf = u => Number((u.match(/GoogleMapsCompatible_Level9\/(\d+)\//) || u.match(/\/tile\/(\d+)\//) || [])[1]);
const dayOf = u => (u.match(/\/default\/(\d{4}-\d{2}-\d{2})\//) || [])[1];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}));
  const expectDay = new Date(Date.now() - 28 * 3600e3).toISOString().slice(0, 10);
  const fails = [];
  const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); };

  /* ------------------------------------------------------------ flat map */
  console.log('flat map, ' + PAGE + ', NASA answering');
  {
    const { ctx, page, seen } = await open(browser, { view: 'flat', nasaDown: false });
    await page.waitForTimeout(3000);
    let cap = await caption(page);
    check(seen.nasa.length > 0, 'NASA daily imagery was requested (' + seen.nasa.length + ' tiles)');
    check(seen.nasa.every(u => dayOf(u) === expectDay), 'every NASA tile is for ' + expectDay + ', the latest complete day');
    check(seen.nasa.every(u => zoomOf(u) <= 9), 'no NASA tile past zoom 9, where it stops existing');
    check(seen.esri.length === 0, 'the detailed mosaic was not fetched while it is not shown (' + seen.esri.length + ')');
    check(cap && !cap.hidden && cap.source === 'daily', 'the caption says the daily picture is showing');
    check(cap && cap.text.includes(new Date(expectDay + 'T00:00:00Z').getUTCDate() + ' '), 'the caption names the day: ' + (cap && cap.text));
    check(await shows(page, '.leaflet-container', 'green'), 'the pixels on screen are the daily picture');

    const trace = [];
    for (let i = 0; i < 14; i++) {
      cap = await caption(page);
      trace.push(await page.evaluate(() => (typeof map !== 'undefined' && map.getZoom
        ? Math.round(map.getZoom() * 10) / 10 : '?')) + ':' + (cap && cap.source));
      if (cap && cap.source === 'detail') break;
      /* A reader's click on the zoom button, with a short timeout that says
         what is in the way rather than waiting out thirty seconds a time. */
      /* Driven through the DOM: whether a reader can reach this button is
         tools/map-controls-check.js's question, measured by hit-testing. This
         only needs the map to zoom the way that button zooms it. */
      const ok = await page.evaluate(() => {
        const b = document.querySelector('.leaflet-control-zoom-in');
        if (!b) return false; b.click(); return true;
      });
      if (!ok) { console.log('         no zoom button'); break; }
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(1500);
    cap = await caption(page);
    console.log('         zoom:caption ' + trace.join(' '));
    check(cap && cap.source === 'detail', 'zoomed in, the caption switches to the detailed mosaic (' + JSON.stringify(cap) + ', zoom ' + Math.max(0, ...seen.nasa.concat(seen.esri).map(zoomOf).filter(Number.isFinite)) + ')');
    check(cap && /not the scene now/.test(cap.text), 'and says the mosaic is not the scene now');
    check(seen.esri.length > 0 && seen.esri.every(u => zoomOf(u) >= 10), 'the mosaic is fetched from zoom 10 only');
    check(await shows(page, '.leaflet-container', 'magenta'), 'the pixels on screen are now the mosaic');

    await page.evaluate(() => {
      const r = [...document.querySelectorAll('.leaflet-control-layers-selector')]
        .find(i => /Political/.test(i.parentElement.textContent));
      if (r) r.click();
    });
    await page.waitForTimeout(600);
    cap = await caption(page);
    check(cap && cap.hidden, 'on the Political view there is no caption about a photograph (' + JSON.stringify(cap) + ')');
    check(seen.errors.length === 0, 'no page errors (' + seen.errors.join(' | ') + ')');
    await ctx.close();
  }

  console.log('flat map, ' + PAGE + ', NASA refused');
  {
    const { ctx, page, seen } = await open(browser, { view: 'flat', nasaDown: true });
    await page.waitForTimeout(4000);
    const cap = await caption(page);
    check(cap && cap.source === 'fallback', 'the caption says NASA’s picture did not load');
    check(cap && /not the scene now/.test(cap.text), 'and that what is shown is not the scene now');
    check(seen.esri.some(u => zoomOf(u) <= 9), 'the mosaic stands in at the zooms NASA would have covered');
    check(await shows(page, '.leaflet-container', 'magenta'), 'the pixels on screen are the stand-in mosaic');
    check(seen.errors.length === 0, 'no page errors (' + seen.errors.join(' | ') + ')');
    await ctx.close();
  }

  /* --------------------------------------------------------------- globe */
  if (!CESIUM) {
    console.log('globe: skipped - set CESIUM_BUILD to a local Cesium Build/Cesium directory');
  } else {
    const ready = page => page.waitForFunction(() => {
      const h = document.querySelector('.pnd-globe');
      return h && h.__pndViewer && getComputedStyle(h).display !== 'none';
    }, null, { timeout: 45000 }).then(() => true, () => false);

    console.log('globe (the default view), ' + PAGE + ', NASA answering');
    {
      const { ctx, page, seen } = await open(browser, { view: 'globe', nasaDown: false });
      check(await ready(page), 'the globe came up');
      await page.waitForTimeout(6000);
      let cap = await caption(page);
      check(cap && !cap.hidden && cap.source === 'daily', 'the caption says the daily picture is showing (' + (cap && cap.source) + ')');
      check(seen.nasa.length > 0 && seen.nasa.every(u => dayOf(u) === expectDay), 'NASA tiles requested for ' + expectDay + ' (' + seen.nasa.length + ')');
      check(await shows(page, '.pnd-globe', 'green'), 'the globe is draped in the daily picture');
      const esriHigh = seen.esri.length;

      await page.evaluate(() => {
        const v = document.querySelector('.pnd-globe').__pndViewer, C = window.Cesium;
        v.camera.setView({ destination: C.Cartesian3.fromDegrees(85.3, 27.7, 60000) });
      });
      await page.waitForTimeout(6000);
      cap = await caption(page);
      check(cap && cap.source === 'detail', 'close in, the caption switches to the mosaic (' + (cap && cap.source) + ')');
      check(seen.esri.length > esriHigh, 'the mosaic is fetched once it is shown (' + esriHigh + ' -> ' + seen.esri.length + ')');
      check(await shows(page, '.pnd-globe', 'magenta'), 'the globe is draped in the mosaic close in');
      check(seen.errors.length === 0, 'no page errors (' + seen.errors.join(' | ') + ')');
      await ctx.close();
    }

    console.log('globe, ' + PAGE + ', NASA refused');
    {
      const { ctx, page, seen } = await open(browser, { view: 'globe', nasaDown: true });
      check(await ready(page), 'the globe came up');
      await page.waitForTimeout(8000);
      const cap = await caption(page);
      check(cap && cap.source === 'fallback', 'the caption says NASA’s picture did not load (' + (cap && cap.source) + ')');
      check(await shows(page, '.pnd-globe', 'magenta'), 'the mosaic stands in on the globe');
      check(seen.errors.length === 0, 'no page errors (' + seen.errors.join(' | ') + ')');
      await ctx.close();
    }
  }

  await browser.close(); server.close();
  console.log('\n' + (fails.length ? fails.length + ' check(s) failed.' : 'all checks passed.'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
