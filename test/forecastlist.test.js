'use strict';
/*
 * The outlook list, as a list.
 *
 * Thirty outlooks were rendered as thirty cards of the same shape, each one
 * carrying the same paragraph about what an outlook is not. A list that long
 * is read by comparing rows - which window opens first, which of them are
 * independent predictions rather than continuations - and a wall of prose
 * cannot be compared. It is a table now, and on a phone the same rows are
 * stacked cards, because a ten-column table on a 320px screen is a sideways
 * scroll and nothing else.
 *
 * What a browser has to answer - whether the fold actually folds - is
 * measured by tools/forecast-table-check.js. These are the rules behind it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const feed = async () => (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
const open = () => renderPage('forecast-list.html',
  { waitFor: d => d.querySelectorAll('#cards tbody tr').length > 1 });

/* The columns the spec names, in the order it names them. */
const COLUMNS = ['Risk', 'Forecast', 'Geography', 'Hazard', 'Starts', 'Ends',
  'Class', 'Provenance', 'Source', 'Updated'];
/* Shown only once the table has folded into cards. */
const NARROW_ONLY = ['Window', 'Status'];

test('the outlook list is a table with the columns it promises', async () => {
  const r = await open();
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const heads = [...r.document.querySelectorAll('#cards thead th')].map(th => th.textContent.trim());
  assert.deepEqual(heads, COLUMNS.concat(NARROW_ONLY),
    'the table no longer carries the columns the list is read by');
  for (const th of r.document.querySelectorAll('#cards thead th')) {
    assert.equal(th.getAttribute('scope'), 'col', 'a header cell does not say what it heads');
  }
  r.close();
});

test('every row is one outlook, and every row opens it', async () => {
  const expected = (await feed()).events.filter(e => e.forecast);
  const r = await open();
  const rows = [...r.document.querySelectorAll('#cards tbody tr')];
  assert.equal(rows.length, expected.length, 'the list does not hold one row per recorded outlook');
  for (const tr of rows) {
    /* Clickable, as a row - and a real link too, because a row cannot be
       opened in a new tab, copied, or announced as a link. */
    assert.match(String(tr.dataset.href || ''), /^\/forecasts\//, 'a row does not open an outlook');
    assert.equal(tr.getAttribute('tabindex'), '0', 'a clickable row cannot be reached by keyboard');
    const link = tr.querySelector('a[href^="/forecasts/"]');
    assert.ok(link, 'a row carries no link at all');
    assert.ok(link.textContent.trim().length > 3, 'a link with no name: ' + link.outerHTML.slice(0, 80));
    const cells = [...tr.querySelectorAll('td')].map(td => td.getAttribute('data-label'));
    assert.deepEqual(cells, COLUMNS.concat(NARROW_ONLY), 'a row does not carry every column');
    for (const td of tr.querySelectorAll('td')) {
      assert.ok(td.textContent.trim().length > 0,
        'an empty cell says nothing; it should say what is not recorded: ' + td.getAttribute('data-label'));
    }
  }
  r.close();
});

test('the paragraph that is true of every outlook is printed once', async () => {
  /* It used to ride on every card, spending a third of each one saying what
     the page can say once. Moving it did not delete it: the outlook's own
     page still carries the rule in full, which is what the row opens. */
  const r = await open();
  const body = r.document.getElementById('cards').textContent;
  const phrase = 'not deterministic predictions';
  const rowText = [...r.document.querySelectorAll('#cards tbody tr')].map(t => t.textContent).join(' ');
  assert.equal(rowText.includes(phrase), false, 'the disclaimer is repeated on every row again');
  assert.ok(body.length > 0);
  const note = r.document.getElementById('forecastNote');
  assert.ok(note && /do not replace official warnings/i.test(note.textContent),
    'the page no longer states the limit that applies to all of them');
  r.close();
});

test('provenance is not painted in a risk colour', async () => {
  /* Risk colours mean one thing on this site. A badge saying where a record
     came from is not a risk level, and giving it the palette would say a
     model outlook is more dangerous than an observed event. */
  const css = read('portal.css');
  const rule = (css.match(/\.ftable \.prov\{[^}]*\}/) || [''])[0];
  assert.ok(rule, 'the provenance badge has no styling of its own');
  assert.match(rule, /background:transparent/, 'a provenance badge is filled like a risk badge');
  const r = await open();
  for (const el of r.document.querySelectorAll('#cards .prov')) {
    assert.equal(el.classList.contains('badge'), false,
      'a provenance badge is using the risk badge class');
    assert.ok(el.textContent.trim().length > 0, 'an empty provenance badge');
  }
  r.close();
});

