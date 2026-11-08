'use strict';
/**
 * The track record, computed once, for the page and the summary alike.
 *
 * /accuracy used to grade the outlook ledger in the browser, inline, and
 * build its headline from that ledger alone, while the forecast detail page
 * read a different record and the model grades sat in a third. Three
 * answers to "how did this forecast do?", and the headline contradicted the
 * section under it. This file is the one composition of the grading:
 * tools/build-accuracy-summary.js runs it in the ledger workflows and writes
 * data/accuracy-summary.json and data/forecast-verdicts.json, and the page
 * runs the same function when a reader opens the full record.
 *
 * One verdict per forecast. The outlook ledger records a forecast again each
 * time it is re-issued, and every recorded version used to be counted: one
 * storm outlook was "correct" 23 times. A forecast is now counted once, by
 * its first recorded version - the claim it made before anything else was
 * known - and the later versions are kept and shown as versions.
 *
 * Loaded as a plain script (window.PNDAccuracy) and required by the tools
 * and the tests.
 */
(function (root) {
  var ENGINE_DECIDED = ['VERIFIED', 'PARTIAL', 'FALSE_ALARM', 'NOT_A_PREDICTION'];
  var LEDGER_GRADED = ['VERIFIED', 'PARTIAL', 'FALSE_ALARM', 'MISSED', 'COVERAGE_FAILURE'];

  function claimIdWith(H) {
    return function (r) { return (H && H.claimKey) ? H.claimKey(r) : ((r && r.id) + '@' + (r && r.targetStart)); };
  }
  function ms(t) { var v = Date.parse(t || ''); return isFinite(v) ? v : null; }
  function frozenAt(r) { return ms(r && (r.freezeTimestamp || r.recordedAt)) || ms(r && r.targetStart) || 0; }

  /*
   * What kind of claim a record is, for reporting. Only forecasts made in
   * advance test this site's skill; the rest are reported apart and never
   * added to them.
   */
  var BUCKETS = {
    'independent-prospective': 'advance',
    'continuation-outlook': 'restated',
    'warning-derived': 'restated',
    'post-event-conditional': 'aftershock',
    'retrospective-benchmark': 'test',
    'invalid-post-event': 'test'
  };
  function bucketOf(r) {
    if (!r || !(r.targetStart || r.targetEnd || r.forecastKind)) return 'observed';
    return BUCKETS[r.forecastClass] || 'other';
  }

  /** The first recorded version of each forecast id, in the order given. */
  function firstVersionIndex(rows) {
    var best = {};
    (rows || []).forEach(function (r, i) {
      if (!r || !r.id) return;
      var b = best[r.id];
      if (b === undefined || frozenAt(r) < frozenAt(rows[b])) best[r.id] = i;
    });
    var keep = {};
    Object.keys(best).forEach(function (id) { keep[best[id]] = true; });
    return keep;
  }

  /**
   * Grade the outlook ledger: the same steps, in the same order, the page
   * always took, with one verdict per forecast added on top.
   *
   * inp: { ledger, verification, observed, scan, now }
   * deps: { V: verdicts.js, VER: verification-model.js, OBSM: observed-model.js, H: hazard-model.js }
   */
  function gradeOutlooks(inp, deps) {
    var V = deps.V, VER = deps.VER, OBSM = deps.OBSM, H = deps.H;
    var now = inp.now;
    var l = inp.ledger || [];
    var v = inp.verification || { verifications: [] };
    var scan = inp.scan || { scans: [] };
    var obsLedger = inp.observed || { events: [] };
    var claimId = claimIdWith(H);
    var joined = V.joinVerdicts(l, v.verifications || []);
    var obsEvents = (obsLedger.events || []).filter(function (e) { return !e.supersededBy; });
    var supportingEvents = obsLedger.supporting || [];
    var coverageFor = function (claim) { return VER.observedCoverageFor(scan, claim.hazards || claim.hazard, claim.geography); };
    var preds = l.map(function (r) { return Object.assign({}, r, { forecastClass: V.forecastClassOf(r) }); });
    var verdicts = preds.map(function (p) {
      return VER.verify(p, obsEvents, { now: now, hazardFamilyOf: OBSM.familyOf, observedCoverage: coverageFor, supportingEvents: supportingEvents });
    });
    var byId = new Map(verdicts.map(function (vd, i) { return [claimId(preds[i]), vd]; }));
    var observed = (v.observedEvents || []).map(function (x) { return Object.assign({}, x, { status: x.status || 'MISSED_EVENT' }); });
    var first = firstVersionIndex(l);
    var versions = {};
    l.forEach(function (r) { if (r && r.id) versions[r.id] = (versions[r.id] || 0) + 1; });
    var firstKey = {};
    l.forEach(function (r, i) { if (first[i]) firstKey[claimId(r)] = true; });
    var records = joined.records.concat(observed).map(function (r) {
      var led = V.stateOf(r, now), eng = V.engineState(byId.get(claimId(r)));
      var decided = !!eng && ENGINE_DECIDED.indexOf(eng) >= 0, ledGraded = LEDGER_GRADED.indexOf(led) >= 0;
      /* A hand-recorded missed event is not a forecast, whatever class a
         classifier would guess for it. */
      var isForecast = !!(r.targetStart || r.targetEnd || r.forecastKind);
      return Object.assign({}, r, isForecast ? { forecastClass: r.forecastClass || V.forecastClassOf(r) } : {}, {
        _state: decided ? eng : (ledGraded ? led : (eng || led)),
        _engineState: eng,
        _ledgerState: (decided && eng !== led && ledGraded) ? led : null,
        _engineUnreproduced: !decided && ledGraded && eng === 'UNGRADEABLE',
        /* Counted once: the first recorded version of its id. A hand-recorded
           missed event is not a forecast and is always counted. */
        _counted: isForecast ? !!firstKey[claimId(r)] : true,
        _versions: isForecast ? (versions[r.id] || 1) : 1
      });
    });
    records.sort(function (a, b) { return (ms(b.recordedAt || b.observedAt) || 0) - (ms(a.recordedAt || a.observedAt) || 0); });
    var counted = records.filter(function (r) { return r._counted; });

    /* Rates over one version per forecast. */
    var firstIdx = preds.map(function (p, i) { return i; }).filter(function (i) { return first[i]; });
    var headlineIdx = firstIdx.filter(function (i) { return preds[i].forecastClass === 'independent-prospective'; });
    var condIdx = firstIdx.filter(function (i) {
      return preds[i].forecastClass && preds[i].forecastClass !== 'independent-prospective' && preds[i].forecastClass !== 'invalid-post-event';
    });
    var forecastableOf = function (e) {
      var HZ = H && H.HAZARDS; if (!HZ) return true;
      var h = HZ[e.hazardLabel] || HZ[e.type]; return h ? h.forecastable !== false : true;
    };
    var assessments = obsEvents.map(function (e) {
      return VER.assessCoverage(e, preds, scan, { hazardFamilyOf: OBSM.familyOf, hazardForecastable: forecastableOf });
    });
    var pick = function (idx) { return idx.map(function (i) { return verdicts[i]; }); };
    var sH = VER.score(pick(headlineIdx), assessments);
    var since = VER.predictingSince(preds);
    var recallIdx = obsEvents.map(function (e, i) { return i; }).filter(function (i) { return VER.inRecallPeriod(obsEvents[i], since); });
    var sR = VER.score(pick(headlineIdx), recallIdx.map(function (i) { return assessments[i]; }));
    var sC = VER.score(pick(condIdx), []);
    return {
      joined: joined, preds: preds, verdicts: verdicts, byId: byId, records: records, counted: counted,
      obsEvents: obsEvents, supportingEvents: supportingEvents, coverageFor: coverageFor, assessments: assessments,
      headlineIdx: headlineIdx, condIdx: condIdx, since: since, recallIdx: recallIdx,
      sH: sH, sR: sR, sC: sC, distinct: Object.keys(versions).length, versions: l.length,
      tally: V.tally(counted, now),
      claimId: claimId
    };
  }

  /** V.tally over the counted records of one bucket. */
  function tallyBucket(g, V, now, bucket) {
    return V.tally(g.counted.filter(function (r) { return bucketOf(r) === bucket; }), now);
  }

  function slimTally(t) {
    return { forecasts: t.total, open: t.open, awaiting: t.awaiting, ungradeable: t.ungradeable, checked: t.graded,
      correct: t.verified, partlyCorrect: t.partial, wrong: t.falseAlarm, notPrediction: t.notPrediction, missed: t.missed };
  }

  /*
   * The few kilobytes the page needs for its first screen. Built from both
   * ledgers, so the headline and the sections under it say the same thing.
   */
  function summarise(g, modelVerdicts, deps, meta) {
    var V = deps.V, VER = deps.VER, now = meta.now;
    var mv = modelVerdicts || {};
    var c = mv.counts || {};
    var rows = mv.outlooks || [];
    var firstModel = null;
    (meta.modelLedger || []).forEach(function (o) {
      var t = ms(o.recordedAt); if (t !== null && (firstModel === null || t < firstModel)) firstModel = t;
    });
    var byHazard = ['heat', 'rain', 'fire'].map(function (hz) {
      var of = rows.filter(function (o) { return o.hazard === hz; });
      var n = function (w) { return of.filter(function (o) { return o.verdict === w; }).length; };
      var d = (mv.days || {})[hz] || {};
      return { hazard: hz, issued: of.length, correct: n('correct'), falseAlarms: n('false alarm'), pending: n('pending'),
        missedDays: (mv.misses || []).filter(function (m) { return m.hazard === hz; }).length,
        expectedByChance: Math.round(of.filter(function (o) { return o.verdict !== 'pending' && o.chance !== null && o.chance !== undefined; })
          .reduce(function (a, o) { return a + o.chance; }, 0) * 10) / 10,
        days: d.days || 0, dayHits: d.hits || 0, dayFalseAlarms: d.falseAlarms || 0, dayMisses: d.misses || 0,
        baseRate: d.baseRate === undefined ? null : d.baseRate, pod: d.pod === undefined ? null : d.pod, far: d.far === undefined ? null : d.far };
    });
    var restated = slimTally(tallyBucket(g, V, now, 'restated'));
    var aftershock = slimTally(tallyBucket(g, V, now, 'aftershock'));
    var test = slimTally(tallyBucket(g, V, now, 'test'));
    var advanceOutlooks = slimTally(tallyBucket(g, V, now, 'advance'));
    var versionsOf = function (b) { return g.records.filter(function (r) { return bucketOf(r) === b; }).length; };
    restated.versions = versionsOf('restated'); aftershock.versions = versionsOf('aftershock');
    var predicted = g.obsEvents.length - g.sH.falseNegatives;
    return {
      note: 'The figures /accuracy opens with, from tools/build-accuracy-summary.js over data/model-verdicts.json, ' +
        'data/outlook-ledger.json, data/verification-ledger.json, data/observed-disasters.json and data/scan-ledger.json. ' +
        'One verdict per forecast. Rebuilt whenever either ledger changes.',
      generatedAt: new Date(now).toISOString(),
      recordUpdated: meta.recordUpdated || null,
      verificationVersion: VER.VERIFICATION_VERSION,
      model: {
        issued: c.issued || 0, since: firstModel === null ? null : new Date(firstModel).toISOString(),
        graded: (c.correct || 0) + (c.falseAlarms || 0), correct: c.correct || 0, falseAlarms: c.falseAlarms || 0,
        pending: c.pending || 0, missedDays: c.missedDays || 0,
        expectedByChance: c.expectedByChance === undefined ? null : c.expectedByChance,
        events: mv.events || null, settleDays: mv.settleDays || null, measuredThrough: mv.measuredThrough || null,
        gradedAt: mv.generatedAt || null, byHazard: byHazard
      },
      advanceOutlooks: advanceOutlooks,
      restated: restated, aftershock: aftershock, test: test,
      outlookForecasts: g.distinct, outlookVersions: g.versions,
      disasters: { total: g.obsEvents.length, forecastInAdvance: predicted, coverage: g.sH.coverage }
    };
  }

  var nf = function (x) { return Number(x).toLocaleString('en-GB'); };
  var pl = function (x, one, many) { return nf(x) + ' ' + (x === 1 ? one : many); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(t) { var d = new Date(t); return isNaN(d) ? '' : d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

  /** The headline, in words, from the summary alone. */
  function answer(s) {
    var m = s.model, pts = [], lead;
    if (!m.issued) lead = 'Our weather models have not published a forecast yet.';
    else if (!m.graded) lead = 'Our weather models have published ' + pl(m.issued, 'forecast', 'forecasts') + ' in advance' +
      (m.since ? ' since ' + day(m.since) : '') + '. None can be graded yet.';
    else lead = 'Our weather models have published ' + pl(m.issued, 'forecast', 'forecasts') + ' in advance' +
      (m.since ? ' since ' + day(m.since) : '') + '. ' + nf(m.graded) + ' can be graded so far: ' + nf(m.correct) + ' came true and ' +
      pl(m.falseAlarms, 'was a false alarm', 'were false alarms') + '.';
    if (m.issued) {
      pts.push('A forecast is graded once every day of its window has a settled NASA POWER measurement' +
        (m.settleDays ? ' (one at least ' + m.settleDays + ' days old when fetched, because recent days are revised)' : '') +
        '. ' + pl(m.pending, 'forecast is', 'forecasts are') + ' still waiting' + (m.measuredThrough ? '; measurements have settled up to ' + day(m.measuredThrough) : '') + '.');
      if (m.graded && m.expectedByChance !== null) pts.push('By chance alone, with the same windows, about ' + m.expectedByChance +
        ' of the ' + nf(m.graded) + ' graded forecasts would have come true.');
      pts.push(pl(m.missedDays, 'day', 'days') + ' crossed a model’s line at a place it was watching, with no forecast for it.');
    }
    var r = s.restated;
    pts.push('Our other ' + pl(s.outlookForecasts, 'forecast', 'forecasts') + ' (' + nf(s.outlookVersions) + ' recorded versions) were not made in advance. ' +
      nf(r.forecasts) + ' restate an alert an agency had already issued and are not a test of our skill: ' + nf(r.checked) + ' could be checked, ' +
      nf(r.correct) + ' correct, ' + nf(r.partlyCorrect) + ' partly correct and ' + nf(r.wrong) + ' wrong, counted on new damage or impact reported inside the window.' +
      (s.aftershock.forecasts ? ' ' + nf(s.aftershock.forecasts) + ' are aftershock forecasts after an earthquake.' : '') +
      (s.test.forecasts ? ' ' + pl(s.test.forecasts, 'is a test case', 'are test cases') + ' written after its period began.' : ''));
    pts.push(s.disasters.total
      ? pl(s.disasters.total, 'significant disaster is', 'significant disasters are') + ' on record. ' +
        (s.disasters.forecastInAdvance ? 'We forecast ' + nf(s.disasters.forecastInAdvance) + ' of them in advance.' : 'We forecast none of them in advance.')
      : 'No significant disaster has been recorded yet. This does not mean nothing happened.');
    return { lead: lead, points: pts };
  }

  /* One row per outlook forecast, for the paged table and the detail page. */
  function outlookRows(g, V) {
    return g.records.filter(function (r) { return r._counted && bucketOf(r) !== 'observed'; }).map(function (r) {
      return { id: r.id, title: r.title || '', type: r.type || '', place: [r.region, r.country].filter(Boolean).join(', '),
        kind: bucketOf(r), forecastClass: r.forecastClass || null, recordedAt: r.recordedAt || r.freezeTimestamp || null,
        targetStart: r.targetStart || null, targetEnd: r.targetEnd || null, state: r._state, label: V.LABELS[r._state] || r._state,
        versions: r._versions,
        reason: (function () { var vd = g.byId.get(g.claimId(r)); return vd ? vd.classificationReason || '' : ''; })() };
    });
  }

  var api = { gradeOutlooks: gradeOutlooks, summarise: summarise, answer: answer, outlookRows: outlookRows,
    bucketOf: bucketOf, firstVersionIndex: firstVersionIndex, BUCKETS: BUCKETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDAccuracy = api;
})(typeof window !== 'undefined' ? window : null);
