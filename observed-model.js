'use strict';
/**
 * One physical disaster, however many providers reported it.
 *
 * Recall — "of the disasters that happened, how many did we forecast?" — needs
 * a denominator of real-world events. What this project has instead is a feed
 * of provider records, and the same flood arrives as a GDACS alert, a
 * ReliefWeb country declaration and sometimes an EONET entry. Counting those
 * as three disasters inflates the denominator and makes the forecast record
 * look worse than it is; counting them as one requires deciding when two
 * records describe the same thing, which is what this file does.
 *
 * The rules here are deliberately conservative, because the two mistakes are
 * not symmetric. Wrongly splitting one disaster into two costs an inflated
 * denominator. Wrongly merging two disasters hides one of them completely —
 * a real event that nobody can then ask whether anything predicted. So
 * records are only merged on evidence that they are the same event, and
 * anything unclear stays separate and says so.
 *
 * Loaded as a plain script in the browser (window.PNDObserved) and required by
 * the tools and tests.
 */
(function (root) {

  /* Hazard families. Two records can only be the same disaster if they are the
     same kind of thing, and the providers each spell their types differently. */
  var FAMILIES = [
    ['earthquake', /earthquake|seismic|quake/i],
    ['tropical-cyclone', /cyclone|hurricane|typhoon|tropical storm/i],
    ['flood', /flood|inundation|flash.?flood/i],
    ['landslide', /landslide|mudslide|slope failure/i],
    ['wildfire', /wildfire|fire|bushfire/i],
    ['volcano', /volcan/i],
    ['drought', /drought/i],
    ['extreme-heat', /heat/i],
    ['severe-weather', /storm|tornado|wind|hail|winter/i]
  ];

  /*
   * Every hazard family a record names, not only the first.
   *
   * "Flood / Landslide" is one claim about two hazards, and the frozen
   * benchmark ND-001 says so explicitly: its rule accepts flood OR landslide
   * impact inside its corridor. Reducing it to `flood` made a landslide there
   * a false positive under a rule that had promised to accept it.
   *
   * familyOf still answers with one family, because an event's identity and
   * its matching window need a single answer; familiesOf is what a claim is
   * graded against.
   */
  function familiesOf(type, title) {
    var s = String(type || '') + ' ' + String(title || '');
    var out = [];
    for (var i = 0; i < FAMILIES.length; i++) {
      if (FAMILIES[i][1].test(s) && out.indexOf(FAMILIES[i][0]) < 0) out.push(FAMILIES[i][0]);
    }
    return out.length ? out : ['other'];
  }

  function familyOf(type, title) {
    return familiesOf(type, title)[0];
  }
  /* Carried on the function itself so that anything already being handed
     familyOf - the verifier, the pages, the tools - grades a compound claim
     against every family it names without each caller having to know. */
  familyOf.families = familiesOf;

  /*
   * How close two reports of the same family have to be to be the same event.
   *
   * These are matching windows for agencies describing one occurrence, not
   * statements about how far a hazard reaches. The earthquake window is the
   * tightest deliberately: two genuinely distinct quakes can occur 80 km and
   * six hours apart, and merging a mainshock with a separate event would
   * delete one disaster from the denominator entirely.
   */
  var MATCH = {
    'earthquake':       { km: 100, hours: 2 },
    'tropical-cyclone': { km: 600, hours: 72 },
    'flood':            { km: 250, hours: 96 },
    'landslide':        { km: 100, hours: 48 },
    'wildfire':         { km: 120, hours: 96 },
    'volcano':          { km: 50,  hours: 168 },
    'drought':          { km: 800, hours: 720 },
    'extreme-heat':     { km: 400, hours: 96 },
    'severe-weather':   { km: 200, hours: 24 },
    'other':            { km: 100, hours: 24 }
  };

  function distanceKm(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, R = 6371;
    var x = (bLat - aLat) * r, y = (bLon - aLon) * r;
    var z = Math.sin(x / 2) * Math.sin(x / 2) +
            Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(z));
  }

  function ms(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : null; }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function onsetOf(e) { return ms(e.startedAt) || ms(e.updated); }
  function endOf(e) { return ms(e.expiresAt) || ms(e.endedAt) || null; }

  /** An area-level record cannot be matched by distance; its country is all it has. */
  function isAreaLevel(e) {
    return e.locationPrecision === 'country' || e.locationPrecision === 'regional' ||
           e.locationPrecision === 'admin1' || e.locationPrecision === 'unknown';
  }

  function sameCountry(a, b) {
    var x = String(a.country || '').trim().toLowerCase();
    var y = String(b.country || '').trim().toLowerCase();
    return !!x && x === y;
  }

  /**
   * Do these two provider records describe the same physical disaster?
   * Returns the reason when they do, and null when they do not, so a merge is
   * always accompanied by the evidence for it.
   */
  /*
   * Can these two area-level records be describing the same area?
   *
   * Returns the reason they can, or null where they plainly cannot. Two
   * records that name different sub-national areas are two disasters until
   * something says otherwise; one naming the country and the other a province
   * inside it are compatible, which is the ordinary case of a global alerting
   * agency and a national declaration reporting one event.
   */
  function placeWords(e) {
    return String((e && e.region) || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && STOP_PLACE_WORDS.indexOf(w) < 0; });
  }
  var STOP_PLACE_WORDS = ['and', 'the', 'north', 'south', 'east', 'west', 'central',
    'northern', 'southern', 'eastern', 'western', 'province', 'provinces', 'district',
    'districts', 'region', 'regions', 'state', 'states', 'county', 'counties', 'city'];

  function normPlace(v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  function regionsCompatible(a, b) {
    var ra = normPlace(a && a.region), rb = normPlace(b && b.region);
    var country = normPlace((a && a.country) || (b && b.country));
    if (!ra || !rb) return 'One record names no area within the country, so the two do not contradict.';
    if (ra === rb) return 'Both name ' + ((a && a.region) || '') + '.';
    if (ra === country || rb === country) {
      return 'One record is country-wide, so it covers the area the other names.';
    }
    if (ra.indexOf(rb) >= 0 || rb.indexOf(ra) >= 0) {
      return 'One area named is inside the other.';
    }
    var wa = placeWords(a), wb = placeWords(b);
    for (var i = 0; i < wa.length; i++) {
      if (wb.indexOf(wa[i]) >= 0) return 'Both name ' + wa[i] + '.';
    }
    return null;
  }

  function sameEvent(a, b) {
    var fa = familyOf(a.type, a.title), fb = familyOf(b.type, b.title);
    if (fa !== fb) return null;
    var w = MATCH[fa] || MATCH.other;
    var ta = onsetOf(a), tb = onsetOf(b);
    if (ta === null || tb === null) return null;
    var apart = Math.abs(ta - tb) / 3600e3;
    if (apart > w.hours) return null;

    /* Where either side is placed at an area centre, the kilometres between
       them are a fact about the areas, not the hazard, so the only thing left
       to match on is the country both name. */
    if (isAreaLevel(a) || isAreaLevel(b)) {
      if (!sameCountry(a, b)) return null;
      /* A country and a week is not an identity.
       *
       * Matching area-level records on country and time alone merged every
       * flood of the same family anywhere in one country inside the hazard's
       * window: floods in Assam and in Gujarat a day apart became one
       * disaster, and one real event left the recall denominator for good.
       * The two places have to be capable of being the same place - one of
       * them country-wide or unstated, or the two naming an overlapping
       * area - before the merge may be made. Where they plainly contradict,
       * this file's own policy applies and they stay separate. */
      var r = regionsCompatible(a, b);
      if (!r) return null;
      return 'Same ' + fa + ' in ' + a.country + ', reported ' + Math.round(apart) +
             'h apart; at least one record is area-level, so matched by country and time. ' + r;
    }
    var la = num(a.lat), lo = num(a.lon), lb = num(b.lat), ob = num(b.lon);
    if (la === null || lo === null || lb === null || ob === null) return null;
    var d = distanceKm(la, lo, lb, ob);
    if (d > w.km) return null;
    return 'Same ' + fa + ' reported ' + Math.round(d) + ' km and ' + Math.round(apart) +
           'h apart, within the ' + w.km + ' km / ' + w.hours + 'h window for this hazard.';
  }

  /*
   * Which observed records belong in a recall denominator at all.
   *
   * Every hazard record is real; not every one is a disaster. A magnitude-3.1
   * tremor felt by nobody and a prescribed burn are not events anyone failed
   * to predict, and counting them would flatter recall by burying the events
   * that matter among hundreds that never mattered. The bar is stated on each
   * record so it can be argued with.
   */
  function significanceOf(e) {
    var deaths = num(e.deaths), missing = num(e.missing);
    var displaced = num(e.displaced), affected = num(e.affected);
    var alert = String(e.alert || '');
    var mag = num(e.magnitude);

    if (deaths !== null && deaths > 0) return { significant: true, reason: 'Deaths reported (' + deaths + ').' };
    if (missing !== null && missing > 0) return { significant: true, reason: 'People reported missing (' + missing + ').' };
    if (displaced !== null && displaced >= 1000) return { significant: true, reason: 'At least 1,000 people displaced (' + displaced + ').' };
    if (affected !== null && affected >= 10000) return { significant: true, reason: 'At least 10,000 people affected (' + affected + ').' };
    if (alert === 'Red') return { significant: true, reason: 'Raised to a red alert by the issuing authority.' };
    if (alert === 'Orange') return { significant: true, reason: 'Raised to an orange alert by the issuing authority.' };
    if (/ReliefWeb/i.test(String(e.source || ''))) {
      return { significant: true, reason: 'Declared a disaster by ReliefWeb / UN OCHA.' };
    }
    if (mag !== null && mag >= 6) return { significant: true, reason: 'Earthquake of magnitude ' + mag + '.' };
    if (familyOf(e.type, e.title) === 'volcano' && /warning/i.test(String(e.title || '') + String(e.alert || ''))) {
      return { significant: true, reason: 'Volcano at warning alert level.' };
    }
    return { significant: false, reason: 'No reported casualties, displacement or authority alert level that would make this a disaster rather than a hazard record.' };
  }

  /* An impact figure nobody published is not zero. */
  function impactOf(records) {
    var keys = ['deaths', 'injuries', 'missing', 'affected', 'displaced', 'evacuated'];
    var out = {}, latest = null;
    for (var i = 0; i < keys.length; i++) {
      var best = null;
      for (var j = 0; j < records.length; j++) {
        var v = num(records[j][keys[i]]);
        if (v === null) continue;
        /* The highest figure any provider reports, which is the most recent
           assessment far more often than not; the record says which provider
           and when, so a reader can check rather than trust it. */
        if (best === null || v > best) best = v;
      }
      out[keys[i]] = best;                 // null means not reported, never 0
    }
    for (var k = 0; k < records.length; k++) {
      var t = ms(records[k].updated);
      if (t !== null && (latest === null || t > latest)) latest = t;
    }
    out.impactLastUpdated = latest === null ? null : new Date(latest).toISOString();
    return out;
  }

  function confidenceOf(records, impact) {
    var official = records.some(function (r) {
      return r.sourceType === 'official' || r.evidenceState === 'observed' ||
             r.evidenceState === 'official-warning';
    });
    var reported = ['deaths', 'injuries', 'missing', 'affected', 'displaced', 'evacuated']
      .some(function (k) { return impact[k] !== null; });
    if (official && reported) return 'CONFIRMED';
    if (official) return 'REPORTED';
    return 'UNCONFIRMED';
  }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  /* A short country token for the id. One-word countries take their first
     three letters, multi-word ones their initials, so Nepal is NEP and United
     States is US rather than both collapsing to a single letter. */
  function countryToken(name) {
    var s = String(name || '').replace(/[^A-Za-z ]/g, '').trim();
    if (!s) return 'XX';
    var words = s.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 3);
  }

  /* A 1-degree position token, so two disasters of the same kind in the same
     country on the same day are still told apart. Without it the id collided -
     two separate Indonesian earthquakes 114 km and 12 hours apart, correctly
     kept as two events, were handed one id - and an id that is not unique
     silently merges them again everywhere downstream. */
  function geoToken(lat, lon) {
    if (lat === null || lon === null) return 'nopos';
    return (lat >= 0 ? 'n' : 's') + pad(Math.abs(Math.round(lat)), 2) +
           (lon >= 0 ? 'e' : 'w') + pad(Math.abs(Math.round(lon)), 3);
  }

  /**
   * Group provider records into canonical disasters.
   *
   * `records` are feed events that already describe something observed — the
   * caller decides that, because "is this a forecast" is the feed's business,
   * not this file's.
   */
  function canonicalise(records, opts) {
    var o = opts || {};
    var groups = [];
    var list = (records || []).slice().sort(function (a, b) {
      return (onsetOf(a) || 0) - (onsetOf(b) || 0);
    });

    for (var i = 0; i < list.length; i++) {
      var e = list[i], placed = false;
      for (var g = 0; g < groups.length && !placed; g++) {
        for (var m = 0; m < groups[g].records.length; m++) {
          var why = sameEvent(groups[g].records[m], e);
          if (why) {
            groups[g].records.push(e);
            groups[g].mergeReasons.push(why);
            placed = true;
            break;
          }
        }
      }
      if (!placed) groups.push({ records: [e], mergeReasons: [] });
    }

    return groups.map(function (grp) {
      var recs = grp.records;
      /* The representative is the record with the most precise location, then
         the most recently updated: the one a reader should be sent to. */
      var rank = { incident: 0, polygon: 1, admin2: 2, admin1: 3, regional: 4, country: 5, unknown: 6 };
      var lead = recs.slice().sort(function (a, b) {
        return (rank[a.locationPrecision] === undefined ? 9 : rank[a.locationPrecision]) -
               (rank[b.locationPrecision] === undefined ? 9 : rank[b.locationPrecision]) ||
               (ms(b.updated) || 0) - (ms(a.updated) || 0);
      })[0];

      var family = familyOf(lead.type, lead.title);
      var onsets = recs.map(onsetOf).filter(function (t) { return t !== null; });
      var onset = onsets.length ? Math.min.apply(null, onsets) : null;
      var ends = recs.map(endOf).filter(function (t) { return t !== null; });
      var end = ends.length ? Math.max.apply(null, ends) : null;
      var firstReport = recs.map(function (r) { return ms(r.updated); })
        .filter(function (t) { return t !== null; });

      var impact = impactOf(recs);
      var sig = recs.map(significanceOf);
      var significant = sig.some(function (s) { return s.significant; });
      var reason = (sig.find(function (s) { return s.significant; }) || sig[0]).reason;

      var withGeometry = recs.find(function (r) { return r.geometry; });
      var stamp = onset
        ? new Date(onset).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T')
        : 'undated';
      var id = 'OBS-' + family + '-' + countryToken(lead.country) + '-' + stamp +
        '-' + geoToken(num(lead.lat), num(lead.lon));

      return {
        eventId: lead.id,
        canonicalEventId: id,
        hazard: family,
        hazardLabel: lead.type || family,
        geography: {
          country: lead.country || null,
          region: lead.region || null,
          lat: num(lead.lat),
          lon: num(lead.lon),
          locationPrecision: lead.locationPrecision || 'unknown'
        },
        geometry: withGeometry ? withGeometry.geometry : null,
        onset: onset ? new Date(onset).toISOString() : null,
        end: end ? new Date(end).toISOString() : null,
        firstAuthoritativeReport: firstReport.length
          ? new Date(Math.min.apply(null, firstReport)).toISOString() : null,
        source: lead.source || null,
        sourceUrl: lead.sourceUrl || null,
        severity: lead.severity || null,
        alert: lead.alert || null,
        deaths: impact.deaths,
        injuries: impact.injuries,
        missing: impact.missing,
        affected: impact.affected,
        displaced: impact.displaced,
        evacuated: impact.evacuated,
        infrastructureImpact: lead.infrastructureImpact || null,
        impactLastUpdated: impact.impactLastUpdated,
        evidenceConfidence: confidenceOf(recs, impact),
        significant: significant,
        significanceReason: reason,
        /* Filled by the verification engine, which owns the rules for what
           counts as a qualifying forecast. Null, not an empty list: an empty
           list would assert that nothing matched, which nothing here has
           established. */
        matchedPredictionIds: o.matchedPredictionIds === undefined ? null : o.matchedPredictionIds,
        predictionCoverageStatus: o.predictionCoverageStatus === undefined ? null : o.predictionCoverageStatus,
        evidence: recs.map(function (r) {
          return { id: r.id, source: r.source, sourceUrl: r.sourceUrl || null,
            updated: r.updated || null, locationPrecision: r.locationPrecision || null };
        }),
        mergeReasons: grp.mergeReasons
      };
    });
  }

  var api = {
    regionsCompatible: regionsCompatible,
    FAMILIES: FAMILIES.map(function (f) { return f[0]; }), MATCH: MATCH,
    familyOf: familyOf, familiesOf: familiesOf, sameEvent: sameEvent, significanceOf: significanceOf,
    canonicalise: canonicalise, distanceKm: distanceKm, impactOf: impactOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDObserved = api;
})(typeof window !== 'undefined' ? window : null);
