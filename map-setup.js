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
(function () {
  if (typeof window === 'undefined' || !window.L || typeof L.map !== 'function') return;

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
   * The default is a political world map -- a colour per country, borders,
   * names, blue ocean -- drawn from country outlines the app serves itself
   * rather than fetched from a tile service. No raster tile provider renders
   * that style, and a self-served layer also cannot go blank the way a tile
   * layer can: the outlines, the colours and the labels are all in the repo.
   *
   * Satellite stays as the second view, for when the terrain around an
   * incident matters, with its own place-name layer so it is never unlabelled.
   */
  var IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
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

  function political(map) {
    var group = L.layerGroup();
    if (typeof L.rectangle === 'function') {
      L.rectangle(WORLD, { fillColor: OCEAN, fillOpacity: 1, stroke: false, interactive: false }).addTo(group);
    }
    if (typeof fetch !== 'function' || typeof L.geoJSON !== 'function') return group;

    var labels = L.layerGroup();
    fetch(COUNTRIES).then(function (r) { return r.json(); }).then(function (data) {
      L.geoJSON(data, {
        interactive: false,
        style: function (f) {
          return { fillColor: PALETTE[f.properties.c % PALETTE.length], fillOpacity: 1,
            color: BORDER, weight: 0.7, opacity: 0.85 };
        }
      }).addTo(group);

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
      labels.addTo(group);
      map.on('zoomend moveend', relabel);
      relabel();
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
    '.pnd-view-toggle{position:absolute;top:10px;left:10px;z-index:1300;',
    'display:inline-flex;gap:0;border:1px solid #2c5c4c;border-radius:8px;',
    'overflow:hidden;font:600 11px/1 system-ui,sans-serif}',
    '.pnd-view-toggle button{appearance:none;border:0;padding:7px 11px;cursor:pointer;',
    'background:#07231b;color:#9db9ad;letter-spacing:.04em}',
    '.pnd-view-toggle button[aria-pressed="true"]{background:#25e29c;color:#04120e}',
    '.pnd-view-toggle button:focus-visible{outline:2px solid #25e29c;outline-offset:-2px}',
    '.pnd-globe .cesium-widget-credits{font-size:10px;opacity:.75}'
  ].join('');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CONTROL_CSS + GLOBE_CSS;
    (document.head || document.documentElement).appendChild(tag);
  }

  function basemap(map) {
    if (!map) return map;
    try {
      injectStyle();
      var pane = labelPane(map);
      var views = {};
      var plain = political(map);
      views['Political'] = plain;

      if (typeof L.tileLayer === 'function') {
        views['Satellite'] = L.layerGroup([
          L.tileLayer(IMAGERY, { attribution: ESRI_CREDIT, maxZoom: 18, noWrap: true }),
          L.tileLayer(PLACES, { maxZoom: 18, pane: pane, opacity: 0.95, noWrap: true })
        ]);
      }

      plain.addTo(map);
      if (map.attributionControl && map.attributionControl.addAttribution) map.attributionControl.addAttribution(NE_CREDIT);
      if (L.control && typeof L.control.layers === 'function' && views['Satellite']) {
        L.control.layers(views, null, { position: 'topright' }).addTo(map);
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
            if (PNDGlobe.prefers() !== 'flat') handle.reveal();
            resync();
          }).catch(function () {
            /* Cesium never arrived. Drop back to the flat map rather than
               leaving a dead panel over it. */
            teardown();
            setPressed('flat');
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
      }

      bGlobe.addEventListener('click', function () { choose('globe', true); });
      bFlat.addEventListener('click', function () { choose('flat', true); });

      /* Cesium is megabytes, so a reader who has chosen Flat never downloads
         it; the globe is fetched on the first press instead. */
      choose(PNDGlobe.prefers() === 'flat' ? 'flat' : 'globe', false);
    } catch (e) { /* the flat map is already up; leave it alone */ }
  }

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

      if (!explicitWheel) {
        var enable = function () { try { map.scrollWheelZoom.enable(); } catch (e) {} };
        var disable = function () { try { map.scrollWheelZoom.disable(); } catch (e) {} };
        map.on('click', enable);
        map.on('focus', enable);
        map.on('blur', disable);
        if (container && container.addEventListener) {
          container.addEventListener('mouseleave', disable);
          if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
        }
      }
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

  window.PNDMap = { basemap: basemap, worldZoom: worldZoom, WORLD: WORLD,
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
    NE_CREDIT: NE_CREDIT };
})();
