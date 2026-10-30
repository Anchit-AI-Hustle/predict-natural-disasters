'use strict';
/**
 * Hazard definitions, outlook windows, severity and lead time.
 *
 * Every outlook used to run for 72 hours regardless of hazard, so a drought
 * already 298 days old was published over a three-day window. Severity was
 * read off whatever colour the alert field carried, which is each agency's own
 * scale and not comparable between hazards. And nothing recorded how far ahead
 * of its window a forecast was issued - the number that decides whether a
 * forecast is useful or is describing something already under way.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../hazard-model.js');
const { callApi, sampleEvents } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const handler = () => require(path.join(ROOT, 'api', 'events.js'));
const feed = async () => (await callApi(handler(), '/api/events')).json();

/* --------------------------------------------------------------- definitions */

test('every hazard entry is complete enough to explain itself', () => {
  for (const [key, h] of Object.entries(H.HAZARDS)) {
    assert.ok(h.name && h.name.length > 3, key + ' has no display name');
    for (const field of ['definition', 'duration', 'severityBasis', 'leadTime']) {
      assert.ok(h[field] && String(h[field]).length > 10, key + ' is missing ' + field);
    }
    assert.ok(['sudden', 'rapid', 'slow'].includes(h.onset), key + ' has an unknown onset');
    assert.equal(typeof h.horizonH, 'number', key + ' has no window length');
  }
});

test('every hazard type in the feed resolves to a real definition', async () => {
  const { events } = await feed();
  const unknown = [...new Set(events.map(e => e.type).filter(Boolean))]
    .filter(t => H.hazardOf(t) === H.DEFAULT);
  assert.deepEqual(unknown, [],
    'these types fall through to the generic definition: ' + unknown.join(', '));
});

test('an earthquake is marked as something we do not forecast the onset of', () => {
  assert.equal(H.HAZARDS.Earthquake.forecastable, false);
  assert.match(H.HAZARDS.Earthquake.leadTime, /None/);
  // The aftershock sequence is a different thing and is forecastable.
  assert.equal(H.HAZARDS['Earthquake aftershock sequence'].forecastable, true);
});

/* ------------------------------------------------------------------- windows */

test('drought is never given a short window', () => {
  const h = H.horizonHours('Drought');
  assert.ok(h >= 24 * 14,
    'drought develops over months; a ' + h + '-hour window misrepresents it');
});

test('window length varies by how fast the hazard moves', () => {
  const slow = H.horizonHours('Drought');
  const fast = H.horizonHours('Tornado');
  assert.ok(slow > fast * 10, 'a drought window and a tornado window cannot be the same size');
  assert.ok(H.horizonHours('Tropical Cyclone') >= 96, 'official cyclone tracks run to five days');
  assert.ok(H.horizonHours('Severe Storm') <= 72, 'convective skill falls away after a day or two');
});

test('each outlook in the feed covers its own hazard window', async () => {
  const { events } = await feed();
  const outlooks = events.filter(e => e.forecast && e.forecastKind === 'signal-derived-outlook');
  assert.ok(outlooks.length, 'fixture should produce continuation outlooks');
  for (const e of outlooks) {
    const hours = (Date.parse(e.targetEnd) - Date.parse(e.targetStart)) / 3600e3;
    assert.ok(Math.abs(hours - H.horizonHours(e.type)) < 1,
      `${e.type} outlook runs ${Math.round(hours)}h but its hazard window is ${H.horizonHours(e.type)}h`);
  }
});

test('a drought outlook does not describe itself in days it does not cover', async () => {
  const { events } = await feed();
  const drought = events.find(e => e.forecast && /drought/i.test(e.type));
  if (!drought) return; // fixture has no active drought signal
  const days = Math.round((Date.parse(drought.targetEnd) - Date.parse(drought.targetStart)) / 864e5);
  assert.ok(days >= 14, 'drought outlook still runs only ' + days + ' days');
  assert.ok(!/\b3[- ]day\b|\b72-hour\b/.test(String(drought.details)),
    'the description still states a three-day window: ' + drought.details);
});

/* ------------------------------------------------------------------ severity */

test('severity comes from observed impact or an issued alert, never magnitude alone', () => {
  // A routine tremor with no PAGER assessment is a measurement.
  assert.equal(H.severityOf({ type: 'Earthquake', magnitude: 5.2, alert: 'Green' }), 'Informational');
  assert.equal(H.severityOf({ type: 'Earthquake', magnitude: 6.9, alert: 'Green' }), 'Informational');
  // With USGS's own impact alert attached it is not.
  assert.equal(H.severityOf({ type: 'Earthquake', magnitude: 6.9, pagerAlert: 'red' }), 'Extreme');
  assert.equal(H.severityOf({ type: 'Earthquake', magnitude: 6.0, pagerAlert: 'orange' }), 'Severe');
  assert.equal(H.severityOf({ type: 'Earthquake', magnitude: 5.0, pagerAlert: 'yellow' }), 'Moderate');
});

