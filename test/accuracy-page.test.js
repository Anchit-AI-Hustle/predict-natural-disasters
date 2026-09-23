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

/* ---------------------------------------- a record that can actually grade */

/* A scan ledger and a disaster record that genuinely support grading.
 *
 * Both have to be truthful about the provider, not merely present: a
 * provider's silence counts as evidence that nothing happened only where that
 * provider is exhaustive for the hazard. GDACS is not - it carries only what
 * it raises to an alert level - so the fixture uses USGS and an earthquake,
 * which is the one combination in the real provider table where an absence
 * means something. The values are copied from api/events.js.
 */
const USGS = {
  label: 'USGS Earthquake Hazards Program',
  hazards: ['Earthquake'],
  geographicCoverage: 'Global',
  scope: { kind: 'global' },
  completeness: 'exhaustive',
  completenessBasis: 'A complete catalogue of earthquakes of magnitude 2.5 and above for the past seven days, so an absence above that threshold is meaningful.',
  /* And its records are observations of events that happened, which is the
     other half of what an absence needs. */
  recordsObservations: true
};

function gradingFixture() {
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'outlook-ledger.json'), 'utf8'));
  const OBSM = require(path.join(ROOT, 'observed-model.js'));
  const matured = ledger.filter(o => Date.parse(o.targetEnd) < Date.now() &&
    OBSM.familyOf(o.type, o.title) === 'earthquake');
  assert.ok(matured.length > 0, 'the recorded ledger holds no matured earthquake window to grade');
  const target = matured[0];
  assert.equal(ledger.filter(o => o.id === target.id).length, 1,
    'the fixture target holds more than one window, so a row cannot be identified by its id');
  const first = Math.min(...matured.map(o => Date.parse(o.targetStart)));
  const last = Math.max(...matured.map(o => Date.parse(o.targetEnd)));
  /* Scans at the job's real cadence across the whole span, not one at each
     end: coverage is an unbroken run of scans now, and two instants a week
     apart cover the two instants and nothing in between. */
  const STEP = 3 * 3600e3;
  const scans = [];
  for (let t = first - 3600e3; t <= last + 3600e3; t += STEP) {
    scans.push({ scanTimestamp: new Date(t).toISOString(),
      providers: [{ provider: 'usgs', status: 'SCANNED' }] });
  }
  const scan = { schemaVersion: 1, providers: { usgs: USGS }, scans: scans };
  const observed = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    events: [{
      canonicalEventId: 'OBS-test-1', hazard: 'earthquake', significant: true,
      significanceReason: 'Deaths reported (12).',
      onset: new Date(Date.parse(target.targetStart) + 3600e3).toISOString(),
      geography: { country: target.country, region: target.region,
        lat: target.lat, lon: target.lon },
      deaths: 12, displaced: null, evidenceConfidence: 'CONFIRMED'
    }],
    retention: null
  };
  return { target, scan, observed };
}

function openWith({ scan, observed }) {
  return renderPage('accuracy.html', {
    mock: {},
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '\u2014',
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        const serve = body => ({ ok: true, status: 200, headers: { get: () => null },
          json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('observed-disasters.json')) return serve(observed);
        if (url.includes('scan-ledger.json')) return serve(scan);
        return real(input);
      };
    }
  });
}

test('the page does grade, and does publish rates, once the record covers the forecasts', async () => {
  /* The cheap way to pass every test above is to publish nothing at all, so
     this one runs the same page against a disaster record that does cover the
     recorded forecasts and requires real numbers to come out. */
  const fx = gradingFixture();
  const r = await openWith(fx);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const obs = [...r.document.querySelectorAll('#obsRows tr')].map(t => t.textContent);
  assert.equal(text(r, 'obTotal'), '1', 'the page ignored the disaster record it was given');
  assert.ok(obs[0].includes('OBS-test-1'), 'the observed disaster is not listed');
  assert.match(obs[0], /FALSE.NEGATIVE|COVERAGE_FAILURE|FORECAST_FAILURE|DATA_UNAVAILABLE|NO_PROSPECTIVE_INPUT|NOT_FORECASTABLE|Predicted/,
    'the observed disaster carries no verdict about whether anything predicted it');
  // Something in the recorded ledger is now gradeable, so the conditional
  // section has to stop saying nothing could be.
  assert.ok(Number(text(r, 'cdMatured')) > 0,
    'with a covering disaster record, still nothing was graded');
  assert.notEqual(text(r, 'cdPrecision'), 'Not computable',
    'with gradeable outlooks, no rate was published');
  r.close();
});

