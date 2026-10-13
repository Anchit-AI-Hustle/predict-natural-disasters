'use strict';
/**
 * Every job that writes data fails, with a non-zero exit, rather than write
 * something empty, all-null or missing its expected keys.
 *
 * The first backtest run scored nothing, exited 0 and committed a file of
 * nulls. The ledger tools had a worse version of the same habit: a ledger
 * that failed to parse was taken for a first run, started again from empty
 * and written back over the history.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const G = require('../tools/io-guard.js');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-loud-'));
const run = (tool, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args], { encoding: 'utf8' });

const quake = { id: 'us-1', title: 'M 5.1 - Somewhere', type: 'Earthquake', source: 'USGS', lat: 10, lon: 20,
  updated: '2026-10-12T00:00:00Z', country: 'X', alert: 'Green' };
const outlook = { id: 'OUT-1', title: 'Flood outlook', type: 'Flood', source: 'GloFAS', forecast: true, lat: 1, lon: 2,
  country: 'X', alert: 'Watch', issuedAt: '2026-10-12T00:00:00Z', updated: '2026-10-12T00:00:00Z',
  targetStart: '2026-10-14T00:00:00Z', targetEnd: '2026-10-20T00:00:00Z' };
const scan = { scanId: 'scan-1', scanTimestamp: '2026-10-12T00:00:00Z', engineVersion: 'e1',
  providers: [{ provider: 'usgs', label: 'USGS', status: 'ok', success: true, recordsEvaluated: 3, recordsServed: 3 }] };
const goodFeed = { generatedAt: '2026-10-12T00:00:00Z', events: [quake, outlook], meta: { sources: { usgs: { ok: true } }, scan } };

/* tool, ledger file name, a valid existing ledger, a ledger of the wrong shape */
const TOOLS = [
  ['record-outlooks.js', 'outlook-ledger.json', [], { rows: [] }],
  ['record-changes.js', 'forecast-changes.json', { schemaVersion: 1, runs: [], snapshot: {} }, { schemaVersion: 1 }],
  ['record-scan.js', 'scan-ledger.json', { schemaVersion: 1, scans: [] }, { scans: 'none' }],
  ['record-observed.js', 'observed-disasters.json', { schemaVersion: 1, events: [] }, []]
];

for (const [tool, name, valid, wrongShape] of TOOLS) {
  test(tool + ' refuses an empty feed and leaves the ledger as it was', () => {
    const d = tmp(), feed = path.join(d, 'events.json'), led = path.join(d, name);
    const before = JSON.stringify(valid);
    fs.writeFileSync(led, before);
    for (const bad of [{ events: [] }, { meta: {} }, 'not json']) {
      fs.writeFileSync(feed, typeof bad === 'string' ? bad : JSON.stringify(bad));
      const r = run(tool, feed, led);
      assert.notEqual(r.status, 0, tool + ' exited 0 on ' + JSON.stringify(bad));
      assert.equal(fs.readFileSync(led, 'utf8'), before, tool + ' touched the ledger');
    }
  });

  test(tool + ' refuses a ledger it cannot read, rather than start it again from empty', () => {
    const d = tmp(), feed = path.join(d, 'events.json'), led = path.join(d, name);
    fs.writeFileSync(feed, JSON.stringify(goodFeed));
    for (const bad of ['{"truncated": [', JSON.stringify(wrongShape)]) {
      fs.writeFileSync(led, bad);
      const r = run(tool, feed, led);
      assert.notEqual(r.status, 0, tool + ' exited 0 with ledger ' + bad);
      assert.equal(fs.readFileSync(led, 'utf8'), bad, tool + ' overwrote a ledger it could not read');
      assert.match(r.stderr, /ledger/i, 'the error does not say what was wrong');
    }
  });

  test(tool + ' still starts a ledger that does not exist yet', () => {
    const d = tmp(), feed = path.join(d, 'events.json'), led = path.join(d, name);
    fs.writeFileSync(feed, JSON.stringify(goodFeed));
    const r = run(tool, feed, led);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(led), tool + ' wrote nothing on a first run');
  });
}

