/*
 * Shared behaviour for every map in the app.
 *
 * Three things every page was getting wrong on its own:
 *
 * 1. The whole world was never visible. Each page hard-coded setView(..., 2),
 *    which puts a 1024px-tall world inside a ~460px-tall panel -- so the map
 *    opened showing roughly 70N to 52S, cutting off a third of the southern
 *    hemisphere and the Arctic. The fix is not another magic number: the zoom
 *    that shows the whole world depends on how tall the container actually is,
 *    so it is measured rather than guessed, and re-measured when that changes.
 *
 * 2. Zooming out far enough left empty grey bands above and below the map,
 *    because nothing stopped the view from being larger than the world. The
 *    same measurement gives the floor: never zoom out past the point where the
 *    world fills the container. Longitude wraps, so only height can run out.
 *
 * 3. The basemap was plain OpenStreetMap raster, which carries almost no
 *    labels at world zoom and is a bright street map on a dark page. It is now
 *    a dark canvas with a separate label layer, so places are named.
 *
 * Applied by wrapping L.map, so a page cannot forget to opt in.
 * Load after Leaflet and before the page builds its map.
 */
/*
 * If the map library is missing, stand in for it and say so.
 *
 * Every map page's script starts `const map = L.map('map')`, so a library
 * that never arrives throws on the first statement and takes the rest of the
 * page with it — the feed request, the list of hazards, the filters. Measured
 * in Chromium with that request blocked, /alerts showed 5 of its 25 records
 * and sat on "Loading…" for ever. The library is now served from this origin
 * rather than a CDN, which removes the likeliest cause, but a script can
 * still fail to arrive and a page about hazards near you must not go blank
 * when it does.
 *
 * So a stand-in is installed: it answers every call, does nothing, and puts
 * an honest line in each map panel saying the map could not be loaded. It is
 * never a silent pretence that there is a map — an empty panel claiming
 * nothing is nearby would be worse than no panel at all.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.L || typeof window.L.map !== 'function') {
    installStandIn();
    return;
  }

  function installStandIn() {
    if (window.L && window.L.__pndStandIn) return;
    var say = 'The map could not be loaded, so it is not shown. Everything else on this page is unaffected.';
    var NOT_A_FUNCTION = { then: 1, nodeType: 1 };

    /* Anything a page reaches for is both callable and reachable through.
       `map.scrollWheelZoom.enable()` and `L.control.layers({}).addTo(map)`
       are two levels deep, so a stand-in that only answers the first level
       throws on the second and has solved nothing. */
    function callable(make) {
      var fn = function () { return make(); };
      if (typeof Proxy !== 'function') return fn;
      return new Proxy(fn, {
        get: function (t, k) {
          if (typeof k === 'symbol' || NOT_A_FUNCTION[k]) return undefined;
          if (k === 'name' || k === 'length' || k === 'prototype' ||
              k === 'call' || k === 'apply' || k === 'bind') return t[k];
          return callable(make);
        },
        apply: function () { return make(); }
      });
    }

    /* One map, layer or marker. Chained calls hand back the stand-in itself,
       not the object behind it, or `L.circleMarker(...).addTo(layer)` breaks
       at the second link. */
    function thing() {
      var self = {}, proxy;
      var same = function () { return proxy; };
      var known = {
        getLayers: function () { return []; },
        getZoom: function () { return 0; },
        getCenter: function () { return { lat: 0, lng: 0 }; },
        getSize: function () { return { x: 0, y: 0 }; },
        getBounds: same,
        isValid: function () { return false; },
        toGeoJSON: function () { return null; },
        __pndStandIn: true
      };
      if (typeof Proxy !== 'function') {
        proxy = self;
        for (var k in known) if (Object.prototype.hasOwnProperty.call(known, k)) self[k] = known[k];
        /* Without Proxy, only the calls this codebase makes are answered. */
        ['addTo', 'addLayer', 'removeLayer', 'clearLayers', 'setView', 'flyTo',
         'fitBounds', 'bindPopup', 'openPopup', 'closePopup', 'on', 'off',
         'remove', 'setStyle', 'setLatLng', 'addData', 'invalidateSize',
         'eachLayer', 'setMinZoom', 'setMaxZoom'
        ].forEach(function (n) { self[n] = same; });
        self.scrollWheelZoom = { enable: same, disable: same };
        return proxy;
      }
      proxy = new Proxy(self, {
        get: function (t, k) {
          if (typeof k === 'symbol' || NOT_A_FUNCTION[k]) return undefined;
          if (Object.prototype.hasOwnProperty.call(known, k)) return known[k];
          return callable(same);
        },
        has: function () { return true; }
      });
      return proxy;
    }

    /* The map panel says what happened, in the place the map would have
       been. An empty panel would read as "nothing is happening near you". */
    function mark(id) {
      var el = typeof id === 'string' ? document.getElementById(id) : id;
      if (!el || !el.setAttribute || el.getAttribute('data-map-unavailable') === '1') return;
      el.setAttribute('data-map-unavailable', '1');
      el.setAttribute('role', 'note');
      el.textContent = say;
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.textAlign = 'center';
      el.style.padding = '18px';
      el.style.color = '#9db9ad';
      el.style.font = '13px system-ui, sans-serif';
    }

    var L = typeof Proxy === 'function'
      ? new Proxy({ __pndStandIn: true }, {
          get: function (t, k) {
            if (typeof k === 'symbol' || NOT_A_FUNCTION[k]) return undefined;
            if (k === '__pndStandIn') return true;
            if (k === 'map') return function (id) { mark(id); return thing(); };
            return callable(thing);
          },
          has: function () { return true; }
        })
      : { __pndStandIn: true, map: function (id) { mark(id); return thing(); },
          layerGroup: thing, circleMarker: thing, tileLayer: thing, marker: thing,
          featureGroup: thing, rectangle: thing, geoJSON: thing, circle: thing,
          divIcon: thing, control: { layers: thing, attribution: thing, scale: thing } };
    window.L = L;
    window.PNDMap = window.PNDMap || {
      basemap: function (m) { return m; },
      riskMarker: function () { return thing(); },
      worldZoom: function () { return 1; }
    };
    window.PNDMap.mapUnavailable = true;
  }

  var TILE = 256;
  // The Mercator projection stops here; there is no map data beyond it.
  var TOP = 85.0511287798, WORLD = [[-TOP, -180], [TOP, 180]];
  // Most land, and nearly all of it that people live on, is north of the
  // equator; centring there trades Antarctic ocean for Alaska and Scandinavia.
  var HOME = [20, 0];

  /*
   * The zoom at which one world spans the container exactly.
   *
   * Fitting the world's height instead put the entire pole-to-pole range in
   * view, but in a panel four times wider than it is tall that left the world
   * about a quarter of the width, so it tiled sideways and the page showed
   * three Americas. A world map shows one world across the frame, which is
   * what the width decides. It is both the opening view and the zoom floor:
   * below it the world no longer reaches the edges and empty space shows.
   */
  function worldZoom(map) {
    var size = map.getSize();
    if (!size || !size.x) return 1;
    return Math.log(size.x / TILE) / Math.LN2;
  }

  function applyWorldFit(map, recenter) {
    var z = worldZoom(map);
    if (!isFinite(z)) return;
    try {
      map.setMinZoom(z);
      if (recenter || map.getZoom() < z) map.setView(HOME, z, { animate: false });
    } catch (e) { /* a stub map without a real view */ }
  }

  /*
   * One basemap everywhere, so a map means the same thing on every page.
   *
   * The political world map -- a colour per country, borders, names, blue
   * ocean -- is drawn from country outlines the app serves itself rather than
   * fetched from a tile service. No raster tile provider renders that style,
   * and a self-served layer also cannot go blank the way a tile layer can.
   * It is one click away in the layers control, and it lies underneath the
   * satellite view as the floor that is left if the imagery never arrives.
   */
  var IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  /*
   * The Earth as it looked on the latest complete day, not years ago.
   *
   * The satellite view was Esri's World Imagery on its own: sharp, and a
   * mosaic of captures that are months to years old. Nothing said so. Opened
   * on a flood, it showed the dry ground from before the flood under the
   * flood's marker, and a reader had every reason to take it for the scene
   * now - the opposite of what a disaster map is for.
   *
   * NASA publishes a true-colour picture of the whole planet every day from
   * the Terra satellite's MODIS instrument, through its Global Imagery
   * Browse Services. It is public, needs no key, and is what NASA's own
   * Worldview opens on. Its pixels are about 250 m, so it is the right
   * picture from a continent down to a region - a cyclone's eye, a smoke
   * plume, a river out of its banks - and too coarse past zoom 9, where the
   * detailed mosaic takes over and says what it is.
   *
   * The day is the latest one that ended at least four hours ago. Today's
   * picture is still being assembled swath by swath, its tiles are JPEG, and
   * the part of the world the satellite has not yet passed over comes back
   * opaque black - so "today" would black out the Americas every morning UTC.
   * The four hours cover NASA's near-real-time processing of the last passes.
   * Clouds are part of the picture: a satellite photographs the top of a
   * storm, not the flooding under it, and the caption says that too.
   */
  var DAILY_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';
  var DAILY_MAX_ZOOM = 9;
  var DAILY_SETTLE_HOURS = 28;
  var DAILY_CREDIT = 'Daily imagery: NASA GIBS';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dailyImagery(now) {
    var t = (now === undefined ? Date.now() : Number(now)) - DAILY_SETTLE_HOURS * 3600e3;
    var day = new Date(t).toISOString().slice(0, 10);
    var parts = day.split('-');
    return {
      day: day,
      label: Number(parts[2]) + ' ' + MONTHS[Number(parts[1]) - 1] + ' ' + parts[0],
      url: 'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/' + DAILY_LAYER +
        '/default/' + day + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
      credit: DAILY_CREDIT,
      maxZoom: DAILY_MAX_ZOOM
    };
  }
  /* What the caption says for each source. One table, so the flat map and
     the globe can never describe the same picture two different ways. */
  function imageryText(source, latest) {
    if (source === 'daily') {
      return 'Satellite: NASA, ' + latest.label + ' \u2014 the latest complete day. Cloud is part of the picture.';
    }
    if (source === 'fallback') {
      return 'NASA\u2019s picture of ' + latest.label + ' did not load here. Showing a mosaic of past captures \u2014 not the scene now.';
    }
    if (source === 'detail') {
      return 'Satellite: a detailed mosaic of past captures \u2014 not the scene now. Zoom out for NASA\u2019s picture of ' + latest.label + '.';
    }
    if (source === 'drawn') {
      return 'Satellite imagery did not load here. This is the drawn map.';
    }
    return '';
  }
  var PLACES = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  var COUNTRIES = '/world-countries.json';
  var ESRI_CREDIT = 'Esri, HERE, Garmin, © OpenStreetMap contributors';
  var NE_CREDIT = 'Country outlines: Natural Earth (public domain)';
  var LABEL_PANE = 'pndLabels';

  // Chosen so no two countries that share a border share a colour; the
  // assignment itself is computed when world-countries.json is built.
  var PALETTE = ['#f2b880', '#9ad4a0', '#f4d06f', '#a8c8ec', '#e8a0a8', '#c9b3e6', '#8fd5c8'];
  var OCEAN = '#a9d5e8', BORDER = '#6d7f8c';

  /*
   * Place names and borders sit above the basemap but below the event markers,
   * which needs a pane of their own: the stock pane in between (shadowPane) is
   * positioned for marker shadows, not tiles, so a tile layer put there is
   * offset from the map it is meant to label. Clicks pass straight through so
   * it can never swallow a marker.
   */
  function labelPane(map) {
    if (typeof map.createPane !== 'function') return undefined;
    if (!map.getPane(LABEL_PANE)) {
      var pane = map.createPane(LABEL_PANE);
      /* Above Leaflet's overlay pane (400), where the country polygons are
         drawn, and below its marker pane (600). At 350 the names rendered
         underneath the countries and were invisible. */
      pane.style.zIndex = 450;
      pane.style.pointerEvents = 'none';
    }
    return LABEL_PANE;
  }

  /*
   * The floor under the satellite imagery, and it has to be under it.
   *
   * The drawn world is vector shapes - an ocean rectangle and a polygon per
   * country, both fully opaque - and Leaflet draws vector shapes in its
   * overlay pane at z-index 400, above every tile layer at 200. So "the
   * political world underneath the imagery" was painted on top of it: from
   * the day Satellite became the default, the flat map's Satellite view
   * showed the political map, and the imagery it requested was never seen.
   * Nothing caught it because every check asked which tiles were requested,
   * not what reached the screen. The floor gets its own pane below the tiles.
   */
  var UNDER_PANE = 'pndUnder';
  function underPane(map) {
    if (typeof map.createPane !== 'function') return undefined;
    if (!map.getPane(UNDER_PANE)) {
      var pane = map.createPane(UNDER_PANE);
      pane.style.zIndex = 150;          // below the tile pane (200)
      pane.style.pointerEvents = 'none';
    }
    return UNDER_PANE;
  }

  /** The widest ring of a country, and its centre, for placing the name. */
  function anchorOf(geom) {
    var rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(function (p) { return p[0]; });
    var best = null, bestSpan = -1;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i], minX = 180, maxX = -180, minY = 90, maxY = -90;
      for (var j = 0; j < r.length; j++) {
        if (r[j][0] < minX) minX = r[j][0];
        if (r[j][0] > maxX) maxX = r[j][0];
        if (r[j][1] < minY) minY = r[j][1];
        if (r[j][1] > maxY) maxY = r[j][1];
      }
      var span = (maxX - minX) * (maxY - minY);
      if (span > bestSpan) { bestSpan = span; best = { lat: (minY + maxY) / 2, lon: (minX + maxX) / 2, w: maxX - minX }; }
    }
    return best;
  }

  /* `named` false draws the world without country names: under satellite
     imagery the drawn world is a fallback for tiles that never arrive, and
     its labels would otherwise sit on top of the imagery's own alongside a
     second copy of every name. */
  function political(map, named) {
    var withNames = named !== false;
    /* Only the floor under the imagery moves; the Political view itself stays
       where vector layers normally draw. */
    var floor = withNames ? undefined : underPane(map);
    var group = L.layerGroup();
    /* The world file is fetched asynchronously, so a showNames() call can
       arrive before there is anything to name; it is remembered instead. */
    group.showNames = function () {
      group.__wantNames = true;
      if (group.__showNames) group.__showNames();
    };
    if (typeof L.rectangle === 'function') {
      L.rectangle(WORLD, Object.assign({ fillColor: OCEAN, fillOpacity: 1, stroke: false, interactive: false },
        floor ? { pane: floor } : {})).addTo(group);
    }
    if (typeof fetch !== 'function' || typeof L.geoJSON !== 'function') return group;

    var labels = L.layerGroup();
    fetch(COUNTRIES).then(function (r) { return r.json(); }).then(function (data) {
      L.geoJSON(data, Object.assign({
        interactive: false,
        style: function (f) {
          return { fillColor: PALETTE[f.properties.c % PALETTE.length], fillOpacity: 1,
            color: BORDER, weight: 0.7, opacity: 0.85 };
        }
      }, floor ? { pane: floor } : {})).addTo(group);

      var places = data.features.map(function (f) {
        return { name: f.properties.n, at: anchorOf(f.geometry) };
      }).filter(function (p) { return p.at; });

      /* A name is only drawn when its country is actually wide enough on
         screen to hold it, so the world view carries the large countries and
         the rest appear as the reader zooms in, instead of a pile of
         overlapping text at every zoom. */
      function relabel() {
        labels.clearLayers();
        var bounds = map.getBounds();
        var perDegree = map.getSize().x / (bounds.getEast() - bounds.getWest());
        var placed = [];

        /* Largest countries first, and a name is dropped if it would sit on
           one already placed. Without this the crowded parts of the map read
           as "MorAlgeria" and "Mali Niger" rather than as country names. */
        places.slice().sort(function (a, b) { return b.at.w - a.at.w; }).forEach(function (p) {
          if (!bounds.contains([p.at.lat, p.at.lon])) return;
          var textPx = p.name.length * 5.6 + 6;
          // Only name a country wide enough on screen to carry the text.
          if (p.at.w * perDegree < Math.max(34, textPx)) return;

          var pt = map.latLngToContainerPoint([p.at.lat, p.at.lon]);
          var box = { l: pt.x - textPx / 2, r: pt.x + textPx / 2, t: pt.y - 7, b: pt.y + 7 };
          for (var i = 0; i < placed.length; i++) {
            var o = placed[i];
            if (box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t) return;
          }
          placed.push(box);

          L.marker([p.at.lat, p.at.lon], {
            interactive: false, pane: labelPane(map),
            icon: L.divIcon({ className: 'pnd-country', html: PNDMapEscape(p.name), iconSize: [0, 0] })
          }).addTo(labels);
        });
      }
      /* Turned on now, or later by showNames() if the imagery above this
         layer turns out not to be arriving. */
      group.__showNames = function () {
        if (group.hasLayer(labels)) return;
        labels.addTo(group);
        map.on('zoomend moveend', relabel);
        relabel();
      };
      if (withNames) group.__showNames();
      else if (group.__wantNames) group.__showNames();
    }).catch(function () { /* offline: the ocean and the markers still draw */ });

    group.getAttribution = function () { return NE_CREDIT; };
    return group;
  }

  function PNDMapEscape(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /*
   * Styling ships with the code that builds these controls, rather than a
   * stylesheet, because index.html and dashboard.html carry their own CSS and
   * load neither shared sheet -- a rule kept there misses exactly those two.
   */
  var STYLE_ID = 'pnd-map-style';
  var CONTROL_CSS = [
    '.leaflet-container .leaflet-control-layers{background:#06261d;border:1px solid #156047;border-radius:8px;box-shadow:none;color:#f5fbf8}',
    '.leaflet-container .leaflet-control-layers-toggle{background-color:#06261d;border-radius:8px}',
    '.leaflet-container .leaflet-control-layers-expanded{padding:8px 10px;font:600 12px/1.5 system-ui,sans-serif}',
    '.leaflet-container .leaflet-control-layers-list label{display:flex;align-items:center;gap:7px;cursor:pointer;color:#f5fbf8}',
    '.leaflet-container .leaflet-control-layers-separator{border-top:1px solid #156047}',
    // Country names: dark ink haloed in white so they stay readable over every
    // colour in the palette without a box around them.
    '.leaflet-container .pnd-country{color:#24323d;font:600 11px/1.1 system-ui,sans-serif;white-space:nowrap;',
    'transform:translate(-50%,-50%);width:max-content;',
    'text-shadow:0 0 3px rgba(255,255,255,.95),0 1px 2px rgba(255,255,255,.95),0 -1px 2px rgba(255,255,255,.95)}'
  ].join('');

  /* The globe/flat control. Deliberately a plain button rather than a Leaflet
     control: it has to sit above the Cesium canvas, which Leaflet's control
     panes know nothing about. */
  var GLOBE_CSS = [
    /* Above the globe host, which is itself above every Leaflet pane. */
    /* Below the zoom control, not on top of it.
       Measured at 1280x900 on /live-map and /: the zoom-in button sat at
       (29,359) 30x30 and this toggle at (27,357) 109x31 with z-index 1300, so
       elementFromPoint over BOTH zoom buttons returned the toggle. The zoom
       control is the first thing a reader reaches for on a map and it was
       unclickable on every map page in the site. Leaflet's zoom control is
       two 30px buttons at top:10px, so the toggle starts below that. */
    '.pnd-view-toggle{position:absolute;top:84px;left:10px;z-index:1300;',
    'display:inline-flex;gap:0;border:1px solid #2c5c4c;border-radius:8px;',
    'overflow:hidden;font:600 11px/1 system-ui,sans-serif}',
    '.pnd-view-toggle button{appearance:none;border:0;padding:7px 11px;cursor:pointer;',
    'background:#07231b;color:#9db9ad;letter-spacing:.04em}',
    '.pnd-view-toggle button[aria-pressed="true"]{background:#25e29c;color:#04120e}',
    '.pnd-view-toggle button:focus-visible{outline:2px solid #25e29c;outline-offset:-2px}',
    '.pnd-globe .cesium-widget-credits{font-size:10px;opacity:.75}',
    /* Which picture is showing. Bottom-left, clear of the attribution on the
       right and above it on a phone, never catching the pointer. */
    '.pnd-imagery-note{position:absolute;left:8px;bottom:26px;z-index:1300;pointer-events:none;',
    'max-width:min(420px,calc(100% - 16px));padding:5px 8px;border-radius:6px;',
    'background:rgba(4,18,14,.86);color:#e6f4ee;font:500 11px/1.35 system-ui,sans-serif}',
    '.pnd-imagery-note[hidden]{display:none}',
    /* The wheel hint, shown only when a reader tries the plain wheel over
       the map. Above the panes, below the controls, and never in the way
       of a pointer. */
    '.pnd-wheel-hint{position:absolute;inset:auto 0 0 0;z-index:1200;pointer-events:none;',
    'display:flex;align-items:center;justify-content:center;',
    'padding:10px 12px;margin:0;background:rgba(3,18,14,.86);color:#eaf7f1;',
    'font:700 12px/1.3 system-ui,sans-serif;text-align:center;',
    'opacity:0;transition:opacity .16s ease}',
    '.pnd-wheel-hint[data-shown]{opacity:1}',
    '@media (prefers-reduced-motion:reduce){.pnd-wheel-hint{transition:none}}'
  ].join('');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CONTROL_CSS + GLOBE_CSS;
    (document.head || document.documentElement).appendChild(tag);
  }

  /*
   * Which picture is on screen, and how old it is, said on the map itself.
   *
   * Two sources now share one satellite view, and they differ by years. A
   * reader cannot tell a 250 m photograph from yesterday from a sharp one
   * assembled long ago by looking, so the view says which it is showing at
   * the zoom it is at - and, if NASA's tiles are refused, says that it has
   * fallen back to the old mosaic rather than letting it pass for today.
   * The globe reports its own source through the same caption.
   */
  function imageryNote(map, satellite, daily, latest, under) {
    var box = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!box || typeof document === 'undefined' || typeof map.on !== 'function') return null;
    var el = document.createElement('div');
    el.className = 'pnd-imagery-note';
    el.setAttribute('role', 'note');
    box.appendChild(el);
    var state = { view: 'flat', globe: null, loaded: false, errors: 0, failed: false, rescue: null,
      rescueLoaded: false, rescueErrors: 0, rescueFailed: false };
    function source() {
      if (state.view === 'globe') return state.globe;
      if (typeof map.hasLayer === 'function' && !map.hasLayer(satellite)) return null;
      /* By the zoom tiles are drawn at, which Leaflet rounds: these maps sit
         at fractional zooms, and at 9.3 the daily picture is still the one on
         screen while an unrounded test already called it the mosaic. */
      var z = typeof map.getZoom === 'function' ? Math.round(map.getZoom()) : 0;
      if (z > DAILY_MAX_ZOOM) return 'detail';
      if (!state.failed) return 'daily';
      /* Both hosts refused: what is on screen is the drawn world, and calling
         it a mosaic would describe a picture that is not there. */
      return state.rescueFailed ? 'drawn' : 'fallback';
    }
    /* Above the credit line, however many lines it wraps to at this width. */
    function place() {
      var credit = box.querySelector('.leaflet-control-attribution');
      var h = credit && credit.offsetHeight ? credit.offsetHeight : 16;
      el.style.bottom = (h + 8) + 'px';
    }
    function render() {
      var s = source();
      el.hidden = !s;
      el.textContent = s ? imageryText(s, latest) : '';
      el.setAttribute('data-source', s || '');
      if (s) place();
    }
    if (typeof daily.on === 'function') {
      daily.on('tileload', function () { state.loaded = true; });
      /* Three refusals and not one picture: the host is not answering. The
         mosaic is put in underneath for the zooms it had left to the daily
         picture, so the view is still a photograph - and captioned as the old
         one it is. A tile that did load means the service is up, and a stray
         failure is not a reason to swap the reader's picture. */
      daily.on('tileerror', function () {
        state.errors++;
        if (state.loaded || state.failed || state.errors < 3) return;
        state.failed = true;
        try {
          state.rescue = L.tileLayer(IMAGERY, { attribution: ESRI_CREDIT, maxZoom: DAILY_MAX_ZOOM, noWrap: true });
          state.rescue.on('tileload', function () { state.rescueLoaded = true; });
          state.rescue.on('tileerror', function () {
            try { under.showNames(); } catch (e) {}
            if (state.rescueLoaded || state.rescueFailed || ++state.rescueErrors < 3) return;
            state.rescueFailed = true;
            render();
          });
          satellite.addLayer(state.rescue);
        } catch (e) { /* the drawn world is still underneath */ }
        render();
      });
    }
    map.on('zoomend baselayerchange resize', render);
    render();
    /* The credit line is filled in as layers add their attributions, after
       this first render; place the caption again once it has settled. */
    setTimeout(render, 600);
    map.__pndImageryNote = {
      element: el,
      setView: function (v) { state.view = v; render(); },
      setGlobe: function (s) { state.globe = s; render(); }
    };
    return map.__pndImageryNote;
  }

  function basemap(map) {
    if (!map) return map;
    try {
      injectStyle();
      var pane = labelPane(map);
      var views = {};
      var under = null, latest = null, daily = null;
      var plain = political(map);
      views['Political'] = plain;

      if (typeof L.tileLayer === 'function') {
        /* The political world sits UNDERNEATH the imagery rather than being
           replaced by it. Esri's tiles come from a third-party host that a
           network can refuse, and a satellite view whose tiles never answer
           is a black panel; with the drawn world beneath it, a reader who
           loses the imagery still gets coastlines, borders and names. The
           globe already works this way. */
        under = political(map, false);
        latest = dailyImagery();
        /* NASA's picture of the latest complete day, from the world view down
           to zoom 9; the bounds keep Leaflet from asking for the tiles past
           the Mercator edge that the service does not have. */
        daily = L.tileLayer(latest.url, {
          attribution: latest.credit, subdomains: 'abc', maxZoom: DAILY_MAX_ZOOM,
          maxNativeZoom: DAILY_MAX_ZOOM, noWrap: true,
          bounds: [[-85.0511287776, -179.999999975], [85.0511287776, 179.999999975]]
        });
        /* The detailed mosaic, from where the daily picture runs out. */
        var imagery = L.tileLayer(IMAGERY, { attribution: ESRI_CREDIT, minZoom: DAILY_MAX_ZOOM + 1, maxZoom: 18, noWrap: true });
        /* Esri's tiles come from a third-party host that a network can refuse.
           When they do not arrive the drawn world underneath is all there is,
           and an unlabelled one is a puzzle - so its own country names come
           back the moment the imagery is shown not to be answering. */
        if (typeof imagery.on === 'function') {
          imagery.on('tileerror', function () { try { under.showNames(); } catch (e) {} });
        }
        views['Satellite'] = L.layerGroup([
          under, daily, imagery,
          L.tileLayer(PLACES, { maxZoom: 18, pane: pane, opacity: 0.95, noWrap: true })
        ]);
      }

      /* Satellite is what a reader means by looking at a map of a disaster:
         the ground, photographed, rather than a coloured abstraction of it -
         and zoomed out, photographed on the latest complete day rather than
         whenever the mosaic was assembled. It is the default wherever it can
         be built, and Political remains one click away. */
      var start = views['Satellite'] || plain;
      start.addTo(map);
      if (map.attributionControl && map.attributionControl.addAttribution) map.attributionControl.addAttribution(NE_CREDIT);
      if (L.control && typeof L.control.layers === 'function' && views['Satellite']) {
        L.control.layers({ 'Satellite': views['Satellite'], 'Political': plain }, null,
          { position: 'topright' }).addTo(map);
      }
      /* Last, and on its own: the caption describes the map, so nothing in it
         may stop the map being built. */
      if (views['Satellite']) {
        try { imageryNote(map, views['Satellite'], daily, latest, under); } catch (e) { /* no caption */ }
      }
    } catch (e) { /* stub layers in the test harness */ }
    attachGlobe(map);
    return map;
  }

  /*
   * The 3D globe over the flat map, on every page that has one.
   *
   * Hung off basemap() because that is the single call all sixteen map pages
   * already make, so none of them needs to know the globe exists. The flat map
   * underneath is never torn down: it is what the globe mirrors, it is what
   * remains if WebGL or the CDN is unavailable, and it is what a reader gets
   * back by pressing Flat.
   */
  function attachGlobe(map) {
    try {
      if (!window.PNDGlobe || !map || typeof map.getContainer !== 'function') return;
      var container = map.getContainer();
      if (!container || container.__pndGlobe) return;
      container.__pndGlobe = true;
      if (!PNDGlobe.webglOk()) return;

      var handle = null, syncTimer = null;

      function resync() {
        if (!handle) return;
        clearTimeout(syncTimer);
        /* Pages redraw a whole layer group per keystroke; syncing on every
           individual layeradd would rebuild the globe hundreds of times. */
        /* Re-checked when the timer fires, not only when it is set. The
           globe tears itself down and nulls this handle when Cesium cannot
           be fetched, and a sync already queued behind a layeradd then ran
           against nothing: every unreachable-CDN load threw an uncaught
           TypeError, on the one path that exists for the CDN being
           unreachable. */
        syncTimer = setTimeout(function () { if (handle) handle.sync(); }, 120);
      }

      function show() {
        if (!handle) {
          handle = PNDGlobe.mount(map, container);
          if (!handle) return;
          if (typeof map.on === 'function') map.on('layeradd layerremove', resync);
          handle.ready.then(function () {
            /* Revealed only now: until the viewer exists there is nothing to
               show, and the flat map underneath is the better thing to be
               looking at. */
            if (PNDGlobe.prefers() !== 'flat') { handle.reveal(); noteView('globe'); }
            resync();
          }).catch(function () {
            /* Cesium never arrived. Drop back to the flat map rather than
               leaving a dead panel over it. */
            teardown();
            setPressed('flat');
            noteView('flat');
          });
        }
        if (handle.viewer && handle.viewer()) handle.reveal();
      }

      function teardown() {
        if (!handle) return;
        if (typeof map.off === 'function') map.off('layeradd layerremove', resync);
        handle.destroy();
        handle = null;
      }

      /* The caption follows whichever view is in front; the globe says which
         picture it is draping as its camera moves. */
      function noteView(v) { if (map.__pndImageryNote) map.__pndImageryNote.setView(v); }
      container.addEventListener('pnd-imagery', function (ev) {
        if (map.__pndImageryNote && ev && ev.detail) map.__pndImageryNote.setGlobe(ev.detail.source);
      });

      var bar = document.createElement('div');
      bar.className = 'pnd-view-toggle';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Map view');
      var bGlobe = document.createElement('button');
      bGlobe.type = 'button'; bGlobe.textContent = 'Globe';
      var bFlat = document.createElement('button');
      bFlat.type = 'button'; bFlat.textContent = 'Flat';
      bar.appendChild(bGlobe); bar.appendChild(bFlat);
      container.appendChild(bar);

      function setPressed(view) {
        bGlobe.setAttribute('aria-pressed', String(view === 'globe'));
        bFlat.setAttribute('aria-pressed', String(view !== 'globe'));
      }

      function choose(view, persist) {
        if (persist) PNDGlobe.remember(view);
        setPressed(view);
        if (view === 'globe') show();
        else if (handle) handle.hide();
        noteView(view === 'globe' && handle && handle.viewer && handle.viewer() ? 'globe' : 'flat');
      }

      bGlobe.addEventListener('click', function () { choose('globe', true); });
      bFlat.addEventListener('click', function () { choose('flat', true); });

      /* Cesium is megabytes, so a reader who has chosen Flat never downloads
         it; the globe is fetched on the first press instead. */
      choose(PNDGlobe.prefers() === 'flat' ? 'flat' : 'globe', false);
    } catch (e) { /* the flat map is already up; leave it alone */ }
  }

  /*
   * The wheel, the way every other map on the web handles it.
   *
   * A map inside a scrolling page has to answer two things at once: the wheel
   * is how a reader moves down the page, and it is also how a reader zooms a
   * map. Taking it for zoom traps the page; ignoring it makes the map feel
   * dead. The settled convention - Google Maps, Mapbox and Leaflet's own
   * documentation all do this - is that the modifier key decides: plain wheel
   * scrolls the page, Ctrl (or Command) plus wheel zooms the map, and the map
   * says so the first time a reader tries the plain wheel over it.
   *
   * This replaces a click-to-arm behaviour, which had the same intent and was
   * not a convention anybody arrives knowing: the wheel did nothing until the
   * map had been clicked, and clicking a map is how you open an event.
   *
   * A trackpad pinch arrives as a wheel event with ctrlKey set, so pinch to
   * zoom works on a laptop without any extra handling. Dragging, two-finger
   * pinch on a touchscreen, double-click zoom, keyboard arrows and the zoom
   * buttons are Leaflet's own and are deliberately left alone.
   */
  var HINT_CLASS = 'pnd-wheel-hint';
  function wheelGesture(map, container) {
    if (!container || !container.addEventListener || typeof map.scrollWheelZoom !== 'object') return;
    /* Leaflet's own handler stays off until a modifier is actually held. */
    try { map.scrollWheelZoom.disable(); } catch (e) { /* stub */ }

    var hint = null, hideTimer = null;
    function say(text) {
      if (!document || !document.createElement) return;
      if (!hint) {
        hint = document.createElement('div');
        hint.className = HINT_CLASS;
        hint.setAttribute('role', 'status');
        container.appendChild(hint);
      }
      hint.textContent = text;
      hint.setAttribute('data-shown', '1');
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { if (hint) hint.removeAttribute('data-shown'); }, 1600);
    }

    container.addEventListener('wheel', function (ev) {
      var zooming = ev.ctrlKey || ev.metaKey;
      try {
        if (zooming) {
          if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
          /* Without this the browser zooms the whole page instead. */
          if (ev.cancelable) ev.preventDefault();
        } else {
          if (map.scrollWheelZoom.enabled()) map.scrollWheelZoom.disable();
          say(WHEEL_HINT);
        }
      } catch (e) { /* a stub map has no handler to toggle */ }
    }, { passive: false, capture: true });

    /* Leaving the map must not leave the handler armed for the next page
       scroll that happens to pass over it. */
    container.addEventListener('mouseleave', function () {
      try { map.scrollWheelZoom.disable(); } catch (e) {}
      if (hint) hint.removeAttribute('data-shown');
    });

    /* Reachable without a pointer at all: Leaflet gives a focused map arrow
       keys and +/-, and the container needs to be focusable for that. */
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
  }
  var WHEEL_HINT = (typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || ''))
    ? 'Use ⌘ + scroll to zoom the map'
    : 'Use Ctrl + scroll to zoom the map';

  var base = L.map;
  if (base.__pndMapSetup) return;

  function wrapped(element, options) {
    var opts = {};
    for (var k in (options || {})) if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k];

    // A page that deliberately asks for wheel zoom keeps it; otherwise the
    // wheel must not steal the page scroll out from under the reader.
    var explicitWheel = options && Object.prototype.hasOwnProperty.call(options, 'scrollWheelZoom');
    if (!explicitWheel) opts.scrollWheelZoom = false;
    // Whole-number zooms cannot land on "the world exactly fills the panel".
    if (!('zoomSnap' in opts)) opts.zoomSnap = 0;
    // Copies of the world either side are what made three Americas.
    opts.worldCopyJump = false;
    // A page-supplied minZoom is a guess at the same thing this measures.
    delete opts.minZoom;

    var map = base.call(L, element, opts);

    try {
      map.setMaxBounds(WORLD);
      // Springy rather than rigid: the edge of the world should push back, not
      // feel like the map has seized up mid-drag.
      map.options.maxBoundsViscosity = 0.5;
      applyWorldFit(map, true);

      var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
      if (container && typeof ResizeObserver === 'function') {
        // Leaflet only re-measures on window resize, so a panel that changes
        // size on its own would keep a stale view and stop drawing tiles.
        var ro = new ResizeObserver(function () {
          try { map.invalidateSize({ animate: false }); } catch (e) { return; }
          applyWorldFit(map, false);
        });
        ro.observe(container);
      }

      if (!explicitWheel) wheelGesture(map, container);
    } catch (e) { /* a map stub without an event bus still returns a usable map */ }

    return map;
  }

  for (var prop in base) {
    if (Object.prototype.hasOwnProperty.call(base, prop)) {
      try { wrapped[prop] = base[prop]; } catch (e) { /* non-writable */ }
    }
  }
  wrapped.__pndMapSetup = true;
  // The old name, kept so a cached page that still loads it behaves.
  wrapped.__pndScrollGuard = true;
  L.map = wrapped;

  /*
   * One event marker, on the one risk scale.
   *
   * Every map page had its own ternary - red at #ef2639, orange at #ff681e,
   * green at #25e29c, and nothing else. Three levels out of six, off the
   * shared palette, and hue as the only carrier: on that map a reader with a
   * red-green deficiency could not tell a Red alert from a Green one, and a
   * screen reader was handed an unnamed circle. Here the level decides the
   * colour, the shape and the marker's accessible name together, from
   * risk.js, so a page cannot drift from the scale by editing a ternary.
   */
  function riskMarker(latlng, value, label, opts) {
    var R = window.PNDRisk;
    /* Without the scale there is no honest marker to draw: a plain one that
       states no level is better than one that states the wrong level. */
    if (!R) return L.marker(latlng, opts || {});
    var icon = R.markerIcon(value, label);
    var o = opts || {};
    var settings = { icon: L.divIcon({ className: icon.className, html: icon.html,
      iconSize: icon.iconSize, iconAnchor: icon.iconAnchor }),
      /* Leaflet's default alt is "Marker", which is what a screen reader
         announced for every event on the map. Keyboard focus is left alone:
         Leaflet already gives markers it, and map.test.js holds this file to
         not re-stating what Leaflet does. */
      alt: icon.label, title: icon.label };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) settings[k] = o[k];
    return L.marker(latlng, settings);
  }

  window.PNDMap = { basemap: basemap, worldZoom: worldZoom, WORLD: WORLD,
    riskMarker: riskMarker,
    /* Published so the globe can exclude exactly this pane rather than
       guessing at the name or rejecting every layer that has one. */
    LABEL_PANE: LABEL_PANE,
    /* And published so the globe draws the same world this map does, from
       the same file and the same colours, rather than keeping its own second
       copy. It kept one: its own Esri URL, on a different host and through a
       provider that asks for metadata first. That request was the only one it
       ever made, so the globe carried no basemap at all. */
    COUNTRIES: COUNTRIES, PALETTE: PALETTE, OCEAN: OCEAN, BORDER: BORDER,
    IMAGERY: IMAGERY, PLACES: PLACES, ESRI_CREDIT: ESRI_CREDIT,
    NE_CREDIT: NE_CREDIT,
    /* The daily picture and the words for it, shared with the globe for the
       same reason the rest of this block is. */
    dailyImagery: dailyImagery, imageryText: imageryText, DAILY_MAX_ZOOM: DAILY_MAX_ZOOM };
})();
