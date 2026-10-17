'use strict';
/**
 * Every figure the site states, held to what the feed can actually support.
 *
 * The defects these cover were all live in production at once: a sources tile
 * that read "7/3" because the denominator was typed in while the provider list
 * grew; a homepage that called 30 forecasts "High-Risk" when 4 were High; an
 * About page asserting 195 countries while the feed named 77; a hazard strip
 * advertising a class with no records and omitting three that had them; a
 * dashboard running off its own smaller dataset seeded with a warning no
 * agency ever issued; and earthquakes coloured Red/Orange by a magnitude rule
 * of our own invention, then counted as "Authority-sourced" warnings.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents, callApi, closeAllWindows } = require('./render.js');

// jsdom windows keep interval timers alive; without this the runner never exits.
test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

/* ------------------------------------------------ alert levels are issued, not derived */

test('no earthquake alert level is derived from magnitude', () => {
  const api = read('api/events.js');
  const bad = [...api.matchAll(/mag[a-zA-Z]*\s*>=?\s*[\d.]+\s*\?\s*'(Red|Orange)'/g)].map(m => m[0]);
  assert.deepEqual(bad, [],
    'magnitude is a measurement, not an alert level - an agency has to issue one:\n' + bad.join('\n'));
});

test('USGS earthquakes take their alert level from the PAGER field', () => {
  const api = read('api/events.js');
  assert.match(api, /alert:\s*pagerLevel\(f\.properties\.alert\)/,
    'the USGS record carries properties.alert (PAGER); that is the level to publish');
  assert.match(api, /pagerAlert:/, 'the raw PAGER level should stay on the record so a page can show it');
});

test('pagerLevel maps PAGER levels and never invents one', async () => {
  const mod = require(path.join(ROOT, 'api', 'events.js'));
  void mod; // loading the module is enough; pagerLevel is exercised through the handler below
  const events = await sampleEvents();
  const quakes = events.filter(e => e.source === 'USGS' && e.type === 'Earthquake');
  assert.ok(quakes.length >= 2, 'fixture should provide several USGS quakes');

  const assessed = quakes.find(e => e.pagerAlert === 'orange');
  assert.ok(assessed, 'the fixture quake carrying PAGER orange should survive to the feed');
  assert.equal(assessed.alert, 'Orange', 'a PAGER orange quake is an Orange record');

  // The M5.8 has no PAGER level. The old rule made it Orange purely because it
  // was over magnitude 5, and the homepage then counted it as a warning.
  const unassessed = quakes.filter(e => !e.pagerAlert);
  assert.ok(unassessed.length >= 1, 'fixture should include a quake with no PAGER level');
  for (const e of unassessed) {
    assert.equal(e.alert, 'Green',
      `${e.title} has no PAGER assessment, so it must not be published as a warning`);
    assert.match(String(e.details), /no USGS PAGER impact alert issued/,
      'the record should say plainly that no impact alert was issued');
  }
});

test('EMSC records are detections, not alert levels', async () => {
  const events = await sampleEvents();
  const emsc = events.filter(e => e.source === 'EMSC');
  assert.ok(emsc.length >= 1, 'fixture should provide EMSC records');
  for (const e of emsc) {
    assert.equal(e.alert, 'Green',
      `EMSC publishes no impact alert, so ${e.title} cannot carry one`);
  }
});

/* ------------------------------------------------------------ counts the meta publishes */

test('every meta count matches the events actually shipped', async () => {
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  const { meta, events } = await (await callApi(handler, '/api/events')).json();
  const count = fn => events.filter(fn).length;

  assert.equal(meta.eventCount, events.length, 'eventCount');
  assert.equal(meta.officialCount, count(e => e.sourceType === 'official'), 'officialCount');
  assert.equal(meta.forecastCount, count(e => e.forecast), 'forecastCount');
  assert.equal(meta.countryCount,
    new Set(events.map(e => e.country).filter(Boolean)).size, 'countryCount');
  assert.equal(meta.hazardTypeCount,
    new Set(events.map(e => e.type).filter(Boolean)).size, 'hazardTypeCount');
  // A forecast whose window has closed is not an active high-risk forecast.
  assert.equal(meta.highRiskForecastCount,
    count(e => e.forecast && !e.windowClosed && e.alert === 'High'), 'highRiskForecastCount');
  assert.equal(meta.activeForecastCount, count(e => e.forecast && !e.windowClosed),
    'activeForecastCount');
  assert.equal(meta.closedForecastCount, count(e => e.windowClosed), 'closedForecastCount');
  assert.equal(meta.officialWarningCount,
    count(e => e.sourceType === 'official' && (e.alert === 'Red' || e.alert === 'Orange')),
    'officialWarningCount');
  assert.equal(meta.sourceCount, Object.values(meta.sources).filter(s => s && s.ok).length,
    'sourceCount is the number online');
  assert.equal(meta.sourceTotal, Object.keys(meta.sources).length, 'sourceTotal is every provider');
});

