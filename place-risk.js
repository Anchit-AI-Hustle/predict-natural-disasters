/* One answer to "is this place at risk", used everywhere that question is asked.
 *
 * The Personal Risk page already evaluated a saved place against every record
 * through hazard-model's riskRow, sorted the result into the five evidence
 * bands and summarised it in a line of its own. The homepage asks the same
 * question of a place a reader just typed, and writing that a second time is
 * how the risk palette ended up with four versions of itself. So the banding,
 * the level, the sentence explaining it and the guidance that follows are all
 * decided here, once.
 *
 * Three rules this file exists to hold:
 *
 *  - The level is never stronger than the evidence. A hazard reported at an
 *    incident coordinate 40 km away is a different claim from one whose
 *    coordinate is a country's centre, and the second never produces a
 *    distance or a level at all - riskRow puts it in band D and this leaves
 *    it there.
 *
 *  - "Nothing found" is not "safe". It returns no level from the scale, and
 *    says what was actually searched and what that does not cover. A green
 *    LOW badge over a place this project has no incident-level record for
 *    would be a safety claim nobody made.
 *
 *  - The guidance is generic and points at the authority. This project does
 *    not know a reader's building, their mobility or their local plan, and an
 *    instruction that sounds specific would be invented.
 *
 * Loaded as a plain script in the browser (window.PNDPlaceRisk) and required
 * by the tests.
 */
