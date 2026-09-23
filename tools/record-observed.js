#!/usr/bin/env node
'use strict';
/**
 * Maintain the canonical ledger of significant observed disasters.
 *
 * Recall — "of the disasters that happened, how many did anything forecast?" —
 * needs a denominator of real-world events, and this project had none. It had
 * a feed of provider records in which one flood arrives as a GDACS alert, a
 * ReliefWeb country declaration and sometimes an EONET entry. Three records is
 * not three disasters.
 *
 *   node tools/record-observed.js <events.json> <observed-disasters.json>
 *
 * What an event IS is frozen the first time it is recorded: its canonical id,
 * hazard, onset, and the geography it was first seen at. What is still being
 * learned about it is not frozen — death tolls rise for days after a
 * disaster, and a ledger that refused the later figure would be preserving an
 * early guess, not an original claim. So impact, end, evidence and confidence
 * may be updated, and every update is appended to that event's `revisions`
 * with the field, the old value and the new one, so no figure can change
 * without a trace.
 *
 * Exits 0 whether or not anything changed; the caller checks git for a diff.
 */
const fs = require('fs');
const path = require('path');
const OBS = require(path.join(__dirname, '..', 'observed-model.js'));

const [, , eventsPath, ledgerPath] = process.argv;
if (!eventsPath || !ledgerPath) {
  console.error('usage: record-observed.js <events.json> <observed-disasters.json>');
  process.exit(2);
}

const feed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const events = Array.isArray(feed.events) ? feed.events : [];
const now = new Date().toISOString();

let ledger = { schemaVersion: 1, events: [] };
try {
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (raw && Array.isArray(raw.events)) ledger = raw;
} catch (e) { /* first run */ }

/*
 * Only observations, and a warning is not one.
 *
 * Excluding forecasts was not enough. A National Weather Service alert has
 * evidenceState 'official-warning' and carries a red or orange level, so it
 * cleared the significance bar and was recorded as a disaster that happened -
 * when what it actually says is that severe weather is expected. An
 * unmaterialised warning sitting in this ledger inflates the recall
 * denominator and manufactures false negatives against forecasts that had
 * nothing to miss.
 *
 * A warning that does materialise is reported by an observing provider too,
 * and that record is what belongs here.
 */
/*
 * When this disaster was being carried by its providers, as runs rather than
 * a single latest timestamp.
 *
 * lastSeenAt was overwritten on every run, so the first cycle after an
 * outlook's window closed destroyed the evidence that the disaster had been
 * in the feed throughout it: the verifier then saw one timestamp, dated after
 * the window, and could grade the outlook neither way. A record that was
 * observed on every scan inside its window became "no evidence either way",
 * which is the opposite of what the ledger had just watched happen.
 *
 * Consecutive sightings are joined into one run while they are close enough
 * together to be continuous watching - the same six hours the coverage model
 * uses, and for the same reason - so the list is bounded by the number of
 * real gaps rather than by the number of runs.
 */
const SIGHTING_GAP_HOURS = 6;

function noteSighting(row, at) {
  const t = Date.parse(at);
  if (!Array.isArray(row.sightings)) {
    /* A row written before this existed still knows two moments. */
    row.sightings = [{ from: row.firstRecordedAt || row.lastSeenAt || at,
      to: row.lastSeenAt || at }];
  }
  const last = row.sightings[row.sightings.length - 1];
  const lastTo = Date.parse(last && last.to);
  if (last && Number.isFinite(lastTo) && t - lastTo <= SIGHTING_GAP_HOURS * 3600e3) last.to = at;
  else row.sightings.push({ from: at, to: at });
  row.lastSeenAt = at;
}

const observed = events.filter(e => e && !e.forecast && e.evidenceState === 'observed');
/* What was left out, and under which evidence state, so that the exclusion is
   auditable rather than silent. Today that is warnings; if an observing
   provider ever arrived classified as something else, its records would be
   dropped here too, and this count is what would show it. */
const notObservations = events.reduce((m, e) => {
  if (!e || e.forecast || e.evidenceState === 'observed') return m;
  const k = e.evidenceState || 'unstated';
  m[k] = (m[k] || 0) + 1;
  return m;
}, {});
const canonical = OBS.canonicalise(observed);
const significant = canonical.filter(c => c.significant);

