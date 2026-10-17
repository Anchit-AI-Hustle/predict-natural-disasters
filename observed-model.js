'use strict';
/**
 * One physical disaster, however many providers reported it.
 *
 * Recall - "of the disasters that happened, how many did we forecast?" - needs
 * a denominator of real-world events. What this project has instead is a feed
 * of provider records, and the same flood arrives as a GDACS alert, a
 * ReliefWeb country declaration and sometimes an EONET entry. Counting those
 * as three disasters inflates the denominator and makes the forecast record
 * look worse than it is; counting them as one requires deciding when two
 * records describe the same thing, which is what this file does.
 *
 * The rules here are deliberately conservative, because the two mistakes are
 * not symmetric. Wrongly splitting one disaster into two costs an inflated
 * denominator. Wrongly merging two disasters hides one of them completely -
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
  /* Whole words only.
   *
   * Without the boundaries these matched inside ordinary place names: "hail"
   * and "wind" both sit inside "Thailand", so "3-day Flood risk outlook -
   * Thailand" named two hazard families and "Thailand: Complex Emergency"
   * was classified as severe weather outright. A substring is not a hazard. */
  var FAMILIES = [
    ['earthquake', /\b(?:earthquakes?|seismic|quakes?)\b/i],
    ['tropical-cyclone', /\b(?:cyclones?|hurricanes?|typhoons?|tropical storms?)\b/i],
    ['flood', /\b(?:floods?|flooding|inundation|flash.?floods?)\b/i],
    ['landslide', /\b(?:landslides?|mudslides?|slope failure)\b/i],
    ['wildfire', /\b(?:wildfires?|bushfires?|forest fires?|fires?)\b/i],
    ['volcano', /\b(?:volcano|volcanoes|volcanic|volcan\w*)\b/i],
    ['drought', /\b(?:droughts?)\b/i],
    ['extreme-heat', /\b(?:heat|heatwaves?|extreme heat)\b/i],
    ['severe-weather', /\b(?:storms?|tornado(?:es)?|winds?|hail|winter)\b/i]
  ];

  /* The types that say "we do not know what this is".
   *
   * api/events.js normalises an absent type to "Natural Hazard" and passes an
   * unrecognised provider label through unchanged; ReliefWeb's own catch-alls
   * are "Other" and "Complex Emergency". Only these let the title decide.
   * Anything else is the provider's classification of its own record. */
  var UNCLASSIFIED = /^(?:|natural hazard|other|others|unknown|unspecified|unclassified|complex emergency)$/i;

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
    var t = String(type || '');
    var out = [];
    /* The primary family is the one the record's own type names.
     *
     * The type is normalised upstream into a single hazard vocabulary; the
     * title is free prose, and it routinely names a second hazard in passing
     * - a landslide that was "flood-triggered", an "earthquake swarm at
     * volcano". Reading the primary family from type and title together left
     * the order of this list to decide between them, so measured:
     * familyOf('Landslide', 'Flood-triggered landslide') answered flood and
     * familyOf('Volcano', 'Earthquake swarm at volcano') answered earthquake.
     * That family is what the event is frozen under, what its matching window
     * comes from and what a forecast is graded against, so an explicitly
     * typed landslide was credited to a flood outlook.
     *
     * The title is read only where the type says nothing about the hazard at
     * all - an empty type, or one of the labels that exist precisely to mean
     * "unclassified". A type naming a hazard this table has no family for is
     * not one of those: "Tsunami" is the provider's own classification and it
     * is not an earthquake, but with the title consulted whenever no family
     * matched, familyOf('Tsunami', 'Tsunami advisory after M7.1 earthquake')
     * answered earthquake - so a tsunami could be merged into the quake that
     * caused it, removing one disaster from the denominator, and could be
     * credited to an earthquake forecast. Such a record is 'other', which is
     * what this table means by a hazard it does not model, and the same title
     * under an empty type still resolves as it did. */
    for (var i = 0; i < FAMILIES.length; i++) {
      if (FAMILIES[i][1].test(t)) { out.push(FAMILIES[i][0]); break; }
    }
    if (!out.length && UNCLASSIFIED.test(t.trim())) {
      var both = t + ' ' + String(title || '');
      for (var k = 0; k < FAMILIES.length; k++) {
        if (FAMILIES[k][1].test(both)) { out.push(FAMILIES[k][0]); break; }
      }
    }
    /* Any FURTHER family has to come from the type alone: a claim is widened
       only where the thing it names is itself compound ("Flood / Landslide"),
       never because its title mentions another hazard in passing or happens
       to contain the letters of one. */
    for (var j = 0; j < FAMILIES.length; j++) {
      if (FAMILIES[j][1].test(t) && out.indexOf(FAMILIES[j][0]) < 0) out.push(FAMILIES[j][0]);
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

  /**
   * Are two placements of one hazard family the same occurrence?
   *
   * Each placement carries an onset in milliseconds and a place - country,
   * region, lat, lon, locationPrecision. The family is passed in rather than
   * read off a label, because the ledger compares rows whose family was
   * decided when they were first written and must not be re-derived from a
   * string afterwards.
   */
  function sameOccurrence(family, a, b) {
    var w = MATCH[family] || MATCH.other;
    var ta = a && a.onset, tb = b && b.onset;
    if (ta === null || ta === undefined || tb === null || tb === undefined) return null;
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
      return 'Same ' + family + ' in ' + a.country + ', reported ' + Math.round(apart) +
             'h apart; at least one record is area-level, so matched by country and time. ' + r;
    }
    var la = num(a.lat), lo = num(a.lon), lb = num(b.lat), ob = num(b.lon);
    if (la === null || lo === null || lb === null || ob === null) return null;
    var d = distanceKm(la, lo, lb, ob);
    if (d > w.km) return null;
    return 'Same ' + family + ' reported ' + Math.round(d) + ' km and ' + Math.round(apart) +
           'h apart, within the ' + w.km + ' km / ' + w.hours + 'h window for this hazard.';
  }

  function placementOf(e, onset) {
    return { onset: onset, country: e.country, region: e.region,
             lat: e.lat, lon: e.lon, locationPrecision: e.locationPrecision };
  }

  function sameEvent(a, b) {
    var fa = familyOf(a.type, a.title), fb = familyOf(b.type, b.title);
    if (fa !== fb) return null;
    return sameOccurrence(fa, placementOf(a, onsetOf(a)), placementOf(b, onsetOf(b)));
  }

  /**
   * Do two canonical rows - this run's grouping and one already recorded -
   * describe the same disaster?
   *
   * The canonical id is not an identity. It is built from a country, a
   * rounded position and a minute, so two genuinely separate disasters - two
   * magnitude-6 earthquakes 150 km apart the same morning - derive the same
   * string. Anything reconciling a run against the ledger has to ask whether
   * the rows are the same event, and an id collision is not that question.
   */
  function sameCanonical(a, b) {
    if (!a || !b || !a.hazard || a.hazard !== b.hazard) return null;
    var ga = a.geography || {}, gb = b.geography || {};
    return sameOccurrence(a.hazard,
      placementOf(ga, ms(a.onset)), placementOf(gb, ms(b.onset)));
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
  /**
   * Did an authority issue this alert level, or did this site work it out?
   *
   * Only a record that says an authority issued it counts as one. Absence is
   * not issuance: a provider whose colour this site derives, or one that
   * records nothing about where its level came from, cannot support a claim
   * about what an authority declared.
   */
  function issuedAlert(e) {
    return String((e && e.alertBasis) || '') === 'issued';
  }

  function significanceOf(e) {
    var deaths = num(e.deaths), missing = num(e.missing);
    var displaced = num(e.displaced), affected = num(e.affected);
    var alert = String(e.alert || '');
    var mag = num(e.magnitude);

    if (deaths !== null && deaths > 0) return { significant: true, reason: 'Deaths reported (' + deaths + ').' };
    if (missing !== null && missing > 0) return { significant: true, reason: 'People reported missing (' + missing + ').' };
    if (displaced !== null && displaced >= 1000) return { significant: true, reason: 'At least 1,000 people displaced (' + displaced + ').' };
    if (affected !== null && affected >= 10000) return { significant: true, reason: 'At least 10,000 people affected (' + affected + ').' };
    /* An alert level counts only where an authority issued one.
     *
     * `alert` is this site's display colour, and for some providers the site
     * computes it itself: the hurricane centre publishes a wind speed, and 64
     * and 96 knots become orange and red here. Read as an authority's alert,
     * a category-3 hurricane over open water with nothing reported entered
     * this ledger as a disaster that happened - into the recall denominator,
     * as an event nothing forecast - and said on its face that an authority
     * had raised an alert nobody raised. A derived colour proves the wind
     * speed and nothing else; such a record enters here on reported impact,
     * like any other, or not at all. */
    if (issuedAlert(e)) {
      if (alert === 'Red') return { significant: true, reason: 'Raised to a red alert by the issuing authority.' };
      if (alert === 'Orange') return { significant: true, reason: 'Raised to an orange alert by the issuing authority.' };
    }
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
   * `records` are feed events that already describe something observed - the
   * caller decides that, because "is this a forecast" is the feed's business,
   * not this file's.
   */
  function canonicalise(records, opts) {
    var o = opts || {};
    var groups = [];
    /* The most precisely placed records form the groups first, and area-level
       ones join afterwards.
       
       Order decided attribution otherwise: a national declaration met the one
       regional disaster recorded so far and joined it, before the second
       regional disaster it equally covers had been seen at all. Seeing every
       precise record first is what lets the ambiguity below be noticed. */
    var PRECISION_RANK = { incident: 0, polygon: 1, admin2: 2, admin1: 3, regional: 4, country: 5, unknown: 6 };
    var rankOf = function (e) {
      var r = PRECISION_RANK[e && e.locationPrecision];
      return r === undefined ? 9 : r;
    };
    var list = (records || []).slice().sort(function (a, b) {
      return rankOf(a) - rankOf(b) || (onsetOf(a) || 0) - (onsetOf(b) || 0);
    });

    /* A record joins a group only if it matches EVERY record already in it.
     *
     * Matching any one member let a country-wide record bridge two that
     * contradict each other: a ReliefWeb declaration for India, then floods
     * in Assam and in Gujarat, and all three became one disaster through the
     * record that was compatible with both. Requiring every pair keeps the
     * two regional disasters apart while the ordinary case - one agency's
     * province record and one national declaration of the same event - still
     * merges, because those two do match each other. */
    for (var i = 0; i < list.length; i++) {
      var e = list[i], hits = [];
      for (var g = 0; g < groups.length; g++) {
        var reason = null, all = true;
        for (var m = 0; m < groups[g].records.length; m++) {
          var why = sameEvent(groups[g].records[m], e);
          if (!why) { all = false; break; }
          if (reason === null) reason = why;
        }
        if (all && reason !== null) hits.push({ g: g, why: reason });
      }
      if (hits.length === 1) {
        groups[hits[0].g].records.push(e);
        groups[hits[0].g].mergeReasons.push(hits[0].why);
        continue;
      }
      /* Matching two groups at once is not a reason to pick one.
       *
       * A national declaration covering a whole country is compatible with
       * every regional disaster inside it, so joining the first one met would
       * attribute its casualties to whichever record happened to sort first.
       * An ambiguous record stays its own row and says so - a visible extra
       * row can be reconciled later, while a wrong attribution cannot be seen
       * at all. */
      var extra = hits.length > 1
        ? 'This record could belong to ' + hits.length + ' separate disasters in the same country and window, so it has not been attached to any of them.'
        : null;
      groups.push({ records: [e], mergeReasons: [], ambiguous: extra });
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
        /* Where the level came from travels with it. Without this the row
           says "Red" and nothing about whether an authority issued it, and
           anything asking the significance question of the row rather than of
           the provider records underneath would answer differently. */
        alertBasis: lead.alertBasis || null,
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
        /* Every provider record behind this disaster, including the ones an
           upstream merge folded into a single record before this file ever
           saw them. The feed merges agency reports of one earthquake and
           serves only the leader; the leader changes when another agency
           publishes a death toll, so a ledger indexed on the leader's id
           alone loses the thread and records the same quake twice. A member
           carries no location precision of its own here - the record that
           stands for it is the one that was placed - and says which record
           it was merged into. */
        evidence: (function () {
          var seen = {}, out = [];
          recs.forEach(function (r) {
            if (r.id && !seen[r.id]) {
              seen[r.id] = 1;
              out.push({ id: r.id, source: r.source, sourceUrl: r.sourceUrl || null,
                updated: r.updated || null, locationPrecision: r.locationPrecision || null });
            }
            (r.mergedFrom || []).forEach(function (m) {
              if (!m || !m.id || seen[m.id]) return;
              seen[m.id] = 1;
              out.push({ id: m.id, source: m.source || null, sourceUrl: m.sourceUrl || null,
                updated: m.updated || null, locationPrecision: null, mergedUpstream: r.id });
            });
          });
          return out;
        })(),
        mergeReasons: grp.mergeReasons,
        unattachedReason: grp.ambiguous || null
      };
    });
  }

  var api = {
    regionsCompatible: regionsCompatible,
    FAMILIES: FAMILIES.map(function (f) { return f[0]; }), MATCH: MATCH,
    /* Which types say nothing about the hazard, so that the one other place
       that has to know - the claim key, which must treat a title as part of
       the claim exactly where the title is what names the hazard - can be
       held to this definition rather than to a copy of it that drifts. */
    UNCLASSIFIED: UNCLASSIFIED,
    familyOf: familyOf, familiesOf: familiesOf, sameEvent: sameEvent, issuedAlert: issuedAlert,
    sameOccurrence: sameOccurrence, sameCanonical: sameCanonical,
    significanceOf: significanceOf,
    canonicalise: canonicalise, distanceKm: distanceKm, impactOf: impactOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDObserved = api;
})(typeof window !== 'undefined' ? window : null);
