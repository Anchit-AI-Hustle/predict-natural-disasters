'use strict';
/**
 * Launch audit A, My places (/personal-risk) and the place answer it shares
 * with the home page (place-risk.js).
 *
 *  A6  Tokyo's card read "WATCH · a forecast covers it" while the same page
 *      listed a confirmed M5.5 85 km away. The answer now weighs what was
 *      reported against what we forecast, takes the stronger, and says both.
 *  A13 The alerts panel read like a note about an unfinished backend, and a
 *      "Past disasters" panel said the site publishes no history.
 *  A14 Turning alerts on changed nothing a reader could see.
 *  A28 Six-decimal coordinates, Remove without undo, a stale "Chosen" line.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const PR = require(path.join(ROOT, 'place-risk.js'));

test.after(closeAllWindows);

/* Chillán is 127 km from the mocked M5.8 off Concepción (USGS, green), and
   inside the 7-day aftershock forecast that follows it: the Tokyo case. */
const CHILLAN = { name: 'Chillán, Chile', lat: -36.6, lon: -72.1, country: 'Chile', countryCode: 'CL' };

test('A6: a forecast answer also names the confirmed event near the place', async () => {
  const events = await sampleEvents();
  const A = PR.assess(CHILLAN, events);
  assert.equal(A.level, 'WATCH');
  assert.equal(A.lead.r.band, 'C', 'the forecast is the stronger of the two and leads');
  assert.ok(A.observed, 'the reported event is not part of the answer');
  assert.equal(A.observed.e.id, 'usgs-us7000efgh');
  assert.match(A.why, /One of our forecasts covers your place/);
  assert.match(A.why, /A reported event, M 5\.8 - 40 km W of Concepcion, Chile, is 127 km away/);
});

test('A6: the stronger of what was reported and what we forecast decides, and a tie goes to the report', () => {
  const H = require(path.join(ROOT, 'hazard-model.js'));
  const place = { name: 'p', lat: 0, lon: 0, country: 'X' };
  /* 300 km away and High: on its own a Watch. Our forecast covering the place
     is a Watch too. A report outranks our estimate at the same level. */
  const far = { id: 'far', type: 'Earthquake', evidenceState: 'observed', proximityEligible: true,
    lat: 0, lon: 300 / 111.195, severity: 'Severe', alert: 'Red', title: 'M 7.0 far' };
  const fc = { id: 'fc', type: 'Flood', forecast: true, forecastScope: 'country', country: 'X',
    lat: 0.1, lon: 0.1, alert: 'Watch', title: 'Flood risk in X' };
  void H;
  const A = PR.assess(place, [far, fc]);
  assert.equal(A.level, 'WATCH');
  assert.equal(A.lead.e.id, 'far', 'our forecast outranked a report at the same level');
  assert.ok(A.forecast && A.forecast.e.id === 'fc', 'the forecast is not part of the answer');
});

test('A6: the saved-place card does not say only "a forecast covers it" beside a reported event', async () => {
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([Object.assign({ id: 'loc-1', kind: 'Home' }, CHILLAN)]) },
    waitFor: d => /WATCH/.test((d.getElementById('saved') || {}).textContent || '')
  });
  const card = r.document.querySelector('#saved .card').textContent.replace(/\s+/g, ' ');
  assert.match(card, /WATCH · our forecast covers it · a reported event is 127 km away/, card);
  r.close();
});

/* ------------------------------------------------------------------ A13 */

test('A13: My places opens on the saved places, and its alerts text is a benefit, not a backend note', async () => {
  const r = await renderPage('personal-risk.html', {
    waitFor: d => !/Checking what this device can do/.test((d.getElementById('alertsStatus') || {}).textContent || '')
  });
  const d = r.document;
  const panels = [...d.querySelectorAll('main section.panel')];
  const savedAt = panels.findIndex(p => p.querySelector('#saved'));
  const alertsAt = panels.findIndex(p => p.id === 'alertsPanel');
  assert.ok(savedAt >= 0 && alertsAt >= 0);
  assert.ok(savedAt < alertsAt, 'Saved places should come before Alerts');
  const t = d.getElementById('alertsStatus').textContent;
  assert.doesNotMatch(t, /not switched on for this site|nowhere to keep|nothing that checks/i, t);
  assert.match(t, /Alerts work while this page is open/);
  r.close();
});

