#!/usr/bin/env node
'use strict';
/**
 * Append this run's scan to the coverage ledger.
 *
 * Without a written record of what was examined, "no forecast existed for this
 * disaster" cannot be told apart from "nothing ever looked there" — and the
 * difference is the whole distinction between a forecasting failure and a
 * coverage failure. The feed reported which upstreams answered, but only for
 * the instant it was serving; nothing survived the request.
 *
 *   node tools/record-scan.js <events.json> <scan-ledger.json>
 *
 * The ledger is append-only and lives in git, so what was scanned and when is
 * auditable and tamper-evident. Rows already written are never revisited.
 *
 * Retention: an hourly run writes about 8,760 rows a year, so the detailed
 * window is bounded at RETAIN scans. Nothing is lost when a row ages out — the
 * per-provider totals it contributed to are carried in `aggregate`, which
 * covers every scan ever recorded, and `retention` states plainly that
 * per-scan detail before `detailFrom` is no longer held. A question about a
 * date outside the window is answered DATA_UNAVAILABLE rather than guessed at.
 *
 * Exits 0 whether or not anything was added; the caller checks git for a diff.
 */
const fs = require('fs');

const RETAIN = Number(process.env.SCAN_RETAIN || 2000);

const [, , eventsPath, ledgerPath] = process.argv;
if (!eventsPath || !ledgerPath) {
  console.error('usage: record-scan.js <events.json> <scan-ledger.json>');
  process.exit(2);
}

const feed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const scan = (feed.meta || {}).scan;
if (!scan || !Array.isArray(scan.providers)) {
  console.error('the feed carries no scan record; nothing to write');
  process.exit(1);
}

let ledger = { schemaVersion: 1, scans: [] };
try {
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (raw && Array.isArray(raw.scans)) ledger = raw;
} catch (e) { /* first run: start empty */ }

if (ledger.scans.some(s => s.scanId === scan.scanId)) {
  console.log('scan ledger: ' + scan.scanId + ' already recorded (' + ledger.scans.length + ' scans)');
  process.exit(0);
}

/* What each provider is and what it reaches is the same on every run, so it is
   described once here rather than copied into every row. */
ledger.engineVersion = scan.engineVersion;
ledger.coverageLimitation = scan.coverageLimitation;
ledger.providers = ledger.providers || {};
for (const p of scan.providers) {
  ledger.providers[p.provider] = {
    label: p.label, hazards: p.hazards,
    geographicCoverage: p.geographicCoverage,
    coverageResolution: p.coverageResolution,
    scope: p.scope,
    endpoint: p.endpoint
  };
}

ledger.scans.push({
  scanId: scan.scanId,
  scanTimestamp: scan.scanTimestamp,
  engineVersion: scan.engineVersion,
  providers: scan.providers.map(p => ({
    provider: p.provider,
    status: p.status,
    success: p.success,
    recordsEvaluated: p.recordsEvaluated,
    recordsServed: p.recordsServed,
    dataFreshness: p.dataFreshness,
    failureReason: p.failureReason
  }))
});
ledger.scans.sort((a, b) => String(a.scanTimestamp).localeCompare(String(b.scanTimestamp)));

/* Totals over every scan ever recorded, including rows that have since aged
   out of the detailed window, so trimming can never quietly improve the
   record. Recomputed from scratch would lose exactly that, so it accumulates. */
ledger.aggregate = ledger.aggregate || { scansRecorded: 0, byProvider: {} };
ledger.aggregate.scansRecorded += 1;
for (const p of scan.providers) {
  const a = ledger.aggregate.byProvider[p.provider] ||
    (ledger.aggregate.byProvider[p.provider] = { scans: 0, byStatus: {}, recordsEvaluated: 0 });
  a.scans += 1;
  a.byStatus[p.status] = (a.byStatus[p.status] || 0) + 1;
  a.recordsEvaluated += Number(p.recordsEvaluated) || 0;
}

let trimmed = 0;
if (ledger.scans.length > RETAIN) {
  trimmed = ledger.scans.length - RETAIN;
  ledger.scans = ledger.scans.slice(-RETAIN);
}
ledger.retention = {
  detailedScansRetained: ledger.scans.length,
  retainLimit: RETAIN,
  detailFrom: ledger.scans.length ? ledger.scans[0].scanTimestamp : null,
  note: 'Per-scan detail is held for the most recent ' + RETAIN + ' scans. Coverage before detailFrom ' +
        'cannot be established from this ledger and must be reported as DATA_UNAVAILABLE, never as scanned or unscanned.'
};
ledger.updatedAt = scan.scanTimestamp;

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const counts = scan.providers.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m; }, {});
console.log('scan ledger: recorded ' + scan.scanId + ' — ' +
  Object.keys(counts).map(k => counts[k] + ' ' + k).join(', ') +
  ' (' + ledger.scans.length + ' scans retained' + (trimmed ? ', ' + trimmed + ' aged out' : '') + ')');
