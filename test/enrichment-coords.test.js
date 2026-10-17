'use strict';
/**
 * An event page with no coordinates is not placed at 0, 0.
 *
 * On 17 October 2026 /api/event-enrichment?title=Floods&country=Nepal&type=Flood
 * answered originArea "Atlantic Ocean", resolved "by BigDataCloud reverse
 * geocoding", for a flood in Nepal. A missing lat or lon is null, +null is 0,
 * and 0 is finite, so the handler reverse-geocoded the point 0, 0 and named
 * the result as where the event began. With no coordinates there is nothing
 * to look up: the area comes from the region or country the event names.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeFetch, mockRes } = require('./mock-upstreams.js');
const enrich = require(path.join(__dirname, '..', 'api', 'event-enrichment.js'));
const fn = typeof enrich === 'function' ? enrich : enrich.default;

async function run(qs) {
  const realFetch = global.fetch;
  const fetch = makeFetch({});
  global.fetch = fetch;
  try {
    const res = mockRes();
    await fn({ method: 'GET', url: '/api/event-enrichment?' + qs, headers: {} }, res);
    return { body: res.body, calls: fetch.calls };
  } finally { global.fetch = realFetch; }
}

for (const [what, qs] of [
  ['no lat or lon', 'title=Floods&country=Nepal&type=Flood'],
  ['empty lat and lon', 'title=Floods&country=Nepal&type=Flood&lat=&lon='],
  ['blank lat and lon', 'title=Floods&country=Nepal&type=Flood&lat=%20&lon=%20'],
  ['only a lat', 'title=Floods&country=Nepal&type=Flood&lat=28.2'],
  ['lat and lon that are not numbers', 'title=Floods&country=Nepal&type=Flood&lat=abc&lon=def']
]) {
  test('with ' + what + ', nothing is reverse-geocoded and the area is the named country', async () => {
    const { body, calls } = await run(qs);
    assert.deepEqual(calls.filter(u => u.includes('bigdatacloud')), [], 'a point was looked up that the event never gave');
    assert.equal(body.where.resolvedPlace, null);
    assert.equal(body.where.coordinates, null);
    assert.equal(body.where.originArea, 'Nepal');
    assert.equal(body.sources.find(s => s.name === 'BigDataCloud').items, 0);
  });
}

test('with real coordinates the point is still looked up, 0, 0 included', async () => {
  const { body, calls } = await run('title=Floods&country=Nepal&type=Flood&lat=28.2&lon=84.2');
  assert.equal(calls.filter(u => u.includes('bigdatacloud')).length, 1);
  assert.ok(body.where.resolvedPlace, 'a real point was not looked up');
  assert.deepEqual(body.where.coordinates, { lat: 28.2, lon: 84.2 });
  const zero = await run('title=Test&type=Earthquake&lat=0&lon=0');
  assert.equal(zero.calls.filter(u => u.includes('bigdatacloud')).length, 1, 'a real 0, 0 given by the source is a point');
});
