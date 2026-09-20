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
function windowKey(r) {
  const t = Date.parse((r && r.targetStart) || '');
  return (r && r.id) + '@' + (Number.isFinite(t) ? t : '');
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
    return v ? Object.assign({}, r, v, { targetStart: r.targetStart, targetEnd: r.targetEnd }) : r;
  });
  return { records: merged, unattached };
}

const V = { VERDICTS, OCCURRED, LABELS, CSS, normalise, stateOf, tally, rate,
  windowKey, joinVerdicts };
if (typeof window !== 'undefined') window.PNDVerdicts = V;
if (typeof module !== 'undefined' && module.exports) module.exports = V;
})();
