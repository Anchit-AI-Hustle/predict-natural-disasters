'use strict';
/**
 * Forecasts that hold still, and a record of them that survives.
 *
 * Outlooks were computed with targetStart set to the moment of the request, so
 * the same outlook id carried a different window every time it was fetched —
 * measured against production, 26 of 27 windows slid forward between two
 * fetches 47 minutes apart. A claim that is rewritten on every page load cannot
 * be right or wrong, which is why nothing had ever been graded.
 *
 * Two changes: the window is anchored to the signal that produced it, and every
 * outlook is written to an append-only ledger in git.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { callApi } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const handler = () => require(path.join(ROOT, 'api', 'events.js'));
const feed = async (q) => (await callApi(handler(), '/api/events' + (q || ''))).json();

/* ---------------------------------------------------------- frozen windows */

test('the same outlook keeps the same window across separate requests', async () => {
  const a = await feed();
  await new Promise(r => setTimeout(r, 1100));
  const b = await feed();
  assert.notEqual(a.generatedAt, b.generatedAt, 'the two fetches should be at different times');

  const first = new Map(a.events.filter(e => e.forecast).map(e => [e.id, e]));
  const again = b.events.filter(e => e.forecast && first.has(e.id));
  assert.ok(again.length > 0, 'fixture should produce outlooks present in both fetches');

  const moved = again.filter(e => {
    const p = first.get(e.id);
    return p.targetStart !== e.targetStart || p.targetEnd !== e.targetEnd;
  });
  assert.deepEqual(moved.map(e => e.id), [],
    'these windows moved between two requests, so they can never be graded');
});

test('an outlook window is anchored to its source signal, not to the clock', async () => {
  const { events, generatedAt } = await feed();
  const byId = new Map(events.map(e => [e.id, e]));
  const derived = events.filter(e => e.forecast && e.forecastOf && byId.has(e.forecastOf));
  assert.ok(derived.length > 0, 'fixture should produce signal-derived outlooks');

  for (const o of derived) {
    const src = byId.get(o.forecastOf);
    const anchor = o.forecastKind === 'aftershock-sequence'
      ? Date.parse(src.startedAt || src.updated)
      : Date.parse(src.updated);
    assert.equal(Date.parse(o.targetStart), anchor,
      o.id + ' does not start when its source signal was published');
    assert.notEqual(Date.parse(o.targetStart), Date.parse(generatedAt),
      o.id + ' starts at request time, which is the defect this replaced');
  }
});

test('an outlook whose window has already closed is not counted as active', async () => {
  const { events, meta, generatedAt } = await feed();
  const now = Date.parse(generatedAt);

  // A signal-derived outlook is dropped outright once its window closes.
  const stale = events.filter(e => e.forecast && e.forecastKind !== 'frozen-benchmark'
    && Date.parse(e.targetEnd) <= now);
  assert.deepEqual(stale.map(e => e.id), [],
    'a closed window is history, not an outlook');

  // The frozen benchmark is deliberately kept so its grading stays visible, and
  // was being counted among the active forecasts four days after its window
  // closed. Every closed window must say so.
  const closed = events.filter(e => e.forecast && Date.parse(e.targetEnd) <= now);
  const unmarked = closed.filter(e => e.windowClosed !== true);
  assert.deepEqual(unmarked.map(e => e.id), [],
    'these forecasts have closed windows but are not marked closed');
  assert.equal(meta.activeForecastCount, events.filter(e => e.forecast && !e.windowClosed).length);
  assert.equal(meta.activeForecastCount, meta.forecastCount - closed.length,
    'the active count still includes a forecast whose window has closed');
});

test('the homepage forecast tile counts only forecasts whose window is still open', () => {
  const s = read('index.html');
  assert.match(s, /e\.forecast&&!e\.windowClosed/,
    'the Active Forecasts tile counts a benchmark whose window closed days ago');
});

/* ----------------------------------------------------------- the recorder */

function runRecorder(events, ledgerPath) {
  const evPath = path.join(path.dirname(ledgerPath), 'events.json');
  fs.writeFileSync(evPath, JSON.stringify({ events }));
  return execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-outlooks.js'), evPath, ledgerPath],
    { encoding: 'utf8' });
}

