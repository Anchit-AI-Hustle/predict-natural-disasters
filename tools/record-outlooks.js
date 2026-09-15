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

const [, , eventsPath, ledgerPath] = process.argv;
if (!eventsPath || !ledgerPath) {
  console.error('usage: record-outlooks.js <events.json> <ledger.json>');
  process.exit(2);
}

const feed = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const events = Array.isArray(feed.events) ? feed.events : [];

let ledger = [];
try {
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (Array.isArray(raw)) ledger = raw;
} catch (e) { /* first run: start empty */ }

/**
 * An outlook is identified by its id *and* the window it covers. When the
 * signal behind it is updated the window moves with it, and that is a new
 * claim about a new period — separately gradeable, not an edit of the old one.
 */
const key = o => String(o.id) + '@' + String(o.targetStart);
const seen = new Set(ledger.map(key));

const FIELDS = ['id', 'type', 'title', 'country', 'admin1', 'region', 'lat', 'lon',
  'alert', 'severity', 'severityRank', 'issuedAt', 'targetStart', 'targetEnd',
  'forecastKind', 'forecastOf', 'source', 'sourceUrl', 'confidence', 'evidence',
  'verificationRule'];

const recordedAt = new Date().toISOString();
const added = [];

for (const e of events) {
  if (!e || !e.forecast) continue;
  if (!e.targetStart || !e.targetEnd) continue;
  if (seen.has(key(e))) continue;
  seen.add(key(e));
  const row = { recordedAt };
  for (const f of FIELDS) if (e[f] !== undefined) row[f] = e[f];
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
