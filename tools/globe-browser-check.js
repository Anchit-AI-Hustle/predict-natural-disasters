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
 * hand when the globe changes.
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

  await page.goto('http://localhost:8099/live-map', { waitUntil: 'load', timeout: 60000 });

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  console.log('real WebGL available      :', webgl);

  await page.waitForFunction(() => window.Cesium !== undefined, { timeout: 60000 })
    .then(() => console.log('real Cesium loaded        : true'))
    .catch(() => console.log('real Cesium loaded        : FALSE (timed out)'));

  console.log('Cesium version            :', await page.evaluate(() => window.Cesium && Cesium.VERSION));

  await page.waitForTimeout(9000);

  const diag = await page.evaluate(async () => {
    const r = await fetch('/api/events');
    const d = await r.json();
    return { apiOk: r.status, events: (d.events||[]).length,
      statusLine: (document.getElementById('statusLine')||{}).textContent,
      cards: document.querySelectorAll('#cards .event-card').length };
  });
  console.log('--- page data ---');
  for (const [k,v] of Object.entries(diag)) console.log('  ' + k.padEnd(24) + ':', v);

  const result = await page.evaluate(() => {
    const host = document.querySelector('.pnd-globe');
    const canvas = host && host.querySelector('canvas');
    const out = {
      hostPresent: !!host,
      hostVisible: host ? getComputedStyle(host).display !== 'none' : false,
      canvasPresent: !!canvas,
      canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
      togglePresent: !!document.querySelector('.pnd-view-toggle'),
      leafletMarkers: 0, globeEntities: null
    };
    /* Real Leaflet has no global registry of maps, so the markers are counted
       from what it actually rendered: a circleMarker is an SVG path. */
    out.leafletMarkers = document.querySelectorAll('#map path.leaflet-interactive').length;
    const viewer = host && host.__pndViewer;
    out.globeEntities = viewer ? viewer.entities.values.length : null;
    out.globeHasImagery = viewer ? viewer.imageryLayers.length : null;
    if (viewer && viewer.entities.values.length) {
      const e = viewer.entities.values[0];
      const c = Cesium.Cartographic.fromCartesian(e.position.getValue(Cesium.JulianDate.now()));
      out.firstEntityLatLon =
        (Cesium.Math.toDegrees(c.latitude)).toFixed(3) + ',' +
        (Cesium.Math.toDegrees(c.longitude)).toFixed(3);
      out.firstEntityHasPopup = !!e.description;
    }
    return out;
  });
  for (const [k, v] of Object.entries(result)) console.log('  ' + k.padEnd(24) + ':', v);
  console.log('page errors               :', errors.length ? errors.slice(0,3) : 'none');
  console.log('intercepted               :', hits.length, hits.slice(0,6));

  /* The toggle, in a real browser: Flat must hide the globe and Globe bring
     it back, because that is the fallback every other claim rests on. */
  await page.screenshot({ path: 'globe-on.png' });
  await page.click('.pnd-view-toggle button:nth-child(2)');
  await page.waitForTimeout(700);
  const afterFlat = await page.evaluate(() => {
    const h = document.querySelector('.pnd-globe');
    return { globeHidden: getComputedStyle(h).display === 'none',
      leafletStillThere: document.querySelectorAll('#map path.leaflet-interactive').length };
  });
  const boxes = await page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect();
      return Math.round(b.width) + 'x' + Math.round(b.height); };
    const hosts = [...document.querySelectorAll('.pnd-globe')];
    const host = hosts[0];
    const canvas = host && host.querySelector('canvas');
    const mapEl = document.getElementById('map');
    return { hostCount: hosts.length,
      hostDisplay: host ? getComputedStyle(host).display : null,
      hostOffset: host ? host.offsetWidth + 'x' + host.offsetHeight : null,
      mapPosition: mapEl ? getComputedStyle(mapEl).position : null,
      canvasCount: host ? host.querySelectorAll('canvas').length : 0,
      mapDiv: r(mapEl), host: r(host),
      canvasBox: r(canvas),
      canvasAttr: canvas ? canvas.width + 'x' + canvas.height : null,
      dpr: window.devicePixelRatio,
      panel: r(document.querySelector('#map') ? document.querySelector('#map').parentElement : null) };
  });
  console.log('--- geometry ---');
  for (const [k,v] of Object.entries(boxes)) console.log('  ' + k.padEnd(24) + ':', v);

  console.log('--- pressing Flat ---');
  for (const [k,v] of Object.entries(afterFlat)) console.log('  ' + k.padEnd(24) + ':', v);
  await page.screenshot({ path: 'flat.png' });
  await page.click('.pnd-view-toggle button:nth-child(1)');
  await page.waitForTimeout(700);
  const backToGlobe = await page.evaluate(() => {
    const h = document.querySelector('.pnd-globe');
    return { globeVisibleAgain: getComputedStyle(h).display !== 'none',
      entitiesStillPlotted: h.__pndViewer ? h.__pndViewer.entities.values.length : null };
  });
  console.log('--- pressing Globe again ---');
  for (const [k,v] of Object.entries(backToGlobe)) console.log('  ' + k.padEnd(24) + ':', v);
  await page.screenshot({ path: 'globe.png', fullPage: false });
  console.log('screenshot                : globe.png');
  await browser.close();
  server.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
