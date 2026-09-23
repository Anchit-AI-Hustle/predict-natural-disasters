'use strict';
/*
 * One physical disaster, however many providers reported it.
 *
 * Recall — "of the disasters that happened, how many did anything forecast?" —
 * needs a denominator of real-world events, and this project had none. It had
 * a feed of provider records, in which the same flood arrives as a GDACS alert
 * and a ReliefWeb country declaration. Counting those as two disasters
 * inflates the denominator; merging two genuinely different events hides one
 * completely. The two mistakes are not symmetric, so the matching here is
 * deliberately conservative and these tests hold it to that in both
 * directions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OBS = require('../observed-model.js');
const { callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async () => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
/* Exactly what tools/record-observed.js records, so these tests are held to
   the tool's own definition rather than a looser copy of it: a warning has
   evidenceState 'official-warning' and is not an observation. */
const observedOf = events => events.filter(e => e && !e.forecast && e.evidenceState === 'observed');

/* ------------------------------------------------------------- deduping */

test('one disaster reported by two providers is one disaster', async () => {
  const { events } = await feed();
  const canon = OBS.canonicalise(observedOf(events));
  const merged = canon.filter(c => c.evidence.length > 1);
  assert.ok(merged.length > 0,
    'the fixture no longer contains the same disaster from two providers, so this proves nothing');
  for (const c of merged) {
    assert.equal(c.mergeReasons.length, c.evidence.length - 1,
      c.canonicalEventId + ' merged records without recording why');
    for (const why of c.mergeReasons) {
      assert.ok(why.length > 30, 'a merge reason that explains nothing: ' + why);
    }
  }
  // Every provider record still belongs to exactly one disaster.
  const seen = new Set();
  for (const c of canon) for (const ev of c.evidence) {
    assert.equal(seen.has(ev.id), false, ev.id + ' was counted under two disasters');
    seen.add(ev.id);
  }
  assert.equal(seen.size, observedOf(events).length, 'a provider record was dropped entirely');
});

test('two different earthquakes are two disasters', async () => {
  const { events } = await feed();
  const quakes = observedOf(events).filter(e => OBS.familyOf(e.type, e.title) === 'earthquake');
  const indo = quakes.filter(e => /Indonesia/i.test(String(e.country) + String(e.title)));
  assert.ok(indo.length >= 2, 'fixture should contain two Indonesian earthquakes');
  /* 114 km and 12 hours apart: two separate events, whatever they share.
     Merging them would delete one disaster from the recall denominator. */
  const [a, b] = indo;
  const apartH = Math.abs(Date.parse(a.startedAt || a.updated) - Date.parse(b.startedAt || b.updated)) / 3600e3;
  assert.ok(apartH > 2, 'control: these two should be further apart than the earthquake window');
  assert.equal(OBS.sameEvent(a, b), null, 'two separate earthquakes were merged into one');
});

test('a canonical id identifies exactly one disaster', async () => {
  const { events } = await feed();
  const canon = OBS.canonicalise(observedOf(events));
  const ids = canon.map(c => c.canonicalEventId);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [],
    'these ids name more than one disaster, which silently merges them everywhere downstream');
  for (const id of ids) assert.match(id, /^OBS-[a-z-]+-[A-Z]{2,3}-/, 'unreadable canonical id: ' + id);
});

test('an area-level record is never matched to another by distance', () => {
  /* Two floods a thousand kilometres apart, one placed at a country centroid.
     The kilometres between them are a fact about the centroid, not the flood,
     so the only thing left to match on is the country — and these differ. */
  const a = { id: 'a', type: 'Flood', country: 'India', lat: 22, lon: 79,
    locationPrecision: 'country', updated: '2026-09-10T00:00:00Z', startedAt: '2026-09-10T00:00:00Z' };
  const b = { id: 'b', type: 'Flood', country: 'Nepal', lat: 28, lon: 84,
    locationPrecision: 'country', updated: '2026-09-10T06:00:00Z', startedAt: '2026-09-10T06:00:00Z' };
  assert.equal(OBS.sameEvent(a, b), null, 'two countries\' floods were merged into one disaster');
  const c = Object.assign({}, b, { country: 'India', id: 'c' });
  assert.ok(OBS.sameEvent(a, c), 'the same country\'s flood, hours apart, should be one disaster');
  assert.match(OBS.sameEvent(a, c), /area-level/, 'the reason does not say how the match was made');
});

