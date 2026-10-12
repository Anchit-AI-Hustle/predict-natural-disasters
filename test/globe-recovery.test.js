'use strict';
/**
 * The globe on a device that cannot, or cannot yet, start it.
 *
 * Reported from an iPhone: "only the flat map". Every way the globe could fail
 * ended the same way - torn down in silence, with the Globe button flipped
 * back to Flat - so the reader could not tell a slow download from a blocked
 * CDN from a phone that refused WebGL 2. And the failed download was
 * remembered: the loader kept its rejected promise, so pressing Globe again
 * did nothing until the page was reloaded.
 *
 * These pin the recovery: a second CDN, a lighter viewer and then a WebGL 1
 * viewer before giving up, a sentence saying what happened, and a Try again
 * that really tries again.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
test.after(closeAllWindows);

const note = d => d.querySelector('.pnd-globe-note');
const pressed = d => [...d.querySelectorAll('.pnd-view-toggle button')]
  .map(b => b.textContent + ':' + b.getAttribute('aria-pressed')).join(' ');

/* globe.js alone, with a document whose script tags this test loads or fails
   by hand, so the loader can be driven host by host. */
function loaderSandbox() {
  const vm = require('node:vm');
  const scripts = [];
  const el = tag => ({ tag, style: { cssText: '' }, className: '', appendChild() {},
    setAttribute() {}, remove() { this.removed = true; }, addEventListener() {} });
  const window = {};
  const ctx = vm.createContext({
    window,
    document: {
      createElement: el,
      head: { appendChild: n => { if (n.tag === 'script') scripts.push(n); } },
      documentElement: el()
    },
    navigator: { userAgent: 'test', maxTouchPoints: 0 },
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ position: 'relative' }),
    Promise, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'globe.js'), 'utf8'), ctx);
  return { window, scripts, G: window.PNDGlobe };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the 3D library comes from a second host when the first is unreachable', async () => {
  const { window, scripts, G } = loaderSandbox();
  assert.equal(G.BASES.length, 2);
  assert.match(G.BASES[1], /^https:\/\/cdn\.jsdelivr\.net\/npm\/cesium@[\d.]+\/Build\/Cesium\/$/);
  const p = G.__loadCesium();
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].src.startsWith(G.BASES[0]));
  scripts[0].onerror();
  await tick();
  assert.equal(scripts.length, 2, 'the second host was never tried');
  assert.ok(scripts[1].src.startsWith(G.BASES[1]));
  assert.equal(window.CESIUM_BASE_URL, G.BASES[1],
    'Cesium would fetch its workers from the host that failed');
  window.Cesium = { ok: true };
  scripts[1].onload();
  assert.deepEqual(await p, { ok: true });
});

test('a failed download is tried again, not remembered', async () => {
  const { window, scripts, G } = loaderSandbox();
  const first = G.__loadCesium();
  scripts[0].onerror(); await tick();
  scripts[1].onerror();
  await assert.rejects(first, /could not be downloaded/);
  const second = G.__loadCesium();
  assert.equal(scripts.length, 3, 'the second press reused the failed attempt');
  window.Cesium = { again: true };
  scripts[2].onload();
  assert.deepEqual(await second, { again: true });
});

/* A Viewer that throws for the levels listed, as iOS Safari does when WebGL 2
   or a multisampled buffer cannot be had. */
function failingViewer(win, fails) {
  /* The original, kept once, so a second call replaces the failure rather
     than wrapping it. */
  const Real = win.__RealViewer || (win.__RealViewer = win.Cesium.Viewer);
  win.__levels = [];
  win.Cesium.Viewer = function (host, opts) {
    const level = opts.contextOptions && opts.contextOptions.requestWebgl1 ? 2 : opts.msaaSamples === 1 ? 1 : 0;
    win.__levels.push(level);
    if (fails.includes(level)) throw new Error('WebGL initialisation failed');
    return Real.call(this, host, opts) || this;
  };
}