(function () {

  /* Where the six-level scale comes from, when it is loaded. */
  function risk() {
    return (typeof window !== 'undefined' && window.PNDRisk) ||
      (typeof require === 'function' ? null : null);
  }
  function hazards() {
    return (typeof window !== 'undefined' && window.PNDHazards) || null;
  }

  /*
   * How close a reported incident has to be before it is this place's problem.
   *
   * These are distances, not probabilities, and they are stated rather than
   * tuned: inside the reported or warned area is the only case where the
   * record itself places the hazard at this place, so it is the only case that
   * can reach the top of the scale on containment alone. The rest is
   * proximity, which falls off with distance and says so.
   */
  var NEAR_KM = 50;         // an incident this close is the place's own event
  var MODERATE_KM = 150;    // near enough to be affected by the same system
  /* Beyond that, out to riskRow's own 500 km horizon, it is context. */

  /** Every record that has anything to say about this place, nearest first. */
  function rowsFor(place, events) {
    var H = hazards();
    var out = [];
    if (!H || !place) return out;
    (events || []).forEach(function (e) {
      var r = H.riskRow(e, place);
      if (!r) return;
      out.push({ e: e, r: r, d: r.distanceKm === null ? Infinity : r.distanceKm });
    });
    /* Band first - the bands are an evidence order, not a display order - then
       whichever is nearest within the band. */
    var rank = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    out.sort(function (p, q) {
      return (rank[p.r.band] - rank[q.r.band]) || (p.d - q.d);
    });
    return out;
  }

  /** The level a record itself carries, where it carries one. */
  function ownLevel(e) {
    var R = risk();
    if (!R) return null;
    var k = R.levelOf((e && (e.alert || e.severity)) || '');
    return k === 'UNKNOWN' ? null : k;
  }

  function atLeast(a, b) {
    var R = risk();
    if (!R) return a || b;
    if (!a) return b;
    if (!b) return a;
    return R.BY_KEY[a].rank >= R.BY_KEY[b].rank ? a : b;
  }

  /*
   * The answer for one place: a level, the sentence that justifies it, and the
   * record it came from.
   *
   * `level` is null rather than LOW where nothing was found, because this
   * project cannot establish that a place is at low risk - only that it holds
   * no qualifying record for it right now.
   */
  function assess(place, events, meta) {
    var rows = rowsFor(place, events);
    var R = risk();
    var m = meta || {};
    var out = {
      place: place, rows: rows, level: null, lead: null,
      headline: 'No verified current hazard',
      why: '', checkedAt: m.generatedAt || null,
      searchedKm: (hazards() && hazards().RISK_RADIUS_KM) || 500
    };

    /* Inside a published warning area: the issuing agency's own geometry puts
       this place inside it, which is the strongest thing this project can say
       about a location. */
    var insideWarning = rows.filter(function (x) { return x.r.band === 'B' && x.r.containment === true; })[0];
    var insideIncident = rows.filter(function (x) { return x.r.band === 'A' && x.r.containment === true; })[0];
    var nearest = rows.filter(function (x) { return x.r.band === 'A' && x.r.claimDistance && isFinite(x.d); })
      .sort(function (p, q) { return p.d - q.d; })[0];
    var outlook = rows.filter(function (x) { return x.r.band === 'C'; })[0];

    if (insideWarning) {
      out.lead = insideWarning;
      out.level = atLeast('HIGH', ownLevel(insideWarning.e));
      out.why = 'Your place is inside the area an authority published for this warning, tested against that ' +
        'published area rather than against a distance.';
    } else if (insideIncident) {
      out.lead = insideIncident;
      out.level = atLeast('HIGH', ownLevel(insideIncident.e));
      out.why = 'Your place is inside the affected area reported for this event.';
    } else if (nearest && nearest.d <= NEAR_KM) {
      out.lead = nearest;
      out.level = 'HIGH';
      out.why = 'A hazard reported at an incident location is ' + Math.round(nearest.d) +
        ' km from your place. That is a distance between two points, not a statement that the ' +
        'affected area reaches you.';
    } else if (nearest && nearest.d <= MODERATE_KM) {
      out.lead = nearest;
      out.level = 'MODERATE';
      out.why = 'The nearest hazard reported at an incident location is ' + Math.round(nearest.d) +
        ' km from your place.';
    } else if (outlook) {
      out.lead = outlook;
      out.level = 'WATCH';
      out.why = 'A forecast window this project is watching covers your place. ' +
        'This is not a report that anything has happened, and it is not an official warning.';
    } else if (nearest) {
      out.lead = nearest;
      out.level = 'WATCH';
      out.why = 'The nearest hazard reported at an incident location is ' + Math.round(nearest.d) +
        ' km from your place, which is inside the ' + out.searchedKm + ' km this page searches but ' +
        'far enough that it is context rather than a hazard to this place.';
    }

    if (out.level && R) out.headline = R.BY_KEY[out.level].label;

    if (!out.level) {
      /* Said in terms of what was actually looked at. An area-level record is
         not nothing, and it is not a hazard at this place either. */
      var areaOnly = rows.filter(function (x) { return x.r.band === 'D'; }).length;
      out.why = 'Nothing this project holds places a hazard at this location right now. ' +
        (areaOnly
          ? areaOnly + ' record(s) within ' + out.searchedKm + ' km mark an area rather than an incident, ' +
            'so whether this place falls inside any of them has not been established. '
          : 'No record with an incident-level coordinate sits within ' + out.searchedKm + ' km. ') +
        'That is what this project can see, not a statement that this place is safe: ' +
        'your national and local hazard agencies hold the authoritative record for it.';
    }
    return out;
  }

  /*
   * What to do about it.
   *
   * Deliberately generic and deliberately short. This project does not know a
   * reader's building, their mobility, their local plan or their evacuation
   * route, and an instruction that sounded specific would be invented. The
   * one thing it can always say correctly is who to listen to.
   */
  var AUTHORITY_LINE = 'Follow instructions from the issuing authority and local emergency services. ' +
    'Nothing on this page replaces an official instruction.';

  function actionsFor(assessment) {
    var a = assessment || {};
    var steps = [];
    var lead = a.lead && a.lead.e;
    var official = lead && (lead.evidenceState === 'official-warning');
    if (!a.level) {
      steps.push('Nothing here needs action right now.');
      steps.push('Check your national or local hazard agency for this place, which holds the authoritative record.');
      steps.push('Save the place to have it re-checked whenever this page is open.');
      return { steps: steps, authority: AUTHORITY_LINE, official: false };
    }
    if (official) {
      steps.push('An authority has a warning in force covering this place. Read the warning itself, linked below, and do what it says.');
    } else if (a.level === 'WATCH' && a.lead && a.lead.r.band === 'C') {
      steps.push('Nothing has been reported to have happened. This is a window being watched, so treat it as a reason to check official forecasts rather than to act.');
    } else {
      steps.push('Check whether your local authority has issued an instruction for this place. This page reports what providers publish; it does not receive local orders.');
    }
    if (a.level === 'HIGH' || a.level === 'SEVERE' || a.level === 'EXTREME') {
      steps.push('Do not travel into the affected area, and follow any evacuation or shelter instruction already given locally.');
      steps.push('Keep the authority’s own channel open. Its instruction is current; this page is as current as the last provider update shown.');
    } else {
      steps.push('Keep an eye on the source record below, and on your local agency, rather than on this summary alone.');
    }
    return { steps: steps, authority: AUTHORITY_LINE, official: !!official };
  }

  var P = { rowsFor: rowsFor, assess: assess, actionsFor: actionsFor,
    NEAR_KM: NEAR_KM, MODERATE_KM: MODERATE_KM, AUTHORITY_LINE: AUTHORITY_LINE };
  if (typeof window !== 'undefined') window.PNDPlaceRisk = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})();
