'use strict';
/**
 * Three coachmarks, each where it is earned.
 *
 * There were five, shown in a row on first load: the map, the Personal Risk
 * link, an events card, the forecasts link and the accuracy link, before the
 * reader had done anything at all. Two of them named header links that are
 * display:none on a phone, and measured on /personal-risk the number of real
 * highlights was zero - the tour ran there and pointed at nothing, explaining
 * homepage furniture that was not on the page.
 *
 * These are the structural rules. The geometry - spotlight hole, no clipped
 * tooltip, card never covering its own target, bottom sheet below 600px - is
 * measured in a real browser by tools/tour-browser-check.js, because jsdom
 * has no layout and every rectangle it reports is zero.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('there are three coachmarks and they say what the spec asks them to say', async () => {
  const r = await renderPage('index.html', { timeoutMs: 3000 });
  const PND = r.window.PND;
  const steps = PND.COACH_STEPS;
  assert.deepEqual(Object.keys(steps), ['search', 'save', 'evidence'],
    'the coachmarks are no longer the three stages of the place journey');

  assert.match(steps.search.title, /^Start here$/);
  assert.match(steps.search.text, /Search Home, Family, Office or anywhere you care about/);
  assert.match(steps.save.title, /Keep watch over this place/);
  assert.match(steps.evidence.title, /Know why we’re showing this/);

  /* Each points at the thing it describes on the page that has it. */
  assert.match(steps.search.sel, /#placeQ/, 'the first coachmark does not point at the search field');
  assert.match(steps.save.sel, /#savePlace/, 'the second does not point at Save');
  assert.match(steps.evidence.sel, /#viewEvidence/, 'the third does not point at the evidence');
  r.close();
});

test('a coachmark with nothing to point at is not shown at all', async () => {
  /* The failure this replaces: the tour opened on every page and ran steps
     whose targets were not there, so a reader on /personal-risk got a card
     describing the homepage map with no highlight anywhere. */
  const r = await renderPage('personal-risk.html', { timeoutMs: 3000 });
  const { window } = r;
  window.localStorage.removeItem('pnd_tour_done');
  window.PND.startTour(true);
  assert.equal(window.document.querySelectorAll('.pnd-coach').length, 0,
    'a coachmark opened on a page where none of them has a target');
  r.close();
});

test('the opening coachmark points at the homepage search field', async () => {
  const r = await renderPage('index.html', { timeoutMs: 3000 });
  const { window } = r;
  const doc = window.document;
  assert.ok(doc.getElementById('placeQ'), 'the homepage has no place search to point at');
  window.localStorage.removeItem('pnd_tour_done');
  doc.querySelectorAll('.pnd-coach').forEach(n => n.remove());
  window.PND.startTour(true);
  const coach = doc.querySelector('.pnd-coach');
  assert.ok(coach, 'the opening coachmark did not open on the homepage');
  assert.equal(coach.querySelector('h2').textContent, 'Start here');
  assert.equal(coach.querySelector('.coach-progress').textContent, '1 of 1',
    'the opening coachmark is still part of a multi-step tour');
  r.close();
});

test('the contextual coachmarks are shown once each, and not before their moment', async () => {
  const r = await renderPage('index.html', { timeoutMs: 3000 });
  const { window } = r;
  const doc = window.document;
  doc.querySelectorAll('.pnd-coach').forEach(n => n.remove());
  ['search', 'save', 'evidence'].forEach(k => window.localStorage.removeItem('pnd_coach_' + k));

  /* Nothing to save yet: the button does not exist until a place has been
     answered for, so the coachmark about it must not fire. */
  assert.equal(window.PND.coach('save'), false,
    'the Save coachmark fired before there was anything to save');
  assert.equal(doc.querySelectorAll('.pnd-coach').length, 0);

  /* Once it exists, once - and only once, ever. */
  const btn = doc.createElement('button');
  btn.id = 'savePlace';
  btn.textContent = 'Save place';
  doc.body.appendChild(btn);
  assert.equal(window.PND.coach('save'), true, 'the Save coachmark did not fire when Save appeared');
  assert.equal(doc.querySelector('.pnd-coach .coach-card h2').textContent, 'Keep watch over this place.');
  doc.querySelectorAll('.pnd-coach').forEach(n => n.remove());
  assert.equal(window.PND.coach('save'), false, 'the Save coachmark fired a second time');

  /* Dismissing one does not mark the others seen. */
  assert.equal(window.localStorage.getItem('pnd_coach_evidence'), null,
    'seeing one contextual coachmark marked another as seen');
  r.close();
});

test('the homepage asks for the contextual coachmarks when it has an answer', () => {
  const src = read('index.html');
  assert.match(src, /PND\.coach\('save'\)/, 'nothing asks for the Save coachmark');
  assert.match(src, /PND\.coach\('evidence'\)/, 'nothing asks for the evidence coachmark');
  /* Both are inside the function that renders an answer, not on load. */
  const answer = src.slice(src.indexOf('function answer(place)'));
  assert.ok(answer.indexOf("PND.coach('save')") > 0 &&
    answer.indexOf("PND.coach('save')") < answer.indexOf('\nPR.form'),
    'the contextual coachmarks are not fired from the answer');
});

test('replaying shows all three again, whatever has been dismissed', async () => {
  const r = await renderPage('index.html', { timeoutMs: 3000 });
  const { window } = r;
  const doc = window.document;
  doc.querySelectorAll('.pnd-coach').forEach(n => n.remove());
  window.localStorage.setItem('pnd_tour_done', '1');
  ['search', 'save', 'evidence'].forEach(k => window.localStorage.setItem('pnd_coach_' + k, '1'));

  /* All three targets present, as they are once a place has been answered. */
  for (const id of ['savePlace', 'viewEvidence']) {
    const el = doc.createElement('button'); el.id = id; doc.body.appendChild(el);
  }
  window.PND.replayTour();
  const coach = doc.querySelector('.pnd-coach');
  assert.ok(coach, 'replaying showed nothing');
  assert.equal(coach.querySelector('.coach-progress').textContent, '1 of 3',
    'replaying no longer offers all three');
  for (const k of ['search', 'save', 'evidence']) {
    assert.equal(window.localStorage.getItem('pnd_coach_' + k), null,
      'replaying left ' + k + ' marked as already seen');
  }
  assert.equal(window.localStorage.getItem('pnd_tour_done'), null);
  r.close();
});

test('the card is a bottom sheet on a phone', () => {
  /* Measured on an iPhone SE at 375x667 before this: the evidence step's
     target sat mid-screen with a 276px card, so neither above nor below had
     room and the card was pinned to the top, directly over the thing it was
     describing. The spec asks for a fixed bottom sheet below 600px. */
  const src = read('portal.js');
  assert.match(src, /const isSheet=\(\)=>innerWidth<=600;/,
    'the phone breakpoint for the coachmark is gone');
  const put = src.slice(src.indexOf('const put=(r)=>{'), src.indexOf('const put=(r)=>{') + 900);
  assert.match(put, /card\.style\.left='12px';card\.style\.right='12px'/,
    'the sheet no longer spans the screen with 12px gutters');
  assert.match(put, /card\.style\.bottom='calc\(12px \+ env\(safe-area-inset-bottom\)\)'/,
    'the sheet does not clear the home indicator');
  assert.match(put, /card\.style\.width='auto'/, 'the sheet has a fixed width again');
  /* And the target is put where the sheet cannot reach it. */
  assert.match(src, /innerHeight\*0\.2/, 'the target is no longer scrolled clear of the sheet');
});

test('the coachmark is still keyboard-operable and dismissible', async () => {
  const r = await renderPage('index.html', { timeoutMs: 3000 });
  const { window } = r;
  const doc = window.document;
  doc.querySelectorAll('.pnd-coach').forEach(n => n.remove());
  window.localStorage.removeItem('pnd_tour_done');
  window.PND.startTour(true);
  const coach = doc.querySelector('.pnd-coach');
  assert.ok(coach, 'no coachmark to operate');
  assert.equal(coach.getAttribute('role'), 'dialog');
  assert.equal(coach.getAttribute('aria-modal'), 'true');
  for (const a of ['skip', 'back', 'next']) {
    assert.ok(coach.querySelector('[data-a=' + a + ']'), 'no ' + a + ' control');
  }
  assert.ok(coach.querySelector('.coach-x').getAttribute('aria-label'),
    'the close button has no accessible name');
  assert.ok(coach.querySelector('.coach-ring'), 'there is no spotlight at all');

  coach.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.querySelectorAll('.pnd-coach').length, 0, 'Escape did not close the coachmark');
  assert.equal(window.localStorage.getItem('pnd_tour_done'), '1',
    'dismissing it does not persist, so it comes back on every load');
  r.close();
});
