'use strict';
/**
 * Zooming the globe and the flat map, by every route a reader tries first.
 *
 * Reported from the live site: the globe was confusing to use with a mouse
 * or a trackpad. A trackpad pinch did nothing at all on the globe (Chrome,
 * Edge and Firefox send it as a wheel event with ctrlKey set, which Cesium
 * listens for and maps to nothing, so neither the globe nor the page zoomed),
 * Safari's pinch was not handled, there were no zoom buttons, and the flat
 * map ignored the plain scroll wheel unless Ctrl or Command was held.
 *
 * Wanted: scroll zooms, pinch zooms, both views, plus buttons and keys.
 * Kept: a page scroll that happens to pass over a map keeps scrolling the
 * page, so a reader moving down the page is never trapped by it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A trackpad pinch: Chrome reports scale s as deltaY = -100 ln(s). */
const PINCH_DOUBLE = -100 * Math.LN2;

function wheel(win, el, init) {
  const ev = new win.WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, deltaY: -120 }, init));
  el.dispatchEvent(ev);
  return ev;
}
/* Safari's GestureEvent, which jsdom does not have: an event with a scale. */
function gesture(win, el, type, scale) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'scale', { value: scale });
  Object.defineProperty(ev, 'clientX', { value: 200 });
  Object.defineProperty(ev, 'clientY', { value: 150 });
  el.dispatchEvent(ev);
  return ev;
}
function touches(win, el, type, n) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: { length: n } });
  el.dispatchEvent(ev);
}
/* Whether Leaflet or Cesium, listening on an element inside, got the wheel. */
function listener(el) {
  const got = [];
  el.addEventListener('wheel', ev => got.push(ev));
  return got;
}

/* ---------------- the flat map ---------------- */

async function flat(page) {
  return renderPage(page, {
    search: page === 'event-detail.html' ? '?id=ND-001' : '',
    timeoutMs: 3000, waitFor: doc => (doc.defaultView.__pndMaps || []).length > 0
  });
}

test('the scroll wheel zooms the flat map', async () => {
  for (const page of ['index.html', 'live-map.html', 'event-detail.html']) {
    const r = await flat(page);
    const win = r.window;
    for (const map of r.window.__pndMaps) {
      const el = map.getContainer();
      assert.equal(map.scrollWheelZoom.enabled(), true, page + ': the scroll wheel does not zoom the map');
      const pane = win.document.createElement('div');
      el.appendChild(pane);
      const leaflet = listener(pane);
      wheel(win, pane, {});
      assert.equal(leaflet.length, 1, page + ': a plain scroll over the map never reached Leaflet');
      assert.equal(el.querySelector('.pnd-wheel-hint'), null, page + ': the old "hold Ctrl" hint is still shown');
    }
    r.close();
  }
});

test('a trackpad pinch zooms the flat map smoothly, about the fingers', async () => {
  const r = await flat('live-map.html');
  const win = r.window;
  const map = r.window.__pndMaps[0];
  const el = map.getContainer();
  const pane = win.document.createElement('div');
  el.appendChild(pane);
  const leaflet = listener(pane);

  const z0 = map.getZoom();
  const out = wheel(win, pane, { ctrlKey: true, deltaY: PINCH_DOUBLE, clientX: 120, clientY: 80 });
  assert.ok(out.defaultPrevented, 'the pinch zoomed the whole page as well');
  assert.equal(leaflet.length, 0, 'Leaflet zoomed a second time, in its own coarse steps');
  assert.ok(Math.abs(map.getZoom() - (z0 + 1)) < 1e-9,
    'spreading the fingers to twice the distance should zoom in one level, got ' + (map.getZoom() - z0));
  assert.deepEqual([map.__around.x, map.__around.y], [120, 80], 'the zoom is not about the point under the fingers');

  wheel(win, pane, { ctrlKey: true, deltaY: -PINCH_DOUBLE });
  assert.ok(Math.abs(map.getZoom() - z0) < 1e-9, 'pinching back did not return to the same zoom');

  /* Command + wheel on a Mac, and a mouse wheel counted in lines. */
  wheel(win, pane, { metaKey: true, deltaY: PINCH_DOUBLE });
  assert.ok(map.getZoom() > z0 + 0.99, 'Command + wheel did not zoom');
  const z1 = map.getZoom();
  wheel(win, pane, { ctrlKey: true, deltaMode: 1, deltaY: 3 });
  assert.ok(map.getZoom() < z1, 'Ctrl + a line-mode wheel did not zoom out');
  r.close();
});