/* Frozen once: what the event is. Everything else is still being learned. */
const FROZEN = ['canonicalEventId', 'hazard', 'onset', 'firstRecordedAt', 'geographyAtFirstRecord'];
/* Updatable, with every change written into revisions. */
const TRACKED = ['end', 'severity', 'alert', 'deaths', 'injuries', 'missing', 'affected',
  'displaced', 'evacuated', 'infrastructureImpact', 'impactLastUpdated', 'evidenceConfidence',
  'source', 'sourceUrl', 'eventId', 'geometry', 'significanceReason'];

/*
 * A returning disaster is recognised by its evidence, not by its id.
 *
 * The canonical id is built from the representative record's rounded position
 * and the earliest onset then visible. Both can move: a second provider
 * reports the same flood with a better location, or an earlier onset, and the
 * id generated on the next run differs from the one already recorded. Looking
 * the id up and finding nothing appends a second row, and one physical
 * disaster is counted twice in the recall denominator for ever.
 *
 * The provider records underneath are stable, so they are what identifies an
 * event across runs. The id stays frozen as first written even when the
 * derived one changes, and the change is recorded rather than applied.
 */
const byId = new Map(ledger.events.map(e => [e.canonicalEventId, e]));
const byEvidence = new Map();
for (const e of ledger.events) {
  if (e.supersededBy) continue;
  for (const ev of (e.evidence || [])) if (ev && ev.id) byEvidence.set(ev.id, e);
}
const findExisting = c => {
  const direct = byId.get(c.canonicalEventId);
  if (direct && !direct.supersededBy) return [direct];
  const hits = new Set();
  for (const ev of (c.evidence || [])) {
    const found = ev && ev.id ? byEvidence.get(ev.id) : null;
    if (found) hits.add(found);
  }
  if (direct) hits.add(direct);
  return [...hits];
};

let added = 0, updated = 0, changes = 0, superseded = 0, reidentified = 0;

for (const c of significant) {
  const candidates = findExisting(c);
  /* A record that bridges two previously separate events means they were one
     disaster all along. The earliest-recorded row keeps the identity; the
     others are marked superseded rather than deleted, so the correction is
     visible and nothing silently disappears from the denominator. */
  candidates.sort((a, b) => String(a.firstRecordedAt || '').localeCompare(String(b.firstRecordedAt || '')));
  const existing = candidates[0];
  for (const extra of candidates.slice(1)) {
    if (extra.supersededBy) continue;
    extra.supersededBy = existing.canonicalEventId;
    extra.supersededAt = now;
    extra.supersededReason = 'A later provider record links this to ' + existing.canonicalEventId +
      ', so the two were one disaster. Kept for the record and excluded from the recall denominator.';
    superseded++;
  }
  if (!existing) {
    const row = Object.assign({}, c, {
      firstRecordedAt: now,
      geographyAtFirstRecord: c.geography,
      lastSeenAt: now,
      sightings: [{ from: now, to: now }]
    });
    ledger.events.push(row);
    byId.set(row.canonicalEventId, row);
    for (const ev of (row.evidence || [])) if (ev && ev.id) byEvidence.set(ev.id, row);
    added++;
    continue;
  }

  noteSighting(existing, now);
  /* The id this run would have generated. Recorded when it differs, never
     applied: the identity a disaster was first written under is what every
     other record refers to. */
  if (c.canonicalEventId !== existing.canonicalEventId) {
    existing.derivedIdHistory = existing.derivedIdHistory || [];
    if (!existing.derivedIdHistory.some(h => h.derivedId === c.canonicalEventId)) {
      existing.derivedIdHistory.push({ at: now, derivedId: c.canonicalEventId,
        note: 'Better evidence changed the id this would be generated under; the recorded id is unchanged.' });
      reidentified++;
    }
  }
  existing.geography = c.geography;
  /* Evidence accumulates; it is never replaced.
   *
   * Assigning this run's evidence dropped the provider records learned on
   * earlier runs, and those ids are the index this ledger reconciles on. A
   * disaster first seen from providers A and B, then carried by B alone,
   * lost A from the index - and the next feed carrying only A appended the
   * same physical disaster as a second row, under a second id, in the recall
   * denominator for good. */
  const byEvidenceId = new Map();
  for (const ev of (existing.evidence || [])) if (ev && ev.id) byEvidenceId.set(ev.id, ev);
  for (const ev of (c.evidence || [])) if (ev && ev.id) byEvidenceId.set(ev.id, ev);
  existing.evidence = [...byEvidenceId.values()];
  for (const why of (c.mergeReasons || [])) {
    existing.mergeReasons = existing.mergeReasons || [];
    if (!existing.mergeReasons.includes(why)) existing.mergeReasons.push(why);
  }
  for (const f of TRACKED) {
    const before = existing[f] === undefined ? null : existing[f];
    const after = c[f] === undefined ? null : c[f];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    /* A figure that was reported and is now absent is the provider dropping
       it, not the impact being undone. Keeping the reported figure is the
       honest reading; the revision records that it stopped being published. */
    if (after === null && before !== null) {
      (existing.revisions = existing.revisions || []).push(
        { at: now, field: f, from: before, to: null, note: 'No longer reported upstream; the recorded figure is kept.' });
      changes++;
      continue;
    }
    (existing.revisions = existing.revisions || []).push({ at: now, field: f, from: before, to: after });
    existing[f] = after;
    changes++;
  }
  for (const f of FROZEN) {
    if (existing[f] === undefined && c[f] !== undefined) existing[f] = c[f];
  }
  updated++;
}