/* ------------------------------- the figures and the rows are one grading */

test('a window the engine graded is shown graded on its own row', async () => {
  /* The defect: headline precision and recall were computed from the engine
     while each row kept the state the hand-written ledger gave it. A window
     counted as a hit above could read "Awaiting verification" in the table
     below it, be filtered out by the verdict control, and be missing from the
     comparison section entirely. */
  const fx = gradingFixture();
  const r = await openWith(fx);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const V = require(path.join(ROOT, 'verdicts.js'));
  const ver = r.window.__verification;
  const decided = ver.verdicts
    .map((v, i) => ({ v, p: ver.preds[i] }))
    .filter(x => Object.prototype.hasOwnProperty.call(V.ENGINE_STATES, x.v.classification));
  assert.ok(decided.length > 0, 'the fixture graded nothing, so this proves nothing');

  /* Keyed by the whole claim, because two rows can share an id and a window
     start: that is what makes one a revision of the other rather than a
     re-issue, and it is exactly the pair that used to collapse them. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const byWindow = new Map(ver.records.map(rec => [H.claimKey(rec), rec]));
  for (const { v, p } of decided) {
    const rec = byWindow.get(H.claimKey(p));
    assert.ok(rec, 'a graded window is missing from the records the page renders: ' + p.id);
    assert.equal(rec._state, V.ENGINE_STATES[v.classification],
      p.id + ' was graded ' + v.classification + ' but its row carries ' + rec._state);
  }

  /* And the row itself says so, not just the object behind it. */
  const row = [...r.document.querySelectorAll('#rows tr')]
    .find(tr => tr.children[0] && tr.children[0].textContent.includes(fx.target.id));
  assert.ok(row, 'the graded window has no row in the history table');
  const shown = row.children[2].textContent;
  const want = V.LABELS[V.ENGINE_STATES[ver.byId.get(H.claimKey(fx.target)).classification]];
  assert.ok(shown.startsWith(want), 'the row for ' + fx.target.id + ' displays "' + shown.slice(0, 40) + '", not "' + want + '"');
  assert.equal(/Awaiting verification/.test(shown), false,
    'a window the engine graded still reads as awaiting verification');
  r.close();
});

test('a graded window appears in the predicted-against-observed comparison', async () => {
  const fx = gradingFixture();
  const r = await openWith(fx);
  const V = require(path.join(ROOT, 'verdicts.js'));
  const graded = ver => ver.records.filter(x => ['VERIFIED', 'PARTIAL', 'FALSE_ALARM'].includes(x._state));
  const ver = r.window.__verification;
  assert.ok(graded(ver).length > 0, 'nothing was graded, so this proves nothing');
  const cards = [...r.document.querySelectorAll('#cmpList .cmp')];
  assert.equal(cards.length, graded(ver).length,
    'the comparison section shows ' + cards.length + ' of ' + graded(ver).length + ' graded windows');
  assert.ok(cards.some(c => c.textContent.includes(fx.target.id)),
    'the window the engine graded is missing from the comparison section');
  assert.ok(V.LABELS.UNGRADEABLE, 'the vocabulary lost its ungradeable state');
  r.close();
});