/* -------------------------------------------------- what counts as a disaster */

test('a hazard record is not automatically a disaster', async () => {
  const { events } = await feed();
  const canon = OBS.canonicalise(observedOf(events));
  const below = canon.filter(c => !c.significant);
  assert.ok(below.length > 0, 'nothing in the fixture falls below the bar, so the bar is untested');
  for (const c of below) {
    assert.ok(c.significanceReason.length > 30, c.canonicalEventId + ' is excluded without a stated reason');
    assert.equal(c.deaths === null || c.deaths === 0, true,
      c.canonicalEventId + ' reports deaths and was still excluded');
  }
  const above = canon.filter(c => c.significant);
  assert.ok(above.length > 0, 'nothing qualifies, so the bar excludes everything');
  for (const c of above) assert.ok(c.significanceReason.length > 10, c.canonicalEventId + ' qualifies for no stated reason');
});

test('a small tremor and a prescribed burn are not disasters', async () => {
  const { events } = await feed();
  const obs = observedOf(events);
  const canon = OBS.canonicalise(obs);
  /* Provider ids are opaque, so these are found by what the record says it
     is, then followed into the disaster it was grouped under. */
  const groupFor = re => {
    const rec = obs.find(e => re.test(String(e.title)));
    assert.ok(rec, 'the fixture no longer contains a record matching ' + re);
    return canon.find(c => c.evidence.some(ev => ev.id === rec.id));
  };

  const tremor = groupFor(/M 3\.1 .*Ridgecrest/i);
  assert.equal(tremor.significant, false,
    'a magnitude-3.1 tremor with no reported impact was counted as a disaster nobody predicted');
  const burn = groupFor(/Prescribed Fire/i);
  assert.equal(burn.significant, false, 'a deliberately lit prescribed burn was counted as a disaster');

  // And the bar is not simply excluding everything of that kind: a real
  // wildfire and a real earthquake in the same fixture do qualify.
  const realQuake = groupFor(/M 6\.5 /);
  assert.equal(realQuake.significant, true, 'a magnitude-6.5 earthquake was not counted as a disaster');
});

/* ------------------------------------------- figures nobody published */

test('an impact figure nobody reported is not zero', async () => {
  const { events } = await feed();
  const canon = OBS.canonicalise(observedOf(events));
  const fields = ['deaths', 'injuries', 'missing', 'affected', 'displaced', 'evacuated'];
  let sawNull = false;
  for (const c of canon) {
    for (const f of fields) {
      assert.ok(c[f] === null || typeof c[f] === 'number', c.canonicalEventId + '.' + f + ' is neither a number nor null');
      if (c[f] === null) sawNull = true;
    }
  }
  assert.ok(sawNull,
    'every figure came back as a number, which means an unreported one is being written as zero');
  // None of these providers publishes an injured or evacuated count, so those
  // must be null across the board rather than a fabricated zero.
  assert.ok(canon.every(c => c.injuries === null),
    'an injured count appeared from providers that do not publish one');
});

/* --------------------------------------------------------------- the ledger */

test('an event\'s identity is frozen and its impact is not', async () => {
  const { events } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-obs-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'observed.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, events: [] }));
  const run = p => require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), p, ledgerPath], { stdio: 'pipe' }).toString();

  run(eventsPath);
  const first = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.ok(first.events.length > 0, 'nothing was recorded');
  const target = first.events.find(e => e.deaths !== null);
  assert.ok(target, 'fixture should include a disaster with a reported death toll');

  // The toll rises, as tolls do.
  const raised = JSON.parse(JSON.stringify({ events }));
  for (const e of raised.events) {
    if (target.evidence.some(ev => ev.id === e.id) && e.deaths !== undefined && e.deaths !== null) {
      e.deaths = Number(e.deaths) + 15;
    }
  }
  const raisedPath = path.join(dir, 'events2.json');
  fs.writeFileSync(raisedPath, JSON.stringify(raised));
  run(raisedPath);

  const second = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(second.events.length, first.events.length, 'the same disaster was recorded twice');
  const after = second.events.find(e => e.canonicalEventId === target.canonicalEventId);
  assert.equal(after.deaths, target.deaths + 15, 'the revised death toll was not taken up');
  assert.equal(after.onset, target.onset, 'a frozen field moved');
  assert.equal(after.firstRecordedAt, target.firstRecordedAt, 'the first-recorded time was rewritten');
  assert.deepEqual(after.geographyAtFirstRecord, target.geographyAtFirstRecord, 'the original geography was rewritten');
  const rev = (after.revisions || []).find(r => r.field === 'deaths');
  assert.ok(rev, 'the death toll changed with no revision recorded');
  assert.equal(rev.from, target.deaths);
  assert.equal(rev.to, target.deaths + 15);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* Two magnitude-6 earthquakes, the same morning, 142 km apart: far enough
   apart to be two disasters under this hazard's 100 km window, close enough
   that the canonical id - a country, a position rounded to the degree and a
   minute - comes out identical for both. */
