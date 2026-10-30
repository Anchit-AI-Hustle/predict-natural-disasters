'use strict';
/*
 * The track record a forecasting scientist will open first (launch audit C).
 *
 * Every figure on /accuracy and the forecast pages has to be one a reader can
 * reproduce from the committed ledgers, under the rule the site publishes.
 * Each block below is one finding of that audit, written as the behaviour
 * the site must have now.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../verification-model.js');
const OBS = require('../observed-model.js');
const { closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const FULL_COVER = { from: '2000-01-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };
const prediction = over => Object.assign({
  id: 'OUT-test-1', type: 'Flood', title: '3-day Flood risk outlook - Nepal',
  country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3,
  forecastScope: 'country', forecastClass: 'continuation-outlook',
  freezeTimestamp: '2026-09-04T00:00:00Z',
  targetStart: '2026-09-04T00:00:00Z', targetEnd: '2026-09-07T00:00:00Z'
}, over || {});
const disaster = over => Object.assign({
  canonicalEventId: 'OBS-flood-NEP-20260903T0000-n28e085',
  hazard: 'flood', significant: true, onset: '2026-09-03T00:00:00Z',
  geography: { country: 'Nepal', region: 'Bagmati Province', lat: 27.7, lon: 85.3 }
}, over || {});
const grade = (p, events, opts) => V.verify(p, events, Object.assign(
  { now: Date.parse('2026-09-10T00:00:00Z'), hazardFamilyOf: OBS.familyOf, observedCoverage: FULL_COVER }, opts || {}));

/* ------------------------------------------------------------------ C1 */

test('C1: an agency still listing the hazard does not make a restated alert correct', () => {
  for (const cls of ['continuation-outlook', 'warning-derived']) {
    const listed = disaster({
      impactLastUpdated: '2026-09-05T12:00:00Z',
      lastSeenAt: '2026-09-06T00:00:00Z',
      sightings: [{ from: '2026-09-03T00:00:00Z', to: '2026-09-09T00:00:00Z', fromScan: 's1', toScan: 's9' }]
    });
    const v = grade(prediction({ forecastClass: cls }), [listed]);
    assert.notEqual(v.classification, 'HIT', cls + ' was graded correct because the agency kept listing it');
    assert.notEqual(v.classification, 'PARTIAL_HIT', cls);
    /* With sources whose silence counts, no new impact is the forecast not coming true. */
    assert.equal(v.classification, 'MISS_FALSE_POSITIVE', cls);
    assert.match(v.classificationReason, /no new (damage|impact)/i);
  }
});

test('C1: a new impact reported inside the window is what bears a restated alert out', () => {
  const v = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 3, to: 11 }] })]);
  assert.equal(v.classification, 'HIT');
  assert.match(v.classificationReason, /deaths rose to 11/);
  /* A figure revised down is not a new impact. */
  const down = grade(prediction(), [disaster({
    revisions: [{ at: '2026-09-05T09:00:00Z', field: 'deaths', from: 11, to: 3 }] })]);
  assert.notEqual(down.classification, 'HIT');
});

test('C1: where no source could show an absence, a restated alert stays ungraded rather than failed', () => {
  const v = grade(prediction(), [disaster({ lastSeenAt: '2026-09-06T00:00:00Z' })],
    { observedCoverage: { from: null, to: null } });
  assert.equal(v.classification, 'PENDING');
  assert.equal(v.gradeable, false);
});

test('C1: the checker version moved with the rule', () => {
  assert.equal(V.VERIFICATION_VERSION, 'verify-1.4.0');
  assert.equal(V.CONTINUATION_EVIDENCE['continuation-outlook'], 'new-impact');
  assert.equal(V.CONTINUATION_EVIDENCE['warning-derived'], 'new-impact');
});

test('C1: the methodology publishes the rule the checker applies', () => {
  const html = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.match(html, /still listing|still lists/i, 'methodology does not say an agency still listing a hazard is not a hit');
  assert.match(html, /new (damage|impact)/i);
  assert.match(html, /verify-1\.4\.0/);
});