function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const p = path.join(dir, 'outlook-ledger.json');
  fs.writeFileSync(p, '[]\n');
  return p;
}

test('the recorder writes every outlook once and only once', async () => {
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast);
  assert.ok(forecasts.length > 0, 'fixture should produce forecasts');

  const p = tempLedger();
  runRecorder(events, p);
  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(after.length, forecasts.length, 'every outlook should be recorded');

  // Running again over the same feed must add nothing: the windows are frozen,
  // so the same claims are already on the record.
  const out = runRecorder(events, p);
  assert.match(out, /no new outlooks/);
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).length, forecasts.length);
});

test('a moved window is recorded as a new claim, not an edit of the old one', async () => {
  const { events } = await feed();
  const one = events.filter(e => e.forecast).slice(0, 1);
  const p = tempLedger();
  runRecorder(one, p);

  // The signal behind an outlook was updated, so its window moved forward. That
  // is a claim about a different period and has to be gradeable separately.
  const moved = one.map(e => Object.assign({}, e, {
    targetStart: new Date(Date.parse(e.targetStart) + 36e5).toISOString(),
    targetEnd: new Date(Date.parse(e.targetEnd) + 36e5).toISOString()
  }));
  runRecorder(moved, p);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(rows.length, 2, 'the moved window should be a second entry');
  assert.equal(rows[0].id, rows[1].id, 'both entries are the same outlook');
  assert.notEqual(rows[0].targetStart, rows[1].targetStart);
});

test('the freeze this ledger performs is what settles the forecast\'s class', async () => {
  /* The recorder claimed to settle the class against the row as written, and
     could not: the row is built from FIELDS, which carries what a forecast
     says and not the marker that it is one, so classifyForecast answered null
     on every row and the whole block did nothing.
     
     For a forecast derived from something already in the feed the stored class
     happened to agree, which is why this stayed invisible. For an independent
     one it does not. The feed has no freeze to point at - writing the ledger
     row is what creates it - so the feed must call such a forecast
     invalid-post-event, and verdicts.js keeps a stored class in preference to
     re-deriving one. A genuinely prospective forecast would therefore have
     been filed as "not a prediction" for ever, and the headline rate, which
     counts independent-prospective forecasts and nothing else, could never
     have contained a single one. */
  const { events } = await feed();
  const proto = events.find(e => e.forecast && e.forecastOf);
  assert.ok(proto, 'fixture should produce at least one outlook to model this on');

  const soon = Date.now() + 48 * 36e5;
  const independent = Object.assign({}, proto, {
    id: 'TEST-INDEPENDENT-OUTLOOK',
    targetStart: new Date(soon).toISOString(),
    targetEnd: new Date(soon + 24 * 36e5).toISOString()
  });
  delete independent.forecastOf;
  delete independent.forecastKind;
  delete independent.freezeTimestamp;
  const H = require(path.join(ROOT, 'hazard-model.js'));
  independent.forecastClass = H.classifyForecast(independent).forecastClass;
  assert.equal(independent.forecastClass, 'invalid-post-event',
    'control: until something freezes it, the feed cannot call this a prediction');

  const p = tempLedger();
  runRecorder([independent], p);
  const row = JSON.parse(fs.readFileSync(p, 'utf8'))
    .find(r => r.id === 'TEST-INDEPENDENT-OUTLOOK');
  assert.ok(row, 'the outlook was not recorded at all');
  assert.equal(row.forecastClass, 'independent-prospective',
    'the ledger froze this forecast before its window and still files it as not a prediction');
  assert.match(String(row.classificationReason), /before the window opening/,
    'the class changed with no stated reason');
  assert.ok(Date.parse(row.freezeTimestamp) < Date.parse(row.targetStart),
    'the recorded freeze is not earlier than the window it claims');
  /* What actually decides whether it can ever be counted. */
  const V = require(path.join(ROOT, 'verdicts.js'));
  assert.equal(V.forecastClassOf(row), 'independent-prospective');
  assert.equal(V.headlineEligible(row), true,
    'a forecast frozen before its window is still excluded from the headline rate');
});

