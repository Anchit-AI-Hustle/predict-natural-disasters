'use strict';
/**
 * C26. A place answer given before the feed has loaded is not an all-clear.
 *
 * The home page answered a saved-place chip, a typed search and "Use my
 * location" from an empty list of events whenever the first load had failed
 * (or had not finished yet), so the reader's own place read "Nothing reported
 * nearby" while the site knew nothing at all. Every place answer on the site
 * now says "Checking…" while the first load is in flight, says the site's own
 * "Live data unavailable." when it failed, and answers again by itself once
 * the data arrives.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage, closeAllWindows } = require('./render.js');

/* A test that fails before its close() would keep its window's timers alive. */
test.after(closeAllWindows);

const PLACE = { id: 'loc-1', kind: 'Home', name: 'Delhi home', lat: 28.61, lon: 77.21, country: 'India', countryCode: 'IN' };
const ALL_CLEAR = /Nothing reported nearby|NOTHING REPORTED NEARBY|None of our sources reports anything/;

/** A page whose /api/events is held open, refused, or served, as the test says. */
function feedSwitch(mode) {
  const ctl = { mode, calls: 0 };
  ctl.beforeParse = (w) => {
    const orig = w.fetch;
    w.fetch = async (input) => {
      const url = String(input && input.url ? input.url : input);
      if (/\/api\/events(?:\?|$)/.test(url)) {
        ctl.calls++;
        if (ctl.mode === 'hang') return new Promise(() => {});
        if (ctl.mode === 'fail') return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
      }
      return orig(input);
    };
    w.HTMLElement.prototype.scrollIntoView = function () {};   // jsdom has none
    Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: ok => ok({ coords: { latitude: PLACE.lat, longitude: PLACE.lon } }) } });
  };
  return ctl;
}

const answerText = d => (d.getElementById('placeResult') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
async function until(fn, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* keep waiting */ } await new Promise(r => setTimeout(r, 25)); }
  return false;
}

