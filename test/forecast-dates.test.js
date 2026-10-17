'use strict';
/**
 * Forecast windows that are whole days are shown as days.
 *
 * Seen on /forecasts on 17 October 2026: "Extreme heat forecast for Mumbai,
 * 19 Oct to 21 Oct" started "19 Oct 2026, 5:30 AM IST" and ended
 * "22 Oct 2026, 5:29 AM IST". The model's window is 19 Oct 00:00 UTC to
 * 21 Oct 23:59:59 UTC - three whole days - and the shared formatter turned
 * each edge into a time of day in the reader's chosen zone. East of UTC the
 * end ran into the day after the title's; west of it the start fell on the
 * day before. A whole-day window now reads as its days, the same for every
 * reader; a window that starts or ends at a real moment keeps its time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const open = () => renderPage('forecast-list.html', { timeoutMs: 4000, waitFor: (d, w) => !!(w.PND && w.PNDForecastTable) });

const MUMBAI = {
  id: 'model-heat-mumbai-in-2026-10-19', forecast: true, forecastKind: 'model-advance', type: 'Extreme Heat',
  title: 'Extreme heat forecast for Mumbai, 19 Oct to 21 Oct', country: 'India', region: 'Mumbai, Maharashtra, India',
  issuedAt: '2026-10-14T20:58:34.582Z', updated: '2026-10-14T20:58:34.582Z',
  targetStart: '2026-10-19T00:00:00Z', targetEnd: '2026-10-21T23:59:59Z', alert: 'Moderate'
};
const AFTERSHOCKS = {
  id: 'aftershock-us7000x', forecast: true, forecastKind: 'aftershock-sequence', type: 'Earthquake',
  title: 'Earthquake aftershock sequence', updated: '2026-10-16T03:35:00Z',
  targetStart: '2026-10-16T03:35:00Z', targetEnd: '2026-10-23T03:35:00Z', alert: 'Moderate'
};
const ZONES = ['Asia/Kolkata', 'America/New_York', 'UTC', 'Pacific/Auckland', 'America/Los_Angeles'];

test('a whole-day edge reads as its day, in every time zone', async () => {
  const r = await open();
  const P = r.window.PND;
  for (const tz of ZONES) {
    P.timezone = tz;
    assert.equal(P.fmtWhen('2026-10-19T00:00:00Z'), '19 Oct 2026', tz + ': start of a whole day');
    assert.equal(P.fmtWhen('2026-10-19T00:00:00.000Z'), '19 Oct 2026', tz);
    assert.equal(P.fmtWhen('2026-10-21T23:59:59Z'), '21 Oct 2026', tz + ': end of a whole day');
    assert.equal(P.fmtWhen('2026-10-21T23:59:59.999Z'), '21 Oct 2026', tz);
    /* A real moment keeps its time and zone, as before. */
    assert.equal(P.fmtWhen('2026-10-16T03:35:00Z'), P.fmtDate('2026-10-16T03:35:00Z'), tz + ': a moment lost its time');
    assert.match(P.fmtWhen('2026-10-16T03:35:00Z'), /\d:\d\d (AM|PM)/);
  }
  /* Midnight that opens a window ending at a real moment is a moment too. */
  P.timezone = 'America/New_York';
  assert.match(P.fmtWhen('2026-10-19T00:00:00Z', '2026-10-19T06:30:00Z'), /18 Oct 2026, 8:00 PM/,
    'a window from midnight to a real moment lost its start time');
  assert.equal(P.fmtWhen('2026-10-19T00:00:00Z', '2026-10-21T23:59:59Z'), '19 Oct 2026');
  assert.equal(P.windowText({ targetStart: '2026-10-19T00:00:00Z', targetEnd: '2026-10-19T06:30:00Z' }).indexOf('18 Oct 2026, 8:00 PM'), 7);
  assert.equal(P.fmtWhen(''), '\u2014');
  assert.equal(P.fmtWhen('not a date'), 'not a date');
  r.close();
});

