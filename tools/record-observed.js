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
/* When the providers were actually read, and which scan that was. Everything
   about what was OBSERVED is dated from here; only the ledger's own
   bookkeeping - when a row was first written, when a figure was revised in
   this file - is dated from the clock. */
const scan = (feed.meta && feed.meta.scan) || {};
const scanId = scan.scanId || null;
const observedAt = scan.scanTimestamp || feed.generatedAt || now;

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

/*
 * A sighting is dated by the scan that saw it, never by the clock here.
 *
 * The refresh job fetches the feed once, records the outlooks from it - which
 * is the moment their freeze happens - and only then records the
 * observations. Stamping a sighting with this tool's own start time therefore
 * dated it a few milliseconds AFTER the freeze of a forecast derived from the
 * very same snapshot. Measured: a continuation outlook frozen at
 * 03:41:17.676Z, its source cyclone sighted at 03:41:17.721Z, graded HIT on
 * that 45-millisecond "continuation" with no later scan ever showing the
 * hazard carried on. The snapshot a forecast was derived from cannot be
 * evidence that the hazard continued after it, and dating the sighting when
 * the providers were actually read - before the freeze - is what makes that
 * true rather than merely intended. The scan is also named on the run, so a
 * verifier can tell one snapshot's evidence from another's.
 */
