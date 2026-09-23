'use strict';
/**
 * The verification page, which reported a record it did not have.
 *
 * The verification ledger writes MISS_FALSE_POSITIVE and
 * FALSE_NEGATIVE_UNPREDICTED_EVENT. accuracy.html bucketed on FALSE_ALARM and
 * MISSED_EVENT. No record matched either bucket, so over a ledger holding one
 * partial verification, five false alarms and two missed events, the live page
 * published: false alarms 0, missed events 0, severe-event recall 100%.
 *
 * Two further defects sat underneath it. The outlook ledger is append-only and
 * re-records a rolling outlook every time it is re-issued, so one id can carry
 * several windows; joining a verdict on the id alone stamped one false-alarm
 * verdict onto all three of OUT-gdacs-WF-1031965's windows. And a window that
 * had closed with nobody checking it was labelled "PENDING", exactly like one
 * that had not opened yet — hiding that 144 of 150 matured windows have never
 * been graded at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const V = require(path.join(ROOT, 'verdicts.js'));
const OUTLOOKS = require(path.join(ROOT, 'data', 'outlook-ledger.json'));
const LEDGER = require(path.join(ROOT, 'data', 'verification-ledger.json'));

test.after(closeAllWindows);

const settled = d => (d.getElementById('mTotal') || {}).textContent !== '—';

/* ---------- the vocabulary must cover what the ledgers actually write ---------- */

test('every status in the shipped ledgers is a status the code recognises', () => {
  const seen = new Set();
  for (const v of LEDGER.verifications || []) seen.add(v.status);
  for (const o of LEDGER.observedEvents || []) seen.add(o.status);
  for (const o of OUTLOOKS) if (o.outcome) seen.add(o.outcome);
  const unknown = [...seen].filter(s => V.normalise(s) === 'UNKNOWN');
  assert.deepEqual(unknown, [],
    'these ledger verdicts fall through every bucket and are counted as nothing');
  assert.ok(seen.size >= 2, 'the ledger should carry more than one kind of verdict');
});

test('an unrecognised verdict is surfaced, not silently bucketed', () => {
  assert.equal(V.normalise('SOMETHING_NEW'), 'UNKNOWN');
  const t = V.tally([{ status: 'SOMETHING_NEW' }], Date.now());
  assert.equal(t.unknown, 1);
  /* It must not land in any of the buckets that would flatter or damn it. */
  assert.equal(t.verified + t.partial + t.falseAlarm + t.missed, 0);
});

test('both spellings of each verdict reach the same bucket', () => {
  assert.equal(V.normalise('MISS_FALSE_POSITIVE'), V.normalise('FALSE_ALARM'));
  assert.equal(V.normalise('FALSE_NEGATIVE_UNPREDICTED_EVENT'), V.normalise('MISSED_EVENT'));
  assert.equal(V.normalise('PARTIAL_VERIFICATION'), V.normalise('PARTIAL'));
});

/* ---------- a verdict belongs to one window ---------- */

test('a verdict is not stamped onto windows it never judged', () => {
  const rolling = OUTLOOKS.filter(o => o.id === 'OUT-gdacs-WF-1031965');
  assert.ok(rolling.length > 1,
    'this fixture relies on the ledger holding a re-issued outlook');
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const graded = records.filter(r => r.id === 'OUT-gdacs-WF-1031965' && r.status);
  assert.equal(graded.length, 1,
    `one verdict was applied to ${graded.length} of this outlook's windows`);
  /* And it is the window the verdict actually names. */
  const verdict = LEDGER.verifications.find(v => v.id === 'OUT-gdacs-WF-1031965');
  assert.equal(Date.parse(graded[0].targetStart), Date.parse(verdict.targetStart));
});

test('no verdict is quietly dropped on the way in', () => {
  const { unattached } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  assert.deepEqual(unattached.map(u => u.id), [],
    'these verdicts match no recorded window and stopped counting');
});

test('joining never invents or loses a row', () => {
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  assert.equal(records.length, OUTLOOKS.length);
});

