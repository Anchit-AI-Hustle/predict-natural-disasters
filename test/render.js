'use strict';
/**
 * Renders a real page from the repository inside jsdom with the live APIs
 * served by the real handlers over mocked upstreams - so a page test exercises
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
/* Background alerts, answered as a deployment with no alert store or schedule
   answers - which is what the handler reads from an empty environment. A test
   of the switched-on state serves its own answer from beforeParse. */
const alertsHandler = require(path.join(ROOT, 'api', 'alerts.js'));

/** Enough of Leaflet for the pages' map calls to run without the real library. */
const LEAFLET_STUB = `
(function(){
  /* Markers record what they were given. The globe mirrors whatever a page
     drew on its Leaflet map, reading it back through getLatLng/getPopup, so a
     stub that forgets its arguments would let that mirroring pass untested. */
  function chain(a, b){ var o = {
    addTo:function(t){ if(t && t.__take){ t.__take(o); if (t.__map) o.__map = t.__map; } return o; },
    bindPopup:function(h){ o.__popup = h; return o; },
    openPopup:function(){return o}, setView:function(){return o},
    /* Real Leaflet removes each child from the map, which fires layerremove
       on it. Without that the globe never learns the page cleared its markers. */
    clearLayers:function(){ o.__kids = []; if (o.__map) o.__map.fire('layerremove'); return o; },
    getLayers:function(){ return o.__kids || []; },
    fitBounds:function(){return o}, getBounds:function(){return {pad:function(){return {}}}},
    remove:function(){return o}, on:function(){return o},
    addLayer:function(l){ (o.__kids = o.__kids || []).push(l); return o; },
    setLatLng:function(){return o}, setStyle:function(){return o}, flyTo:function(){return o},
    getZoom:function(){return 3},
    getPopup:function(){ return o.__popup === undefined ? null
      : { getContent:function(){ return o.__popup; } }; },
    __take:function(l){ (o.__kids = o.__kids || []).push(l); }
  }; return o; }
  function markerStub(latlng, opts){
    var o = chain();
    o.options = opts || {};
    if (Array.isArray(latlng)) o.__ll = { lat: latlng[0], lng: latlng[1] };
    else if (latlng && typeof latlng === 'object') o.__ll = { lat: latlng.lat, lng: latlng.lng };
    o.getLatLng = function(){ return o.__ll; };
    return o;
  }
  /* The map stub models the pieces map-setup.js drives: an event bus, a
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
    /* Sizing: jsdom lays nothing out, so the stub reports the height the page
       actually asked for. That is what map-setup.js measures to decide the
       zoom at which the whole world fits. */
    m.getSize = function(){
      var h = node && node.style && /(\d+)px/.test(node.style.height) ? +RegExp.$1 : 0;
      if (!h && node && node.className) h = /mapTall/.test(node.className) ? 520 : 460;
      return { x: 800, y: h || 460 };
    };
    m.setMinZoom = function(z){ m.__minZoom = z; return m; };
    m.setMaxBounds = function(b){ m.__maxBounds = b; return m; };
    m.invalidateSize = function(){ m.__invalidated = (m.__invalidated || 0) + 1; return m; };
    /* As Leaflet does: a move ends in moveend, and a map with no view yet
       has no centre to give. */
    m.setView = function(c, z){ m.__view = { center: c, zoom: z }; m.fire('moveend'); return m; };
    m.flyTo = m.setView;
    m.getCenter = function(){
      if (!m.__view) throw new Error('Set map center and zoom first.');
      var c = m.__view.center;
      return Array.isArray(c) ? { lat: +c[0], lng: +c[1] } : { lat: +c.lat, lng: +(c.lng !== undefined ? c.lng : c.lon) };
    };
    m.getZoom = function(){ return m.__view ? m.__view.zoom : 3; };
    /* What a pinch drives: a zoom about the point under the fingers. */
    m.setZoomAround = function(p, z){
      m.__around = p;
      m.__view = { center: m.__view ? m.__view.center : [20, 0], zoom: z };
      m.fire('moveend'); return m; };
    m.mouseEventToContainerPoint = function(e){ return { x: e.clientX || 0, y: e.clientY || 0 }; };
    m.on = function(name, fn){
      String(name).split(' ').forEach(function(n){ (handlers[n] = handlers[n] || []).push(fn); });
      return m; };
    m.off = function(name, fn){
      String(name).split(' ').forEach(function(n){
        handlers[n] = (handlers[n]||[]).filter(function(f){ return f !== fn; }); });
      return m; };
    m.fire = function(name){ (handlers[name]||[]).forEach(function(fn){ fn({type:name}); }); return m; };
    /* Layers added to the map, which is what the globe reads back. */
    m.__layers = [];
    m.__take = function(l){ l.__map = m; m.__layers.push(l); m.fire('layeradd'); };
    m.addLayer = function(l){ m.__take(l); return m; };
    m.eachLayer = function(fn){
      m.__layers.forEach(function(l){
        fn(l);
        (l.__kids || []).forEach(fn);
      });
      return m; };
    window.__pndMaps = window.__pndMaps || [];
    window.__pndMaps.push(m);
    return m;
  }
  window.L = {
    map: mapStub, tileLayer: chain, layerGroup: chain, circleMarker: markerStub,
    circle: markerStub, marker: markerStub, featureGroup: chain, polygon: chain,
    geoJSON: chain, divIcon: chain, icon: chain, control: {layers: chain, scale: chain}
  };
})();
`;

