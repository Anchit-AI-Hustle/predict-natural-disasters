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
    if (typeof window !== 'undefined' && window.PNDRisk) return window.PNDRisk;
    try { return typeof require === 'function' ? require('./risk.js') : null; } catch (e) { return null; }
  }
  function hazards() {
    if (typeof window !== 'undefined' && window.PNDHazards) return window.PNDHazards;
    try { return typeof require === 'function' ? require('./hazard-model.js') : null; } catch (e) { return null; }
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

  /*
   * The level a record itself carries, where it carries one, read the way its
   * risk badge reads it (PND.riskTag): the severity the feed computed first,
   * since that is already the graver of the reported impact and the issuer's
   * alert, and the alert only where there is no severity. Reading the alert
   * first rated a Green-alert event the feed had computed Extreme from its
   * reported deaths as if it were routine, and disagreed with the badge on
   * the same event.
   */
  function ownLevel(e) {
    var R = risk();
    if (!R || !e) return null;
    var s = R.levelOf(e.severity || '');
    var k = s !== 'UNKNOWN' ? s : R.levelOf(e.alert || '');
    return k === 'UNKNOWN' ? null : k;
  }

  function rankOf(k) { var R = risk(); return (R && k && R.BY_KEY[k]) ? R.BY_KEY[k].rank : 0; }

  /*
   * How much a nearby event matters to a place: its own level, lowered with
   * distance. The distance alone used to decide it, so a magnitude-2.8
   * tremor 30 km away - a routine detection nobody felt - made a place
   * "High risk", the same as a red-alert flood next door.
   */
  function nearLevel(e, km) {
    var own = ownLevel(e), r = rankOf(own);
    if (km <= NEAR_KM) return r >= rankOf('MODERATE') ? own : 'WATCH';
    if (km <= MODERATE_KM) return r >= rankOf('HIGH') ? own : r >= rankOf('MODERATE') ? 'WATCH' : 'LOW';
    return r >= rankOf('HIGH') ? 'WATCH' : 'LOW';
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
      /* The nearest-ranked reported event and the forecast that covers the
         place, whichever of them leads: a page that shows the answer can say
         both rather than only the one that set the level. */
      observed: null, forecast: null,
      headline: 'Nothing reported nearby',
      why: '', checkedAt: m.generatedAt || null,
      searchedKm: (hazards() && hazards().RISK_RADIUS_KM) || 500
    };

    /* Inside a published warning area: the issuing agency's own geometry puts
       this place inside it, which is the strongest thing this project can say
       about a location. */
    var insideWarning = rows.filter(function (x) { return x.r.band === 'B' && x.r.containment === true; })[0];
    var insideIncident = rows.filter(function (x) { return x.r.band === 'A' && x.r.containment === true; })[0];
    /* The event that matters most here, not merely the nearest: a red-alert
       flood 40 km away outranks a routine tremor at 20 km. */
    var ranked = rows.filter(function (x) { return x.r.band === 'A' && x.r.claimDistance && isFinite(x.d); })
      .map(function (x) { return { x: x, lvl: nearLevel(x.e, x.d) }; })
      .sort(function (p, q) { return (rankOf(q.lvl) - rankOf(p.lvl)) || (p.x.d - q.x.d); });
    var top = ranked[0] || null;
    var nearest = top && top.x;
    var outlook = rows.filter(function (x) { return x.r.band === 'C'; })[0];

    /*
     * What was reported and what we forecast, weighed against each other.
     *
     * The forecast branch used to win whenever no report reached Watch on its
     * own, and said nothing else: Tokyo read "Watch · one of our forecasts
     * covers it" while a confirmed M5.5 85 km away was listed under it. Now
     * the stronger of the two decides, a report wins a tie (it happened; a
     * forecast is our estimate), and whichever does not lead is still named.
     */
    var forecastLeads = !!outlook && !(top && rankOf(top.lvl) >= rankOf('WATCH'));
    if (outlook) out.forecast = outlook;
    if (top) out.observed = nearest;

    if (insideWarning) {
      out.lead = insideWarning;
      out.level = atLeast('HIGH', ownLevel(insideWarning.e));
      out.why = 'Your place is inside the area covered by an official warning. We checked this against the ' +
        'warning area the agency published, not just the distance.';
    } else if (insideIncident) {
      out.lead = insideIncident;
      out.level = atLeast('MODERATE', ownLevel(insideIncident.e));
      out.why = 'Your place is inside the area reported as affected by this event.';
    } else if (top && top.x.d <= MODERATE_KM && rankOf(top.lvl) > rankOf('LOW')) {
      out.lead = nearest;
      out.level = top.lvl;
      out.why = 'An event was reported ' + Math.round(nearest.d) + ' km from your place. ' +
        'That is the distance between two points. It does not mean the affected area reaches you.' +
        (outlook ? ' One of our forecasts also covers your place.' : '');
    } else if (forecastLeads) {
      out.lead = outlook;
      out.level = 'WATCH';
      out.why = 'One of our forecasts covers your place. It is our own estimate of what may happen. ' +
        'It is not a report that something has happened, and it is not an official warning.' +
        (top ? ' A reported event, ' + String(nearest.e.title || nearest.e.type || 'an event').replace(/[.\s]+$/, '') +
          ', is ' + Math.round(nearest.d) + ' km away. On its own it rates ' +
          ((R && R.BY_KEY[top.lvl] && R.BY_KEY[top.lvl].label) || 'Low') + ' here.' : '');
    } else if (top) {
      out.lead = nearest;
      out.level = top.lvl;
      out.why = nearest.d <= MODERATE_KM
        ? 'A minor event was reported ' + Math.round(nearest.d) + ' km from your place.'
        : 'The most serious event near your place is ' + Math.round(nearest.d) + ' km away. ' +
          'We look up to ' + out.searchedKm + ' km away, so it is shown, but it is far from this place.' +
          (outlook ? ' One of our forecasts also covers your place.' : '');
    }

    if (out.level && R) out.headline = R.BY_KEY[out.level].label;

    if (!out.level) {
      /* Said in terms of what was actually looked at. An area-level record is
         not nothing, and it is not a hazard at this place either. */
      var areaOnly = rows.filter(function (x) { return x.r.band === 'D'; }).length;
      out.why = 'Nothing we track shows a danger at this place right now. ' +
        (areaOnly
          ? (areaOnly === 1 ? '1 report' : areaOnly + ' reports') + ' within ' + out.searchedKm +
            ' km give only the centre of a wider area, so we cannot tell whether this place is inside ' +
            (areaOnly === 1 ? 'it' : 'them') + '. '
          : 'No event with an exact location has been reported within ' + out.searchedKm + ' km. ') +
        'This does not mean the place is safe. Your national and local disaster agencies have the official information.';
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
    'Nothing on this page replaces official instructions.';

  function actionsFor(assessment) {
    var a = assessment || {};
    var steps = [];
    var lead = a.lead && a.lead.e;
    var official = lead && (lead.evidenceState === 'official-warning');
    if (!a.level) {
      steps.push('You do not need to do anything because of this page right now.');
      steps.push('For official information about this place, check your national or local disaster agency.');
      steps.push('Save the place so it is checked again each time you open this site.');
      return { steps: steps, authority: AUTHORITY_LINE, official: false };
    }
    if (official) {
      steps.push('An official warning covers this place. Read the warning (linked below) and follow it.');
    } else if (a.level === 'WATCH' && a.lead && a.lead.r.band === 'C') {
      steps.push('Nothing has happened yet. This is only our forecast, so check your official weather or disaster service before you act.');
    } else {
      steps.push('Check whether your local authorities have given instructions for this place. This page shows what agencies publish. It does not receive local orders.');
    }
    if (a.level === 'HIGH' || a.level === 'SEVERE' || a.level === 'EXTREME') {
      steps.push('Do not travel into the affected area. Follow any evacuation or shelter instructions given locally.');
      steps.push('Keep following the official agency’s updates. Their instructions are the most current. This page is only as current as the last update shown.');
    } else {
      steps.push('Keep an eye on the source (linked below) and on your local agency, not only on this summary.');
    }
    return { steps: steps, authority: AUTHORITY_LINE, official: !!official };
  }

  /*
   * Before there is a feed to answer from (C26).
   *
   * assess() on an empty list says "Nothing reported nearby", which is true
   * only of a feed that loaded. Asked while the first load is still in flight,
   * or after it failed, that read as an all-clear for the reader's own place
   * while the site knew nothing at all. Every place answer asks feedState()
   * first and shows these words, in the unknown style, until the data
   * arrives; then it answers again by itself.
   *
   * `loaded` is whether any feed has loaded on this page; `failed` whether
   * the last attempt failed. A later failed refresh keeps the last answer,
   * as the rest of the page keeps its last figures.
   */
  function feedState(loaded, failed) { return loaded ? 'loaded' : failed ? 'failed' : 'loading'; }
  var PENDING = {
    loading: { headline: 'Checking…', text: 'Checking the latest reports for this place.',
      lastChecked: 'not yet: the data is still loading' },
    failed: { headline: 'Live data unavailable',
      text: 'We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.',
      lastChecked: 'not yet: the latest data could not be loaded' }
  };
  /* The one step that holds with no data: who to ask. */
  var PENDING_STEP = 'For official information about this place, check your national or local disaster agency.';

  var P = { rowsFor: rowsFor, assess: assess, actionsFor: actionsFor,
    feedState: feedState, PENDING: PENDING, PENDING_STEP: PENDING_STEP,
    NEAR_KM: NEAR_KM, MODERATE_KM: MODERATE_KM, AUTHORITY_LINE: AUTHORITY_LINE };
  if (typeof window !== 'undefined') window.PNDPlaceRisk = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})();
