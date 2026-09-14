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

  /*
   * The zoom at which the world is exactly as tall as the container. Below it
   * the world no longer reaches the edges and empty space shows; above it the
   * poles are cut off. It is therefore both the opening view and the floor.
   */
  function worldZoom(map) {
    var size = map.getSize();
    if (!size || !size.y) return 1;
    return Math.log(size.y / TILE) / Math.LN2;
  }

  function applyWorldFit(map, recenter) {
    var z = worldZoom(map);
    if (!isFinite(z)) return;
    try {
      map.setMinZoom(z);
      if (recenter || map.getZoom() < z) map.setView([0, 0], z, { animate: false });
    } catch (e) { /* a stub map without a real view */ }
  }

  /*
   * One basemap everywhere, so a map means the same thing on every page.
   *
   * Two views, each paired with its own place-name layer so labels are never
   * missing whichever one is showing: the dark canvas reads best under
   * coloured event markers, and the satellite view is there when the terrain
   * around an incident matters. Esri serves both, and the app already reached
   * this host for the satellite labels, so it is a provider known to work
   * rather than a new one taken on trust.
   */
  var ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/';
  var IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var CANVAS = ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  var CANVAS_REF = ESRI + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
  var PLACES = ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  var CREDIT = 'Esri, HERE, Garmin, © OpenStreetMap contributors';
  var LABEL_PANE = 'pndLabels';

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
      pane.style.zIndex = 350;
      pane.style.pointerEvents = 'none';
    }
    return LABEL_PANE;
  }

  /*
   * Leaflet ships the view switcher white, which is a bright box dropped on a
   * dark page. The rule lives here rather than in a stylesheet because two
   * pages carry their own CSS and load neither shared sheet -- styling the
   * control where it is created is the only way it cannot be missed.
   */
  var STYLE_ID = 'pnd-map-style';
  var CONTROL_CSS = [
    '.leaflet-container .leaflet-control-layers{background:#06261d;border:1px solid #156047;border-radius:8px;box-shadow:none;color:#f5fbf8}',
    '.leaflet-container .leaflet-control-layers-toggle{background-color:#06261d;border-radius:8px}',
    '.leaflet-container .leaflet-control-layers-expanded{padding:8px 10px;font:600 12px/1.5 system-ui,sans-serif}',
    '.leaflet-container .leaflet-control-layers-list label{display:flex;align-items:center;gap:7px;cursor:pointer;color:#f5fbf8}',
    '.leaflet-container .leaflet-control-layers-separator{border-top:1px solid #156047}'
  ].join('');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CONTROL_CSS;
    (document.head || document.documentElement).appendChild(tag);
  }

  function basemap(map) {
    if (!map || typeof L.tileLayer !== 'function') return map;
    try {
      injectStyle();
      var pane = labelPane(map);
      var named = function (url, max) { return L.tileLayer(url, { maxZoom: max, pane: pane, opacity: 0.9 }); };

      var plain = L.layerGroup([
        L.tileLayer(CANVAS, { attribution: CREDIT, maxZoom: 16 }),
        named(CANVAS_REF, 16)
      ]);
      var satellite = L.layerGroup([
        L.tileLayer(IMAGERY, { attribution: CREDIT, maxZoom: 18 }),
        named(PLACES, 18)
      ]);

      plain.addTo(map);
      if (L.control && typeof L.control.layers === 'function') {
        L.control.layers({ 'Map': plain, 'Satellite': satellite },
          null, { position: 'topright' }).addTo(map);
      }
    } catch (e) { /* stub tileLayer in the test harness */ }
    return map;
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
    if (!('worldCopyJump' in opts)) opts.worldCopyJump = true;
    // A page-supplied minZoom is a guess at the same thing this measures.
    delete opts.minZoom;

    var map = base.call(L, element, opts);

    try {
      map.setMaxBounds(WORLD);
      map.options.maxBoundsViscosity = 1;
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

  window.PNDMap = { basemap: basemap, worldZoom: worldZoom, WORLD: WORLD };
})();