test('a matured window nothing can grade is not reported as merely unchecked', async () => {
  /* "Nobody has checked this" and "nothing on record can answer it" are
     different statements, and the second was being published as the first. */
  const r = await open();
  assert.ok(Number(text(r, 'mUngradeable')) > 0,
    'every matured window is still reported as simply unchecked');
  assert.match(text(r, 'honesty'), /cannot be graded either way/i,
    'the page does not say why those windows count towards nothing');
  const labels = [...r.document.querySelectorAll('#rows tr')]
    .map(tr => tr.children[2] && tr.children[2].textContent).filter(Boolean);
  assert.ok(labels.some(t => t.startsWith('Not gradeable')),
    'no row reports itself as not gradeable');
  const ungradeable = labels.filter(t => t.startsWith('Not gradeable'));
  assert.ok(ungradeable.every(t => t.length > 'Not gradeable'.length + 20),
    'a row says it cannot be graded without saying why');
  r.close();
});

test('a hand-recorded verdict the engine cannot reproduce is kept, shown and excluded from the rates', async () => {
  /* The opposite failure to the one above, and just as bad: letting the
     engine's inability to reproduce a verdict quietly erase five recorded
     false alarms, which is how this page once came to publish a perfect
     record. The verdict stays, the row says where it came from, and the
     engine's rates are still computed without it. */
  const r = await open();
  const ver = r.window.__verification;
  const unreproduced = ver.records.filter(x => x._engineUnreproduced);
  assert.ok(unreproduced.length > 0,
    'the recorded ledger holds no hand-graded verdict, so this proves nothing');
  assert.ok(Number(text(r, 'mFalse')) > 0,
    'hand-recorded false alarms disappeared from the figures');
  assert.match(text(r, 'honesty'), /recorded by hand/i,
    'the page does not disclose that some verdicts were recorded by hand');
  assert.match(text(r, 'honesty'), /engine cannot reproduce/i,
    'the page presents hand-recorded verdicts as the engine\u2019s own');
  assert.match(text(r, 'honesty'), new RegExp(String(unreproduced.length) + ' recorded by hand'),
    'the hand-recorded verdicts are not counted in the note');
  const row = [...r.document.querySelectorAll('#rows tr')]
    .find(tr => tr.children[0] && tr.children[0].textContent.includes(unreproduced[0].id));
  assert.ok(row, 'a hand-graded window has no row');
  assert.match(row.children[2].textContent, /Recorded by hand/,
    'a hand-recorded verdict is displayed as though the engine had produced it');
  // And it counts towards no engine rate.
  assert.equal(text(r, 'ipPrecision'), 'Not computable');
  r.close();
});

test('a ledger it could not read is not a ledger that is empty', async () => {
  /* Both new fetches caught into a valid-looking empty ledger, so a transient
     network or deployment error was indistinguishable from "nothing has been
     recorded yet" — and the page then explained at length that an empty
     record is not a claim that nothing happened, while itself making exactly
     that substitution. */
  const r = await renderPage('accuracy.html', {
    mock: {},
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '\u2014',
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes('observed-disasters.json') || url.includes('scan-ledger.json')) {
          return { ok: false, status: 503, headers: { get: () => null },
            json: async () => ({}), text: async () => '' };
        }
        return real(input);
      };
    }
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const banner = r.document.getElementById('ledgerError');
  assert.ok(banner, 'a failed ledger fetch is reported as an empty ledger, with no warning at all');
  assert.match(banner.textContent, /could not be loaded/i);
  assert.match(banner.textContent, /not the same as nothing having been recorded/i);
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(text(r, 'obNote'), /could not read/i,
    'the observed-disasters note still reads as though the record were empty');
  r.close();
});

