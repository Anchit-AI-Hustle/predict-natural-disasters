#!/usr/bin/env node
/*
 * The globe in a real browser, which nothing else here can do.
 *
 * The test suite stubs Cesium and WebGL, because jsdom has neither. That is
 * enough to check the wiring and nothing else — and it is how a guard that
 * emptied the globe of every hazard shipped with three green tests. This runs
 * the actual page in real Chromium, with real WebGL and the real published
 * CesiumJS, and asks the page what it ended up with.
 *
 * It is deliberately not part of `npm test`: it needs Playwright and a
 * twenty-megabyte Cesium download, which have no business in CI. Run it by
 * hand when the globe changes. It sweeps every map page (override with PAGES=)
 * and exits non-zero if any of them fails, so a wrapper cannot read it as green.
 *
 *   mkdir -p /tmp/gc && cd /tmp/gc && npm init -y
 *   npm install playwright@1.49.1 leaflet@1.9.4
 *   npm pack cesium@1.124.0 && tar -xzf cesium-1.124.0.tgz package/Build/Cesium
 *   CESIUM_BUILD=$PWD/package/Build/Cesium LEAFLET_DIST=$PWD/node_modules/leaflet/dist \
 *     node /path/to/repo/tools/globe-browser-check.js
 *
 * unpkg is unreachable from this environment, so the two CDN libraries the
 * pages load are intercepted and fulfilled from those local copies. Esri
 * imagery and Re:Earth terrain are deliberately left to fail: the globe is
 * supposed to survive without them, and this proves it does.
 *
 * What it found on its first run: Leaflet's .leaflet-top/.leaflet-bottom sit
 * at z-index 1000, above the globe's 900, so the zoom and layers controls
 * floated over the globe. The unit test had asserted only "above the panes",
 * whose highest is 800.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, '..');
const CESIUM = process.env.CESIUM_BUILD;
const LEAFLET = process.env.LEAFLET_DIST;
if (!CESIUM || !LEAFLET) {
  console.error('set CESIUM_BUILD and LEAFLET_DIST — see the header of this file');
  process.exit(2);
}
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.woff2':'font/woff2', '.wasm':'application/wasm', '.glb':'model/gltf-binary' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);

  if (p.startsWith('/api/events')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = { statusCode: 200, headers: {}, body: null };
    const fake = { status(c){ out.statusCode=c; return fake; },
      setHeader(k,v){ out.headers[k]=v; }, json(b){ out.body=b; }, end(){} };
    try {
      const q = {}; url.searchParams.forEach((v,k)=>q[k]=v);
      await eventsHandler({ query:q, url:req.url, method:'GET', headers:{} }, fake);
    } finally { global.fetch = realFetch; }
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify(out.body));
    return;
  }
  if (p === '/' ) p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream'});
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  /* unpkg is blocked here, so the two CDN libraries are fulfilled from the
     real published packages instead of being faked. */
  const hits = [];
  await page.route(/unpkg\.com\/cesium@/, route => {
    hits.push('cesium: ' + route.request().url().split('/Build/Cesium/')[1]);
    const rel = route.request().url().split('/Build/Cesium/')[1].split('?')[0];
    const f = path.join(CESIUM, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200,
      contentType: TYPES[path.extname(f)] || 'application/octet-stream',
      body: fs.readFileSync(f) });
  });
  await page.route(/unpkg\.com\/leaflet@/, route => {
    hits.push('leaflet: ' + route.request().url().split('/dist/')[1]);
    const u = route.request().url();
    const f = path.join(LEAFLET, u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js');
    route.fulfill({ status: 200,
      contentType: u.endsWith('.css') ? 'text/css' : 'text/javascript',
      body: fs.readFileSync(f) });
  });
  /* Esri imagery and Re:Earth terrain are also blocked; the globe is supposed
     to survive without them, so they are failed rather than faked. */
  await page.route(/services\.arcgisonline\.com/, r => r.abort());
  await page.route(/terrain\.reearth\.land/, r => r.abort());

  /* Every map page that stands on its own, not just the one I happened to
     develop against. The globe is wired in at one shared call, but each page
     draws its own markers, and this branch's repeated failure has been fixing
     one case and missing its twin. */
  const PAGES = (process.env.PAGES || 'live-map,index,forecasts,alerts,regions,home-v3,dashboard,home,home-v2')
    .split(',').map(s => s.trim()).filter(Boolean);

  let failures = 0;
  for (const name of PAGES) {
    errors.length = 0;
    await page.goto('http://localhost:8099/' + name, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.Cesium !== undefined, { timeout: 60000 })
      .catch(() => {});
    /* Long enough for the feed, the page's own draw, and the globe's debounced
       mirror to settle. */
    await page.waitForTimeout(7000);

    const r = await page.evaluate(() => {
      const host = document.querySelector('.pnd-globe');
      const viewer = host && host.__pndViewer;
      const canvas = host && host.querySelector('canvas');
      const leaflet = document.querySelectorAll('.leaflet-container path.leaflet-interactive').length;
      const controls = [...document.querySelectorAll('.leaflet-control-container')];
      return {
        cesium: !!window.Cesium,
        host: !!host,
        visible: host ? getComputedStyle(host).display !== 'none' : false,
        canvas: canvas ? canvas.width + 'x' + canvas.height : null,
        toggle: !!document.querySelector('.pnd-view-toggle'),
        leafletMarkers: leaflet,
        entities: viewer ? viewer.entities.values.length : null,
        controlsHidden: controls.length
          ? controls.every(c => getComputedStyle(c).display === 'none') : 'n/a'
      };
    });

    /* The globe must exist, be visible, carry a way back to the flat map, keep
       Leaflet's own controls out of the way, and agree with the flat map about
       how many hazards there are. A page that drew nothing is reported, not
       silently passed. */
    const ok = r.cesium && r.host && r.visible && r.canvas && r.toggle &&
      (r.controlsHidden === true || r.controlsHidden === 'n/a') &&
      r.leafletMarkers > 0 && r.entities === r.leafletMarkers;
    if (!ok || errors.length) failures++;
    console.log(
      (ok && !errors.length ? '  ok   ' : '  FAIL ') + name.padEnd(12) +
      ' cesium=' + r.cesium + ' host=' + r.host + ' visible=' + r.visible +
      ' canvas=' + r.canvas + ' markers=' + r.leafletMarkers +
      ' entities=' + r.entities + ' toggle=' + r.toggle +
      ' controlsHidden=' + r.controlsHidden +
      (errors.length ? ' ERRORS=' + JSON.stringify(errors.slice(0, 2)) : ''));
    await page.screenshot({ path: 'globe-' + name + '.png' });
  }

  /* The toggle, in a real browser, on the first page swept: Flat must hide the
     globe without taking the flat map's markers with it, and Globe must bring
     it back with its hazards still plotted. Every other claim above rests on
     that fallback existing, so it is exercised rather than assumed. */
  await page.goto('http://localhost:8099/' + PAGES[0], { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.click('.pnd-view-toggle button:nth-child(2)');
  await page.waitForTimeout(700);
  const flat = await page.evaluate(() => {
    const h = document.querySelector('.pnd-globe');
    return { globeHidden: getComputedStyle(h).display === 'none',
      markers: document.querySelectorAll('.leaflet-container path.leaflet-interactive').length };
  });
  await page.click('.pnd-view-toggle button:nth-child(1)');
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => {
    const h = document.querySelector('.pnd-globe');
    return { globeVisible: getComputedStyle(h).display !== 'none',
      entities: h.__pndViewer ? h.__pndViewer.entities.values.length : null };
  });
  const toggleOk = flat.globeHidden && flat.markers > 0 &&
    back.globeVisible && back.entities > 0;
  if (!toggleOk) failures++;
  console.log((toggleOk ? '  ok   ' : '  FAIL ') + 'toggle'.padEnd(12) +
    ' flatHidesGlobe=' + flat.globeHidden + ' flatKeepsMarkers=' + flat.markers +
    ' globeReturns=' + back.globeVisible + ' entitiesKept=' + back.entities);

  console.log('\npages checked: ' + PAGES.length + ', failing: ' + failures);

  await browser.close();
  server.close();
  /* A checker that reports failures and exits 0 is worse than no checker: it
     reads as green to anything wrapping it. */
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
