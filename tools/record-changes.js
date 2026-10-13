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

const G = require('./io-guard.js');
const feed = G.readFeed(eventsPath);
const events = feed.events;

const log = G.readLedger(changesPath, raw => !!raw && Array.isArray(raw.runs) && (raw.snapshot === undefined || (!!raw.snapshot && typeof raw.snapshot === 'object')),
  () => ({ schemaVersion: 1, runs: [], snapshot: {} }));

/* Which upstreams were unreachable on this run. /api/events deliberately
   returns a partial feed when a provider is down — ReliefWeb has been
   answering HTTP 406 for days — so every outlook derived from it simply
   vanishes from the feed. Without this, an outage reads as "the signal behind
   it stopped", and the provider coming back reads as a fresh forecast. */
const sources = (feed.meta && feed.meta.sources) || {};
const down = new Set(Object.keys(sources).filter(k => sources[k] && sources[k].ok === false));

/* The upstream an outlook came from, matched against the names the feed
   actually writes into its source string.
   Ordered, and specific before generic, because an unordered map got two of
   them wrong: "USGS Volcano Hazards Program" matched the bare "usgs" entry
   first and "NOAA National Hurricane Center" contains no "nhc" at all, so a
   volcano or hurricane outage was still classified as a withdrawal. */
const PROVIDERS = [
  ['usgs volcano hazards', 'usgs_volcano'],
  ['volcano hazards', 'usgs_volcano'],
  ['national hurricane center', 'nhc'],
  ['national weather service', 'nws'],
  ['reliefweb', 'reliefweb'],
  ['nasa eonet', 'eonet'],
  ['eonet', 'eonet'],
  ['gdacs', 'gdacs'],
  ['emsc', 'emsc'],
  ['nhc', 'nhc'],
  ['nws', 'nws'],
  ['usgs', 'usgs']
];
function providerOf(e) {
  const s = String((e && e.source) || '').toLowerCase();
  for (const [needle, key] of PROVIDERS) if (s.includes(needle)) return key;
  return '';
}

/* Compared on what a reader would call a change: the level, the window, and
   whether it is still being issued at all. */
function snap(e) {
  return {
    id: e.id, type: e.type, title: e.title, country: e.country || e.region || '',
    alert: e.alert || '', rank: Number(e.severityRank) || 0,
    targetStart: e.targetStart || '', targetEnd: e.targetEnd || '',
    provider: providerOf(e)
  };
}

const current = {};
for (const e of events) {
  if (!e || !e.forecast || e.windowClosed) continue;
  if (!e.targetStart || !e.targetEnd) continue;
  current[e.id] = snap(e);
}

const previous = (log.snapshot && typeof log.snapshot === 'object') ? log.snapshot : {};
/* Whether any run has happened before, not whether the last one saw
   anything. A run that legitimately finds no open outlooks writes an empty
   snapshot, and reading that as "no history" would make the next run a
   second baseline — suppressing every newly issued outlook from `added`
   and telling the reader there is nothing earlier to compare with. */
const first = !log.runs.length;

const added = [], raised = [], lowered = [], windowMoved = [], gone = [], expired = [],
  unavailable = [];
const nowIso = new Date().toISOString();
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
  if (current[id]) continue;
  const was = previous[id];
  /* An outlook leaves the open set for three very different reasons, and this
     reported all of them as the last one. Its window ending is the outlook
     doing exactly what it said it would. Its provider being unreachable is our
     problem, not a change in the forecast. Only a signal that is still
     reachable and no longer issued is a withdrawal. */
  const end = Date.parse(was.targetEnd || '');
  if (Number.isFinite(end) && end <= Date.parse(nowIso)) { expired.push(was); continue; }
  /* A snapshot written before this field existed carries no provider at all,
     which is not the same as a record that genuinely has no upstream — the
     frozen benchmark stores an empty string for that. The committed baseline
     holds 29 such entries, so on the first scheduled run after deploying this
     every one of them would have failed the guard and been recorded as
     withdrawn, then re-added on the next run. When we cannot tell which
     upstream an entry came from, an outage anywhere is reason enough to hold
     it rather than to accuse the forecast of vanishing. */
  const unknownProvider = !Object.prototype.hasOwnProperty.call(was, 'provider');
  const providerDown = unknownProvider ? down.size > 0
    : (was.provider && down.has(was.provider));
  if (providerDown) {
    unavailable.push(was);
    /* Held in the snapshot, so the provider recovering does not read as a
       newly issued forecast either. */
    current[id] = was;
    continue;
  }
  gone.push(was);
}

const at = nowIso;
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
  gone: first ? [] : gone,
  expired: first ? [] : expired,
  /* Not a change in the forecasts; a gap in what we could see. */
  unavailable: first ? [] : unavailable,
  sourcesDown: [...down]
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

G.writeChecked(changesPath, log, v => (Array.isArray(v.runs) && v.runs.length ? [] : ['no runs recorded'])
  .concat(v.snapshot && typeof v.snapshot === 'object' ? [] : ['no snapshot']));
const moved = run.added.length + raised.length + lowered.length +
  windowMoved.length + run.gone.length + run.expired.length;
console.log('changes: ' + (first ? 'baseline snapshot, ' : '') + moved + ' change(s) across ' +
  run.active + ' active outlook(s)');
for (const a of run.added) console.log('  + new     ' + a.id + ' ' + a.alert + ' ' + a.title);
for (const a of raised) console.log('  ^ raised  ' + a.id + ' ' + a.from + ' -> ' + a.to);
for (const a of lowered) console.log('  v lowered ' + a.id + ' ' + a.from + ' -> ' + a.to);
for (const a of windowMoved) console.log('  > window  ' + a.id + ' ends ' + a.fromEnd + ' -> ' + a.toEnd);
for (const a of run.gone) console.log('  - gone    ' + a.id + ' ' + a.title);
for (const a of run.expired) console.log('  . expired ' + a.id + ' ' + a.title);
for (const a of run.unavailable) console.log('  ? source  ' + a.id + ' ' + a.title + ' (' + a.provider + ' unreachable)');
