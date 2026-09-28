'use strict';
/**
 * Search, which answered differently on every page.
 *
 * Each page carried its own hand-picked field list, so the same word found
 * different things depending on where it was typed. Measured against the live
 * feed of 2026-09-20: the homepage's map search omitted the hazard type
 * entirely and matched 1 of 349 earthquake records for "earthquake".
 *
 * Worse, the homepage's main box navigated to /events?search=<term> and
 * nothing anywhere in the repository read that parameter — so every search
 * started from the front page arrived as a completely unfiltered list with an
 * empty box. And three pages rendered a search input with no id, no handler
 * and no code reading it: typing there did nothing, forever.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = require(path.join(ROOT, 'search.js'));

const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const SCRIPTS = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));

test.after(closeAllWindows);

/* ---------- the matching rules themselves ---------- */

test('the hazard type is searchable, which is what the homepage dropped', () => {
  const quake = { title: 'M 5.9 - 253 km ENE of Lospalos', type: 'Earthquake',
    country: 'Timor Leste' };
  /* The old homepage list was [title, country, region]: no type, so this
     record — like 348 of the 349 in the live feed — was unfindable. */
  assert.equal(S.matches(quake, 'earthquake'), true);
  assert.equal(S.SEARCH_FIELDS.includes('type'), true);
});

test('every field a page used to search is in the one shared list', () => {
  /* The union of what the pages searched before: nothing may be lost. */
  for (const f of ['title', 'name', 'country', 'region', 'location', 'type',
    'hazard', 'source', 'src', 'details', 'summary', 'id', 'eventId']) {
    assert.ok(S.SEARCH_FIELDS.includes(f), `${f} dropped from the search index`);
  }
});

test('all the terms must match, so a two-word search narrows the list', () => {
  const e = { country: 'India', type: 'Flood', title: 'Monsoon flooding' };
  assert.equal(S.matches(e, 'india flood'), true);
  assert.equal(S.matches(e, 'india wildfire'), false);
  /* A phrase search would have failed the first case: the two words are not
     adjacent anywhere in the record. */
});

test('an empty query matches everything rather than nothing', () => {
  for (const q of ['', '   ', null, undefined]) {
    assert.equal(S.matches({ title: 'x' }, q), true, `query ${JSON.stringify(q)}`);
  }
});

test('the place filters do not match on source or narrative', () => {
  const e = { country: 'Japan', source: 'USGS', details: 'Reported near Oslo.' };
  /* A box labelled "region filter" must not match every USGS record because
     the reader typed usgs, nor a Japanese record because its narrative
     mentions another city. */
  assert.equal(S.matchesPlace(e, 'usgs'), false);
  assert.equal(S.matchesPlace(e, 'oslo'), false);
  assert.equal(S.matchesPlace(e, 'japan'), true);
  /* The free-text search still sees them. */
  assert.equal(S.matches(e, 'usgs'), true);
});

test('the cached search text does not become an enumerable field', () => {
  const e = { title: 'Flood', type: 'Flood' };
  S.matches(e, 'flood');
  assert.equal(Object.keys(e).includes('__pndSearch'), false);
  assert.equal(JSON.stringify(e).includes('__pndSearch'), false);
});

test("search.js's escape agrees with portal.js's, character for character", () => {
  const portal = read('portal.js');
  const m = portal.match(/esc\(v=''\)\{return ([^\n]*?);\},/);
  assert.ok(m, 'portal.js still defines esc');
  const portalEsc = new Function('v', 'v = v || ""; return ' + m[1].replace(/^return /, '') + ';');
  let checked = 0;
  for (let c = 0; c < 0x2000; c++) {
    const ch = String.fromCharCode(c);
    assert.equal(S.esc(ch), portalEsc(ch), `code point ${c}`);
    checked++;
  }
  assert.ok(checked > 8000);
});

/* ---------- no page may keep its own copy of the rules ---------- */