test('Safari\'s pinch zooms the flat map, and a finger pinch is left to Leaflet', async () => {
  const r = await flat('live-map.html');
  const win = r.window;
  const map = r.window.__pndMaps[0];
  const el = map.getContainer();
  const z0 = map.getZoom();
  assert.ok(gesture(win, el, 'gesturestart', 1).defaultPrevented, 'Safari zoomed the page instead');
  assert.ok(gesture(win, el, 'gesturechange', 4).defaultPrevented);
  assert.ok(Math.abs(map.getZoom() - (z0 + 2)) < 1e-9, 'four times the spread should be two levels in');
  gesture(win, el, 'gesturechange', 0.5);
  assert.ok(Math.abs(map.getZoom() - (z0 - 1)) < 1e-9, 'the zoom does not follow the fingers back');
  gesture(win, el, 'gestureend', 0.5);

  /* On an iPhone or iPad the same events come with fingers on the screen,
     and Leaflet's own touch zoom is already handling those. */
  const z1 = map.getZoom();
  touches(win, el, 'touchstart', 2);
  gesture(win, el, 'gesturestart', 1);
  gesture(win, el, 'gesturechange', 3);
  assert.equal(map.getZoom(), z1, 'a touchscreen pinch was zoomed twice');
  touches(win, el, 'touchend', 0);
  r.close();
});

test('a page scroll that runs over a map keeps scrolling the page', async () => {
  const r = await flat('live-map.html');
  const win = r.window;
  const map = r.window.__pndMaps[0];
  const el = map.getContainer();
  const pane = win.document.createElement('div');
  el.appendChild(pane);
  const leaflet = listener(pane);

  wheel(win, win.document.body, {});                 // scrolling the page
  const passing = wheel(win, pane, {});              // the map arrives under the pointer
  assert.equal(leaflet.length, 0, 'a page scroll stopped dead over the map and zoomed it');
  assert.equal(passing.defaultPrevented, false, 'the page did not keep scrolling');

  await sleep(700);                                  // the reader stops, then scrolls on the map
  wheel(win, pane, {});
  assert.equal(leaflet.length, 1, 'a scroll that starts on the map did not zoom it');

  /* A pinch is never a page scroll, however soon it follows one. */
  wheel(win, win.document.body, {});
  const z0 = map.getZoom();
  assert.ok(wheel(win, pane, { ctrlKey: true, deltaY: PINCH_DOUBLE }).defaultPrevented);
  assert.ok(map.getZoom() > z0, 'a pinch right after a page scroll was ignored');
  r.close();
});

test('a wheel the browser is already scrolling the page with is left to the page', async () => {
  /* Chrome makes the rest of a scroll that began off the map non-cancelable,
     and on a busy page the map can be under the pointer by the time such an
     event is delivered. Zooming then would scroll and zoom at once. */
  const r = await flat('live-map.html');
  const win = r.window;
  const map = r.window.__pndMaps[0];
  const pane = win.document.createElement('div');
  map.getContainer().appendChild(pane);
  const leaflet = listener(pane);
  wheel(win, pane, { cancelable: false });
  assert.equal(leaflet.length, 0, 'a non-cancelable wheel zoomed the map while the page scrolled');
  /* The page itself scrolling moments ago counts too. */
  await sleep(700);
  win.dispatchEvent(new win.Event('scroll'));
  wheel(win, pane, {});
  assert.equal(leaflet.length, 0, 'a wheel right after the page scrolled zoomed the map');
  await sleep(700);
  wheel(win, pane, {});
  assert.equal(leaflet.length, 1, 'the map never zooms on the wheel again');
  r.close();
});

