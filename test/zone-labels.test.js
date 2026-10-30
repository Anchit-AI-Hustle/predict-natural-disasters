'use strict';
/**
 * C27. A time is labelled with a zone a reader recognises, never a raw IANA id.
 *
 * Since the site defaults to the device's own zone (C9), a reader outside the
 * nine aliased zones saw "20 Oct 2026, 8:24 AM America/Argentina/Buenos_Aires"
 * on every time. The aliases stay; any other zone takes the platform's short
 * name in en-US for that moment, and an offset such as "GMT-3" where there is
 * no short name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { renderPage, closeAllWindows } = require('./render.js');

/* A test that fails before its close() would keep its window's timers alive. */
test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
function portal(tz) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/events', runScripts: 'outside-only' });
  const w = dom.window;
  if (tz) w.localStorage.setItem('pnd_timezone', tz);
  w.eval(fs.readFileSync(path.join(ROOT, 'portal.js'), 'utf8'));
  return w;
}

const OCT = '2026-10-20T11:24:19Z', JAN = '2026-01-05T18:05:00Z';
const CASES = [
  ['Asia/Kolkata', 'IST', 'IST'],
  ['UTC', 'UTC', 'UTC'],
  ['America/New_York', 'ET', 'ET'],
  ['Europe/London', 'UK', 'UK'],
  ['America/Argentina/Buenos_Aires', 'GMT-3', 'GMT-3'],
  ['Asia/Kathmandu', 'GMT+5:45', 'GMT+5:45'],
  ['Australia/Lord_Howe', 'GMT+11', 'GMT+11'],
  ['Europe/Paris', 'GMT+2', 'GMT+1'],
  ['America/Chicago', 'CDT', 'CST']
];

test('zone labels: aliases kept, every other zone named by its short name or offset', () => {
  for (const [tz, oct, jan] of CASES) {
    const w = portal(tz);
    assert.equal(w.PND.tzLabel(tz, OCT), oct, tz + ' in October');
    assert.equal(w.PND.tzLabel(tz, JAN), jan, tz + ' in January');
    for (const s of [w.PND.fmtDate(OCT), w.PND.fmtTime(OCT), w.PND.fmtDate(JAN)]) {
      assert.ok(!s.includes(tz) || !tz.includes('/'), tz + ' was shown raw: ' + s);
      assert.doesNotMatch(s, /[A-Za-z]+\/[A-Za-z_]+/, 'a raw zone id in ' + s);
    }
    assert.ok(w.PND.fmtDate(OCT).endsWith(' ' + oct), w.PND.fmtDate(OCT));
    assert.ok(w.PND.fmtTime(JAN).endsWith(' ' + jan), w.PND.fmtTime(JAN));
    w.close();
  }
});

test('zone labels: the time zone menu shows a friendly name for the chosen zone', () => {
  for (const [tz, want] of [['America/Argentina/Buenos_Aires', /^GMT-3 · Buenos Aires$/], ['Asia/Kolkata', /^India \(IST\)$/], ['UTC', /^UTC$/], ['Australia/Lord_Howe', /^GMT\+1[01](:30)? · Lord Howe$/]]) {
    const w = portal(tz);
    w.document.body.innerHTML = '<select id="s">' + w.PND.timezoneOptions() + '</select>';
    const s = w.document.getElementById('s');
    assert.equal(s.value, tz);
    assert.match(s.options[s.selectedIndex].textContent, want, tz);
    w.close();
  }
});

test('zone labels: a page in Buenos Aires shows no raw zone id outside the menu', async () => {
  const r = await renderPage('events.html', { storage: { pnd_timezone: 'America/Argentina/Buenos_Aires' },
    waitFor: d => /GMT-3/.test(d.body.textContent) && d.querySelector('.trust time') });
  const sel = r.document.getElementById('pndTimezone');
  if (sel) sel.remove();
  const text = r.document.body.textContent;
  assert.doesNotMatch(text, /America\/Argentina\/Buenos_Aires/);
  assert.match(text, /GMT-3/);
  r.close();
});
