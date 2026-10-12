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
  /* Two hosts for the same published build. A phone on a network or behind a
     content blocker that refuses unpkg was left on the flat map with no word
     of why; jsDelivr serves the identical npm package, so it is tried next. */
  var BASES = [
    'https://unpkg.com/cesium@' + VERSION + '/Build/Cesium/',
    'https://cdn.jsdelivr.net/npm/cesium@' + VERSION + '/Build/Cesium/'
  ];
  var BASE = BASES[0];
  /* A download that never finishes is reported rather than waited on for
     ever: the reader is told, and can ask again. */
  var LOAD_TIMEOUT_MS = 60000;
  var PREF = 'pnd_map_view';
  /* Markers sit this far above the ellipsoid: enough to clear it, far too
     little to see. */
  var MARK_HEIGHT_M = 100;

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

  /* The promise is shared while a download is in flight, and forgotten when
     it fails. It used to be kept either way, so one failed fetch - a dropped
     connection on a phone, say - meant every later press of Globe got the
     same rejection back without trying again, until the page was reloaded. */
  var loading = null;
  function loadFrom(i) {
    return new Promise(function (resolve, reject) {
      var base = BASES[i], css = null, s = null, timer = null, done = false;
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!err) { BASE = base; resolve(window.Cesium); return; }
        try { if (css) css.remove(); if (s) s.remove(); } catch (e) { /* gone */ }
        reject(err);
      }
      try {
        window.CESIUM_BASE_URL = base;
        css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = base + 'Widgets/widgets.css';
        document.head.appendChild(css);
        s = document.createElement('script');
        s.src = base + 'Cesium.js';
        s.async = true;
        s.onload = function () {
          finish(window.Cesium ? null : new Error('the 3D library downloaded but did not start'));
        };
        s.onerror = function () { finish(new Error('the 3D library could not be downloaded')); };
        timer = setTimeout(function () {
          finish(new Error('the 3D library took too long to download'));
        }, LOAD_TIMEOUT_MS);
        document.head.appendChild(s);
      } catch (e) { finish(e); }
    }).catch(function (err) {
      if (window.Cesium) return window.Cesium;
      if (i + 1 < BASES.length) return loadFrom(i + 1);
      throw err;
    });
  }
  function loadCesium() {
    if (window.Cesium) return Promise.resolve(window.Cesium);
    if (loading) return loading;
    loading = loadFrom(0).catch(function (err) { loading = null; throw err; });
    return loading;
  }

  /* Phones and tablets get the lighter drawing setup from the start. iOS
     Safari gives a page far less graphics memory than a desktop, and an
     anti-aliased, preserved drawing buffer is the first thing that runs out. */
  function lean() {
    try {
      var ua = navigator.userAgent || '';
      return /iPhone|iPad|iPod|Android/i.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||
        !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { return false; }
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
          level: o.pndLevel || null,
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

  /* Where the flat map is looking, as one comparable string, or '' before
     it has been given a view. */
  function viewKey(map) {
    try {
      var c = map && map.getCenter && map.getCenter();
      var z = map && map.getZoom && map.getZoom();
      if (!c || !isFinite(c.lat) || !isFinite(c.lng) || !isFinite(z)) return '';
      return c.lat.toFixed(4) + ',' + c.lng.toFixed(4) + ',' + z.toFixed(2);
    } catch (e) { return ''; }
  }

  function frame(Cesium, viewer, map, fly) {
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
    var to = { destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(250000, h)) };
    if (fly && typeof viewer.camera.flyTo === 'function') {
      to.duration = 1.2;
      viewer.camera.flyTo(to);
    } else {
      viewer.camera.setView(to);
    }
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

  /*
   * Below this camera height the daily picture's ~250 m pixels are larger
   * than the screen's, and the detailed mosaic is the sharper of the two.
   * It is the height a 1000 px view spans about zoom 9 on the flat map - the
   * same point at which the flat map hands over - and it is also the lowest
   * height this globe ever frames an event at, so opening on an event always
   * shows the daily picture first.
   */
  var DAILY_ABOVE_M = 250000;

  /* ------------------------------------------------------ the god's-eye HUD
   *
   * The look is gods-eye-view's: the planet in black space, a thin frame of
   * corner brackets, a monospace read-out of where the camera is and what
   * time it is in UTC, tags on what matters, and a bar of sensor looks. Only
   * facts go on it - the camera's own position, the clock, how many of the
   * page's events are on the visible side of the Earth. Nothing that reads as
   * a classification or a feed this site does not have.
   */

  /* The MGRS grid reference of a point, to 10 m, as the reference viewer
     prints it ("18R UM 3806 6476"). Standard UTM on WGS84, with the Norway
     and Svalbard zone exceptions; outside UTM's latitudes it is not defined. */
  function mgrs(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || lat < -80 || lat >= 84) return '';
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    var zone = Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if (lat >= 72) {
      if (lon >= 0 && lon < 9) zone = 31; else if (lon >= 9 && lon < 21) zone = 33;
      else if (lon >= 21 && lon < 33) zone = 35; else if (lon >= 33 && lon < 42) zone = 37;
    }
    var a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
    var phi = lat * Math.PI / 180, lam = (lon - ((zone - 1) * 6 - 180 + 3)) * Math.PI / 180;
    var sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    var N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos, A = cos * lam;
    var e4 = e2 * e2, e6 = e4 * e2;
    var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi -
      (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) +
      (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
    var x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 +
      (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var y = k0 * (M + N * tan * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) y += 10000000;
    var band = 'CDEFGHJKLMNPQRSTUVWX'.charAt(Math.min(19, Math.floor((lat + 80) / 8)));
    var cols = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(zone - 1) % 3];
    var col = cols.charAt(Math.floor(x / 100000) - 1);
    var rows = 'ABCDEFGHJKLMNPQRSTUV';
    var row = rows.charAt((Math.floor(y / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20);
    var pad = function (v) { v = String(Math.floor((v % 100000) / 10)); while (v.length < 4) v = '0' + v; return v; };
    return (zone < 10 ? '0' : '') + zone + band + ' ' + col + row + ' ' + pad(x) + ' ' + pad(y);
  }

  function dms(v, pos, neg) {
    var s = v < 0 ? neg : pos, a = Math.abs(v);
    var d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = (mf - m) * 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d + '\u00b0' + two(m) + '\u2032' + (sec < 10 ? '0' : '') + sec.toFixed(2) + '\u2033' + s;
  }

  function utcStamp(t) {
    var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + 'Z';
  }

  /* Sensor looks, adapted from gods-eye-view's style shaders (MIT, Copyright
     (c) 2026 Bilawal Sidhu): its night-vision, thermal, CRT and noir passes,
     cut down to the core of each and run at full strength. */
  var SHADER_HEAD = 'uniform sampler2D colorTexture;\nuniform vec2 colorTextureDimensions;\nuniform float time;\n' +
    'in vec2 v_textureCoordinates;\n' +
    'float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}\n';
  var PRESETS = [
    { key: 'normal', label: 'Normal', shader: null },
    { key: 'nvg', label: 'NVG', animated: true, shader:
      'void main(){vec2 uv=v_textureCoordinates;vec2 dims=colorTextureDimensions;' +
      'vec2 c=uv*2.0-1.0;c.x*=dims.x/dims.y;float r=length(c);' +
      'float tube=pow(1.0-smoothstep(0.78,1.18,r),0.7)*(1.0-r*r*0.18);' +
      'float l=dot(texture(colorTexture,uv).rgb,vec3(0.299,0.587,0.114));' +
      'l=pow(clamp(l*1.7,0.0,1.0),0.8);' +
      'l=clamp(l+(hash(uv*dims+fract(time*0.37)*311.0)-0.5)*0.12,0.0,1.0);' +
      'float scan=0.93+0.07*sin(uv.y*dims.y*3.14159);' +
      'out_FragColor=vec4(vec3(0.24,1.0,0.38)*l*scan*tube,1.0);}' },
    { key: 'flir', label: 'FLIR', animated: true, shader:
      'void main(){vec2 uv=v_textureCoordinates;vec2 dims=colorTextureDimensions;vec2 t=1.0/dims;' +
      'vec3 b=vec3(0.0);float w=0.0;' +
      'for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){float k=(x==0&&y==0)?4.0:1.0;' +
      'b+=texture(colorTexture,uv+vec2(float(x),float(y))*t*1.5).rgb*k;w+=k;}}' +
      'b/=w;float l=dot(b,vec3(0.299,0.587,0.114));float temp=clamp((l-0.1)/0.75,0.0,1.0);' +
      'temp=clamp(temp+(hash(uv*dims*0.5+floor(time*24.0))-0.5)*0.05,0.0,1.0);' +
      'vec2 c=uv-0.5;float vig=1.0-dot(c,c)*0.9;' +
      'out_FragColor=vec4(vec3(temp)*vig,1.0);}' },
    { key: 'crt', label: 'CRT', animated: true, shader:
      'vec2 barrel(vec2 uv,float k){vec2 c=uv*2.0-1.0;float r2=dot(c,c);c*=1.0+r2*k;return c*0.5+0.5;}' +
      'void main(){vec2 dims=colorTextureDimensions;vec2 uv=barrel(v_textureCoordinates,0.08);' +
      'if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){out_FragColor=vec4(0.0,0.0,0.0,1.0);return;}' +
      'vec2 c=uv-0.5;float ca=length(c)*0.006;' +
      'vec3 col=vec3(texture(colorTexture,uv+c*ca).r,texture(colorTexture,uv).g,texture(colorTexture,uv-c*ca).b);' +
      'col=floor(col*24.0+0.5)/24.0;' +
      'float scan=0.82+0.18*sin(uv.y*dims.y*3.14159);float mask=0.92+0.08*sin(uv.x*dims.x*2.094);' +
      'out_FragColor=vec4(col*scan*mask*(0.97+0.03*sin(time*60.0))*1.12,1.0);}' },
    { key: 'noir', label: 'Noir', shader:
      'void main(){vec2 uv=v_textureCoordinates;vec4 color=texture(colorTexture,uv);' +
      'float luma=dot(color.rgb,vec3(0.299,0.587,0.114));vec3 c=clamp((vec3(luma)-0.5)*2.2+0.5,0.0,1.0);' +
      'c+=(fract(sin(dot(uv*colorTextureDimensions,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.04;' +
      'vec2 v=uv*(1.0-uv);float vig=pow(v.x*v.y*16.0,0.5);' +
      'vec3 sep=vec3(dot(c,vec3(0.393,0.769,0.189)),dot(c,vec3(0.349,0.686,0.168)),dot(c,vec3(0.272,0.534,0.131)));' +
      'out_FragColor=vec4(mix(c,sep,0.15)*vig,color.a);}' }
  ];
  var PRESET_PREF = 'pnd_globe_look';

  var HUD_CSS = [
    '.pnd-hud{position:absolute;inset:0;z-index:2;pointer-events:none;color:#d6ecff;',
    'font:500 11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;',
    'letter-spacing:.06em;text-transform:uppercase;text-shadow:0 1px 2px #000}',
    '.pnd-hud .c{position:absolute;width:16px;height:16px;border:1px solid rgba(214,236,255,.55)}',
    '.pnd-hud .c.tl{top:6px;left:6px;border-right:0;border-bottom:0}',
    '.pnd-hud .c.tr{top:6px;right:6px;border-left:0;border-bottom:0}',
    '.pnd-hud .c.bl{bottom:6px;left:6px;border-right:0;border-top:0}',
    '.pnd-hud .c.br{bottom:6px;right:6px;border-left:0;border-top:0}',
    '.pnd-hud-title{position:absolute;top:12px;left:16px;font-weight:700;letter-spacing:.14em}',
    '.pnd-hud-title small{display:block;font-weight:500;opacity:.7;letter-spacing:.08em}',
    '.pnd-hud-rec{position:absolute;top:12px;right:16px;text-align:right}',
    '.pnd-hud-rec b::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;',
    'background:#ff4040;margin-right:6px;vertical-align:1px;animation:pndRec 1.2s steps(2) infinite}',
    '.pnd-hud-pos{margin-top:4px;opacity:.85}',
    '@keyframes pndRec{50%{opacity:.15}}',
    '.pnd-hud-bar{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);pointer-events:auto;',
    'display:flex;gap:3px;padding:4px;border:1px solid rgba(214,236,255,.25);border-radius:9px;',
    'background:rgba(0,0,0,.62);max-width:calc(100% - 24px);overflow-x:auto}',
    '.pnd-hud-bar button{appearance:none;font:inherit;letter-spacing:.08em;color:#d6ecff;background:transparent;',
    'border:1px solid transparent;border-radius:6px;padding:6px 9px;cursor:pointer;white-space:nowrap}',
    '.pnd-hud-bar button[aria-pressed="true"]{border-color:#7fd3ff;background:rgba(127,211,255,.16);color:#fff}',
    '.pnd-hud-bar button:focus-visible{outline:2px solid #7fd3ff;outline-offset:1px}',
    '.pnd-hud-bar .sep{width:1px;background:rgba(214,236,255,.25);margin:2px 3px}',
    '@media (max-width:720px){.pnd-hud-bar{top:44px;bottom:auto}.pnd-hud-title small,.pnd-hud-mgrs{display:none}}',
    /* A phone's map is about 370 x 300: one line of read-out, the looks
       under it, and nothing over the Globe/Flat switch at 84px. */
    '@media (max-width:560px){.pnd-hud{font-size:10px}.pnd-hud-title,.pnd-hud-pos,.pnd-hud-alt{display:none}',
    '.pnd-hud-rec{left:12px;right:12px;top:8px;text-align:left;display:flex;justify-content:space-between}',
    '.pnd-hud-bar{top:28px;left:8px;right:8px;transform:none;max-width:none;padding:3px;gap:2px}',
    '.pnd-hud-bar button{padding:4px 6px}}',
    '@media (prefers-reduced-motion:reduce){.pnd-hud-rec b::before{animation:none}}'
  ].join('');

  function hudStyle() {
    if (document.getElementById('pnd-hud-style')) return;
    var tag = document.createElement('style');
    tag.id = 'pnd-hud-style';
    tag.textContent = HUD_CSS;
    (document.head || document.documentElement).appendChild(tag);
  }

  /* The corner brackets a tag hangs from, as an image Cesium can draw. */
  var RETICLE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="none" stroke="#e8f4ff" stroke-width="1.6">' +
    '<path d="M1 9V1h8M21 1h8v8M29 21v8h-8M9 29H1v-8"/></svg>');

  /* A magnitude read off the event's name ("M 6.1 - 80 km ENE of ..."). */
  function magnitudeOf(title) {
    var m = /\bM\s?(\d+(?:\.\d+)?)\b/.exec(String(title || ''));
    var v = m ? Number(m[1]) : NaN;
    return isFinite(v) && v > 0 && v < 10 ? v : null;
  }

  var LEVEL_RANK = { EXTREME: 6, SEVERE: 5, HIGH: 4, MODERATE: 3, WATCH: 2, LOW: 1 };
  var TAGS = 8;

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

    var viewer = null, entities = null, disposed = false, reannounce = null, imageryPick = null;
    var dailyPref = shared('dailyWanted', null);
    var state = { pts: [], tags: [], stages: {}, look: 'normal', animated: false, frame: null, clock: null, where: null,
      animate: null, daily: typeof dailyPref === 'function' ? !!dailyPref() : false };

    /*
     * The globe is the view a reader opens on, so it carries the same two
     * pictures as the flat map and says which it is showing.
     *
     * NASA's picture of the latest complete day goes over the detailed
     * mosaic while the camera is high enough for it to be the sharper of the
     * two, and the two are swapped - never both drawn - as the camera passes
     * DAILY_ABOVE_M, so the mosaic is only fetched where it is shown. If
     * NASA's tiles keep failing and none has arrived, the mosaic stays up at
     * every height and the caption says it is the old picture rather than
     * letting it pass for today's.
     *
     * The mosaic is watched the same way. When it fails too, what the reader
     * sees is the painted map underneath, and the caption says so: naming a
     * photograph nobody can see is the claim the flat map already refuses to
     * make.
     */
    function todaysEarth(Cesium, satLayer, satProvider) {
      var daily = shared('dailyImagery', null);
      var latest = typeof daily === 'function' ? daily() : null;
      var provider = latest ? tiled(Cesium, latest.url, latest.credit, latest.maxZoom) : null;
      var dayLayer = provider ? viewer.imageryLayers.addImageryProvider(provider) : null;
      var failures = 0, loaded = false, failed = false, last = null;
      var satFailures = 0, satLoaded = false, satFailed = !satLayer;
      function say(source) {
        if (source === last) return;
        last = source;
        try { container.dispatchEvent(new CustomEvent('pnd-imagery', { detail: { source: source } })); }
        catch (e) { /* an old browser without CustomEvent keeps an uncaptioned globe */ }
      }
      /* Esri's mosaic is the globe's picture, as it is the reference viewer's.
         NASA's photo of the day goes over it only when the reader asks for it
         ("NASA today") or when Esri never answers, and only while the camera
         is high enough for its 250 m pixels; the two are swapped rather than
         both drawn, so the mosaic is not fetched under a photo that hides it. */
      function pick() {
        if (disposed || !viewer || viewer.isDestroyed()) return;
        var c = viewer.camera && viewer.camera.positionCartographic;
        var high = !c || c.height > DAILY_ABOVE_M;
        var wanted = state.daily || satFailed;
        var useDay = !!dayLayer && high && !failed && wanted;
        if (dayLayer) dayLayer.show = useDay;
        if (satLayer) satLayer.show = !useDay;
        say(useDay ? (satFailed ? 'fallback' : 'daily') : (satFailed ? 'drawn' : 'mosaic'));
        requestRender();
      }
      if (provider && provider.errorEvent && provider.errorEvent.addEventListener) {
        provider.errorEvent.addEventListener(function () {
          if (loaded || failed || ++failures < 3) return;
          failed = true;
          pick();
        });
      }
      if (satProvider && satProvider.errorEvent && satProvider.errorEvent.addEventListener) {
        satProvider.errorEvent.addEventListener(function () {
          if (satLoaded || satFailed || ++satFailures < 2) return;
          satFailed = true;
          pick();
        });
      }
      /* A tile that arrives means the service is up. Cesium reports loads per
         layer through the globe's tile queue rather than per provider, so the
         first frame drawn with the layer showing and no errors counts. */
      try {
        viewer.scene.globe.tileLoadProgressEvent.addEventListener(function (queued) {
          if (queued === 0 && dayLayer && dayLayer.show && failures === 0) loaded = true;
          if (queued === 0 && satLayer && satLayer.show && satFailures === 0) satLoaded = true;
        });
      } catch (e) { /* older Globe: errors alone decide */ }
      try {
        viewer.camera.moveEnd.addEventListener(pick);
        viewer.camera.changed.addEventListener(pick);
      } catch (e) { /* no camera events: the first pick stands */ }
      pick();
      imageryPick = pick;
      /* Re-announced on every reveal, since the caption is shared with the
         flat map and was describing that until the globe came to the front. */
      return function () { last = null; pick(); };
    }

    /* In request-render mode Cesium draws only when something changes, which
       is what keeps an idle globe from holding the page's main thread; the
       few changes it cannot see for itself ask for a frame here. */
    function requestRender() {
      try { if (viewer && !viewer.isDestroyed() && viewer.scene.requestRender) viewer.scene.requestRender(); }
      catch (e) { /* stub scene */ }
    }

    /* The HUD: corner brackets, the title, the UTC clock, where the camera is,
       how many of the page's events are on the visible side, and the bar of
       looks with the NASA switch. */
    function buildHud(Cesium) {
      hudStyle();
      var hud = document.createElement('div');
      hud.className = 'pnd-hud';
      /* An instrument read-out: its labels stay short, as written. */
      hud.setAttribute('data-keep-acronyms', '');
      hud.innerHTML =
        '<i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>' +
        '<div class="pnd-hud-title">Live hazard view<small>Predict Natural Disasters</small></div>' +
        '<div class="pnd-hud-rec"><b class="pnd-hud-clock">LIVE</b>' +
        '<div class="pnd-hud-pos"></div><div class="pnd-hud-mgrs"></div><div class="pnd-hud-alt"></div>' +
        '<div class="pnd-hud-count"></div></div>' +
        '<div class="pnd-hud-bar" role="toolbar" aria-label="Globe look"></div>';
      host.appendChild(hud);
      host.setAttribute('aria-hidden', 'false');
      var clock = hud.querySelector('.pnd-hud-clock'), pos = hud.querySelector('.pnd-hud-pos'),
        grid = hud.querySelector('.pnd-hud-mgrs'), alt = hud.querySelector('.pnd-hud-alt'),
        count = hud.querySelector('.pnd-hud-count'), bar = hud.querySelector('.pnd-hud-bar');

      function tick() { clock.textContent = 'LIVE ' + utcStamp(Date.now()); }
      tick();
      state.clock = setInterval(tick, 1000);

      /* Where the camera is looking straight down, and how many events are
         on the side of the Earth that faces it. */
      function where() {
        var c = viewer && !viewer.isDestroyed() && viewer.camera && viewer.camera.positionCartographic;
        if (!c || !isFinite(c.latitude)) return;
        var lat = c.latitude * 180 / Math.PI, lon = c.longitude * 180 / Math.PI;
        pos.textContent = dms(lat, 'N', 'S') + ' ' + dms(lon, 'E', 'W');
        var g = mgrs(lat, lon);
        grid.textContent = g ? 'MGRS ' + g : '';
        alt.textContent = 'ALT ' + Math.round(c.height / 1000).toLocaleString('en-GB') + ' KM';
        var R = 6371, horizon = Math.acos(R / (R + Math.max(0, c.height) / 1000));
        var r = Math.PI / 180, n = 0;
        for (var i = 0; i < state.pts.length; i++) {
          var p = state.pts[i];
          var cosd = Math.sin(lat * r) * Math.sin(p.lat * r) + Math.cos(lat * r) * Math.cos(p.lat * r) * Math.cos((p.lon - lon) * r);
          if (Math.acos(Math.max(-1, Math.min(1, cosd))) <= horizon) n++;
        }
        count.textContent = n + (n === 1 ? ' EVENT' : ' EVENTS') + ' IN VIEW';
        declutter(lat, lon, horizon);
      }
      /* A tag is shown only for an event on the side of the Earth facing the
         camera - labels are not hidden by the planet the way points are, so
         one on the far side hung in space - and only where it does not land
         on a more serious event's tag. */
      /* The HUD and the map's own controls, as boxes a tag must not land on. */
      function obstacles() {
        var out = [];
        try {
          var cv = viewer.scene.canvas, base = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
          if (!base) return out;
          var sel = '.pnd-hud-bar,.pnd-hud-rec,.pnd-hud-title,.pnd-view-toggle,.pnd-key,.pnd-imagery-note';
          var els = container.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) {
            var b = els[i].getBoundingClientRect();
            if (!b.width || !b.height) continue;
            out.push({ x0: b.left - base.left - 4, x1: b.right - base.left + 4, y0: b.top - base.top - 4, y1: b.bottom - base.top + 4 });
          }
        } catch (e) { /* no layout */ }
        return out;
      }
      function declutter(lat, lon, horizon) {
        var C = window.Cesium, r = Math.PI / 180, placed = obstacles();
        var toScreen = C && C.SceneTransforms && C.SceneTransforms.worldToWindowCoordinates;
        var shown = 0;
        for (var i = 0; i < state.tags.length; i++) {
          var t = state.tags[i], ok;
          var cosd = Math.sin(lat * r) * Math.sin(t.lat * r) + Math.cos(lat * r) * Math.cos(t.lat * r) * Math.cos((t.lon - lon) * r);
          ok = shown < (state.maxTags || TAGS) && Math.acos(Math.max(-1, Math.min(1, cosd))) < horizon * 0.97;
          if (ok && toScreen) {
            var w = null;
            try { w = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, C.Cartesian3.fromDegrees(t.lon, t.lat)); }
            catch (e) { w = null; }
            if (w) {
              var box = { x0: w.x + 12, x1: w.x + 17 + t.width, y0: w.y - 34, y1: w.y - 8 };
              var cw = viewer.scene.canvas && viewer.scene.canvas.clientWidth;
              if (cw && box.x1 > cw - 8) ok = false;
              for (var j = 0; j < placed.length && ok; j++) {
                var q = placed[j];
                if (box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0) ok = false;
              }
              if (ok) placed.push(box);
            }
          }
          if (ok) shown++;
          try {
            if (t.ent.label) t.ent.label.show = ok;
            if (t.bb) t.bb.show = ok;
          } catch (e) { /* entity gone */ }
        }
      }
      state.where = where;
      try { viewer.camera.changed.addEventListener(where); viewer.camera.moveEnd.addEventListener(where); }
      catch (e) { /* no camera events in a stub */ }
      if (viewer.camera && viewer.camera.percentageChanged !== undefined) viewer.camera.percentageChanged = 0.01;
      where();

      /* The looks. A stage is made the first time it is chosen and kept. */
      var saved = '';
      try { saved = localStorage.getItem(PRESET_PREF) || ''; } catch (e) { /* private window */ }
      PRESETS.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = p.label; b.setAttribute('data-look', p.key);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { look(p.key); });
        bar.appendChild(b);
      });
      var sep = document.createElement('span'); sep.className = 'sep'; bar.appendChild(sep);
      var nasa = document.createElement('button');
      nasa.type = 'button'; nasa.textContent = 'NASA today'; nasa.setAttribute('data-look', 'nasa');
      nasa.title = 'Show NASA\u2019s photo of the latest complete day instead of the mosaic';
      nasa.setAttribute('aria-pressed', String(state.daily));
      nasa.addEventListener('click', function () {
        state.daily = !state.daily;
        nasa.setAttribute('aria-pressed', String(state.daily));
        var set = shared('setDailyWanted', null);
        if (typeof set === 'function') set(state.daily);
        if (imageryPick) imageryPick();
      });
      bar.appendChild(nasa);

      function look(key) {
        state.look = key;
        try { localStorage.setItem(PRESET_PREF, key); } catch (e) { /* private window */ }
        var btns = bar.querySelectorAll('[data-look]');
        for (var i = 0; i < btns.length; i++) {
          var k = btns[i].getAttribute('data-look');
          if (k !== 'nasa') btns[i].setAttribute('aria-pressed', String(k === key));
        }
        var chosen = null;
        PRESETS.forEach(function (p) {
          if (!p.shader) return;
          var stage = state.stages[p.key];
          if (p.key === key && !stage && Cesium.PostProcessStage) {
            try {
              var t0 = Date.now();
              stage = new Cesium.PostProcessStage({
                fragmentShader: SHADER_HEAD + p.shader,
                uniforms: { time: function () { return (Date.now() - t0) / 1000; } }
              });
              viewer.scene.postProcessStages.add(stage);
              state.stages[p.key] = stage;
            } catch (e) { stage = null; }
          }
          if (stage) stage.enabled = p.key === key;
          if (p.key === key) chosen = p;
        });
        animate(!!(chosen && chosen.animated));
        requestRender();
      }
      /* Grain and flicker move; in request-render mode they need frames asked
         for, and only while such a look is on and the globe is showing. */
      function animate(on) {
        state.animated = on;
        if (!on || state.frame) return;
        (function loop() {
          if (!state.animated || disposed || host.style.display === 'none') { state.frame = null; return; }
          requestRender();
          state.frame = requestAnimationFrame(loop);
        })();
      }
      state.animate = animate;
      look(PRESETS.some(function (p) { return p.key === saved; }) ? saved : 'normal');
    }

    function setControls(display) {
      try {
        var bars = container.querySelectorAll('.leaflet-control-container');
        for (var i = 0; i < bars.length; i++) bars[i].style.display = display;
      } catch (e) { /* no controls on this map */ }
    }

    /*
     * The page moves the flat map itself: a detail page centres it on its
     * event once the data arrives, and the homepage and dashboard fly it to
     * an event the reader picks from a list. The globe was framed once, when
     * it mounted - usually before the data arrived - so an event page's globe
     * sat on the whole world with "0 events in view", and picking an event
     * from a list moved nothing the reader could see. It now follows those
     * moves. While the globe is showing, the flat map is hidden, so any move
     * it makes came from the page, not from the reader dragging it.
     *
     * Only a move to somewhere new is followed: the event page sets the same
     * view again every minute when it refreshes, and snapping the camera back
     * each time would undo whatever the reader was looking at.
     */
    var followed = viewKey(map);
    function follow() {
      if (disposed || !viewer || viewer.isDestroyed() || host.style.display === 'none') return;
      var k = viewKey(map);
      if (!k || k === followed) return;
      followed = k;
      frame(window.Cesium, viewer, map, true);
      requestRender();
    }
    if (typeof map.on === 'function') map.on('moveend', follow);

    function destroy() {
      disposed = true;
      if (typeof map.off === 'function') map.off('moveend', follow);
      if (state.clock) clearInterval(state.clock);
      state.animated = false;
      try { if (viewer && !viewer.isDestroyed()) viewer.destroy(); } catch (e) { /* gone */ }
      try { host.remove(); } catch (e) { /* gone */ }
    }

    function sync() {
      if (!viewer || disposed) return;
      var pts = readMarkers(map);
      state.pts = pts;
      var C = window.Cesium;
      /* The events worth a tag: the most serious first, then the largest mark. */
      /* Candidates only: which of them get a tag is decided as the camera
         moves, from those on the visible side - the most serious events are
         often on the far side of the Earth, and tagging them there left the
         side the reader is looking at with none. */
      var tagged = {};
      pts.map(function (p, i) { return { i: i, r: LEVEL_RANK[p.level] || 0, s: p.radius }; })
        .filter(function (x) { return x.r >= 2 || pts.length <= TAGS; })
        .sort(function (a, b) { return (b.r - a.r) || (b.s - a.s); })
        .slice(0, 60).forEach(function (x) { tagged[x.i] = true; });
      var narrow = (host.clientWidth || (container && container.clientWidth) || 800) < 560;
      state.maxTags = narrow ? 3 : TAGS;
      var room = narrow ? 22 : 38;
      var canTag = !!(C.Cartesian2 && C.VerticalOrigin && C.HorizontalOrigin && C.LabelStyle);
      /* The brackets are billboards of their own, not a billboard on the
         event's entity: Cesium draws a ground-clamped point through its own
         billboard, and a second one on the same entity took the point's
         place as a 30 px disc. */
      var brackets = null;
      try {
        if (!state.brackets && C.BillboardCollection && viewer.scene.primitives) {
          state.brackets = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene }));
        }
        brackets = state.brackets;
        if (brackets) brackets.removeAll();
      } catch (e) { brackets = null; }
      try {
        entities.removeAll();
        state.tags = [];
        for (var i = 0; i < pts.length; i++) {
          var p = pts[i];
          var e = {
            name: p.title || undefined,
            /* Just above the surface rather than clamped to it. The terrain
               here is the plain ellipsoid, so clamping changed nothing on
               screen, but it made Cesium download a table of terrain heights
               while drawing, and a refused download stopped the globe. */
            position: C.Cartesian3.fromDegrees(p.lon, p.lat, MARK_HEIGHT_M),
            point: {
              pixelSize: Math.max(6, Math.min(18, p.radius * 1.6)),
              color: C.Color.fromCssColorString(p.colour),
              outlineColor: C.Color.fromCssColorString('#04120e'),
              outlineWidth: 2,
              /* Without this a marker on the far side of the planet shows
                 through it, which reads as a second event in the ocean. */
              disableDepthTestDistance: 0
            },
            description: p.html
          };
          /* A tag in the reference viewer's style: corner brackets around the
             mark and its name beside them, for the few that matter most. */
          if (canTag && tagged[i] && p.title) {
            e.label = {
              text: p.title.length > room ? p.title.slice(0, room - 1) + '\u2026' : p.title,
              font: '600 12px ui-monospace, Menlo, Consolas, monospace',
              fillColor: C.Color.fromCssColorString('#eaf6ff'),
              showBackground: true,
              backgroundColor: C.Color.fromCssColorString('rgba(3,10,14,0.82)'),
              backgroundPadding: new C.Cartesian2(6, 4),
              style: C.LabelStyle.FILL,
              horizontalOrigin: C.HorizontalOrigin.LEFT,
              verticalOrigin: C.VerticalOrigin.BOTTOM,
              pixelOffset: new C.Cartesian2(17, -12),
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            };
          }
          /* An earthquake as the reference viewer draws one: a disc on the
             ground whose radius doubles with each step of magnitude. */
          var mag = magnitudeOf(p.title);
          if (mag !== null && mag >= 4 && C.Color.fromCssColorString) {
            var fill = C.Color.fromCssColorString(p.colour);
            e.ellipse = {
              semiMajorAxis: Math.pow(2, mag) * 1000, semiMinorAxis: Math.pow(2, mag) * 1000,
              /* An explicit height makes this an ordinary shape on the
                 surface. Without one, over terrain, Cesium draws it as a
                 ground-clamped shape, which needs the same terrain-height
                 table as clamped markers. */
              height: 0,
              material: fill && fill.withAlpha ? fill.withAlpha(0.28) : fill
            };
          }
          var added = entities.add(e);
          if (e.label) {
            var bb = null;
            /* Never hidden by the ground they sit on - they would sink into
               it - because declutter() already hides a tag on the far side. */
            if (brackets) {
              try {
                bb = brackets.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat, MARK_HEIGHT_M), image: RETICLE,
                  width: 30, height: 30, show: false,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY });
              } catch (err) { bb = null; }
            }
            state.tags.push({ ent: added || e, bb: bb, lat: p.lat, lon: p.lon, rank: LEVEL_RANK[p.level] || 0,
              width: 30 + Math.min(room, p.title.length) * 7.4 });
          }
        }
        state.tags.sort(function (a, b) { return b.rank - a.rank; });
      } catch (e) { /* mid-teardown */ }
      if (state.where) state.where();
      requestRender();
    }

    /* Told when a globe that did start stops working: iOS takes the WebGL
       context back when it runs short of memory, and a shader the device
       cannot compile stops Cesium's render loop. Either leaves a frozen or
       blank panel, so the map page drops back to flat and says why. */
    var failHandlers = [], failed = false;
    function fail(reason) {
      if (failed || disposed) return;
      failed = true;
      var err = new Error(reason);
      failHandlers.forEach(function (f) { try { f(err); } catch (e) { /* the page's own handler */ } });
    }

    /*
     * Two data files Cesium fetches from the CDN whatever the page draws: a
     * table of approximate terrain heights, requested as soon as entities can
     * be shown, and the Earth-orientation table its sun and moon lighting
     * reads on every frame. Neither is needed here - nothing is clamped to the
     * ground, and without the table Cesium falls back to a simpler Earth
     * rotation that is indistinguishable at this scale - but when either
     * download was refused Cesium left the failure unhandled, and the page
     * reported errors. Starting both here, with a handler attached, makes a
     * refused download cost nothing.
     */
    function quietPreloads(Cesium) {
      /* And the terrain table gates more than ground shapes: Cesium's entity
         display shows nothing at all until it has loaded, so a refused or
         stalled download left a globe with every hazard missing. It is only
         read for shapes clamped to the ground, of which there are none, and
         Cesium already uses its default heights for any entry the table
         lacks - so if it has not arrived in a few seconds it is declared
         empty, and the hazards draw. ApproximateTerrainHeights is internal to
         Cesium (it is not in the published types); the asset-blocked run of
         tools/globe-browser-check.js is what proves this still works. */
      var ATH = Cesium.ApproximateTerrainHeights;
      var settle = function () {
        if (ATH && ATH._terrainHeights === undefined) { ATH._terrainHeights = {}; requestRender(); }
      };
      try {
        var waited = setTimeout(settle, 8000);
        Promise.resolve(Cesium.GroundPrimitive.initializeTerrainHeights())
          .then(function () { clearTimeout(waited); }, function () { clearTimeout(waited); settle(); });
      } catch (e) { /* older or stubbed Cesium */ }
      try {
        var now = Cesium.JulianDate.now();
        Promise.resolve(Cesium.Transforms.preloadIcrfFixed(new Cesium.TimeInterval({
          start: Cesium.JulianDate.addDays(now, -1, new Cesium.JulianDate()),
          stop: Cesium.JulianDate.addDays(now, 1, new Cesium.JulianDate())
        }))).catch(function () { /* Cesium falls back without it */ });
      } catch (e) { /* older or stubbed Cesium */ }
    }

    /* The viewer, at one of three levels. A desktop starts at 0. A phone
       starts at 1: no multisampling and no preserved buffer, which is most
       of what iOS runs out of. If that still throws, 2 asks for WebGL 1,
       which some iOS releases manage when WebGL 2 initialisation fails. */
    function makeViewer(Cesium, level) {
      return new Cesium.Viewer(host, {
        timeline: false, animation: false, baseLayerPicker: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, vrButton: false, selectionIndicator: false,
        /* Kept, unlike the source this is adapted from, which has its own
           UI for it. Each entity carries the page's own popup as its
           description, and with no info box and no click handler there was no
           way to read it: clicking a hazard on the globe did nothing at all,
           so a reader had to find the Flat button to learn what an event was. */
        infoBox: true, selectionIndicator: true, baseLayer: false, msaaSamples: level ? 1 : 4,
        /* Draw only when something changes. A globe that re-renders sixty
           times a second while nobody touches it held the page's main thread
           and made every click on the page feel late. */
        requestRenderMode: true, maximumRenderTimeChange: Infinity,
        /* Cesium's own error panel is replaced by the flat map and a sentence
           saying what happened; see fail(). */
        showRenderLoopErrors: false,
        /* No star field, sun or moon at all. They were created and then
           hidden, but creating them still downloads six star images, a moon
           texture and an Earth-orientation table from the CDN while drawing;
           where any of those requests is refused - a sandboxed page, a content
           blocker, a dropped connection - Cesium stops with "Request has
           failed" and the globe goes blank. */
        skyBox: false,
        contextOptions: level === 2 ? { requestWebgl1: true, webgl: { alpha: false } }
          : level === 1 ? { webgl: { alpha: false } }
          : { webgl: { preserveDrawingBuffer: true } }
      });
    }

    var promise = loadCesium().then(function (Cesium) {
      if (disposed) return null;
      /* No ion token is set anywhere: the imagery and terrain below are the
         keyless pair gods-eye-view uses, so nothing here needs an account. */
      quietPreloads(Cesium);
      var level = lean() ? 1 : 0;
      try { viewer = makeViewer(Cesium, level); }
      catch (first) {
        /* A failed construction can leave a half-built widget in the host. */
        while (host.firstChild) host.removeChild(host.firstChild);
        try { viewer = makeViewer(Cesium, 2); }
        catch (second) {
          while (host.firstChild) host.removeChild(host.firstChild);
          throw new Error('this device could not start 3D graphics');
        }
      }
      if (disposed) { try { viewer.destroy(); } catch (e) { /* gone */ } viewer = null; return null; }
      try {
        viewer.scene.renderError.addEventListener(function () {
          fail('the 3D view stopped drawing on this device');
        });
      } catch (e) { /* older Scene */ }
      try {
        viewer.scene.canvas.addEventListener('webglcontextlost', function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          fail('this device ran short of graphics memory');
        });
      } catch (e) { /* stub canvas */ }
      dropIonLogo(viewer);
      /* The planet in black space, as the reference viewer shows it: no star
         field, no sun or moon, only the atmosphere's rim. */
      try {
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
        if (viewer.scene.sun) viewer.scene.sun.show = false;
        if (viewer.scene.moon) viewer.scene.moon.show = false;
        if (Cesium.Color && Cesium.Color.BLACK) viewer.scene.backgroundColor = Cesium.Color.BLACK;
      } catch (e) { /* older Scene */ }
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
      viewer.scene.skyAtmosphere.saturationShift = -0.12;
      viewer.scene.skyAtmosphere.brightnessShift = -0.08;
      entities = viewer.entities;
      try { buildHud(Cesium); } catch (e) { /* the globe works without its HUD */ }
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
          var satLayer = sat ? viewer.imageryLayers.addImageryProvider(sat) : null;
          reannounce = todaysEarth(Cesium, satLayer, sat);
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
      onFail: function (f) { if (typeof f === 'function') failHandlers.push(f); },
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
            followed = viewKey(map);
            if (reannounce) reannounce();
            if (state.where) state.where();
            if (state.animate) state.animate(state.animated);
            requestRender();
            return;
          }
          if (++tries < 30) requestAnimationFrame(settle);
        })();
      },
      /* An animated look stops asking for frames by itself once hidden, and
         picks up again on the next reveal. */
      hide: function () { host.style.display = 'none'; setControls(''); },
      viewer: function () { return viewer; }
    };
  }

  window.PNDGlobe = {
    mount: mount, readMarkers: readMarkers, webglOk: webglOk,
    mgrs: mgrs, dms: dms, magnitudeOf: magnitudeOf, PRESETS: PRESETS,
    prefers: prefers, remember: remember, BASE: BASE, BASES: BASES, PREF: PREF,
    /* For the tests, which drive the loader host by host. */
    __loadCesium: loadCesium
  };
})();