test('a page that turns wheel zoom off keeps it off', async () => {
  const r = await flat('live-map.html');
  const m = r.window.L.map(r.window.document.createElement('div'), { scrollWheelZoom: false });
  assert.equal(m.scrollWheelZoom.enabled(), false);
  r.close();
});

/* ---------------- the globe ---------------- */

async function globe() {
  const r = await renderPage('live-map.html', { timeoutMs: 18000,
    waitFor: (d, w) => (w.__pndViewers || []).length && d.querySelector('.pnd-hud-zoom button') &&
      d.querySelector('.pnd-globe').style.display !== 'none' });
  const w = r.window;
  const viewer = w.__pndViewers[0];
  return { r, w, d: r.document, viewer, cam: viewer.camera, host: r.document.querySelector('.pnd-globe') };
}
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-6;

test('the globe zooms on the wheel and a trackpad pinch, the same amount in as out, within limits', async () => {
  const { r, w, cam, host, viewer } = await globe();
  const c = viewer.scene.screenSpaceCameraController;
  const T = r.window.Cesium.CameraEventType;
  /* Cesium keeps the touchscreen pinch and the right-drag; the wheel is the
     page's, because Cesium's own wheel zoom was lopsided (see globe.js). */
  assert.ok(c.zoomEventTypes.includes(T.PINCH), 'the touchscreen pinch no longer zooms');
  assert.ok(c.zoomEventTypes.includes(T.RIGHT_DRAG));
  assert.ok(!c.zoomEventTypes.includes(T.WHEEL), 'Cesium and the page would both zoom on the wheel');
  assert.ok(c.minimumZoomDistance >= 300 && c.minimumZoomDistance <= 5000,
    'the camera can fly into the ground or stops too high: ' + c.minimumZoomDistance);
  assert.ok(isFinite(c.maximumZoomDistance) && c.maximumZoomDistance >= 1e7 && c.maximumZoomDistance <= 1e8,
    'the Earth can be zoomed out to a dot: ' + c.maximumZoomDistance);

  const h = () => cam.positionCartographic.height;
  const h0 = h();
  /* A mouse notch: twice as close, then back, gliding over a few frames. */
  const notch = wheel(w, host, { deltaY: -100 });
  assert.ok(notch.defaultPrevented, 'the wheel scrolled the page as well');
  await sleep(600);
  assert.ok(Math.abs(h() - h0 / 2) < h0 * 0.01, 'a notch in should halve the height, went ' + h0 + ' -> ' + h());
  wheel(w, host, { deltaY: 100 });
  await sleep(600);
  assert.ok(Math.abs(h() - h0) < h0 * 0.01, 'a notch out should undo a notch in exactly, got ' + h());

  /* A trackpad pinch follows the fingers at once. */
  const pinch = wheel(w, host, { ctrlKey: true, deltaY: PINCH_DOUBLE });
  assert.ok(pinch.defaultPrevented, 'the pinch zoomed the page');
  assert.ok(near(h(), h0 / 2), 'a pinch to twice the spread should halve the height, got ' + h());
  wheel(w, host, { ctrlKey: true, deltaY: -PINCH_DOUBLE });
  assert.ok(near(h(), h0), 'pinching back did not return');

  /* A sideways swipe scrolls what it is over, and zooms nothing. */
  const before = h();
  const side = wheel(w, host, { deltaX: 80, deltaY: 0 });
  await sleep(300);
  assert.equal(side.defaultPrevented, false, 'a sideways swipe over the globe was swallowed');
  assert.equal(h(), before, 'a sideways swipe zoomed the globe');

  /* The limits hold for the wheel. */
  for (let i = 0; i < 40; i++) wheel(w, host, { ctrlKey: true, deltaY: -300 });
  assert.ok(h() >= c.minimumZoomDistance - 1e-6, 'zoomed in past the limit: ' + h());
  for (let i = 0; i < 40; i++) wheel(w, host, { ctrlKey: true, deltaY: 300 });
  assert.ok(h() <= c.maximumZoomDistance + 1e-6, 'zoomed out past the limit: ' + h());
  r.close();
});

