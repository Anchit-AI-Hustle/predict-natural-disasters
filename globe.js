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

  /* Re:Earth's terrain is CC BY 4.0, so the credit is a licence term rather
     than a courtesy. */
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
        /* The basemap draws every country's name as a marker, and a marker
           has a position like any other. Mirrored blindly they became green
           points, so the globe showed an event in the middle of Canada and
           Brazil that does not exist — the worst thing a hazard map can do.

           Excluded on being non-interactive, which the labels are and no
           page's event marker is, plus the label pane by name. The first
           version of this rejected any layer carrying a pane at all, which
           looked equivalent and was catastrophic: every real Leaflet marker
           inherits a default pane — markerPane or overlayPane — so it threw
           away every hazard and left the globe empty. The unit test missed it
           because its fixtures were bare objects with no Leaflet defaults. */
        var labelPane = (window.PNDMap && window.PNDMap.LABEL_PANE) || 'pndLabels';
        if (o.interactive === false || o.pane === labelPane) return;
        var html = '';
        try {
          var p = typeof layer.getPopup === 'function' ? layer.getPopup() : null;
          if (p && typeof p.getContent === 'function') html = String(p.getContent() || '');
        } catch (e) { /* no popup */ }
        out.push({
          lat: ll.lat, lon: ll.lng,
          colour: o.color || o.fillColor || '#25e29c',
          radius: Number(o.radius) || 7,
          html: html, title: titleOf(html)
        });
      });
    } catch (e) { /* a stub map */ }
    return out;
  }

  /* The heading a hazard gets on the globe.
   *
   * Without one, Cesium heads its info box with the entity's own generated
   * id, so clicking a flood in Nepal opened a panel titled
   * "2d209c77-12a8-4d55-ba59-414a34cd6853". The page's popup already leads
   * with the event's name in bold, which is the same heading the flat map
   * gives it, so that is what is used. */
  function titleOf(html) {
    if (!html) return '';
    var m = /<b[^>]*>([\s\S]*?)<\/b>/i.exec(html);
    var t = String(m ? m[1] : html).replace(/<[^>]*>/g, ' ');
    try {
      /* Entity references come through the popup as written; a textarea
         decodes them without running anything. */
      var box = document.createElement('textarea');
      box.innerHTML = t;
      t = box.value;
    } catch (e) { /* leave it encoded rather than lose the title */ }
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 120 ? t.slice(0, 119) + '…' : t;
  }

  function shared(key, fallback) {
    var m = window.PNDMap;
    return (m && m[key] !== undefined) ? m[key] : fallback;
  }

  /*
   * The flat map's own world, painted once into a texture for the globe.
   *
   * This is the globe's floor, not its picture. It is one 2048x1024 image
   * for the whole planet - about 20km per pixel at the equator - so it holds
   * up at world view and falls apart the moment the camera comes in. A
   * detail page flies to 721km over its event, where that texture gives
   * roughly forty pixels stretched across the panel: the flood in Nepal was
   * a smear of orange and green with a jagged edge where a border should be.
   *
   * So it is now the fallback underneath real imagery rather than the only
   * thing on the globe. Drawn first, it means an unreachable tile host costs
   * detail, not the globe.
   */
  function worldTexture(data) {
    var W = 2048, H = 1024;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var g = canvas.getContext('2d');
    if (!g) return null;
    var palette = shared('PALETTE', ['#f2b880']);
    g.fillStyle = shared('OCEAN', '#a9d5e8');
    g.fillRect(0, 0, W, H);
    g.strokeStyle = shared('BORDER', '#6d7f8c');
    g.lineWidth = 1;

    var feats = (data && data.features) || [];
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      if (!f || !f.geometry) continue;
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
        : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      var idx = Number(f.properties && f.properties.c) || 0;
      g.fillStyle = palette[idx % palette.length];
      for (var j = 0; j < polys.length; j++) {
        var rings = polys[j];
        if (!rings || !rings.length) continue;
        /* A country that crosses the antimeridian has longitudes at both ends
           of the range, which drawn literally smears a band right across the
           map. Those rings are re-read with the negative half wrapped past
           +180 and then painted twice, once each side, so the country appears
           at both edges the way it does on the flat map. */
        var wrap = lonSpan(rings[0]) > 180;
        paint(g, rings, W, H, wrap, 0);
        if (wrap) paint(g, rings, W, H, wrap, -W);
      }
    }
    return canvas;
  }

  function lonSpan(ring) {
    var lo = 180, hi = -180;
    for (var i = 0; i < ring.length; i++) {
      var lon = ring[i][0];
      if (lon < lo) lo = lon;
      if (lon > hi) hi = lon;
    }
    return hi - lo;
  }

  function paint(g, rings, W, H, wrap, dx) {
    g.beginPath();
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0; i < ring.length; i++) {
        var lon = ring[i][0];
        if (wrap && lon < 0) lon += 360;
        var x = (lon + 180) / 360 * W + dx;
        var y = (90 - ring[i][1]) / 180 * H;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    }
    /* Even-odd so a ring inside another reads as a hole, which is how GeoJSON
       states one. */
    g.fill('evenodd');
    g.stroke();
  }

  /*
   * Where to put the camera.
   *
   * Nothing used to, so Cesium's default view applied: a fixed distance that
   * takes no account of the panel's shape or of what the reader was looking
   * at. On the live map that put the north pole 45 pixels above the top of a
   * 504-pixel canvas — the globe was cut off — and aimed the camera at the
   * eastern United States while the page was set to India.
   */
  function fitHeight(scene) {
    var R = 6378137;
    var c = scene.canvas;
    var frustum = (scene.camera && scene.camera.frustum) || {};
    var aspect = (c && c.clientWidth && c.clientHeight)
      ? c.clientWidth / c.clientHeight
      : Number(frustum.aspectRatio) || 1;
    var fov = Number(frustum.fov) || Math.PI / 3;
    /* Cesium's fov is the horizontal angle; the vertical one follows from the
       aspect ratio, and whichever is smaller is what actually clips the
       globe. A wide, short panel clips vertically. */
    var fovy = aspect <= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
    var fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspect);
    var half = Math.max(0.05, Math.min(fovy, fovx) / 2 * 0.88);
    return R / Math.sin(half) - R;
  }

  function frame(Cesium, viewer, map) {
    if (!viewer || viewer.isDestroyed()) return;
    /* A viewer without these is not one this can aim, and failing to aim is
       no reason to take the whole globe down with it — that is exactly what
       happened the first time, when a stub lacking a camera turned every
       mount into no globe at all. The browser check asserts the aim, so a
       camera that quietly goes unframed is still caught where it matters. */
    if (!viewer.scene || !viewer.camera || typeof viewer.camera.setView !== 'function') return;
    var fit = fitHeight(viewer.scene);
    var lat = 20, lon = 0, zoom = 2;
    try {
      var c = map && map.getCenter && map.getCenter();
      if (c && isFinite(c.lat) && isFinite(c.lng)) { lat = c.lat; lon = c.lng; }
      var z = map && map.getZoom && map.getZoom();
      if (isFinite(z)) zoom = z;
    } catch (e) { /* a stub map, or one not yet placed */ }
    /* Leaflet halves the ground extent with every zoom step, so the globe
       halves its height too and the two scales stay in step.

       The zoom they are measured from is the flat map's own whole-world
       zoom, which map-setup computes from the panel's width and enforces as
       the minimum. Anchoring this to a hard-coded 2 was wrong: a 1246px
       panel's world view is zoom 2.28, so the globe read that as zoomed in
       and flew close enough to push the north pole seven pixels off the top
       of the canvas. Anchored here, the globe fits exactly when the flat map
       is showing the whole world. */
    var wz = shared('worldZoom', null);
    var base = 2;
    try { if (typeof wz === 'function') { var w = wz(map); if (isFinite(w)) base = w; } }
    catch (e) { /* a stub map with no size */ }
    var h = fit / Math.pow(2, Math.max(0, zoom - base));
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(250000, h))
    });
  }

  /*
   * The imagery the flat map already uses, on the globe.
   *
   * Every page offers a Satellite view built from Esri's World_Imagery tiles,
   * so that host and that URL are already the ones this app relies on. The
   * globe asked for the same pictures a different way - through
   * ArcGisMapServerImageryProvider.fromUrl, which fetches a MapServer
   * metadata document before it will request a single tile. Measured here,
   * that metadata request was the only one it ever made, and the conclusion
   * drawn was that the provider does not work.
   *
   * It was the wrong conclusion. server.arcgisonline.com is unreachable from
   * the machine that measurement was taken on, so a blocked host and a broken
   * provider produce identical evidence, and the globe lost its imagery to a
   * firewall. It is requested here from the same {z}/{y}/{x} template the
   * flat map's Satellite layer uses, which needs no metadata document at all:
   * there is no request that can succeed while the tiles stay unasked for.
   */
  function tiled(Cesium, url, credit, maxLevel) {
    if (!Cesium.UrlTemplateImageryProvider || !url) return null;
    try {
      return new Cesium.UrlTemplateImageryProvider({
        url: url, maximumLevel: maxLevel, credit: credit || undefined
      });
    } catch (e) { return null; }
  }

  /* Cesium puts its ion logo in every viewer, whether or not ion is used, and
     nothing here uses it: there is no token, no ion asset and no ion request.
     On a 600x300 detail panel that mark is 140px wide against a 240px globe.
     Only the logo goes - the text credits beside it carry Esri's and Natural
     Earth's attribution, which are terms of use rather than decoration. */
  function dropIonLogo(viewer) {
    try {
      var box = viewer.cesiumWidget && viewer.cesiumWidget.creditContainer;
      var logo = box && box.querySelector('.cesium-credit-logoContainer');
      if (logo) logo.style.display = 'none';
    } catch (e) { /* older widget */ }
  }

  function mount(map, container) {
    if (!map || !container) return null;
    var host = document.createElement('div');
    host.className = 'pnd-globe';
    host.setAttribute('aria-hidden', 'true');
    /* Hidden until the viewer exists. It used to be appended visible and
       opaque, so a multi-megabyte download covered the already-rendered flat
       map with a blank dark panel for its whole duration — and a stalled CDN
       left it there. The promised fallback has to actually be visible while
       the globe is on its way. */
    host.style.cssText =
      /* Above everything Leaflet draws. Two goes at this were wrong: 400 put
         it at the overlay level, under the marker pane, so rotating the globe
         left the flat markers hanging over it; 900 cleared the panes but not
         .leaflet-top/.leaflet-bottom, which Leaflet's own stylesheet puts at
         1000 — a browser screenshot showed the zoom and layers controls
         floating on the globe. The pane list is not the whole stacking order. */
      'position:absolute;inset:0;z-index:1200;background:#04120e;display:none';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(host);

    var viewer = null, entities = null, disposed = false;

    function setControls(display) {
      try {
        var bars = container.querySelectorAll('.leaflet-control-container');
        for (var i = 0; i < bars.length; i++) bars[i].style.display = display;
      } catch (e) { /* no controls on this map */ }
    }

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
            name: p.title || undefined,
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
        /* Kept, unlike the source this is adapted from, which has its own
           UI for it. Each entity carries the page's own popup as its
           description, and with no info box and no click handler there was no
           way to read it: clicking a hazard on the globe did nothing at all,
           so a reader had to find the Flat button to learn what an event was. */
        infoBox: true, selectionIndicator: true, baseLayer: false, msaaSamples: 4,
        contextOptions: { webgl: { preserveDrawingBuffer: true } }
      });
      dropIonLogo(viewer);
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
      viewer.scene.skyAtmosphere.saturationShift = -0.12;
      viewer.scene.skyAtmosphere.brightnessShift = -0.08;
      entities = viewer.entities;
      /* Hung off the host so the globe can be inspected from outside the
         closure. Nothing in the app reads it; it exists because the one
         defect that emptied this globe entirely was invisible to every
         test, and a browser check needs some way to ask what is on it. */
      host.__pndViewer = viewer;
      /* And the flat map beside it, for the same reason: the globe pointing
         somewhere other than where the map was looking is not visible to any
         assertion that cannot compare the two. */
      host.__pndMap = map;

      /* Ocean underneath, so the globe is the flat map's colour from the first
         frame rather than Cesium's default blue while the world loads. */
      try {
        viewer.scene.globe.baseColor =
          Cesium.Color.fromCssColorString(shared('OCEAN', '#a9d5e8'));
      } catch (e) { /* older Globe */ }

      /* Order is the fallback. The painted world goes on first, so the globe
         is readable from the first frame and stays readable if the tile host
         never answers; the satellite imagery is laid over it, and a tile that
         does not arrive simply leaves the country colours showing through.
         Nothing has to detect the failure for the globe to survive it. */
      fetch(shared('COUNTRIES', '/world-countries.json'))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (disposed || !viewer || viewer.isDestroyed()) return;
          var canvas = worldTexture(data);
          if (!canvas) return;
          return Promise.resolve(Cesium.SingleTileImageryProvider.fromUrl(
            canvas.toDataURL('image/png'), { credit: shared('NE_CREDIT', 'Country outlines: Natural Earth (public domain)') }
          )).then(function (p) {
            if (disposed || !viewer || viewer.isDestroyed()) return;
            viewer.imageryLayers.addImageryProvider(p);
          });
        })
        .catch(function () { /* the ocean base colour still orients nothing, but the globe stands */ })
        .then(function () {
          if (disposed || !viewer || viewer.isDestroyed()) return;
          var esri = shared('ESRI_CREDIT', '');
          var sat = tiled(Cesium, shared('IMAGERY', ''), esri, 18);
          if (sat) viewer.imageryLayers.addImageryProvider(sat);
          /* Borders and place names, the same reference layer the flat map
             draws over its own satellite view. Without it the globe is
             photography with nothing named on it, and a reader zoomed in on a
             flood cannot tell which country they are looking at. */
          var places = tiled(Cesium, shared('PLACES', ''), null, 18);
          if (places) viewer.imageryLayers.addImageryProvider(places);
        })
        .catch(function () { /* the painted world is still underneath */ });

      Promise.resolve(Cesium.CesiumTerrainProvider.fromUrl(TERRAIN, {
        requestVertexNormals: true, ellipsoid: Cesium.Ellipsoid.WGS84
      })).then(function (t) {
        if (disposed || !viewer || viewer.isDestroyed()) return;
        viewer.terrainProvider = t;
        try { viewer.creditDisplay.addStaticCredit(new Cesium.Credit(TERRAIN_CREDIT, true)); }
        catch (e) { /* older credit API */ }
      }).catch(function () { /* flat ellipsoid is a fine fallback */ });

      sync();
      frame(Cesium, viewer, map);
      return viewer;
    });

    return {
      host: host, sync: sync, destroy: destroy, ready: promise,
      /* The flat map's own controls are hidden with it. They still drive
         the Leaflet map underneath, so leaving them up means a zoom button
         that visibly does nothing. */
      reveal: function () {
        if (disposed || !viewer) return;
        host.style.display = '';
        setControls('none');
        /* Framed only now. While the host is display:none its canvas has no
           width, so a fit computed at creation divides by a zero-sized panel
           and lands nowhere. Cesium resizes the canvas on its next frame, so
           this waits for one that has a size. */
        var tries = 0;
        (function settle() {
          if (disposed || !viewer || viewer.isDestroyed()) return;
          var c = viewer.scene.canvas;
          if (c && c.clientWidth > 0 && c.clientHeight > 0) {
            frame(window.Cesium, viewer, map);
            return;
          }
          if (++tries < 30) requestAnimationFrame(settle);
        })();
      },
      hide: function () { host.style.display = 'none'; setControls(''); },
      viewer: function () { return viewer; }
    };
  }

  window.PNDGlobe = {
    mount: mount, readMarkers: readMarkers, webglOk: webglOk,
    prefers: prefers, remember: remember, BASE: BASE, PREF: PREF
  };
})();