const quake = (id, lat, lon, deaths) => ({
  id, type: 'Earthquake', title: 'M 6.4 earthquake', source: 'USGS',
  sourceUrl: 'https://earthquake.usgs.gov/x/' + id,
  country: 'India', region: 'Andaman Sea', lat, lon, magnitude: 6.4, deaths,
  startedAt: '2026-09-10T00:00:00Z', updated: '2026-09-10T00:00:00Z',
  locationPrecision: 'incident', evidenceState: 'observed',
  severity: 'SEVERE', alert: 'Orange'
});
const recordObserved = (events, ledgerPath, tag) => {
  const evPath = path.join(path.dirname(ledgerPath), 'events-' + tag + '.json');
  fs.writeFileSync(evPath, JSON.stringify({ events }));
  return require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), evPath, ledgerPath],
    { encoding: 'utf8' });
};
const freshLedger = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-obs-id-'));
  const p = path.join(dir, 'observed.json');
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, events: [] }));
  return p;
};

test('two disasters that derive one id are not one disaster', () => {
  const near = quake('usgs-a', 0.55, 0.55, 3), far = quake('usgs-b', 1.45, 1.45, 7);
  /* The premise, measured rather than asserted. */
  const groups = OBS.canonicalise([near, far]);
  assert.equal(groups.length, 2, 'control: these should be two events');
  assert.equal(groups[0].canonicalEventId, groups[1].canonicalEventId,
    'control: this test is about an id collision and there is none');
  assert.ok(OBS.distanceKm(near.lat, near.lon, far.lat, far.lon) > OBS.MATCH.earthquake.km,
    'control: these are inside the matching window, so they are one disaster');

  /* Believing the id merged them here: the second quake\'s seven deaths were
     written over the first\'s three as a revision, and one real disaster left
     the recall denominator without leaving a trace. */
  const led = freshLedger();
  recordObserved([near, far], led, 'both');
  const rows = JSON.parse(fs.readFileSync(led, 'utf8')).events;
  assert.equal(rows.length, 2, 'two separate disasters were recorded as one');
  assert.equal(new Set(rows.map(r => r.canonicalEventId)).size, 2,
    'both rows carry the same id, so every lookup by id answers with one of them at random');
  assert.deepEqual(rows.map(r => r.deaths).sort((a, b) => a - b), [3, 7],
    'a death toll was overwritten by the other disaster\'s');
  assert.ok(rows.every(r => (r.revisions || []).length === 0),
    'one disaster was recorded as a revision of the other');

  /* And the split is auditable: which id it derived, who holds it, and the
     measured distance that decided it. */
  const distinguished = rows.find(r => r.derivedIdCollision);
  assert.ok(distinguished, 'nothing records that this row was given a distinguished id');
  assert.equal(distinguished.derivedIdCollision.derivedId, groups[0].canonicalEventId);
  assert.match(distinguished.derivedIdCollision.reason, /142 km apart/);
  assert.match(distinguished.derivedIdCollision.reason, /100 km \/ 2h/);
  fs.rmSync(path.dirname(led), { recursive: true, force: true });
});

