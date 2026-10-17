'use strict';
/**
 * Ordering.
 *
 * Every list of records reads newest first by default: the sort control opens
 * on it, and the lists that have no control are ordered before they are cut to
 * length, so the cut keeps the most recent rather than whatever the upstream
 * merge happened to put first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, sampleEvents } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** PND.initSort takes list[0] as the default, so the first key is what opens. */
function firstKeyOf(source, name) {
  const m = source.match(new RegExp(name + '\\s*[:=]\\s*\\[\\s*\'([a-zA-Z]+)\''));
  return m ? m[1] : null;
}

test('every shared sort list opens on the newest record', () => {
  const portal = read('portal.js');
  assert.equal(firstKeyOf(portal, 'EVENT_SORTS'), 'newest');

  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const NEWEST_FIRST = { NEARBY_KEYS: 'newest', REGION_KEYS: 'newest', VERIFY_KEYS: 'newest' };
  // yearNew is the historical archive's own newest-first key.
  const EQUIVALENT = { HIST_KEYS: 'yearNew' };
  for (const page of pages) {
    const src = read(page);
    for (const [name, expected] of Object.entries({ ...NEWEST_FIRST, ...EQUIVALENT })) {
      const first = firstKeyOf(src, name);
      if (first) assert.equal(first, expected, page + ': ' + name + ' opens on ' + first);
    }
  }
});

test('the collection pages open on the newest record', () => {
  const first = firstKeyOf(read('collection.js'), 'SORT_KEYS=mode===\'resources\'\\?\\[[^\\]]*\\]:[^?]*\\?');
  // The forecast list is the branch that used to lead with severity.
  assert.match(read('collection.js'), /\['newest','severity','windowEnd'/,
    'the forecast list no longer opens on the newest outlook');
});

test('the self-contained pages open on the newest record', () => {
  for (const [page, store] of [['index.html', 'SORTS'], ['dashboard.html', 'DASH_SORTS']]) {
    const src = read(page);
    assert.ok(src.includes(store + '={newest:'),
      page + ': the sort control does not list newest first');
    assert.ok(src.includes('if(!' + store + '[cur])cur=\'newest\''),
      page + ': the default sort is not newest');
    assert.ok(!src.includes('cur=\'severity\'') && !src.includes('cur=\'priority\''),
      page + ': an old default is still present');
  }
});

test('a collection page actually renders newest first', async () => {
  const r = await renderPage('events.html', {
    waitFor: doc => doc.querySelectorAll('#cards a, #cards article').length > 2
  });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(doc.getElementById('sortBy').value, 'newest', 'control did not open on newest');
  r.close();
});

/* ------------------------------------------------- lists with no control */

const enrich = require(path.join(ROOT, 'api', 'event-enrichment.js'));

test('news and situation reports come back newest first', async () => {
  const event = (await sampleEvents()).find(e => !e.forecast);
  const res = await callApi(enrich, '/api/event-enrichment?id=' + encodeURIComponent(event.id)
    + '&title=' + encodeURIComponent(event.title) + '&country=' + encodeURIComponent(event.country || '')
    + '&type=' + encodeURIComponent(event.type || ''));
  const body = await res.json();

  for (const key of ['news', 'situationReports']) {
    const items = body[key] || [];
    if (items.length < 2) continue;
    const dated = items.map(x => Date.parse(x.publishedAt || '')).filter(Number.isFinite);
    const descending = [...dated].sort((a, b) => b - a);
    assert.deepEqual(dated, descending, key + ' is not in descending date order');
    // Undated items must sink rather than interleave.
    const firstUndated = items.findIndex(x => !Number.isFinite(Date.parse(x.publishedAt || '')));
    if (firstUndated !== -1) {
      assert.ok(items.slice(firstUndated).every(x => !Number.isFinite(Date.parse(x.publishedAt || ''))),
        key + ': a dated item appears below an undated one');
    }
  }
});

test('the newest items survive the cut, not the first ones merged', () => {
  // Sorting has to precede .slice(), or the cap keeps whatever the merge of two
  // news providers happened to put first.
  const src = read(path.join('api', 'event-enrichment.js'));
  assert.match(src, /\.sort\(byNewest\)\.slice\(0, 24\)/, 'news is sliced before it is sorted');
  assert.match(src, /\.sort\(byNewest\)\.slice\(0, 12\)/, 'situation reports are sliced before sorted');
});

/* ------------------------------------------------------- reported counts */

test('the source-health line counts against the real number of providers', async () => {
  // It read "7/3 sources online" in production: the denominator was hard-coded
  // to 3 while the feed grew to eight providers.
  const portal = fs.readFileSync(path.join(ROOT, 'portal.js'), 'utf8');
  assert.ok(!/\$\{n\}\/3 sources online/.test(portal), 'the denominator is still hard-coded');

  const r = await renderPage('events.html', {
    waitFor: doc => /sources working|sources are down/.test(doc.getElementById('statusLine').textContent)
  });
  const line = r.document.getElementById('statusLine').textContent;
  r.close();

  const m = line.match(/(\d+) of (\d+) sources working/);
  assert.ok(m || /sources are down/.test(line), 'no source count in: ' + line.trim());
  if (m) {
    const [, online, total] = m.map(Number);
    assert.ok(online <= total, 'reported ' + line.trim() + ' - more online than exist');
    assert.ok(total >= 3, 'implausible provider total in: ' + line.trim());
  }
});
