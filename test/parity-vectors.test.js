'use strict';
/**
 * docs/native-parity/test-vectors.json is what the Android and iOS apps test
 * their ports against. It was written once and then left behind while the
 * site changed (continents, whole-name hazards, in-force warnings, graded
 * forecasts), so both apps went on matching a site that no longer existed.
 *
 * This rebuilds the vectors in memory from the site's current code with
 * tools/make-parity-vectors.js and fails if the committed file differs.
 * When it fails, run `node tools/make-parity-vectors.js`, update
 * docs/native-parity/*.md for the change, and tell the native apps.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { build, serialise, OUT } = require(path.join(__dirname, '..', 'tools', 'make-parity-vectors.js'));

test('docs/native-parity/test-vectors.json matches what the site code produces now', async () => {
  const fresh = await build();
  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const stale = Object.keys(fresh).filter(k => JSON.stringify(fresh[k]) !== JSON.stringify(committed[k]));
  const gone = Object.keys(committed).filter(k => !(k in fresh));
  assert.deepEqual({ stale, gone }, { stale: [], gone: [] },
    'test-vectors.json is out of date: run node tools/make-parity-vectors.js and update docs/native-parity');
  assert.equal(fs.readFileSync(OUT, 'utf8'), serialise(fresh), 'test-vectors.json is not in the generator\'s format');
});

test('every vector group the native harnesses were built on is still there', async () => {
  /* The 67 keys of the first spec (commit ad275d8). New behaviour gets new
     groups; these are never renamed, so the apps' harnesses keep loading. */
  const ORIGINAL = ['meta', 'risk.levelOf', 'risk.markerIcon', 'portal.riskLabel', 'portal.matchesRiskLevel', 'portal.riskTagHtml',
    'portal.riskLevelOptions', 'hazards.hazardOf.name', 'hazards.horizonHours', 'hazards.severityOf', 'hazards.cycloneCategory',
    'hazards.keyFacts', 'portal.keyFactsLine', 'hazards.leadTimeText', 'hazards.classifyForecast', 'hazards.distanceKm',
    'hazards.geometryContains', 'hazards.riskRow', 'fixtures.places', 'fixtures.events', 'placeRisk.assess',
    'placeRisk.nearLevel(table)', 'alertRules.alertFor', 'alertRules.alertsFor', 'alertRules.roundCoord', 'alertRules.urlFor',
    'portal.titleOf', 'portal.placeOf', 'portal.shortSource', 'portal.provenance', 'portal.eventUrl', 'portal.duration',
    'portal.fmtDate', 'portal.fmtTime', 'portal.fmtWhen', 'portal.windowText', 'portal.horizonText', 'portal.age',
    'portal.countryCount', 'portal.impactText', 'portal.summary', 'portal.quietNote', 'portal.statusText',
    'portal.sourcesRatio', 'portal.findEvent', 'portal.hazardOptions', 'portal.SORT_DEFS.labels', 'portal.EVENT_SORTS',
    'sort.fixture', 'sort.results', 'sort.rankOf', 'sort.timeOf', 'search.matches', 'search.matchesPlace',
    'search.emptyHtml', 'glossary.expandAlways', 'placeSearch.levelOf', 'placeSearch.labelOf', 'placeSearch.candidates',
    'verdicts.normalise', 'verdicts.stateOf', 'verdicts.engineState', 'verdicts.rate', 'verdicts.tally',
    'verdicts.joinVerdicts', 'verification.score', 'verification.predictingSince'];
  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.deepEqual(ORIGINAL.filter(k => !(k in committed)), []);
});

test('the C26 and C27 groups the app ports work from are there, with their states and zones', () => {
  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const states = committed['home.placeAnswerStates'];
  assert.ok(states, 'home.placeAnswerStates is missing');
  const by = Object.fromEntries(states.cases.map(c => [c.in.state, c.out]));
  assert.deepEqual(Object.keys(by), ['loading', 'failed', 'loaded-empty', 'loaded-with-hits', 'failed-then-loaded']);
  assert.equal(by.loading.badge, 'Checking…');
  assert.equal(by.failed.badge, 'Live data unavailable');
  assert.equal(by['loaded-empty'].badge, 'Nothing reported nearby');
  for (const s of ['loading', 'failed']) assert.doesNotMatch(JSON.stringify(by[s]), /Nothing reported nearby/);
  const zones = committed['portal.zoneLabel'];
  assert.ok(zones, 'portal.zoneLabel is missing');
  for (const z of ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Asia/Kathmandu', 'Australia/Lord_Howe']) {
    assert.ok(zones.some(x => x.in.tz === z), z + ' is not in portal.zoneLabel');
  }
  for (const x of zones) {
    assert.ok(!x.out.label.includes('/') && !x.out.fmtDate.includes(x.in.tz.includes('/') ? x.in.tz : '\u0000'), 'a raw zone id in ' + JSON.stringify(x));
  }
});