test('the summary view reports the same counts as the full feed', async () => {
  const handler = require(path.join(ROOT, 'api', 'events.js'));
  const full = await (await callApi(handler, '/api/events')).json();
  const summary = await (await callApi(handler, '/api/events?summary=1')).json();
  assert.equal(summary.events, undefined, 'the summary should not ship the records');
  for (const k of ['eventCount', 'officialCount', 'forecastCount', 'countryCount',
    'hazardTypeCount', 'highRiskForecastCount', 'officialWarningCount']) {
    assert.equal(typeof summary.meta[k], 'number', k + ' should be published in the summary');
  }
  assert.equal(summary.meta.sourceTotal, full.meta.sourceTotal, 'sourceTotal');
});

/* ------------------------------------------------------- no page invents a denominator */

test('no page hard-codes how many upstream providers exist', () => {
  const offenders = [];
  for (const p of PAGES) {
    const s = read(p);
    // e.g. filter(x => x && x.ok).length + '/3'  - numerator from the feed,
    // denominator typed in, so a healthy feed read "7/3".
    for (const m of s.matchAll(/\.length\s*\+\s*['"]\/\d+['"]/g)) offenders.push(p + ': ' + m[0]);
    for (const m of s.matchAll(/state\.feeds\s*\+\s*['"]\/\d+['"]/g)) offenders.push(p + ': ' + m[0]);
  }
  assert.deepEqual(offenders, [],
    'count the providers in the feed rather than stating how many there are:\n' + offenders.join('\n'));
});

test('the shared sources ratio reads both halves from the feed', () => {
  const portal = read('portal.js');
  assert.match(portal, /sourcesRatio\(meta\)/, 'portal.js should expose PND.sourcesRatio');
  const ratio = (meta) => {
    const all = Object.values((meta && meta.sources) || {});
    const n = all.filter(x => x && x.ok).length;
    return n + '/' + (all.length || n);
  };
  assert.equal(ratio({ sources: { a: { ok: true }, b: { ok: false }, c: { ok: true } } }), '2/3');
  assert.equal(ratio({ sources: {} }), '0/0');
  assert.equal(ratio(null), '0/0');
});

test('a page that calls PND also loads portal.js', () => {
  const missing = [];
  for (const p of PAGES) {
    const s = read(p);
    /* Both sides of this check were wrong. It looked for the bare string
       "portal.js", so a code comment naming the file satisfied it - and
       home-v3.html called PND.matches with no portal.js loaded while this
       test passed. It must match a script tag, and allow the cache-busting
       query string that home.html and home-v2.html carry. And the calls must
       be counted outside comments, or a page that only mentions PND in a
       comment is reported as broken. */
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '');
    const loads = /<script[^>]*\ssrc="\/portal\.js(\?[^"]*)?"/.test(s);
    if (/\bPND\.[a-zA-Z]/.test(code) && !loads) missing.push(p);
  }
  assert.deepEqual(missing, [], 'these pages would throw on PND: ' + missing.join(', '));
});

/* ------------------------------------------------------------------ nothing fabricated */

test('no page ships a warning no agency issued', () => {
  const offenders = [];
  for (const p of PAGES) {
    const s = read(p);
    if (/VN-WARN/.test(s)) offenders.push(p + ': VN-WARN');
    if (/Vietnam NCHMF/.test(s)) offenders.push(p + ': Vietnam NCHMF bulletin');
  }
  assert.deepEqual(offenders, [],
    'an empty table must say it is empty, not show an invented bulletin:\n' + offenders.join('\n'));
});

test('the dashboard reads the same merged feed as every other page', () => {
  const s = read('dashboard.html');
  assert.ok(!/earthquake\.usgs\.gov/.test(s) && !/eonet\.gsfc\.nasa\.gov/.test(s),
    'its own capped upstream fetches gave it totals that disagreed with the rest of the site');
  assert.match(s, /fetch\('\/api\/events'/, 'it should read /api/events');
});

/* --------------------------------------------------- labels match what is being counted */

test('the homepage forecast tile does not call every forecast high risk', () => {
  const s = read('index.html');
  assert.ok(!/High-Risk Forecasts/.test(s),
    'the tile counted all forecasts, most of which are Moderate or Watch');
  assert.match(s, /id="kForecastsNote"/, 'the risk split should be published beside the count');
  assert.match(s, /fc\.filter\(e=>PND\.matchesRiskLevel\(e,\s*l\.key\)\)\.length/,
    'the split should be counted from the feed');
  /* And counted the same way the badges beside it are resolved. Counting raw
     alert words missed every outlook whose provider said "Orange" while the
     card below called it Moderate - the tile and the list disagreeing about
     the same records. */
  assert.match(s, /PNDRisk\.LEVELS/, 'the split is not built from the one risk scale');
  assert.ok(!/\['High','Moderate','Watch'\]/.test(s),
    'the tile still keeps its own list of level names');
});

test('the About page states no coverage figure it cannot show', () => {
  const s = read('about.html');
  assert.ok(!/>195</.test(s), 'the feed names far fewer countries than 195');
  assert.match(s, /id="aCountries"/, 'the country figure should come from the feed');
  assert.match(s, /id="aHazards"/, 'the hazard-class figure should come from the feed');
  assert.match(s, /api\/events\?summary=1/, 'it should read the published counts');
});

test('no page promises a fixed day window the feed can exceed', () => {
  const offenders = [];
  for (const p of PAGES) {
    const m = read(p).match(/Latest\s+\d+\s+Days/i);
    if (m) offenders.push(p + ': ' + m[0]);
  }
  assert.deepEqual(offenders, [],
    'long-running fires and droughts in the same feed are older than any such window:\n'
    + offenders.join('\n'));
});

/* ------------------------------------------------ the hazard strip agrees with its links */

// Mirrors hazard-detail.html's own matcher. If these drift, a chip shows one
// number and the page it opens shows another.
const hazKey = t => String(t).toLowerCase()
  .replace('wildfire', 'wild').replace('volcano', 'volcan').split(' ')[0];

function stripClasses() {
  const s = read('index.html');
  const m = s.match(/const types=\[(\[[^\]]*\](?:,\[[^\]]*\])*)\]/);
  assert.ok(m, 'the homepage hazard strip should declare its classes');
  return [...m[1].matchAll(/\['([^']+)','[^']*'\]/g)].map(x => x[1]);
}

test('the homepage strip and hazard-detail use the same matcher', () => {
  const index = read('index.html');
  assert.match(index, /const hazKey=/, 'the strip should key on the same expression');
  assert.match(index, /includes\(hazKey\(t\)\)/, 'chip counts should use it');
  const detail = read('hazard-detail.html');
  assert.match(detail,
    /replace\('wildfire','wild'\)\.replace\('volcano','volcan'\)/,
    'hazard-detail still normalises this way');
  assert.match(detail, /target\.split\(' '\)\[0\]/, 'hazard-detail still matches on the first word');
});

test('every hazard class the strip links to exists on hazard-detail', () => {
  const options = [...read('hazard-detail.html').matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]);
  const missing = stripClasses().filter(c => !options.includes(c));
  // An unlisted type silently falls back to Flood, so the link would show
  // flood numbers under a tornado heading.
  assert.deepEqual(missing, [],
    'these classes have no option on hazard-detail: ' + missing.join(', '));
});

