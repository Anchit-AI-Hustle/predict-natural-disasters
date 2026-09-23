'use strict';
/**
 * Acronyms.
 *
 * Nothing reaches a reader as a bare acronym without its full form having been
 * stated on that page. Organisations are written out on first appearance with
 * the short form in brackets and stay short afterwards; bearings, magnitude
 * scales and state codes read naturally in full, so they expand every time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');
const glossary = require('../glossary.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

test('the stateless rules expand the forms these feeds actually publish', () => {
  const cases = [
    ['M 6.5 - 126 km NNE of Teluknaga, Indonesia', 'Magnitude 6.5 - 126 km north-north-east of Teluknaga, Indonesia'],
    ['Magnitude 6.5 mw · depth 369.2 km', 'Moment magnitude 6.5 · depth 369.2 km'],
    ['Magnitude 5.2 mb · depth 10 km', 'Body-wave magnitude 5.2 · depth 10 km'],
    ['Flood Warning — Citrus, FL', 'Flood Warning — Citrus, Florida'],
    ['40 km W of Concepcion, Chile', '40 km west of Concepcion, Chile']
  ];
  for (const [input, expected] of cases) assert.equal(glossary.expandAlways(input), expected);
});

test('expanding twice changes nothing, so a re-render cannot compound it', () => {
  for (const s of ['M 6.5 - 12 km NNE of Teluknaga', 'Magnitude 6.5 mw', 'Citrus, FL']) {
    const once = glossary.expandAlways(s);
    assert.equal(glossary.expandAlways(once), once, 'not idempotent: ' + s);
  }
});

test('a bearing is only expanded where it is really a bearing', () => {
  // "Southeast Asia" and a lone capital must not be rewritten.
  assert.equal(glossary.expandAlways('NE Airlines reported'), 'NE Airlines reported');
  assert.equal(glossary.expandAlways('Cyclone S of the coast'), 'Cyclone south of the coast');
});

test('a unit that only looks like a magnitude scale is left alone', () => {
  // This feed publishes cyclone pressure as "948 mb"; an unanchored rule turned
  // that into "94body-wave magnitude 8". Milliseconds and millilitres likewise.
  for (const s of ['Cyclone · minimum pressure 948 mb · winds 105 km/h',
    'Ends in 30 ms latency', 'Reported 500 ml of rain']) {
    assert.equal(glossary.expandAlways(s), s, 'corrupted: ' + s);
  }
  // The real thing still expands, because the word "magnitude" precedes it.
  assert.equal(glossary.expandAlways('Magnitude 6.5 mw · depth 369.2 km'),
    'Moment magnitude 6.5 · depth 369.2 km');
  assert.equal(glossary.expandAlways('M 6.5 mw'), 'Moment magnitude 6.5');
});

test('a country code is never read as a US state', () => {
  // On a global hazard site "Berlin, DE" is Germany, not Delaware.
  assert.equal(glossary.expandAlways('Berlin, DE and New Delhi, IN and Toronto, CA'),
    'Berlin, DE and New Delhi, IN and Toronto, CA');
  // Codes that are unambiguous still expand.
  assert.equal(glossary.expandAlways('Dallas, TX'), 'Dallas, Texas');
  assert.equal(glossary.expandAlways('Citrus, FL'), 'Citrus, Florida');
});

test('a state code is only expanded after a place name', () => {
  assert.equal(glossary.expandAlways('IN the area'), 'IN the area');
  assert.equal(glossary.expandAlways('Tampa, FL'), 'Tampa, Florida');
});

test('every page loads the glossary, last so it sees what is already rendered', () => {
  const missing = PAGES.filter(p => !fs.readFileSync(path.join(ROOT, p), 'utf8').includes('/glossary.js'));
  assert.deepEqual(missing, [], 'pages without the glossary: ' + missing.join(', '));
});

/** Visible text of a rendered page, script and style source excluded. */
function visibleText(doc) {
  const clone = doc.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript').forEach(n => n.remove());
  return clone.textContent;
}

