'use strict';
/**
 * Follow-ups found on the live site after launch.
 *
 *  F1 The 404 page moved on a phone (CLS 0.18 at 390 px): the address it
 *     shows, the headline and the line under it and the status beside "What
 *     happened" were all rewritten by script after the first paint, and each
 *     took a different number of lines.
 *  F2 Bogotá and São Paulo had the place ids "bogot-co" and "s-o-paulo-br"
 *     before accents were folded. No page is addressed by a place id (place
 *     pages are /locations/<name>); the old ids live on only inside the frozen
 *     model forecast ids, and those pages must keep opening.
 *  F3 data/forecast-verdicts.json (about 900 KB) was one line with a
 *     generatedAt that moved on every data-bot run, so every bot commit
 *     carried the whole file as its diff.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.after(closeAllWindows);

/* ------------------------------------------------------------------ F1 */

test('F1: the 404 page holds the space of what its script rewrites', () => {
  const src = read('404.html');
  /* Headline and the line under it: two lines each on a phone. */
  assert.match(src, /@media\(max-width:700px\)\{\.hero #headline,\.hero #sub\{min-height:2\.8em\}\}/);
  /* The status keeps one line and stays on its own row on a phone. */
  assert.match(src, /\.nf #state\{min-height:1\.4em;white-space:nowrap\}/);
  assert.match(src, /@media\(max-width:700px\)\{\.nf #state\{flex-basis:100%\}\}/);
  /* Cleared, it keeps its place rather than collapsing. */
  assert.match(src, /state\.style\.visibility = 'hidden'/);
  assert.doesNotMatch(src, /state\.hidden = true/);
  /* The address is written as the page is read, before the scripts at the end. */
  const inline = src.indexOf('<script>attempted.textContent = location.pathname + location.search;</script>');
  assert.ok(inline > 0, 'the address is not filled in inline');
  assert.ok(inline < src.indexOf('<script src="/portal.js">'), 'the address is filled in only after portal.js loads');
});

test('F1: a 404 shows the address at once and keeps the cleared status in place', async () => {
  const r = await renderPage('404.html', { url: '/compare?x=1', timeoutMs: 4000,
    waitFor: d => /Page not found/.test(d.getElementById('headline').textContent) });
  const d = r.document;
  assert.equal(d.getElementById('attempted').textContent, '/compare?x=1');
  const state = d.getElementById('state');
  assert.equal(state.hidden, false);
  assert.equal(state.style.visibility, 'hidden');
  r.close();
});

/* ------------------------------------------------------------------ F2 */

test('F2: the old place ids map to the slugs the site makes now', () => {
  const M = require('../forecast-models.js');
  assert.deepEqual(M.PLACE_ID_RENAMES, { 'bogot-co': 'bogota-co', 's-o-paulo-br': 'sao-paulo-br' });
  for (const [old, now] of Object.entries(M.PLACE_ID_RENAMES)) assert.equal(M.placeIdOf(old), now);
  assert.equal(M.placeSlug('Bogotá', 'CO'), 'bogota-co');
  assert.equal(M.placeSlug('São Paulo', 'BR'), 'sao-paulo-br');
  /* The page-address slug folds accents the same way. */
  const src = read('portal.js');
  const slug = new Function('return ' + /slug\(v=''\)\{return [^}]*\}/.exec(src)[0].replace(/^slug\(v=''\)/, "function(v='')"))();
  assert.equal(slug('Bogotá'), 'bogota');
  assert.equal(slug('São Paulo'), 'sao-paulo');
  /* No route is addressed by a place id, so there is no old place-id address to redirect. */
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.trailingSlash, false);
  for (const r of vercel.redirects.concat(vercel.rewrites)) {
    assert.ok(!/bogot|paulo/.test(r.source), 'a route names one of these places: ' + r.source);
    assert.ok(r.source === '/' || !r.source.endsWith('/'), 'a source ends in "/": ' + r.source);
  }
});

test('F2: a model forecast published under an old place id still opens, named with its accents', async () => {
  const ledger = JSON.parse(read('data/model-ledger.json'));
  const old = ledger.find(o => o && o.model && o.model.placeId === 'bogot-co');
  if (!old) return; /* the ledger is append-only, so this holds once it has one */
  const r = await renderPage('forecast-detail.html', { url: '/forecasts/' + old.id, timeoutMs: 20000,
    waitFor: d => /Bogotá|not found/i.test((d.getElementById('title') || {}).textContent || '') });
  const t = r.document.getElementById('title').textContent;
  assert.match(t, /Bogotá/, 'the old id did not open its forecast: ' + t);
  r.close();
});

/* ------------------------------------------------------------------ F3 */

const INPUTS = ['outlook-ledger.json', 'verification-ledger.json', 'observed-disasters.json', 'scan-ledger.json',
  'model-verdicts.json', 'model-ledger.json'];

test('F3: the verdicts file is the same bytes from the same ledgers, and is not rewritten', () => {
  const B = require('../tools/build-accuracy-summary.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-verdicts-'));
  try {
    for (const f of INPUTS) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dir, f));
    const first = B.writeAll(dir);
    assert.deepEqual(first.written, { summary: true, verdicts: true });
    const a = fs.readFileSync(path.join(dir, 'forecast-verdicts.json'));
    const stamp = fs.statSync(path.join(dir, 'forecast-verdicts.json')).mtimeMs;
    const second = B.writeAll(dir);
    assert.deepEqual(second.written, { summary: false, verdicts: false }, 'an unchanged file was written again');
    assert.ok(a.equals(fs.readFileSync(path.join(dir, 'forecast-verdicts.json'))));
    assert.equal(fs.statSync(path.join(dir, 'forecast-verdicts.json')).mtimeMs, stamp);
    /* Rows given in another order make the same file. */
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'outlook-ledger.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'outlook-ledger.json'), JSON.stringify(ledger.slice().reverse()));
    assert.equal(B.verdictsText(B.build(dir).verdicts), a.toString());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F3: one row per line, no run timestamp, and it parses to what the builder made', () => {
  const B = require('../tools/build-accuracy-summary.js');
  const v = { note: 'n', verificationVersion: 'x', outlooks: [{ id: 'b', recordedAt: '2026-01-01' }, { id: 'a', recordedAt: '2026-01-02' }] };
  const text = B.verdictsText(v);
  assert.deepEqual(JSON.parse(text), v);
  assert.equal(text.split('\n').length, 2 + v.outlooks.length + 1);
  assert.deepEqual(JSON.parse(B.verdictsText(Object.assign({}, v, { outlooks: [] }))).outlooks, []);

  const committed = read('data/forecast-verdicts.json');
  const doc = JSON.parse(committed);
  assert.ok(!('generatedAt' in doc), 'forecast-verdicts.json carries a run timestamp');
  assert.equal(committed.split('\n').length, doc.outlooks.length + 3, 'not one row per line');
  const ids = doc.outlooks.map(o => o.recordedAt + ' ' + o.id);
  for (let i = 1; i < doc.outlooks.length; i++) {
    const p = doc.outlooks[i - 1], o = doc.outlooks[i];
    assert.ok(p.recordedAt > o.recordedAt || (p.recordedAt === o.recordedAt && p.id < o.id), 'out of order at ' + ids[i]);
  }
  /* Its timestamp is in the summary. */
  assert.ok(Date.parse(JSON.parse(read('data/accuracy-summary.json')).generatedAt));
});

test('a forecast first recorded under an old place id is not added to the ledger twice', () => {
  const M = require('../forecast-models.js');
  assert.equal(M.canonicalOutlookId('model-rain-s-o-paulo-br-2026-11-12'), 'model-rain-sao-paulo-br-2026-11-12');
  assert.equal(M.canonicalOutlookId('model-rain-bogot-co-2026-10-27'), 'model-rain-bogota-co-2026-10-27');
  assert.equal(M.canonicalOutlookId('model-rain-sao-paulo-br-2026-11-12'), 'model-rain-sao-paulo-br-2026-11-12');
  assert.equal(M.canonicalOutlookId('model-heat-delhi-in-2026-11-12'), 'model-heat-delhi-in-2026-11-12');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'run-models.js'), 'utf8');
  assert.match(src, /new Set\(ledger\.map\(o => M\.canonicalOutlookId\(o\.id\)\)\)/);
});
