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
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, '..');
/* Screenshots go somewhere of their own rather than into the working directory,
   which was the repo root: every run left untracked PNGs in the checkout.
   Set SHOTS_DIR to put them elsewhere. */
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'globe-shots');
fs.mkdirSync(SHOTS, { recursive: true });
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

/* The globe's pixels. Read straight off the WebGL canvas, which works only
   because desktops keep its drawing buffer; phones are given a viewer that
   does not, so under PHONE=1 the same pixels come from a screenshot of the
   canvas instead, and the checks below see what a reader would. */
async function captureGlobe(page) {
  if (!process.env.PHONE) return;
  /* Only the canvas: the HUD, the toggle and the captions sit over it and
     would otherwise be measured as the globe. */
  await page.addStyleTag({ content: 'body *{visibility:hidden!important}.pnd-globe canvas{visibility:visible!important}' })
    .then(h => page.evaluate(el => { el.id = 'pnd-shot-style'; }, h));
  const shot = await page.locator('.pnd-globe canvas').first()
    .screenshot({ type: 'png', timeout: 10000 }).catch(() => null);
  await page.evaluate(() => { const st = document.getElementById('pnd-shot-style'); if (st) st.remove(); });
  if (!shot) return;
  await page.evaluate(async b64 => {
    const im = new Image();
    im.src = 'data:image/png;base64,' + b64;
    await im.decode();
    window.__pndShot = im;
  }, shot.toString('base64'));
}

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
  /* PHONE=1 opens the pages as an iPhone would ask for them: its screen, its
     user agent, touch. Chromium is still the engine, so this checks the
     lighter viewer phones get rather than Safari itself. */
  const page = process.env.PHONE
    ? await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })).newPage()
    : await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  /* unpkg is blocked here, so the two CDN libraries are fulfilled from the
     real published packages instead of being faked. */
  const hits = [];
  let cdnDown = false;
  /* Both hosts globe.js tries. BLOCK_FIRST_CDN=1 fails the first, as a
     network or content blocker that refuses unpkg would. */
  await page.route(/(unpkg\.com|cdn\.jsdelivr\.net\/npm)\/cesium@/, route => {
    if (cdnDown || (process.env.BLOCK_FIRST_CDN && /unpkg\.com/.test(route.request().url()))) {
      hits.push('cesium blocked: ' + route.request().url().split('/Build/Cesium/')[1]);
      return route.abort();
    }
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
  /* Esri is unreachable from here, so leaving it to fail could only ever
     confirm the fallback - and that is exactly how the globe came to ship with
     no imagery at all: a blocked host read as a broken provider. The imagery
     host is answered from a stand-in instead, in a colour nothing else on the
     globe uses, so "the satellite layer reached the screen" becomes something
     the rendered pixels can be asked about rather than something a provider's
     configuration is taken to imply.

     The reference layer is answered transparent: it is real enough to be
     requested and not so opaque that it hides what is underneath. */
  const TILE_MAGENTA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAACXklEQVR42u3UMQEAAAzCMPybZgZwsBwx0KNpWuCniAAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAYABiAAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAYABiAAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAYABCAEGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAYABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABAAYAGABgAIABgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAEABgAYAGAAgAGAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQAGABgAYACAAQDLASWaLNSb2rySAAAAAElFTkSuQmCC', 'base64');
  const TILE_CLEAR = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==', 'base64');
  let satTiles = 0, placeTiles = 0;
  let esriBlocked = false;
  /* IMAGERY and PLACES sit on different Esri hosts - server. and services. -
     which is worth keeping straight: an earlier version of this routed only
     services., so the satellite host was never stubbed at all. */
  await page.route(/server\.arcgisonline\.com/, r => {
    if (esriBlocked) return r.abort();
    satTiles++;
    r.fulfill({ status: 200, contentType: 'image/png', body: TILE_MAGENTA });
  });
  await page.route(/services\.arcgisonline\.com/, r => {
    if (esriBlocked) return r.abort();
    placeTiles++;
    r.fulfill({ status: 200, contentType: 'image/png', body: TILE_CLEAR });
  });
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
  /* A page vercel.json redirects away is never served, so it is not
     checked: /home, /home-v2 and /home-v3 all land on /, which is. */
  const redirected = new Set((JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).redirects || [])
    .map(r => r.source.replace(/^\//, '').replace(/\.html$/, '')));
  const PAGES = process.env.PAGES
    ? process.env.PAGES.split(',').map(s => s.trim()).filter(Boolean)
    : STANDALONE.split(',').filter(n => !redirected.has(n))
      .concat(DETAIL.map(([n, s]) => n + '?' + s));

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

    await captureGlobe(page);
    const r = await page.evaluate(() => {
      const host = document.querySelector('.pnd-globe');
      const viewer = host && host.__pndViewer;
      const lmap = host && host.__pndMap;
      const canvas = host && host.querySelector('canvas');
      /* Events are drawn as shaped icons since the one risk scale, and only
         areas as SVG paths; counting paths alone found no markers on any
         page. Country names are icons too, and are not events. */
      const leaflet = document.querySelectorAll('.leaflet-container .leaflet-marker-icon:not(.pnd-country),' +
        ' .leaflet-container path.leaflet-interactive').length;
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
        /* Counting layers said "yes, a basemap" while the globe carried a
           single 2048x1024 picture of the whole planet - about 20km a pixel.
           A detail page flies to 721km over its event and magnifies that
           roughly fifteen times, which is how a flood in Nepal came to be an
           orange smear. So the zoom the imagery actually holds is measured,
           not just its presence. */
        detailLevel: viewer ? Math.max(0, ...[...Array(viewer.imageryLayers.length).keys()]
          .map(i => Number(viewer.imageryLayers.get(i).imageryProvider.maximumLevel) || 0)) : null,
        /* Cesium brands every viewer with its ion logo whether or not ion is
           used, and nothing here uses ion. */
        ionLogo: (() => {
          const lg = document.querySelector('.cesium-credit-logoContainer');
          return !!(lg && lg.offsetParent !== null && getComputedStyle(lg).display !== 'none');
        })(),
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
          o.getContext('2d').drawImage(window.__pndShot || canvas, 0, 0, o.width, o.height);
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
          /* Codex's point, and it was right: maximumLevel is what a provider
             was configured to be capable of, not evidence that one tile ever
             arrived. The places provider reports 18 whether or not its host
             answers, so asking the providers made the check pass on a globe
             whose satellite imagery had entirely failed. The stand-in serves
             magenta, which no palette colour, ocean or marker here uses, so
             the centre pixel answers the real question: did the satellite
             layer reach the screen? Atmosphere lightens it towards white, so
             this tests that red and blue lead green rather than an exact
             value. */
          const sat = (x, y) => {
            const i = (Math.round(y) * o.width + Math.round(x)) * 4;
            return (d[i] - d[i + 1] > 25) && (d[i + 2] - d[i + 1] > 25);
          };
          /* Sampled on a ring, not at the centre. The centre is exactly where
             a detail page aims its camera, so the middle pixel is the hazard's
             own marker: the first version of this read 239,38,57 on three
             pages and called the imagery missing when it was looking at a red
             dot. The radius is a fraction of the panel's short side, which is
             the axis the globe is fitted to, so the ring stays on the globe on
             a wide world view and clear of a 16px marker on a small one. */
          const cx = o.width / 2, cy = o.height / 2;
          const rad = Math.min(o.width, o.height) * 0.12;
          let hits = 0, pts = 0;
          for (let a = 0; a < 8; a++) {
            const th = a * Math.PI / 4;
            pts++;
            if (sat(cx + Math.cos(th) * rad, cy + Math.sin(th) * rad)) hits++;
          }
          const ci = (Math.round(cy) * o.width + Math.round(cx)) * 4;
          out.centreRGB = [d[ci], d[ci + 1], d[ci + 2]];
          out.satHits = hits + '/' + pts;
          /* A majority, so one sample landing on a marker cannot decide it. */
          out.satOnScreen = hits * 2 > pts;
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
      /* Imagery a reader can zoom into, actually on the screen, and no
         borrowed branding on it. detailLevel is reported for the record but
         never asserted on: it is the provider's configured ceiling, which a
         globe fetching nothing still reports. */
      r.satOnScreen === true && r.ionLogo === false &&
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
      ' detail=' + r.detailLevel + ' sat=' + r.satOnScreen +
      ' satHits=' + r.satHits + ' ionLogo=' + r.ionLogo +
      ' edgeTB=' + r.edgeTB + ' edgeLR=' + r.edgeLR + ' centreLum=' + r.centreLum +
      ' aimOff=' + r.aimOffDeg + ' mapW=' + r.mapW + '/' + r.panelW +
      (errors.length ? ' ERRORS=' + JSON.stringify(errors.slice(0, 2)) : ''));
    await page.screenshot({ path: path.join(SHOTS, 'globe-' + label + '.png') });
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
      markers: document.querySelectorAll('.leaflet-container .leaflet-marker-icon:not(.pnd-country),' +
        ' .leaflet-container path.leaflet-interactive').length };
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

  /* And the other half of it: the tile host actually unreachable, which is
     the case for anyone behind a firewall that blocks Esri - and the case
     this whole sweep used to run in without knowing. The globe must still be
     a globe, with the painted world showing through and every hazard on it.
     Asserted the opposite way round from the stage above: magenta must NOT be
     on the screen, or the fallback is not what is being looked at. */
  esriBlocked = true;
  let fbOk = false, fbNote = 'not run';
  try {
    await page.goto('http://localhost:8099/' + PAGES[0], { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => {
      const h = document.querySelector('.pnd-globe');
      return h && h.__pndViewer && getComputedStyle(h).display !== 'none';
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await captureGlobe(page);
    const fb = await page.evaluate(() => {
      const host = document.querySelector('.pnd-globe');
      const v = host && host.__pndViewer;
      if (!v) return { globe: false };
      const cv = v.scene.canvas;
      const o = document.createElement('canvas');
      o.width = cv.width; o.height = cv.height;
      o.getContext('2d').drawImage(window.__pndShot || cv, 0, 0, o.width, o.height);
      const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
      const cx = o.width / 2, cy = o.height / 2;
      const rad = Math.min(o.width, o.height) * 0.12;
      let hits = 0;
      for (let a = 0; a < 8; a++) {
        const th = a * Math.PI / 4;
        const i = (Math.round(cy + Math.sin(th) * rad) * o.width +
                   Math.round(cx + Math.cos(th) * rad)) * 4;
        if ((d[i] - d[i + 1] > 25) && (d[i + 2] - d[i + 1] > 25)) hits++;
      }
      const ci = (Math.round(cy) * o.width + Math.round(cx)) * 4;
      return {
        globe: true,
        entities: v.entities.values.length,
        centreLum: Math.round((d[ci] + d[ci + 1] + d[ci + 2]) / 3),
        magenta: hits * 2 > 8
      };
    });
    fbOk = fb.globe && fb.entities > 0 && fb.centreLum > 60 && fb.magenta === false;
    fbNote = 'globe=' + fb.globe + ' entities=' + fb.entities +
      ' centreLum=' + fb.centreLum + ' magentaGone=' + (fb.magenta === false);
  } catch (e) { fbNote = 'threw ' + e.message.slice(0, 60); }
  if (!fbOk) failures++;
  console.log((fbOk ? '  ok   ' : '  FAIL ') + 'esri-blocked'.padEnd(16) + ' ' + fbNote);

  /* Both hosts for the 3D library down, in a fresh page that has never had
     it: the reader is told, on the map, and Try again works once a host
     answers. Before this the globe dropped back to flat in silence and a
     second press of Globe reused the failed download. */
  let cdnOk = false, cdnNote = 'not run';
  try {
    esriBlocked = false;
    cdnDown = true;
    /* The same page, so the same routes: a second page would reach the real
       CDNs. Routing turns the browser cache off, so nothing is reused. */
    const p2 = page;
    await p2.goto('http://localhost:8099/' + PAGES[0], { waitUntil: 'load', timeout: 60000 });
    await p2.waitForFunction(() => {
      const n = document.querySelector('.pnd-globe-note');
      return n && !n.hidden && /could not open/.test(n.textContent);
    }, null, { timeout: 90000 });
    const said = await p2.evaluate(() => ({
      text: document.querySelector('.pnd-globe-note').textContent,
      flat: document.querySelectorAll('.pnd-view-toggle button')[1].getAttribute('aria-pressed'),
      globe: !!document.querySelector('.pnd-globe')
    }));
    await p2.locator('.pnd-globe-note').scrollIntoViewIfNeeded();
    await p2.screenshot({ path: path.join(SHOTS, 'globe-cdn-down.png') });
    cdnDown = false;
    await p2.click('.pnd-globe-note button:not(.x)');
    await p2.waitForFunction(() => {
      const h = document.querySelector('.pnd-globe');
      return h && h.__pndViewer && getComputedStyle(h).display !== 'none';
    }, null, { timeout: 90000 });
    const after = await p2.evaluate(() => ({
      entities: document.querySelector('.pnd-globe').__pndViewer.entities.values.length,
      noteHidden: document.querySelector('.pnd-globe-note').hidden
    }));
    cdnOk = said.flat === 'true' && !said.globe && after.entities > 0 && after.noteHidden;
    cdnNote = 'told="' + said.text.slice(0, 70) + '" flat=' + said.flat + ' retryEntities=' + after.entities +
      ' noteGone=' + after.noteHidden;
  } catch (e) { cdnNote = 'threw: ' + e.message.slice(0, 120); }
  if (!cdnOk) failures++;
  console.log((cdnOk ? '  ok   ' : '  FAIL ') + 'cdn-down'.padEnd(16) + ' ' + cdnNote);

  console.log('\npages checked: ' + PAGES.length + ', failing: ' + failures);
  console.log('screenshots: ' + SHOTS);

  await browser.close();
  server.close();
  /* A checker that reports failures and exits 0 is worse than no checker: it
     reads as green to anything wrapping it. */
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
