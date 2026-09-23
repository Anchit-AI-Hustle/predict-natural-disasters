'use strict';
/*
 * The app may only promise the alerting it has.
 *
 * Until this change there was no service worker, no Push API call, no VAPID
 * key and no subscription store, and these tests held the copy to that: an
 * alert could only be raised while the Personal Risk page was open. The
 * first of them was written to fail the day background alerting arrived, so
 * that the copy would be revisited on purpose rather than drift.
 *
 * It has arrived (api/alerts.js, api/alerts-run.js, sw.js, alerts-client.js),
 * but only where a deployment has an alert store and a schedule. So the rule
 * is now conditional, and so is the copy: background alerts are offered only
 * when /api/alerts says the service is on, and where it is not the page says
 * so, offers the in-page alerting that still works, and names where alerting
 * that follows a reader can be had. The promises that were never true stay
 * banned.
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

test('background alerting exists end to end, and only behind the service switch', () => {
  const src = f => read(f);
  assert.match(src('sw.js'), /addEventListener\('push'/, 'nothing shows a pushed alert');
  assert.match(src('alerts-client.js'), /pushManager\.subscribe/, 'nothing subscribes a device');
  assert.match(src('alerts-client.js'), /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(src('api/alerts-run.js'), /WEBPUSH\.send/, 'nothing sends a push');
  /* The switch: the page is offered background alerts only by the service. */
  assert.match(src('alerts-client.js'), /if \(!cfg\.available\) return Object\.assign\(base, \{ mode: 'unavailable'/,
    'the page can offer background alerts without asking whether the service is on');
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
  assert.match(src, /While this page is open/,
    'the copy does not say when an alert can be raised without the service');
  assert.match(src, /closed/i, 'the copy does not say what happens when the page is closed');
  assert.match(src, /national or regional hazard agency/i,
    'a reader who needs alerting that follows them is given nowhere to go');
  assert.equal(/no background alerting service/i.test(src), false,
    'the page still denies a service that now exists where it is switched on');
});

test('the reader is told the limit without opening anything', async () => {
  const r = await renderPage('personal-risk.html', {
    waitFor: d => /not switched on/.test((d.getElementById('alertsStatus') || {}).textContent || '')
  });
  const text = r.text();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.match(text, /not switched on/i, 'where the service is off, the page does not say so');
  assert.match(text, /nothing reaches you once it is closed/,
    'the limit of in-page alerting is not stated where it is offered');
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
  assert.match(src, /Personal Risk/,
    'the page description does not say where alerts are actually set up');
  // The page itself still has no subscription controls, which is why its
  // title describes a list rather than a sign-up.
  assert.equal(/requestPermission|pushManager/.test(src), false,
    'this page now has alerting controls; the title should describe them');
});
