'use strict';
/**
 * Renders a real page from the repository inside jsdom with the live APIs
 * served by the real handlers over mocked upstreams — so a page test exercises
 * the same path a browser does: HTML -> portal.js -> /api/events ->
 * /api/event-enrichment -> rendered DOM.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { makeFetch, mockRes } = require('./mock-upstreams.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://localhost';

/** Windows still open when a test throws would keep the runner's event loop alive. */
const OPEN_WINDOWS = new Set();
function closeAllWindows() {
  for (const w of OPEN_WINDOWS) { try { w.close(); } catch (e) { /* already gone */ } }
  OPEN_WINDOWS.clear();
}
process.on('beforeExit', closeAllWindows);

const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const enrichHandler = require(path.join(ROOT, 'api', 'event-enrichment.js'));

/** Enough of Leaflet for the pages' map calls to run without the real library. */
const LEAFLET_STUB = `
(function(){
  function chain(){ var o = {
    addTo:function(){return o}, bindPopup:function(){return o}, openPopup:function(){return o},
    setView:function(){return o}, clearLayers:function(){return o}, getLayers:function(){return []},
    fitBounds:function(){return o}, getBounds:function(){return {pad:function(){return {}}}},
    remove:function(){return o}, on:function(){return o}, addLayer:function(){return o},
    setLatLng:function(){return o}, setStyle:function(){return o}, flyTo:function(){return o},
    getZoom:function(){return 3}
  }; return o; }
  /* The map stub models the pieces map-scroll.js drives: an event bus, a
     container, and a scrollWheelZoom handler whose state the tests inspect. */
  function mapStub(el, opts){
    var handlers = {};
    var wheel = !opts || opts.scrollWheelZoom !== false;
    var node = typeof el === 'string' ? document.getElementById(el) : el;
    var m = chain();
    m.options = opts || {};
    m.scrollWheelZoom = {
      enable:function(){ wheel = true; }, disable:function(){ wheel = false; },
      enabled:function(){ return wheel; }
    };
    m.getContainer = function(){ return node; };
    m.on = function(name, fn){ (handlers[name] = handlers[name] || []).push(fn); return m; };
    m.fire = function(name){ (handlers[name]||[]).forEach(function(fn){ fn({type:name}); }); return m; };
    window.__pndMaps = window.__pndMaps || [];
    window.__pndMaps.push(m);
    return m;
  }
  window.L = {
    map: mapStub, tileLayer: chain, layerGroup: chain, circleMarker: chain,
    circle: chain, marker: chain, featureGroup: chain, polygon: chain,
    geoJSON: chain, divIcon: chain, icon: chain, control: {layers: chain, scale: chain}
  };
})();
`;

class RepoLoader extends ResourceLoader {
  fetch(url, options) {
    if (/unpkg\.com\/leaflet.*\.js$/.test(url)) return Promise.resolve(Buffer.from(LEAFLET_STUB));
    if (url.startsWith(ORIGIN)) {
      const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return Promise.resolve(fs.readFileSync(file));
      }
      return Promise.resolve(Buffer.from(''));
    }
    // Every other external asset (CSS, thumbnails, fonts) resolves empty.
    return Promise.resolve(Buffer.from(''));
  }
}

/** Runs an API handler with the upstream mock installed and returns a Response-like object. */
async function callApi(handler, urlString, mockOpts) {
  const u = new URL(urlString, ORIGIN);
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const res = mockRes();
  const realFetch = global.fetch;
  global.fetch = makeFetch(mockOpts || {});
  try {
    await handler({ query, url: u.pathname + u.search, method: 'GET', headers: {} }, res);
  } finally {
    global.fetch = realFetch;
  }
  const body = res.body;
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    headers: { get: k => res.headers[String(k).toLowerCase()] || null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

/**
 * @param {string} page  file name, e.g. 'event-detail.html'
 * @param {object} opts  { search, url, mock, feedDown, waitFor, timeoutMs }
 *   url  serve this file at a different address — how 404.html is reached in
 *        production, where the path is the route the visitor actually asked for.
 */
async function renderPage(page, opts) {
  const o = opts || {};
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e));
  virtualConsole.on('error', (...a) => errors.push(new Error(a.map(String).join(' '))));

  const apiCalls = [];
  const dom = new JSDOM(html, {
    url: o.url ? ORIGIN + o.url : ORIGIN + '/' + page + (o.search || ''),
    runScripts: 'dangerously',
    resources: new RepoLoader(),
    virtualConsole,
    beforeParse(window) {
      window.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        apiCalls.push(url);
        if (url.includes('/api/event-enrichment')) return callApi(enrichHandler, url, o.mock);
        // feedDown is the endpoint itself being unreachable, which is not the
        // same as every upstream provider being down: that still returns 200.
        if (url.includes('/api/events')) {
          if (o.feedDown) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
          return callApi(eventsHandler, url, o.mock);
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
      };
      window.addEventListener('error', e => errors.push(e.error || new Error(e.message)));
      window.addEventListener('unhandledrejection', e => errors.push(e.reason));
    }
  });

  const { window } = dom;
  const deadline = Date.now() + (o.timeoutMs || 8000);
  const ready = o.waitFor || (() => true);
  // Let the page's own async load() chain settle.
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 60));
    try { if (ready(window.document, window)) break; } catch (e) { /* keep waiting */ }
  }

  OPEN_WINDOWS.add(window);
  return {
    window, document: window.document, errors, apiCalls,
    text: () => window.document.body.textContent.replace(/\s+/g, ' ').trim(),
    html: () => window.document.body.innerHTML,
    close: () => { OPEN_WINDOWS.delete(window); try { window.close(); } catch (e) { /* already gone */ } }
  };
}

/** First live official record from the mocked feed — the id a detail page opens with. */
async function sampleEvents(mockOpts) {
  const r = await callApi(eventsHandler, '/api/events', mockOpts);
  return (await r.json()).events;
}

module.exports = { renderPage, sampleEvents, callApi, closeAllWindows, ORIGIN };
