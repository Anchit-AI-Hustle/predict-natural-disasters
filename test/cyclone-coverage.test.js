'use strict';
/*
 * No hazard can crowd another out of the feed, and a cyclone is published as
 * a cyclone wherever its warning centre is.
 *
 * Measured on the live feed of 26 September 2026:
 *
 *   - GDACS was asked one question for every hazard over 120 days, and it
 *     answers with one page of at most 100 events. Exactly 100 came back, 63
 *     of them wildfires, and neither Typhoon Dujuan nor cyclone 01B in the
 *     Bay of Bengal was among them, though both were open storms that day.
 *   - NASA EONET files every storm as "Severe Storms", so 01B, which EONET
 *     did carry, was published as a severe storm with no place: no cyclone
 *     filter or search found it, and a severe storm's two-day outlook window
 *     had closed on it while a cyclone's five-day one was still open.
 *   - 40 signals had an outlook window open, and a quota of 24 published the
 *     24 ranked highest and dropped the rest without a word.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { callApi, closeAllWindows } = require('./render.js');
const { FIXTURES } = require('./mock-upstreams.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const events = require(path.join(ROOT, 'api', 'events.js'));
const search = require(path.join(ROOT, 'search.js'));
const feed = async mock => (await callApi(events, '/api/events', mock)).json();

const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();

/* What GDACS was asked: its hazard codes and the page number, if any. */
function asked(url) {
  const u = new URL(url);
  return {
    search: /\/SEARCH/i.test(u.pathname),
    active: /EVENTS4APP/i.test(u.pathname),
    types: (u.searchParams.get('eventlist') || '').split(';').filter(Boolean),
    page: Number(u.searchParams.get('pagenumber') || 1)
  };
}

/* Positions are spread by id, so a page of them includes the prime meridian
   (900080 lands on longitude 0), which the parser used to read as missing. */
function gdacsEvent(id, type, over) {
  return Object.assign({
    eventid: id, eventtype: type, name: type + ' event ' + id, country: 'Country ' + id,
    location: '', alertlevel: 'Green', latitude: 10 + (id % 60), longitude: -100 + (id % 170),
    fromdate: hoursAgo(30), todate: hoursAgo(2), description: ''
  }, over || {});
}

const WILDFIRES = Array.from({ length: 100 }, (_, i) => gdacsEvent(900000 + i, 'WF'));
const CYCLONES = [
  gdacsEvent(1001326, 'TC', { name: 'Tropical Cyclone 01B-26', country: 'India',
    location: 'Bay of Bengal', latitude: 18.1, longitude: 83.7, alertlevel: 'Orange' }),
  gdacsEvent(1001310, 'TC', { name: 'Tropical Cyclone DUJUAN-26', country: 'Japan',
    latitude: 39, longitude: 150.2, fromdate: hoursAgo(240) })
];

/* A search that, like GDACS, answers any question with its first 100 hits -
   wildfires first, because a busy fire season lists the most. */
function gdacsLike(opts) {
  const o = opts || {};
  return url => {
    const a = asked(url);
    if (a.active) return o.active === undefined ? [] : o.active;
    if (!a.search) return undefined;
    if (o.searchDown) return null;
    let hits = [];
    if (a.types.includes('WF')) hits = hits.concat(o.wildfires || WILDFIRES);
    if (a.types.includes('TC')) hits = hits.concat(CYCLONES);
    const size = 100;
    const page = o.ignorePage ? 1 : a.page;
    return hits.slice((page - 1) * size, page * size);
  };
}

const byProvider = meta => Object.fromEntries(meta.scan.providers.map(p => [p.provider, p]));

test('a full page of wildfires cannot crowd a cyclone out of the feed', async () => {
  const { events: evs, meta } = await feed({ gdacs: gdacsLike() });
  const titles = evs.filter(e => e.source === 'GDACS').map(e => e.title);
  assert.ok(titles.includes('Tropical Cyclone 01B'),
    'the Bay of Bengal cyclone was dropped behind a page of wildfires');
  assert.ok(titles.includes('Tropical Cyclone Dujuan'), 'the older typhoon was dropped');
  /* Shown by name; the provider's own title is kept beside it. */
  assert.equal(evs.find(e => e.title === 'Tropical Cyclone Dujuan').sourceTitle, 'Tropical Cyclone DUJUAN-26');
  assert.equal(titles.filter(t => /^WF event/.test(t)).length, 100, 'the wildfires themselves were lost');
  assert.equal(meta.sources.gdacs.byHazard.TC, 2);
  /* And each cyclone is forecast: a cyclone's window is still open. */
  const tcOutlooks = evs.filter(e => e.forecast && e.type === 'Tropical Cyclone' && /^gdacs-TC-/.test(e.forecastOf || ''));
  assert.deepEqual(tcOutlooks.map(e => e.forecastOf).sort(), ['gdacs-TC-1001310', 'gdacs-TC-1001326']);
});

test('a hazard whose history fills every page is reported as not read in full', async () => {
  /* An endpoint that ignores the page number answers page 2 with page 1, so
     nothing new arrives and there is no way to reach what lies beyond it. */
  const { meta } = await feed({ gdacs: gdacsLike({ ignorePage: true }) });
  assert.deepEqual(meta.sources.gdacs.incomplete, ['WF']);
  const g = byProvider(meta).gdacs;
  assert.equal(g.status, 'INCOMPLETE_SCAN', 'a truncated history was reported as a clean sweep');
  assert.match(g.coverageReason || g.reason || g.statusReason || JSON.stringify(g), /wildfire/);
});