test('no page carries its own search field list any more', () => {
  const offenders = [];
  for (const f of PAGES.concat(SCRIPTS)) {
    const s = read(f);
    /* The exact shape every page used: [a.x, a.y].join(' ').toLowerCase().includes(q) */
    const m = s.match(/\[[^\[\]]{0,200}?\]\s*\.join\(\s*' '\s*\)\s*\.toLowerCase\(\)\.includes\(/);
    if (m) offenders.push(`${f}: ${m[0].slice(0, 70)}`);
  }
  assert.deepEqual(offenders, [],
    'these files still filter with their own field list instead of the shared matcher');
});

test('every page that calls the matcher also loads search.js', () => {
  const missing = [];
  for (const f of PAGES) {
    const s = read(f);
    const calls = /(PND|PNDSearch)\.(matches|matchesPlace|searchText|searchParam|initSearch|emptyHtml)\b/.test(s)
      || s.includes('collection.js');
    if (calls && !/<script src="\/search\.js"><\/script>/.test(s)) missing.push(f);
  }
  assert.deepEqual(missing, [], 'these pages call the matcher without loading it');
});

/* ---------- no search box may be inert ---------- */

test('no page renders a search box that nothing reads', () => {
  const dead = [];
  for (const f of PAGES) {
    const s = read(f);
    for (const m of s.matchAll(/<input\b([^>]*)>/g)) {
      const attrs = m[1];
      if (!/placeholder="[^"]*[Ss]earch/.test(attrs)) continue;
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      /* An input with no id cannot be reached by any of this codebase's
         wiring, which is exactly how three of them sat inert. */
      assert.ok(id, `${f}: search input has no id, so nothing can read it`);
      /* The id must be referred to somewhere beyond its own tag: by this
         page, or by a shared script the page loads. */
      const here = s.split(id).length - 1;
      const shared = SCRIPTS.filter(j => s.includes('/' + j))
        .some(j => new RegExp('\\b' + id + '\\b').test(read(j)));
      if (here < 2 && !shared) dead.push(`${f}#${id}`);
    }
  }
  assert.deepEqual(dead, [], 'these search boxes accept text and do nothing with it');
});

/* ---------- the parameter the homepage sends must be read ---------- */

test('the homepage sends a parameter the receiving page reads', () => {
  const idx = read('index.html');
  const m = idx.match(/GO\('\/events\?(\w+)='/);
  assert.ok(m, 'the homepage still hands its search off to /events');
  const param = m[1];
  assert.ok(['q', 'search'].includes(param), `unexpected parameter ${param}`);
  /* Whichever spelling it sends, the shared reader must accept it. */
  const src = read('search.js');
  assert.ok(src.includes(`get('${param}')`),
    `nothing reads ?${param}=, so the search is dropped on arrival`);
});

test('both spellings of the parameter seed a search box', async () => {
  for (const [url, expected] of [['/events?q=japan', 'japan'],
    ['/events?search=japan', 'japan']]) {
    const { window } = await renderPage('events.html', { url });
    const box = window.document.getElementById('q');
    assert.equal(box.value, expected, `${url} did not reach the box`);
    window.close();
  }
});

test('a search in the URL actually filters what the page lists', async () => {
  const { window } = await renderPage('events.html', { url: '/events?q=earthquake' });
  const doc = window.document;
  const cards = [...doc.querySelectorAll('#cards .event-card')];
  assert.ok(cards.length > 0, 'the seeded search matched nothing at all');
  for (const c of cards) {
    assert.match(c.textContent.toLowerCase(), /earthquake|aftershock/,
      'a listed card does not match the seeded search');
  }
  window.close();
});

/* ---------- an empty result must say which kind of empty it is ---------- */

test('an empty result distinguishes "not here" from "nowhere"', () => {
  const all = [{ title: 'Flood Watch', country: 'United States', type: 'Flood' }];
  /* Matches elsewhere in the feed but not in this page's slice: say so, and
     offer the place it does match. */
  const elsewhere = S.emptyHtml('flood', [], all, 'forecasts');
  assert.match(elsewhere, /1 other event/);
  assert.match(elsewhere, /\/events\?q=flood/);
  /* Matches nothing anywhere: say that the feed carries nothing, and how much
     it does carry, rather than leaving a bare "no results". */
  const nowhere = S.emptyHtml('india', [], all, 'forecasts');
  assert.match(nowhere, /Nothing in our current data matches it/);
  assert.match(nowhere, /1 event from 1 countr/);
  assert.doesNotMatch(nowhere, /\/events\?q=/);
});

test('the empty state escapes the query rather than rendering it', () => {
  const html = S.emptyHtml('<img src=x onerror=alert(1)>', [], [], 'records');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
