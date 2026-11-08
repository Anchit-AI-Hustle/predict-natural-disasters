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
 * median 3.66 - about a fortieth of the declared rate. The site published the
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
/*
 * Windows are relative to now, not written down.
 *
 * They used to be absolute, and the default one ended at 2026-09-23T00:00:00Z.
 * The tool correctly stops treating an outlook as still being issued once its
 * window has closed - the test below this one asserts exactly that - so at
 * midnight UTC on the 23rd, "an outlook that stopped being issued is recorded
 * as gone" began failing for everyone, on a suite nobody had touched. A
 * fixture that expires is a test that reports the calendar rather than the
 * code; mock-upstreams.js learned this already.
 */
const isoIn = days => new Date(Date.now() + days * 86400e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
const WINDOW_START = isoIn(-3);
const WINDOW_END = isoIn(3);
const WINDOW_END_MOVED = isoIn(7);

function outlook(over) {
  return Object.assign({
    id: 'OUT-a', forecast: true, type: 'Flood', title: '3-day Flood risk outlook',
    country: 'Testland', alert: 'Watch', severityRank: 2,
    targetStart: WINDOW_START, targetEnd: WINDOW_END
  }, over || {});
}
const OBS = { id: 'us-obs', title: 'M 4.8 - observed', type: 'Earthquake', source: 'USGS', lat: 1, lon: 2, updated: '2026-09-20T00:00:00Z' };
function run(dir, events, sources) {
  const feed = path.join(dir, 'events.json');
  const log = path.join(dir, 'changes.json');
  /* One observation rides along: it is not a forecast, so it changes nothing
     here, and a feed with no events at all is refused as an outage. */
  fs.writeFileSync(feed, JSON.stringify({ events: events.concat([OBS]), meta: { sources: sources || {} } }));
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
  const log = run(d, [outlook({ targetEnd: WINDOW_END_MOVED })]);
  const last = log.runs[log.runs.length - 1];
  assert.equal(last.windowMoved.length, 1);
  assert.equal(last.windowMoved[0].fromEnd, WINDOW_END);
  assert.equal(last.windowMoved[0].toEnd, WINDOW_END_MOVED);
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
  assert.match(html, /Stopped/);
  assert.match(html, /Ended on schedule/);
  /* The completed one must not carry the withdrawal wording. */
  const completed = html.slice(html.indexOf('Ended on schedule'));
  assert.doesNotMatch(completed, /no longer reported/);
  window.close();
});

test('no scheduled run is committed in a way that stops it deploying', () => {
  /* /api/events reads data/forecast-changes.json out of the deployed bundle,
     and vercel.json skips any deployment whose commit carries "[ledger]". The
     first attempt at this deployed only runs that saw movement, which left
     production presenting the last movement as the latest check - stale
     timestamp, stale cadence, stale active count - for as many quiet hours as
     followed. A check nobody can see is worth less than a deployment. */
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows',
    'refresh-disaster-data.yml'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.match(vercel.ignoreCommand || '', /ledger/,
    'this test assumes the marker still gates deployment');
  const commits = [...wf.matchAll(/git commit -m "([^"]+)"/g)].map(m => m[1]);
  assert.ok(commits.length >= 1, 'the workflow commits nothing');
  const skipped = commits.filter(c => c.includes('[ledger]'));
  assert.deepEqual(skipped, [],
    'these scheduled commits are marked [ledger], so the runs they record never reach production');
  assert.match(wf, /forecast-changes\.json/);
});

test('every source the feed can emit maps to an upstream it can check', async () => {
  /* The mapping missed two of the names the feed actually writes: "USGS
     Volcano Hazards Program" matched the bare "usgs" entry first, and "NOAA
     National Hurricane Center" contains no "nhc" at all. During either
     outage the outlook was still called a withdrawal. Driven by the feed's
     own source strings, so a new upstream cannot slip through unmapped. */
  const { callApi } = require('./render.js');
  const res = await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', {});
  const feed = await res.json();
  const known = new Set(Object.keys(feed.meta.sources || {}));
  assert.ok(known.size >= 5, `only ${known.size} upstreams in meta.sources`);

  const src = fs.readFileSync(TOOL, 'utf8');
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(src.indexOf('const PROVIDERS'),
    src.indexOf('/* Compared on what')), ctx);

  /* A record that is not derived from anything has no upstream to be down:
     the frozen ND-001 benchmark is written by hand and names no provider, so
     if it vanished that really would be a withdrawal. Only the derived ones
     must resolve. */
  const emitted = [...new Set(feed.events.map(e => String(e.source || '')))]
    .filter(s => /derived from/i.test(s));
  assert.ok(emitted.length >= 3, `only ${emitted.length} derived sources in the feed`);
  const unmapped = [];
  for (const source of emitted) {
    const key = ctx.providerOf({ source });
    if (!key || !known.has(key)) unmapped.push(`${source} -> ${key || '(none)'}`);
  }
  assert.deepEqual(unmapped, [],
    'these sources cannot be matched to an upstream, so an outage of theirs reads as a withdrawal');
});