test('a colliding id is not believed across runs either', () => {
  /* The same collision, arriving as two runs rather than one feed: the first
     quake has aged out of the provider window by the time the second is
     reported, so nothing but the id links them. */
  const led = freshLedger();
  recordObserved([quake('usgs-a', 0.55, 0.55, 3)], led, 'one');
  recordObserved([quake('usgs-b', 1.45, 1.45, 7)], led, 'two');
  const rows = JSON.parse(fs.readFileSync(led, 'utf8')).events;
  assert.equal(rows.length, 2, 'the second disaster was absorbed into the first');
  assert.equal(rows.filter(r => !r.supersededBy).length, 2,
    'one of two separate disasters was marked superseded by the other');
  assert.deepEqual(rows.map(r => r.deaths).sort((a, b) => a - b), [3, 7]);
  fs.rmSync(path.dirname(led), { recursive: true, force: true });
});

test('a disaster reported under fresh provider ids is still the same disaster', () => {
  /* The other direction, which is the reason the id is consulted at all. The
     provider replaced its record - a new id for the same quake - so no
     evidence links the runs. The rows can be the same occurrence, so the id
     is believed, and the reason for believing it is written down rather than
     assumed. */
  const led = freshLedger();
  recordObserved([quake('usgs-a', 0.55, 0.55, 3)], led, 'first');
  const again = Object.assign(quake('usgs-a-reissued', 0.55, 0.55, 5),
    { updated: '2026-09-10T06:00:00Z' });
  recordObserved([again], led, 'second');
  const rows = JSON.parse(fs.readFileSync(led, 'utf8')).events;
  assert.equal(rows.length, 1, 'one disaster was recorded twice in the recall denominator');
  assert.equal(rows[0].deaths, 5, 'the revised toll was not taken up');
  assert.ok((rows[0].matchedById || []).length === 1,
    'the run matched this row by its id alone and recorded no reason for it');
  assert.match(rows[0].matchedById[0].why, /0 km and 0h apart/);
  assert.ok(rows[0].evidence.some(e => e.id === 'usgs-a') &&
    rows[0].evidence.some(e => e.id === 'usgs-a-reissued'),
    'the evidence for this disaster should carry both provider records');
  fs.rmSync(path.dirname(led), { recursive: true, force: true });
});

/* Floods close enough to be one disaster under the 250 km / 96h window for
   the hazard, but recorded on separate runs, so the ledger learns they are
   one only when a later run carries two of them together. */
const floodAt = (id, lat, lon, updated, deaths) => ({
  id, type: 'Flood', title: 'Flooding in Assam', source: 'ReliefWeb',
  sourceUrl: 'https://reliefweb.int/x/' + id, country: 'India', region: 'Assam',
  lat, lon, deaths, startedAt: '2026-09-10T00:00:00Z', updated,
  locationPrecision: 'incident', evidenceState: 'observed',
  severity: 'SEVERE', alert: 'Orange'
});

test('merging two rows does not unlearn what either of them knew', () => {
  /* A superseded row was skipped when the evidence index was built, and
     merging carries over only the evidence the bridging run happened to be
     holding. So a provider record recorded under the superseded row, arriving
     alone one run later, matched nothing - and because better evidence is
     what moves a derived id, its position rounded to a different id than the
     row it came from, so the id did not save it either. The same disaster was
     appended a third time, active, in the recall denominator. */
  const F1 = floodAt('rw-1', 25.0, 91.5, '2026-09-10T01:00:00Z', 5);
  const F2 = floodAt('rw-2', 26.2, 92.9, '2026-09-10T02:00:00Z', 3);
  const F3 = floodAt('rw-3', 26.6, 93.4, '2026-09-10T01:30:00Z', 4);
  const led = freshLedger();
  const rows = () => JSON.parse(fs.readFileSync(led, 'utf8')).events;
  const active = () => rows().filter(e => !e.supersededBy);

  recordObserved([F1], led, 'a');
  recordObserved([F2, F3], led, 'b');
  assert.equal(active().length, 2, 'control: these should start as two rows');
  const strandedFrom = rows().find(r => r.evidence.some(e => e.id === 'rw-3')).canonicalEventId;

  recordObserved([F1, F2], led, 'c');
  const survivor = active()[0];
  assert.equal(active().length, 1, 'control: the bridging run should have merged the two rows');
  assert.equal(rows().find(r => r.canonicalEventId === strandedFrom).supersededBy,
    survivor.canonicalEventId);
  assert.equal(survivor.evidence.some(e => e.id === 'rw-3'), false,
    'control: the bridging run was not carrying rw-3, so the survivor should not have it yet');

  recordObserved([F3], led, 'd');
  assert.equal(active().length, 1,
    'a provider record already recorded under the superseded row came back as a second disaster');
  assert.ok(active()[0].evidence.some(e => e.id === 'rw-3'),
    'the survivor should have learned the record that reconciled to it');
  fs.rmSync(path.dirname(led), { recursive: true, force: true });
});