test('observed human impact sets severity on its own', () => {
  assert.equal(H.severityOf({ deaths: 955, displaced: 3458 }), 'Extreme');
  assert.equal(H.severityOf({ deaths: 12 }), 'Severe');
  assert.equal(H.severityOf({ deaths: 2 }), 'Moderate');
  assert.equal(H.severityOf({ affected: 250 }), 'Minor');
  assert.equal(H.severityOf({}), 'Informational');
});

test('a cyclone is rated on its actual category', () => {
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', windKt: 130 }), 'Extreme');
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', windKt: 100 }), 'Severe');
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', windKt: 70 }), 'Moderate');
  assert.equal(H.severityOf({ type: 'Tropical Cyclone', windKt: 30 }), 'Minor');
});

test('the worse of impact and issued alert wins', () => {
  // An Orange alert alone is Moderate; with a thousand dead it is Extreme.
  assert.equal(H.severityOf({ alert: 'Orange' }), 'Moderate');
  assert.equal(H.severityOf({ alert: 'Orange', deaths: 1000 }), 'Extreme');
});

test('every record in the feed carries a severity and a rank', async () => {
  const { events } = await feed();
  const missing = events.filter(e => !e.severity || !Number.isFinite(e.severityRank));
  assert.equal(missing.length, 0,
    missing.length + ' records have no severity, e.g. ' + (missing[0] || {}).title);
  const keys = H.SEVERITY.map(s => s.key);
  const odd = [...new Set(events.map(e => e.severity))].filter(v => !keys.includes(v));
  assert.deepEqual(odd, [], 'severity values outside the scale: ' + odd.join(', '));
});

test('routine detections do not dominate the severe end of the scale', async () => {
  const { events } = await feed();
  const severe = events.filter(e => e.severityRank >= 4);
  const info = events.filter(e => e.severityRank === 1);
  assert.ok(info.length > 0, 'a feed of raw detections should have an Informational tier');
  assert.ok(severe.length < events.length / 2,
    'if half the feed is Severe the scale is not discriminating');
});

/* ----------------------------------------------------------------- lead time */

test('lead time is zero for an outlook whose window is already open', () => {
  const t = '2026-09-15T00:00:00Z';
  assert.equal(H.leadTimeHours({ forecast: true, issuedAt: t, targetStart: t }), 0);
  assert.match(H.leadTimeText({ forecast: true, issuedAt: t, targetStart: t }), /No advance warning/);
});

test('lead time is positive when a forecast is issued ahead of its window', () => {
  const lead = H.leadTimeHours({
    forecast: true, issuedAt: '2026-09-10T00:00:00Z', targetStart: '2026-09-13T00:00:00Z'
  });
  assert.equal(lead, 72);
  assert.match(H.leadTimeText({
    forecast: true, issuedAt: '2026-09-10T00:00:00Z', targetStart: '2026-09-13T00:00:00Z'
  }), /3 days before/);
});

test('an observed record has no lead time at all', () => {
  assert.equal(H.leadTimeHours({ forecast: false, issuedAt: '2026-09-10T00:00:00Z' }), null);
});

test('every forecast in the feed publishes its lead time', async () => {
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast);
  assert.ok(forecasts.length, 'fixture should produce forecasts');
  for (const e of forecasts) {
    assert.equal(typeof e.leadTimeHours, 'number', e.id + ' has no lead time');
  }
});

/* ------------------------------------------------------------------ delivery */

test('the API reports that the hazard model actually loaded', async () => {
  const { meta } = await feed();
  // If this ever reads "unavailable" in production the feed is still serving,
  // but on one window for every hazard again.
  assert.equal(meta.hazardModel, 'loaded');
  assert.equal(typeof meta.highSeverityCount, 'number');
  assert.ok(meta.severityCounts && typeof meta.severityCounts === 'object');
});

test('the pages that show severity also load the model that defines it', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const missing = pages.filter(p => {
    const s = read(p);
    // A script tag, not a mention: a comment naming portal.js is not a page
    // that loads it, and matching the bare string made a code comment fail.
    const loads = f => new RegExp('<script[^>]+src="/?' + f + '"').test(s);
    const uses = /severityBadge|PNDHazards|leadText\(/.test(s) || loads('portal\\.js');
    return uses && !loads('hazard-model\\.js');
  });
  assert.deepEqual(missing, [],
    'these pages would render a severity with no definition behind it: ' + missing.join(', '));
});

test('the severity chip carries the scale wording as its tooltip', () => {
  const portal = read('portal.js');
  assert.match(portal, /severityBadge\(e\)/, 'portal.js should expose the chip');
  assert.match(portal, /title="\$\{this\.esc\(def\)\}"/,
    'a severity shown without its meaning is just another colour');
});