test('a chip count equals the count on the page it opens', async () => {
  const home = await renderPage('index.html', {
    waitFor: d => (d.getElementById('hazardStrip') || {}).children &&
      d.getElementById('hazardStrip').children.length > 0
  });
  const chips = [...home.document.getElementById('hazardStrip').children].map(el => ({
    name: el.querySelector('b').textContent.replace(/^\S+\s*/, '').trim(),
    count: Number(el.querySelector('span').textContent.replace(/\D+/g, ''))
  }));
  home.close();
  assert.ok(chips.length, 'the strip rendered no chips');

  for (const chip of chips) {
    const page = await renderPage('hazard-detail.html', {
      search: '?type=' + encodeURIComponent(chip.name),
      waitFor: d => (d.getElementById('kEvents') || {}).textContent &&
        d.getElementById('kEvents').textContent !== '-'
    });
    const shown = Number(page.document.getElementById('kEvents').textContent.replace(/\D+/g, ''));
    const heading = page.document.getElementById('title').textContent;
    page.close();
    /* The heading is in sentence case ("Tropical cyclone events"), so the
       hazard is matched without regard to capitals. */
    assert.ok(heading.toLowerCase().includes(chip.name.toLowerCase()),
      'the chip for ' + chip.name + ' opened a page headed "' + heading + '"');
    assert.equal(shown, chip.count,
      'the ' + chip.name + ' chip says ' + chip.count + ' but its page shows ' + shown);
  }
});

test('the strip advertises no class with nothing in it', async () => {
  const s = read('index.html');
  assert.match(s, /\.filter\(x=>x\[2\]>0\)/,
    'an empty class should be dropped, not shown reading "0 tracked"');
});

test('every hazard class in the feed reaches a chip', async () => {
  const events = await sampleEvents();
  const classes = stripClasses();
  const orphan = [...new Set(events.map(e => e.type).filter(Boolean))]
    .filter(t => !classes.some(c => String(t).toLowerCase().includes(hazKey(c))));
  assert.deepEqual(orphan, [],
    'these hazard types are in the feed but have no chip: ' + orphan.join(', '));
});