test('a superseded row never receives another write', () => {
  /* The row marked superseded is excluded from the denominator, so sightings
     and impact revisions written to it are lost while the surviving disaster
     goes stale. A run whose derived id matches the superseded row has to
     resolve to the survivor. */
  const F1 = floodAt('rw-1', 25.0, 91.5, '2026-09-10T01:00:00Z', 5);
  const F2 = floodAt('rw-2', 26.2, 92.9, '2026-09-10T02:00:00Z', 3);
  const led = freshLedger();
  const rows = () => JSON.parse(fs.readFileSync(led, 'utf8')).events;
  recordObserved([F1], led, 'a');
  recordObserved([F2], led, 'b');
  recordObserved([F1, F2], led, 'c');
  const dead = rows().find(r => r.supersededBy);
  assert.ok(dead, 'control: one row should have been superseded');
  const before = JSON.stringify(dead);

  /* A record the ledger has not seen before, placed where the superseded row
     was, so the id it derives is that row's. */
  const fresh = Object.assign(floodAt('rw-new', 26.2, 92.9, '2026-09-11T00:00:00Z', 9),
    { title: 'Flooding in Assam — updated' });
  assert.equal(OBS.canonicalise([fresh])[0].canonicalEventId, dead.canonicalEventId,
    'control: this record has to derive the superseded row\'s id to prove anything');
  recordObserved([fresh], led, 'd');

  const after = rows();
  assert.equal(after.length, 2, 'a third row was appended');
  assert.equal(JSON.stringify(after.find(r => r.supersededBy)), before,
    'the superseded row was written to again');
  const survivor = after.find(r => !r.supersededBy);
  assert.ok(survivor.evidence.some(e => e.id === 'rw-new'),
    'the update went somewhere other than the surviving disaster');
  assert.equal(survivor.deaths, 9, 'the survivor did not take up the revised toll');
  fs.rmSync(path.dirname(led), { recursive: true, force: true });
});

test('the ledger states how it decides what it holds', () => {
  const led = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'observed-disasters.json'), 'utf8'));
  assert.ok(Array.isArray(led.events), 'the observed ledger has no events array');
  for (const e of led.events) {
    assert.match(e.canonicalEventId, /^OBS-/, 'a hand-made id in the committed ledger: ' + e.canonicalEventId);
  }
});

test('a forecast never enters the observed ledger', async () => {
  const { events } = await feed();
  const canon = OBS.canonicalise(observedOf(events));
  const ids = new Set(canon.flatMap(c => c.evidence.map(e => e.id)));
  const forecasts = events.filter(e => e.forecast);
  assert.ok(forecasts.length > 0, 'control: the fixture should contain forecasts');
  for (const f of forecasts) {
    assert.equal(ids.has(f.id), false, 'a forecast was recorded as an observed disaster: ' + f.id);
  }
});