test('a specific upstream wins over the generic one it contains', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(src.indexOf('const PROVIDERS'),
    src.indexOf('/* Compared on what')), ctx);
  const cases = [
    ['Predict Natural Disasters \u00b7 derived from USGS Volcano Hazards Program', 'usgs_volcano'],
    ['Predict Natural Disasters \u00b7 derived from USGS', 'usgs'],
    ['Predict Natural Disasters \u00b7 derived from NOAA National Hurricane Center', 'nhc'],
    ['Predict Natural Disasters \u00b7 derived from NOAA / National Weather Service', 'nws'],
    ['GDACS verified snapshot', 'gdacs']
  ];
  for (const [source, expected] of cases) {
    assert.equal(ctx.providerOf({ source }), expected, source);
  }
});

test('a volcano outage is an outage, not a withdrawal', () => {
  const d = tmp();
  const volcano = id => outlook({ id,
    source: 'Predict Natural Disasters \u00b7 derived from USGS Volcano Hazards Program',
    targetEnd: '2099-01-01T00:00:00Z' });
  run(d, [volcano('V')], { usgs_volcano: { ok: true }, usgs: { ok: true } });
  const last = run(d, [], { usgs_volcano: { ok: false }, usgs: { ok: true } })
    .runs.slice(-1)[0];
  assert.deepEqual(last.gone.map(x => x.id), [],
    'a volcano-feed outage was reported as a withdrawn forecast');
  assert.deepEqual(last.unavailable.map(x => x.id), ['V']);
});

test('an upstream outage is not reported as a withdrawn forecast', () => {
  /* /api/events deliberately serves a partial feed when a provider is down -
     ReliefWeb has been answering HTTP 406 for days - so every outlook derived
     from it simply vanishes. Read as a withdrawal, an outage would claim the
     signal stopped, and the provider recovering would claim a fresh forecast. */
  const d = tmp();
  const derived = (id, src) => outlook({ id,
    source: 'Predict Natural Disasters \u00b7 derived from ' + src,
    targetEnd: '2099-01-01T00:00:00Z' });
  const up = { gdacs: { ok: true }, usgs: { ok: true } };
  run(d, [derived('A', 'GDACS'), derived('B', 'USGS')], up);
  const outage = run(d, [derived('B', 'USGS')],
    { gdacs: { ok: false, error: 'HTTP 406' }, usgs: { ok: true } });
  const last = outage.runs[outage.runs.length - 1];
  assert.deepEqual(last.gone.map(x => x.id), [],
    'an unreachable provider was reported as a withdrawn signal');
  assert.deepEqual(last.unavailable.map(x => x.id), ['A']);
  assert.deepEqual(last.sourcesDown, ['gdacs']);
});

test('a provider recovering is not reported as a new forecast', () => {
  const d = tmp();
  const derived = (id, src) => outlook({ id,
    source: 'Predict Natural Disasters \u00b7 derived from ' + src,
    targetEnd: '2099-01-01T00:00:00Z' });
  const up = { gdacs: { ok: true } };
  run(d, [derived('A', 'GDACS')], up);
  run(d, [], { gdacs: { ok: false } });
  const back = run(d, [derived('A', 'GDACS')], up);
  const last = back.runs[back.runs.length - 1];
  assert.deepEqual(last.added.map(x => x.id), [],
    'the outlook was never withdrawn, so its return is not an addition');
});