test('a phone gets the light viewer first', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => {
      Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
      failingViewer(w, []);
    },
    waitFor: d => d.querySelector('.pnd-globe') && d.querySelector('.pnd-globe').style.display !== 'none' });
  assert.deepEqual(r.window.__levels, [1]);
  const opts = r.window.__pndViewers[0].__opts;
  assert.equal(opts.msaaSamples, 1);
  assert.ok(!(opts.contextOptions.webgl || {}).preserveDrawingBuffer,
    'a phone was asked to keep a preserved drawing buffer');
  r.window.close();
});

test('when WebGL 2 will not start, the globe tries WebGL 1 before giving up', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => failingViewer(w, [0, 1]),
    waitFor: d => d.querySelector('.pnd-globe') && d.querySelector('.pnd-globe').style.display !== 'none' });
  assert.deepEqual(r.window.__levels, [0, 2]);
  assert.equal(r.window.__pndViewers.length, 1);
  assert.equal(r.window.__pndViewers[0].__opts.contextOptions.requestWebgl1, true);
  assert.match(pressed(r.document), /Globe:true/);
  assert.ok(note(r.document).hidden, 'a working globe still showed a failure notice');
  assert.deepEqual(r.errors.map(e => String(e && e.message)), []);
  r.window.close();
});

test('a device that cannot start the globe at all is told so, and can try again', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => failingViewer(w, [0, 1, 2]),
    waitFor: d => d.querySelector('.pnd-globe-note') && !d.querySelector('.pnd-globe-note').hidden &&
      /could not open/.test(d.querySelector('.pnd-globe-note').textContent) });
  const d = r.document, w = r.window;
  assert.equal(d.querySelector('.pnd-globe'), null, 'a dead globe was left over the map');
  assert.match(pressed(d), /Globe:false Flat:true/);
  assert.match(note(d).textContent, /could not start 3D graphics.*Showing the flat map/);
  const retry = [...note(d).querySelectorAll('button')].find(b => b.textContent === 'Try again');
  assert.ok(retry && !retry.hidden, 'no way to try again');

  /* The device recovers (memory freed, say): Try again builds the globe. */
  w.__levels.length = 0;
  failingViewer(w, []);
  retry.click();
  for (let i = 0; i < 80 && !(d.querySelector('.pnd-globe') && d.querySelector('.pnd-globe').style.display !== 'none'); i++) {
    await new Promise(res => setTimeout(res, 50));
  }
  assert.ok(d.querySelector('.pnd-globe') && d.querySelector('.pnd-globe').style.display !== 'none',
    'Try again did not bring the globe back');
  assert.ok(note(d).hidden, 'the failure notice stayed up over a working globe');
  assert.match(pressed(d), /Globe:true/);
  assert.deepEqual(r.errors.map(e => String(e && e.message)), []);
  w.close();
});

test('a globe that loses its graphics later drops back to flat and says why', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => {
      const Real = w.Cesium.Viewer;
      w.Cesium.Viewer = function (host, opts) {
        Real.call(this, host, opts);
        const heard = {};
        this.scene.canvas.addEventListener = (type, f) => { heard[type] = f; };
        this.scene.renderError = { addEventListener: f => { heard.renderError = f; } };
        w.__lose = () => heard.webglcontextlost({ preventDefault() {} });
      };
    },
    waitFor: d => d.querySelector('.pnd-globe') && d.querySelector('.pnd-globe').style.display !== 'none' });
  const d = r.document;
  r.window.__lose();
  assert.equal(d.querySelector('.pnd-globe'), null);
  assert.match(pressed(d), /Flat:true/);
  assert.match(note(d).textContent, /ran short of graphics memory/);
  r.window.close();
});

test('with no WebGL, pressing Globe explains instead of doing nothing', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000, cesium: false });
  const d = r.document;
  assert.match(pressed(d), /Globe:false Flat:true/);
  assert.ok(note(d).hidden, 'the reason was shown before anyone asked for the globe');
  d.querySelector('.pnd-view-toggle button').click();
  assert.equal(d.querySelector('.pnd-globe'), null);
  assert.match(note(d).textContent, /WebGL/);
  assert.match(pressed(d), /Flat:true/);
  r.window.close();
});

