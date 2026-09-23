'use strict';
/*
 * What was actually examined.
 *
 * The feed reported which upstreams answered and nothing else, only for the
 * instant it was serving. That is enough to say a provider was reachable and
 * nowhere near enough to say a disaster would have been seen: an earthquake
 * below USGS's magnitude-2.5 threshold, a storm outside the two basins the
 * National Hurricane Center publishes, or a flood in a country ReliefWeb has
 * not declared are all invisible here, and no record of them says nothing
 * about the world.
 *
 * That distinction is the whole difference between a forecasting failure and
 * a coverage failure, so these tests hold the scan record to it: every
 * provider states a reach it can be held to, a degraded run says so rather
 * than reporting a clean sweep, and nothing anywhere claims the world was
 * scanned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async (mock) => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', mock)).json();
const STATUSES = ['SCANNED', 'INCOMPLETE_SCAN', 'NOT_SCANNED', 'DATA_UNAVAILABLE'];

/* ------------------------------------------------- the scan record itself */

test('every run says what it examined, how completely, and with what engine', async () => {
  const { meta } = await feed();
  const s = meta.scan;
  assert.ok(s, 'the feed carries no scan record');
  assert.match(s.scanId, /^scan-/, 'the scan has no id');
  assert.ok(Date.parse(s.scanTimestamp), 'the scan has no usable timestamp');
  assert.match(s.engineVersion, /^scan-\d+\.\d+\.\d+$/, 'the scan does not say which engine produced it');
  assert.ok(Array.isArray(s.providers) && s.providers.length >= 8,
    'fewer providers are described than the feed reads from');
});

test('every provider states a reach it can be held to', async () => {
  const { meta } = await feed();
  for (const p of meta.scan.providers) {
    assert.ok(STATUSES.includes(p.status), p.provider + ' has an unrecognised status: ' + p.status);
    assert.ok(p.geographicCoverage && p.geographicCoverage.length > 4,
      p.provider + ' does not say where it looks');
    assert.ok(p.coverageResolution && p.coverageResolution.length > 20,
      p.provider + ' does not say what it would and would not see');
    assert.ok(Array.isArray(p.hazards) && p.hazards.length,
      p.provider + ' does not say which hazards it covers');
    assert.ok(p.endpoint && /^https:\/\//.test(p.endpoint), p.provider + ' names no endpoint');
    assert.equal(typeof p.recordsEvaluated, 'number', p.provider + ' does not say how much it evaluated');
  }
});

test('a provider limited to one region does not describe itself as global', async () => {
  const { meta } = await feed();
  const by = Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));
  /* These two are the ones whose absence is most easily misread as quiet:
     a cyclone in the Bay of Bengal and a flood warning outside the US. */
  assert.match(by.nhc.geographicCoverage, /Atlantic|Pacific/i);
  assert.equal(/global/i.test(by.nhc.geographicCoverage), false,
    'the National Hurricane Center covers two basins, not the world');
  assert.match(by.nws.geographicCoverage, /United States/i);
  assert.equal(/global/i.test(by.nws.geographicCoverage), false,
    'the National Weather Service covers the United States, not the world');
  assert.match(by.usgs.coverageResolution, /2\.5/,
    'the earthquake feed does not state the magnitude below which it sees nothing');
});

test('nothing claims the world was scanned', async () => {
  const { meta } = await feed();
  assert.match(meta.scan.coverageLimitation, /no global cell-by-cell scan/i,
    'the limitation is not stated');
  assert.match(meta.scan.coverageLimitation, /was not examined/i,
    'the limitation does not say how to read an absence');
  const wrong = meta.scan.providers.filter(p =>
    /entire world|whole world|complete global coverage|every hazard everywhere/i.test(
      p.geographicCoverage + ' ' + p.coverageResolution));
  assert.deepEqual(wrong.map(p => p.provider), [], 'these claim coverage nothing can deliver');
});

/* --------------------------------------- a degraded run does not read clean */

test('a run that dropped records does not report a clean sweep', async () => {
  const { meta } = await feed();
  const by = Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));
  const degraded = meta.scan.providers.filter(p => p.status === 'INCOMPLETE_SCAN');
  assert.ok(degraded.length > 0,
    'the fixture no longer exercises a degraded provider, so this test proves nothing');
  for (const p of degraded) {
    assert.ok(p.failureReason && p.failureReason.length > 10,
      p.provider + ' is marked incomplete without saying what was missed');
  }
  // The fixture drops one unplaceable weather alert and one unresolvable
  // ReliefWeb country; both must surface rather than being rounded away.
  assert.equal(by.nws.status, 'INCOMPLETE_SCAN');
  assert.match(by.nws.failureReason, /could not be placed/i);
  assert.equal(by.reliefweb.status, 'INCOMPLETE_SCAN');
  assert.match(by.reliefweb.failureReason, /could not be resolved/i);
});

test('a provider that did not answer is unavailable, not scanned', async () => {
  /* Distinguishing these two is the point: an unreachable provider tells you
     nothing about its region, and must never be counted as having looked. */
  const { meta } = await feed({ down: ['gdacs'] });
  const gdacs = meta.scan.providers.find(p => p.provider === 'gdacs');
  assert.equal(gdacs.status, 'DATA_UNAVAILABLE',
    'an unreachable provider was reported as having looked');
  assert.equal(gdacs.success, false);
  assert.ok(gdacs.failureReason, 'an unavailable provider gives no reason');
  assert.equal(gdacs.recordsEvaluated, 0, 'an unreachable provider evaluated something');
  // And the rest of the run is unaffected, so this is about that provider and
  // not about the run falling over.
  const others = meta.scan.providers.filter(p => p.provider !== 'gdacs');
  assert.ok(others.some(p => p.status === 'SCANNED'), 'control: the other providers should still scan');
});