ledger.events.sort((a, b) => String(a.onset || '').localeCompare(String(b.onset || '')));
ledger.updatedAt = now;
ledger.method = {
  canonicalisation: 'Provider records are grouped into one disaster when they share a hazard family and fall inside that hazard’s matching window. Where either record is placed at an area centre, kilometres between them say nothing, so the match is by country and time instead.',
  significance: 'An event enters this ledger when deaths or missing are reported, at least 1,000 people are displaced, at least 10,000 affected, an authority raised a red or orange alert, ReliefWeb declared a disaster, or an earthquake reached magnitude 6. Each row states which of those applied.',
  sightings: 'Each event records the runs during which it was actually being carried by a provider, not only the last time it was seen. A single latest timestamp is overwritten on the next run, which destroys the evidence that a disaster was in the feed throughout a forecast window that has since closed. Consecutive sightings more than ' + SIGHTING_GAP_HOURS + ' hours apart start a new run rather than being joined.',
  frozen: 'A recorded event’s identity - canonical id, hazard, onset and the geography it was first seen at - is never rewritten. Impact figures are, because they are still being learned, and every change is appended to that event’s revisions.',
  notCounted: 'Hazard records below the bar above are real and are not disasters anyone failed to predict; they are left out of the recall denominator rather than deleted from the feed.',
  observationsOnly: 'Only a record whose evidence state is an observation is eligible. A forecast is not one, and neither is an official warning: a warning says severe weather is expected, and recording one as a disaster that happened would inflate the recall denominator and manufacture false negatives against forecasts that had nothing to miss. Each run states how many records it set aside on that ground, under lastRun.providerRecordsNotObservations.'
};
ledger.lastRun = {
  at: now,
  providerRecordsEvaluated: observed.length,
  providerRecordsNotObservations: notObservations,
  canonicalEventsFound: canonical.length,
  significant: significant.length,
  supersededThisRun: superseded,
  reidentifiedThisRun: reidentified,
  belowSignificanceBar: canonical.length - significant.length
};

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log('observed ledger: ' + added + ' new, ' + updated + ' seen again, ' + changes +
  ' figure(s) revised, ' + reidentified + ' re-identified, ' + superseded + ' superseded — ' +
  ledger.events.filter(e => !e.supersededBy).length + ' significant disasters recorded ' +
  '(' + observed.length + ' provider records → ' + canonical.length + ' events, ' +
  (canonical.length - significant.length) + ' below the bar; ' +
  (Object.entries(notObservations).map(([k, n]) => n + ' ' + k).join(', ') ||
   'no non-observation records') + ' set aside)');
