'use strict';
/*
 * "Is this place at risk?" - the answer on the homepage and on My places - and
 * the place search that decides which place is being asked about.
 *
 * Two defects this pins:
 *   - The level was set by distance alone. A magnitude-2.8 tremor 30 km away,
 *     a routine detection nobody felt, made a place "High risk", the same as a
 *     red-alert flood next door.
 *   - The place search took Nominatim's first result, so a neighbourhood could
 *     land on a same-named place elsewhere and a city could not be told from
 *     its district.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'place-risk.js'));
const S = require(path.join(ROOT, 'place-search.js'));
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const place = { name: 'Test town', lat: 10, lon: 10, country: 'Chad', countryCode: 'TD' };
const quake = (id, alert, dLat, extra) => Object.assign({
  id, title: id, type: 'Earthquake', source: 'USGS', sourceType: 'official', alert,
  lat: 10 + dLat, lon: 10, updated: new Date().toISOString(),
  locationPrecision: 'incident', precision: 'incident', proximityEligible: true, evidenceState: 'observed'
}, extra || {});

test('a minor event nearby is something to watch, not a high risk', () => {
  const a = P.assess(place, [quake('tremor', 'Green', 0.2)]);
  assert.equal(a.level, 'WATCH');
  assert.equal(a.headline, 'Watch');
  assert.match(a.why, /22 km from your place/);
});

test('a nearby event is rated by its computed severity, as its badge is', () => {
  /* The feed computes severity from reported impact as well as the alert. An
     event the issuer rated Green but that has killed people was read by its
     alert alone and came out as something to watch. */
  const a = P.assess(place, [quake('deadly', 'Green', 0.3, { severity: 'Extreme' })]);
  assert.equal(a.level, 'EXTREME');
  /* And it outranks a nearer event with the milder rating. */
  const b = P.assess(place, [quake('near', 'Orange', 0.1, { severity: 'Moderate' }),
    quake('deadly', 'Green', 0.3, { severity: 'Extreme' })]);
  assert.equal(b.level, 'EXTREME');
  assert.equal(b.lead.e.id, 'deadly');
  /* A record with only one of the two is rated by that one. */
  assert.equal(P.assess(place, [quake('sev', undefined, 0.3, { severity: 'Severe' })]).level, 'SEVERE');
  assert.equal(P.assess(place, [quake('red', 'Red', 0.3)]).level, 'HIGH');
});

test('the place answer and the event badge give the same level for the same event', async () => {
  const { window } = await renderPage('index.html', { timeoutMs: 15000, waitFor: (d, w) => w.PND && w.PNDRisk });
  const cases = [['Green', 'Extreme'], ['Red', 'Severe'], ['Orange', 'Moderate'], ['Green', 'Informational'],
    [undefined, 'Severe'], ['Red', undefined]];
  for (const [alert, severity] of cases) {
    const e = quake('x', alert, 0.1, severity ? { severity } : {});
    const badge = window.PND.riskTag(e);
    const shown = (/risk-(\w+)/.exec(badge) || [])[1];
    const answer = P.assess(place, [e]).level;
    /* 11 km away: the event's own level where it is Moderate or worse, and
       Watch below that (a minor event nearby is still something to watch). */
    const R = window.PNDRisk;
    const want = R.BY_KEY[shown.toUpperCase()].rank >= R.BY_KEY.MODERATE.rank ? shown : 'watch';
    assert.equal(answer.toLowerCase(), want, `alert ${alert}, severity ${severity}: badge ${shown}, answer ${answer}`);
  }
  window.close();
});

test('a red-alert event nearby is a high risk', () => {
  const a = P.assess(place, [quake('big', 'Red', 0.3)]);
  assert.equal(a.level, 'HIGH');
});

test('the most serious nearby event leads, not merely the nearest', () => {
  const a = P.assess(place, [quake('tremor', 'Green', 0.2), quake('big', 'Red', 0.36)]);
  assert.equal(a.lead.e.id, 'big');
  assert.equal(a.level, 'HIGH');
});

test('distance lowers the level', () => {
  assert.equal(P.assess(place, [quake('orange', 'Orange', 1.0)]).level, 'WATCH', 'orange at 111 km');
  assert.equal(P.assess(place, [quake('red', 'Red', 1.0)]).level, 'HIGH', 'red at 111 km');
  assert.equal(P.assess(place, [quake('red', 'Red', 3)]).level, 'WATCH', 'red at 334 km');
  assert.equal(P.assess(place, [quake('green', 'Green', 3)]).level, 'LOW', 'green at 334 km');
});

