/* When a hazard is worth interrupting someone for, decided once.
 *
 * Two things raise alerts: this page while it is open, and the background
 * service (api/alerts-run.js) while it is not. They must never disagree about
 * what is worth a notification, so both call this file, which in turn asks
 * hazard-model's riskRow where a record stands relative to a place - the same
 * banding the Personal Risk page shows.
 *
 * A notification is the most intrusive claim this site makes, so it is raised
 * only where the record itself places the hazard at the place:
 *
 *   - the place is inside a published warning area, or inside a reported
 *     affected area;
 *   - or the record's coordinate is the incident itself, and it is within
 *     NEAR_KM, or within SEVERE_NEAR_KM when the issuing authority rated it
 *     severe.
 *
 * Never from an area's centre point, never from a country centroid, and never
 * from this site's own experimental outlooks, which are shown on the page and
 * not pushed. An expired warning or a record retained from an earlier fetch is
 * not news.
 *
 * Loaded as a plain script in the browser (window.PNDAlertRules) and required
 * by the server and the tests.
 */
(function () {
  var NEAR_KM = 30;
  var SEVERE_NEAR_KM = 100;
  /* An observed record whose own latest timestamp is older than this is not
     sent: someone saving a place today does not need to be told about a
     flood near it three months ago. */
  var RECENT_HOURS = 72;
  var SEVERE = /red|orange|severe|extreme|catastrophic/i;

  var KIND_LABEL = {
    'Home': 'home', 'Office': 'office', 'Family': 'family place', 'Travel': 'travel place',
    'Current location': 'current location'
  };

  function ms(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : null; }

  /* The detail page for a record, by the same rule as PND.eventUrl. */
  function urlFor(e) {
    var id = encodeURIComponent((e && e.id) || '');
    if (e && e.forecast) return '/forecasts/' + id;
    if (e && e.sourceType === 'official' && (e.alert === 'Red' || e.alert === 'Orange')) return '/alerts/' + id;
    return '/disasters/' + id;
  }

  /* ~1.1 km. What the background service keeps of a place, and all it keeps.
     Number(null) and Number('') are 0, and 0 is the equator: absent stays
     absent. */
  function roundCoord(v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function placeLabel(place) {
    return 'your ' + (KIND_LABEL[place && place.kind] || 'saved place');
  }

  function live(e, now) {
    if (!e || e.forecast || e.isForecast) return false;
    if (e.cached) return false;
    if (e.evidenceState === 'official-warning') {
      var exp = ms(e.expiresAt);
      return exp === null || exp > now;
    }
    var latest = Math.max(ms(e.updated) || 0, ms(e.startedAt) || 0, ms(e.issuedAt) || 0);
    return latest > 0 && now - latest <= RECENT_HOURS * 3600e3;
  }

  /**
   * One record against one place: an alert, or null.
   *
   * `rank` orders alerts - inside an area first, then by distance - and `key`
   * is what a notification is remembered by: the same record rated more
   * severely later is a new alert, the same record again is not.
   */
  function alertFor(e, place, H, now) {
    if (!H || !H.riskRow || !live(e, now == null ? Date.now() : now)) return null;
    var r = H.riskRow(e, place);
    if (!r) return null;
    var level = String(e.alert || e.severity || '');
    var what = e.type || 'Hazard';
    var title = null, rank = 0;
    if (r.band === 'B' && r.containment === true) {
      title = what + ' warning covers ' + placeLabel(place);
      rank = 3;
    } else if (r.band === 'A' && r.containment === true) {
      title = what + ' reported where ' + placeLabel(place) + ' is';
      rank = 3;
    } else if (r.band === 'A' && r.claimDistance && r.distanceKm !== null &&
      r.distanceKm <= SEVERE_NEAR_KM && (SEVERE.test(level) || r.distanceKm <= NEAR_KM)) {
      title = what + ' ' + Math.max(1, Math.round(r.distanceKm)) + ' km from ' + placeLabel(place);
      rank = 2 - r.distanceKm / 1000;
    }
    if (!title) return null;
    var source = e.source ? ' · ' + e.source : '';
    return {
      key: String(e.id) + '|' + r.band + '|' + level.toLowerCase(),
      eventId: String(e.id),
      rank: rank,
      title: title,
      body: (e.title || what) + (level ? ' · ' + level : '') + source,
      url: urlFor(e),
      tag: 'pnd-' + String(e.id)
    };
  }

  /**
   * Every alert for a set of places: one per record, naming the place it
   * bears on most directly, strongest first.
   */
  function alertsFor(events, places, H, now) {
    var best = {};
    (places || []).forEach(function (p) {
      (events || []).forEach(function (e) {
        var a = alertFor(e, p, H, now);
        if (a && (!best[a.eventId] || a.rank > best[a.eventId].rank)) best[a.eventId] = a;
      });
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.rank - a.rank; });
  }

  var api = {
    NEAR_KM: NEAR_KM, SEVERE_NEAR_KM: SEVERE_NEAR_KM, RECENT_HOURS: RECENT_HOURS,
    alertFor: alertFor, alertsFor: alertsFor, urlFor: urlFor, roundCoord: roundCoord, live: live
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PNDAlertRules = api;
})();
