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
   * NASA publishes a true-colour picture of the whole planet every day
   * through its Global Imagery Browse Services. It is public, needs no key,
   * and is what NASA's own Worldview opens on. Its pixels are about 250 m,
   * so it is the right picture from a continent down to a region - a
   * cyclone's eye, a smoke plume, a river out of its banks - and too coarse
   * past zoom 9, where the detailed mosaic takes over and says what it is.
   *
   * The instrument is VIIRS on Suomi NPP, not Terra's MODIS, and the reason
   * is coverage rather than sharpness. MODIS sweeps a 2330 km swath while
   * the Earth turns about 2750 km under each successive orbit, so its
   * swaths do not meet at the equator: every MODIS day is missing tall
   * wedges of longitude, which arrive as opaque black JPEG and drew a
   * striped globe. NASA states the consequence plainly - MODIS gives
   * "global coverage every one to two days", not every day. VIIRS sweeps
   * 3060 km, wider than that 2750 km, so its swaths overlap and a single
   * day closes. No amount of waiting fixes the MODIS version: Terra never
   * passes over those strips on that date, so they are absent from the
   * complete day and not merely from the unfinished one.
   *
   * The day is the latest one that ended at least DAILY_SETTLE_HOURS ago.
   * Today's picture is still being assembled swath by swath, and the part
   * of the world the satellite has not yet passed over comes back opaque
   * black too - so "today" would black out the Americas every morning UTC.
   * Those hours cover NASA's near-real-time processing of the last passes.
   * Clouds are part of the picture: a satellite photographs the top of a
   * storm, not the flooding under it, and the caption says that too.
   */
  var DAILY_LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
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
     the globe can never describe the same picture two different ways.

     The satellite view is Esri's World Imagery at every zoom now: one
     seamless mosaic, the picture the god's-eye-view project this globe is
     adapted from opens on. NASA's daily photo used to fill the zooms up to 9
     and the mosaic took over after, and a slow or refused NASA tile let the
     drawn map show through - the view read as a patchwork of squares. The
     day's photo is still one choice away ("NASA today"), and stands in on
     its own if Esri's tiles never arrive. */
  function imageryText(source, latest) {
    if (source === 'mosaic') {
      return 'Satellite: Esri\u2019s mosaic of recent photos. It is not a live picture of today. Turn on \u201cNASA today\u201d for the latest daily photo.';
    }
    if (source === 'daily') {
      return 'Satellite: NASA\u2019s photo of ' + latest.label + ', the latest complete day. Clouds are part of the picture.';
    }
    if (source === 'fallback') {
      return 'Esri\u2019s photos did not load, so this is NASA\u2019s photo of ' + latest.label + ' instead. Clouds are part of the picture.';
    }
    if (source === 'drawn') {
      return 'Satellite photos did not load here. This is the drawn map.';
    }
    return '';
  }
  /* Whether the reader has asked for NASA's photo of the day, shared by the
     flat map and the globe and kept in this browser only. */
  var DAILY_PREF = 'pnd_nasa_today';
  function dailyWanted() { try { return localStorage.getItem(DAILY_PREF) === '1'; } catch (e) { return false; } }
  function setDailyWanted(v) { try { localStorage.setItem(DAILY_PREF, v ? '1' : '0'); } catch (e) { /* private window */ } }
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
   * How each drawn world looks.
   *
   * POLITICAL is the coloured-country map. CLEAR is the default: one quiet
   * land colour, a darker sea, fine borders and light names, and nothing
   * else. Every colour the risk scale uses - green, yellow, orange, red,
   * purple - is a colour the political palette or a satellite photograph
   * also puts on the ground, so an event marker had to compete with the map
   * under it. On CLEAR the markers are the only colour there is.
   */
  var POLITICAL = { ocean: OCEAN, land: function (f) { return PALETTE[f.properties.c % PALETTE.length]; },
    border: BORDER, weight: 0.7, opacity: 0.85, label: 'pnd-country' };
  var CLEAR = { ocean: '#0e2631', land: function () { return '#22342d'; },
    border: '#5f7d70', weight: 0.6, opacity: 0.9, label: 'pnd-country pnd-country-clear' };

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
  function political(map, named, look) {
    var withNames = named !== false;
    look = look || POLITICAL;
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
      L.rectangle(WORLD, Object.assign({ fillColor: look.ocean, fillOpacity: 1, stroke: false, interactive: false },
        floor ? { pane: floor } : {})).addTo(group);
    }
    if (typeof fetch !== 'function' || typeof L.geoJSON !== 'function') return group;

    var labels = L.layerGroup();
    fetch(COUNTRIES).then(function (r) { return r.json(); }).then(function (data) {
      L.geoJSON(data, Object.assign({
        interactive: false,
        style: function (f) {
          return { fillColor: look.land(f), fillOpacity: 1,
            color: look.border, weight: look.weight, opacity: look.opacity };
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
        /* Two named worlds can be built for one map, and only the one on
           screen needs its names placed; the other is placed when shown. */
        if (typeof map.hasLayer === 'function' && !map.hasLayer(group)) return;
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
            icon: L.divIcon({ className: look.label, html: PNDMapEscape(p.name), iconSize: [0, 0] })
          }).addTo(labels);
        });
      }
      /* Turned on now, or later by showNames() if the imagery above this
         layer turns out not to be arriving. */
      group.__showNames = function () {
        if (group.hasLayer(labels)) return;
        labels.addTo(group);
        map.on('zoomend moveend', relabel);
        if (typeof group.on === 'function') group.on('add', relabel);
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
    'text-shadow:0 0 3px rgba(255,255,255,.95),0 1px 2px rgba(255,255,255,.95),0 -1px 2px rgba(255,255,255,.95)}',
    // On the clear map the ground is dark, so the names are light.
    '.leaflet-container .pnd-country.pnd-country-clear{color:#c7d6cf;font-weight:500;letter-spacing:.02em;',
    'text-shadow:0 0 3px rgba(4,14,11,.95),0 1px 2px rgba(4,14,11,.95),0 -1px 2px rgba(4,14,11,.95)}',
    // The key: bottom-left, above the credit line and the globe alike.
    '.pnd-key{position:absolute;left:8px;bottom:26px;z-index:1300;max-width:min(210px,calc(100% - 16px));',
    'display:flex;flex-direction:column-reverse;align-items:flex-start;gap:6px;font:500 12px/1.35 system-ui,sans-serif;color:#e6f4ee}',
    '.pnd-key[hidden],.pnd-key-body[hidden]{display:none}',
    '.pnd-key-toggle{appearance:none;cursor:pointer;border:1px solid #2c5c4c;border-radius:8px;padding:6px 12px;min-height:28px;',
    'background:#07231b;color:#e6f4ee;font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em}',
    '.pnd-key-toggle[aria-expanded="true"]{background:#25e29c;color:#04120e;border-color:#25e29c}',
    '.pnd-key-toggle:focus-visible{outline:2px solid #25e29c;outline-offset:2px}',
    '.pnd-key-body{background:rgba(4,18,14,.92);border:1px solid #1f4a3c;border-radius:10px;padding:8px 10px;',
    'box-shadow:0 4px 16px rgba(0,0,0,.35)}',
    '.pnd-key-body ul{list-style:none;margin:6px 0;padding:0;display:grid;gap:4px}',
    '.pnd-key-body li{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:8px}',
    '.pnd-key-body .pnd-key-mark{display:inline-block;width:14px;height:14px;justify-self:center}',
    '.pnd-key-n{font-variant-numeric:tabular-nums;color:#9db9ad}',
    '.pnd-key-lead,.pnd-key-hint{margin:0;color:#9db9ad;font-size:11px}',
    '.pnd-key-body{overflow-y:auto}',
    '.pnd-key-body.pnd-key-compact .pnd-key-lead{display:none}'
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
  function imageryNote(map, satellite, daily, latest, under, imagery) {
    var box = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!box || typeof document === 'undefined' || typeof map.on !== 'function') return null;
    var el = document.createElement('div');
    el.className = 'pnd-imagery-note';
    el.setAttribute('role', 'note');
    box.appendChild(el);
    var state = { view: 'flat', globe: null, loaded: false, errors: 0, failed: false,
      rescued: false, dayLoaded: false, dayErrors: 0, dayFailed: false };
    var has = function (l) { return !!l && typeof map.hasLayer === 'function' && map.hasLayer(l); };
    function source() {
      if (state.view === 'globe') return state.globe;
      if (typeof map.hasLayer === 'function' && !map.hasLayer(satellite)) {
        /* NASA's photo can be switched on over the drawn map too. */
        return has(daily) && !state.dayFailed && zoomOk() ? 'daily' : null;
      }
      var dayShown = (has(daily) || state.rescued) && !state.dayFailed && zoomOk();
      if (state.failed) return dayShown ? 'fallback' : 'drawn';
      return dayShown ? 'daily' : 'mosaic';
    }
    /* By the zoom tiles are drawn at, which Leaflet rounds: at 9.3 the daily
       photo is still on screen. Past its own last zoom it is not drawn. */
    function zoomOk() {
      var z = typeof map.getZoom === 'function' ? Math.round(map.getZoom()) : 0;
      return z <= DAILY_MAX_ZOOM;
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
      /* The key sits above this caption; tell it the caption has changed. */
      try { box.dispatchEvent(new CustomEvent('pnd-caption')); } catch (e) { /* old browser */ }
    }
    if (imagery && typeof imagery.on === 'function') {
      imagery.on('tileload', function () { state.loaded = true; });
      /* Two refusals and not one photo: Esri is not answering here. NASA's
         photo of the day is put in its place, so the view is still a
         photograph - and captioned as the day's photo it is. A tile that did
         load means the service is up, and a stray failure is no reason to
         swap the reader's picture. */
      imagery.on('tileerror', function () {
        try { under.showNames(); } catch (e) {}
        state.errors++;
        if (state.loaded || state.failed || state.errors < 2) return;
        state.failed = true;
        try { if (!state.rescued && daily) { satellite.addLayer(daily); state.rescued = true; } }
        catch (e) { /* the drawn world is still underneath */ }
        render();
      });
    }
    if (daily && typeof daily.on === 'function') {
      daily.on('tileload', function () { state.dayLoaded = true; });
      daily.on('tileerror', function () {
        if (state.dayLoaded || state.dayFailed || ++state.dayErrors < 3) return;
        state.dayFailed = true;
        render();
      });
    }
    map.on('zoomend baselayerchange overlayadd overlayremove resize', render);
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

  /* Which view the reader last chose, kept in this browser only. */
  var VIEW_PREF = 'pnd_basemap';
  function preferredView() {
    try { return localStorage.getItem(VIEW_PREF) || 'Map'; } catch (e) { return 'Map'; }
  }
  function rememberView(name) {
    try { localStorage.setItem(VIEW_PREF, name); } catch (e) { /* private window */ }
  }

  function basemap(map) {
    if (!map) return map;
    try {
      injectStyle();
      var pane = labelPane(map);
      var views = {};
      var under = null, latest = null, daily = null, imagery = null;
      var clear = political(map, true, CLEAR);
      var plain = political(map);
      views['Map'] = clear;
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
        /* One seamless photograph at every zoom: Esri's World Imagery. */
        imagery = L.tileLayer(IMAGERY, { attribution: ESRI_CREDIT, maxZoom: 18, noWrap: true });
        /* NASA's photo of the latest complete day, from the world view down to
           zoom 9, offered as a layer of its own ("NASA today"); the bounds keep
           Leaflet from asking for tiles past the Mercator edge the service does
           not have. */
        daily = L.tileLayer(latest.url, {
          attribution: latest.credit, subdomains: 'abc', maxZoom: DAILY_MAX_ZOOM,
          maxNativeZoom: DAILY_MAX_ZOOM, noWrap: true,
          bounds: [[-85.0511287776, -179.999999975], [85.0511287776, 179.999999975]]
        });
        views['Satellite'] = L.layerGroup([
          under, imagery,
          L.tileLayer(PLACES, { maxZoom: 18, pane: pane, opacity: 0.95, noWrap: true })
        ]);
      }

      /* The clear map opens, and the reader's own choice after that.
         Satellite opened for a while, and a reader shown it could not make
         out the map at all: the day's picture is mostly cloud, the gaps
         between the satellite's passes are black stripes, and green and
         orange markers sat on green and orange ground. A disaster map is
         read for where the events are, so it opens on the map that shows
         them; the photograph is one click away, and a reader who picks it
         keeps it. */
      var start = views[preferredView()] || clear;
      start.addTo(map);
      if (map.attributionControl && map.attributionControl.addAttribution) map.attributionControl.addAttribution(NE_CREDIT);
      if (L.control && typeof L.control.layers === 'function') {
        var choices = { 'Map': clear };
        if (views['Satellite']) choices['Satellite'] = views['Satellite'];
        choices['Political'] = plain;
        var extras = {};
        if (daily) {
          extras['NASA today (' + latest.label + ')'] = daily;
          if (dailyWanted()) daily.addTo(map);
        }
        /* Shown open where there is room, so the other views can be found
           without knowing that the stacked-squares icon hides them. */
        var size = typeof map.getSize === 'function' ? map.getSize() : null;
        var roomy = !!(size && size.x >= 640);
        L.control.layers(choices, daily ? extras : null, { position: 'topright', collapsed: !roomy }).addTo(map);
        if (typeof map.on === 'function') {
          map.on('baselayerchange', function (e) { if (e && e.name) rememberView(e.name); });
          map.on('overlayadd overlayremove', function (e) {
            if (e && e.layer === daily) setDailyWanted(e.type === 'overlayadd');
          });
        }
      }
      /* Last, and on its own: the caption describes the map, so nothing in it
         may stop the map being built. */
      if (views['Satellite']) {
        try { imageryNote(map, views['Satellite'], daily, latest, under, imagery); } catch (e) { /* no caption */ }
      }
    } catch (e) { /* stub layers in the test harness */ }
    try { attachKey(map); } catch (e) { /* the map works without its key */ }
    attachGlobe(map);
    return map;
  }

  /*
   * What the marks on the map mean, on the map.
   *
   * Every event is drawn as a shape in a colour, and nothing on the map said
   * which shape or colour meant what: a reader faced a field of green dots
   * and orange triangles with no way to read it short of opening them one by
   * one. The key lists the levels actually on the map, largest risk first,
   * with how many of each, so it is also the quickest summary of the map.
   * It counts what is drawn, so a search that narrows the map narrows it.
   */
  function attachKey(map) {
    var R = window.PNDRisk;
    var box = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!R || !box || typeof document === 'undefined' || typeof map.on !== 'function' ||
        typeof map.eachLayer !== 'function' || box.__pndKey) return null;
    box.__pndKey = true;
    var el = document.createElement('div');
    el.className = 'pnd-key';
    el.hidden = true;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pnd-key-toggle';
    btn.textContent = 'Key';
    var body = document.createElement('div');
    body.className = 'pnd-key-body';
    body.id = 'pnd-key-' + Math.random().toString(36).slice(2, 8);
    btn.setAttribute('aria-controls', body.id);
    el.appendChild(btn);
    el.appendChild(body);
    box.appendChild(el);
    /* Clicks and scrolls on the key are the key's, not the map's. */
    if (L.DomEvent && typeof L.DomEvent.disableClickPropagation === 'function') {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }

    var open = null;      // null until the reader chooses; then theirs
    function setOpen(v) {
      btn.setAttribute('aria-expanded', String(v));
      body.hidden = !v;
    }
    btn.addEventListener('click', function () { open = body.hidden; setOpen(open); place(); });

    var order = R.LEVELS.slice().reverse().concat([R.UNKNOWN]);
    function count() {
      var n = {}, total = 0;
      map.eachLayer(function (l) {
        var k = l && l.options && l.options.pndLevel;
        if (k) { n[k] = (n[k] || 0) + 1; total++; }
      });
      return { by: n, total: total };
    }
    function render() {
      var c = count();
      el.hidden = c.total === 0;
      if (!c.total) return;
      var rows = order.filter(function (lv) { return c.by[lv.key]; }).map(function (lv) {
        return '<li><span class="pnd-key-mark risk-' + lv.key.toLowerCase() + '" aria-hidden="true">' +
          '<span class="risk-shape"></span></span><span class="pnd-key-name">' + PNDMapEscape(lv.label) +
          '</span><span class="pnd-key-n">' + c.by[lv.key] + '</span></li>';
      }).join('');
      body.innerHTML = '<p class="pnd-key-lead"><b>Each mark is one reported event</b>, shaped and coloured by its risk level.</p>' +
        '<ul>' + rows + '</ul><p class="pnd-key-hint">Select a mark for details.</p>';
      /* Open by default only where it fits and has something to explain;
         after that, whatever the reader last chose. */
      var size = typeof map.getSize === 'function' ? map.getSize() : null;
      setOpen(open !== null ? open : !!(size && size.x >= 640 && c.total >= 5));
      place();
    }
    /* Bottom-left, over open southern ocean at world view, where the
       fewest events are. Above the credit line and, when the satellite is
       showing, above the caption that says which picture it is. */
    function place() {
      var credit = box.querySelector('.leaflet-control-attribution');
      var h = credit && credit.offsetHeight ? credit.offsetHeight : 16;
      var note = box.querySelector('.pnd-imagery-note');
      var over = note && !note.hidden && note.offsetHeight ? note.offsetHeight + 6 : 0;
      var bottom = h + 8 + over;
      el.style.bottom = bottom + 'px';
      /* Never up into the zoom buttons and the Globe/Flat toggle, which end
         about 120px down. A phone's map is 300px tall, and the open key ran
         over the toggle there; the sentence above the list goes first, and
         the list scrolls only if that is still not enough. */
      if (!box.clientHeight || body.hidden) return;
      var room = box.clientHeight - 120 - bottom - (btn.offsetHeight || 28) - 6;
      body.classList.remove('pnd-key-compact');
      body.style.maxHeight = '';
      if (body.scrollHeight > room) body.classList.add('pnd-key-compact');
      if (body.scrollHeight > room) body.style.maxHeight = Math.max(room, 60) + 'px';
    }
    var timer = null;
    function later() { clearTimeout(timer); timer = setTimeout(render, 80); }
    map.on('layeradd layerremove', later);
    map.on('resize baselayerchange zoomend', place);
    try { box.addEventListener('pnd-caption', place); } catch (e) { /* no events */ }
    render();
    map.__pndKey = { element: el, render: render };
    return map.__pndKey;
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
      /* Read by the map's key, which counts what is drawn. */
      pndLevel: icon.level,
      /* The more serious event on top. Leaflet stacks markers by latitude,
         so a cluster of low-level records to the south buried the one that
         mattered under them. */
      zIndexOffset: (R.level(value).rank || 0) * 1000,
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
    dailyImagery: dailyImagery, imageryText: imageryText, DAILY_MAX_ZOOM: DAILY_MAX_ZOOM,
    dailyWanted: dailyWanted, setDailyWanted: setDailyWanted };
})();
