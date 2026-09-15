'use strict';
/**
 * Places and abbreviations are written out.
 *
 * The homepage listed an earthquake in "CA". Expanding a two-letter code in
 * free text is unsafe — "Toronto, CA" is Canada and "Malibu, CA" is California
 * — so the glossary deliberately left those alone. The fix belongs in the
 * parsers, where the source already tells us the country.
 *
 * The same lookup found something underneath it: the last comma-separated part
 * of a USGS place was being stored as the record's country, so Alaska, Guam,
 * Texas and eleven more were counted as countries of their own and the United
 * States appeared fourteen times in the country total.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const handler = () => require(path.join(ROOT, 'api', 'events.js'));
const feed = async () => (await callApi(handler(), '/api/events')).json();

const BARE_CODE = /^[A-Z]{2}$/;
const TRAILING_CODE = /,\s*([A-Z]{2})\s*$/;

/* ------------------------------------------------------- places, written out */

test('no record publishes a bare two-letter code as its country', async () => {
  const { events } = await feed();
  const bad = events.filter(e => BARE_CODE.test(String(e.country || '')));
  assert.deepEqual(bad.map(e => e.country + ' — ' + e.title), [],
    'a reader cannot be expected to expand a postal code');
});

test('a United States place names the country and keeps the state separately', async () => {
  const { events } = await feed();
  const ca = events.find(e => /Ridgecrest/.test(String(e.title)));
  assert.ok(ca, 'fixture should include the California quake');
  assert.equal(ca.country, 'United States', 'a state is not a country');
  assert.equal(ca.admin1, 'California', 'the state belongs in its own field');
  assert.match(ca.region, /California$/, 'the place reads in full');
  assert.match(ca.title, /California/, 'so does the title');
  assert.ok(!/\bCA\b/.test(ca.title), 'the code should be gone from the title');
});

test('no title or region ends in an unexpanded postal code', async () => {
  const { events } = await feed();
  const bad = [];
  for (const e of events) {
    for (const f of ['title', 'region']) {
      const m = TRAILING_CODE.exec(String(e[f] || ''));
      if (m) bad.push(e.source + ' ' + f + ': …, ' + m[1]);
    }
  }
  assert.deepEqual(bad, [], 'still abbreviated:\n' + bad.join('\n'));
});

test('expanding a state code never eats a compass bearing', async () => {
  const { events } = await feed();
  // "NE" is Nebraska and also north-east. A blanket two-letter replacement
  // turns "11 km NE of Brentwood" into "11 km Nebraska of Brentwood".
  const mangled = events.filter(e =>
    /\b(Nebraska|Maine|Oregon|Indiana|Idaho)\s+of\b/.test(String(e.title) + ' ' + String(e.region)));
  assert.deepEqual(mangled.map(e => e.title), [],
    'a bearing was replaced with a state name');

  const atRisk = events.filter(e => /\b(NE|NW|SE|SW)\s+of\b/.test(String(e.region || '')));
  assert.ok(atRisk.length > 0,
    'the fixture must contain a two-letter bearing, or this test proves nothing');
});

/* ------------------------------------------------- codes that mean something */

test('a hurricane basin code is written out', async () => {
  const { events } = await feed();
  const storms = events.filter(e => /Hurricane Center/.test(String(e.source || '')));
  assert.ok(storms.length, 'fixture should include a tropical cyclone');
  for (const e of storms) {
    assert.ok(!/\((AL|AT|EP|CP|WP|IO|SH)\d+\)/.test(String(e.region || '')),
      '"(EP4)" tells a reader nothing: ' + e.region);
    assert.match(String(e.region), /(Atlantic|Pacific|Indian Ocean|southern hemisphere) system \d+/,
      'the basin and the number should read as words: ' + e.region);
  }
});

test('the prescribed-fire abbreviation is not published', async () => {
  const { events } = await feed();
  const bad = events.filter(e => /\bRX\b/.test(String(e.title || '')));
  assert.deepEqual(bad.map(e => e.title), [],
    '"RX" is fire-management shorthand for a prescribed fire');
});

/* --------------------------------------------- what that fixed in the counts */

test('the country count counts countries, not states of one country', async () => {
  const { events, meta } = await feed();
  const STATES = new Set(['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
    'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
    'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
    'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
    'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee',
    'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
    'Wisconsin', 'Wyoming', 'Puerto Rico', 'Guam', 'American Samoa']);
  const asCountry = [...new Set(events.map(e => e.country).filter(Boolean))].filter(c => STATES.has(c));
  assert.deepEqual(asCountry, [],
    'these are states of the United States, counted as countries: ' + asCountry.join(', '));
  assert.equal(meta.countryCount,
    new Set(events.map(e => e.country).filter(Boolean)).size);
});

/* --------------------------------------------------------- and on the page */

test('the homepage location column shows no bare postal code', async () => {
  const r = await renderPage('index.html', {
    waitFor: d => (d.getElementById('recentRows') || {}).children &&
      d.getElementById('recentRows').children.length > 0
  });
  const cells = [...r.document.querySelectorAll('#recentRows tr')]
    .map(tr => (tr.children[1] || {}).textContent || '');
  r.close();
  assert.ok(cells.length, 'the recent-events table rendered no rows');
  const bad = cells.filter(t => BARE_CODE.test(t.trim()));
  assert.deepEqual(bad, [], 'the location column reads as a code: ' + bad.join(', '));
});

/* ------------------------------------- the place NASA puts only in the title */

test('a NASA record carries the place its title names', async () => {
  const { events } = await feed();
  const fire = events.find(e => /MEERS/.test(String(e.title)));
  assert.ok(fire, 'fixture should include a NASA wildfire with a place in its title');
  // EONET puts the place nowhere but the title, so 295 of 791 production records
  // arrived with no country and no region at all.
  assert.equal(fire.country, 'United States');
  assert.equal(fire.admin1, 'Oklahoma');
  assert.equal(fire.admin2, 'Comanche');
  assert.equal(fire.region, 'Comanche, Oklahoma');
});

test('a prescribed-fire record is placed too, with the shorthand gone', async () => {
  const { events } = await feed();
  const rx = events.find(e => /Flowing 24/.test(String(e.title)));
  assert.ok(rx, 'fixture should include a prescribed fire');
  assert.ok(!/\bRX\b/.test(rx.title), 'the abbreviation should be gone: ' + rx.title);
  assert.equal(rx.admin1, 'Minnesota');
  assert.equal(rx.region, 'Clay, Minnesota');
});

test('a title with no place in it is left alone rather than guessed at', async () => {
  const { events } = await feed();
  // "Tropical Storm Norbert" names no place; inventing one would be worse than
  // leaving the field empty.
  // Only the records themselves: an outlook derived from one carries a source
  // string that also mentions NASA EONET.
  const noPlace = events.filter(e => e.source === 'NASA EONET'
    && String(e.title).split(',').length === 1);
  for (const e of noPlace) {
    assert.equal(e.country, '', e.title + ' was given a country it does not name');
    assert.equal(e.region, '', e.title + ' was given a region it does not name');
  }
});
