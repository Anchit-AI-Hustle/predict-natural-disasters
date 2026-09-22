'use strict';
/*
 * What the verification page is allowed to publish.
 *
 * It published one hit rate over everything it had graded — "17% (1 of 6)" —
 * computed entirely from outlooks about hazards that were already happening.
 * It is now driven by the verification engine, which refuses to grade a window
 * the record of observed disasters does not cover, and the page has to carry
 * that refusal through to the reader instead of printing a number anyway.
 *
 * Both states are tested: the one the project is in today, where nothing can
 * be graded, and the one it enters once the ledgers fill.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const open = () => renderPage('accuracy.html', {
  waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '—'
});
const text = (r, id) => (r.document.getElementById(id) || {}).textContent;

/* ------------------------------------------------- as things actually are */

test('no prediction rate is published when none can be computed', async () => {
  const r = await open();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  for (const id of ['ipPrecision', 'ipRecall', 'ipF1']) {
    assert.equal(text(r, id), 'Not computable',
      id + ' published a number from a record that cannot support one');
  }
  assert.match(text(r, 'ipNote'), /no prediction hit rate/i);
  r.close();
});

test('an empty record of disasters is not presented as nothing having happened', async () => {
  const r = await open();
  assert.equal(text(r, 'obTotal'), '0');
  assert.match(text(r, 'obNote'), /not a claim that nothing happened/i,
    'an empty ledger is being allowed to read as a quiet world');
  const rows = [...r.document.querySelectorAll('#obsRows tr')].map(t => t.textContent);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /No significant observed disaster has been recorded yet/);
  r.close();
});

test('matured forecasts are not called false positives against an empty record', async () => {
  const r = await open();
  assert.equal(text(r, 'ipMiss'), '0');
  assert.equal(text(r, 'cdMiss'), '0',
    'forecasts were graded as failures against a disaster record that cannot cover them');
  assert.match(text(r, 'cdNote'), /fall outside the period|record is empty/i,
    'the page does not say why none of them could be graded');
  r.close();
});

/* ------------------------------------------- the two performances are separate */

test('prediction performance and outlook performance are never one number', async () => {
  const r = await open();
  const body = r.text();
  assert.match(body, /Independent prediction performance/);
  assert.match(body, /Conditional \/ continuation outlook performance/);
  // Everything recorded is conditional, and the page says so on both sides.
  assert.equal(text(r, 'ipTotal'), '0');
  assert.ok(Number(text(r, 'cdTotal')) > 0, 'the conditional section is empty too, so nothing is being separated');
  r.close();
});

test('the weighting and the formulas are stated, not assumed', async () => {
  const r = await open();
  const m = text(r, 'methodNote');
  assert.match(m, /PARTIAL HIT weight = 0\.5/, 'the partial-hit weighting is not disclosed');
  assert.match(m, /weightedPrecision =/);
  assert.match(m, /eventRecall =/);
  assert.match(m, /F1 =/);
  assert.match(m, /verify-\d+\.\d+\.\d+/, 'the page does not say which engine version produced these');
  r.close();
});

test('F1 is never called accuracy', async () => {
  const r = await open();
  const body = r.text();
  assert.match(body, /F1 verification score/, 'F1 is not labelled as a verification score');
  assert.equal(/F1 accuracy|accuracy score/i.test(body), false, 'F1 is being presented as accuracy');
  assert.match(text(r, 'methodNote'), /not an accuracy/i);
  r.close();
});

test('the sample size and the period it covers are on the page', async () => {
  const r = await open();
  assert.match(text(r, 'mSample'), /\d+ windows/);
  assert.ok(text(r, 'mPeriod').length > 8, 'the page does not say what period it covers');
  assert.ok(text(r, 'mEarliest').length > 4, 'the page does not say when the earliest prospective forecast was');
  assert.ok(text(r, 'mUpdated').length > 8);
  r.close();
});

/* --------------------------------------------- every verdict can be checked */

test('a verdict is shown with what it required and what it matched', async () => {
  const r = await open();
  const heads = [...r.document.querySelectorAll('.ledger thead th')].map(t => t.textContent);
  for (const col of ['Verdict', 'Forecast class', 'Freeze time', 'Frozen target window', 'Threshold', 'Observed event']) {
    assert.ok(heads.includes(col), 'the history table does not show ' + col);
  }
  const row = r.document.querySelector('#rows tr');
  assert.ok(row, 'the history table rendered no rows');
  assert.ok(row.children.length >= 11, 'a history row does not carry the columns its header promises');
  r.close();
});

/* -------------------------------------- and once the record actually covers it */

test('the page does grade, and does publish rates, once the record covers the forecasts', async () => {
  /* The cheap way to pass every test above is to publish nothing at all, so
     this one runs the same page against a disaster record that does cover the
     recorded forecasts and requires real numbers to come out. */
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'outlook-ledger.json'), 'utf8'));
  const matured = ledger.filter(o => Date.parse(o.targetEnd) < Date.now());
  assert.ok(matured.length > 0, 'the recorded ledger holds no matured window to grade');
  const first = matured[0];

  const observed = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    events: [{
      canonicalEventId: 'OBS-test-1', hazard: 'flood', significant: true,
      significanceReason: 'Deaths reported (12).',
      onset: new Date(Date.parse(first.targetStart) + 3600e3).toISOString(),
      geography: { country: first.country || 'Nepal', region: first.region || null,
        lat: first.lat, lon: first.lon },
      deaths: 12, displaced: null, evidenceConfidence: 'CONFIRMED'
    }],
    retention: null
  };

  const r = await renderPage('accuracy.html', {
    mock: {},
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '—',
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes('observed-disasters.json')) {
          return { ok: true, status: 200, headers: { get: () => null },
            json: async () => observed, text: async () => JSON.stringify(observed) };
        }
        return real(input);
      };
    }
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const obs = [...r.document.querySelectorAll('#obsRows tr')].map(t => t.textContent);
  assert.equal(text(r, 'obTotal'), '1', 'the page ignored the disaster record it was given');
  assert.ok(obs[0].includes('OBS-test-1'), 'the observed disaster is not listed');
  assert.match(obs[0], /FALSE.NEGATIVE|COVERAGE_FAILURE|FORECAST_FAILURE|DATA_UNAVAILABLE|Predicted/,
    'the observed disaster carries no verdict about whether anything predicted it');
  // Something in the recorded ledger is now gradeable, so the conditional
  // section has to stop saying nothing could be.
  assert.ok(Number(text(r, 'cdMatured')) > 0,
    'with a covering disaster record, still nothing was graded');
  assert.notEqual(text(r, 'cdPrecision'), 'Not computable',
    'with gradeable outlooks, no rate was published');
  r.close();
});
