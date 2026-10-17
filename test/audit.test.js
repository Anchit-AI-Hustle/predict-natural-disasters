'use strict';
/**
 * Whole-page audit.
 *
 * Renders every page in the site and checks the *visible* output - script and
 * style source excluded, which is what made an earlier pass report phantom
 * "null" and "${" findings - against the defect classes that reach a reader:
 * junk values, stuck placeholders, dead links, duplicate ids, empty controls
 * and impossible counts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

let SEARCH = null;
async function searchFor(page) {
  if (!SEARCH) {
    const evs = await sampleEvents();
    const q = id => '?id=' + encodeURIComponent(id);
    const official = evs.find(e => e.sourceType === 'official' && e.alert === 'Red');
    const outlook = evs.find(e => e.forecast && e.id !== 'ND-001');
    SEARCH = {
      'event-detail.html': q(official.id), 'alert-detail.html': q(official.id),
      'calamity-detail.html': q(official.id), 'forecast-detail.html': q(outlook.id),
      'region-detail.html': '?region=Nepal', 'location-detail.html': '?location=Nepal',
      'hazard-detail.html': '?type=Flood', 'historical-event-detail.html': '?id=0',
      'source-detail.html': '?source=GDACS', 'verification-detail.html': '?id=ND-001',
      'entity-detail.html': '?kind=insight&topic=flood-landslide'
    };
  }
  return SEARCH[page] || '';
}

/** What a reader actually sees: markup minus script and style source. */
function visibleOf(doc) {
  const clone = doc.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript').forEach(n => n.remove());
  return { text: clone.textContent, html: clone.innerHTML };
}

/** Render every page once, hand each to `check`, and collect what it returns. */
async function sweep(check) {
  const findings = [];
  for (const page of PAGES) {
    const r = await renderPage(page, {
      search: await searchFor(page), timeoutMs: 9000,
      waitFor: doc => doc.body.textContent.length > 400 && !/Loading…/.test(doc.body.textContent)
    });
    for (const f of check(r.document, visibleOf(r.document), page) || []) findings.push(page + ': ' + f);
    r.close();
  }
  return findings;
}

test('no page shows a junk value to the reader', async () => {
  const JUNK = ['undefined', 'NaN', '[object Object]', 'Invalid Date', 'null'];
  const found = await sweep((doc, v) => JUNK
    .filter(bad => new RegExp('(^|[\\s>(·|,:])' + bad.replace(/[[\]]/g, '\\$&') + '([\\s<).,·|]|$)').test(v.text))
    .map(bad => 'renders the literal "' + bad + '"'));
  assert.deepEqual(found, [], found.join('\n'));
});

test('no page leaks unrendered template syntax', async () => {
  const found = await sweep((doc, v) => /\$\{/.test(v.html) ? ['${ } reached the output'] : []);
  assert.deepEqual(found, [], found.join('\n'));
});

test('no element is left stuck on its loading placeholder', async () => {
  const found = await sweep(doc => [...doc.querySelectorAll('[id]')]
    .filter(el => /^Loading(…|\.\.\.)$/.test((el.textContent || '').trim()))
    .map(el => '#' + el.id + ' never loaded'));
  assert.deepEqual(found, [], found.join('\n'));
});

test('no page has a dead or malformed link', async () => {
  const found = await sweep(doc => [...doc.querySelectorAll('a')]
    .filter(a => {
      const h = a.getAttribute('href');
      return h === null || h === '' || h === '#' || /undefined|NaN|\$\{/.test(h);
    })
    .map(a => '"' + (a.textContent || '').trim().slice(0, 30) + '" -> ' + a.getAttribute('href')));
  assert.deepEqual(found, [], found.join('\n'));
});

test('no page repeats an element id', async () => {
  const found = await sweep(doc => {
    const seen = {};
    for (const el of doc.querySelectorAll('[id]')) seen[el.id] = (seen[el.id] || 0) + 1;
    return Object.entries(seen).filter(([, n]) => n > 1).map(([id, n]) => 'id "' + id + '" appears ' + n + ' times');
  });
  assert.deepEqual(found, [], found.join('\n'));
});

test('no dropdown renders with nothing in it', async () => {
  const found = await sweep(doc => [...doc.querySelectorAll('select')]
    .filter(s => s.options.length === 0)
    .map(s => 'empty <select> ' + (s.id ? '#' + s.id : '(unnamed)')));
  assert.deepEqual(found, [], found.join('\n'));
});

test('no page reports more of something than can exist', async () => {
  // "Live · 7/3 sources online" shipped, because the denominator was a literal.
  const found = await sweep((doc, v) => {
    const out = [];
    for (const m of v.text.matchAll(/(\d+)\s*(?:\/|of)\s*(\d+)\s+(sources|records|feeds)/g)) {
      if (Number(m[1]) > Number(m[2])) out.push('reports "' + m[0] + '"');
    }
    return out;
  });
  assert.deepEqual(found, [], found.join('\n'));
});

test('every image carries alt text', async () => {
  const found = await sweep(doc => [...doc.querySelectorAll('img')]
    .filter(i => !i.hasAttribute('alt'))
    .map(i => 'img without alt: ' + (i.getAttribute('src') || '').slice(0, 40)));
  assert.deepEqual(found, [], found.join('\n'));
});