test('a record is only counted against the provider that published it', async () => {
  const { events, meta } = await feed();
  const served = meta.scan.providers.reduce((n, p) => n + p.recordsServed, 0);
  const upstream = events.filter(e => !/^Predict Natural Disasters/.test(String(e.source || '')));
  assert.equal(served, upstream.length,
    'the per-provider counts do not add up to the records actually served');
  /* This engine's own outlooks name the signal they came from inside their
     source string, and counting them would inflate the provider. */
  const derived = events.filter(e => /^Predict Natural Disasters · derived from/.test(String(e.source || '')));
  assert.ok(derived.length > 0, 'control: the fixture should contain derived outlooks');
});

test('a run pushed onto a fallback query says it scanned less', async () => {
  /* Production's weather feed rejects one query parameter with a bare 400, and
     the job walks a ladder of broader queries. A broader query returns a
     different set, so the run did not cover what the first rung would have. */
  const { meta } = await feed({ nwsRejects: ['message_type=alert'] });
  const nws = meta.scan.providers.find(p => p.provider === 'nws');
  assert.equal(nws.status, 'INCOMPLETE_SCAN',
    'a run that fell back to a broader query reported a clean scan');
  assert.match(nws.failureReason, /fallback|rejected/i,
    'the reason does not say the full query was refused');
});

/* ------------------------------------------------------------- the ledger */

test('the coverage ledger records a scan and never rewrites one', async () => {
  const { meta } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-scan-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'scan-ledger.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ meta }));
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, scans: [] }));
  const run = () => require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-scan.js'), eventsPath, ledgerPath], { stdio: 'pipe' }).toString();

  run();
  const first = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(first.scans.length, 1);
  assert.equal(first.aggregate.scansRecorded, 1);
  assert.ok(first.providers.nhc.geographicCoverage, 'the ledger does not describe its providers');
  assert.ok(first.coverageLimitation, 'the ledger does not carry the limitation');
  /* Whether a provider's silence is evidence has to survive into the written
     ledger, because that file - not the live feed - is what the verification
     engine reads when it decides whether an absence means anything. */
  for (const [name, p] of Object.entries(first.providers)) {
    assert.ok(['exhaustive', 'selective'].includes(p.completeness),
      name + ' reached the ledger with no completeness: ' + p.completeness);
    assert.ok(String(p.completenessBasis || '').length > 40,
      name + ' reached the ledger with a completeness and no basis for it');
  }

  // The same scan again is the same scan.
  const out = run();
  const second = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.match(out, /already recorded/);
  assert.equal(second.scans.length, 1, 'a scan was recorded twice');
  assert.equal(second.aggregate.scansRecorded, 1, 'the totals double-counted a single scan');
  assert.deepEqual(second.scans[0], first.scans[0], 'a recorded scan was rewritten');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('trimming old detail never improves the totals', async () => {
  const { meta } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-scan-trim-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'scan-ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, scans: [] }));

  // Three scans through a ledger that keeps only two.
  for (let i = 0; i < 3; i++) {
    const m = JSON.parse(JSON.stringify(meta));
    m.scan.scanId = 'scan-test-' + i;
    m.scan.scanTimestamp = new Date(Date.parse(meta.scan.scanTimestamp) + i * 3600e3).toISOString();
    fs.writeFileSync(eventsPath, JSON.stringify({ meta: m }));
    require('node:child_process').execFileSync(process.execPath,
      [path.join(ROOT, 'tools', 'record-scan.js'), eventsPath, ledgerPath],
      { stdio: 'pipe', env: Object.assign({}, process.env, { SCAN_RETAIN: '2' }) });
  }

  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(led.scans.length, 2, 'the detail window was not bounded');
  assert.equal(led.aggregate.scansRecorded, 3,
    'a scan that aged out of the detail window was dropped from the totals too');
  assert.equal(led.retention.detailedScansRetained, 2);
  assert.equal(led.scans[0].scanId, 'scan-test-1', 'the oldest detail should be the one dropped');
  assert.match(led.retention.note, /DATA_UNAVAILABLE/,
    'the ledger does not say how to read a date before its detail window');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the committed ledger is real, or empty, and never seeded', () => {
  const led = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'scan-ledger.json'), 'utf8'));
  assert.ok(Array.isArray(led.scans), 'the coverage ledger has no scans array');
  for (const s of led.scans) {
    assert.match(s.scanId, /^scan-\d{4}-/, 'a recorded scan has a hand-made id: ' + s.scanId);
    assert.ok(Date.parse(s.scanTimestamp), 'a recorded scan has no usable timestamp');
  }
});

/* ----------------------------------------------- and the workflow runs it */

test('the hourly run records and commits what it scanned', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'refresh-disaster-data.yml'), 'utf8');
  assert.match(wf, /node tools\/record-scan\.js .*data\/scan-ledger\.json/,
    'the refresh job does not record what it scanned');
  assert.match(wf, /git add[^\n]*data\/scan-ledger\.json/,
    'the coverage ledger is written but never committed, so it never leaves the runner');
  assert.match(wf, /git diff --quiet[^\n]*data\/scan-ledger\.json/,
    'a run whose only change is the coverage ledger would be treated as no change');
});
