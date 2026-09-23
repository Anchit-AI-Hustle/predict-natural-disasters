#!/usr/bin/env node
'use strict';
/**
 * Append newly-seen outlooks to the forecast ledger.
 *
 * Outlooks are computed from the live feed on every request, so without this
 * they exist only for as long as the signal behind them stays in the upstream
 * window. Nothing was ever written down, which is why nothing could ever be
 * graded: a forecast that is recomputed on every page load cannot be right or
 * wrong.
 *
 * The ledger is append-only and lives in git, so the record of what was
 * forecast and when is auditable and tamper-evident by construction — a better
 * fit for a verification record than a mutable store.
 *
 *   node tools/record-outlooks.js <events.json> <ledger.json>
 *
 * Exits 0 whether or not anything was added; the caller checks git for a diff.
 */
const fs = require('fs');
const path = require('path');
/* Same classifier the API and the pages use, so the ledger cannot drift into
   its own opinion of what a forecast is. */
let HAZARDS = null;
try { HAZARDS = require(path.join(__dirname, '..', 'hazard-model.js')); }
catch (e) { HAZARDS = null; }

const [, , eventsPath, ledgerPath] = process.argv;
if (!eventsPath || !ledgerPath) {
  console.error('usage: record-outlooks.js <events.json> <ledger.json>');
  process.exit(2);
}

const feed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const events = Array.isArray(feed.events) ? feed.events : [];
/* Which scan's snapshot this forecast was derived from.
 *
 * A continuation outlook is derived from a hazard in this very feed, so the
 * same snapshot's record of that hazard cannot be evidence that it carried on
 * afterwards. Naming the scan lets the verifier tell the forecast's own
 * source from a later observation of the same disaster. */
const sourceScanId = ((feed.meta || {}).scan || {}).scanId || null;

let ledger = [];
try {
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (Array.isArray(raw)) ledger = raw;
} catch (e) { /* first run: start empty */ }

/**
 * An outlook is identified by every term it is graded on, not by its id and
 * the moment its window opens.
 *
 * When the signal behind it is updated the window moves with it, and that is
 * a new claim about a new period — separately gradeable, not an edit of the
 * old one. The same is true of the rest: a window that now ends eight days
 * later, or a geography that has moved to another country, is a different
 * claim under the same id, and recording nothing for it leaves the revised
 * terms with no immutable row while the feed serves them under the original
 * row's freeze. HAZARDS.claimKey is that identity, shared with the API so the
 * two cannot drift into different ideas of what a claim is.
 */
const key = o => (HAZARDS && HAZARDS.claimKey)
  ? HAZARDS.claimKey(o)
  : String(o.id) + '@' + String(o.targetStart);
const seen = new Set(ledger.map(key));
/* Ids the ledger already holds a claim for, under any terms. */
const recordedIds = new Set(ledger.map(r => r && r.id));

const FIELDS = ['id', 'type', 'title', 'country', 'admin1', 'region', 'lat', 'lon',
  'alert', 'severity', 'severityRank', 'issuedAt', 'sourceIssuedAt', 'targetStart',
  'targetEnd', 'forecastKind', 'forecastClass', 'forecastScope', 'classificationReason',
  'effectiveForecastStart', 'forecastOf', 'source', 'sourceUrl', 'confidence',
  'evidence', 'verificationRule'];

/*
 * forecastScope is recorded from here on and is deliberately NOT backfilled.
 *
 * The 490 rows written before it existed never carried a scope, so there is
 * nothing to restore. It could be guessed from the country field, but a guess
 * that turns a corridor into a whole country is exactly the retrospective
 * widening of geography this project refuses: the frozen benchmark names the
 * Hue-Da Nang corridor and also names Vietnam. Without a recorded scope those
 * rows are graded on distance against the published tolerance, which is the
 * narrower reading and the one that cannot flatter the record.
 */
const recordedAt = new Date().toISOString();
/* The signal a derived outlook came from, needed to tell a forecast derived
   from an official warning apart from one derived from an observation. */
const byId = new Map(events.map(e => [e.id, e]));
const added = [];

for (const e of events) {
  if (!e || !e.forecast) continue;
  if (!e.targetStart || !e.targetEnd) continue;
  if (seen.has(key(e))) continue;
  seen.add(key(e));
  const row = { recordedAt };
  for (const f of FIELDS) if (e[f] !== undefined) row[f] = e[f];
  /* Writing this row is itself the proof that the forecast existed, so unless
     the feed can already point at something earlier in the repository - the
     commit behind a hand-frozen record - this row's own timestamp is the
     freeze. Taking the earlier of the two keeps the ledger consistent with
     what the repository can show, rather than with when the job happened to
     run. Once written it is never revisited: rows already present are not
     touched by this tool. */
  const claimed = Date.parse(e.freezeTimestamp || '');
  /* An id already in the ledger under other terms is a revision, and nothing
     earlier than this row can be evidence for terms that are only now being
     written down: whatever the feed cites - the commit behind a hand-frozen
     record - froze the earlier terms, and the ledger already holds those.
     Taking it anyway is how a scope added to ND-001 nine days after its
     commit was recorded as frozen at that commit. */
  const revision = recordedIds.has(e.id);
  const evidenced = !revision && e.freezeEvidenced === true &&
    Number.isFinite(claimed) && claimed < Date.parse(recordedAt);
  row.freezeTimestamp = evidenced ? e.freezeTimestamp : recordedAt;
  row.freezeBasis = evidenced
    ? (e.freezeBasis || 'Earlier repository record carried by the feed.')
    : revision
      ? 'Revised terms of a forecast the ledger already records; these terms are proven only from this row.'
      : 'First row recorded for this forecast in the append-only ledger.';
  /* The feed worked from a freeze that had not happened yet - this row is the
     thing that makes it happen - so the class and the effective window are
     settled here, against the row as it is about to be written. Otherwise a
     row could carry a window start a few milliseconds before the timestamp it
     stores as its own proof, and a verifier reading the ledger alone would
     find it inconsistent with itself. */
  if (sourceScanId) row.sourceScanId = sourceScanId;
  if (HAZARDS) {
    row.freezeEvidenced = true;
    /* The row is built from FIELDS, which carries what a forecast says and
       not the marker that it is one, so classifying the row itself answered
       null every time and this whole block quietly did nothing: a forecast
       the feed had called invalid-post-event - which is what the feed must
       call it, having no freeze yet - kept that class for ever, even though
       writing this row is precisely the proof that it existed first. The
       marker is supplied here, as the pages and the API already do. */
    const c = HAZARDS.classifyForecast(Object.assign({ forecast: true }, row),
      byId.get(row.forecastOf));
    if (c) { row.forecastClass = c.forecastClass; row.classificationReason = c.classificationReason; }
    const start = HAZARDS.effectiveForecastStart(row);
    if (start) row.effectiveForecastStart = start;
  }
  // Graded later, once the window has closed and evidence can be gathered.
  row.outcome = null;
  added.push(row);
}

if (!added.length) {
  console.log('ledger: no new outlooks (' + ledger.length + ' recorded)');
  process.exit(0);
}

const next = ledger.concat(added)
  .sort((a, b) => String(a.targetStart).localeCompare(String(b.targetStart))
    || String(a.id).localeCompare(String(b.id)));

fs.writeFileSync(ledgerPath, JSON.stringify(next, null, 2) + '\n');
console.log('ledger: recorded ' + added.length + ' new outlook(s), ' + next.length + ' total');
for (const a of added) console.log('  + ' + a.id + ' ' + a.targetStart + ' → ' + a.targetEnd);