test('sorting by severity uses the cross-hazard rank, not the per-agency colour', () => {
  assert.match(read('portal.js'), /rankOf\(e\)\{const r=Number\(e&&e\.severityRank\)/);
  assert.match(read('index.html'), /const rank=e=>\{const r=Number\(e&&e\.severityRank\)/);
});

/* ------------------------------------------------- no claim of unearned lead */

test('nothing claims to have been issued before a window it was not', async () => {
  const { events } = await feed();
  const claims = /before its window opened|ahead of the target window|frozen before the window/i;
  const bad = events.filter(e => e.forecast
    && claims.test([e.details, e.evidence, e.confidence].filter(Boolean).join(' '))
    && !(Number(e.leadTimeHours) > 0));
  assert.deepEqual(bad.map(e => e.id), [],
    'these records claim lead time their own timestamps do not show: '
    + bad.map(e => e.id + ' (' + e.leadTimeHours + 'h)').join(', '));
});

test('the benchmark records when it can first be evidenced, not when it would like to be', async () => {
  const { events } = await feed();
  const nd = events.find(e => e.id === 'ND-001');
  assert.ok(nd, 'ND-001 should be in the feed');
  // The commit that introduced it is 2026-09-13T19:20:03Z; the window opened
  // at 2026-09-13T00:00:00Z. It cannot be published as issued at the earlier time.
  assert.ok(Date.parse(nd.issuedAt) >= Date.parse('2026-09-13T19:20:03Z'),
    'issuedAt is earlier than the first point the record can be shown to have existed');
  assert.ok(nd.issuedAtBasis && nd.issuedAtBasis.length > 20,
    'the basis for that timestamp should be stated on the record');
  assert.ok(Number(nd.leadTimeHours) < 0, 'it was written after its window opened');
});

test('no page describes the benchmark as written before its window opened', () => {
  const offenders = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f))
    .filter(f => /before its window opened|ahead of the target window/i.test(read(f)));
  assert.deepEqual(offenders, [],
    'the repository history contradicts that claim: ' + offenders.join(', '));
});

test('a derived outlook is never published as grave as the signal it came from', async () => {
  /* api/events.js steps a derived outlook down on purpose: a Red signal
     produces a High outlook, an Orange one a Moderate outlook. The severity
     table then ranked High and Red the same, so the step was erased and every
     outlook came out carrying the warning's own severity word. Measured on
     the feed before this: five outlooks derived from Red and Orange signals
     all published as Severe, and the risk badge said Severe on every card. */
  const R = require(path.join(ROOT, 'risk.js'));

  /* The step-down api/events.js applies, and what each side must rank. */
  const PAIRS = [['Red', 'High'], ['Orange', 'Moderate'], ['Green', 'Watch']];
  const wrong = [];
  for (const [official, derived] of PAIRS) {
    const o = H.severityRank({ alert: official });
    const d = H.severityRank({ alert: derived });
    /* Informational is the floor of the scale, so a Green signal and the
       Watch outlook derived from it can only be equal - there is nothing
       below it to step down to. Everywhere above the floor, the outlook must
       be strictly milder than its own source. */
    const ok = o <= 1 ? d === o : d < o;
    if (!ok) {
      wrong.push('a ' + derived + ' outlook ranks ' + d + ', the ' + official +
        ' signal it came from ranks ' + o);
    }
  }
  assert.deepEqual(wrong, [],
    'the derived outlook is as grave as its own source:\n' + wrong.join('\n'));

  /* And the same on the live feed, through the badge a reader actually sees. */
  const events = await sampleEvents();
  const resolve = e => {
    const sv = R.levelOf(e.severity), a = R.levelOf(e.alert);
    return sv !== 'UNKNOWN' ? sv : a;
  };
  /* A weather model's forecast is derived from no signal, so it has no step
     to keep (launch audit C9): its High is the 99th percentile forecast to be
     crossed, and reads High. Only outlooks derived from a signal step down. */
  const outlooks = events.filter(e => e.forecast && e.alert === 'High' && e.forecastKind !== 'model-advance' &&
    !(H.cycloneCategoryRank && H.cycloneCategoryRank(e) > 3));
  assert.ok(outlooks.length, 'fixture should carry an outlook derived from a red signal');
  for (const m of events.filter(e => e.forecastKind === 'model-advance' && e.alert === 'High')) {
    assert.equal(R.keyFor(m), 'HIGH', m.id + ': a model forecast that crossed its 99th percentile should read High');
  }
  for (const e of outlooks) {
    assert.notEqual(resolve(e), 'SEVERE',
      e.id + ' publishes the severity of the warning it was derived from');
    assert.equal(resolve(e), 'MODERATE', e.id + ' should sit one step below it');
  }
  const warnings = events.filter(e => !e.forecast && e.alert === 'Red');
  assert.ok(warnings.length, 'fixture should carry a red official warning');
  for (const e of warnings) {
    assert.equal(resolve(e), 'SEVERE', e.title + ' is a red official warning and must read as one');
  }
});

test('the forecast alert vocabulary is used by forecasts only', async () => {
  /* Lowering the rank of High, Moderate and Watch is safe only while nothing
     observed carries them; if an observed record ever does, it would be
     quietly downgraded by a rule written for outlooks. */
  const events = await sampleEvents();
  const stray = events.filter(e => !e.forecast && ['High', 'Moderate', 'Watch'].includes(e.alert))
    .map(e => e.source + ' · ' + e.title + ' · ' + e.alert);
  assert.deepEqual(stray, [],
    'these observed records carry the forecast vocabulary:\n' + stray.join('\n'));
});