/* Every way a reader asks the home page about a place. */
async function askEveryWay(r) {
  const d = r.document, w = r.window;
  const seen = [];
  // 1. A saved-place chip.
  d.querySelector('#savedQuick [data-saved]').click();
  seen.push(['saved chip', answerText(d), d.querySelector('#placeResult .pr-top .risk').textContent.trim()]);
  // 2. A typed search with one match.
  w.PNDPlaceSearch.search = async () => [Object.assign({}, PLACE, { id: undefined, name: 'Delhi', level: 'City' })];
  d.getElementById('placeQ').value = 'Delhi';
  d.getElementById('checkForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => /Delhi/.test(d.querySelector('#placeResult h2').textContent) && !/Delhi home/.test(d.querySelector('#placeResult h2').textContent));
  seen.push(['search', answerText(d), d.querySelector('#placeResult .pr-top .risk').textContent.trim()]);
  // 3. "Use my location".
  d.getElementById('useLoc').click();
  await until(() => /current location/i.test(d.querySelector('#placeResult h2').textContent));
  seen.push(['my location', answerText(d), d.querySelector('#placeResult .pr-top .risk').textContent.trim()]);
  return seen;
}

test('home: while the first load is in flight, every place answer says "Checking…"', async () => {
  const ctl = feedSwitch('hang');
  const r = await renderPage('index.html', {
    storage: { pnd_saved_locations: JSON.stringify([PLACE]) }, beforeParse: ctl.beforeParse, timeoutMs: 4000,
    waitFor: d => !d.getElementById('placeResult').hidden
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  /* The returning reader's own place is answered on arrival, and says it is checking. */
  assert.equal(r.document.getElementById('placeResult').hidden, false, 'the saved place was not answered on arrival');
  assert.equal(r.document.querySelector('#placeResult .pr-top .risk').textContent.trim(), 'Checking…');
  for (const [how, text, badge] of await askEveryWay(r)) {
    assert.equal(badge, 'Checking…', how + ': ' + text);
    assert.doesNotMatch(text, ALL_CLEAR, how + ' gave an all-clear before anything loaded');
    assert.doesNotMatch(text, /Why we're showing this/, how + ' explained a verdict it does not have');
  }
  r.close();
});

test('home: after a failed first load, every place answer says "Live data unavailable."', async () => {
  const ctl = feedSwitch('fail');
  const r = await renderPage('index.html', {
    storage: { pnd_saved_locations: JSON.stringify([PLACE]) }, beforeParse: ctl.beforeParse, timeoutMs: 8000,
    waitFor: d => /Live data unavailable/.test(answerText(d))
  });
  assert.equal(r.errors.filter(e => !/Live feed unavailable/.test(String(e))).length, 0, r.errors.map(String).join('|'));
  const card = r.document.querySelector('#placeResult .card.unavailable');
  assert.ok(card, 'the place answer does not use the site’s unavailable card');
  assert.match(card.textContent, /^Live data unavailable\./);
  assert.match(card.textContent, /This does not mean nothing is happening\. Trying again automatically\./);
  for (const [how, text, badge] of await askEveryWay(r)) {
    assert.equal(badge, 'Live data unavailable', how + ': ' + text);
    assert.match(text, /Live data unavailable\./, how);
    assert.doesNotMatch(text, ALL_CLEAR, how + ' gave an all-clear from a failed load');
  }
  r.close();
});

test('home: a failed first load is answered again by itself when the retry succeeds', async () => {
  const ctl = feedSwitch('fail');
  const r = await renderPage('index.html', {
    storage: { pnd_saved_locations: JSON.stringify([PLACE]) }, beforeParse: ctl.beforeParse, timeoutMs: 8000,
    waitFor: d => /Live data unavailable/.test(answerText(d))
  });
  const d = r.document;
  assert.match(answerText(d), /Live data unavailable/);
  ctl.mode = 'ok';
  await r.window.load();   // what the page's own 60-second timer runs
  assert.ok(await until(() => !/Live data unavailable|Checking…/.test(answerText(d))), 'the answer stayed unavailable after the data arrived: ' + answerText(d));
  assert.match(answerText(d), /Why we're showing this/, 'the re-answer is not a real answer');
  assert.match(d.querySelector('#placeResult h2').textContent, /Delhi home/, 'a different place was answered');
  assert.notEqual(d.querySelector('#placeResult .pr-top .risk').textContent.trim(), 'Live data unavailable');
  r.close();
});

/* ------------------------------------------------------------ My places */

const summary = d => [...d.querySelectorAll('#saved .card .provenance')].map(x => x.textContent.trim());

test('my places: a saved place reads "CHECKING…" while the first load is in flight', async () => {
  const ctl = feedSwitch('hang');
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([PLACE]) }, beforeParse: ctl.beforeParse, timeoutMs: 1500,
    waitFor: d => summary(d).length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.deepEqual(summary(r.document), ['CHECKING…']);
  assert.doesNotMatch(r.document.getElementById('risks').textContent, /No |nothing/i, 'an empty danger list was shown before anything loaded');
  r.close();
});

test('my places: after a failed first load it says "LIVE DATA UNAVAILABLE", and answers again on retry', async () => {
  const ctl = feedSwitch('fail');
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([PLACE]) }, beforeParse: ctl.beforeParse, timeoutMs: 8000,
    waitFor: d => /Live data unavailable/.test(d.getElementById('fresh').textContent)
  });
  const d = r.document, w = r.window;
  assert.deepEqual(summary(d), ['LIVE DATA UNAVAILABLE']);
  assert.ok(d.querySelector('#risks .card.unavailable'), 'the dangers list does not use the site’s unavailable card');
  /* Anything that redraws the page (a sort, a save, a removal) keeps saying so. */
  d.getElementById('sortBy').dispatchEvent(new w.Event('change'));
  assert.deepEqual(summary(d), ['LIVE DATA UNAVAILABLE']);
  assert.ok(d.querySelector('#risks .card.unavailable'), 'a redraw replaced "unavailable" with empty lists');
  assert.doesNotMatch(d.getElementById('saved').textContent, ALL_CLEAR);

  ctl.mode = 'ok';
  await w.loadFeed();   // what the page's own retry timer runs
  assert.ok(await until(() => summary(d)[0] && !/CHECKING|UNAVAILABLE/.test(summary(d)[0])), 'not answered again: ' + summary(d));
  assert.ok(!d.querySelector('#risks .card.unavailable'), 'still unavailable after the data arrived');
  assert.match(d.getElementById('fresh').textContent, /^Updated /);
  r.close();
});

/* ------------------------------------------------- a place page with a point */

test('a place page with coordinates says "Checking…", then "Live data unavailable", never an all-clear', async () => {
  const hang = feedSwitch('hang');
  const a = await renderPage('location-detail.html', { search: '?location=Delhi&lat=28.61&lon=77.21', beforeParse: hang.beforeParse, timeoutMs: 1500,
    waitFor: d => !d.getElementById('placeAnswer').hidden });
  assert.equal(a.document.getElementById('placeAnswer').hidden, false);
  assert.match(a.document.getElementById('placeAnswer').textContent, /^Checking…/);
  a.close();

  const fail = feedSwitch('fail');
  const b = await renderPage('location-detail.html', { search: '?location=Delhi&lat=28.61&lon=77.21', beforeParse: fail.beforeParse, timeoutMs: 8000,
    waitFor: d => /Live data unavailable/.test(d.getElementById('placeAnswer').textContent) });
  const t = b.document.getElementById('placeAnswer').textContent;
  assert.match(t, /^Live data unavailable/);
  assert.doesNotMatch(t, ALL_CLEAR);
  fail.mode = 'ok';
  await b.window.load();
  assert.ok(await until(() => !/Live data unavailable|Checking…/.test(b.document.getElementById('placeAnswer').textContent)), 'not answered again');
  b.close();
});

/* ----------------------------------------------------------- the shared words */

test('place-risk.js holds the words every place answer uses before there is data', () => {
  const P = require('../place-risk.js');
  assert.deepEqual(P.feedState(false, false), 'loading');
  assert.deepEqual(P.feedState(false, true), 'failed');
  assert.deepEqual(P.feedState(true, true), 'loaded');
  assert.deepEqual(P.feedState(true, false), 'loaded');
  assert.equal(P.PENDING.loading.headline, 'Checking…');
  assert.equal(P.PENDING.failed.headline, 'Live data unavailable');
});