test('an official warning is not a disaster that happened', async () => {
  /* Excluding forecasts was not enough. A National Weather Service alert is
     neither a forecast nor an observation: it carries evidenceState
     'official-warning' and a red or orange level, so it cleared the
     significance bar and entered the ledger as a disaster that occurred —
     when what it says is that severe weather is expected. Each one inflates
     the recall denominator and manufactures a false negative against
     forecasts that had nothing to miss. */
  const { events } = await feed();
  const warnings = events.filter(e => !e.forecast && e.evidenceState === 'official-warning');
  assert.ok(warnings.length > 0, 'control: the fixture should contain official warnings');
  /* And they would have been recorded, which is what makes the exclusion do
     work rather than being a no-op. */
  const wouldHaveCounted = OBS.canonicalise(warnings).filter(c => OBS.significanceOf(c).significant);
  assert.ok(wouldHaveCounted.length > 0,
    'no warning in the fixture clears the significance bar, so this proves nothing');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-warn-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'observed.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, events: [] }));
  require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), eventsPath, ledgerPath], { stdio: 'pipe' });

  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.ok(led.events.length > 0, 'control: the run recorded no disasters at all');
  const recorded = new Set(led.events.flatMap(e => (e.evidence || []).map(x => x.id)));
  for (const w of warnings) {
    assert.equal(recorded.has(w.id), false,
      'a warning was recorded as a disaster that happened: ' + w.id + ' — ' + w.title);
  }
  const ids = new Set(led.events.map(e => e.canonicalEventId));
  for (const c of wouldHaveCounted) {
    assert.equal(ids.has(c.canonicalEventId), false,
      'a warning-derived disaster is in the ledger: ' + c.canonicalEventId);
  }
  /* And the exclusion is reported rather than silent, so that an observing
     provider dropped by a future change to the evidence states would show up
     here instead of disappearing from the denominator unnoticed. */
  assert.equal((led.lastRun.providerRecordsNotObservations || {})['official-warning'],
    warnings.length, 'the run does not report how many warnings it set aside');
  assert.match(String(led.method.observationsOnly || ''), /warning/i,
    'the ledger does not state that warnings are not observations');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a volcano alert level is a status, not a disaster that happened', async () => {
  /* The finding after warnings were excluded: a USGS volcano record carries
     sourceType 'official' and no expiry, so it was classified as an
     observation — and its WATCH or WARNING colour cleared the significance
     bar on its own. Kilauea and Great Sitkin were recorded as disasters that
     occurred, on the strength of an alert level that says an eruption is
     "imminent, under way or suspected" and does not establish which. */
  const { events } = await feed();
  const levels = events.filter(e => !e.forecast && e.alertLevel);
  assert.ok(levels.length > 0, 'control: the fixture should contain published alert levels');
  for (const v of levels) {
    assert.equal(v.evidenceState, 'official-warning',
      v.id + ' (' + v.title + ') is classified as an observation of a disaster');
    /* And it would have counted: the colour alone clears the bar. */
    const [c] = OBS.canonicalise([v]);
    assert.equal(OBS.significanceOf(c).significant, true,
      'this record no longer clears the significance bar, so excluding it proves nothing');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-volc-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'observed.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, events: [] }));
  require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), eventsPath, ledgerPath], { stdio: 'pipe' });
  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const recorded = new Set(led.events.flatMap(e => (e.evidence || []).map(x => x.id)));
  for (const v of levels) {
    assert.equal(recorded.has(v.id), false,
      'an alert level was recorded as a disaster that happened: ' + v.id + ' — ' + v.title);
  }
  /* An eruption that does cause harm is reported as an event by a provider
     that reports events, and that record is still eligible. */
  const volcanoes = events.filter(e => !e.forecast && /volcano/i.test(String(e.type)) && !e.alertLevel);
  assert.ok(volcanoes.every(e => e.evidenceState === 'observed'),
    'an ordinary volcano event record was swept up with the alert levels');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the hourly run records and commits observed disasters', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'refresh-disaster-data.yml'), 'utf8');
  assert.match(wf, /node tools\/record-observed\.js .*data\/observed-disasters\.json/,
    'the refresh job does not record observed disasters');
  assert.match(wf, /git add[^\n]*data\/observed-disasters\.json/,
    'the observed ledger is written but never committed');
  assert.match(wf, /git diff --quiet[^\n]*data\/observed-disasters\.json/,
    'a run whose only change is the observed ledger would be treated as no change');
});

test('two disasters in different parts of one country stay two', async () => {
  /* Matching area-level records on country and time alone merged every flood
     of the same family anywhere in a country inside the hazard's window:
     Assam and Gujarat a day apart became one disaster, and a real event left
     the recall denominator for good. */
  const flood = (region, t) => ({ id: 'x-' + region + t, type: 'Flood', title: 'Flood in ' + region,
    country: 'India', region: region, locationPrecision: 'regional',
    lat: 26, lon: 92, startedAt: t, updated: t, sourceType: 'official', evidenceState: 'observed' });
  const assam = flood('Assam', '2026-09-10T00:00:00Z');
  const gujarat = flood('Gujarat', '2026-09-11T00:00:00Z');
  assert.equal(OBS.sameEvent(assam, gujarat), null,
    'two floods in different states of one country were merged into one disaster');
  assert.equal(OBS.canonicalise([assam, gujarat]).length, 2);

  /* And the case merging exists for still merges: a global agency naming a
     province and a national declaration naming the country. */
  assert.ok(OBS.sameEvent(assam, flood('India', '2026-09-11T00:00:00Z')),
    'a country-wide declaration no longer matches the province record it describes');
  assert.ok(OBS.sameEvent(assam, flood('Assam', '2026-09-11T00:00:00Z')));
  /* Overlapping names count as the same place, and the reason says why. */
  const upper = flood('Upper Assam', '2026-09-11T00:00:00Z');
  assert.match(String(OBS.sameEvent(assam, upper)), /inside the other|both name/i);
  /* Sharing a direction is not sharing a place. */
  assert.equal(OBS.sameEvent(flood('Northern Assam', '2026-09-10T00:00:00Z'),
    flood('Northern Gujarat', '2026-09-11T00:00:00Z')), null,
    '"northern" was treated as the name of a place');
});