test('a claim is its terms, not its id and the day it starts', async () => {
  /* The ledger keyed an outlook on id and targetStart and treated that pair
     as the whole claim. Measured: a second run carrying the same id and
     start, a window eight days longer and a geography moved from Nepal to
     Bihar, recorded nothing at all - and the feed then served the revised
     claim under the original row's freeze, which is a claim nobody froze
     presented as having existed for days. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const base = { id: 'OUT-x1', type: 'Flood', title: '3-day Flood risk outlook \u2014 Nepal',
    country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3, forecast: true,
    forecastScope: 'event', severity: 'SEVERE', alert: 'Orange', source: 'Derived',
    targetStart: '2026-09-25T00:00:00Z', targetEnd: '2026-09-27T00:00:00Z',
    verificationRule: 'Graded on a significant flood inside the corridor.' };

  /* Every term the verifier grades on moves the key; cosmetic ones do not. */
  assert.equal(H.claimKey(base), H.claimKey(Object.assign({}, base)));
  assert.equal(H.claimKey(base), H.claimKey(Object.assign({}, base,
    { title: 'Flood outlook, reworded', alert: 'Red', updated: '2026-09-24T00:00:00Z' })),
    'a reworded title or a changed display level is not a different claim');
  for (const [field, value] of [['targetEnd', '2026-10-05T00:00:00Z'],
    ['targetStart', '2026-09-26T00:00:00Z'], ['country', 'India'], ['region', 'Bihar'],
    ['lat', 26], ['lon', 88], ['forecastScope', 'country'], ['type', 'Landslide'],
    ['id', 'OUT-x2']]) {
    assert.notEqual(H.claimKey(Object.assign({}, base, { [field]: value })), H.claimKey(base),
      'a changed ' + field + ' is graded differently and must be a different claim');
  }
  /* Except where the title is the only thing that says what the outlook is
     about. The hazard a claim is graded on comes from its type, and from its
     title only where the type names no hazard at all - so under such a type
     two rows sharing an id, a window and a geography were one key and two
     different hazards, and the second was served under the first one's
     freeze timestamp, which is a freeze nobody performed for that claim. */
  const vague = Object.assign({}, base, { type: 'Other', title: 'Flood risk outlook \u2014 Bagmati' });
  const alsoVague = Object.assign({}, vague, { title: 'Landslide risk outlook \u2014 Bagmati' });
  const OBS = require(path.join(ROOT, 'observed-model.js'));
  const V = require(path.join(ROOT, 'verification-model.js'));
  assert.notDeepEqual(V.frozenClaim(vague, OBS.familyOf).hazards,
    V.frozenClaim(alsoVague, OBS.familyOf).hazards,
    'fixture: these two are supposed to be graded on different hazards');
  assert.notEqual(H.claimKey(vague), H.claimKey(alsoVague),
    'two outlooks graded on different hazards share one claim key');
  /* And the two definitions of "this type says nothing" are one definition.
     A copy that drifts puts the key and the grading back out of step. */
  assert.equal(String(H.TYPE_NAMES_NO_HAZARD), String(OBS.UNCLASSIFIED),
    'the claim key and the hazard classifier disagree about which types name no hazard');

  /* A term a row never recorded is absent, not equal: it cannot prove what it
     does not state. */
  const noScope = Object.assign({}, base); delete noScope.forecastScope;
  assert.notEqual(H.claimKey(noScope), H.claimKey(base),
    'a row that records no scope was read as proving the scope');

  const p = tempLedger();
  runRecorder([base], p);
  const widened = Object.assign({}, base, { targetEnd: '2026-10-05T00:00:00Z',
    country: 'India', region: 'Bihar', lat: 26, lon: 88 });
  runRecorder([widened], p);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(rows.length, 2, 'the revised claim was never written down');
  assert.equal(rows[0].targetEnd, base.targetEnd);
  assert.equal(rows[1].targetEnd, widened.targetEnd);
  assert.ok(Date.parse(rows[1].freezeTimestamp) >= Date.parse(rows[0].freezeTimestamp),
    'the revised claim inherited the original freeze');
  /* And running the same feed again still adds nothing. */
  const out = runRecorder([base, widened], p);
  assert.match(out, /no new outlooks/);
});

