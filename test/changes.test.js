'use strict';
/**
 * "Has anything changed in the forecasts since I last looked", and how often
 * anything actually checks.
 *
 * The ledger is append-only and keyed by id plus window, so a re-issued
 * outlook is appended as a row indistinguishable from a brand-new one, and an
 * outlook that stopped being issued left no trace at all. Nothing could answer
 * what had moved.
 *
 * The schedule was worse. The workflow asked for every five minutes and the
 * feed advertised "refreshTarget: 5 minutes". Measured from the ledger's own
 * write times across 15-20 September, GitHub ran it every 2.02 to 5.57 hours,
 * median 3.66 — about a fortieth of the declared rate. The site published the
 * intention as though it were the outcome.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'record-changes.js');

test.after(closeAllWindows);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-changes-'));
}
function outlook(over) {
  return Object.assign({
    id: 'OUT-a', forecast: true, type: 'Flood', title: '3-day Flood risk outlook',
    country: 'Testland', alert: 'Watch', severityRank: 2,
    targetStart: '2026-09-20T00:00:00Z', targetEnd: '2026-09-23T00:00:00Z'
  }, over || {});
}
function run(dir, events) {
  const feed = path.join(dir, 'events.json');
  const log = path.join(dir, 'changes.json');
  fs.writeFileSync(feed, JSON.stringify({ events }));
  execFileSync(process.execPath, [TOOL, feed, log], { encoding: 'utf8' });
  return JSON.parse(fs.readFileSync(log, 'utf8'));
}

/* ---------- the recorder ---------- */

test('the first run is a baseline, not thirty brand-new forecasts', () => {
  const d = tmp();
  const log = run(d, [outlook(), outlook({ id: 'OUT-b' })]);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.baseline, true);
  assert.deepEqual(last.added, [], 'every existing outlook was reported as new');
  assert.equal(last.active, 2);
});

test('an empty run does not make the next one a second baseline', () => {
  /* `first` was read from whether the previous snapshot had entries. A run
     that legitimately finds no open outlooks writes an empty snapshot, so the
     next run looked like a first run: every newly issued outlook was
     suppressed from `added` and the panel claimed there was nothing earlier to
     compare against, despite the history sitting right there. */
  const d = tmp();
  run(d, [outlook()]);
  const empty = run(d, []);
  assert.equal(empty.runs[empty.runs.length - 1].baseline, false);
  const after = run(d, [outlook({ id: 'OUT-new', title: 'Issued after the gap' })]);
  const last = after.runs[after.runs.length - 1];
  assert.equal(last.baseline, false,
    'a run with three runs behind it was reported as a baseline');
  assert.deepEqual(last.added.map(x => x.id), ['OUT-new'],
    'the newly issued outlook was suppressed');
});

test('an unchanged forecast set records no change', () => {
  const d = tmp();
  run(d, [outlook()]);
  const log = run(d, [outlook()]);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.added.length + last.raised.length + last.lowered.length +
    last.windowMoved.length + last.gone.length, 0);
});

test('a newly issued outlook is recorded as new', () => {
  const d = tmp();
  run(d, [outlook()]);
  const log = run(d, [outlook(), outlook({ id: 'OUT-new', title: 'New one' })]);
  const last = log.runs[log.runs.length - 1];
  assert.deepEqual(last.added.map(x => x.id), ['OUT-new']);
});

test('a raised level is told apart from a lowered one', () => {
  const d = tmp();
  run(d, [outlook()]);
  let log = run(d, [outlook({ alert: 'Red', severityRank: 6 })]);
  let last = log.runs[log.runs.length - 1];
  assert.equal(last.raised.length, 1);
  assert.equal(last.lowered.length, 0);
  assert.equal(last.raised[0].from, 'Watch');
  assert.equal(last.raised[0].to, 'Red');
  log = run(d, [outlook({ alert: 'Green', severityRank: 1 })]);
  last = log.runs[log.runs.length - 1];
  assert.equal(last.lowered.length, 1);
  assert.equal(last.raised.length, 0);
});

test('a window pushed out is recorded, with both ends', () => {
  const d = tmp();
  run(d, [outlook()]);
  const log = run(d, [outlook({ targetEnd: '2026-09-27T00:00:00Z' })]);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.windowMoved.length, 1);
  assert.equal(last.windowMoved[0].fromEnd, '2026-09-23T00:00:00Z');
  assert.equal(last.windowMoved[0].toEnd, '2026-09-27T00:00:00Z');
});