test('the runs a disaster was carried for survive the next run', async () => {
  /* lastSeenAt is overwritten every cycle, so the first run after a forecast
     window closed destroyed the evidence that the disaster had been in the
     feed throughout it. */
  const { events } = await feed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-seen-'));
  const eventsPath = path.join(dir, 'events.json');
  const ledgerPath = path.join(dir, 'observed.json');
  fs.writeFileSync(eventsPath, JSON.stringify({ events }));
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, events: [] }));
  const run = () => require('node:child_process').execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'record-observed.js'), eventsPath, ledgerPath], { stdio: 'pipe' });

  run();
  const first = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).events[0];
  assert.ok(Array.isArray(first.sightings) && first.sightings.length === 1,
    'the first sighting was not recorded');
  assert.equal(first.sightings[0].from, first.sightings[0].to);

  run();
  const second = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).events[0];
  assert.equal(second.sightings.length, 1, 'a second run within the hour started a new run of sightings');
  assert.equal(second.sightings[0].from, first.sightings[0].from,
    'the moment this disaster was first seen was overwritten');
  assert.ok(second.sightings[0].to >= first.sightings[0].to);
  assert.equal(second.lastSeenAt, second.sightings[0].to);

  /* A gap longer than the stated one starts a new run rather than pretending
     the disaster was carried throughout. */
  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  led.events.forEach(e => {
    e.sightings = [{ from: '2026-09-01T00:00:00Z', to: '2026-09-01T02:00:00Z' }];
    e.lastSeenAt = '2026-09-01T02:00:00Z';
  });
  fs.writeFileSync(ledgerPath, JSON.stringify(led));
  run();
  const third = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).events[0];
  assert.equal(third.sightings.length, 2, 'a gap of days was joined into one unbroken run');
  assert.equal(third.sightings[0].to, '2026-09-01T02:00:00Z', 'the earlier run was rewritten');
  assert.match(String(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).method.sightings || ''), /overwritten/i,
    'the ledger does not say why it keeps the runs');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a compound hazard record keeps every family it names', () => {
  assert.deepEqual(OBS.familiesOf('Flood / Landslide', ''), ['flood', 'landslide']);
  assert.deepEqual(OBS.familiesOf('Earthquake', 'M 5.9'), ['earthquake']);
  assert.equal(OBS.familyOf('Flood / Landslide', ''), 'flood',
    'an event still has one family for its identity and matching window');
  assert.equal(typeof OBS.familyOf.families, 'function',
    'the classifier does not carry its compound form, so callers cannot use it');
});

test('a hazard family is a whole word, not a substring', async () => {
  /* "hail" and "wind" both sit inside "Thailand", so a flood outlook for
     Thailand named two hazard families and a complex-emergency declaration
     there was classified as severe weather outright. */
  assert.deepEqual(OBS.familiesOf('', '3-day Flood risk outlook — Thailand'), ['flood'],
    'a place name was read as a hazard');
  assert.deepEqual(OBS.familiesOf('', 'Thailand: Complex Emergency'), ['other']);
  assert.deepEqual(OBS.familiesOf('', 'Winding River advisory'), ['other']);
  assert.equal(OBS.familyOf('', 'Campfire in Oregon'), 'other');

  // The words that are hazards still are.
  assert.deepEqual(OBS.familiesOf('Flood / Landslide', ''), ['flood', 'landslide']);
  assert.equal(OBS.familyOf('', 'Severe storm warning'), 'severe-weather');
  assert.equal(OBS.familyOf('', 'M 5.9 earthquake'), 'earthquake');
  assert.equal(OBS.familyOf('Tropical Cyclone', 'RAI-26'), 'tropical-cyclone');

  /* A title may not widen a claim; only a compound type may. */
  assert.deepEqual(OBS.familiesOf('Flood', 'Nepal: Floods and Landslides - Sep 2026'), ['flood'],
    'a title mentioning a second hazard widened the claim');
});

