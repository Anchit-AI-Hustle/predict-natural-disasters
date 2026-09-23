'use strict';
/*
 * The app may only promise the alerting it has.
 *
 * There is no service worker in this repository, no Push API call, no VAPID
 * key and no durable subscription store — not one process.env read in any
 * handler. A notification can therefore only be raised while the Personal Risk
 * page is open in a tab and refreshing; nothing can reach a reader who has
 * closed it.
 *
 * What was published was "Disaster Alert Notifications | Get Notified" and
 * "Set up natural disaster alert notifications for the places you care about
 * and get warned when risk rises", over a page that has no notification
 * setup on it at all, and a button reading "Enable browser alerts" whose
 * success state said "Browser alerts enabled".
 *
 * These tests hold the copy to the capability from both ends: the promises
 * are gone, the limit is stated where the button is, and — because the cheap
 * way to pass that is to remove the feature — the alerting itself still has
 * to work.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = () => fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

/* ------------------------------------------- the capability, as it stands */

test('nothing in the repository implements background alerting', () => {
  /* If any of this arrives, the copy below may be raised to match it — but
     that has to be a deliberate change, not a promise that drifted ahead of
     the code again. */
  const files = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f))
    .concat(fs.readdirSync(path.join(ROOT, 'api')).map(f => path.join('api', f)));
  const hits = [];
  for (const f of files) {
    const src = read(f);
    for (const marker of ['serviceWorker.register', 'pushManager', 'applicationServerKey', 'webpush']) {
      if (src.includes(marker)) hits.push(f + ': ' + marker);
    }
  }
  assert.deepEqual(hits, [],
    'background alerting now exists; revisit the copy these tests pin, do not just delete them');
});

/* ----------------------------------------------- what the copy may promise */

test('no page promises to warn a reader it cannot reach', () => {
  const offenders = [];
  for (const f of pages()) {
    const src = read(f);
    for (const claim of [
      /get warned when risk rises/i,
      /\bGet Notified\b/,
      /Enable browser alerts/,
      /Browser alerts enabled/,
      /Set custom alerts for any country/i
    ]) {
      if (claim.test(src)) offenders.push(f + ' :: ' + claim);
    }
  }
  assert.deepEqual(offenders, [],
    'these promise alerting that nothing in this repository can deliver');
});

test('the page offering alerts says where they stop', () => {
  const src = read('personal-risk.html');
  assert.match(src, /no background alerting service/i,
    'the limit is not stated on the page that offers the feature');
  assert.match(src, /while this page is open/i,
    'the copy does not say when an alert can actually be raised');
  assert.match(src, /closed/i, 'the copy does not say what happens when the page is closed');
  assert.match(src, /national or regional hazard agency/i,
    'a reader who needs alerting that follows them is given nowhere to go');
});

test('the reader is told the limit without opening anything', async () => {
  const r = await renderPage('personal-risk.html', {
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  const text = r.text();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.match(text, /no background alerting service/i,
    'the limit is in the markup but not rendered');
  assert.match(text, /Alert me while this page is open/,
    'the button no longer says what it does');
  r.close();
});

/* ------------------------------- and the feature itself still has to work */

test('the alerting that is promised still happens', async () => {
  const { events } = await (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
  const incident = events.find(e => e.proximityEligible && !e.forecast &&
    /red|orange/i.test(String(e.alert || '')) && Number.isFinite(+e.lat));
  assert.ok(incident, 'fixture should contain a red or orange incident');
  const place = { id: 'p1', kind: 'Home', name: 'Probe place', lat: +incident.lat + 0.05, lon: +incident.lon };
  const fired = [];

  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    beforeParse(w) {
      function N(title, opts) { fired.push(title + ' :: ' + ((opts || {}).body || '')); }
      N.permission = 'granted';
      N.requestPermission = async () => 'granted';
      w.Notification = N;
    },
    waitFor: d => (d.getElementById('risks') || {}).children && d.getElementById('risks').children.length > 0
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.ok(fired.length > 0,
    'the copy was made honest by removing the feature, which is not what was asked for');
  r.close();
});

test('the alerts page no longer sells a subscription it does not offer', () => {
  const src = read('alerts-notifications.html');
  assert.equal(/Get Notified/.test(src), false, 'the title still promises notification');
  assert.match(src, /cannot notify you when it is closed/i,
    'the page description does not state the limit');
  // And the page really does have no subscription controls, which is why the
  // title had to change rather than the page gaining a form.
  assert.equal(/requestPermission|pushManager/.test(src), false,
    'this page now has alerting controls; the title should describe them');
});