function noteSighting(row, at, scanId) {
  const t = Date.parse(at);
  if (!Array.isArray(row.sightings)) {
    /* A row written before this existed still knows two moments. */
    row.sightings = [{ from: row.firstRecordedAt || row.lastSeenAt || at,
      to: row.lastSeenAt || at }];
  }
  const last = row.sightings[row.sightings.length - 1];
  const lastTo = Date.parse(last && last.to);
  /* A feed older than what is already recorded says nothing new; it must
     never drag a run's end backwards. */
  if (Number.isFinite(lastTo) && Number.isFinite(t) && t <= lastTo) return;
  if (last && Number.isFinite(lastTo) && t - lastTo <= SIGHTING_GAP_HOURS * 3600e3) {
    last.to = at;
    if (scanId) last.toScan = scanId;
  } else {
    const run = { from: at, to: at };
    if (scanId) { run.fromScan = scanId; run.toScan = scanId; }
    row.sightings.push(run);
  }
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
const FROZEN = ['canonicalEventId', 'hazard', 'onset', 'firstRecordedAt', 'geographyAtFirstRecord',
  'significanceAtEntry'];
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
/* A superseded row is not an identity anything should be written to; the row
   that kept the identity is. */
const keeperOf = row => {
  const seen = new Set();
  while (row && row.supersededBy && !seen.has(row.canonicalEventId)) {
    seen.add(row.canonicalEventId);
    const keeper = byId.get(row.supersededBy);
    if (!keeper) break;
    row = keeper;
  }
  return row;
};
/*
 * Every provider record this ledger has ever recorded, pointing at the row
 * that holds the identity now.
 *
 * Superseded rows were skipped, so the records learned under them left the
 * index altogether - and merging two rows carries over only the evidence the
 * run that bridged them happened to be carrying. Measured: a flood recorded
 * from rw-2 and rw-3, superseded into the row holding rw-1 by a run carrying
 * rw-1 and rw-2, then rw-3 arriving alone one run later. It matched nothing,
 * its position rounded to a different id than the row it came from, and the
 * same disaster was appended a third time, active, in the recall denominator.
 * Merging two rows does not unlearn what either of them knew.
 */
const byEvidence = new Map();
for (const superseded of [true, false]) {
  for (const e of ledger.events) {
    if (!!e.supersededBy !== superseded) continue;
    const keeper = keeperOf(e);
    for (const ev of (e.evidence || [])) if (ev && ev.id) byEvidence.set(ev.id, keeper);
  }
}

/*
 * An id hit is a question, not an answer.
 *
 * The canonical id is a country, a rounded position and a minute, so two
 * separate disasters derive the same string: two magnitude-6 earthquakes the
 * same morning, far enough apart to be two events under this hazard's 100 km
 * window, both come out as OBS-earthquake-IND-20260910T0000-n01e001, and the
 * grouping that produced them had correctly kept them apart. Reading that
 * collision as identity merged them again here - the second quake's impact
 * figures were written over the first's as revisions, and one real disaster
 * left the recall denominator without leaving a trace.
 *
 * The provider records underneath are the evidence of identity. Where they do
 * not overlap, the two rows have to be able to be the same occurrence before
 * the shared id may be believed.
 */
const findExisting = c => {
  const hits = new Set();
  for (const ev of (c.evidence || [])) {
    const found = ev && ev.id ? byEvidence.get(ev.id) : null;
    if (found) hits.add(keeperOf(found));
  }
  const direct = byId.get(c.canonicalEventId);
  const keeper = direct ? keeperOf(direct) : null;
  let idMatch = null;
  if (direct && !hits.has(keeper)) {
    idMatch = OBS.sameCanonical(c, direct);
    if (idMatch) hits.add(keeper);
  }
  return {
    candidates: [...hits],
    idMatch: idMatch,
    /* Someone else holds the id this grouping derives, and it is not this
       disaster. */
    collision: direct && !idMatch && !hits.has(keeper) ? direct : null
  };
};

/*
 * What a superseded row had learned belongs to the disaster, not to the row.
 *
 * Marking a row superseded took it out of the denominator - and out of
 * grading, because the verification page reads only rows that survive - while
 * everything it had recorded stayed on it. A sighting run held only by that
 * row vanished from a window it covered, so a continuation outlook that had
 * been borne out could turn ungradeable weeks later; impact figures it alone
 * carried were stranded the same way. The two rows are one disaster, so
 * everything either of them established is now the survivor's before the
 * other is set aside. Nothing is deleted: the superseded row keeps its own
 * copy, and the survivor records what it took and from where.
 */
function mergeRuns(runs) {
  const list = runs.filter(r => r && r.from && r.to)
    .slice().sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const out = [];
  for (const run of list) {
    const last = out[out.length - 1];
    const from = Date.parse(run.from), to = Date.parse(run.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (last && from - Date.parse(last.to) <= SIGHTING_GAP_HOURS * 3600e3) {
      /* Overlapping or continuous watching: one run, and the scan that ends
         it is the later one's. */
      if (to > Date.parse(last.to)) { last.to = run.to; if (run.toScan) last.toScan = run.toScan; }
      continue;
    }
    out.push(Object.assign({}, run));
  }
  return out;
}

const IMPACT_CARRIED = ['deaths', 'injuries', 'missing', 'affected', 'displaced',
  'evacuated', 'infrastructureImpact', 'impactLastUpdated', 'end'];

function absorb(keeper, extra) {
  const took = { sightings: 0, revisions: 0, fields: [] };

  const before = (keeper.sightings || []).length;
  const runs = mergeRuns((keeper.sightings || []).concat(extra.sightings || []));
  if (runs.length) {
    keeper.sightings = runs;
    took.sightings = Math.max(0, (extra.sightings || []).length);
    const latest = runs[runs.length - 1].to;
    if (!keeper.lastSeenAt || Date.parse(latest) > Date.parse(keeper.lastSeenAt)) keeper.lastSeenAt = latest;
  }
  if (!before && !runs.length) delete keeper.sightings;

  const seen = new Set((keeper.revisions || []).map(r => JSON.stringify([r.at, r.field, r.from, r.to])));
  for (const rev of (extra.revisions || [])) {
    const k = JSON.stringify([rev.at, rev.field, rev.from, rev.to]);
    if (seen.has(k)) continue;
    seen.add(k);
    (keeper.revisions = keeper.revisions || []).push(Object.assign({}, rev, { from_: undefined,
      absorbedFrom: extra.canonicalEventId }));
    took.revisions++;
  }
  if (keeper.revisions) {
    keeper.revisions.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  }

  /* A figure the survivor never had. It is not overwritten where it has one:
     this run's record is the current reading, and an older row's figure
     cannot correct it. */
  for (const f of IMPACT_CARRIED) {
    const mine = keeper[f], theirs = extra[f];
    if (mine !== null && mine !== undefined) continue;
    if (theirs === null || theirs === undefined) continue;
    keeper[f] = theirs;
    took.fields.push(f);
    (keeper.revisions = keeper.revisions || []).push({ at: now, field: f, from: null, to: theirs,
      absorbedFrom: extra.canonicalEventId,
      note: 'Carried across from ' + extra.canonicalEventId + ', which turned out to be this disaster.' });
  }

  for (const why of (extra.mergeReasons || [])) {
    keeper.mergeReasons = keeper.mergeReasons || [];
    if (!keeper.mergeReasons.includes(why)) keeper.mergeReasons.push(why);
  }
  for (const h of (extra.derivedIdHistory || [])) {
    keeper.derivedIdHistory = keeper.derivedIdHistory || [];
    if (!keeper.derivedIdHistory.some(x => x.derivedId === h.derivedId)) keeper.derivedIdHistory.push(h);
  }
  for (const ev of (extra.evidence || [])) {
    if (!ev || !ev.id) continue;
    keeper.evidence = keeper.evidence || [];
    if (!keeper.evidence.some(x => x && x.id === ev.id)) keeper.evidence.push(ev);
  }

  took.summary = took.sightings + ' sighting run(s), ' + took.revisions + ' revision(s)' +
    (took.fields.length ? ', and ' + took.fields.join(', ') : '');
  (keeper.absorbed = keeper.absorbed || []).push({
    at: now, from: extra.canonicalEventId, onset: extra.onset || null,
    sightings: took.sightings, revisions: took.revisions, fields: took.fields
  });
  return took;
}

/* Why two rows that derive one id are not one disaster, stated in the terms
   the matching window is set in, so the split can be argued with rather than
   taken on trust. */
const differenceNote = (a, b) => {
  /* The id carries the hazard family, so two rows that derive one id always
     share it; what can differ is when and where. */
  const parts = [];
  const ta = Date.parse(a.onset || ''), tb = Date.parse(b.onset || '');
  parts.push(Number.isFinite(ta) && Number.isFinite(tb)
    ? 'onsets ' + Math.round(Math.abs(ta - tb) / 3600e3) + 'h apart'
    : 'an onset missing from one of them');
  const ga = a.geography || {}, gb = b.geography || {};
  const placed = [ga, gb].every(g => Number.isFinite(g.lat) && Number.isFinite(g.lon));
  if (placed) parts.push(Math.round(OBS.distanceKm(ga.lat, ga.lon, gb.lat, gb.lon)) + ' km apart');
  else parts.push('placed in ' + (ga.region || ga.country || 'an unstated area') + ' and ' +
    (gb.region || gb.country || 'an unstated area') + ', which cannot be shown to be one area');
  const w = OBS.MATCH[a.hazard] || OBS.MATCH.other;
  return parts.join(', ') + '. Nothing establishes these as one occurrence under the ' +
    w.km + ' km / ' + w.hours + 'h matching window for ' + a.hazard + '.';
};

let added = 0, updated = 0, changes = 0, superseded = 0, reidentified = 0, distinguished = 0;
let belowBarNew = 0, belowBarUpdated = 0;

/*
 * The bar decides what ENTERS this ledger, not what may go on being learned
 * about what is already in it.
 *
 * Filtering the whole reconciliation by significance dropped a recorded
 * disaster the moment it fell below the bar while still being carried - a
 * cyclone weakening from orange to green, a flood whose displacement figure
 * is withdrawn - and everything still being learned about it stopped with it:
 * its sighting run ended, its end date and alert level froze at the last
 * qualifying run, and a continuation outlook covering that period lost the
 * evidence that the hazard had gone on. A row that is in the ledger is
 * reconciled on every run; only a new row has to clear the bar.
 */
for (const c of canonical) {
  const { candidates, idMatch, collision } = findExisting(c);
  /* A record that bridges two previously separate events means they were one
     disaster all along. The earliest-recorded row keeps the identity; the
     others are marked superseded rather than deleted, so the correction is
     visible and nothing silently disappears from the denominator. */
  candidates.sort((a, b) => String(a.firstRecordedAt || '').localeCompare(String(b.firstRecordedAt || '')));
  const existing = candidates[0];
  if (!existing && !c.significant) { belowBarNew++; continue; }
  if (existing && !c.significant) belowBarUpdated++;
  for (const extra of candidates.slice(1)) {
    if (extra.supersededBy) continue;
    const took = absorb(existing, extra);
    extra.supersededBy = existing.canonicalEventId;
    extra.supersededAt = now;
    extra.supersededReason = 'A later provider record links this to ' + existing.canonicalEventId +
      ', so the two were one disaster. Kept for the record and excluded from the recall denominator; ' +
      'what it had learned was carried across first (' + took.summary + ').';
    superseded++;
  }
  if (!existing) {
    const row = Object.assign({}, c, {
      firstRecordedAt: now,
      /* Why it qualified, as at the moment it entered. significanceReason
         goes on tracking the current assessment, so without this the answer
         to "why is this in the denominator" would be overwritten the first
         time the disaster eased. */
      significanceAtEntry: c.significanceReason,
      geographyAtFirstRecord: c.geography,
      lastSeenAt: observedAt,
      sightings: [Object.assign({ from: observedAt, to: observedAt },
        scanId ? { fromScan: scanId, toScan: scanId } : {})]
    });
    /* Recording this disaster under an id another one already holds would
       hand both to whichever lookup ran first, so it is written under a
       distinguished id instead - carrying the id it derived and the measured
       reason the two were not merged, so the split is auditable. */
    if (collision) {
      let n = 2;
      while (byId.has(c.canonicalEventId + '-' + n)) n++;
      row.canonicalEventId = c.canonicalEventId + '-' + n;
      row.derivedIdCollision = {
        at: now,
        derivedId: c.canonicalEventId,
        heldBy: collision.canonicalEventId,
        reason: differenceNote(c, collision)
      };
      distinguished++;
    }
    ledger.events.push(row);
    byId.set(row.canonicalEventId, row);
    for (const ev of (row.evidence || [])) if (ev && ev.id) byEvidence.set(ev.id, row);
    added++;
    continue;
  }

  noteSighting(existing, observedAt, scanId);
  /* Recognised by the id alone: no provider record this run overlaps the ones
     already recorded, so the reason the two are one disaster is the match
     itself, and it is written down rather than assumed. */
  if (idMatch) {
    existing.matchedById = existing.matchedById || [];
    if (!existing.matchedById.some(m => m.why === idMatch)) {
      existing.matchedById.push({ at: now, why: idMatch });
    }
  }
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
        { at: now, observedAt: observedAt, scanId: scanId, field: f, from: before, to: null,
          note: 'No longer reported upstream; the recorded figure is kept.' });
      changes++;
      continue;
    }
    (existing.revisions = existing.revisions || []).push(
      { at: now, observedAt: observedAt, scanId: scanId, field: f, from: before, to: after });
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
  identity: 'A canonical id is a country, a rounded position and a minute, so two separate disasters can derive the same one. An id already held is believed only where the provider records overlap or the two rows can be the same occurrence under this hazard\u2019s matching window; otherwise the new disaster is recorded under a distinguished id, carrying the id it derived and the measured reason the two were not merged.',
  notCounted: 'Hazard records below the bar above are real and are not disasters anyone failed to predict; they are left out of the recall denominator rather than deleted from the feed. The bar decides what enters: a disaster already recorded goes on being reconciled on every run even when it eases below it, because what is still being learned about it - how long it was carried, when it ended, what it did - does not stop being true. Each row keeps the reason it qualified on entry, under significanceAtEntry, beside the current assessment.',
  observationsOnly: 'Only a record whose evidence state is an observation is eligible. A forecast is not one, and neither is an official warning: a warning says severe weather is expected, and recording one as a disaster that happened would inflate the recall denominator and manufacture false negatives against forecasts that had nothing to miss. Each run states how many records it set aside on that ground, under lastRun.providerRecordsNotObservations.'
};
ledger.lastRun = {
  at: now,
  providerRecordsEvaluated: observed.length,
  providerRecordsNotObservations: notObservations,
  canonicalEventsFound: canonical.length,
  significant: significant.length,
  belowBarNotRecorded: belowBarNew,
  belowBarStillReconciled: belowBarUpdated,
  supersededThisRun: superseded,
  reidentifiedThisRun: reidentified,
  distinguishedFromCollidingIdThisRun: distinguished,
  belowSignificanceBar: canonical.length - significant.length
};

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log('observed ledger: ' + added + ' new, ' + updated + ' seen again, ' + changes +
  ' figure(s) revised, ' + reidentified + ' re-identified, ' + distinguished +
  ' id collision(s) distinguished, ' + superseded + ' superseded — ' +
  ledger.events.filter(e => !e.supersededBy).length + ' significant disasters recorded ' +
  '(' + observed.length + ' provider records → ' + canonical.length + ' events, ' +
  (canonical.length - significant.length) + ' below the bar; ' +
  (Object.entries(notObservations).map(([k, n]) => n + ' ' + k).join(', ') ||
   'no non-observation records') + ' set aside)');