test('a merged verdict cannot overwrite the window it was matched to', () => {
  /* The verdict for ND-001 disagrees with the ledger about the window by 17
     hours. Whichever is right, the merge must keep the recorded window so a
     verdict cannot retroactively move the goalposts. */
  const row = OUTLOOKS.find(o => o.id === 'ND-001');
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const merged = records.find(r => r.id === 'ND-001');
  assert.equal(merged.targetStart, row.targetStart);
  assert.equal(merged.targetEnd, row.targetEnd);
});

/* ---------- "not yet judged" is not "fine" ---------- */

test('a closed unchecked window is distinguished from one still open', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  const open = { targetEnd: '2026-09-25T00:00:00Z' };
  const closed = { targetEnd: '2026-09-15T00:00:00Z' };
  assert.equal(V.stateOf(open, now), 'OPEN');
  assert.equal(V.stateOf(closed, now), 'AWAITING');
  assert.notEqual(V.OCCURRED.OPEN, V.OCCURRED.AWAITING);
});

test('the unchecked backlog is counted, not absorbed into the good news', () => {
  const now = Date.parse('2026-09-20T21:01:00Z');
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const t = V.tally(records.concat(LEDGER.observedEvents), now);
  assert.ok(t.awaiting > 100, `only ${t.awaiting} awaiting — check the fixture`);
  /* The graded count must be the verdicts, not the whole ledger. */
  assert.equal(t.graded, t.verified + t.partial + t.falseAlarm);
  assert.ok(t.graded < t.awaiting,
    'more records are graded than are waiting — the backlog has been miscounted');
});

/* ---------- rates carry their denominators ---------- */

test('a rate is never printed without the count it came from', () => {
  const r = V.rate(1, 6);
  assert.match(r.text, /1 of 6/);
  assert.equal(V.rate(0, 0).pct, null);
  assert.match(V.rate(0, 0).text, /Not enough/);
});

test('recall counts the events that were missed, not only the ones caught', () => {
  const now = Date.now();
  const recs = [{ status: 'VERIFIED' }, { status: 'MISSED_EVENT' }, { status: 'MISSED_EVENT' }];
  const t = V.tally(recs, now);
  /* The defect: MISSED_EVENT matched no bucket, the denominator became 1, and
     one hit out of three known events read as 100%. */
  assert.equal(t.recall.total, 3);
  assert.equal(t.recall.pct, 33);
});

/* ---------- what the page actually publishes ---------- */

test('the published figures equal the ledgers, recomputed independently', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  const num = id => Number(doc.getElementById(id).textContent);
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const t = V.tally(records.concat(LEDGER.observedEvents), Date.now());
  assert.equal(num('mTotal'), OUTLOOKS.length);
  assert.equal(num('mGraded'), t.graded);
  assert.equal(num('mVerified'), t.verified);
  assert.equal(num('mPartial'), t.partial);
  assert.equal(num('mFalse'), t.falseAlarm);
  assert.equal(num('mMissed'), t.missed);
  /* The unchecked backlog is now split in two: windows the engine graded as
     ungradeable (it looked, and the written record of observed disasters
     cannot answer them) and windows carrying no verdict at all. The split is
     the point - "nobody checked" and "nothing can answer this" are different
     statements - but the total may not shrink, which is how the backlog would
     quietly disappear. */
  assert.equal(num('mAwaiting') + num('mUngradeable'), t.awaiting,
    'the unchecked backlog changed size when it was split');
  assert.ok(num('mUngradeable') > 0,
    'every matured window is still reported as merely unchecked');
  /* The specific regression: the page reported none of these. */
  assert.ok(t.falseAlarm > 0 && num('mFalse') > 0, 'graded false alarms vanished again');
  assert.ok(t.missed > 0 && num('mMissed') > 0, 'missed events vanished again');
  window.close();
});