test('a snapshot written before providers existed is not accused of vanishing', () => {
  /* The committed baseline was written before snap() carried a provider. On
     the first scheduled run after deploying the outage handling, every entry
     would have failed the guard and been recorded as withdrawn, then re-added
     on the next run - the exact pair of false statements the outage work
     exists to prevent, delivered on day one. */
  const d = tmp();
  const log = path.join(d, 'changes.json');
  fs.writeFileSync(log, JSON.stringify({
    schemaVersion: 1,
    runs: [{ at: '2026-09-20T00:00:00Z', sinceHours: null, active: 1, baseline: true,
      added: [], raised: [], lowered: [], windowMoved: [], gone: [], expired: [] }],
    /* No provider field, exactly as the shipped file had it. */
    snapshot: { 'OUT-legacy': { id: 'OUT-legacy', type: 'Flood', title: 'Legacy outlook',
      country: 'X', alert: 'Watch', rank: 2,
      targetStart: '2026-09-18T00:00:00Z', targetEnd: '2099-01-01T00:00:00Z' } }
  }));
  const feed = path.join(d, 'events.json');
  /* No outlooks, but not an empty feed: an empty one is refused as an outage. */
  fs.writeFileSync(feed, JSON.stringify({ events: [{ id: 'us-obs', title: 'M 4.8 - observed', type: 'Earthquake', source: 'USGS', lat: 1, lon: 2, updated: '2026-09-20T00:00:00Z' }], meta: { sources: { gdacs: { ok: false } } } }));
  execFileSync(process.execPath, [TOOL, feed, log]);
  const last = JSON.parse(fs.readFileSync(log, 'utf8')).runs.slice(-1)[0];
  assert.deepEqual(last.gone.map(x => x.id), [],
    'a legacy entry was reported as a withdrawn forecast during an outage');
  assert.deepEqual(last.unavailable.map(x => x.id), ['OUT-legacy']);
});

test('a legacy entry is still a withdrawal when everything is up', () => {
  /* The over-correction: holding legacy entries forever regardless. */
  const d = tmp();
  const log = path.join(d, 'changes.json');
  fs.writeFileSync(log, JSON.stringify({
    schemaVersion: 1,
    runs: [{ at: '2026-09-20T00:00:00Z', active: 1, baseline: true,
      added: [], raised: [], lowered: [], windowMoved: [], gone: [], expired: [] }],
    snapshot: { 'OUT-legacy': { id: 'OUT-legacy', title: 'Legacy outlook',
      alert: 'Watch', rank: 2, targetStart: '2026-09-18T00:00:00Z',
      targetEnd: '2099-01-01T00:00:00Z' } }
  }));
  const feed = path.join(d, 'events.json');
  /* No outlooks, but not an empty feed: an empty one is refused as an outage. */
  fs.writeFileSync(feed, JSON.stringify({ events: [{ id: 'us-obs', title: 'M 4.8 - observed', type: 'Earthquake', source: 'USGS', lat: 1, lon: 2, updated: '2026-09-20T00:00:00Z' }], meta: { sources: { gdacs: { ok: true } } } }));
  execFileSync(process.execPath, [TOOL, feed, log]);
  const last = JSON.parse(fs.readFileSync(log, 'utf8')).runs.slice(-1)[0];
  assert.deepEqual(last.gone.map(x => x.id), ['OUT-legacy']);
  assert.deepEqual(last.unavailable, []);
});

test('the committed baseline carries a provider for every entry', () => {
  /* So the tolerance above is a safety net rather than the normal path. */
  const log = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'forecast-changes.json'), 'utf8'));
  const entries = Object.values(log.snapshot || {});
  assert.ok(entries.length > 0, 'the shipped change log has no snapshot');
  const missing = entries.filter(e => !Object.prototype.hasOwnProperty.call(e, 'provider'));
  assert.deepEqual(missing.map(e => e.id), [],
    'these shipped snapshot entries predate the provider field');
});

test('a withdrawal is still a withdrawal while its provider is healthy', () => {
  const d = tmp();
  const derived = (id, src) => outlook({ id,
    source: 'Predict Natural Disasters \u00b7 derived from ' + src,
    targetEnd: '2099-01-01T00:00:00Z' });
  const up = { gdacs: { ok: true } };
  run(d, [derived('A', 'GDACS')], up);
  const last = run(d, [], up).runs.slice(-1)[0];
  assert.deepEqual(last.gone.map(x => x.id), ['A']);
  assert.deepEqual(last.unavailable, []);
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
  assert.match(rr.note, /recomputed from the upstream sources whenever the last copy is more than 60 seconds old/);
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
  for (const label of ['New', 'Raised', 'Lowered', 'Dates changed', 'Stopped']) {
    assert.ok(html.includes(label), `the panel never says "${label}"`);
  }
  assert.match(html, /Watch → Red/);
  assert.match(html, /5 changes/);
  window.close();
});