test('the window sentence and the table give the title\'s days', async () => {
  const r = await open();
  const { PND: P, PNDForecastTable: FT, document } = r.window;
  for (const tz of ZONES) {
    P.timezone = tz;
    assert.equal(P.windowText(MUMBAI), 'Starts 19 Oct 2026 \u00b7 lasts 3 days', tz);
    const box = document.createElement('table');
    box.innerHTML = '<tbody>' + FT.row(MUMBAI) + '</tbody>';
    const cell = l => box.querySelector('td[data-label="' + l + '"]').textContent.trim();
    assert.equal(cell('Starts'), '19 Oct 2026', tz + ': the table starts on another day than the title');
    assert.equal(cell('Ends'), '21 Oct 2026', tz + ': the table ends on another day than the title');
    /* The aftershock window is a moment to a moment: its times stay. */
    box.innerHTML = '<tbody>' + FT.row(AFTERSHOCKS) + '</tbody>';
    assert.match(cell('Starts'), /(AM|PM)/, tz);
  }
  r.close();
});

test('a window that ends at midnight ends the day before', async () => {
  /* GDACS drought outlooks run 15 Oct 00:00 to 14 Nov 00:00 UTC: thirty
     whole days, the last of them 13 Nov. "Ends 14 Nov" would add a day. */
  const r = await open();
  const { PND: P, PNDForecastTable: FT, document } = r.window;
  const drought = { id: 'OUT-gdacs-DR-1018332', forecast: true, forecastKind: 'signal-derived-outlook', type: 'Drought',
    title: 'Drought outlook', targetStart: '2026-10-15T00:00:00.000Z', targetEnd: '2026-11-14T00:00:00.000Z', updated: '2026-10-15T00:00:00.000Z' };
  for (const tz of ZONES) {
    P.timezone = tz;
    const box = document.createElement('table');
    box.innerHTML = '<tbody>' + FT.row(drought) + '</tbody>';
    const cell = l => box.querySelector('td[data-label="' + l + '"]').textContent.trim();
    assert.equal(cell('Starts'), '15 Oct 2026', tz);
    assert.equal(cell('Ends'), '13 Nov 2026', tz + ': a midnight end was shown as the day it excludes');
    assert.equal(P.windowText(drought), 'Starts 15 Oct 2026 \u00b7 lasts 30 days', tz);
    assert.equal(P.fmtWhen('2026-11-14T00:00:00.000Z', null, 'end'), '13 Nov 2026', tz);
  }
  r.close();
});

test('the horizon names a day when the furthest window ends with a day', async () => {
  const r = await open();
  const P = r.window.PND;
  P.timezone = 'Asia/Kolkata';
  const t = P.horizonText({ forecastHorizon: { furthestWindowEnds: '2026-11-13T23:59:59Z', daysAhead: 27.4, windowLengthDays: [3, 30] } });
  assert.match(t, /^Our forecasts reach as far as 13 Nov 2026 \(/, t);
  assert.doesNotMatch(t, /AM|PM|India Standard Time/, t);
  const t2 = P.horizonText({ forecastHorizon: { furthestWindowEnds: '2026-11-14T00:00:00.000Z', daysAhead: 27.6, windowLengthDays: [30] } });
  assert.match(t2, /^Our forecasts reach as far as 13 Nov 2026 \(/, t2);
  r.close();
});

test('every page that prints a forecast window uses the day-aware formatter', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.doesNotMatch(read('forecast-table.js'), /fmtDate\(e\.target(Start|End)\)/, 'the table still formats window edges as moments');
  assert.doesNotMatch(read('forecast-detail.html'), /PND\.fmtDate\(iso\)\.replace/, 'the detail page still strips a moment down to a day');
  assert.doesNotMatch(read('verification-detail.html'), /PND\.fmtDate\(v\)\.split/, 'the verification page still strips a moment down to a day');
  /* Every window end on the detail page passes its start and the 'end' role,
     so a midnight end names the last day inside the window. */
  const ends = read('forecast-detail.html').match(/dayOf\(e\.targetEnd[^)]*\)/g) || [];
  assert.ok(ends.length >= 3, 'expected the detail page to print the window end');
  for (const c of ends) assert.equal(c, "dayOf(e.targetEnd,e.targetStart,'end')", 'a window end without its role: ' + c);
});