test('two claims under one id keep their own verdicts', async () => {
  /* A claim is all of its frozen terms, so an outlook whose window is
     extended is recorded as a second claim rather than an edit of the first.
     The page keyed its engine verdicts on the id and the window's start,
     which those two share - so one verdict overwrote the other and both rows
     were shown the survivor's, while the rates below were computed from two
     distinct verdicts. The table could report a hit against the claim that
     failed. */
  const fx = gradingFixture();
  const base = fx.target;
  const revised = Object.assign({}, base, {
    targetEnd: new Date(Date.parse(base.targetEnd) + 3 * 864e5).toISOString()
  });
  const ledger = [base, revised];
  const r = await renderPage('accuracy.html', {
    mock: {},
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '\u2014',
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        const serve = body => ({ ok: true, status: 200, headers: { get: () => null },
          json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('outlook-ledger.json')) return serve(ledger);
        if (url.includes('observed-disasters.json')) return serve(fx.observed);
        if (url.includes('scan-ledger.json')) return serve(fx.scan);
        return real(input);
      };
    }
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const state = r.window.__verification;
  assert.ok(state, 'the page published no verification state');
  assert.equal(state.preds.length, 2, 'control: the ledger should hold two claims');
  assert.equal(state.byId.size, 2,
    'the two claims collapsed into one verdict, so a row can be shown the wrong one');
  const H = require(path.join(ROOT, 'hazard-model.js'));
  assert.notEqual(H.claimKey(base), H.claimKey(revised),
    'control: these must be different claims for this to prove anything');
  for (const p of state.preds) {
    assert.ok(state.byId.has(H.claimKey(p)), 'a claim has no verdict of its own');
  }
  /* Both rows are in the table, each with its own window. */
  const windows = [...r.document.querySelectorAll('#rows tr')]
    .map(tr => (tr.children[7] || {}).textContent || '');
  assert.ok(windows.some(w => w.includes(String(new Date(base.targetEnd).getFullYear()))),
    'control: the table should show the recorded windows');
  assert.equal(new Set([...r.document.querySelectorAll('#rows tr')].map(tr => tr.textContent)).size,
    [...r.document.querySelectorAll('#rows tr')].length,
    'the two claims rendered as identical rows');
  r.close();
});

test('a ledger it could not read is not graded against', async () => {
  /* The banner was not enough. A failed observed-ledger fetch still became an
     empty array and was handed to the verifier, and with a scan ledger that
     establishes exhaustive coverage every matured window then graded as a
     false positive against a record the page had never read. The warning sat
     above a table of fabricated verdicts. */
  const fx = gradingFixture();
  const r = await renderPage('accuracy.html', {
    mock: {},
    waitFor: d => (d.getElementById('ipTotal') || {}).textContent !== '\u2014',
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes('observed-disasters.json')) {
          return { ok: false, status: 503, headers: { get: () => null },
            json: async () => ({}), text: async () => '' };
        }
        if (url.includes('scan-ledger.json')) {
          return { ok: true, status: 200, headers: { get: () => null },
            json: async () => fx.scan, text: async () => JSON.stringify(fx.scan) };
        }
        return real(input);
      };
    }
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.ok(r.document.getElementById('ledgerError'), 'control: the banner should be up');
  for (const id of ['ipHit', 'ipPartial', 'ipMiss', 'cdHit', 'cdPartial', 'cdMiss',
    'obFalseNeg', 'obCoverage', 'obForecast']) {
    assert.equal(text(r, id), 'Unavailable',
      id + ' published a count graded against a record the page could not read');
  }
  for (const id of ['ipPrecision', 'ipRecall', 'ipF1', 'cdPrecision']) {
    assert.equal(text(r, id), 'Unavailable', id + ' published a rate from nothing');
  }
  const verdicts = [...r.document.querySelectorAll('#rows tr')]
    .map(t => (t.children[2] || {}).textContent || '');
  assert.ok(verdicts.length > 0, 'control: the ledger rows should still be listed');
  for (const v of verdicts) {
    assert.match(v, /Unavailable/,
      'a row published a verdict reached against a record that was never read');
  }
  r.close();
});

test('a ledger that really is empty is still reported as empty', async () => {
  // The control: the committed ledgers ship empty, and that is not an error.
  const r = await open();
  assert.equal(r.document.getElementById('ledgerError'), null,
    'a ledger that loaded fine was reported as unavailable');
  assert.match(text(r, 'obNote'), /not a claim that nothing happened/i);
  r.close();
});