test('a quiet run still reports a source it could not check', async () => {
  /* An outage is deliberately not counted as a change to the forecasts, so on
     an otherwise quiet run total is zero - and the panel returned early on
     total alone, reporting "nothing changed" and dropping the outage rows.
     That is the opposite of what recording them was for. */
  const { window } = await renderPage('forecasts.html', { timeoutMs: 15000,
    waitFor: d => !((d.getElementById('changes') || {}).textContent || '').includes('Loading') });
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: {
    at: '2026-09-20T12:00:00Z', sinceHours: 1, activeOutlooks: 29, baseline: false,
    total: 0, unavailable: 1,
    records: { unavailable: [{ id: 'a', title: 'Flood outlook', provider: 'gdacs' }] } } });
  assert.match(html, /Could not be checked/,
    'a source outage was hidden because nothing else changed');
  assert.match(html, /could not be checked/);
  assert.doesNotMatch(html, /None of the 29 open forecasts changed/,
    'the panel claimed nothing changed while a source was unreachable');
  window.close();
});

test('a genuinely quiet run still reads as quiet', async () => {
  /* The obvious over-correction: every quiet run now shouting about nothing. */
  const { window } = await renderPage('forecasts.html', { timeoutMs: 15000,
    waitFor: d => !((d.getElementById('changes') || {}).textContent || '').includes('Loading') });
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: {
    at: '2026-09-20T12:00:00Z', sinceHours: 1, activeOutlooks: 29, baseline: false,
    total: 0, unavailable: 0, records: {} } });
  assert.match(html, /None of the 29 open forecasts changed/);
  assert.doesNotMatch(html, /Could not be checked/);
  window.close();
});

test('no change is reported as no change, not as silence', async () => {
  const { window } = await page();
  const say = window.PND.changesHtml.bind(window.PND);
  const html = say({ forecastChanges: { at: '2026-09-20T12:00:00Z', sinceHours: 1,
    activeOutlooks: 29, baseline: false, total: 0, records: {} } });
  assert.match(html, /None of the 29 open forecasts changed/);
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

test('no file claims a cadence the record contradicts', () => {
  /* The coverage rule was justified in a comment as being "beyond the slowest
     cycle observed", from a hand measurement over 15-20 September. The job's
     own record has since written down a 35-hour gap, which made that
     justification false while nothing failed - a measurement in prose goes
     stale silently, and this is what catches the next one.

     The rule is: anything that states a range of hours between runs must not
     understate what the ledger itself recorded. */
  const recorded = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'forecast-changes.json'), 'utf8'))
    .observedCadenceHours || {};
  if (typeof recorded.max !== 'number') return;   // nothing recorded yet to contradict

  const files = ['verification-model.js', 'accuracy.html', 'api/events.js', 'README.md',
    '.github/workflows/refresh-disaster-data.yml', 'tools/record-changes.js', 'methodology.html'];
  const claims = [];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/every\s+([\d.]+)\s*(?:to|-|\u2013|and)\s*([\d.]+)\s*hours/gi)) {
      claims.push({ file: f, low: Number(m[1]), high: Number(m[2]), text: m[0] });
    }
    for (const m of text.matchAll(/(?:slowest|longest|worst)[^.]{0,40}(?:cycle|gap|run)[^.]{0,60}/gi)) {
      claims.push({ file: f, phrase: m[0] });
    }
  }
  const wrong = claims.filter(c => typeof c.high === 'number' && c.high < recorded.max);
  assert.deepEqual(wrong.map(c => c.file + ': "' + c.text + '" but the record holds ' + recorded.max + 'h'), [],
    'a file states a cadence range the job\'s own record exceeds');

  /* And nothing may claim six hours is an upper bound on the gap, because it
     is not: it is the line between a normal cycle and an outage. */
  const engine = fs.readFileSync(path.join(ROOT, 'verification-model.js'), 'utf8');
  if (recorded.max > 6) {
    assert.equal(/beyond the slowest cycle observed/.test(engine), false,
      'the engine still justifies its gap rule as being longer than anything observed');
  }
});