test('an outlook that stopped being issued is recorded as gone', () => {
  const d = tmp();
  run(d, [outlook(), outlook({ id: 'OUT-b' })]);
  const log = run(d, [outlook()]);
  const last = log.runs[log.runs.length - 1];
  assert.deepEqual(last.gone.map(x => x.id), ['OUT-b']);
});

test('a closed window is not counted as an outlook that vanished', () => {
  /* This test previously asserted the defect its own comment described: it
     checked that a window which had simply ended landed in `gone`, which the
     page renders as "the signal behind it stopped". A completed forecast is
     the outlook doing exactly what it said; only a withdrawal is a
     withdrawal. */
  const d = tmp();
  run(d, [outlook({ targetEnd: '2020-01-02T00:00:00Z' })]);
  const log = run(d, []);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.active, 0);
  assert.equal(last.gone.length, 0,
    'a window that ended on schedule was reported as a withdrawn signal');
  assert.equal(last.expired.length, 1);
  assert.equal(last.expired[0].id, 'OUT-a');
});

test('an outlook that stops being issued mid-window is still a withdrawal', () => {
  const d = tmp();
  run(d, [outlook({ targetEnd: '2099-01-01T00:00:00Z' })]);
  const log = run(d, []);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.gone.length, 1, 'a live signal that stopped was not reported');
  assert.equal(last.expired.length, 0);
});

test('both reasons are counted, and neither is silent', () => {
  const d = tmp();
  run(d, [outlook({ id: 'ends', targetEnd: '2020-01-02T00:00:00Z' }),
    outlook({ id: 'stops', targetEnd: '2099-01-01T00:00:00Z' })]);
  const log = run(d, []);
  const last = log.runs[log.runs.length - 1];
  assert.deepEqual(last.expired.map(x => x.id), ['ends']);
  assert.deepEqual(last.gone.map(x => x.id), ['stops']);
});

test('the page words an ended window differently from a stopped signal', async () => {
  const { window } = await renderPage('forecasts.html', { timeoutMs: 15000,
    waitFor: d => !((d.getElementById('changes') || {}).textContent || '').includes('Loading') });
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: { at: '2026-09-20T12:00:00Z', sinceHours: 1,
    activeOutlooks: 5, baseline: false, total: 2,
    records: { gone: [{ id: 'a', title: 'Withdrawn outlook' }],
      expired: [{ id: 'b', title: 'Completed outlook' }] } } });
  assert.match(html, /No longer issued/);
  assert.match(html, /Window closed as scheduled/);
  /* The completed one must not carry the withdrawal wording. */
  const completed = html.slice(html.indexOf('Window closed as scheduled'));
  assert.doesNotMatch(completed, /the signal behind it stopped/);
  window.close();
});

test('a run that saw movement is committed so it can reach production', () => {
  /* /api/events reads data/forecast-changes.json out of the deployed bundle,
     and vercel.json skips any deployment whose commit carries "[ledger]".
     Marking every scheduled run with it would have left production showing
     the first baseline forever. */
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows',
    'refresh-disaster-data.yml'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  /* The marker is written for grep there, so it reads \[ledger\]. */
  assert.match(vercel.ignoreCommand || '', /ledger/,
    'this test assumes the marker still gates deployment');
  /* There must be a path that commits without the marker. */
  const commits = [...wf.matchAll(/git commit -m "([^"]+)"/g)].map(m => m[1]);
  assert.ok(commits.length >= 2,
    'the workflow has only one commit message, so either every run deploys or none does');
  assert.ok(commits.some(c => !c.includes('[ledger]')),
    'every scheduled commit is marked [ledger], so no change log ever reaches production');
  assert.ok(commits.some(c => c.includes('[ledger]')),
    'no run is skippable, so a quiet hour spends a deployment');
  /* And the choice must be driven by whether anything actually moved. */
  assert.match(wf, /forecast-changes\.json/);
  assert.match(wf, /moved=/, 'nothing decides which commit message is used');
});

test('the history is bounded so the log cannot grow without limit', () => {
  const d = tmp();
  const feed = path.join(d, 'events.json');
  const log = path.join(d, 'changes.json');
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(feed, JSON.stringify({ events: [outlook({ alert: 'W' + i, severityRank: i })] }));
    execFileSync(process.execPath, [TOOL, feed, log]);
  }
  const parsed = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(parsed.runs.length, 12);
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /MAX_RUNS\s*=\s*\d+/, 'the history has no cap');
});

/* ---------- the cadence claim ---------- */