test('the globe has zoom in, zoom out and reset buttons that work', async () => {
  const { r, w, d, cam, host } = await globe();
  const btn = k => d.querySelector('.pnd-hud-zoom [data-zoom="' + k + '"]');
  for (const [k, label] of [['in', 'Zoom in'], ['out', 'Zoom out'], ['reset', 'Reset view']]) {
    assert.ok(btn(k), 'no ' + label + ' button');
    assert.equal(btn(k).getAttribute('aria-label'), label);
    assert.equal(btn(k).tagName, 'BUTTON');
  }
  const click = k => btn(k).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const h = () => cam.positionCartographic.height;
  const h0 = h();
  click('in');
  assert.ok(near(h(), h0 / 2), 'zoom in should halve the height, went ' + h0 + ' -> ' + h());
  click('out'); click('out');
  assert.ok(near(h(), h0 * 2), 'zoom out should double the height, got ' + h());
  const c = cam.__view.orientation;
  assert.ok(c && 'heading' in c && 'pitch' in c, 'a zoom button reset the way the camera was turned');

  /* The limits hold for the buttons too. */
  for (let i = 0; i < 40; i++) click('in');
  const min = r.window.__pndViewers[0].scene.screenSpaceCameraController.minimumZoomDistance;
  assert.ok(h() >= min - 1e-6, 'the zoom in button went below the limit');
  for (let i = 0; i < 40; i++) click('out');
  const max = r.window.__pndViewers[0].scene.screenSpaceCameraController.maximumZoomDistance;
  assert.ok(h() <= max + 1e-6, 'the zoom out button went past the limit');

  /* Reset goes back to the view the globe opened on. */
  const flew = cam.__flew;
  click('reset');
  assert.equal(cam.__flew, flew + 1, 'reset did not move the camera');
  const map = w.__pndMaps[0], ctr = map.getCenter();
  assert.ok(near(cam.__view.destination.lat, ctr.lat) && near(cam.__view.destination.lon, ctr.lng),
    'reset did not return to where the map was looking');
  assert.ok(host.contains(btn('in')));
  r.close();
});

test('the globe zooms from the keyboard, and leaves the browser\'s own zoom keys alone', async () => {
  const { r, w, cam, host } = await globe();
  const key = (k, extra) => {
    const ev = new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra));
    host.dispatchEvent(ev);
    return ev;
  };
  assert.equal(host.getAttribute('tabindex'), '0', 'the globe cannot take keyboard focus');
  assert.ok((host.getAttribute('aria-label') || '').length > 10, 'the focused globe has no name');
  const h = () => cam.positionCartographic.height;
  const h0 = h();
  assert.ok(key('+').defaultPrevented);
  assert.ok(near(h(), h0 / 2), '+ did not zoom in');
  key('-');
  assert.ok(near(h(), h0), '- did not zoom out');
  key('=');
  assert.ok(near(h(), h0 / 2), '= (the unshifted + key) did not zoom in');
  const before = h();
  assert.equal(key('+', { ctrlKey: true }).defaultPrevented, false, 'Ctrl + plus is the browser\'s page zoom');
  assert.equal(key('-', { metaKey: true }).defaultPrevented, false);
  assert.equal(h(), before);
  const flew = cam.__flew;
  key('0');
  assert.equal(cam.__flew, flew + 1, '0 did not reset the view');
  r.close();
});

test('Safari\'s trackpad pinch zooms the globe and follows the fingers', async () => {
  const { r, w, cam, host } = await globe();
  const h = () => cam.positionCartographic.height;
  const h0 = h();
  assert.ok(gesture(w, host, 'gesturestart', 1).defaultPrevented, 'Safari zoomed the page instead');
  assert.ok(gesture(w, host, 'gesturechange', 2).defaultPrevented);
  assert.ok(near(h(), h0 / 2), 'twice the spread should halve the height, got ' + h0 + ' -> ' + h());
  gesture(w, host, 'gesturechange', 0.5);
  assert.ok(near(h(), h0 * 2), 'pinching in did not double it');
  gesture(w, host, 'gestureend', 0.5);

  /* An iPhone or iPad sends the same events for fingers on the glass, which
     Cesium's own pinch already handles. */
  const h1 = h();
  touches(w, host, 'touchstart', 2);
  gesture(w, host, 'gesturestart', 1);
  gesture(w, host, 'gesturechange', 3);
  assert.equal(h(), h1, 'a touchscreen pinch was zoomed twice');
  touches(w, host, 'touchend', 0);
  r.close();
});