/*
 * Enough of Cesium, and of WebGL, for the globe to mount.
 *
 * jsdom has no WebGL at all, so PNDGlobe.webglOk() is false there and the
 * globe would silently never be built - every assertion about it would pass
 * against a page that had no globe. The canvas reports a context and Cesium is
 * present before parse, so loadCesium() resolves without reaching a CDN.
 */
const CESIUM_STUB = `
(function(){
  var proto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
  if (proto) {
    var real = proto.getContext;
    proto.getContext = function(kind){
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
        return { drawingBufferWidth: 800, drawingBufferHeight: 460,
          getExtension:function(){ return null; }, getParameter:function(){ return 0; } };
      }
      if (kind === '2d') {
        /* jsdom has no 2d canvas without the canvas npm package, and merely
           asking it for one raises "Not implemented" on the virtual console,
           which the page-error test reads as a broken page. So this never
           calls through: the globe paints the world into a canvas, and that
           whole path - the palette, the antimeridian, the imagery layer it
           produces - would otherwise go unexercised here. Both work in the
           real browser; tools/globe-browser-check.js is what checks that. */
        var ops = { fills: [], strokes: 0, paths: 0 };
        this.__ops = ops;
        /* Also on the window: the globe paints into a canvas it never appends
           to the document, so there is no other way to reach what it drew. */
        (window.__pndPaints = window.__pndPaints || []).push(ops);
        return {
          fillStyle: '', strokeStyle: '', lineWidth: 1,
          fillRect: function () { ops.fills.push('rect:' + this.fillStyle); },
          beginPath: function () { ops.paths++; },
          moveTo: function () {}, lineTo: function () {}, closePath: function () {},
          fill: function (rule) { ops.fills.push((rule || 'nonzero') + ':' + this.fillStyle); },
          stroke: function () { ops.strokes++; },
          drawImage: function () {},
          getImageData: function () { return { data: [] }; }
        };
      }
      return real ? real.apply(this, arguments) : null;
    };
    /* Overridden outright for the same reason: jsdom's own throws. */
    proto.toDataURL = function () { return 'data:image/png;base64,c3R1Yg=='; };
  }
  if (!window.WebGLRenderingContext) window.WebGLRenderingContext = function(){};
  function ok(v){ return Promise.resolve(v); }
  window.__pndViewers = [];
  window.Cesium = {
    Viewer: function(host, opts){
      var destroyed = false;
      var ents = [];
      this.__host = host; this.__opts = opts;
      /* Faithful enough for the code paths that read it. The camera and the
         canvas were missing, so the framing the globe does on every mount
         threw, the mount was abandoned, and the tests reported no globe. */
      /* Where the camera is, kept in step with every way of moving it, so a
         test can read the height a zoom left it at. */
      function placed(cam, d) {
        if (d && isFinite(d.height)) cam.positionCartographic.height = d.height;
      }
      this.camera = {
        frustum: { fov: Math.PI / 3, aspectRatio: 2 },
        positionWC: { x: 0, y: 0, z: 0 },
        positionCartographic: { longitude: 0, latitude: 0, height: 20000000 },
        heading: 0, pitch: -Math.PI / 2, roll: 0,
        setView: function (o) { this.__view = o; placed(this, o.destination); },
        flyTo: function (o) { this.__view = o; this.__flew = (this.__flew || 0) + 1; placed(this, o.destination);
          if (o.complete) o.complete(); },
        cancelFlight: function () {},
        /* Nothing under the pointer in a stub, so a zoom goes straight in. */
        pickEllipsoid: function () { return undefined; },
        move: function () {},
        zoomIn: function (a) { this.positionCartographic.height -= a; },
        zoomOut: function (a) { this.positionCartographic.height += a; }
      };
      /* Cesium's defaults: wheel, pinch and right-drag zoom, no limits. */
      this.scene = { skyAtmosphere: {}, globe: {}, camera: this.camera,
        screenSpaceCameraController: { zoomEventTypes: [1, 3, 4], minimumZoomDistance: 1, maximumZoomDistance: Infinity },
        requestRender: function () {},
        canvas: { clientWidth: 800, clientHeight: 400, width: 800, height: 400 } };
      /* Every layer, in the order it went on, not just the last one. The
         globe now stacks the painted world, the satellite imagery and the
         reference layer, and which sits under which is the whole fallback:
         keeping only __added could not tell them apart. */
      this.imageryLayers = { length: 0, __all: [],
        addImageryProvider: function(p){ this.length++; this.__added = p; this.__all.push(p); return p; } };
      this.creditDisplay = { addStaticCredit: function(c){ (window.__pndCredits = window.__pndCredits || []).push(c); } };
      this.entities = {
        values: ents,
        add: function(e){ ents.push(e); return e; },
        removeAll: function(){ ents.length = 0; }
      };
      this.terrainProvider = null;
      this.isDestroyed = function(){ return destroyed; };
      this.destroy = function(){ destroyed = true; };
      window.__pndViewers.push(this);
    },
    Cartesian3: { fromDegrees: function(lon, lat, h){ return { lon: lon, lat: lat, height: h }; },
      fromRadians: function(lon, lat, h){ return { lon: lon * 180 / Math.PI, lat: lat * 180 / Math.PI, height: h }; } },
    Cartesian2: function(x, y){ this.x = x; this.y = y; },
    CameraEventType: { LEFT_DRAG: 0, RIGHT_DRAG: 1, MIDDLE_DRAG: 2, WHEEL: 3, PINCH: 4 },
    KeyboardEventModifier: { SHIFT: 0, CTRL: 1, ALT: 2 },
    Color: { fromCssColorString: function(c){ return { css: c }; } },
    HeightReference: { CLAMP_TO_GROUND: 'clamp' },
    Ellipsoid: { WGS84: 'wgs84' },
    Credit: function(text){ this.text = text; },
    ArcGisMapServerImageryProvider: { fromUrl: function(u, o){ return ok({ url: u, opts: o }); } },
    SingleTileImageryProvider: { fromUrl: function(u, o){ return ok({ url: u, opts: o, tileWidth: 2048, tileHeight: 1024, maximumLevel: 0 }); } },
    /* Constructed, not fetched: the tiled provider takes its template as-is
       and asks for tiles from it, which is the reason the globe uses it. */
    UrlTemplateImageryProvider: function(o){
      /* Cesium reports a tile that failed through the provider's errorEvent;
         __fail raises it, so a test can take a tile host down. */
      var heard = [];
      this.errorEvent = { addEventListener: function(f){ heard.push(f); } };
      this.__fail = function(n){ for (var i = 0; i < (n || 1); i++) heard.forEach(function(f){ f({}); }); };
      this.url = o && o.url; this.opts = o;
      this.tileWidth = 256; this.tileHeight = 256;
      this.maximumLevel = o && o.maximumLevel;
      this.credit = o && o.credit;
    },
    CesiumTerrainProvider: { fromUrl: function(u, o){ return ok({ url: u, opts: o }); } }
  };
})();
`;

