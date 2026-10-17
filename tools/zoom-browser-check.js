#!/usr/bin/env node
/*
 * Zooming the globe and the flat map in a real browser, with real input.
 *
 * test/zoom.test.js checks the wiring against stubs. This drives the actual
 * page in Chromium with real WebGL and the real published CesiumJS, sends the
 * input a reader's hardware sends (a mouse wheel, a trackpad pinch as Ctrl +
 * wheel, a two-finger touchscreen pinch through the DevTools protocol, and
 * Safari's gesture events, which Chromium never fires and so are dispatched
 * by hand), and measures what moved: the camera's height, the map's zoom,
 * the page's scroll position and the browser's own page zoom.
 *
 * Not part of `npm test`, for the same reasons as globe-browser-check.js.
 *
 *   CESIUM_BUILD=/path/to/package/Build/Cesium node tools/zoom-browser-check.js
 *
 * Optional: CHROMIUM=/path/to/chrome, SHOTS_DIR=/where/screenshots/go,
 * WIDTHS=390,820,1440, PAGE=/live-map. Exits non-zero on any failed check.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const CESIUM = process.env.CESIUM_BUILD;
if (!CESIUM) { console.error('set CESIUM_BUILD - see the header of this file'); process.exit(2); }
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'zoom-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const WIDTHS = (process.env.WIDTHS || '390,820,1440').split(',').map(Number);
const PAGE = process.env.PAGE || '/live-map';
const PORT = 8098;

const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/events')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = { body: null };
    const fake = { status() { return fake; }, setHeader() {}, json(b) { out.body = b; }, end() {} };
    try {
      const q = {}; url.searchParams.forEach((v, k) => { q[k] = v; });
      await eventsHandler({ query: q, url: req.url, method: 'GET', headers: {} }, fake);
    } finally { global.fetch = realFetch; }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out.body));
  }
  if (p.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const results = [];
function check(width, name, ok, detail) {
  results.push({ width, name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + String(width).padStart(4) + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, width) {
  const phone = width < 500;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : width < 1000 ? 1180 : 900 },
    isMobile: phone, hasTouch: phone, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  /* When the hint came and went, as the page did it: the globe can take
     longer to become interactive here, on a software renderer, than the six
     seconds the hint stays, so whether it is still showing when the checks
     below begin says nothing about what a reader saw. */
  await page.addInitScript(() => {
    window.__pndHint = {};
    new MutationObserver(ms => ms.forEach(m => {
      if (!m.target.classList || !m.target.classList.contains('pnd-hud-hint')) return;
      window.__pndHint[m.target.hasAttribute('data-shown') ? 'shownAt' : 'goneAt'] = performance.now();
    })).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-shown'] });
  });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.route('**/*', route => {
    const u = route.request().url();
    if (/^http:\/\/localhost:/.test(u)) return route.continue();
    if (/(unpkg\.com|cdn\.jsdelivr\.net\/npm)\/cesium@/.test(u)) {
      const rel = u.split('/Build/Cesium/')[1].split('?')[0];
      const f = path.join(CESIUM, rel);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    /* Map tiles and terrain: unreachable here, and not what is being tested.
       Answered empty so they do not fill the console with network errors. */
    if (/arcgisonline|tile\.openstreetmap|gibs\.earthdata|terrain\.reearth|basemaps\.cartocdn/.test(u)) {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.abort();
  });

  await page.goto('http://localhost:' + PORT + PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const h = document.querySelector('.pnd-globe');
    return h && h.style.display !== 'none' && h.__pndViewer && document.querySelector('.pnd-hud-zoom button');
  }, null, { timeout: 90000 });
  await wait(1500);
  const W = width;

  /* The panel scrolled into view, with page left above and below it. */
  await page.evaluate(() => document.querySelector('.pnd-globe').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(400);

  const height = () => page.evaluate(() => document.querySelector('.pnd-globe').__pndViewer.camera.positionCartographic.height);
  const pageState = () => page.evaluate(() => ({ y: Math.round(scrollY), scale: visualViewport ? visualViewport.scale : 1 }));
  const box = await page.evaluate(() => { const b = document.querySelector('.pnd-globe').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const cx = box.x + box.w * 0.45, cy = box.y + box.h * 0.55;
  /* Until the camera has stopped moving, rather than for a fixed time: on a
     loaded machine input arrives late and a fixed wait reads mid-zoom. */
  const settle = async () => {
    await wait(300);
    let last = await height();
    for (let i = 0; i < 40; i++) {
      await wait(300);
      const h = await height();
      if (Math.abs(h - last) < 1) return;
      last = h;
    }
  };

  /* What a reader sees first. */
  const hint = await page.evaluate(() => { const h = document.querySelector('.pnd-hud-hint'), t = window.__pndHint || {};
    return h && { text: h.textContent, shownAt: t.shownAt, goneAt: t.goneAt, now: performance.now() }; });
  /* Shown when the globe opened, and kept up for its six seconds (or still up). */
  const lasted = hint && hint.shownAt != null ? (hint.goneAt != null ? hint.goneAt : hint.now) - hint.shownAt : 0;
  check(W, 'the hint showed when the globe opened, for its six seconds', hint && hint.shownAt != null && (hint.goneAt == null ? true : lasted >= 5900),
    hint && (hint.text + ', shown at ' + Math.round(hint.shownAt / 100) / 10 + ' s for ' + Math.round(lasted / 100) / 10 + ' s'));
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.pnd-hud-zoom button')].map(b => {
    const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const host = document.querySelector('.pnd-globe').getBoundingClientRect();
    return { k: b.dataset.zoom, w: Math.round(r.width), h: Math.round(r.height), reachable: top === b || b.contains(top),
      inside: r.left >= host.left && r.right <= host.right && r.top >= host.top && r.bottom <= host.bottom };
  }));
  check(W, 'zoom in, zoom out and reset buttons are on the globe, unobstructed and at least 32px',
    buttons.length === 3 && buttons.every(b => b.reachable && b.inside && b.w >= 32 && b.h >= 32), JSON.stringify(buttons));
  /* The caption here says the photos did not load; in production it is the
     longer mosaic caption, so that is what is measured. */
  const clash = await page.evaluate(() => {
    const note = document.querySelector('.pnd-imagery-note');
    if (note) {
      note.textContent = 'Satellite: Esri\u2019s mosaic of recent photos. It is not a live picture of today. Turn on \u201cNASA today\u201d for the latest daily photo.';
      note.parentNode.dispatchEvent(new CustomEvent('pnd-caption'));
    }
    const box = e => e && e.getBoundingClientRect();
    const hit = (a, b) => a && b && a.width && b.width && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const n = box(note), out = [];
    for (const sel of ['.pnd-hud-zoom', '.pnd-hud-bar', '.pnd-view-toggle', '.pnd-key']) if (hit(n, box(document.querySelector(sel)))) out.push(sel);
    return out;
  });
  check(W, 'the picture caption covers none of the globe\'s controls', clash.length === 0, clash.join(', '));
  await page.screenshot({ path: path.join(SHOTS, 'globe-' + W + '.png'), clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.w, W), height: box.h } });

  if (!phone) {
    /* Mouse wheel. */
    await page.mouse.move(cx, cy);
    let p0 = await pageState(), h0 = await height();
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await wait(60); }
    await settle();
    let h1 = await height(), p1 = await pageState();
    check(W, 'the mouse wheel zooms the globe in, and the page does not scroll', h1 < h0 * 0.8 && p1.y === p0.y,
      Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km, scroll ' + p0.y + ' -> ' + p1.y);
    check(W, 'three wheel notches in bring the camera eight times closer', Math.abs(h1 - h0 / 8) < h0 / 8 * 0.05,
      Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km');
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await wait(60); }
    await settle();
    const h2 = await height();
    check(W, 'three wheel notches out undo them', Math.abs(h2 - h0) < h0 * 0.05, Math.round(h1 / 1000) + ' km -> ' + Math.round(h2 / 1000) + ' km');

    /* The spot under the pointer stays under it as the wheel zooms. */
    const offX = box.x + box.w * 0.6, offY = box.y + box.h * 0.4;
    /* Measured on screen: where the place that was under the pointer is
       drawn after the zoom, in pixels from the pointer. */
    const ground = await page.evaluate(([x, y]) => {
      const host = document.querySelector('.pnd-globe'), v = host.__pndViewer, r = host.getBoundingClientRect();
      const p = v.camera.pickEllipsoid(new Cesium.Cartesian2(x - r.left, y - r.top));
      return p ? [p.x, p.y, p.z] : null;
    }, [offX, offY]);
    await page.mouse.move(offX, offY);
    await page.mouse.wheel(0, -100); await settle();
    const drawn = ground && await page.evaluate(([gx, gy, gz]) => {
      const host = document.querySelector('.pnd-globe'), v = host.__pndViewer, r = host.getBoundingClientRect();
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, new Cesium.Cartesian3(gx, gy, gz));
      return w ? [w.x + r.left, w.y + r.top] : null;
    }, ground);
    const drift = drawn ? Math.hypot(drawn[0] - offX, drawn[1] - offY) : NaN;
    check(W, 'the place under the pointer stays under it while zooming (within 2px)', drift <= 2,
      drawn ? drift.toFixed(2) + ' px' : 'nothing under the pointer');
    await page.mouse.wheel(0, 100); await settle();

    /* A trackpad pinch: many small Ctrl + wheel events. */
    p0 = await pageState(); h0 = await height();
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -6); await wait(16); }
    await page.keyboard.up('Control');
    await settle();
    h1 = await height(); p1 = await pageState();
    check(W, 'a trackpad pinch (Ctrl + wheel) zooms the globe in and not the page',
      h1 < h0 * 0.85 && p1.scale === 1 && p1.y === p0.y,
      Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km, page scale ' + p1.scale);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 6); await wait(16); }
    await page.keyboard.up('Control');
    await settle();
    const h3 = await height();
    check(W, 'pinching in zooms the globe back out', h3 > h1 * 1.15, Math.round(h1 / 1000) + ' km -> ' + Math.round(h3 / 1000) + ' km');

    /* A page scroll that runs over the globe keeps scrolling the page. */
    /* Instant: the site scrolls smoothly, and a pointer placed mid-scroll
       lands somewhere else. */
    await page.evaluate(() => scrollTo({ top: Math.max(0, document.querySelector('.pnd-globe').getBoundingClientRect().top + scrollY - innerHeight * 0.75), behavior: 'instant' }));
    await wait(700);
    const above = await page.evaluate(() => document.querySelector('.pnd-globe').getBoundingClientRect().top);
    await page.mouse.move(cx, Math.max(5, above - 60));
    const startsOff = await page.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest('.pnd-globe'), [cx, Math.max(5, above - 60)]);
    check(W, 'the page-scroll check starts with the pointer off the globe', startsOff);
    h0 = await height(); p0 = await pageState();
    /* Sent through the DevTools protocol without waiting for each to be
       acknowledged: a real wheel delivers events every 16 to 50 ms, but here
       the software renderer holds every awaited event for a second or more,
       which is not a scroll anyone makes. */
    await page.evaluate(() => {
      window.__wheels = [];
      window.addEventListener('wheel', e => window.__wheels.push([Math.round(performance.now()),
        e.target.closest('.pnd-globe') ? 'globe' : 'page']), { capture: true });
    });
    const cdpScroll = await ctx.newCDPSession(page);
    const sends = [];
    for (let i = 0; i < 6; i++) {
      sends.push(cdpScroll.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: Math.max(5, above - 60), deltaX: 0, deltaY: 120 }));
      await wait(40);
    }
    await Promise.all(sends);
    await settle();
    h1 = await height(); p1 = await pageState();
    const overGlobe = (await page.evaluate(() => window.__wheels)).filter(e => e[1] === 'globe').length;
    check(W, 'a page scroll that runs over the globe keeps scrolling the page', overGlobe >= 2 && p1.y > p0.y + 300 && Math.abs(h1 - h0) < h0 * 0.01,
      'scroll ' + p0.y + ' -> ' + p1.y + ', wheel events that landed on the globe: ' + overGlobe + ', height change ' + Math.round((h1 - h0) / 1000) + ' km, events ' + JSON.stringify(await page.evaluate(() => window.__wheels)));
    await page.evaluate(() => document.querySelector('.pnd-globe').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await wait(800);
  } else {
    /* A two-finger pinch on the touchscreen, as the phone sends it. */
    const cdp = await ctx.newCDPSession(page);
    const pinch = async (from, to) => {
      const pts = d => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / 10) });
        await wait(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    let h0 = await height();
    await pinch(30, 110);
    await settle();
    let h1 = await height();
    check(W, 'a two-finger pinch out on the touchscreen zooms the globe in', h1 < h0 * 0.8,
      Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km');
    await pinch(110, 30);
    await settle();
    const h2 = await height();
    check(W, 'a two-finger pinch in zooms the globe back out', h2 > h1 * 1.25, Math.round(h1 / 1000) + ' km -> ' + Math.round(h2 / 1000) + ' km');
  }

  /* Safari's pinch: Chromium never sends these, so they are dispatched. */
  const g = await page.evaluate(() => {
    const host = document.querySelector('.pnd-globe');
    const cam = host.__pndViewer.camera;
    const fire = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); e.scale = scale; host.dispatchEvent(e); return e.defaultPrevented; };
    const h0 = cam.positionCartographic.height;
    const prevented = fire('gesturestart', 1);
    fire('gesturechange', 1.5); fire('gesturechange', 2);
    const h1 = cam.positionCartographic.height;
    fire('gestureend', 2);
    return { h0, h1, prevented };
  });
  check(W, 'Safari\'s pinch (gesture events) zooms the globe with the fingers', g.prevented && Math.abs(g.h1 - g.h0 / 2) < g.h0 * 0.02,
    Math.round(g.h0 / 1000) + ' km -> ' + Math.round(g.h1 / 1000) + ' km');

  /* The buttons. Taps on a phone, clicks elsewhere. */
  const tapOrClick = async sel => { if (phone) await page.tap(sel); else await page.click(sel); };
  let h0 = await height();
  await tapOrClick('.pnd-hud-zoom [data-zoom="in"]');
  await settle();
  let h1 = await height();
  check(W, 'the + button halves the camera height', Math.abs(h1 - h0 / 2) < h0 * 0.03, Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km');
  await tapOrClick('.pnd-hud-zoom [data-zoom="out"]');
  await tapOrClick('.pnd-hud-zoom [data-zoom="out"]');
  await settle();
  const h2 = await height();
  check(W, 'two quick presses of the - button add up to four times the height', Math.abs(h2 - h1 * 4) < h1 * 0.12,
    Math.round(h1 / 1000) + ' km -> ' + Math.round(h2 / 1000) + ' km');
  await tapOrClick('.pnd-hud-zoom [data-zoom="reset"]');
  await wait(2000);
  const fit = await page.evaluate(() => document.querySelector('.pnd-globe').__pndViewer.scene.screenSpaceCameraController.maximumZoomDistance / 3);
  const hr = await height();
  check(W, 'reset goes back to the whole-world view', hr <= fit * 1.05 && hr > 250000, Math.round(hr / 1000) + ' km, whole-world fit ' + Math.round(fit / 1000) + ' km');

  /* Keyboard. */
  await page.focus('.pnd-globe');
  h0 = await height();
  await page.keyboard.press('+');
  await settle();
  h1 = await height();
  check(W, 'the + key zooms in when the globe has focus', Math.abs(h1 - h0 / 2) < h0 * 0.03, Math.round(h0 / 1000) + ' km -> ' + Math.round(h1 / 1000) + ' km');
  await page.keyboard.press('0');
  await wait(1800);

  /* Limits. */
  const lim = await page.evaluate(async () => {
    const host = document.querySelector('.pnd-globe'), v = host.__pndViewer, c = v.scene.screenSpaceCameraController;
    const btn = k => host.querySelector('.pnd-hud-zoom [data-zoom="' + k + '"]');
    const until = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) { btn('in').click(); await until(30); }
    await until(900);
    const low = v.camera.positionCartographic.height;
    for (let i = 0; i < 40; i++) { btn('out').click(); await until(30); }
    await until(900);
    const high = v.camera.positionCartographic.height;
    return { low, high, min: c.minimumZoomDistance, max: c.maximumZoomDistance };
  });
  check(W, 'the camera stops at a kilometre up and at three whole-Earth views out',
    lim.low >= lim.min * 0.95 && lim.low < lim.min * 3 && lim.high <= lim.max * 1.01 && lim.high > lim.max * 0.9,
    'lowest ' + Math.round(lim.low) + ' m (limit ' + lim.min + '), highest ' + Math.round(lim.high / 1000) + ' km (limit ' + Math.round(lim.max / 1000) + ')');
  await page.keyboard.press('0');
  await wait(1500);

  /* ---- the flat map ---- */
  await tapOrClick('.pnd-view-toggle button:text-is("Flat")').catch(e => check(W, 'the Flat button can be pressed', false, e.message.split('\n')[0]));
  await page.waitForFunction(() => document.querySelector('.pnd-globe').style.display === 'none', null, { timeout: 5000 }).catch(() => {});
  const flatShown = await page.evaluate(() => document.querySelector('.pnd-globe').style.display === 'none');
  check(W, 'the Flat button shows the flat map', flatShown);
  if (flatShown) {
    const mb = await page.evaluate(() => { const b = document.querySelector('.pnd-globe').__pndMap.getContainer().getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const mx = mb.x + mb.w * 0.5, my = mb.y + mb.h * 0.6;
    const zoom = () => page.evaluate(() => document.querySelector('.pnd-globe').__pndMap.getZoom());
    await page.screenshot({ path: path.join(SHOTS, 'flat-' + W + '.png'), clip: { x: Math.max(0, mb.x), y: Math.max(0, mb.y), width: Math.min(mb.w, W), height: mb.h } });
    if (!phone) {
      await page.mouse.move(mx, my);
      await wait(700);
      let z0 = await zoom(), p0 = await pageState();
      await page.mouse.wheel(0, -100);
      await wait(700);
      let z1 = await zoom(), p1 = await pageState();
      check(W, 'the mouse wheel zooms the flat map, and the page does not scroll', z1 > z0 + 0.3 && p1.y === p0.y,
        'zoom ' + z0.toFixed(2) + ' -> ' + z1.toFixed(2) + ', scroll ' + p0.y + ' -> ' + p1.y);
      z0 = await zoom();
      await page.keyboard.down('Control');
      /* A pinch to twice the spread, as Chrome reports it. */
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -100 * Math.LN2 / 10); await wait(16); }
      await page.keyboard.up('Control');
      await wait(400);
      z1 = await zoom(); p1 = await pageState();
      check(W, 'a trackpad pinch to twice the spread zooms the flat map in by one level, not the page',
        Math.abs(z1 - z0 - 1) < 0.08 && p1.scale === 1, 'zoom ' + z0.toFixed(2) + ' -> ' + z1.toFixed(2));
      const fz = await page.evaluate(() => {
        const m = document.querySelector('.pnd-globe').__pndMap, el = m.getContainer();
        const fire = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); e.scale = scale; e.clientX = 300; e.clientY = 200; el.dispatchEvent(e); return e.defaultPrevented; };
        const z0 = m.getZoom(); const p = fire('gesturestart', 1); fire('gesturechange', 0.5); const z1 = m.getZoom(); fire('gestureend', 0.5);
        return { z0, z1, p };
      });
      check(W, 'Safari\'s pinch zooms the flat map out by one level at half the spread', fz.p && Math.abs(fz.z1 - fz.z0 + 1) < 0.05,
        'zoom ' + fz.z0.toFixed(2) + ' -> ' + fz.z1.toFixed(2));
    } else {
      const cdp = await ctx.newCDPSession(page);
      const z0 = await zoom();
      const pts = d => [{ x: mx - d, y: my, id: 1 }, { x: mx + d, y: my, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(30 + 8 * i) }); await wait(20); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(900);
      const z1 = await zoom();
      check(W, 'a two-finger pinch zooms the flat map in', z1 > z0 + 0.5, 'zoom ' + z0.toFixed(2) + ' -> ' + z1.toFixed(2));
    }
    const z0 = await zoom();
    await tapOrClick('.leaflet-control-zoom-in');
    await wait(700);
    const z1 = await zoom();
    check(W, 'the flat map\'s + button zooms in', z1 > z0 + 0.5, 'zoom ' + z0.toFixed(2) + ' -> ' + z1.toFixed(2));
  }

  const real = errors.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
  check(W, 'no console or page errors', real.length === 0, real.slice(0, 3).join(' | '));
  await ctx.close();
}

server.listen(PORT, async () => {
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}));
  try {
    for (const w of WIDTHS) {
      try { await run(browser, w); } catch (e) { check(w, 'the run completed', false, e.message.split('\n')[0]); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed. Screenshots in ' + SHOTS);
  process.exit(failed.length ? 1 : 0);
});
