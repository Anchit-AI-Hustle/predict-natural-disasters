'use strict';
/**
 * Grading a frozen forecast against what actually happened.
 *
 * Two rules decide everything here, and both exist because the alternative is
 * a number that flatters itself:
 *
 *   A forecast is compared only against what it said when it was frozen. Its
 *   hazard, its geography, its window, its threshold and the moment it can be
 *   shown to have existed. None of those may be reconsidered once the outcome
 *   is known — widening a geography or relaxing a threshold after seeing where
 *   the disaster landed turns verification into curve-fitting.
 *
 *   The tolerances are published, fixed and applied to every forecast alike.
 *   A frozen outlook names a country or a point and never named a radius, so
 *   grading one needs a tolerance from somewhere; taking it from the outcome
 *   is exactly the move the first rule forbids. So it is stated here, carried
 *   on every verification record, and versioned, which makes a later change
 *   visible instead of silent.
 *
 * Loaded as a plain script in the browser (window.PNDVerification) and
 * required by the tools and tests.
 */
(function (root) {

  /* 1.1.0: a compound claim is graded on the tolerance of the hazard actually
     observed rather than on its primary family's. The published table is
     unchanged; which of its rows applies is not, and a verdict reached under
     the old reading is not the same verdict.

     1.2.0: a post-event-conditional claim is borne out by an observation only
     where the record says that observation belongs to the disaster this claim
     follows, and to no other; and a figure carried between two ledger rows
     that turned out to be one disaster is no longer read as impact that
     occurred. Both make grading stricter and both change verdicts, so the
     version moves rather than the record quietly meaning something else. */
  var VERIFICATION_VERSION = 'verify-1.2.0';

  var CLASSIFICATION = {
    HIT: 'HIT',
    PARTIAL_HIT: 'PARTIAL_HIT',
    MISS_FALSE_POSITIVE: 'MISS_FALSE_POSITIVE',
    PENDING: 'PENDING',
    INVALID_POST_EVENT: 'INVALID_POST_EVENT'
  };

  /* The weighting is a choice, so it is named rather than buried in an
     expression. A partial hit is half a hit: the forecast was right about the
     hazard and the window and wrong about part of where. */
  var PARTIAL_WEIGHT = 0.5;

  /*
   * How close an observed disaster must be to a forecast anchored on a point.
   *
   * Frozen outlooks name a country, a region or an event and never named a
   * radius. Grading one needs a tolerance, and taking it from the outcome is
   * the move this file exists to prevent, so it is fixed per hazard from how
   * far that hazard's effects reach from its centre — not from any particular
   * case — published on every record, and changed only by changing
   * VERIFICATION_VERSION.
   */
  var GEOGRAPHY_TOLERANCE_KM = {
    'earthquake': 250,
    'tropical-cyclone': 500,
    'flood': 300,
    'landslide': 150,
    'wildfire': 200,
    'volcano': 100,
    'drought': 600,
    'extreme-heat': 400,
    'severe-weather': 250,
    'other': 250
  };

  function ms(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : null; }
  /*
   * A coordinate, or nothing - never Null Island.
   *
   * Number(null) and Number('') are both 0, and 0,0 is a real place: it sits
   * inside the hurricane centre's Atlantic basin. An unlocated cyclone
   * therefore tested as covered by a provider whose basins are nowhere near
   * it, so that provider's silence could establish an absence nobody was in
   * a position to observe, and a disaster nothing forecast could be blamed on
   * forecasting rather than reported as coverage that cannot be established.
   */
  function coord(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function norm(s) { return String(s || '').trim().toLowerCase(); }

  function distanceKm(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, R = 6371;
    var x = (bLat - aLat) * r, y = (bLon - aLon) * r;
    var z = Math.sin(x / 2) * Math.sin(x / 2) +
            Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(z));
  }

  /** The earliest moment a forecast can be credited from. */
  function effectiveStart(p) {
    var s = ms(p.targetStart), f = ms(p.freezeTimestamp);
    if (s === null) return f;
    if (f === null) return s;
    return Math.max(s, f);
  }

  /** Does this claim name the hazard family that was observed? */
  function claimAccepts(claim, hazard) {
    var list = (claim && claim.hazards) || [claim && claim.hazard];
    return list.indexOf(hazard) >= 0;
  }

  /**
   * The frozen claim, extracted once so that everything downstream grades the
   * same thing and a reader can see exactly what was compared.
   */
  function frozenClaim(p, hazardFamilyOf) {
    var family = hazardFamilyOf(p.type, p.title);
    /* Every family the claim names, where the classifier can give them.
     *
     * "Flood / Landslide" is one claim about two hazards - ND-001's published
     * rule accepts either inside its corridor - and grading it on the first
     * family alone made a landslide there a false positive under a rule that
     * had promised to accept it. The primary family still names the claim;
     * the list is what an observed event is compared against. */
    var families = (typeof hazardFamilyOf.families === 'function'
      ? hazardFamilyOf.families(p.type, p.title)
      : null) || [family];
    return {
      hazard: family,
      hazards: families,
      hazardLabel: p.type || null,
      geography: {
        country: p.country || null,
        region: p.region || null,
        lat: coord(p.lat),
        lon: coord(p.lon),
        scope: p.forecastScope || null
      },
      window: {
        targetStart: p.targetStart || null,
        targetEnd: p.targetEnd || null,
        effectiveForecastStart: effectiveStart(p) === null ? null : new Date(effectiveStart(p)).toISOString()
      },
      thresholds: {
        requires: 'A significant observed disaster of the same hazard family, by the observed ledger’s published bar.',
        geographyToleranceKm: GEOGRAPHY_TOLERANCE_KM[family] || GEOGRAPHY_TOLERANCE_KM.other,
        /* One tolerance per family the claim names.
         *
         * The table is a statement about how far each hazard's effects reach
         * from its centre, so a compound claim needs all of them: grading
         * "Flood / Landslide" on the primary family alone gave an observed
         * landslide the flood radius, and a landslide 200 km from the
         * forecast point was a full hit under 300 km when its own published
         * tolerance is 150 - with a reason line that said "the published 300
         * km tolerance for this hazard" about a hazard whose tolerance is
         * not 300. Neither number came from the outcome; which one applies is
         * decided by the hazard observed. */
        geographyToleranceKmByHazard: families.reduce(function (m, f) {
          m[f] = GEOGRAPHY_TOLERANCE_KM[f] || GEOGRAPHY_TOLERANCE_KM.other;
          return m;
        }, {}),
        partialHitWeight: PARTIAL_WEIGHT
      },
      freezeTimestamp: p.freezeTimestamp || null,
      /* The scan whose snapshot this forecast was derived from. Its own
         source cannot show that the hazard continued after it. */
      sourceScanId: p.sourceScanId || null,
      /* What this claim is ABOUT, as opposed to where it is.
       *
       * A post-event-conditional outlook follows one particular disaster -
       * an aftershock outlook follows one mainshock - and the record it
       * follows is named by forecastOf. Without it the claim is only a
       * hazard, a window and a radius, which two neighbouring sequences can
       * share; see the supporting-evidence rule in verify(). A claim that
       * names no subject is its own subject. */
      subject: p.forecastOf || p.id || null,
      forecastClass: p.forecastClass || null
    };
  }

  /**
   * Is this observation activity of THIS sequence, rather than a neighbouring
   * one?
   *
   * An aftershock outlook's geography is the mainshock's epicentre and its
   * published tolerance for earthquake is 250 km, so two mainshocks a few
   * hours and 150 km apart have claims that accept each other's aftershocks
   * entirely. Measured on two such outlooks, an ordinary M4.3 aftershock 7 km
   * from quake A was graded a HIT for quake B's sequence, with a reason line
   * reading "observed activity of the sequence this outlook is about" about
   * an event 161 km away that belonged to a different earthquake.
   *
   * Hazard, time and distance cannot tell those apart, because both claims
   * genuinely satisfy all three. What can is the association recorded when
   * the observation was kept: tools/record-observed.js keeps an observation
   * only where some frozen conditional claim is graded on it, and writes down
   * which claims those were and which disaster each of them follows.
   *
   * So: the observation must name this claim's subject, and it must name only
   * one subject. Where two sequences both accept it, nothing establishes
   * which one it belongs to, and neither is graded on it - the asymmetry that
   * governs the observed ledger governs here too, since a wrongly credited
   * hit is a fabricated result and a withheld one is only an unanswered
   * question, which the verdict then states.
   */
  function sequenceTie(claim, sup) {
    var kept = (sup && sup.keptFor) || [];
    /* Nothing recorded is not the same as recorded as someone else's.
     *
     * The first version returned a bare null for both, and the caller dropped
     * the observation either way - which turned "the record cannot answer
     * this" into "the window closed with nothing observed", and a verdict of
     * PENDING into a false positive. An absence that nothing could have
     * established is the one thing this file exists to refuse to assert. */
    if (!kept.length) return { unknown: true };
    var subjects = [], mine = false;
    for (var i = 0; i < kept.length; i++) {
      var entry = kept[i];
      var subject = entry && typeof entry === 'object' ? entry.subject : null;
      if (!subject) return { unknown: true };
      if (subjects.indexOf(subject) < 0) subjects.push(subject);
      if (claim.subject && subject === claim.subject) mine = true;
    }
    var others = subjects.filter(function (x) { return x !== claim.subject; });
    if (!mine) return { other: others };
    if (others.length) return { ambiguous: others };
    return { ok: true };
  }

  /**
   * Which published tolerance applies, given what was actually observed.
   *
   * A hazard the claim never named cannot borrow one of its radii, so the
   * primary family's tolerance stands as the fallback - it is the one the
   * record publishes and the one a single-hazard claim has always been
   * graded on.
   */
  function toleranceFor(claim, hazard) {
    var by = (claim.thresholds && claim.thresholds.geographyToleranceKmByHazard) || {};
    if (hazard && Object.prototype.hasOwnProperty.call(by, hazard)) {
      return { km: by[hazard], hazard: hazard };
    }
    return { km: claim.thresholds.geographyToleranceKm, hazard: claim.hazard };
  }

  /**
   * Does this observed disaster satisfy the frozen geography?
   * 'full' when it falls inside what was claimed, 'partial' when it is in the
   * claimed country but outside the narrower area named, null when neither.
   */
  function geographyMatch(claim, event) {
    var g = claim.geography, eg = event.geography || {};
    var sameCountry = !!g.country && norm(g.country) === norm(eg.country);

    /* A forecast issued for a country claims the country, no more and no
       less: an event anywhere inside it satisfies that claim exactly. */
    if (g.scope === 'country') {
      return sameCountry ? { level: 'full', why: 'Observed inside ' + g.country + ', the country this outlook was issued for.' } : null;
    }

    var d = (g.lat !== null && g.lon !== null && eg.lat !== null && eg.lat !== undefined &&
             eg.lon !== null && eg.lon !== undefined)
      ? distanceKm(g.lat, g.lon, Number(eg.lat), Number(eg.lon)) : null;
    var tol = toleranceFor(claim, event.hazard);

    if (d !== null && d <= tol.km) {
      return { level: 'full',
        why: 'Observed ' + Math.round(d) + ' km from the forecast position, inside the published ' +
             tol.km + ' km tolerance for ' + tol.hazard + '.' };
    }
    /* The right country and the right hazard, but outside the area the
       forecast actually named. Part of the claim held and part did not, which
       is what a partial hit is. */
    if (sameCountry) {
      return { level: 'partial',
        why: 'Observed in ' + eg.country + ', which the outlook named, but ' +
             (d === null ? 'its position cannot be compared with the forecast position'
                         : Math.round(d) + ' km away, outside the published ' + tol.km +
                           ' km tolerance for ' + tol.hazard) + '.' };
    }
    return null;
  }

  /*
   * Classes whose qualifying disaster is expected to predate them.
   *
   * A continuation outlook says a hazard already under way carries on; an
   * aftershock outlook follows an observed mainshock. Their disaster began
   * before the freeze by definition, so applying the onset rule to them made
   * every one a false positive whatever happened - a foregone verdict, not a
   * verification, and the mirror image of crediting a forecast for something
   * that had already happened.
   *
   * What they actually claim is continued activity inside the window, so that
   * is what they are graded on: a report of the disaster dated at or after the
   * moment the forecast can be shown to have existed. Where the observed
   * record carries no such report the outlook stays ungradeable, because
   * nothing establishes either that it held or that it failed.
   */
/*
 * What counts as the disaster carrying on, per class, because the three do
 * not claim the same thing.
 *
 * A continuation outlook and a warning-derived one say the hazard itself
 * continues, so the record still being carried by the provider inside the
 * window is evidence of exactly that.
 *
 * An aftershock outlook does not. Its published rule is "grade against
 * observed aftershock activity and any additional impacts in the window", and
 * the mainshock still sitting in the USGS feed is neither: lastSeenAt
 * advances every run for days, so reading it as continuation would make every
 * aftershock outlook a hit whether or not a single aftershock occurred. An
 * aftershock that does occur is a separate observed event whose onset falls
 * inside the window and is matched through the ordinary path; what this class
 * may additionally be credited with is a new impact recorded inside the
 * window, which is the second limb of its own rule.
 */
  var IMPACT_FIELDS = ['deaths', 'injuries', 'missing', 'affected', 'displaced',
    'evacuated', 'infrastructureImpact'];
  var CONTINUATION_EVIDENCE = {
    'continuation-outlook': 'still-reported',
    'warning-derived': 'still-reported',
    'post-event-conditional': 'new-impact'
  };
  var CONTINUATION_CLASSES = Object.keys(CONTINUATION_EVIDENCE);

  /*
   * Evidence that the disaster was still going ON inside the window.
   *
   * Both bounds matter and only one of them was applied. A mark merely at or
   * after the window's start also counts a report dated long after the window
   * closed - and lastSeenAt advances on every run while a record is in the
   * feed, so an outlook that expired a fortnight ago would be graded a hit
   * this morning, on the strength of a timestamp from this morning, described
   * as "inside the window". The mirror image of the defect this function was
   * written to fix, and the one that flatters.
   */
  /*
   * Does this revision report MORE impact, or only a different figure?
   *
   * The observed ledger deliberately records a figure that stopped being
   * published as a revision to null, and it records downward corrections
   * too. Reading either as "an additional impact" let a mainshock's death
   * toll being withdrawn, or corrected from 12 to 8, grade an aftershock
   * outlook a hit though nothing further had happened. Prose counts only
   * where there was none before, since one description replacing another
   * says nothing about which is worse.
   */
  function reportsMoreImpact(rev) {
    if (!rev) return false;
    var to = rev.to, from = rev.from;
    if (to === null || to === undefined || to === '') return false;
    var nTo = Number(to), nFrom = Number(from);
    if (typeof to === 'string' && !isFinite(nTo)) {
      return from === null || from === undefined || from === '';
    }
    if (!isFinite(nTo)) return false;
    if (from === null || from === undefined || from === '') return nTo > 0;
    return isFinite(nFrom) ? nTo > nFrom : true;
  }

  function continuedActivity(event, from, to, kind, sourceScanId) {
    if (from === null) return null;
    var impactOnly = kind === 'new-impact';
    var onset = ms(event.onset);
    if (onset !== null && to !== null && onset > to) return null;
    var end = ms(event.end);
    if (end !== null && end < from) return null;          // over before the window opened
    var marks = [];

    /* impactLastUpdated is NOT an impact change.
     *
     * The observed model sets it from the newest provider timestamp on the
     * record, whether or not a single figure moved - so a routine refresh of
     * a mainshock inside the window would have credited an aftershock outlook
     * with "additional impacts" it never reported. Only a revision to a
     * figure shows an impact changed, and that is the only thing this class
     * may be credited with. */
    if (!impactOnly) {
      marks.push({ at: ms(event.impactLastUpdated), what: 'its impact figures were last reassessed' });
      marks.push({ at: ms(event.end), what: 'it was recorded as ending' });
      /* Every run during which the record was actually being carried, not the
         last time it was seen: that single timestamp is overwritten on the
         next run, so the first cycle after the window closed would otherwise
         erase the evidence of everything inside it. */
      for (var g = 0; g < (event.sightings || []).length; g++) {
        var sg = event.sightings[g], sa = ms(sg.from), sb = ms(sg.to);
        if (sa === null || sb === null) continue;
        if (to !== null && sa > to) continue;
        if (sb < from) continue;
        /* A run that ends at the forecast's own snapshot shows what was
           already there when it was written, not that anything carried on. */
        if (sourceScanId && sg.toScan === sourceScanId) continue;
        marks.push({ at: Math.max(sa, from),
          text: 'It was still being reported inside the window: its provider was carrying it from ' +
            sg.from + ' to ' + sg.to + '.' });
      }
      if (!(event.sightings || []).length) {
        marks.push({ at: ms(event.lastSeenAt), what: 'it was last seen in the feed' });
      }
    }
    for (var r = 0; r < (event.revisions || []).length; r++) {
      var rev = event.revisions[r];
      if (sourceScanId && rev.scanId === sourceScanId) continue;
      /* A figure moved between two ledger rows that turned out to be one
         disaster is bookkeeping, and it is stamped with the merge time rather
         than with any observation. Reading it as impact let an old death toll
         crossing rows inside an aftershock window grade that outlook a hit,
         with a reason line naming a figure that had been on record since
         before the window opened. The superseded row's own revisions come
         across with their original timestamps and still count. */
      if (rev.administrative) continue;
      if (impactOnly) {
        if (IMPACT_FIELDS.indexOf(rev.field) < 0) continue;
        if (!reportsMoreImpact(rev)) continue;
      }
      marks.push({ at: ms(rev.at),
        what: 'its ' + rev.field + (impactOnly ? ' rose to ' + rev.to : ' was revised') });
    }
    var best = null;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].at === null || marks[i].at < from) continue;
      if (to !== null && marks[i].at > to) continue;
      if (best === null || marks[i].at < best.at) best = marks[i];
    }
    if (!best) return null;
    return { at: best.at,
      why: best.text || ('It was still being reported inside the window: ' + best.what + ' at ' +
           new Date(best.at).toISOString() + '.') };
  }

  /**
   * Grade one frozen prediction against the canonical observed disasters.
   * `now` makes the result reproducible; `hazardFamilyOf` is the observed
   * model's classifier, passed in so both sides use one definition.
   */
  function verify(prediction, observedEvents, opts) {
    var o = opts || {};
    var hazardFamilyOf = o.hazardFamilyOf || function (t) { return String(t || 'other').toLowerCase(); };
    var at = o.now === undefined ? Date.now() : o.now;
    var claim = frozenClaim(prediction, hazardFamilyOf);

    var absenceEstablishable = null;      // decided lazily, below
    var say = function (classification, reason, matched, ungradeable) {
      return {
        /* Could the opposite have been shown? A hit found where nothing could
           have established an absence is a true statement about this window
           and an unsafe one to average: counting it in a precision whose
           misses were all refused would report the hits and hide the rest. */
        absenceEstablishable: absenceEstablishable,
        verificationId: 'VER-' + String(prediction.id) + '@' + String(prediction.targetStart),
        predictionId: prediction.id,
        forecastClass: claim.forecastClass,
        freezeTimestamp: claim.freezeTimestamp,
        originalGeography: claim.geography,
        originalWindow: claim.window,
        originalThresholds: claim.thresholds,
        observedEventIds: (matched || []).map(function (m) { return m.event.canonicalEventId; }),
        evidence: (matched || []).map(function (m) {
          return { canonicalEventId: m.event.canonicalEventId, onset: m.event.onset,
            country: (m.event.geography || {}).country || null, match: m.level, why: m.why };
        }),
        classification: classification,
        classificationReason: reason,
        gradeable: !ungradeable,
        ungradeableReason: ungradeable || null,
        verifiedAt: new Date(at).toISOString(),
        verificationVersion: VERIFICATION_VERSION
      };
    };

    if (claim.forecastClass === 'invalid-post-event') {
      return say(CLASSIFICATION.INVALID_POST_EVENT,
        'Nothing establishes that this forecast existed before the window it claims, so it cannot be graded as a prediction.', []);
    }

    var start = ms(claim.window.effectiveForecastStart);
    var end = ms(claim.window.targetEnd);
    if (end === null) {
      return say(CLASSIFICATION.INVALID_POST_EVENT,
        'The forecast names no end to its window, so there is nothing to mature and nothing to grade.', []);
    }
    if (end > at) {
      return say(CLASSIFICATION.PENDING,
        'The target window has not closed yet; it runs to ' + claim.window.targetEnd + '.', [],
        'WINDOW_STILL_OPEN');
    }

    /* A window the disaster record does not cover cannot be graded.
     *
     * Calling it a false positive would assert that nothing happened there,
     * and nothing establishes that: the observed ledger simply has no reach
     * that far back. Run against an empty ledger this branch is the whole
     * answer - 280 forecasts came back as false positives purely because
     * there was nothing to match them against, and publishing a 0.9%
     * precision from that would have been a fabricated number, not a poor
     * one. The record becomes gradeable as the observed ledger fills.
     */
    /* Coverage decides what an ABSENCE is worth, and nothing else.
     *
     * This ran before the matching loop, so a window the record could not
     * cover came back PENDING even when a matching disaster was sitting in
     * the ledger. Since no flood, wildfire or volcano source is exhaustive,
     * no outlook for those hazards could ever be a hit - only ungradeable -
     * however plainly it had been borne out. A positive observation needs no
     * proof that nothing else happened; only "nothing happened" does. So the
     * matching runs first, and this gate is consulted only on the way to a
     * false positive.
     */
    var coverageGate = function () {
      var cov = typeof o.observedCoverage === 'function'
        ? o.observedCoverage(claim)
        : o.observedCoverage;
      if (cov) {
        var covFrom = ms(cov.from), covTo = ms(cov.to);
        if (covFrom === null || covTo === null) {
          return say(CLASSIFICATION.PENDING,
            'The record of observed disasters is empty, so there is nothing this window can be graded against.', [],
            'OBSERVED_RECORD_EMPTY');
        }
        if (start !== null && start < covFrom) {
          return say(CLASSIFICATION.PENDING,
            'This window opens before the record of observed disasters begins (' + cov.from +
            '), so an absence of matching disasters would say nothing about what happened.', [],
            'OBSERVED_RECORD_STARTS_LATER');
        }
        if (end > covTo) {
          return say(CLASSIFICATION.PENDING,
            'This window closes after the record of observed disasters was last updated (' + cov.to + ').', [],
            'OBSERVED_RECORD_NOT_YET_UPDATED');
        }
        /* Inside the outer bounds is not the same as watched throughout. A
           provider that succeeded either side of a two-day outage covers the
           days it answered on and not the ones in between, and a window in the
           gap cannot be failed for an absence nobody was there to see. */
        if (cov.intervals && cov.intervals.length) {
          var opens = start === null ? end : start;
          var whole = null;
          for (var c = 0; c < cov.intervals.length; c++) {
            var iv = cov.intervals[c], a = ms(iv.from), b = ms(iv.to);
            if (a !== null && b !== null && a <= opens && b >= end) { whole = iv; break; }
          }
          if (!whole) {
            return say(CLASSIFICATION.PENDING,
              'No unbroken run of scans covers this window: the record of what was examined has a gap of more than ' +
              (cov.maxGapHours || MAX_SCAN_GAP_HOURS) + ' hours inside it, so an absence of matching disasters would say nothing about what happened.',
              [], 'OBSERVED_RECORD_HAS_A_GAP');
          }
        }
      }
      return null;
    };

    var matched = [], early = [], awaitingActivity = [];
    var continuationKind = CONTINUATION_EVIDENCE[claim.forecastClass] || null;
    var continuation = !!continuationKind;
    /* Does this claim name one particular disaster it follows? Only the
       post-event-conditional class does, and only for those is the
       observation's association with it recorded. */
    var subjectClaim = claim.forecastClass === 'post-event-conditional' && !!claim.subject;
    /* Observations that satisfy the claim on hazard, window and geography but
       cannot be shown to belong to the disaster it follows rather than to a
       neighbouring one. Declared here because both the significant events
       below and the supporting observations further down fill it. */
    var unattributed = [];
    for (var i = 0; i < (observedEvents || []).length; i++) {
      var ev = observedEvents[i];
      if (!ev.significant) continue;
      if (!claimAccepts(claim, ev.hazard)) continue;
      var onset = ms(ev.onset);
      if (onset === null) continue;
      var geo = geographyMatch(claim, ev);
      if (!geo) continue;
      /*
       * A claim about ONE disaster is borne out by that disaster, not by a
       * neighbour of it.
       *
       * sequenceTie was applied to the observations kept beside the ledger
       * and not to the significant ones here, which left the same hole open
       * on the bigger events: measured on two mainshocks 167 km and a day
       * apart, a magnitude-6 aftershock of quake A graded quake B's outlook a
       * HIT at 161 km, and so did quake A's own death toll rising inside B's
       * window, at 167 km. Both read "a significant earthquake was observed
       * inside the frozen geography and window", which was true and about the
       * wrong earthquake.
       *
       * Only a post-event-conditional claim names a subject, and only for
       * those is the association recorded, so only those are gated: a flood
       * outlook is not about one particular prior flood and has nothing to be
       * tied to.
       */
      var seqTie = subjectClaim ? sequenceTie(claim, ev) : { ok: true };
      /* Recorded as another sequence's: it says nothing about this one, in
         either direction, so it is simply not this claim's evidence. */
      if (seqTie.other) continue;
      if (seqTie.ambiguous) { unattributed.push({ event: ev, also: seqTie.ambiguous }); continue; }
      /* No association on record. It cannot bear the claim out, and it cannot
         establish that nothing happened either - so the claim waits rather
         than being failed on an absence nothing could have shown. */
      if (seqTie.unknown) { awaitingActivity.push({ event: ev, level: geo.level, why: geo.why }); continue; }
      if (start !== null && onset < start) {
        if (!continuation) { early.push({ event: ev, level: geo.level, why: geo.why }); continue; }
        /* The disaster this outlook is about. It predates the freeze because
           that is what a continuation outlook is; what has to fall inside the
           window is the evidence that it carried on. */
        var act = continuedActivity(ev, start, end, continuationKind, claim.sourceScanId);
        if (act) { matched.push({ event: ev, level: geo.level, why: geo.why + ' ' + act.why }); }
        else { awaitingActivity.push({ event: ev, level: geo.level, why: geo.why }); }
        continue;
      }
      if (onset > end) continue;
      matched.push({ event: ev, level: geo.level, why: geo.why });
    }

    /* Asked before any verdict is returned, so every verdict carries it, but
       acted on only where an absence is being read. */
    var gate = coverageGate();
    absenceEstablishable = !gate;

    /* Positive evidence first, and without the coverage gate: a disaster that
       is on record inside the frozen geography and window bears the forecast
       out whether or not anything could have proved the opposite. */
    /*
     * Observed activity that is not a disaster in its own right.
     *
     * An aftershock outlook's published rule is "grade against observed
     * aftershock activity and any additional impacts in the window", and the
     * record it was graded against holds only significant disasters - so an
     * ordinary aftershock, which is what such a sequence is mostly made of,
     * was invisible. The class could be borne out only by an aftershock large
     * enough to be a disaster of its own, or by the mainshock's impact
     * figures rising, leaving every ordinary successful outlook permanently
     * ungradeable against a rule that had promised to accept it.
     *
     * These observations are kept apart from the record of disasters and
     * never enter the recall denominator: they are evidence that something
     * happened, not claims that a disaster did.
     */
    if (claim.forecastClass === 'post-event-conditional' && !matched.length) {
      var support = (o.supportingEvents || []);
      for (var sIdx = 0; sIdx < support.length; sIdx++) {
        var sup = support[sIdx];
        if (!sup || !claimAccepts(claim, sup.hazard)) continue;
        var sOnset = ms(sup.onset);
        if (sOnset === null || start === null || sOnset < start) continue;
        if (end !== null && sOnset > end) continue;
        var sGeo = geographyMatch(claim, sup);
        if (!sGeo) continue;
        /* Hazard, window and geography are satisfied by every neighbouring
           sequence too. Only the recorded association says whose it is. */
        var tie = sequenceTie(claim, sup);
        if (tie.other || tie.unknown) continue;
        if (tie.ambiguous) { unattributed.push({ event: sup, also: tie.ambiguous }); continue; }
        matched.push({ event: sup, level: sGeo.level, supporting: true,
          why: sGeo.why + ' Observed activity of the sequence this outlook is about, recorded ' +
            'at ' + sup.onset + '. It is not itself a disaster by the observed record\u2019s bar, ' +
            'and counts towards no recall figure.' });
        break;
      }
    }

    var full = matched.filter(function (m) { return m.level === 'full'; });
    /* Name the hazard that was actually observed, not the claim's primary
       family: a compound claim accepts more than one, and "a significant
       flood was observed" about a landslide describes the wrong event. */
    var observedHazard = function (m) { return (m && m.event && m.event.hazard) || claim.hazard; };
    /* Evidence that is not a disaster says so: a supporting observation is
       activity of the sequence, not a significant event of its own, and
       opening with "a significant earthquake was observed" about a
       magnitude-4 aftershock would be the flattering misdescription this
       whole file exists to prevent. */
    var opener = function (m, where) {
      return (m && m.supporting)
        ? 'Observed ' + observedHazard(m) + ' activity, which is what this outlook claims, was recorded ' + where + '. '
        : 'A significant ' + observedHazard(m) + ' was observed ' + where + '. ';
    };
    if (full.length) {
      return say(CLASSIFICATION.HIT,
        opener(full[0], 'inside the frozen geography and window') + full[0].why, full);
    }
    if (matched.length) {
      return say(CLASSIFICATION.PARTIAL_HIT,
        opener(matched[0], 'inside the window but only partly inside the geography this outlook named') +
        matched[0].why, matched);
    }
    /* Something was observed; what is missing is whose it is. Asked before
       the coverage gate, because the gate exists to decide what an ABSENCE
       means and this is not one. */
    if (unattributed.length) {
      return say(CLASSIFICATION.PENDING,
        'Activity of this hazard was observed inside the frozen geography and window, but it falls inside ' +
        (unattributed[0].also.length === 1 ? 'another outlook' : unattributed[0].also.length + ' other outlooks') +
        ' following a different disaster (' + unattributed[0].also.join(', ') + '), whose claim accepts it just as fully. ' +
        'Nothing on record says which sequence it belongs to, so it is not counted for either.',
        [], 'SEQUENCE_ATTRIBUTION_AMBIGUOUS');
    }

    /* From here every answer rests on nothing having been observed, so what
       the record could have seen decides whether that means anything. */
    if (gate) return gate;
    if (early.length) {
      return say(CLASSIFICATION.MISS_FALSE_POSITIVE,
        'The only matching ' + observedHazard(early[0]) + ' began at ' + early[0].event.onset + ', before this forecast can be shown to have existed (' +
        claim.window.effectiveForecastStart + '), so it cannot count as having been predicted.', []);
    }
    if (awaitingActivity.length) {
      return say(CLASSIFICATION.PENDING,
        'The ' + claim.hazard + ' this outlook follows is on record, but nothing dated inside the window shows whether it continued, ' +
        'so this can be graded neither way yet.', [], 'CONTINUATION_EVIDENCE_UNAVAILABLE');
    }
    return say(CLASSIFICATION.MISS_FALSE_POSITIVE,
      subjectClaim
        /* One was observed inside the geography here; it belonged to another
           sequence. Saying "none was observed" would be false, and the
           verdict stands either way: this outlook's own sequence produced
           nothing. */
        ? 'The window closed with no ' + claim.hazards.join(' or ') +
          ' activity that can be shown to belong to the disaster this outlook follows (' +
          claim.subject + '). ' +
          'Activity of the same hazard nearby, belonging to another sequence, is not this one\u2019s.'
        : 'The window closed with no significant ' + claim.hazards.join(' or ') +
          ' observed inside the frozen geography.', []);
  }

  /**
   * Does this frozen forecast cover this disaster?
   *
   * Deliberately not verify(). That grades a forecast, and grading asks
   * whether the window has closed - which is the wrong question here, and
   * asking it made a forecast that did cover a disaster come back PENDING and
   * the disaster come back unpredicted. What matters for a false negative is
   * only whether the disaster fell inside what the forecast claimed.
   */
  function covers(prediction, event, hazardFamilyOf) {
    /* The prediction's own hazard, classified the same way the event's was.
       Passing a function that returns the event's hazard made
       `claim.hazard !== event.hazard` unfalsifiable, so an earthquake
       prediction counted as having predicted a flood whenever the time and
       the geography lined up. Without a classifier there is no way to compare
       them, and an uncomparable pair is not a match. */
    if (typeof hazardFamilyOf !== 'function') return null;
    var claim = frozenClaim(prediction, hazardFamilyOf);
    if (!claimAccepts(claim, event.hazard)) return null;
    var onset = ms(event.onset);
    var start = ms(claim.window.effectiveForecastStart);
    var end = ms(claim.window.targetEnd);
    if (onset === null || end === null) return null;
    if (start !== null && onset < start) return null;
    if (onset > end) return null;
    return geographyMatch(claim, event);
  }

  /**
   * Over what period can an absence of disasters of THIS hazard, in THIS
   * place, actually be read as an absence?
   *
   * The first version took one window for everything: the earliest recorded
   * disaster through the observed ledger's updatedAt. But that timestamp
   * advances on every run, including runs where the providers covering a
   * hazard were down. A cycle with only USGS online would extend "coverage"
   * over floods, make a matured flood outlook gradeable, and score it a false
   * positive although no flood source had answered.
   *
   * Coverage is therefore derived per hazard from the scan ledger: the span
   * of scans in which some provider covering that hazard, and reaching that
   * place, actually completed one. No such scan means no coverage, and a
   * forecast over that period stays ungradeable.
   */
  /*
   * The longest gap between two successful scans that is still one period of
   * watching rather than two.
   *
   * Coverage used to be the earliest successful scan through the latest, which
   * is not a period at all: a provider that succeeded on Monday and again on
   * Friday, and was unavailable in between, produced a week of "coverage" from
   * two instants, and a Tuesday outlook could be failed for an absence nobody
   * observed. Scans are instants, so joining consecutive ones needs a stated
   * rule for how far apart they may be.
   *
   * Six hours, which is a little beyond a normal cycle of this job and well
   * inside its worst. The job's own written record - forecast-changes.json,
   * which measures what it achieved rather than what it asked for - puts the
   * median gap between runs at about four hours, the shortest at 1.5 and the
   * longest at nearly 35. So this is emphatically NOT "longer than anything
   * observed": a 35-hour gap exists in the record and is exactly what this
   * rule is for. A gap beyond a normal cycle is an outage, and the hours
   * inside it are hours nothing was watching, whether the job was late or
   * the provider was down.
   *
   * (An earlier version of this comment justified the six hours as being
   * beyond the slowest cycle ever seen, from a hand measurement over 15-20
   * September. The ledger has since recorded a 35-hour gap, so that
   * justification was wrong; the number it justified is unchanged, because
   * what it is for never depended on being an upper bound.)
   *
   * Published on every coverage answer and versioned with the engine, like
   * every other tolerance here.
   */
  var MAX_SCAN_GAP_HOURS = 6;

  /* A claim naming two hazards needs both of them watched before its silence
     means anything: a flood-or-landslide claim graded against flood coverage
     alone would be failed for the absence of a landslide nobody was looking
     for. The answer is the intersection of the two. */
  function observedCoverageFor(scanLedger, hazard, place) {
    if (Array.isArray(hazard)) {
      if (!hazard.length) return { from: null, to: null, scans: 0, intervals: [], maxGapHours: MAX_SCAN_GAP_HOURS };
      var each = hazard.map(function (h) { return observedCoverageFor(scanLedger, h, place); });
      return each.reduce(intersectCoverage);
    }
    var scans = (scanLedger && scanLedger.scans) || [];
    var empty = { from: null, to: null, scans: 0, intervals: [], maxGapHours: MAX_SCAN_GAP_HOURS };
    if (!scans.length) return empty;
    var probe = { hazard: hazard, geography: place || {} };
    var times = [];
    for (var i = 0; i < scans.length; i++) {
      var s = scans[i], t = ms(s.scanTimestamp);
      if (t === null) continue;
      /* The definitions in force when THIS scan ran, never today's. Widening
         a provider's scope, or calling a selective feed exhaustive, changes
         what future scans can establish; it must not reach back and turn a
         scan that established nothing into evidence of an absence. */
      var meta = providersFor(scanLedger, s);
      var covered = (s.providers || []).some(function (p) {
        return p.status === 'SCANNED' && providerCanEstablishAbsence(meta[p.provider] || {}, probe);
      });
      if (covered) times.push(t);
    }
    if (!times.length) return empty;
    times.sort(function (a, b) { return a - b; });

    /* One interval per unbroken run of scans. A lone successful scan is an
       instant, not a span, and stays one: it can only cover a window that
       opens and closes at that moment, which is to say none. */
    var gap = MAX_SCAN_GAP_HOURS * 3600e3;
    var intervals = [{ from: times[0], to: times[0] }];
    for (var j = 1; j < times.length; j++) {
      var last = intervals[intervals.length - 1];
      if (times[j] - last.to <= gap) last.to = times[j];
      else intervals.push({ from: times[j], to: times[j] });
    }
    return {
      from: new Date(times[0]).toISOString(),
      to: new Date(times[times.length - 1]).toISOString(),
      scans: times.length,
      intervals: intervals.map(function (iv) {
        return { from: new Date(iv.from).toISOString(), to: new Date(iv.to).toISOString() };
      }),
      maxGapHours: MAX_SCAN_GAP_HOURS
    };
  }

  /** The provider definitions a given scan was recorded under. */
  function providersFor(scanLedger, scan) {
    var versions = (scanLedger && scanLedger.providerVersions) || null;
    var key = scan && scan.providerVersion;
    if (versions && key && versions[key] && versions[key].providers) return versions[key].providers;
    return (scanLedger && scanLedger.providers) || {};
  }

  /** Where two coverage answers overlap, and nowhere else. */
  function intersectCoverage(a, b) {
    var out = [];
    for (var i = 0; i < a.intervals.length; i++) {
      for (var j = 0; j < b.intervals.length; j++) {
        var from = Math.max(ms(a.intervals[i].from), ms(b.intervals[j].from));
        var to = Math.min(ms(a.intervals[i].to), ms(b.intervals[j].to));
        if (from <= to) out.push({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      }
    }
    return {
      from: out.length ? out[0].from : null,
      to: out.length ? out[out.length - 1].to : null,
      scans: Math.min(a.scans, b.scans),
      intervals: out,
      maxGapHours: MAX_SCAN_GAP_HOURS
    };
  }

  /**
   * Was this provider in a position to see this disaster?
   *
   * Its hazard list is half the question. NWS publishes flood warnings and
   * covers the United States, so a flood in Nepal is outside it however well
   * the hazard matches; the National Hurricane Center publishes cyclones for
   * two ocean basins and nothing in the western Pacific. Counting either as
   * having looked turns a coverage failure into a forecasting failure and
   * blames the engine for a gap in the sources.
   *
   * Returns null where the scope cannot be decided, and the caller treats
   * that as not covering: erring toward "we cannot say anyone was looking"
   * rather than toward blame.
   */
  function providerCoversHazard(meta, hazard) {
    var hazards = (meta && meta.hazards) || [];
    if (!hazards.length) return null;
    var want = norm(hazard).split('-')[0];
    for (var i = 0; i < hazards.length; i++) {
      if (norm(hazards[i]).indexOf(want) >= 0) return true;
    }
    return false;
  }

  function providerCoversPlace(meta, event) {
    var scope = meta && meta.scope;
    if (!scope || !scope.kind) return null;          // nothing recorded to test
    if (scope.kind === 'global') return true;
    var g = event.geography || {};
    if (scope.kind === 'countries') {
      if (!g.country) return null;
      for (var i = 0; i < (scope.countries || []).length; i++) {
        if (norm(scope.countries[i]) === norm(g.country)) return true;
      }
      return false;
    }
    if (scope.kind === 'boxes') {
      var lat = coord(g.lat), lon = coord(g.lon);
      if (lat === null || lon === null) return null;   // unlocated: not an answer
      for (var b = 0; b < (scope.boxes || []).length; b++) {
        var x = scope.boxes[b];
        if (lat >= x.minLat && lat <= x.maxLat && lon >= x.minLon && lon <= x.maxLon) return true;
      }
      return false;
    }
    return null;
  }

  /**
   * Did this provider cover the hazard and reach the place?
   *
   * This is the scanning question: was anything looking here that a forecast
   * could have been derived from. A selective feed still answers it.
   */
  function providerCovers(meta, event) {
    return providerCoversHazard(meta, event.hazard) === true &&
           providerCoversPlace(meta, event) === true;
  }

  /**
   * Can this provider's silence establish that no disaster occurred?
   *
   * A different and much stronger question. GDACS carries only what it raises
   * to an alert level, EONET does not claim to list every event, and ReliefWeb
   * holds only declared disasters - so none of their silences is evidence, and
   * treating a successful scan of any of them as proof of absence turns a
   * matured outlook into a false positive on the strength of a feed that never
   * claimed to be complete. Only a provider that is exhaustive within its own
   * stated bounds can support an absence.
   *
   * And exhaustive about what matters. A source whose records are warnings or
   * published statuses cannot establish an absence whatever its completeness:
   * the National Weather Service lists every active warning, and the USGS
   * volcano feed every elevated alert level, but neither kind of record enters
   * the observed-disaster ledger - so their silence establishes that nothing
   * was warned or elevated, not that no disaster occurred. A ledger that would
   * never have recorded the disaster cannot show that none happened.
   */
  /*
   * Could this source have supported a forecast at all?
   *
   * A scan of a catalogue of things that have already happened puts nobody in
   * a position to predict one. EONET, GDACS and ReliefWeb report events that
   * exist, and the only outlook this project can derive from such a record is
   * that the hazard continues - so counting a completed scan of them as the
   * engine having had its chance blamed the forecaster for every flood,
   * wildfire and drought it was never in a position to forecast. A source
   * that says what is expected - a watch, a warning, a storm advisory - is a
   * different thing, and only it can make an unforecast disaster a
   * forecasting failure.
   *
   * A source that does not record which it is cannot support the claim
   * either: absence of the statement is not a forecast product.
   */
  function providerIsProspective(meta) {
    return !!(meta && meta.inputKind === 'forecast');
  }

  function providerCanEstablishAbsence(meta, event) {
    return !!(meta && meta.completeness === 'exhaustive' &&
      meta.recordsObservations === true && providerCovers(meta, event));
  }

  /* ------------------------------------------------------- false negatives */

  var COVERAGE = {
    COVERAGE_FAILURE: 'COVERAGE_FAILURE',
    FORECAST_FAILURE: 'FORECAST_FAILURE',
    DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
    /* The hazard's own onset cannot be forecast, by this system or anyone
       else's. Calling that a forecasting failure asserts the engine could
       have predicted something the project states plainly that nobody can. */
    NOT_FORECASTABLE: 'NOT_FORECASTABLE',
    /* Forecastable in principle, but nothing this system was reading could
       have forecast it: every source covering that hazard and place reports
       what has already happened. */
    NO_PROSPECTIVE_INPUT: 'NO_PROSPECTIVE_INPUT'
  };

  /**
   * For one significant observed disaster: did a qualifying independent
   * prospective forecast exist before it, and if not, why not?
   *
   * The distinction the spec insists on, and the one it is easiest to get
   * wrong: the absence of a forecast is never on its own evidence that
   * nothing was looking. Without a scan record covering that moment, neither
   * answer can be given, and the honest reply is that it cannot be
   * established.
   */
  function assessCoverage(event, predictions, scanLedger, opts) {
    var hazardFamilyOf = (opts || {}).hazardFamilyOf;
    var qualifying = (predictions || []).filter(function (p) {
      return p.forecastClass === 'independent-prospective';
    });
    var matched = [];
    for (var i = 0; i < qualifying.length; i++) {
      var c = covers(qualifying[i], event, hazardFamilyOf);
      if (c) matched.push({ predictionId: qualifying[i].id, result: c.level === 'full' ? 'HIT' : 'PARTIAL_HIT', why: c.why });
    }
    if (matched.length) {
      return { falseNegative: false, status: null, matched: matched,
        reason: 'An independent prospective forecast covering this disaster existed beforehand.' };
    }

    /* Nothing forecast it, and nothing could have.
     *
     * The hazard table states which onsets can be anticipated at all: an
     * individual earthquake cannot, and this project says so on its own
     * methodology page. Attributing every unpredicted earthquake to a
     * forecasting failure blamed the engine for not doing the one thing it
     * states that nobody can do - and, because earthquakes are the hazard
     * this record sees most of, that single misattribution would have
     * dominated the reason a disaster went unforecast. It remains a false
     * negative: the disaster happened and nothing predicted it. What changes
     * is the reason given for it, which is counted and shown separately. */
    var forecastable = (opts || {}).hazardForecastable;
    if (typeof forecastable === 'function' && forecastable(event) === false) {
      return { falseNegative: true, status: COVERAGE.NOT_FORECASTABLE, matched: [],
        reason: 'The onset of this hazard is not forecastable. No agency forecasts it and neither does this project, so nothing here was in a position to predict it; it is counted as unforecast, not as a forecasting failure.' };
    }

    var onset = ms(event.onset);
    var scans = (scanLedger && Array.isArray(scanLedger.scans)) ? scanLedger.scans : [];
    var detailFrom = scanLedger && scanLedger.retention ? ms(scanLedger.retention.detailFrom) : null;

    if (!scans.length) {
      return { falseNegative: true, status: COVERAGE.DATA_UNAVAILABLE, matched: [],
        reason: 'No scan has been recorded, so whether anything was examining this hazard and place at the time cannot be established. It is not evidence that nothing was.' };
    }
    if (onset === null || (detailFrom !== null && onset < detailFrom)) {
      return { falseNegative: true, status: COVERAGE.DATA_UNAVAILABLE, matched: [],
        reason: 'This disaster predates the scan ledger’s detailed record, so whether its hazard and place were being examined cannot be established either way.' };
    }

    /* Was anything that covers this hazard actually evaluated around then? */
    /* Before the disaster, not around it.
     *
     * An absolute difference accepted a scan up to a day AFTER onset, so a
     * provider that was down beforehand and came back afterwards was read as
     * having been in a position to forecast the thing it missed - and the
     * disaster was blamed on the forecaster rather than on the gap. Only a
     * scan at or before onset can show anyone was watching in time. */
    var window = 24 * 3600e3;
    var near = scans.filter(function (s) {
      var t = ms(s.scanTimestamp);
      return t !== null && t <= onset && onset - t <= window;
    });
    if (!near.length) {
      return { falseNegative: true, status: COVERAGE.DATA_UNAVAILABLE, matched: [],
        reason: 'No scan is recorded in the day before this disaster, so whether it was being watched in time to forecast it cannot be established.' };
    }
    var coveringMetas = [];
    near.forEach(function (s) {
      (s.providers || []).forEach(function (p) {
        var meta = providersFor(scanLedger, s)[p.provider] || {};
        if (p.status === 'SCANNED' && providerCovers(meta, event)) coveringMetas.push(meta);
      });
    });
    if (!coveringMetas.length) {
      return { falseNegative: true, status: COVERAGE.COVERAGE_FAILURE, matched: [],
        reason: 'No provider covering this hazard completed a scan within a day of it, so nothing was in a position to forecast it.' };
    }
    /* Scanned, and by something that could have seen it coming. */
    var prospective = coveringMetas.filter(providerIsProspective);
    if (!prospective.length) {
      return { falseNegative: true, status: COVERAGE.NO_PROSPECTIVE_INPUT, matched: [],
        reason: 'Every source covering this hazard and place reports what has already happened, so nothing this system reads could have forecast it. ' +
          'It is counted as unforecast, not as a forecasting failure.' };
    }
    return { falseNegative: true, status: COVERAGE.FORECAST_FAILURE, matched: [],
      reason: 'A source that states what is expected for this hazard (' +
        (prospective[0].label || 'a forecasting source') +
        ') completed a scan of this place within a day of the disaster, and no qualifying independent forecast was produced.' };
  }

  /* --------------------------------------------------------------- scoring */

  /** Precision, recall and F1, each with the counts they came from. */
  function score(verifications, observedAssessments) {
    var hit = 0, partial = 0, miss = 0, pending = 0, invalid = 0, ungradeable = 0;
    var ungradeableBy = {};
    /* A hit can be established from the disaster record alone; a false
       positive cannot - it needs a source whose silence is evidence. So the
       two are not always available on the same windows, and averaging over a
       set where only hits were reachable would report a precision made
       entirely of the outcomes that could be found. Those hits are counted,
       named and kept out of the rate. */
    var hitsOutsideCoverage = 0;
    for (var i = 0; i < (verifications || []).length; i++) {
      var v = verifications[i], c = v.classification;
      if (v.gradeable === false && v.ungradeableReason && v.ungradeableReason !== 'WINDOW_STILL_OPEN') {
        ungradeable++;
        ungradeableBy[v.ungradeableReason] = (ungradeableBy[v.ungradeableReason] || 0) + 1;
      }
      var symmetric = v.absenceEstablishable !== false;
      if (c === 'HIT') { if (symmetric) hit++; else hitsOutsideCoverage++; }
      else if (c === 'PARTIAL_HIT') { if (symmetric) partial++; else hitsOutsideCoverage++; }
      else if (c === 'MISS_FALSE_POSITIVE') miss++;
      else if (c === 'PENDING') pending++;
      else if (c === 'INVALID_POST_EVENT') invalid++;
    }
    var eligible = hit + partial + miss;

    var predicted = 0, partlyPredicted = 0, falseNegatives = 0;
    var coverage = { COVERAGE_FAILURE: 0, FORECAST_FAILURE: 0, DATA_UNAVAILABLE: 0,
      NOT_FORECASTABLE: 0, NO_PROSPECTIVE_INPUT: 0 };
    for (var j = 0; j < (observedAssessments || []).length; j++) {
      var a = observedAssessments[j];
      if (!a.falseNegative) {
        if (a.matched.some(function (m) { return m.result === 'HIT'; })) predicted++;
        else partlyPredicted++;
      } else {
        falseNegatives++;
        if (coverage[a.status] !== undefined) coverage[a.status]++;
      }
    }
    var significant = (observedAssessments || []).length;

    var precision = eligible ? (hit + PARTIAL_WEIGHT * partial) / eligible : null;
    var recall = significant ? (predicted + PARTIAL_WEIGHT * partlyPredicted) / significant : null;
    var f1 = (precision !== null && recall !== null && (precision + recall) > 0)
      ? 2 * precision * recall / (precision + recall) : null;

    return {
      hit: hit, partial: partial, miss: miss, pending: pending, invalid: invalid,
      hitsOutsideCoverage: hitsOutsideCoverage,
      ungradeable: ungradeable, ungradeableBy: ungradeableBy,
      eligibleMaturedPredictions: eligible,
      significantObservedEvents: significant,
      predictedEvents: predicted, partlyPredictedEvents: partlyPredicted,
      falseNegatives: falseNegatives, coverage: coverage,
      partialHitWeight: PARTIAL_WEIGHT,
      precision: precision, recall: recall, f1: f1,
      methodology: {
        precision: 'weightedPrecision = (HIT + ' + PARTIAL_WEIGHT + ' × PARTIAL_HIT) ÷ eligible matured predictions.',
        recall: 'eventRecall = (fully predicted events + ' + PARTIAL_WEIGHT + ' × partly predicted events) ÷ significant observed events.',
        f1: 'F1 = 2 × precision × recall ÷ (precision + recall). It is a verification score, not an accuracy.',
        partialHitWeight: 'PARTIAL HIT weight = ' + PARTIAL_WEIGHT + '. A partial hit was right about the hazard and the window and wrong about part of where, so it counts as half.',
        version: VERIFICATION_VERSION
      }
    };
  }

  var api = {
    VERIFICATION_VERSION: VERIFICATION_VERSION,
    CLASSIFICATION: CLASSIFICATION, COVERAGE: COVERAGE,
    PARTIAL_WEIGHT: PARTIAL_WEIGHT, GEOGRAPHY_TOLERANCE_KM: GEOGRAPHY_TOLERANCE_KM,
    effectiveStart: effectiveStart, frozenClaim: frozenClaim, geographyMatch: geographyMatch,
    toleranceFor: toleranceFor,
    claimAccepts: claimAccepts,
    verify: verify, covers: covers, assessCoverage: assessCoverage, score: score, distanceKm: distanceKm,
    providerCovers: providerCovers, providerCoversHazard: providerCoversHazard,
    providerCanEstablishAbsence: providerCanEstablishAbsence,
    providerIsProspective: providerIsProspective,
    observedCoverageFor: observedCoverageFor, MAX_SCAN_GAP_HOURS: MAX_SCAN_GAP_HOURS,
    providersFor: providersFor,
    continuedActivity: continuedActivity, reportsMoreImpact: reportsMoreImpact, CONTINUATION_CLASSES: CONTINUATION_CLASSES,
    CONTINUATION_EVIDENCE: CONTINUATION_EVIDENCE, IMPACT_FIELDS: IMPACT_FIELDS,
    providerCoversPlace: providerCoversPlace
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDVerification = api;
})(typeof window !== 'undefined' ? window : null);
