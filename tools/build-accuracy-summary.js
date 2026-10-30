#!/usr/bin/env node
'use strict';
/**
 * Write what /accuracy shows first, so the page does not have to download
 * and grade 8 MB of ledgers before it can say anything.
 *
 *   node tools/build-accuracy-summary.js [dataDir]
 *
 * Writes, from the committed ledgers only:
 *   data/accuracy-summary.json   the headline and the figures (a few KB)
 *   data/forecast-verdicts.json  one row per outlook forecast, its verdict and
 *                                how many versions were recorded: the paged
 *                                table on /accuracy, its CSV download and the
 *                                verdict on each forecast's own page.
 *
 * The grading is accuracy-model.js, the function the page runs when a reader
 * opens the full record, so the two cannot disagree. "Now" is the newest
 * timestamp in the inputs, not the clock, so the same files always give the
 * same output.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = process.argv[2] || path.join(ROOT, 'data');
const A = require(path.join(ROOT, 'accuracy-model.js'));
const deps = {
  V: require(path.join(ROOT, 'verdicts.js')),
  VER: require(path.join(ROOT, 'verification-model.js')),
  OBSM: require(path.join(ROOT, 'observed-model.js')),
  H: require(path.join(ROOT, 'hazard-model.js'))
};
const read = (n, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8')); } catch (e) { return fb; } };

function build() {
  const ledger = read('outlook-ledger.json', []);
  const verification = read('verification-ledger.json', { verifications: [] });
  const observed = read('observed-disasters.json', { events: [] });
  const scan = read('scan-ledger.json', { scans: [] });
  const modelVerdicts = read('model-verdicts.json', null);
  const modelLedger = read('model-ledger.json', []);
  const times = [verification.updatedAt, observed.updatedAt, scan.updatedAt, modelVerdicts && modelVerdicts.generatedAt]
    .concat(ledger.map(r => r && r.recordedAt)).concat(modelLedger.map(r => r && r.recordedAt))
    .map(t => Date.parse(t || '')).filter(Number.isFinite);
  const now = times.length ? Math.max(...times) : 0;
  const recordTimes = [verification.updatedAt, observed.updatedAt, scan.updatedAt].concat(ledger.map(r => r && r.recordedAt))
    .map(t => Date.parse(t || '')).filter(Number.isFinite);
  const g = A.gradeOutlooks({ ledger, verification, observed, scan, now }, deps);
  const summary = A.summarise(g, modelVerdicts, deps, { now, modelLedger,
    recordUpdated: recordTimes.length ? new Date(Math.max(...recordTimes)).toISOString() : null });
  summary.answer = A.answer(summary);
  const rows = A.outlookRows(g, deps.V).map(r => Object.assign(r, { reason: String(r.reason || '').slice(0, 400) }));
  const verdicts = {
    note: 'One row per outlook forecast (its first recorded version), graded by accuracy-model.js with checker ' +
      deps.VER.VERIFICATION_VERSION + '. "versions" is how many times it was recorded. Model forecasts are in data/model-verdicts.json.',
    generatedAt: summary.generatedAt, verificationVersion: deps.VER.VERIFICATION_VERSION, outlooks: rows
  };
  return { summary, verdicts };
}

if (require.main === module) {
  const { summary, verdicts } = build();
  fs.writeFileSync(path.join(DATA, 'accuracy-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  fs.writeFileSync(path.join(DATA, 'forecast-verdicts.json'), JSON.stringify(verdicts) + '\n');
  console.log('accuracy summary: model ' + JSON.stringify({ issued: summary.model.issued, correct: summary.model.correct,
    falseAlarms: summary.model.falseAlarms, missedDays: summary.model.missedDays }) +
    '; restated ' + JSON.stringify(summary.restated) + '; ' + verdicts.outlooks.length + ' outlook forecasts');
}
module.exports = { build };
