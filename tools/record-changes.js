#!/usr/bin/env node
'use strict';
/**
 * Record what changed in the forecast set since the previous run.
 *
 * The ledger answers "what did you predict"; it cannot answer "what changed
 * since I last looked", because a re-issued outlook is appended as a new row
 * indistinguishable from a brand-new one, and an outlook that stopped being
 * issued leaves no trace at all. So a reader watching for movement — a watch
 * raised to a warning, a window pushed out, a signal that has gone — had
 * nothing to read.
 *
 *   node tools/record-changes.js <events.json> <changes.json>
 *
 * Writes a bounded history of runs, each holding the differences against the
 * snapshot taken at the previous run, plus that run's own snapshot so the next
 * one has something to compare against. Exits 0 whether or not anything moved.
 */
const fs = require('fs');

const MAX_RUNS = 200;

const [, , eventsPath, changesPath] = process.argv;
if (!eventsPath || !changesPath) {
  console.error('usage: record-changes.js <events.json> <changes.json>');
  process.exit(2);
}

const feed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const events = Array.isArray(feed.events) ? feed.events : [];

let log = { schemaVersion: 1, runs: [], snapshot: {} };
try {
  const raw = JSON.parse(fs.readFileSync(changesPath, 'utf8'));
  if (raw && Array.isArray(raw.runs)) log = raw;
} catch (e) { /* first run: start empty */ }

/* Compared on what a reader would call a change: the level, the window, and
   whether it is still being issued at all. */
function snap(e) {
  return {
    id: e.id, type: e.type, title: e.title, country: e.country || e.region || '',
    alert: e.alert || '', rank: Number(e.severityRank) || 0,
    targetStart: e.targetStart || '', targetEnd: e.targetEnd || ''
  };
}

const current = {};
for (const e of events) {
  if (!e || !e.forecast || e.windowClosed) continue;
  if (!e.targetStart || !e.targetEnd) continue;
  current[e.id] = snap(e);
}

const previous = (log.snapshot && typeof log.snapshot === 'object') ? log.snapshot : {};
const first = Object.keys(previous).length === 0;

const added = [], raised = [], lowered = [], windowMoved = [], gone = [];
for (const id of Object.keys(current)) {
  const now = current[id], was = previous[id];
  if (!was) { added.push(now); continue; }
  if (now.rank > was.rank) raised.push({ ...now, from: was.alert, to: now.alert });
  else if (now.rank < was.rank) lowered.push({ ...now, from: was.alert, to: now.alert });
  if (now.targetEnd !== was.targetEnd) {
    windowMoved.push({ ...now, fromEnd: was.targetEnd, toEnd: now.targetEnd });
  }
}
for (const id of Object.keys(previous)) {
  /* No longer issued. That is not the same as the window having closed: the
     signal behind it stopped, which is itself worth showing. */
  if (!current[id]) gone.push(previous[id]);
}

const at = new Date().toISOString();
const last = log.runs.length ? log.runs[log.runs.length - 1] : null;
const sinceHours = last && last.at
  ? Math.round((Date.parse(at) - Date.parse(last.at)) / 36e5 * 100) / 100
  : null;

const run = {
  at,
  sinceHours,
  active: Object.keys(current).length,
  /* The first run has nothing to compare against, so every open outlook would
     otherwise be reported as newly added. */
  baseline: first,
  added: first ? [] : added,
  raised, lowered, windowMoved,
  gone: first ? [] : gone
};

log.schemaVersion = 1;
log.runs = log.runs.concat([run]).slice(-MAX_RUNS);
log.snapshot = current;
log.updatedAt = at;

/* The cadence this workflow actually achieves, measured rather than declared.
   The schedule asks for every five minutes; GitHub throttles it to a few
   hours, and the site used to publish the intention as though it were the
   outcome. */
const gaps = log.runs.map(r => r.sinceHours).filter(v => typeof v === 'number' && v > 0);
if (gaps.length) {
  const sorted = gaps.slice().sort((a, b) => a - b);
  log.observedCadenceHours = {
    runs: gaps.length + 1,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

fs.writeFileSync(changesPath, JSON.stringify(log, null, 2) + '\n');
const moved = run.added.length + raised.length + lowered.length + windowMoved.length + run.gone.length;
console.log('changes: ' + (first ? 'baseline snapshot, ' : '') + moved + ' change(s) across ' +
  run.active + ' active outlook(s)');
for (const a of run.added) console.log('  + new     ' + a.id + ' ' + a.alert + ' ' + a.title);
for (const a of raised) console.log('  ^ raised  ' + a.id + ' ' + a.from + ' -> ' + a.to);
for (const a of lowered) console.log('  v lowered ' + a.id + ' ' + a.from + ' -> ' + a.to);
for (const a of windowMoved) console.log('  > window  ' + a.id + ' ends ' + a.fromEnd + ' -> ' + a.toEnd);
for (const a of run.gone) console.log('  - gone    ' + a.id + ' ' + a.title);