test('the phone fold is in the stylesheet, not in a hope', () => {
  const css = read('portal.css');
  const media = (css.match(/@media\(max-width:760px\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.ok(media, 'nothing folds the table on a phone');
  assert.match(media, /\.ftable thead\{display:none\}/, 'the header row survives the fold');
  assert.match(media, /\.ftable td::before\{content:attr\(data-label\)/,
    'a folded cell loses the label that says what it is');
  for (const col of ['Starts', 'Ends', 'Provenance', 'Source', 'Updated']) {
    assert.ok(media.includes('[data-label=' + col + ']'),
      col + ' is not folded away on a phone, so ten columns still have to fit');
  }
  assert.match(media, /\.ftable td\.only-narrow\{display:flex\}/,
    'the window and status lines never appear');
  assert.match(css, /\.ftable \.only-narrow\{display:none\}/,
    'the folded-only lines show on a desktop as well');
});

test('the filter toolbar stays in reach while the list scrolls', () => {
  assert.match(read('forecast-list.html'), /class="toolbar toolbar-sticky"/,
    'the outlook list toolbar scrolls away with the page');
  const css = read('portal.css');
  assert.match(css, /\.toolbar-sticky\{position:sticky;top:58px/,
    'the sticky toolbar would sit under the header');
  const media = (css.match(/@media\(max-width:760px\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.match(media, /\.toolbar-sticky\{position:static/,
    'a sticky toolbar on a phone eats the screen the list needs');
});

test('one renderer draws the outlook list, wherever it is shown', async () => {
  /* The list page and the forecasts page showed the same records two ways -
     a table on one, a grid of cards on the other - which is how two sets of
     columns drift apart. The renderer is a file both load. */
  const users = ['forecast-list.html', 'forecasts.html'];
  for (const f of users) {
    assert.match(read(f), /<script src="\/forecast-table\.js"><\/script>/,
      f + ' does not load the shared outlook renderer');
  }
  /* And nothing keeps a copy of the card it replaced. */
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js)$/.test(n))) {
    assert.equal(/<article class="fc"/.test(read(f)), false,
      f + ' still renders the outlook card the table replaced');
  }
  const shared = read('forecast-table.js');
  assert.match(shared, /root\.PNDForecastTable\s*=/, 'the renderer exports nothing');
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js)$/.test(n) && n !== 'forecast-table.js')) {
    assert.equal(/function forecastRow\s*\(/.test(read(f)), false,
      f + ' has its own copy of the row renderer');
  }
});

test('a page with a narrower column asks for fewer columns, not a sideways scroll', async () => {
  /* The forecasts page shows the list beside a map, in about half the width.
     Ten columns there scrolled sideways inside the panel - the same defect
     one box further in - so it declares the columns that fit. What it leaves
     out is on the page each row opens, and the full list is one click away. */
  const r = await renderPage('forecasts.html',
    { waitFor: d => d.querySelectorAll('#forecastGrid tbody tr').length > 1 });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const heads = [...r.document.querySelectorAll('#forecastGrid thead th')].map(th => th.textContent.trim());
  assert.ok(heads.length < COLUMNS.length + NARROW_ONLY.length,
    'the panel asks for every column again');
  for (const h of heads) {
    assert.ok(COLUMNS.concat(NARROW_ONLY).includes(h), 'the panel invented a column of its own: ' + h);
  }
  assert.deepEqual(heads.filter(h => NARROW_ONLY.includes(h)), NARROW_ONLY,
    'the panel loses the window and status lines a phone reads it by');
  for (const tr of r.document.querySelectorAll('#forecastGrid tbody tr')) {
    assert.equal(tr.children.length, heads.length, 'a row does not match the header it sits under');
    assert.ok(tr.querySelector('a[href]'), 'a row carries no link');
    assert.match(String(tr.dataset.href || ''), /^\/(forecasts|disasters|alerts|calamities)\//,
      'a row does not open a detail page');
  }
  /* And the way back to all ten columns. */
  assert.match(read('forecasts.html'), /href="\/forecast-list"/,
    'nothing links the panel to the full list');
  r.close();
});
