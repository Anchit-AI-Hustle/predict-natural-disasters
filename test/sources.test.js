'use strict';
/*
 * What the site says about where its data comes from.
 *
 * The sources page listed four names written into the file. One of them -
 * WMO - nothing here has ever read; four that are read on every request were
 * missing; and beside them sat a search box, a hazard filter and a level
 * filter, all disabled, and a "Refresh source status" button next to a line
 * describing the event feed rather than any source's status.
 *
 * A page called Sources & coverage has to answer three questions from the
 * feed's own scan record: which sources answered this time, what each one
 * covers, and what its silence does and does not establish.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const feed = async (mock) => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events', mock)).json();
const open = (mock) => renderPage('resources.html', {
  mock: mock || {},
  waitFor: d => (d.getElementById('cards') || {}).children && d.getElementById('cards').children.length > 0
});
const cardsOf = r => [...r.document.querySelectorAll('#cards .event-card')];

test('the sources page lists the sources this site actually reads', async () => {
  const { meta } = await feed();
  const r = await open();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const cards = cardsOf(r);
  assert.equal(cards.length, meta.scan.providers.length,
    'the page shows ' + cards.length + ' sources for a feed that reads ' + meta.scan.providers.length);
  const text = r.text();
  /* The glossary writes acronyms out in full the first time they appear, so
     "USGS Earthquake Hazards Program" renders as "United States Geological
     Survey (USGS) Earthquake Hazards Program". The distinctive part of the
     label is what has to be there. */
  const distinctive = label => String(label)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b[A-Z][A-Z0-9/]{1,}\b/g, ' ')
    .replace(/[^A-Za-z -]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  for (const p of meta.scan.providers) {
    const d = distinctive(p.label);
    assert.ok(text.includes(p.label) || (d.length > 6 && text.includes(d)),
      'the page does not list ' + p.provider + ' (looked for "' + (d || p.label) + '")');
  }
  assert.equal(/\bWMO\b|World Meteorological/.test(text), false,
    'the page still presents a source nothing here reads');
  r.close();
});

test('each source says what it covers and what its silence establishes', async () => {
  const { meta } = await feed();
  const r = await open();
  const cards = cardsOf(r).map(c => c.textContent.replace(/\s+/g, ' '));
  const gdacs = cards.find(c => /GDACS/.test(c));
  assert.ok(gdacs, 'GDACS is missing from the page');
  assert.match(gdacs, /Hazards/, 'a source does not say which hazards it covers');
  assert.match(gdacs, /Reach/, 'a source does not say how far it reaches');
  assert.match(gdacs, /not evidence that nothing happened/i,
    'a selective source does not say that its silence proves nothing');

  const usgs = cards.find(c => /Earthquake Hazards Program/.test(c));
  assert.match(usgs, /real evidence that nothing happened/i,
    'an exhaustive source does not say that its silence is evidence');

  const warningFeeds = meta.scan.providers.filter(p => p.recordsObservations === false);
  assert.ok(warningFeeds.length > 0, 'control: the feed should carry at least one warning source');
  for (const w of warningFeeds) {
    const card = cards.find(c => c.includes(w.label));
    assert.match(card, /not observations/i,
      w.provider + ' does not say that its records are warnings rather than observations');
  }
  r.close();
});

test('the page reports which sources answered, from this scan', async () => {
  const up = await open();
  const answeredWhenUp = (up.document.querySelector('#cards .panel') || {}).textContent || '';
  /* One count of working sources, the status line's, split into in full and
     in part (launch audit D17). */
  assert.match(answeredWhenUp, /\d+ of \d+ sources working: \d+ answered in full this time/);
  /* "Answered" and "answered in full" are different counts; the page prints a
     status line reporting the first, so the panel must not report the second
     under the same word. */
  const line = (up.document.getElementById('statusLine') || {}).textContent || '';
  assert.equal(/matching records/.test(line), false,
    'the sources page counts event records in a line about sources');
  assert.match(line, /sources working/i);
  up.close();

  /* With two sources down, the count moves and the cards say which. */
  const down = await open({ down: ['gdacs', 'nhc'] });
  const summary = (down.document.querySelector('#cards .panel') || {}).textContent || '';
  const before = Number(answeredWhenUp.match(/(\d+) of/)[1]);
  const after = Number(summary.match(/(\d+) of/)[1]);
  assert.equal(after, before - 2, 'two sources went down and the page reported the same count');
  const gdacsCard = cardsOf(down).map(c => c.textContent).find(c => /GDACS/.test(c));
  assert.match(gdacsCard, /Did not answer/,
    'a source that failed this scan is still shown as having answered');
  down.close();
});

test('the page states which hazards no source here can establish an absence for', async () => {
  const { meta } = await feed();
  const r = await open();
  const summary = (r.document.querySelector('#cards .panel') || {}).textContent || '';
  /* Computed independently from the provider table, in the same families the
     verification engine grades on. */
  const OBS = require(path.join(ROOT, 'observed-model.js'));
  const seen = {};
  for (const p of meta.scan.providers) {
    for (const h of p.hazards || []) {
      const f = OBS.familiesOf(h, '')[0];
      if (f === 'other') continue;
      seen[f] = seen[f] || (p.completeness === 'exhaustive' && p.recordsObservations !== false);
    }
  }
  const blind = Object.keys(seen).filter(f => !seen[f]);
  assert.ok(blind.length > 0,
    'every hazard now has an exhaustive observer, so this page has nothing to disclose - check the fixture');
  for (const f of blind) {
    assert.ok(summary.includes(f.replace(/-/g, ' ')),
      f + ' has no source that can establish an absence, and the page does not say so');
  }
  assert.match(summary, /only that none was reported/i);
  r.close();
});

test('the page offers no control that does nothing', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'resources.html'), 'utf8');
  assert.equal(/<(input|select|button)[^>]*\bdisabled\b/.test(html), false,
    'a disabled control that looks like a filter is still on the page');
  const r = await open();
  /* The refresh button refreshes: it re-reads the feed and redraws. */
  const btn = r.document.getElementById('refresh');
  assert.ok(btn, 'the page lost its refresh control');
  const before = cardsOf(r).length;
  btn.click();
  await new Promise(res => setTimeout(res, 400));
  assert.equal(cardsOf(r).length, before, 'refreshing the page emptied it');
  r.close();
});
