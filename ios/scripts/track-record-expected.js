'use strict';
/*
 * Renders the site's own /accuracy page (accuracy.html, in jsdom, over the
 * committed data/*.json) and prints the figures it shows as JSON, so the
 * iOS Track record can be checked against them in CI.
 *
 * Usage, from the repository root after `cd test && npm ci`:
 *   node ios/scripts/track-record-expected.js > expected.json
 */
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const { renderPage, closeAllWindows } = require(path.join(ROOT, 'test', 'render.js'));

const IDS = ['mTotal', 'mOpen', 'mAwaiting', 'mUngradeable', 'mGraded', 'mVerified', 'mPartial', 'mFalse', 'mMissed', 'mNotPrediction',
  'ipTotal', 'ipMatured', 'ipHit', 'ipPartial', 'ipMiss', 'ipPending', 'ipInvalid', 'ipPrecision', 'ipRecall', 'ipF1',
  'cdTotal', 'cdMatured', 'cdHit', 'cdPartial', 'cdMiss', 'cdPending', 'cdPrecision',
  'obTotal', 'obFalseNeg', 'obCoverage', 'obForecast', 'obUnknown', 'obNotForecastable', 'obNoInput', 'answerLead'];

(async () => {
  const now = Date.now();
  const r = await renderPage('accuracy.html', {
    timeoutMs: 120000,
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '-'
  });
  const out = { now, figures: {} };
  for (const id of IDS) out.figures[id] = ((r.document.getElementById(id) || {}).textContent || '').trim();
  r.close();
  closeAllWindows();
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