test('the feed no longer advertises a refresh rate nothing meets', async () => {
  const r = await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', {});
  const d = await r.json();
  assert.notEqual(d.meta.refreshTarget, '5 minutes',
    'the feed still claims a five-minute refresh; the measured median is 3.66 hours');
  assert.doesNotMatch(String(d.meta.refreshTarget), /\b5 minutes\b/);
});

test('nothing in the site hard-codes the five-minute claim any more', () => {
  const offenders = [];
  /* The api/ directory too: the first version of this test scanned only the
     site root and missed api/event-enrichment.js, which published the same
     claim into every detail page's source panel. */
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f)).map(f => f)
    .concat(fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f))
      .map(f => path.join('api', f)));
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    /* The comment explaining the old claim is allowed to name it; a value
       published to a reader is not. */
    for (const m of s.matchAll(/'5 minutes'|"5 minutes"/g)) offenders.push(f + ': ' + m[0]);
  }
  assert.deepEqual(offenders, []);
});

test('the recorded cadence is measured, not declared', async () => {
  const r = await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', {});
  const d = await r.json();
  const rr = d.meta.refreshRecorded;
  assert.ok(rr, 'the feed publishes no record of how often it is actually recorded');
  assert.equal(rr.schedule, 'hourly');
  assert.ok(Number.isFinite(rr.runsRecorded));
  /* And it must say that the feed itself is not on that schedule, so an
     hourly record is not read as hourly data. */
  assert.match(rr.note, /recomputed from the upstream sources on every request/);
});

test('the workflow asks for an interval it can actually be given', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows',
    'refresh-disaster-data.yml'), 'utf8');
  const m = wf.match(/cron:\s*'([^']+)'/);
  assert.ok(m, 'no schedule found');
  assert.doesNotMatch(m[1], /^\*\/\d/,
    'a sub-hourly schedule is throttled to hours on this runner; measured median was 3.66h');
  assert.match(wf, /record-changes\.js/, 'the workflow does not record what changed');
  assert.match(wf, /git add .*forecast-changes\.json/, 'the change log is never committed');
});

/* ---------- what the reader sees ---------- */

async function page() {
  return renderPage('forecasts.html', { timeoutMs: 15000,
    waitFor: d => !((d.getElementById('changes') || {}).textContent || '').includes('Loading') });
}

test('the forecast page reports whether anything moved', async () => {
  const { window } = await page();
  const txt = window.document.getElementById('changes').textContent;
  assert.ok(txt.length > 20, 'the change panel is empty');
  assert.match(txt, /check|changed|compare/i);
  window.close();
});

test('every kind of change is put into words', async () => {
  const { window } = await page();
  const say = window.PND.changesHtml.bind(window.PND);
  const meta = { forecastChanges: {
    at: '2026-09-20T12:00:00Z', sinceHours: 1.1, activeOutlooks: 30, baseline: false,
    added: 1, raised: 1, lowered: 1, windowMoved: 1, gone: 1, total: 5,
    records: {
      added: [{ id: 'a', title: 'New flood outlook', alert: 'Watch' }],
      raised: [{ id: 'b', title: 'Cyclone outlook', from: 'Watch', to: 'Red' }],
      lowered: [{ id: 'c', title: 'Fire outlook', from: 'Orange', to: 'Watch' }],
      windowMoved: [{ id: 'd', title: 'Flood outlook', toEnd: '2026-09-25T00:00:00Z' }],
      gone: [{ id: 'e', title: 'Old outlook' }]
    } } };
  const html = say(meta);
  for (const label of ['Newly issued', 'Raised', 'Lowered', 'Window moved', 'No longer issued']) {
    assert.ok(html.includes(label), `the panel never says "${label}"`);
  }
  assert.match(html, /Watch → Red/);
  assert.match(html, /5 changes/);
  window.close();
});

test('no change is reported as no change, not as silence', async () => {
  const { window } = await page();
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: { at: '2026-09-20T12:00:00Z', sinceHours: 1,
    activeOutlooks: 29, baseline: false, total: 0, records: {} } });
  assert.match(html, /None of the 29 open outlooks changed/);
  window.close();
});

test('the panel escapes what it renders', async () => {
  const { window } = await page();
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: { at: '2026-09-20T12:00:00Z', sinceHours: 1,
    activeOutlooks: 1, baseline: false, total: 1,
    records: { added: [{ id: 'x', title: '<img src=x onerror=alert(1)>', alert: 'Red' }] } } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  window.close();
});
