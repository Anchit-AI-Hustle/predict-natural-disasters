/* Background alerts and the reader's own location, in the browser.
 *
 * window.PNDAlerts:
 *   state()          what this device can do right now, and why not if not
 *   enable()         ask permission, subscribe, send the places - from a tap
 *   disable()        unsubscribe and delete what the service holds
 *   sync()           send the current places again (after a change, and on
 *                    every visit, which keeps the subscription from expiring)
 *   useMyLocation()  save where this device is now as a place - from a tap
 *   refreshLocation()  update that place on a visit, without prompting
 *
 * What leaves the browser is the push subscription the browser issued and,
 * for each saved place, its kind and its position rounded to two decimal
 * places (about 1 km). Place names and searched addresses stay here.
 */
(function () {
  var FLAG = 'pnd_background_alerts';
  var CURRENT_ID = 'loc-current';
  var configPromise = null;

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
    return null;
  }

  function round(v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function config() {
    if (!configPromise) {
      configPromise = fetch('/api/alerts', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function () {
          return { available: false, reason: 'The alert service could not be reached, so alerts cannot be switched on right now.' };
        });
    }
    return configPromise;
  }

  function supported() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
      typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  }

  /* iPhone and iPad deliver web push only to a site added to the Home Screen
     and opened from there. */
  function iosNeedsInstall() {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone;
  }

  function placesForService() {
    var PND = window.PND;
    var list = (PND && PND.savedLocations ? PND.savedLocations() : []);
    return list.map(function (x) { return { kind: x.kind, lat: round(x.lat), lon: round(x.lon) }; })
      .filter(function (x) { return x.lat !== null && x.lon !== null; })
      .slice(0, 10);
  }

  function keyBytes(b64u) {
    var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function registration() {
    return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration('/').then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).catch(function () { return null; });
  }

  function post(subscription, places) {
    return fetch('/api/alerts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON ? subscription.toJSON() : subscription, places: places })
    }).then(function (r) { return r.json().then(function (b) { b.status = r.status; return b; }); });
  }

  function tellWorker(places) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'pnd-places', places: places });
    }
  }

  /**
   * Everything the page needs to describe the switch honestly:
   *   { mode: 'unavailable'|'unsupported'|'install'|'blocked'|'off'|'on', reason, config, places }
   */
  function state() {
    return config().then(function (cfg) {
      var base = { config: cfg, places: placesForService().length };
      if (!cfg.available) return Object.assign(base, { mode: 'unavailable', reason: cfg.reason });
      if (!supported()) {
        return Object.assign(base, iosNeedsInstall()
          ? { mode: 'install', reason: 'On iPhone and iPad, alerts reach only the Home Screen app: tap Share, then Add to Home Screen, and turn alerts on from there.' }
          : { mode: 'unsupported', reason: 'This browser cannot receive alerts while the site is closed.' });
      }
      if (Notification.permission === 'denied') {
        return Object.assign(base, { mode: 'blocked', reason: 'Notifications are blocked for this site in your browser settings.' });
      }
      return currentSubscription().then(function (sub) {
        var on = !!sub && ls(FLAG) === 'on';
        return Object.assign(base, { mode: on ? 'on' : 'off', reason: null });
      });
    });
  }

  function enable() {
    var places = placesForService();
    if (!places.length) return Promise.resolve({ ok: false, reason: 'Save a place, or use your current location, first.' });
    /* Asked first and directly, while the tap still counts as the reader's
       own action: browsers refuse a permission prompt that follows an await. */
    var asked = Notification.requestPermission();
    return Promise.all([asked, config()]).then(function (r) {
      var permission = r[0], cfg = r[1];
      if (permission !== 'granted') return { ok: false, reason: 'Notifications were not allowed, so alerts are off.' };
      if (!cfg.available) return { ok: false, reason: cfg.reason };
      return registration().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
        });
      }).then(function (sub) { return post(sub, places); }).then(function (res) {
        if (!res.ok) return { ok: false, reason: res.reason || 'Alerts could not be switched on.' };
        ls(FLAG, 'on');
        tellWorker(res.places || places);
        return { ok: true, scheduled: res.scheduled, reason: res.reason || null };
      });
    }).catch(function (e) {
      return { ok: false, reason: 'Alerts could not be switched on: ' + (e && e.message || e) };
    });
  }

  function disable() {
    return currentSubscription().then(function (sub) {
      ls(FLAG, null);
      if (!sub) return { ok: true };
      var endpoint = sub.endpoint;
      return fetch('/api/alerts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint }) })
        .catch(function () { return null; })
        .then(function () { return sub.unsubscribe(); })
        .then(function () { return { ok: true }; });
    });
  }

  /* Send the places again. With none left, alerts have nothing to be about,
     so they are switched off rather than left pointing at nothing. */
  function sync() {
    if (ls(FLAG) !== 'on') return Promise.resolve({ ok: true, skipped: true });
    var places = placesForService();
    if (!places.length) return disable();
    return currentSubscription().then(function (sub) {
      if (!sub) { ls(FLAG, null); return { ok: false, reason: 'This browser no longer holds the subscription; switch alerts on again.' }; }
      return post(sub, places).then(function (res) { if (res.ok) tellWorker(res.places || places); return res; });
    }).catch(function () { return { ok: false }; });
  }

  /* ------------------------------------------------------------ location */

  var countriesPromise = null;
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* Which country a position is in, from the outline the map already draws -
     worked out here, so the position is not sent anywhere to be named. */
  function countryAt(lat, lon) {
    if (!countriesPromise) {
      countriesPromise = fetch('/world-countries.json').then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return countriesPromise.then(function (w) {
      var fs = (w && w.features) || [];
      for (var i = 0; i < fs.length; i++) {
        var g = fs[i].geometry || {};
        var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        for (var k = 0; k < polys.length; k++) {
          var p = polys[k];
          if (p && p[0] && inRing(lon, lat, p[0])) {
            var hole = false;
            for (var h = 1; h < p.length; h++) if (inRing(lon, lat, p[h])) hole = true;
            if (!hole) return (fs[i].properties && fs[i].properties.n) || '';
          }
        }
      }
      return '';
    });
  }

  function position(opts) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('This browser cannot share its location.')); return; }
      navigator.geolocation.getCurrentPosition(function (p) { resolve(p.coords); }, function (e) {
        reject(new Error(e && e.code === 1 ? 'Location was not shared.' : 'Your location could not be found.'));
      }, Object.assign({ enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60000 }, opts || {}));
    });
  }

  /* The current location is one saved place among the others, kept only to
     the nearest kilometre, and replaced - never added again - when it moves. */
  function saveCurrent(coords) {
    var lat = round(coords.latitude), lon = round(coords.longitude);
    return countryAt(lat, lon).then(function (country) {
      var key = 'pnd_saved_locations';
      var list = [];
      try { list = JSON.parse(ls(key) || '[]'); } catch (e) { list = []; }
      var prev = list.filter(function (x) { return x.id === CURRENT_ID; })[0];
      var place = { id: CURRENT_ID, kind: 'Current location', name: 'Current location', lat: lat, lon: lon,
        country: country || '', countryCode: '', updatedAt: new Date().toISOString() };
      var moved = !prev || prev.lat !== lat || prev.lon !== lon || prev.country !== place.country;
      list = [place].concat(list.filter(function (x) { return x.id !== CURRENT_ID; }));
      ls(key, JSON.stringify(list));
      return { place: place, moved: moved };
    });
  }

  function useMyLocation() {
    return position().then(saveCurrent).then(function (r) { return sync().then(function () { return r; }); });
  }

  /* On a visit: only if a current location was saved and permission is
     already granted, so opening the site never raises a prompt. */
  function refreshLocation() {
    var has = false;
    try { has = JSON.parse(ls('pnd_saved_locations') || '[]').some(function (x) { return x.id === CURRENT_ID; }); } catch (e) { has = false; }
    if (!has || !navigator.permissions || !navigator.geolocation) return Promise.resolve(null);
    return navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
      if (p.state !== 'granted') return null;
      return position().then(saveCurrent).then(function (r) { return (r.moved ? sync() : Promise.resolve()).then(function () { return r; }); });
    }).catch(function () { return null; });
  }

  window.PNDAlerts = {
    state: state, enable: enable, disable: disable, sync: sync, config: config,
    useMyLocation: useMyLocation, refreshLocation: refreshLocation, countryAt: countryAt,
    placesForService: placesForService, isOn: function () { return ls(FLAG) === 'on'; },
    CURRENT_ID: CURRENT_ID
  };
})();