test('a country-wide record does not bridge two regional disasters', async () => {
  /* After the pairwise fix, a national declaration was still compatible with
     every regional record in its country — so India, Assam and Gujarat all
     joined one group through the record that matched both, and a real
     disaster left the denominator again. */
  const rec = (region, t, id, precision) => ({ id: id, type: 'Flood', title: 'Flood in ' + region,
    country: 'India', region: region, locationPrecision: precision || 'regional',
    lat: 26, lon: 92, startedAt: t, updated: t });
  const groups = OBS.canonicalise([
    rec('India', '2026-09-10T12:00:00Z', 'rw-india', 'country'),
    rec('Assam', '2026-09-10T00:00:00Z', 'assam'),
    rec('Gujarat', '2026-09-11T00:00:00Z', 'gujarat')
  ]);
  assert.equal(groups.length, 3,
    'the two regional disasters were bridged into one through the national declaration');
  const unattached = groups.filter(g => g.unattachedReason);
  assert.equal(unattached.length, 1,
    'the record that could have belonged to either was attached to one of them anyway');
  assert.match(unattached[0].unattachedReason, /could belong to 2 separate disasters/i);
  assert.deepEqual(unattached[0].evidence.map(e => e.id), ['rw-india']);

  /* The case merging exists for is untouched: one agency's province record
     and one national declaration of the same single event. */
  const pair = OBS.canonicalise([
    { id: 'gd', type: 'Tropical Cyclone', title: 'TC RAI-26', country: 'Philippines',
      region: 'Eastern Visayas', locationPrecision: 'regional', lat: 11, lon: 125,
      startedAt: '2026-09-12T00:00:00Z', updated: '2026-09-12T00:00:00Z' },
    { id: 'rw', type: 'Tropical Cyclone', title: 'Philippines: Tropical Cyclone', country: 'Philippines',
      region: 'Philippines', locationPrecision: 'country', lat: 12, lon: 122,
      startedAt: '2026-09-12T00:00:00Z', updated: '2026-09-12T00:00:00Z' }
  ]);
  assert.equal(pair.length, 1, 'a province record and its national declaration stopped merging');
});

test('provider records learned on earlier runs are not forgotten', async () => {
  /* The evidence list was replaced with whatever this run's feed carried, and
     those ids are the index the ledger reconciles on. A disaster seen from A
     and B, then from B alone, lost A — and the next A-only feed appended the
     same physical disaster a second time. */
  const { events } = await feed();
  const observed = events.filter(e => e && !e.forecast && e.evidenceState === 'observed');
  const canon = OBS.canonicalise(observed).filter(c => c.significant);
  const pair = canon.find(c => c.evidence.length > 1);
  assert.ok(pair, 'the fixture no longer has a disaster reported by two providers');
  const [a, b] = pair.evidence.map(e => e.id);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-eviction-'));
  const ledgerPath = path.join(dir, 'observed.json');
  fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, events: [] }));
  const run = (keep) => {
    const p = path.join(dir, 'events-' + keep.join('-') + '.json');
    fs.writeFileSync(p, JSON.stringify({ events: events.filter(e => !pair.evidence.some(x => x.id === e.id) || keep.includes(e.id)) }));
    require('node:child_process').execFileSync(process.execPath,
      [path.join(ROOT, 'tools', 'record-observed.js'), p, ledgerPath], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  };

  run([a, b]);
  const only = run([b]);
  const row = only.events.find(e => (e.evidence || []).some(x => x.id === b));
  assert.ok((row.evidence || []).some(x => x.id === a),
    'a provider record learned on an earlier run was dropped from the evidence');

  const back = run([a]);
  const carrying = back.events.filter(e => !e.supersededBy &&
    (e.evidence || []).some(x => x.id === a || x.id === b));
  assert.equal(carrying.length, 1,
    'the same disaster was recorded twice after its providers alternated');
  fs.rmSync(dir, { recursive: true, force: true });
});