test('no headline rate is shown as a bare percentage', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  /* The two unqualified tiles this used to guard were removed: they published
     a hit rate over six hand-entered verdicts in the largest type on the page,
     above the section that exists to explain why such a number is not a
     prediction rate. The rule they were guarding is unchanged and now applies
     to the rates that replaced them. */
  for (const id of ['ipPrecision', 'ipRecall', 'ipF1', 'cdPrecision']) {
    const txt = doc.getElementById(id).textContent;
    assert.match(txt, /\([^)]*\d+[^)]*\)|Not computable|Not enough/,
      `${id} reads "${txt}" — a rate with no denominator`);
  }
  window.close();
});

test('the page never claims a perfect record while its ledger records failures', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  const failures = (LEDGER.verifications || []).filter(v => V.normalise(v.status) === 'FALSE_ALARM').length
    + (LEDGER.observedEvents || []).filter(o => V.normalise(o.status) === 'MISSED').length;
  if (failures > 0) {
    assert.equal(/^100(\.0)?%/.test(doc.getElementById('ipRecall').textContent.trim()), false,
      'the page claims perfect recall while its ledger records failures');
    assert.notEqual(Number(doc.getElementById('mFalse').textContent) + Number(doc.getElementById('mMissed').textContent), 0,
      'the ledger records failures the page reports as zero');
  }
  window.close();
});

test('every graded prediction gets a predicted-against-observed comparison', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  const { records } = V.joinVerdicts(OUTLOOKS, LEDGER.verifications);
  const t = V.tally(records.concat(LEDGER.observedEvents), Date.now());
  const cards = doc.querySelectorAll('#cmpList .cmp');
  assert.equal(cards.length, t.graded, 'a graded prediction has no comparison');
  const txt = cards[0].textContent;
  for (const heading of ['What was predicted', 'What actually happened']) {
    assert.ok(txt.includes(heading), `the comparison is missing "${heading}"`);
  }
  window.close();
});

test('every ledger row answers whether it occurred', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  const answers = new Set(Object.values(V.OCCURRED));
  const rows = [...doc.querySelectorAll('#rows tr')];
  assert.ok(rows.length > 100, `only ${rows.length} rows rendered`);
  for (const r of rows.slice(0, 60)) {
    const cell = r.querySelectorAll('td')[1];
    assert.ok(answers.has(cell.textContent.trim()),
      `a row answers "${cell.textContent.trim()}", which is not one of the defined answers`);
  }
  window.close();
});

test('the verdict filter offers exactly the values the filter compares', async () => {
  const { window } = await renderPage('accuracy.html', { timeoutMs: 20000, waitFor: settled });
  const doc = window.document;
  const opts = [...doc.querySelectorAll('#outcome option')]
    .map(o => o.value).filter(Boolean);
  assert.ok(opts.length >= 5);
  for (const o of opts) {
    assert.ok(Object.prototype.hasOwnProperty.call(V.LABELS, o),
      `the dropdown offers "${o}", which no record can ever be in`);
  }
  window.close();
});

/* ---------- the collision class that killed the page's whole script ---------- */

test('no shared module leaks a bare top-level binding', () => {
  /* verdicts.js declared `const V` at the top level of a classic script, which
     is a global binding: the page's own `const V` then threw
     "Identifier 'V' has already been declared" and killed the entire inline
     script, blanking the page.

     Asserted by running each module the way a browser does — as a classic
     script in a fresh context — and looking at what it left behind, rather
     than by pattern-matching the source. */
  const vm = require('node:vm');
  for (const mod of ['search.js', 'verdicts.js']) {
    const ctx = vm.createContext({ window: {}, location: { search: '' }, console });
    const before = new Set(Object.getOwnPropertyNames(ctx));
    vm.runInContext(read(mod), ctx, { filename: mod });
    const after = Object.getOwnPropertyNames(ctx).filter(k => !before.has(k));
    assert.deepEqual(after, [],
      `${mod} leaves ${after.join(', ')} in the global scope, where a page's own script can collide with it`);
    /* And it must still have published itself the intended way. */
    assert.equal(typeof ctx.window[mod === 'search.js' ? 'PNDSearch' : 'PNDVerdicts'], 'object',
      `${mod} no longer exports itself`);
  }
});
