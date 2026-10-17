'use strict';
/**
 * How far ahead this site looks, which it never said.
 *
 * Every outlook carries its own target window, and the furthest of them is the
 * horizon - but nothing published it, so "until when have predictions been
 * made" could only be answered by opening all thirty records and comparing
 * their windows by hand. Against the live feed of 2026-09-20 the answer was
 * 27 September: 6.9 days, in windows of 2, 3, 4, 5 and 7 days.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const handler = require(path.join(ROOT, 'api', 'events.js'));

test.after(closeAllWindows);

async function feed(mock) {
  const r = await callApi(handler, '/api/events', mock || {});
  return r.json();
}

test('the feed states how far ahead its forecasts run', async () => {
  const d = await feed();
  const h = d.meta.forecastHorizon;
  assert.ok(h, 'the feed carries open forecast windows but publishes no horizon');
  assert.ok(Number.isFinite(Date.parse(h.furthestWindowEnds)));
  assert.ok(Number.isFinite(Date.parse(h.nextWindowEnds)));
  assert.ok(Date.parse(h.nextWindowEnds) <= Date.parse(h.furthestWindowEnds));
});

test('the published horizon is the furthest window, recomputed independently', async () => {
  const d = await feed();
  const open = d.events.filter(e => e.forecast && !e.windowClosed && e.targetEnd);
  const ends = open.map(e => Date.parse(e.targetEnd)).filter(Number.isFinite);
  assert.ok(ends.length > 0);
  assert.equal(Date.parse(d.meta.forecastHorizon.furthestWindowEnds), Math.max(...ends));
  assert.equal(Date.parse(d.meta.forecastHorizon.nextWindowEnds), Math.min(...ends));
});

test('no open forecast reaches past the horizon the feed publishes', async () => {
  /* The rule rather than the number: a new outlook kind with a longer window
     must move the horizon, not sit silently beyond it. */
  const d = await feed();
  const limit = Date.parse(d.meta.forecastHorizon.furthestWindowEnds);
  for (const e of d.events) {
    if (!e.forecast || e.windowClosed || !e.targetEnd) continue;
    assert.ok(Date.parse(e.targetEnd) <= limit,
      `${e.id} runs to ${e.targetEnd}, past the published horizon`);
  }
});

test('the window lengths listed are the window lengths that exist', async () => {
  const d = await feed();
  const h = d.meta.forecastHorizon;
  const actual = new Set(d.events
    .filter(e => e.forecast && !e.windowClosed && e.targetStart && e.targetEnd)
    .map(e => Math.round((Date.parse(e.targetEnd) - Date.parse(e.targetStart)) / 86400000 * 10) / 10));
  assert.deepEqual(h.windowLengthDays, [...actual].sort((a, b) => a - b));
});

test('a closed window does not extend the horizon', async () => {
  const d = await feed();
  const limit = Date.parse(d.meta.forecastHorizon.furthestWindowEnds);
  const closed = d.events.filter(e => e.windowClosed);
  for (const e of closed) {
    assert.ok(Date.parse(e.targetEnd) <= Date.now(),
      `${e.id} is marked closed but its window has not ended`);
  }
  assert.ok(limit >= Date.now(), 'the horizon is in the past');
});

test('with no open window the page says so rather than inventing a date', async () => {
  const { window } = await renderPage('forecasts.html', { timeoutMs: 15000 });
  const say = window.PND.horizonText.bind(window.PND);
  for (const meta of [{}, { forecastHorizon: null }, null, undefined]) {
    const text = say(meta);
    assert.match(text, /There are no open forecasts/,
      `horizonText(${JSON.stringify(meta)}) reads "${text}"`);
    assert.doesNotMatch(text, /\d{4}/, 'a date appeared where there is no horizon');
  }
  window.close();
});

test('the forecast pages tell the reader the horizon', async () => {
  for (const [page, opts] of [['forecasts.html', {}],
    ['forecast-list.html', { url: '/forecast-list' }],
    ['forecast-calendar.html', { url: '/forecast-calendar' }]]) {
    const { window } = await renderPage(page, Object.assign({
      timeoutMs: 15000,
      waitFor: d => ((d.getElementById('horizonNote') || d.getElementById('forecastNote') || {}).textContent || '')
        .includes('reach as far as')
    }, opts));
    const d = window.document;
    const note = d.getElementById('horizonNote') || d.getElementById('forecastNote');
    assert.ok(note, `${page} never states the forecast horizon`);
    assert.match(note.textContent, /Our forecasts reach as far as/, page);
    /* And it must not read as a promise that nothing will happen after. */
    assert.match(note.textContent, /It does not mean nothing will happen after that date/, page);
    window.close();
  }
});

test('every page says it the same way', async () => {
  const pages = [];
  for (const [page, opts] of [['forecasts.html', {}], ['forecast-list.html', { url: '/forecast-list' }]]) {
    const { window } = await renderPage(page, Object.assign({
      timeoutMs: 15000,
      waitFor: d => ((d.getElementById('horizonNote') || d.getElementById('forecastNote') || {}).textContent || '')
        .includes('reach as far as')
    }, opts));
    const d = window.document;
    const note = (d.getElementById('horizonNote') || d.getElementById('forecastNote')).textContent;
    const tail = 'will happen after that date.';
    pages.push(note.slice(note.indexOf('Our forecasts reach as far as'), note.indexOf(tail) + tail.length));
    window.close();
  }
  assert.equal(pages[0], pages[1],
    'the two pages phrase the same horizon differently');
});
