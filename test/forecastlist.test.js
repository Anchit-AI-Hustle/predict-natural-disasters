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
const COLUMNS = ['Risk', 'Forecast', 'Place', 'Hazard', 'Starts', 'Ends',
  'Kind of forecast', 'What it is', 'Source', 'Updated'];
/* Shown only once the table has folded into cards. */
const NARROW_ONLY = ['Dates', 'Status'];
/* Each cell's data-label is the word printed beside it on a phone. The
   columns the phone fold hides keep the name portal.css hides them by, so
   "What it is" is labelled Provenance there - and is never shown. */
const CELL_LABELS = COLUMNS.map(c => (c === 'What it is' ? 'Provenance' : c));

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
    assert.deepEqual(cells, CELL_LABELS.concat(NARROW_ONLY), 'a row does not carry every column');
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
  const phrase = 'not an official warning';
  const rowText = [...r.document.querySelectorAll('#cards tbody tr')].map(t => t.textContent).join(' ');
  assert.equal(rowText.includes(phrase), false, 'the disclaimer is repeated on every row again');
  assert.ok(body.length > 0);
  const note = r.document.getElementById('forecastNote');
  assert.ok(note && /not an official warning and does not replace one/i.test(note.textContent),
    'the page no longer states the limit that applies to all of them');
  r.close();
});

test('provenance is not painted in a risk colour', async () => {
  /* Risk colours mean one thing on this site. A badge saying where a record
     came from is not a risk level, and giving it the palette would say a
     model outlook is more dangerous than an observed event. */
  /* Styled once, in risk.css, beside the scale it is deliberately not on -
     portal.css used to carry a second copy scoped to .ftable. */
  const css = read('risk.css');
  const rule = (css.match(/\.prov,[^{]*\{[^}]*\}/) || [''])[0];
  assert.ok(rule, 'the provenance badge has no styling of its own');
  assert.match(rule, /background:transparent/, 'a provenance badge is filled like a risk badge');
  assert.doesNotMatch(read('portal.css'), /\.ftable \.prov\{/,
    'a second copy of the provenance styling is back in portal.css');
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
  /* The forecasts page shows a shorter list under its map: the forecast, its
     place, hazard, window and class. What it leaves out is on the page each
     row opens, and the full list is one click away. (It used to sit beside
     the map in a container still laid out as a two-column grid of cards, so
     the table took half of half the page and broke its words letter by
     letter - see the layout tests below.) */
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

/* ------------------------------------------------------------ the layout */

test('the forecasts page lists forecasts apart from the alerts they came from', async () => {
  /* One table held both, so half its rows were observations with no window
     and no class: a column of dashes and "Not classified" under a heading
     that promised forecasts. */
  const r = await renderPage('forecasts.html',
    { waitFor: d => d.querySelectorAll('#forecastGrid tbody tr').length > 1 });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  for (const tr of d.querySelectorAll('#forecastGrid tbody tr')) {
    assert.match(String(tr.dataset.href || ''), /^\/forecasts\//, 'an observed event is back in the forecast table');
  }
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast).length;
  assert.equal(d.querySelectorAll('#forecastGrid tbody tr').length, forecasts, 'a forecast is missing from the page');
  const observed = events.filter(e => !e.forecast && ['Red', 'Orange', 'High'].includes(e.alert)).length;
  assert.ok(observed > 0, 'fixture should carry high-priority observed alerts');
  assert.equal(d.querySelectorAll('#observedList a.obsrow').length, observed, 'the observed alerts were not listed');
  /* And the table is not inside a grid meant for cards: that is what halved it. */
  assert.doesNotMatch(read('forecasts.html'), /\.forecastGrid\{display:grid/, 'the list sits in a card grid again');
  r.close();
});

test('the hazard filter offers the hazards that are there, and filters by them exactly', async () => {
  /* It was a fixed list of six: "Drought", which had no outlook, and no way
     to pick a storm warning, a severe storm or an aftershock sequence. */
  const { events } = await feed();
  const forecasts = events.filter(e => e.forecast);
  const types = [...new Set(forecasts.map(e => e.type))];
  const r = await open();
  const d = r.document;
  const opts = [...d.querySelectorAll('#type option')].map(o => o.value).filter(Boolean);
  assert.deepEqual(opts.slice().sort(), types.slice().sort(), 'the filter does not offer what the list holds');
  const pick = types.find(t => forecasts.filter(e => e.type === t).length < forecasts.length);
  const sel = d.getElementById('type');
  sel.value = pick;
  sel.dispatchEvent(new r.window.Event('change'));
  const rows = [...d.querySelectorAll('#cards tbody tr')];
  assert.equal(rows.length, forecasts.filter(e => e.type === pick).length, 'the filter did not narrow the list to ' + pick);
  for (const tr of rows) {
    assert.equal(tr.querySelector('td[data-label=Hazard]').textContent.trim(), pick);
  }
  r.close();
});

test('a hazard tile filters the forecasts by its hazard, and a second press shows all again', async () => {
  const r = await renderPage('forecasts.html',
    { waitFor: d => d.querySelectorAll('#hazGrid [data-haz]').length > 1 });
  const d = r.document;
  const all = d.querySelectorAll('#forecastGrid tbody tr').length;
  const tile = d.querySelector('#hazGrid [data-haz]');
  const h = tile.getAttribute('data-haz');
  tile.click();
  const rows = [...d.querySelectorAll('#forecastGrid tbody tr')];
  assert.ok(rows.length > 0 && rows.length < all, 'the tile did not narrow the list');
  for (const tr of rows) assert.equal(tr.querySelector('td[data-label=Hazard]').textContent.trim(), h);
  assert.equal(d.querySelector('#hazGrid [data-haz="' + h + '"]').getAttribute('aria-pressed'), 'true');
  d.querySelector('#hazGrid [data-haz="' + h + '"]').click();
  assert.equal(d.querySelectorAll('#forecastGrid tbody tr').length, all, 'a second press did not clear the filter');
  r.close();
});

test('a risk badge stays on one line, and a column is sized for what it holds', () => {
  /* In a narrow cell the level's name broke a letter to a line - "W-a-t-c-h"
     down a phone card - and ten evenly shared columns gave the outlook's
     name a tenth of the row. */
  const risk = (read('risk.css').match(/\n\.risk\{[^}]*\}/) || [''])[0];
  assert.match(risk, /white-space:nowrap/, 'a risk badge can wrap again');
  const css = read('portal.css');
  const wide = (css.match(/@media\(min-width:761px\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.match(wide, /\.ftable \.c-risk\{width:/, 'the badge column has no width of its own');
  assert.doesNotMatch(wide, /\.c-forecast\{/, 'the name column is fixed again rather than taking what is left');
});

test('a derived outlook names its agency, and keeps the full attribution', async () => {
  const r = await open();
  const cell = [...r.document.querySelectorAll('#cards td[data-label=Source]')]
    .find(td => /derived from/i.test((td.querySelector('[title]') || {}).title || ''));
  assert.ok(cell, 'no derived outlook in the fixture');
  assert.match(cell.textContent.trim(), /^From /);
  assert.match(cell.querySelector('[title]').title, /^Predict Natural Disasters · derived from /);
  r.close();
});