test('a freeze is only claimed from a row that records the same claim', async () => {
  /* The invariant behind it, over whatever the feed is serving: where a
     forecast says its freeze is proved by the ledger, the ledger holds a row
     with that exact claim. */
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const ledger = JSON.parse(read('data/outlook-ledger.json'));
  const keys = new Set(ledger.map(r => H.claimKey(r)));
  const { events } = await feed();
  let checked = 0;
  for (const e of events.filter(x => x.forecast)) {
    if (!/ledger/i.test(String(e.freezeBasis || ''))) continue;
    checked++;
    assert.ok(keys.has(H.claimKey(e)),
      e.id + ' claims a freeze from the ledger, which holds no row for these terms');
  }
  assert.ok(checked >= 0);
});

test('a recorded outlook keeps what is needed to grade it later', async () => {
  const { events } = await feed();
  const p = tempLedger();
  runRecorder(events, p);
  const row = JSON.parse(fs.readFileSync(p, 'utf8'))[0];
  for (const f of ['recordedAt', 'id', 'type', 'targetStart', 'targetEnd',
    'verificationRule', 'outcome']) {
    assert.ok(f in row, 'the ledger entry has no ' + f);
  }
  assert.equal(row.outcome, null, 'a fresh entry is ungraded');
  assert.ok(Number.isFinite(Date.parse(row.recordedAt)), 'recordedAt should be a real time');
});

/* --------------------------------------------------------- what the API says */

test('the feed reports the state of the ledger', async () => {
  const { meta } = await feed();
  assert.ok(meta.ledger, 'meta should carry a ledger summary');
  assert.equal(meta.ledger.status, 'loaded',
    'if this reads "unavailable" the ledger file did not ship');
  for (const k of ['recorded', 'windowClosed', 'graded', 'awaitingGrading']) {
    assert.equal(typeof meta.ledger[k], 'number', k + ' should be counted');
  }
});

test('the ledger can be read back without the whole feed', async () => {
  const body = await feed('?ledger=1');
  assert.ok(Array.isArray(body.ledger), 'a ledger view should return the rows');
  assert.equal(body.events, undefined, 'the ledger view should not ship the live feed');
  assert.ok(body.meta && body.meta.ledger, 'and should summarise itself');
});

/* ------------------------------------------------- recording must stay cheap */

test('a ledger commit does not spend a deployment', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.ok(v.ignoreCommand, 'vercel.json needs an ignoreCommand');
  // The stored command escapes the brackets for the shell, so match either form.
  assert.ok(/\\?\[ledger\\?\]/.test(v.ignoreCommand),
    'the refresh job commits every few minutes; the account allows 100 deploys a day');
  // exit 0 ignores the build, exit 1 runs it.
  assert.match(v.ignoreCommand, /exit 0/);
  assert.match(v.ignoreCommand, /exit 1/);
});

test('the refresh job can write the ledger, and records before it warms', () => {
  const y = read('.github/workflows/refresh-disaster-data.yml');
  assert.match(y, /contents: write/, 'committing the ledger needs write access');
  assert.match(y, /record-outlooks\.js/, 'the job should record outlooks');
  assert.match(y, /\[ledger\]/, 'the commit must carry the skip marker');
  assert.ok(y.indexOf('record-outlooks.js') < y.indexOf('Commit the ledger'),
    'record, then commit');
  // The first run on this workflow timed out at eight minutes inside the warm
  // step, and because the ledger ran after it the ledger never executed at all.
  // Recording is the durable part of the job and cannot depend on the slowest.
  assert.ok(y.indexOf('record-outlooks.js') < y.indexOf("warm every event's enrichment record"),
    'the ledger must be written before the enrichment warm, not after it');
  // A run slower than the five-minute schedule used to be killed by the next one.
  assert.match(y, /cancel-in-progress: false/,
    'runs should queue rather than cancel each other');
});
