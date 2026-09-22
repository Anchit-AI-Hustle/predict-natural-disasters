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
 * Set CHROMIUM=/path/to/chrome if Playwright's own browser download was skipped.
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
  /* Playwright finds its own browser; CHROMIUM overrides that where the
     download was skipped and one is installed elsewhere. Pinning this
     environment's path broke the standalone workflow in the header above. */
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
             '--ignore-gpu-blocklist', '--enable-webgl'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));
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

  /* Every map page, not just the one I happened to develop against. The globe
     is wired in at one shared call, but each page draws its own markers, and
     this branch's repeated failure has been fixing one case and missing its
     twin. The seven detail pages need a real subject, so they are keyed off an
     event the feed actually returned rather than an id invented here. */
  const feed = await (await fetch('http://localhost:8099/api/events')).json();
  const events = feed.events || [];
  const pick = f => events.find(f);
  const any = pick(e => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.country);
  const fc = pick(e => e.forecastKind || e.targetStart) || any;
  if (!any) { console.error('the feed returned nothing to key the detail pages on'); process.exit(2); }
  const q = o => Object.entries(o)
    .map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&');

  const STANDALONE = 'live-map,index,forecasts,alerts,regions,home-v3,dashboard,home,home-v2';
  const DETAIL = [
    ['event-detail',    q({ id: any.id })],
    ['alert-detail',    q({ id: any.id })],
    ['calamity-detail', q({ id: any.id })],
    ['forecast-detail', q({ id: fc.id })],
    ['hazard-detail',   q({ type: any.type, region: any.country })],
    ['location-detail', q({ location: any.region || any.country })],
    ['region-detail',   q({ country: any.country, region: any.region || '' })]
  ];
  const PAGES = process.env.PAGES
    ? process.env.PAGES.split(',').map(s => s.trim()).filter(Boolean)
    : STANDALONE.split(',').concat(DETAIL.map(([n, s]) => n + '?' + s));

  let failures = 0;
  for (const name of PAGES) {
    const label = name.split('?')[0];
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
      const lmap = host && host.__pndMap;
      const canvas = host && host.querySelector('canvas');
      const leaflet = document.querySelectorAll('.leaflet-container path.leaflet-interactive').length;
      const controls = [...document.querySelectorAll('.leaflet-control-container')];
      const out = {
        cesium: !!window.Cesium,
        host: !!host,
        visible: host ? getComputedStyle(host).display !== 'none' : false,
        canvas: canvas ? canvas.width + 'x' + canvas.height : null,
        toggle: !!document.querySelector('.pnd-view-toggle'),
        leafletMarkers: leaflet,
        entities: viewer ? viewer.entities.values.length : null,
        imagery: viewer ? viewer.imageryLayers.length : null,
        controlsHidden: controls.length
          ? controls.every(c => getComputedStyle(c).display === 'none') : 'n/a',
        edgeTB: null, edgeLR: null, edgeBright: null, centreLum: null, aimOffDeg: null
      };

      /* What the globe LOOKS like, which is the part every earlier assertion
         here missed: it passed on entity counts while the globe was a
         featureless sphere, zoomed in far enough to be cut off by the panel.
         The rendered pixels answer both — space all round the edge means the
         globe fits, and a lit centre means something was actually drawn. */
      if (canvas) {
        try {
          const o = document.createElement('canvas');
          o.width = canvas.width; o.height = canvas.height;
          o.getContext('2d').drawImage(canvas, 0, 0);
          const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
          const lum = (x, y) => {
            const i = (y * o.width + x) * 4;
            return (d[i] + d[i + 1] + d[i + 2]) / 3;
          };
          /* Counted per axis, because what is wrong is the two disagreeing.
             A globe framed to show the whole world has space along every
             edge; one zoomed into a region fills every edge. Bright along
             one axis and dark along the other is the globe spilling out of
             its panel — the live map had the poles off the top and bottom
             while the left and right sat in black. */
          let tb = 0, lr = 0;
          for (let k = 1; k < 20; k++) {
            const x = Math.round(o.width * k / 20), y = Math.round(o.height * k / 20);
            /* A starfield puts the odd bright pixel on the edge, so these
               are counted rather than demanding pure black. */
            if (lum(x, 2) > 60) tb++;
            if (lum(x, o.height - 3) > 60) tb++;
            if (lum(2, y) > 60) lr++;
            if (lum(o.width - 3, y) > 60) lr++;
          }
          out.edgeTB = tb; out.edgeLR = lr;
          out.edgeBright = tb + lr;
          out.centreLum = Math.round(lum(o.width >> 1, o.height >> 1));
        } catch (e) { out.edgeBright = 'err'; }
      }

      /* The map is supposed to fill the panel it sits in. It did not: .map
         set an aspect-ratio and a max-height but no width, so on a short
         viewport the height cap shrank the WIDTH and left a band of dead
         panel beside the map — on the flat map as much as the globe. */
      const mapEl = document.querySelector('.leaflet-container');
      if (mapEl && mapEl.parentElement) {
        const pe = mapEl.parentElement;
        const cs = getComputedStyle(pe);
        const inner = pe.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
        out.mapW = Math.round(mapEl.getBoundingClientRect().width);
        out.panelW = Math.round(inner);
        out.shortBy = Math.round(inner - mapEl.getBoundingClientRect().width);
      }

      /* And where it is pointing, against where the flat map was looking. */
      if (viewer && lmap && lmap.getCenter) {
        try {
          const C = window.Cesium;
          const c = C.Cartographic.fromCartesian(viewer.camera.positionWC);
          const want = lmap.getCenter();
          const dLat = C.Math.toDegrees(c.latitude) - want.lat;
          let dLon = C.Math.toDegrees(c.longitude) - want.lng;
          while (dLon > 180) dLon -= 360;
          while (dLon < -180) dLon += 360;
          out.aimOffDeg = Math.round(Math.sqrt(dLat * dLat + dLon * dLon) * 10) / 10;
        } catch (e) { out.aimOffDeg = 'err'; }
      }
      return out;
    });

    /* The globe must exist, be visible, carry a way back to the flat map, keep
       Leaflet's own controls out of the way, and agree with the flat map about
       how many hazards there are. A page that drew nothing is reported, not
       silently passed. */
    const ok = r.cesium && r.host && r.visible && r.canvas && r.toggle &&
      (r.controlsHidden === true || r.controlsHidden === 'n/a') &&
      r.leafletMarkers > 0 && r.entities === r.leafletMarkers &&
      /* A basemap, a globe that fits inside its panel, something actually lit
         at the centre, and a camera aimed where the flat map was looking. */
      r.imagery >= 1 && r.centreLum > 60 && r.aimOffDeg <= 2 &&
      /* Framed: space all round, or filled all round — never one and not the
         other. 38 samples per axis. */
      ((r.edgeTB <= 3 && r.edgeLR <= 3) || (r.edgeTB >= 30 && r.edgeLR >= 30)) &&
      /* And the map fills the panel it sits in. Measured across all sixteen
         pages this is exact, so a couple of pixels is all the slack. */
      r.shortBy <= 2;
    if (!ok || errors.length) failures++;
    console.log(
      (ok && !errors.length ? '  ok   ' : '  FAIL ') + label.padEnd(16) +
      ' cesium=' + r.cesium + ' host=' + r.host + ' visible=' + r.visible +
      ' canvas=' + r.canvas + ' markers=' + r.leafletMarkers +
      ' entities=' + r.entities + ' imagery=' + r.imagery +
      ' edgeTB=' + r.edgeTB + ' edgeLR=' + r.edgeLR + ' centreLum=' + r.centreLum +
      ' aimOff=' + r.aimOffDeg + ' mapW=' + r.mapW + '/' + r.panelW +
      (errors.length ? ' ERRORS=' + JSON.stringify(errors.slice(0, 2)) : ''));
    await page.screenshot({ path: 'globe-' + label + '.png' });
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
  console.log((toggleOk ? '  ok   ' : '  FAIL ') + 'toggle'.padEnd(16) +
    ' flatHidesGlobe=' + flat.globeHidden + ' flatKeepsMarkers=' + flat.markers +
    ' globeReturns=' + back.globeVisible + ' entitiesKept=' + back.entities);

  /* And that a hazard can be read. Clicking one opened a panel headed by
     Cesium's own generated entity id until the entities were given names. */
  const box = await page.evaluate(() => {
    const c = document.querySelector('.pnd-globe canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const target = await page.evaluate(() => {
    const v = document.querySelector('.pnd-globe').__pndViewer, C = window.Cesium;
    const occ = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, v.camera.positionWC);
    let best = null;
    v.entities.values.forEach(e => {
      const p = e.position.getValue(C.JulianDate.now());
      if (!p || !occ.isPointVisible(p)) return;
      const s = v.scene.cartesianToCanvasCoordinates(p);
      if (!s) return;
      const d = Math.hypot(s.x - v.scene.canvas.width / 2, s.y - v.scene.canvas.height / 2);
      if (!best || d < best.d) best = { d: d, x: s.x, y: s.y, name: e.name };
    });
    return best;
  });
  let readOk = false, readNote = 'no hazard was facing the camera to click';
  if (target) {
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.cesium-infoBox');
      const v = document.querySelector('.pnd-globe').__pndViewer;
      return { visible: !!el && el.classList.contains('cesium-infoBox-visible'),
        title: ((document.querySelector('.cesium-infoBox-title') || {}).textContent || '').trim(),
        names: v.entities.values.map(e => String(e.name || '').trim()) };
    });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
    /* Not the entity aimed at: where hazards overlap Cesium picks whichever
       point is on top, which is its business. What matters is that the panel
       is headed by a hazard's name and not by a generated id. */
    readOk = info.visible && info.title.length > 0 && !uuid.test(info.title) &&
      info.names.indexOf(info.title) >= 0;
    readNote = 'infoBox=' + info.visible + ' title=' + JSON.stringify(info.title.slice(0, 44));
  }
  if (!readOk) failures++;
  console.log((readOk ? '  ok   ' : '  FAIL ') + 'click'.padEnd(16) + ' ' + readNote);

  console.log('\npages checked: ' + PAGES.length + ', failing: ' + failures);

  await browser.close();
  server.close();
  /* A checker that reports failures and exits 0 is worse than no checker: it
     reads as green to anything wrapping it. */
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
