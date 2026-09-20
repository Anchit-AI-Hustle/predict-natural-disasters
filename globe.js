/*
 * The 3D globe, on every map in the app.
 *
 * Adapted from bilawalsidhu/gods-eye-view (MIT, Copyright (c) 2026 Bilawal
 * Sidhu) — its viewer configuration, its keyless imagery and terrain choices,
 * and the decision to run Cesium with no ion token at all. That project is a
 * real-time viewer built on CesiumJS 1.124; this takes its globe and feeds it
 * this site's hazard records.
 *
 * Two constraints shaped how it is wired in.
 *
 * Every page here builds its own Leaflet map and adds its own markers, with
 * its own colours, radii, popups and click handlers — sixteen pages of it. So
 * the globe does not replace that code and does not ask each page to call it.
 * It mirrors the Leaflet map it is given: whatever a page draws, the globe
 * shows, and a page that changes its markers gets a globe that follows without
 * knowing the globe exists.
 *
 * And Cesium is megabytes. Loading it up front would leave a blank panel on a
 * disaster site while it downloads, so the Leaflet map renders first and the
 * globe swaps in when it is ready. If WebGL is unavailable, the CDN is
 * unreachable, or anything throws, the flat map simply stays — a map that
 * works beats a globe that might.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var VERSION = '1.124.0';
  var BASE = 'https://unpkg.com/cesium@' + VERSION + '/Build/Cesium/';
  var PREF = 'pnd_map_view';

  /* Esri and Re:Earth both require credit, and Re:Earth's terrain is CC BY
     4.0, so the credit is a licence term rather than a courtesy. */
  var ESRI_IMAGERY =
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  var ESRI_CREDIT =
    'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  var TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
  var TERRAIN_CREDIT =
    '<a href="https://terrain.reearth.land/" target="_blank" rel="noopener">Re:Earth terrain</a> (CC BY 4.0)';

  function prefers() {
    try { return localStorage.getItem(PREF) || 'globe'; } catch (e) { return 'globe'; }
  }
  function remember(v) {
    try { localStorage.setItem(PREF, v); } catch (e) { /* private window */ }
  }

  /* A globe with no WebGL is a blank rectangle, so this is checked before
     anything is downloaded rather than after. */
  function webglOk() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  var loading = null;
  function loadCesium() {
    if (window.Cesium) return Promise.resolve(window.Cesium);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      try {
        window.CESIUM_BASE_URL = BASE;
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = BASE + 'Widgets/widgets.css';
        document.head.appendChild(css);
        var s = document.createElement('script');
        s.src = BASE + 'Cesium.js';
        s.async = true;
        s.onload = function () {
          window.Cesium ? resolve(window.Cesium) : reject(new Error('Cesium did not define itself'));
        };
        s.onerror = function () { reject(new Error('Cesium could not be fetched')); };
        document.head.appendChild(s);
      } catch (e) { reject(e); }
    });
    return loading;
  }

  /* What a page drew, read back off its Leaflet map. Only the public accessors
     are used — eachLayer, getLatLng, getPopup — so this does not depend on
     Leaflet internals that can change between releases. */
  function readMarkers(map) {
    var out = [];
    if (!map || typeof map.eachLayer !== 'function') return out;
    try {
      map.eachLayer(function (layer) {
        if (!layer || typeof layer.getLatLng !== 'function') return;
        var ll;
        try { ll = layer.getLatLng(); } catch (e) { return; }
        if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
        var o = layer.options || {};
        var html = '';
        try {
          var p = typeof layer.getPopup === 'function' ? layer.getPopup() : null;
          if (p && typeof p.getContent === 'function') html = String(p.getContent() || '');
        } catch (e) { /* no popup */ }
        out.push({
          lat: ll.lat, lon: ll.lng,
          colour: o.color || o.fillColor || '#25e29c',
          radius: Number(o.radius) || 7,
          html: html
        });
      });
    } catch (e) { /* a stub map */ }
    return out;
  }

  function mount(map, container) {
    if (!map || !container) return null;
    var host = document.createElement('div');
    host.className = 'pnd-globe';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;inset:0;z-index:400;background:#04120e';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(host);

    var viewer = null, entities = null, disposed = false;

    function destroy() {
      disposed = true;
      try { if (viewer && !viewer.isDestroyed()) viewer.destroy(); } catch (e) { /* gone */ }
      try { host.remove(); } catch (e) { /* gone */ }
    }

    function sync() {
      if (!viewer || disposed) return;
      var pts = readMarkers(map);
      try {
        entities.removeAll();
        for (var i = 0; i < pts.length; i++) {
          var p = pts[i];
          entities.add({
            position: window.Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
            point: {
              pixelSize: Math.max(6, Math.min(18, p.radius * 1.6)),
              color: window.Cesium.Color.fromCssColorString(p.colour),
              outlineColor: window.Cesium.Color.fromCssColorString('#04120e'),
              outlineWidth: 2,
              /* Without this a marker on the far side of the planet shows
                 through it, which reads as a second event in the ocean. */
              heightReference: window.Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: 0
            },
            description: p.html
          });
        }
      } catch (e) { /* mid-teardown */ }
    }

    var promise = loadCesium().then(function (Cesium) {
      if (disposed) return null;
      /* No ion token is set anywhere: the imagery and terrain below are the
         keyless pair gods-eye-view uses, so nothing here needs an account. */
      viewer = new Cesium.Viewer(host, {
        timeline: false, animation: false, baseLayerPicker: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, vrButton: false, selectionIndicator: false,
        infoBox: false, baseLayer: false, msaaSamples: 4,
        contextOptions: { webgl: { preserveDrawingBuffer: true } }
      });
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
      viewer.scene.skyAtmosphere.saturationShift = -0.12;
      viewer.scene.skyAtmosphere.brightnessShift = -0.08;
      entities = viewer.entities;

      Promise.resolve(Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_IMAGERY, {
        credit: ESRI_CREDIT, enablePickFeatures: false
      })).then(function (p) {
        if (!disposed && viewer && !viewer.isDestroyed()) viewer.imageryLayers.addImageryProvider(p);
      }).catch(function () { /* imagery is optional; the globe still orients */ });

      Promise.resolve(Cesium.CesiumTerrainProvider.fromUrl(TERRAIN, {
        requestVertexNormals: true, ellipsoid: Cesium.Ellipsoid.WGS84
      })).then(function (t) {
        if (disposed || !viewer || viewer.isDestroyed()) return;
        viewer.terrainProvider = t;
        try { viewer.creditDisplay.addStaticCredit(new Cesium.Credit(TERRAIN_CREDIT, true)); }
        catch (e) { /* older credit API */ }
      }).catch(function () { /* flat ellipsoid is a fine fallback */ });

      sync();
      return viewer;
    });

    return { host: host, sync: sync, destroy: destroy, ready: promise,
      viewer: function () { return viewer; } };
  }

  window.PNDGlobe = {
    mount: mount, readMarkers: readMarkers, webglOk: webglOk,
    prefers: prefers, remember: remember, BASE: BASE, PREF: PREF
  };
})();