test('A13: there is no "Past disasters" panel saying the site has no history', async () => {
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([Object.assign({ id: 'loc-1', kind: 'Home' }, CHILLAN)]) },
    waitFor: d => d.querySelectorAll('#risks section.panel').length > 0
  });
  const t = r.document.getElementById('risks').textContent;
  assert.doesNotMatch(t, /We do not publish a history of past events/);
  const link = r.document.querySelector('#risks a[href^="/historical-events"]');
  assert.ok(link, 'no way to the past events the site does keep');
  r.close();
});

/* ------------------------------------------------------------------ A14 */

test('A14: turning page alerts on says so and is announced', async () => {
  const r = await renderPage('personal-risk.html', {
    beforeParse(w) {
      let perm = 'default';
      w.Notification = function () {};
      Object.defineProperty(w.Notification, 'permission', { get: () => perm });
      w.Notification.requestPermission = async () => { perm = 'granted'; return perm; };
    },
    waitFor: d => { const t = d.getElementById('alertsToggle'); return t && !t.hidden; }
  });
  const d = r.document;
  const t = d.getElementById('alertsToggle');
  assert.equal(t.getAttribute('aria-pressed'), 'false');
  t.click();
  await new Promise(res => setTimeout(res, 300));
  assert.equal(t.getAttribute('aria-pressed'), 'true');
  assert.match(t.textContent, /Alerts on · Turn off/);
  assert.match(d.getElementById('alertsStatus').textContent, /Alerts are on while this page is open/);
  assert.equal(d.getElementById('alertsStatus').getAttribute('role'), 'status');
  r.close();
});

test('A14: a location the browser would not share is reported in a status line', async () => {
  const r = await renderPage('personal-risk.html', {
    beforeParse(w) {
      Object.defineProperty(w.navigator, 'geolocation', { value: {
        getCurrentPosition: (ok, fail) => fail({ code: 1, message: 'denied' }),
        watchPosition: () => 0, clearWatch: () => {} }, configurable: true });
    },
    waitFor: d => d.getElementById('useLocation')
  });
  const d = r.document;
  d.getElementById('useLocation').click();
  await new Promise(res => setTimeout(res, 300));
  const s = d.getElementById('locationStatus');
  assert.equal(s.getAttribute('role'), 'status');
  assert.match(s.textContent, /Your browser did not share a location/);
  r.close();
});

/* ------------------------------------------------------------------ A28 */

test('A28: saved places show two decimals, Remove can be undone, and the chosen line clears', async () => {
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([{ id: 'loc-1', kind: 'Home', name: 'Mumbai', lat: 19.054999, lon: 72.869203, country: 'India' }]) },
    waitFor: d => d.querySelector('#saved .card')
  });
  const d = r.document, w = r.window;
  const card = d.querySelector('#saved .card').textContent;
  assert.match(card, /19\.05, 72\.87/);
  assert.doesNotMatch(card, /19\.054999/);
  d.querySelector('#saved .card [data-remove]').click();
  await new Promise(res => setTimeout(res, 50));
  assert.equal(w.PND.savedLocations().length, 0);
  const undo = d.querySelector('#savedNote [data-undo]');
  assert.ok(undo, 'no Undo after Remove');
  undo.click();
  await new Promise(res => setTimeout(res, 50));
  assert.equal(w.PND.savedLocations().length, 1);
  assert.equal(w.PND.savedLocations()[0].name, 'Mumbai');
  /* Saving clears "Chosen: … press Save." */
  d.getElementById('placeResult').textContent = 'Chosen: Tokyo, Japan (state or region). Choose the kind of place and press Save.';
  d.getElementById('placeName').value = 'Tokyo';
  d.getElementById('lat').value = '35.68';
  d.getElementById('lon').value = '139.76';
  d.getElementById('f').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise(res => setTimeout(res, 50));
  assert.doesNotMatch(d.getElementById('placeResult').textContent, /Chosen:/);
  r.close();
});