test('with nothing to report, the answer says so without calling the place safe', () => {
  const a = P.assess(place, []);
  assert.equal(a.level, null);
  assert.equal(a.headline, 'Nothing reported nearby');
  assert.match(a.why, /does not mean the place is safe/);
});

test('the advice is plain and never mentions a "window being watched"', () => {
  const texts = [];
  for (const evs of [[], [quake('tremor', 'Green', 0.2)], [quake('big', 'Red', 0.3)]]) {
    const a = P.assess(place, evs);
    texts.push(a.why, ...P.actionsFor(a).steps, P.actionsFor(a).authority);
  }
  for (const t of texts) {
    assert.ok(!/window being watched|incident-level|this project holds|authoritative record/i.test(t), t);
  }
});

/* ------------------------------------------------------------ place search */

const nominatim = [
  { lat: '12.9352', lon: '77.6245', name: 'Koramangala', addresstype: 'suburb', place_rank: 20,
    display_name: 'Koramangala, Bengaluru South, Bengaluru Urban, Karnataka, 560034, India',
    address: { suburb: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', country: 'India', country_code: 'in' } },
  { lat: '19.0760', lon: '72.8777', name: 'Mumbai', addresstype: 'city', place_rank: 16,
    display_name: 'Mumbai, Mumbai Suburban, Maharashtra, India',
    address: { city: 'Mumbai', state: 'Maharashtra', country: 'India', country_code: 'in' } },
  { lat: '18.9', lon: '73.2', name: 'Raigad', addresstype: 'state_district', place_rank: 12,
    display_name: 'Raigad, Maharashtra, India', address: { state_district: 'Raigad', state: 'Maharashtra', country: 'India', country_code: 'in' } },
  { lat: '19.6', lon: '75.5', name: 'Maharashtra', addresstype: 'state', place_rank: 8,
    display_name: 'Maharashtra, India', address: { state: 'Maharashtra', country: 'India', country_code: 'in' } },
  { lat: '22.3', lon: '78.6', name: 'India', addresstype: 'country', place_rank: 4,
    display_name: 'India', address: { country: 'India', country_code: 'in' } },
  { lat: '19.0760', lon: '72.8777', name: 'Mumbai', addresstype: 'city', place_rank: 16,
    display_name: 'Mumbai, Mumbai Suburban, Maharashtra, India',
    address: { city: 'Mumbai', state: 'Maharashtra', country: 'India', country_code: 'in' } }
];

test('every match is offered at its own level, with a short name and its country', () => {
  const list = S.candidates(nominatim);
  assert.deepEqual(list.map(c => c.level), ['Area', 'City or town', 'District', 'State or region', 'Country']);
  assert.equal(list[0].name, 'Koramangala, Bengaluru, Karnataka, India');
  assert.equal(list[0].country, 'India');
  assert.equal(list[0].countryCode, 'IN');
  assert.equal(list[0].lat, 12.9352);
  assert.equal(list.length, 5, 'the same place was listed twice');
});

test('a search asks for several results in English, and only when asked', async () => {
  let asked = '';
  const list = await S.search('Mumbai', { fetch: async url => { asked = url; return { ok: true, json: async () => nominatim }; } });
  assert.match(asked, /nominatim\.openstreetmap\.org\/search\?/);
  assert.match(asked, /limit=8/);
  assert.match(asked, /accept-language=en/);
  assert.match(asked, /q=Mumbai/);
  assert.equal(list.length, 5);
  await assert.rejects(S.search('x', { fetch: async () => ({ ok: false }) }), /not available/);
});

test('the homepage and My places both search through the shared picker', () => {
  const fs = require('node:fs');
  for (const f of ['index.html', 'personal-risk.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(html, /<script src="\/place-search\.js"><\/script>/, f + ' does not load the place search');
    assert.match(html, /PNDPlaceSearch\.renderChoices/, f + ' does not let the reader choose between matches');
    assert.ok(!/nominatim\.openstreetmap\.org\/search\?format=json&addressdetails=1&accept-language=en&limit=1/.test(html),
      f + ' still takes the first result only');
  }
});