test('a slow download says the globe is on its way, and stops saying it when it arrives', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => {
      const C = w.Cesium; delete w.Cesium;
      /* The download is held, as on a slow phone connection: the script tag
         is kept here instead of being added to the page. */
      const add = w.Node.prototype.appendChild;
      w.Node.prototype.appendChild = function (n) {
        if (n && n.tagName === 'SCRIPT' && /Cesium\.js$/.test(n.src || '')) { w.__held = n; return n; }
        return add.call(this, n);
      };
      w.__arrive = () => { w.Cesium = C; w.__held.onload(); };
    },
    waitFor: d => d.querySelector('.pnd-globe-note') && !d.querySelector('.pnd-globe-note').hidden });
  const d = r.document;
  assert.match(note(d).textContent, /^Loading the 3D globe/);
  assert.equal(d.querySelector('.pnd-globe').style.display, 'none', 'a blank panel covered the map while loading');
  r.window.__arrive();
  for (let i = 0; i < 60 && d.querySelector('.pnd-globe').style.display === 'none'; i++) {
    await new Promise(res => setTimeout(res, 50));
  }
  assert.notEqual(d.querySelector('.pnd-globe').style.display, 'none', 'the globe never appeared');
  assert.ok(note(d).hidden, 'still saying it is loading after it loaded');
  r.window.close();
});

test('a reader who switched to Flat while it loaded is not told it failed', async () => {
  const r = await renderPage('live-map.html', { timeoutMs: 12000,
    beforeParse: w => {
      delete w.Cesium;
      const add = w.Node.prototype.appendChild;
      w.Node.prototype.appendChild = function (n) {
        if (n && n.tagName === 'SCRIPT' && /Cesium\.js$/.test(n.src || '')) { (w.__held = w.__held || []).push(n); return n; }
        return add.call(this, n);
      };
    },
    waitFor: (d, w) => w.__held && w.__held.length === 1 });
  const d = r.document, w = r.window;
  d.querySelectorAll('.pnd-view-toggle button')[1].click();
  w.__held[0].onerror();
  for (let i = 0; i < 40 && w.__held.length < 2; i++) await new Promise(res => setTimeout(res, 25));
  w.__held[1].onerror();
  await new Promise(res => setTimeout(res, 100));
  assert.match(pressed(d), /Flat:true/);
  assert.ok(note(d).hidden, 'a failure was announced to a reader who had chosen Flat');
  assert.equal(d.querySelector('.pnd-globe'), null);
  r.window.close();
});

/* Reported from the Globe Check: "Draw the Earth - Render error: Request has
   failed." Cesium downloads data files from the CDN while it draws, and where
   one is refused it stops, or - for the terrain-height table - never shows a
   single hazard. tools/globe-browser-check.js with BLOCK_ASSETS=1 proves the
   globe works with every one of them refused; these keep the causes out. */
test('the globe does not create the star field, sun or moon it would have to download', () => {
  const src = fs.readFileSync(path.join(ROOT, 'globe.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const opts = src.slice(src.indexOf('new Cesium.Viewer('), src.indexOf('new Cesium.Viewer(') + 2500);
  assert.match(opts, /skyBox:\s*false/);
});

test('nothing on the globe is clamped to the ground, which needs the terrain table', () => {
  const src = fs.readFileSync(path.join(ROOT, 'globe.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(src, /CLAMP_TO_GROUND|RELATIVE_TO_GROUND/);
  assert.match(src, /initializeTerrainHeights\(\)\)[\s\S]{0,80}\.then\(/, 'the terrain-table preload is not handled');
  assert.match(src, /preloadIcrfFixed\([\s\S]{0,300}\.catch\(/, 'the Earth-orientation preload is not handled');
});
