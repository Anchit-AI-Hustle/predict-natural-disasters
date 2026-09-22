/* The verdict vocabulary, in one place.
 *
 * The verification ledger and the page that reports it grew two different
 * spellings for the same verdicts. The ledger writes MISS_FALSE_POSITIVE and
 * FALSE_NEGATIVE_UNPREDICTED_EVENT; the page bucketed on FALSE_ALARM and
 * MISSED_EVENT. Nothing matched either bucket, so over a ledger recording one
 * partial verification, five false alarms and two missed events, the page
 * published: false alarms 0, missed events 0, severe-event recall 100%.
 *
 * An unrecognised verdict is therefore never silently bucketed here. It is
 * returned as UNKNOWN, counted, and surfaced — a test fails if the ledgers
 * contain one, which is what would have caught the original defect.
 */
/* Wrapped, because a top-level const in a classic script becomes a global
   binding: an unwrapped `const V` here collided with the same name in a
   page's own inline script and killed that script outright. */
(function(){
const VERDICTS = {
  VERIFIED:                         'VERIFIED',
  PARTIAL_VERIFICATION:             'PARTIAL',
  PARTIAL:                          'PARTIAL',
  FALSE_ALARM:                      'FALSE_ALARM',
  MISS_FALSE_POSITIVE:              'FALSE_ALARM',
  MISSED_EVENT:                     'MISSED',
  FALSE_NEGATIVE_UNPREDICTED_EVENT: 'MISSED',
  COVERAGE_FAILURE:                 'COVERAGE_FAILURE',
  PENDING:                          'PENDING'
};

/* What a reader is actually asking: did the thing happen? */
const OCCURRED = {
  VERIFIED:         'Yes',
  PARTIAL:          'Partly',
  FALSE_ALARM:      'No',
  MISSED:           'Yes — but nothing predicted it',
  COVERAGE_FAILURE: 'Yes — outside what was scanned',
  OPEN:             'Too early to say',
  AWAITING:         'Not yet checked',
  UNKNOWN:          'Unrecognised verdict'
};

const LABELS = {
  VERIFIED:         'Verified prediction',
  PARTIAL:          'Partially verified',
  FALSE_ALARM:      'False alarm',
  MISSED:           'Missed event',
  COVERAGE_FAILURE: 'Coverage failure',
  OPEN:             'Window still open',
  AWAITING:         'Awaiting verification',
  UNKNOWN:          'Unrecognised verdict'
};

const CSS = {
  VERIFIED:'verified', PARTIAL:'partial', FALSE_ALARM:'alarm', MISSED:'missed',
  COVERAGE_FAILURE:'coverage', OPEN:'open', AWAITING:'awaiting', UNKNOWN:'unknown'
};

function normalise(status) {
  const s = String(status == null ? '' : status).trim().toUpperCase();
  if (!s) return '';
  return VERDICTS[s] || 'UNKNOWN';
}

/* A record's state, which is not the same as its verdict: a prediction whose
   window has not closed cannot be judged, and one whose window closed without
   anyone grading it is not a pass. Those two were previously both "PENDING",
   so 142 unchecked matured predictions read as if they were simply too new. */
function stateOf(record, now) {
  const r = record || {};
  const graded = normalise(r.status || r.outcome);
  if (graded && graded !== 'PENDING') return graded;
  const end = Date.parse(r.targetEnd || '');
  if (!Number.isFinite(end)) return 'AWAITING';
  return end > (now == null ? Date.now() : now) ? 'OPEN' : 'AWAITING';
}

/* The hazard model, wherever this file is running. The page loads it as a
   script; node requires it. Looked up when asked rather than at load time,
   because in the browser this file is parsed before it. */
function hazards() {
  if (typeof PNDHazards !== 'undefined' && PNDHazards) return PNDHazards;
  if (typeof globalThis !== 'undefined' && globalThis.PNDHazards) return globalThis.PNDHazards;
  if (typeof require === 'function') {
    try { return require('./hazard-model.js'); } catch (e) { /* not available here */ }
  }
  return null;
}

/* What kind of forecast a ledger row holds.
 *
 * Rows written before the taxonomy existed carry only forecastKind, so the
 * class is derived on read rather than written back: the ledger is
 * append-only and a recorded claim is not edited to suit a later scheme.
 *
 * An unclassifiable row returns null and counts toward no headline. Being
 * unable to establish that a forecast came first is exactly the case that
 * must not be credited as one that did.
 */
function forecastClassOf(r) {
  if (r && r.forecastClass) return r.forecastClass;
  const H = hazards();
  if (!H || !H.classifyForecast) return null;
  const c = H.classifyForecast(Object.assign({ forecast: true }, r || {}));
  return c ? c.forecastClass : null;
}

/* May this record count toward a headline "we predicted this" figure? */
function headlineEligible(r) {
  const H = hazards(), k = forecastClassOf(r);
  if (!k || !H || !H.FORECAST_CLASSES) return false;
  const def = H.FORECAST_CLASSES[k];
  return !!(def && def.headline);
}

/* The same records split by what they are allowed to claim. Conditional
   forecasts are graded too - they are simply graded under their own name. */
function partitionByClass(records) {
  const out = { headline: [], conditional: [], unclassified: [], byClass: {} };
  for (const r of records || []) {
    /* An observed event with no forecast behind it is a miss, not a forecast;
       it belongs to recall on both sides of the split. */
    const isForecastRow = !!(r && (r.targetStart || r.targetEnd || r.forecastKind || r.forecastClass));
    const k = isForecastRow ? forecastClassOf(r) : null;
    if (k) (out.byClass[k] = out.byClass[k] || []).push(r);
    if (!isForecastRow) { out.headline.push(r); out.conditional.push(r); continue; }
    if (!k) out.unclassified.push(r);
    else if (headlineEligible(r)) out.headline.push(r);
    else out.conditional.push(r);
  }
  return out;
}

/* Counts, plus every rate with the denominator it was computed from. A rate
   printed without its denominator hides that it came from three records. */
function tally(records, now) {
  const t = { total: 0, open: 0, awaiting: 0, verified: 0, partial: 0,
    falseAlarm: 0, missed: 0, coverageFailure: 0, unknown: 0, matured: 0 };
  const at = now == null ? Date.now() : now;
  for (const r of records || []) {
    t.total++;
    const s = stateOf(r, at);
    const end = Date.parse((r && r.targetEnd) || '');
    if (Number.isFinite(end) && end <= at) t.matured++;
    if (s === 'OPEN') t.open++;
    else if (s === 'AWAITING') t.awaiting++;
    else if (s === 'VERIFIED') t.verified++;
    else if (s === 'PARTIAL') t.partial++;
    else if (s === 'FALSE_ALARM') t.falseAlarm++;
    else if (s === 'MISSED') t.missed++;
    else if (s === 'COVERAGE_FAILURE') t.coverageFailure++;
    else t.unknown++;
  }
  t.graded = t.verified + t.partial + t.falseAlarm;
  /* Precision: of the predictions actually judged, how many happened. The
     denominator is the graded predictions, never the 324 recorded ones. */
  t.precision = rate(t.verified + t.partial, t.graded);
  /* Recall: of the significant events known to have occurred, how many had a
     prediction. Missed events are the ones that had none. */
  t.recall = rate(t.verified + t.partial,
    t.verified + t.partial + t.missed + t.coverageFailure);
  return t;
}

function rate(hit, total) {
  if (!total) return { text: 'Not enough graded records', hit, total, pct: null };
  return { text: Math.round(hit / total * 100) + '% (' + hit + ' of ' + total + ')',
    hit, total, pct: Math.round(hit / total * 100) };
}

/* What the ledger froze: exactly the fields tools/record-outlooks.js writes.
   A verdict may add to a record but never change any of these. */
const CLAIM_FIELDS = ['id', 'type', 'title', 'country', 'admin1', 'region',
  'lat', 'lon', 'alert', 'severity', 'severityRank', 'issuedAt', 'sourceIssuedAt',
  'targetStart', 'targetEnd', 'forecastKind', 'forecastClass',
  'classificationReason', 'effectiveForecastStart', 'freezeTimestamp',
  'freezeBasis', 'forecastOf', 'source', 'sourceUrl',
  'confidence', 'evidence', 'verificationRule'];

/* Attaching a verdict to the window it judged.
 *
 * The outlook ledger is append-only and re-records a rolling outlook each time
 * it is re-issued, so one id can hold many windows: OUT-gdacs-WF-1031965 has
 * three, covering 14-17, 15-18 and 18-21 September. A verdict names one of
 * them. Joining on the id alone therefore stamped a single false-alarm verdict
 * onto all three windows and turned five graded false alarms into nine.
 *
 * So an exact window match wins. Where the ledger disagrees with the verdict
 * about the window — ND-001's two records are 17 hours apart, the frozen
 * benchmark having been written by hand in local time — the verdict is still
 * attached, but only when that id has exactly one window and the attachment is
 * therefore unambiguous. Anything left over is returned in `unattached`
 * rather than dropped, so a verdict can never quietly stop counting.
 */
/* The whole window, not just its start: a rolling outlook reissued with the
   same start and a revised end would otherwise collapse onto one key, and the
   merge would apply one verdict to both rows — the multi-window misgrading
   this helper exists to prevent. */
function windowKey(r) {
  const a = Date.parse((r && r.targetStart) || '');
  const b = Date.parse((r && r.targetEnd) || '');
  return (r && r.id) + '@' + (Number.isFinite(a) ? a : '') +
    '..' + (Number.isFinite(b) ? b : '');
}

function joinVerdicts(rows, verifications) {
  const byWindow = new Map();
  const countsById = new Map();
  for (const r of rows || []) {
    byWindow.set(windowKey(r), r);
    countsById.set(r.id, (countsById.get(r.id) || 0) + 1);
  }
  const attached = new Map();
  const unattached = [];
  for (const v of verifications || []) {
    const exact = byWindow.get(windowKey(v));
    if (exact) { attached.set(windowKey(exact), v); continue; }
    if (countsById.get(v.id) === 1) {
      const only = (rows || []).find(r => r.id === v.id);
      if (only) { attached.set(windowKey(only), v); continue; }
    }
    unattached.push(v);
  }
  const merged = (rows || []).map(r => {
    const v = attached.get(windowKey(r));
    if (!v) return r;
    /* The ledger row is the frozen claim; the verdict is what was found
       afterwards. Spreading the verdict over the row let it rewrite the claim
       it was judging: ND-001's frozen area is the Hu\u1ebf\u2013\u0110\u00e0 N\u1eb5ng corridor, and the
       verdict's wider "Hue\u2013Da Nang\u2013Quang Ngai corridor" was then displayed as
       what had been predicted. Every claim field is restored from the row, so
       a verdict can only ever add the outcome. */
    const out = Object.assign({}, r, v);
    for (const f of CLAIM_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(r, f)) out[f] = r[f];
      else delete out[f];
    }
    return out;
  });
  return { records: merged, unattached };
}

const V = { VERDICTS, OCCURRED, LABELS, CSS, normalise, stateOf, tally, rate,
  windowKey, joinVerdicts, CLAIM_FIELDS,
  forecastClassOf, headlineEligible, partitionByClass };
if (typeof window !== 'undefined') window.PNDVerdicts = V;
if (typeof module !== 'undefined' && module.exports) module.exports = V;
})();