class RepoLoader extends ResourceLoader {
  fetch(url, options) {
    /* The map library, stubbed rather than served.
       The real one is in this repository now (vendor/leaflet), so without
       this it would be loaded from disk and overwrite the stub - and with it
       the recorded maps, the reported container height and the observable
       zoom state that every map and globe test reads. Real Leaflet is
       exercised in a real browser instead, by tools/map-fallback-check.js and
       tools/layout-browser-check.js; jsdom gets the stub it can see into. */
    if (/(unpkg\.com\/leaflet[^/]*\/dist\/leaflet|\/vendor\/leaflet\/leaflet)\.js$/.test(url)) {
      return Promise.resolve(Buffer.from(LEAFLET_STUB));
    }
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
 *   url  serve this file at a different address - how 404.html is reached in
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
      // Pages that read saved state on load need it in place before their
      // scripts run, not after.
      if (o.storage) {
        for (const [k, v] of Object.entries(o.storage)) {
          try { window.localStorage.setItem(k, v); } catch (e) { /* no storage */ }
        }
      }
      window.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        apiCalls.push(url);
        if (url.includes('/api/event-enrichment')) return callApi(enrichHandler, url, o.mock);
        if (/\/api\/alerts(?:\?|$)/.test(url)) return callApi(alertsHandler, url, o.mock);
        // feedDown is the endpoint itself being unreachable, which is not the
        // same as every upstream provider being down: that still returns 200.
        if (url.includes('/api/events')) {
          /* A fixed feed (a snapshot of the live one, test/fixtures), served as
             it is rather than rebuilt from the mocked upstreams. */
          if (o.feed) {
            const body = typeof o.feed === 'string' ? JSON.parse(fs.readFileSync(o.feed, 'utf8')) : o.feed;
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
          }
          if (o.feedDown) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
          return callApi(eventsHandler, url, o.mock);
        }
        // The ledgers are static files the pages fetch like any other asset.
        // They were not served here, so /accuracy - the page whose whole job is
        // to report the verification record - could only ever render its
        // "data unavailable" branch, and nothing tested what it publishes.
        /* The ledgers under /data, and the root-level JSON the basemap is
           built from. world-countries.json was not served either, so both
           the flat map and the globe drew an empty world here and nothing
           tested the countries, the palette or the antimeridian. */
        const dataMatch = url.match(/\/data\/[\w.-]+\.json/) ||
          url.match(/^(?:https?:\/\/[^/]+)?\/[\w.-]+\.json$/);
        if (dataMatch) {
          const file = path.join(ROOT, (dataMatch[0].replace(/^https?:\/\/[^/]+/, '')).replace(/^\//, ''));
          if (file.startsWith(ROOT) && fs.existsSync(file)) {
            const body = JSON.parse(fs.readFileSync(file, 'utf8'));
            return { ok: true, status: 200, headers: { get: () => null },
              json: async () => body, text: async () => JSON.stringify(body) };
          }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
      };
      /* beforeParse runs before there is a document, so this is evaluated
         into the window rather than appended as a script element. */
      if (o.cesium !== false) window.eval(CESIUM_STUB);
      window.addEventListener('error', e => errors.push(e.error || new Error(e.message)));
      window.addEventListener('unhandledrejection', e => errors.push(e.reason));
      /* A last word for the test, after fetch and the stubs are in place and
         still before any page script runs. Browser APIs jsdom does not
         implement - Notification among them - can only be stood up here. */
      if (typeof o.beforeParse === 'function') o.beforeParse(window);
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
  /* ready() can go true in the same turn the page's own scripts ran in: every
     fetch here resolves from memory, so a whole load chain can complete in
     microtasks without the event loop ever coming back round. Anything the
     page deferred to a timer - a dropdown it fills on the next tick - has not
     run at that point, and reading the DOM now reports an instant no reader
     ever sees. Give the window's own timers their turn first. */
  for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0));

  OPEN_WINDOWS.add(window);
  return {
    window, document: window.document, errors, apiCalls,
    text: () => window.document.body.textContent.replace(/\s+/g, ' ').trim(),
    html: () => window.document.body.innerHTML,
    close: () => { OPEN_WINDOWS.delete(window); try { window.close(); } catch (e) { /* already gone */ } }
  };
}

/** First live official record from the mocked feed - the id a detail page opens with. */
async function sampleEvents(mockOpts) {
  const r = await callApi(eventsHandler, '/api/events', mockOpts);
  return (await r.json()).events;
}

module.exports = { renderPage, sampleEvents, callApi, closeAllWindows, ORIGIN };
