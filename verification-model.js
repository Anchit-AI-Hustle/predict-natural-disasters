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

  var VERIFICATION_VERSION = 'verify-1.0.0';

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

  /**
   * The frozen claim, extracted once so that everything downstream grades the
   * same thing and a reader can see exactly what was compared.
   */
  function frozenClaim(p, hazardFamilyOf) {
    var family = hazardFamilyOf(p.type, p.title);
    return {
      hazard: family,
      hazardLabel: p.type || null,
      geography: {
        country: p.country || null,
        region: p.region || null,
        lat: (p.lat === undefined || p.lat === null) ? null : Number(p.lat),
        lon: (p.lon === undefined || p.lon === null) ? null : Number(p.lon),
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
        partialHitWeight: PARTIAL_WEIGHT
      },
      freezeTimestamp: p.freezeTimestamp || null,
      forecastClass: p.forecastClass || null
    };
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
    var tol = claim.thresholds.geographyToleranceKm;

    if (d !== null && d <= tol) {
      return { level: 'full',
        why: 'Observed ' + Math.round(d) + ' km from the forecast position, inside the published ' + tol + ' km tolerance for this hazard.' };
    }
    /* The right country and the right hazard, but outside the area the
       forecast actually named. Part of the claim held and part did not, which
       is what a partial hit is. */
    if (sameCountry) {
      return { level: 'partial',
        why: 'Observed in ' + eg.country + ', which the outlook named, but ' +
             (d === null ? 'its position cannot be compared with the forecast position'
                         : Math.round(d) + ' km away, outside the published ' + tol + ' km tolerance') + '.' };
    }
    return null;
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

    var say = function (classification, reason, matched, ungradeable) {
      return {
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
    var cov = o.observedCoverage;
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
    }

    var matched = [], early = [];
    for (var i = 0; i < (observedEvents || []).length; i++) {
      var ev = observedEvents[i];
      if (!ev.significant) continue;
      if (ev.hazard !== claim.hazard) continue;
      var onset = ms(ev.onset);
      if (onset === null) continue;
      var geo = geographyMatch(claim, ev);
      if (!geo) continue;
      if (start !== null && onset < start) { early.push({ event: ev, level: geo.level, why: geo.why }); continue; }
      if (onset > end) continue;
      matched.push({ event: ev, level: geo.level, why: geo.why });
    }

    var full = matched.filter(function (m) { return m.level === 'full'; });
    if (full.length) {
      return say(CLASSIFICATION.HIT,
        'A significant ' + claim.hazard + ' was observed inside the frozen geography and window. ' + full[0].why, full);
    }
    if (matched.length) {
      return say(CLASSIFICATION.PARTIAL_HIT,
        'A significant ' + claim.hazard + ' was observed inside the window but only partly inside the geography this outlook named. ' + matched[0].why, matched);
    }
    if (early.length) {
      return say(CLASSIFICATION.MISS_FALSE_POSITIVE,
        'The only matching ' + claim.hazard + ' began at ' + early[0].event.onset + ', before this forecast can be shown to have existed (' +
        claim.window.effectiveForecastStart + '), so it cannot count as having been predicted.', []);
    }
    return say(CLASSIFICATION.MISS_FALSE_POSITIVE,
      'The window closed with no significant ' + claim.hazard + ' observed inside the frozen geography.', []);
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
  function covers(prediction, event) {
    var claim = frozenClaim(prediction, function () { return event.hazard; });
    if (claim.hazard !== event.hazard) return null;
    var onset = ms(event.onset);
    var start = ms(claim.window.effectiveForecastStart);
    var end = ms(claim.window.targetEnd);
    if (onset === null || end === null) return null;
    if (start !== null && onset < start) return null;
    if (onset > end) return null;
    return geographyMatch(claim, event);
  }

  /* ------------------------------------------------------- false negatives */

  var COVERAGE = {
    COVERAGE_FAILURE: 'COVERAGE_FAILURE',
    FORECAST_FAILURE: 'FORECAST_FAILURE',
    DATA_UNAVAILABLE: 'DATA_UNAVAILABLE'
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
  function assessCoverage(event, predictions, scanLedger) {
    var qualifying = (predictions || []).filter(function (p) {
      return p.forecastClass === 'independent-prospective';
    });
    var matched = [];
    for (var i = 0; i < qualifying.length; i++) {
      var c = covers(qualifying[i], event);
      if (c) matched.push({ predictionId: qualifying[i].id, result: c.level === 'full' ? 'HIT' : 'PARTIAL_HIT', why: c.why });
    }
    if (matched.length) {
      return { falseNegative: false, status: null, matched: matched,
        reason: 'An independent prospective forecast covering this disaster existed beforehand.' };
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
    var window = 24 * 3600e3;
    var near = scans.filter(function (s) {
      var t = ms(s.scanTimestamp);
      return t !== null && Math.abs(t - onset) <= window;
    });
    if (!near.length) {
      return { falseNegative: true, status: COVERAGE.DATA_UNAVAILABLE, matched: [],
        reason: 'No scan is recorded within a day of this disaster, so whether it was being watched cannot be established.' };
    }
    var covering = near.some(function (s) {
      return (s.providers || []).some(function (p) {
        var meta = (scanLedger.providers || {})[p.provider] || {};
        var hazards = meta.hazards || [];
        var covers = hazards.some(function (h) { return norm(h).indexOf(norm(event.hazard).split('-')[0]) >= 0; });
        return covers && p.status === 'SCANNED';
      });
    });
    if (!covering) {
      return { falseNegative: true, status: COVERAGE.COVERAGE_FAILURE, matched: [],
        reason: 'No provider covering this hazard completed a scan within a day of it, so nothing was in a position to forecast it.' };
    }
    return { falseNegative: true, status: COVERAGE.FORECAST_FAILURE, matched: [],
      reason: 'A provider covering this hazard was scanned around the time of this disaster and no qualifying independent forecast was produced.' };
  }

  /* --------------------------------------------------------------- scoring */

  /** Precision, recall and F1, each with the counts they came from. */
  function score(verifications, observedAssessments) {
    var hit = 0, partial = 0, miss = 0, pending = 0, invalid = 0, ungradeable = 0;
    var ungradeableBy = {};
    for (var i = 0; i < (verifications || []).length; i++) {
      var v = verifications[i], c = v.classification;
      if (v.gradeable === false && v.ungradeableReason && v.ungradeableReason !== 'WINDOW_STILL_OPEN') {
        ungradeable++;
        ungradeableBy[v.ungradeableReason] = (ungradeableBy[v.ungradeableReason] || 0) + 1;
      }
      if (c === 'HIT') hit++;
      else if (c === 'PARTIAL_HIT') partial++;
      else if (c === 'MISS_FALSE_POSITIVE') miss++;
      else if (c === 'PENDING') pending++;
      else if (c === 'INVALID_POST_EVENT') invalid++;
    }
    var eligible = hit + partial + miss;

    var predicted = 0, partlyPredicted = 0, falseNegatives = 0;
    var coverage = { COVERAGE_FAILURE: 0, FORECAST_FAILURE: 0, DATA_UNAVAILABLE: 0 };
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
    verify: verify, covers: covers, assessCoverage: assessCoverage, score: score, distanceKm: distanceKm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDVerification = api;
})(typeof window !== 'undefined' ? window : null);
