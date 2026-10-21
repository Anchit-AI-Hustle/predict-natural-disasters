/*
 * The Track record grading, run by the app on the website's own scripts.
 *
 * hazard-model.js, observed-model.js and verification-model.js are bundled
 * unchanged from the website and loaded before this file. This driver does
 * what the grading part of accuracy.html load() does - the same calls, in the
 * same order, with the same options - and hands back only what the screen
 * prints, as JSON. Everything that is wording stays in the app (TrackRecord.kt),
 * which follows the page's strings.
 *
 * Input: {now, outlook: LedgerRow[], verification: {...}, observed: {...}, scan: {...}}
 */
var PNDTrackRecord = {
  run: function (inputJson) {
    var d = JSON.parse(inputJson);
    var VER = PNDVerification, OBSM = PNDObserved, H = PNDHazards;
    var now = d.now;
    var l = Array.isArray(d.outlook) ? d.outlook : [];
    var obsLedger = d.observed, scanLedger = d.scan;
    var classOf = function (r) {
      if (r && r.forecastClass) return r.forecastClass;
      var c = H.classifyForecast(Object.assign({ forecast: true }, r || {}));
      return c ? c.forecastClass : null;
    };
    var obsEvents = ((obsLedger && obsLedger.events) || []).filter(function (e) { return !e.supersededBy; });
    var supportingEvents = (obsLedger && obsLedger.supporting) || [];
    var coverageFor = function (claim) {
      return VER.observedCoverageFor(scanLedger || { scans: [] }, claim.hazards || claim.hazard, claim.geography);
    };
    var preds = l.map(function (r) { return Object.assign({}, r, { forecastClass: classOf(r) }); });
    var verdicts = preds.map(function (p) {
      return VER.verify(p, obsEvents, { now: now, hazardFamilyOf: OBSM.familyOf, observedCoverage: coverageFor, supportingEvents: supportingEvents });
    });
    var forecastableOf = function (e) {
      var HZ = H.HAZARDS; if (!HZ) return true;
      var h = HZ[e.hazardLabel] || HZ[e.type];
      return h ? h.forecastable !== false : true;
    };
    var assessments = obsEvents.map(function (e) {
      return VER.assessCoverage(e, preds, scanLedger || { scans: [] }, { hazardFamilyOf: OBSM.familyOf, hazardForecastable: forecastableOf });
    });
    var headlineIdx = [], condIdx = [];
    preds.forEach(function (p, i) {
      if (p.forecastClass === 'independent-prospective') headlineIdx.push(i);
      else if (p.forecastClass && p.forecastClass !== 'invalid-post-event') condIdx.push(i);
    });
    var pick = function (idx) { return idx.map(function (i) { return verdicts[i]; }); };
    var sH = VER.score(pick(headlineIdx), assessments);
    var since = VER.predictingSince(preds);
    var recallIdx = [];
    obsEvents.forEach(function (e, i) { if (VER.inRecallPeriod(e, since)) recallIdx.push(i); });
    var sR = VER.score(pick(headlineIdx), recallIdx.map(function (i) { return assessments[i]; }));
    var sC = VER.score(pick(condIdx), []);
    var slim = function (v, i) {
      var t = v.originalThresholds || null;
      return {
        key: H.claimKey(preds[i]),
        classification: v.classification || null,
        gradeable: v.gradeable,
        ungradeableReason: v.ungradeableReason || null,
        classificationReason: v.classificationReason || null,
        forecastClass: v.forecastClass || null,
        observedEventIds: v.observedEventIds || [],
        tolerance: t ? { km: t.geographyToleranceKm, byHazard: t.geographyToleranceKmByHazard || {} } : null,
        country: (v.originalGeography && v.originalGeography.country) || null
      };
    };
    return JSON.stringify({
      version: VER.VERIFICATION_VERSION,
      predClasses: preds.map(function (p) { return p.forecastClass || null; }),
      verdicts: verdicts.map(slim),
      invalid: verdicts.filter(function (x) { return x.classification === 'INVALID_POST_EVENT'; }).length,
      headlineCount: headlineIdx.length,
      condCount: condIdx.length,
      obsEvents: obsEvents.map(function (e) {
        var g = e.geography || {};
        return { canonicalEventId: e.canonicalEventId, significanceReason: e.significanceReason || '', hazardLabel: e.hazardLabel || null,
          hazard: e.hazard || null, region: g.region || null, country: g.country || null, onset: e.onset || null,
          deaths: e.deaths === undefined ? null : e.deaths, displaced: e.displaced === undefined ? null : e.displaced,
          evidenceConfidence: e.evidenceConfidence || null };
      }),
      assessments: assessments.map(function (a) { return { falseNegative: !!a.falseNegative, status: a.status || null, reason: a.reason || '' }; }),
      sH: sH, sR: sR, sC: sC,
      since: since,
      recallCount: recallIdx.length
    });
  }
};