test('record-scan.js refuses a scan that evaluated no provider', () => {
  const d = tmp(), feed = path.join(d, 'events.json'), led = path.join(d, 'scan.json');
  fs.writeFileSync(feed, JSON.stringify(Object.assign({}, goodFeed, { meta: { scan: Object.assign({}, scan, { providers: [] }) } })));
  assert.notEqual(run('record-scan.js', feed, led).status, 0);
  assert.equal(fs.existsSync(led), false);
});

const clim = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'climatology.json'), 'utf8'));
const backtest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model-backtest.json'), 'utf8'));

test('the climatology check passes the real file and refuses empty, short or hollow ones', () => {
  assert.deepEqual(G.climatologyProblems(clim, 108), []);
  assert.ok(G.climatologyProblems(Object.assign({}, clim, { places: [] }), 108).length, 'no places');
  assert.ok(G.climatologyProblems(Object.assign({}, clim, { places: clim.places.slice(0, 10) }), 108).length, '10 of 108 places');
  const hollow = Object.assign({}, clim.places[0], { heat: { p95: [null, null, null, null, null, null, null] } });
  assert.ok(G.climatologyProblems(Object.assign({}, clim, { places: [hollow].concat(clim.places.slice(1)) }), 108).length, 'null thresholds');
  const noRain = Object.assign({}, clim.places[0]); delete noRain.rain;
  assert.ok(G.climatologyProblems(Object.assign({}, clim, { places: [noRain].concat(clim.places.slice(1)) }), 108).length, 'missing key');
  assert.ok(G.climatologyProblems(Object.assign({}, clim, { period: undefined }), 108).length, 'no period');
});

test('the backtest check passes the real scores and refuses all-null or incomplete ones', () => {
  assert.deepEqual(G.backtestProblems(backtest), []);
  const nulls = JSON.parse(JSON.stringify(backtest));
  for (const k of Object.keys(nulls.results)) Object.assign(nulls.results[k], { days: 0, pod: null, far: null, csi: null, frequencyBias: null });
  assert.ok(G.backtestProblems(nulls).length, 'the all-null file from the first run passed');
  const missing = JSON.parse(JSON.stringify(backtest)); delete missing.results['fire@5'];
  assert.ok(G.backtestProblems(missing).length, 'a missing hazard and lead passed');
  assert.ok(G.backtestProblems(Object.assign({}, backtest, { places: 0 })).length, 'no places');
});

test('the model-run check needs most places checked and complete outlooks, but allows a quiet week', () => {
  const o = { id: 'model-heat-x-2026-10-13', type: 'Extreme Heat', title: 't', lat: 1, lon: 2, issuedAt: 'a',
    targetStart: 'b', targetEnd: 'c', forecastKind: 'model-advance' };
  assert.deepEqual(G.modelRunProblems({ places: 10, checked: 9, outlooks: [o], period: '1996-2025' }), []);
  assert.deepEqual(G.modelRunProblems({ places: 10, checked: 9, outlooks: [], period: '1996-2025' }), [], 'no hazard this week is not an error');
  assert.ok(G.modelRunProblems({ places: 10, checked: 3, outlooks: [], period: '1996-2025' }).length, '3 of 10 places checked');
  assert.ok(G.modelRunProblems({ places: 0, checked: 0, outlooks: [], period: '1996-2025' }).length, 'no places');
  const partial = Object.assign({}, o); delete partial.targetEnd;
  assert.ok(G.modelRunProblems({ places: 10, checked: 9, outlooks: [partial], period: '1996-2025' }).length, 'an outlook with no window end');
});

test('the network-bound jobs check their output before they write it', () => {
  for (const [file, check] of [['build-climatology.js', 'climatologyProblems'], ['run-models.js', 'modelRunProblems'], ['backtest-models.js', 'backtestProblems']]) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', file), 'utf8');
    const at = src.indexOf(check), write = src.indexOf('writeFileSync(OUT');
    assert.ok(at > 0, file + ' does not call ' + check);
    assert.ok(write > 0 && at < write, file + ' writes its output before checking it');
  }
});
