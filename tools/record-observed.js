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

/* A forecast is not an observation, whatever its coordinate looks like. */
const observed = events.filter(e => e && !e.forecast && e.evidenceState !== 'forecast');
const canonical = OBS.canonicalise(observed);
const significant = canonical.filter(c => c.significant);

/* Frozen once: what the event is. Everything else is still being learned. */
const FROZEN = ['canonicalEventId', 'hazard', 'onset', 'firstRecordedAt', 'geographyAtFirstRecord'];
/* Updatable, with every change written into revisions. */
const TRACKED = ['end', 'severity', 'alert', 'deaths', 'injuries', 'missing', 'affected',
  'displaced', 'evacuated', 'infrastructureImpact', 'impactLastUpdated', 'evidenceConfidence',
  'source', 'sourceUrl', 'eventId', 'geometry', 'significanceReason'];

const byId = new Map(ledger.events.map(e => [e.canonicalEventId, e]));
let added = 0, updated = 0, changes = 0;

for (const c of significant) {
  const existing = byId.get(c.canonicalEventId);
  if (!existing) {
    const row = Object.assign({}, c, {
      firstRecordedAt: now,
      geographyAtFirstRecord: c.geography,
      lastSeenAt: now
    });
    ledger.events.push(row);
    byId.set(row.canonicalEventId, row);
    added++;
    continue;
  }

  existing.lastSeenAt = now;
  existing.geography = c.geography;
  existing.evidence = c.evidence;
  existing.mergeReasons = c.mergeReasons;
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
  frozen: 'A recorded event’s identity - canonical id, hazard, onset and the geography it was first seen at - is never rewritten. Impact figures are, because they are still being learned, and every change is appended to that event’s revisions.',
  notCounted: 'Hazard records below the bar above are real and are not disasters anyone failed to predict; they are left out of the recall denominator rather than deleted from the feed.'
};
ledger.lastRun = {
  at: now,
  providerRecordsEvaluated: observed.length,
  canonicalEventsFound: canonical.length,
  significant: significant.length,
  belowSignificanceBar: canonical.length - significant.length
};

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log('observed ledger: ' + added + ' new, ' + updated + ' seen again, ' + changes +
  ' figure(s) revised — ' + ledger.events.length + ' significant disasters recorded ' +
  '(' + observed.length + ' provider records → ' + canonical.length + ' events, ' +
  (canonical.length - significant.length) + ' below the bar)');