test('pages are followed while they bring new events', async () => {
  const fires = Array.from({ length: 130 }, (_, i) => gdacsEvent(800000 + i, 'WF'));
  const { events: evs, meta } = await feed({ gdacs: gdacsLike({ wildfires: fires }) });
  assert.equal(evs.filter(e => e.source === 'GDACS' && e.type === 'Wildfire').length, 130,
    'the second page of wildfires was never asked for');
  assert.deepEqual(meta.sources.gdacs.incomplete, []);
  assert.equal(byProvider(meta).gdacs.status, 'SCANNED');
});

test('an event GDACS lists as active is carried even when every search fails', async () => {
  const { events: evs, meta } = await feed({ gdacs: gdacsLike({ searchDown: true, active: [CYCLONES[0]] }) });
  assert.ok(evs.some(e => e.sourceTitle === 'Tropical Cyclone 01B-26'), 'the active cyclone was lost with the searches');
  assert.equal(meta.sources.gdacs.endpoint, 'events4app');
  /* But nothing pretends the history was read. */
  assert.equal(byProvider(meta).gdacs.status, 'INCOMPLETE_SCAN');
  assert.deepEqual(meta.sources.gdacs.incomplete, ['DR', 'EQ', 'FL', 'TC', 'VO', 'WF']);
});

test('the same event from two answers is published once', async () => {
  const { events: evs } = await feed({ gdacs: gdacsLike({ active: CYCLONES }) });
  const ids = evs.filter(e => e.source === 'GDACS').map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'an event was published twice');
});

/* ------------------------------------------------------------------ EONET */

function eonetWith(extra) {
  return { events: FIXTURES.eonet.events.concat(extra) };
}
const JTWC = (id, title, file, lastFixHoursAgo, at) => ({
  id, title, categories: [{ title: 'Severe Storms' }],
  sources: [{ url: 'https://www.metoc.navy.mil/jtwc/products/' + file + '.tcw' }],
  geometry: [
    { type: 'Point', date: hoursAgo(lastFixHoursAgo + 48), coordinates: [at[1] + 1, at[0] - 2] },
    { type: 'Point', date: hoursAgo(lastFixHoursAgo), coordinates: [at[1], at[0]] }
  ]
});

test('a storm the typhoon warning centre tracks is published as a tropical cyclone, in its basin', async () => {
  const { events: evs } = await feed({ feeds: { eonet: eonetWith([
    JTWC('EONET_24785', 'Tropical Cyclone 01B', 'io0126', 50, [18.1, 83.7]),
    JTWC('EONET_24317', 'Typhoon Dujuan', 'wp2426', 10, [39, 150.2]),
    /* Not every storm name is a cyclone: a wildfire named for a place called
       Cyclone stays a wildfire, and an extratropical storm is not tropical. */
    { id: 'EONET_9', title: 'Cyclone Fire, Lake County, California', categories: [{ title: 'Wildfires' }],
      sources: [{ url: 'https://inciweb.x' }], geometry: [{ type: 'Point', date: hoursAgo(3), coordinates: [-122.8, 39.1] }] },
    { id: 'EONET_10', title: 'Post-Tropical Cyclone Fay', categories: [{ title: 'Severe Storms' }],
      sources: [{ url: 'https://www.nhc.noaa.gov/x' }], geometry: [{ type: 'Point', date: hoursAgo(3), coordinates: [-40, 45] }] }
  ]) } });
  const by = id => evs.find(e => e.id === 'eonet-' + id);
  assert.equal(by('EONET_24785').type, 'Tropical Cyclone');
  assert.equal(by('EONET_24785').region, 'Bay of Bengal, North Indian Ocean');
  assert.equal(by('EONET_24317').type, 'Tropical Cyclone');
  assert.equal(by('EONET_24317').region, 'western North Pacific');
  assert.equal(by('EONET_9').type, 'Wildfire', 'a wildfire named Cyclone became a cyclone');
  assert.equal(by('EONET_10').type, 'Severe Storm', 'a post-tropical storm was called tropical');

  /* Searchable by the sea it is in. */
  assert.ok(search.matches(by('EONET_24785'), 'bay of bengal'));
  assert.ok(search.matches(by('EONET_24785'), 'cyclone bengal'));

  /* Last fixed 50 hours ago: a severe storm's two-day window has closed,
     a cyclone's five-day window has not - so it is forecast. */
  const out = evs.find(e => e.forecast && e.forecastOf === 'eonet-EONET_24785');
  assert.ok(out, 'the Bay of Bengal cyclone has no outlook');
  assert.equal(out.type, 'Tropical Cyclone');
  assert.match(out.title, /^Storm risk from Tropical Cyclone 01B — 5-day forecast$/);
  assert.match(out.title + ' ' + out.region, /Bay of Bengal/);
});

/* ---------------------------------------------------------------- outlooks */

test('every open signal is forecast, and a bound says what it withholds', async () => {
  /* 130 green floods in 130 places: all within their window, none a
     duplicate of another. The bound is a guard against a runaway upstream,
     and whatever it holds back is counted rather than dropped in silence. */
  const floods = Array.from({ length: 130 }, (_, i) =>
    gdacsEvent(700000 + i, 'FL', { country: 'Floodland ' + i, fromdate: hoursAgo(6), todate: hoursAgo(1) }));
  const { events: evs, meta } = await feed({ gdacs: url => {
    const a = asked(url);
    if (a.active) return [];
    if (!a.search) return undefined;
    return a.types.includes('FL') ? floods.slice((a.page - 1) * 100, a.page * 100) : [];
  } });
  const published = evs.filter(e => e.forecast && /^gdacs-FL-7/.test(e.forecastOf || '')).length;
  assert.ok(published > 24, 'the old quota of 24 is back: ' + published);
  assert.equal(published + meta.outlooksWithheld, 130,
    'an outlook was neither published nor counted as withheld');
});
