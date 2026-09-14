/*
 * Maps must not swallow the page scroll.
 *
 * Leaflet enables scroll-wheel zoom by default, so on a page with a tall map
 * the reader scrolling down stops dead over the map and starts zooming it
 * instead. Here the wheel zooms only once the reader has actually engaged with
 * the map -- clicked it, or reached it with the keyboard -- and stops again
 * when they leave. Dragging, pinch-zoom, double-click zoom and the +/- control
 * are untouched, so the map stays fully zoomable throughout.
 *
 * Applied by wrapping L.map, so every page gets it without each one opting in.
 * Load after Leaflet and before the page builds its map.
 */
(function () {
  if (typeof window === 'undefined' || !window.L || typeof L.map !== 'function') return;
  if (L.map.__pndScrollGuard) return;

  var base = L.map;

  function wrapped(element, options) {
    var opts = {};
    for (var k in (options || {})) if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k];
    // A page that deliberately asks for wheel zoom keeps it.
    var explicit = options && Object.prototype.hasOwnProperty.call(options, 'scrollWheelZoom');
    if (!explicit) opts.scrollWheelZoom = false;

    var map = base.call(L, element, opts);
    if (explicit) return map;

    var enable = function () { try { map.scrollWheelZoom.enable(); } catch (e) { /* stub or no handler */ } };
    var disable = function () { try { map.scrollWheelZoom.disable(); } catch (e) { /* ditto */ } };
    try {
      map.on('click', enable);
      map.on('focus', enable);
      map.on('blur', disable);
      var container = typeof map.getContainer === 'function' ? map.getContainer() : null;
      if (container && container.addEventListener) {
        container.addEventListener('mouseleave', disable);
        // Reachable by keyboard, so the wheel can be engaged without a mouse.
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
      }
    } catch (e) { /* a map stub without an event bus still returns a usable map */ }
    return map;
  }

  for (var prop in base) {
    if (Object.prototype.hasOwnProperty.call(base, prop)) {
      try { wrapped[prop] = base[prop]; } catch (e) { /* non-writable */ }
    }
  }
  wrapped.__pndScrollGuard = true;
  L.map = wrapped;
})();
