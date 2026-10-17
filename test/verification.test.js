'use strict';
/**
 * Verification presentation.
 *
 * A forecast is graded by putting what was predicted beside what was reported,
 * metric by metric. Windows are stated as a start plus an expected duration --
 * never as a date range, which reads as one continuous event and blurs a second
 * occurrence of the same hazard into the first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const METRICS = ['Area', 'Start date', 'Start time', 'Duration', 'How widespread',
  'Strength or severity', 'Lives lost', 'Missing people'];

test('the verification page compares forecast against actual, metric by metric', async () => {
  const r = await renderPage('verification-detail.html', {
    search: '?id=ND-001',
    waitFor: doc => doc.getElementById('compareRows').children.length > 0
  });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  const head = [...doc.querySelectorAll('table.matrix thead th')].map(th => th.textContent.trim());
  assert.deepEqual(head, ['Metric', 'Forecast', 'Actual'], 'the table is not forecast beside actual');

  const rows = [...doc.querySelectorAll('#compareRows tr')];
  assert.deepEqual(rows.map(tr => tr.cells[0].textContent.trim()), METRICS);

  for (const tr of rows) {
    assert.equal(tr.cells.length, 3, tr.cells[0].textContent + ' is not a three-column row');
    assert.ok(tr.cells[1].textContent.trim().length > 0, tr.cells[0].textContent + ' has no forecast value');
    assert.ok(tr.cells[2].textContent.trim().length > 0, tr.cells[0].textContent + ' has no actual value');
  }
  r.close();
});

test('an unreported metric says so rather than showing a zero', async () => {
  const r = await renderPage('verification-detail.html', {
    search: '?id=ND-001',
    waitFor: doc => doc.getElementById('compareRows').children.length > 0
  });
  const rows = [...r.document.querySelectorAll('#compareRows tr')];
  const missing = rows.find(tr => tr.cells[0].textContent.trim() === 'Missing people');
  assert.match(missing.cells[2].textContent, /Not reported by any of our sources/);
  // Casualties are not predicted, and the forecast column must say that rather
  // than imply a prediction of none.
  assert.match(missing.cells[1].textContent, /does not predict casualties/);
  r.close();
});

/* ------------------------------------------------------- start + duration */

test('a window is stated as a start and a duration, never a date range', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  const ranges = [];
  for (const f of files) {
    // Comments are not rendered, and a comment explaining the rule should not
    // trip the rule.
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    // "13-16 Sep" / "13-16 September": two day numbers joined by a dash.
    for (const m of src.matchAll(/\b\d{1,2}\s?[\u2013\u2014-]\s?\d{1,2}\s+(Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)/g)) {
      ranges.push(f + ': "' + m[0] + '"');
    }
    if (/Window ends/.test(src)) ranges.push(f + ': still says "Window ends"');
    // The first pass only looked for "13-16 Sep" and missed three pages joining
    // two formatted dates with an arrow.
    if (/targetStart[^;]{0,120}(→|&rarr;)[^;]{0,120}targetEnd/.test(src)) {
      ranges.push(f + ': joins targetStart and targetEnd with an arrow');
    }
  }
  assert.deepEqual(ranges, [], 'date ranges still rendered:\n' + ranges.join('\n'));
});

test('a stated duration matches what the helper computes for the same window', () => {
  // The benchmark window is 13 Sep 00:00 to 16 Sep 23:59, which is four
  // calendar days; every hard-coded copy said three, so the page contradicted
  // its own computed value.
  const src = read('portal.js');
  const body = src.match(/duration\(fromISO,toISO\)\{[\s\S]*?\n {2}\},/)[0]
    .replace(/^duration\(fromISO,toISO\)\{/, '').replace(/\},$/, '');
  const duration = new Function('fromISO', 'toISO', body);
  const computed = duration('2026-09-13T00:00:00Z', '2026-09-16T23:59:59Z');

  const stated = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js)$/.test(n)).concat(['api/events.js'])) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/(?:expected duration|lasts) (\d+ \w+)/g)) stated.push(f + ': ' + m[1]);
  }
  assert.ok(stated.length > 0, 'no stated duration found to check');
  const wrong = stated.filter(x => !x.endsWith(': ' + computed));
  assert.deepEqual(wrong, [], 'stated durations that disagree with ' + computed + ':\n' + wrong.join('\n'));
});

test('the duration helper reads in the units a reader expects', () => {
  const src = read('portal.js');
  const body = src.match(/duration\(fromISO,toISO\)\{[\s\S]*?\n {2}\},/)[0]
    .replace(/^duration\(fromISO,toISO\)\{/, '').replace(/\},$/, '');
  const duration = new Function('fromISO', 'toISO', body);

  assert.equal(duration('2026-09-13T00:00:00Z', '2026-09-16T00:00:00Z'), '3 days');
  assert.equal(duration('2026-09-13T00:00:00Z', '2026-09-14T12:00:00Z'), '36 hours');
  assert.equal(duration('2026-09-13T00:00:00Z', '2026-09-13T00:30:00Z'), 'under an hour');
  // An absent or backwards end date yields nothing rather than a bogus span.
  assert.equal(duration('2026-09-13T00:00:00Z', ''), '');
  assert.equal(duration('2026-09-16T00:00:00Z', '2026-09-13T00:00:00Z'), '');
});

test('a forecast card states when it starts and how long it is expected to run', async () => {
  const r = await renderPage('forecast-list.html', {
    waitFor: doc => /Starts /.test(doc.getElementById('cards').textContent)
  });
  const text = r.document.getElementById('cards').textContent;
  assert.match(text, /Starts /, 'no start stated on the forecast cards');
  assert.match(text, /lasts \d|length not stated/, 'no duration stated');
  assert.ok(!/\d{1,2}\s?[\u2013\u2014]\s?\d{1,2}\s+\w{3}/.test(text), 'a date range is still rendered');
  r.close();
});