test('while the globe shows, the caption narrows and the key is told to re-measure', async () => {
  const { r, d, w } = await globe();
  const box = d.querySelector('.pnd-globe').parentNode;
  assert.ok(box.hasAttribute('data-pnd-globe'), 'the container is not marked while the globe shows');
  let told = 0;
  box.addEventListener('pnd-caption', () => told++);
  d.querySelector('.pnd-view-toggle').querySelectorAll('button')[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(!box.hasAttribute('data-pnd-globe'), 'still marked after switching to flat');
  assert.ok(told >= 1, 'the key was not told the caption changed size');
  r.close();
});

test('the globe tells a reader how to zoom and turn it', async () => {
  const { r, d } = await globe();
  const hint = d.querySelector('.pnd-hud-hint');
  assert.ok(hint, 'no hint');
  assert.match(hint.textContent, /scroll or pinch to zoom/i);
  assert.match(hint.textContent, /drag/i);
  r.close();
});

test('a page scroll that runs over the globe keeps scrolling; a pinch never does', async () => {
  const { r, w, d, cam, host } = await globe();
  const canvas = d.createElement('div');
  host.appendChild(canvas);
  const h = () => cam.positionCartographic.height;
  const h0 = h();
  wheel(w, d.body, {});
  const passing = wheel(w, canvas, {});
  await sleep(300);
  assert.equal(passing.defaultPrevented, false, 'a page scroll stopped dead over the globe');
  assert.equal(h(), h0, 'a page scroll passing over the globe zoomed it');
  const pinch = wheel(w, canvas, { ctrlKey: true, deltaY: PINCH_DOUBLE });
  assert.ok(pinch.defaultPrevented && near(h(), h0 / 2), 'a pinch right after a page scroll did not zoom the globe');
  await sleep(700);
  const own = wheel(w, canvas, { deltaY: 100 });
  await sleep(600);
  assert.ok(own.defaultPrevented && Math.abs(h() - h0) < h0 * 0.01, 'a scroll that starts on the globe did not zoom it');
  r.close();
});

test('the zoom controls do not cover the tags, and every new label is plain', () => {
  const src = read('globe.js');
  assert.match(src, /\.pnd-hud-zoom/, 'the zoom buttons are not styled');
  const sel = (src.match(/var sel = '([^']+)'/) || [])[1] || '';
  assert.match(sel, /\.pnd-hud-zoom/, 'event tags can be placed on top of the zoom buttons');
  for (const f of ['globe.js', 'map-setup.js']) {
    assert.doesNotMatch(read(f), /[\u2013\u2014]/, f + ' has an en or em dash');
  }
});

test('every camera setting and input the globe uses is real in the pinned Cesium', () => {
  /* The stub above accepts anything; this is what keeps a misremembered name
     from failing only in a reader's browser. */
  const api = JSON.parse(read(path.join('test', 'cesium-api.json')));
  const src = read('globe.js');
  for (const m of src.matchAll(/\bctl\.([A-Za-z]+)\s*=/g)) {
    assert.ok(api.members.ScreenSpaceCameraController.includes(m[1]), 'ScreenSpaceCameraController has no ' + m[1]);
  }
  for (const m of src.matchAll(/\bT\.([A-Z_]+)/g)) assert.ok(api.members.CameraEventType.includes(m[1]), 'CameraEventType.' + m[1]);
  for (const m of src.matchAll(/\bC3\.([A-Za-z]+)/g)) assert.ok(api.members.Cartesian3.includes(m[1]), 'Cartesian3 has no ' + m[1]);
  assert.ok(api.exports.includes('Cartesian2'));
  for (const m of src.matchAll(/\bcam\.([A-Za-z]+)/g)) assert.ok(api.members.Camera.includes(m[1]), 'Camera has no ' + m[1]);
  assert.ok(api.members.ScreenSpaceCameraController.includes('zoomEventTypes'));
});