test('no page shows an acronym whose full form it never states', async () => {
  const evs = await sampleEvents();
  const q = id => '?id=' + encodeURIComponent(id);
  const official = evs.find(e => e.sourceType === 'official' && e.alert === 'Red');
  const outlook = evs.find(e => e.forecast && e.id !== 'ND-001');
  const SEARCH = {
    'event-detail.html': q(official.id), 'alert-detail.html': q(official.id),
    'calamity-detail.html': q(official.id), 'forecast-detail.html': q(outlook.id),
    'region-detail.html': '?region=Nepal', 'location-detail.html': '?location=Nepal',
    'hazard-detail.html': '?type=Flood', 'historical-event-detail.html': '?id=0',
    'source-detail.html': '?source=GDACS', 'verification-detail.html': '?id=ND-001',
    'entity-detail.html': '?kind=insight&topic=flood-landslide'
  };
  const terms = glossary.ONCE.map(([acronym, full]) => ({ acronym, full }));
  const undefined_ = [];

  for (const page of PAGES) {
    const r = await renderPage(page, {
      search: SEARCH[page] || '', timeoutMs: 9000,
      waitFor: doc => doc.body.textContent.length > 400 && !/Loading…/.test(doc.body.textContent)
    });
    const text = visibleText(r.document);
    for (const { acronym, full } of terms) {
      const appears = new RegExp('\\b' + acronym + '\\b').test(text);
      if (appears && !text.includes(full)) undefined_.push(page + ': "' + acronym + '" without "' + full + '"');
    }
    r.close();
  }
  assert.deepEqual(undefined_, [], 'acronyms used with no full form on the page:\n' + undefined_.join('\n'));
});

test('no page leaves a raw bearing, magnitude scale or state code on screen', async () => {
  const found = [];
  for (const page of ['events.html', 'recent-events.html', 'official-warnings.html', 'calamities.html']) {
    const r = await renderPage(page, {
      timeoutMs: 9000,
      waitFor: doc => doc.body.textContent.length > 400 && !/Loading…/.test(doc.body.textContent)
    });
    const text = visibleText(r.document);
    if (/\b(NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|NW|SE|SW)\s+of\b/.test(text)) found.push(page + ': raw bearing');
    if (/\b\d(?:\.\d+)?\s+(mw|mb|ml|ms)\b/.test(text)) found.push(page + ': raw magnitude scale');
    if (/,\s(FL|TX|CA|WA|NY|KS|MO|NC)\b/.test(text)) found.push(page + ': raw state code');
    if (/\bM\s\d/.test(text)) found.push(page + ': raw magnitude prefix');
    r.close();
  }
  assert.deepEqual(found, [], found.join('\n'));
});

/* A new instance per assertion: the expansion is once per page, so a second
   call in the same instance would leave the term short and prove nothing. */
function fresh() {
  delete require.cache[require.resolve('../glossary.js')];
  return require('../glossary.js');
}

test('a name that already writes itself out is left alone', () => {
  /* Two ways this went wrong on the sources page, where every provider label
     carries its own expansion. */
  assert.equal(fresh().rewrite('GDACS (Global Disaster Alert and Coordination System)'),
    'GDACS (Global Disaster Alert and Coordination System)',
    'the full form was printed twice');
  assert.equal(fresh().rewrite('Global Disaster Alert and Coordination System (GDACS)'),
    'Global Disaster Alert and Coordination System (GDACS)',
    'the acronym the brackets exist to introduce was swallowed');

  // And the cases this must not change.
  assert.equal(fresh().rewrite('A GDACS alert'),
    'A Global Disaster Alert and Coordination System (GDACS) alert');
  assert.equal(fresh().rewrite('ReliefWeb (UN OCHA)'),
    'ReliefWeb (United Nations Office for the Coordination of Humanitarian Affairs)');
});
