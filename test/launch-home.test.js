'use strict';
/**
 * Launch audit A, the home page.
 *
 *  A5  "723 live events · 2 serious · 698 minor" left 23 uncounted, beside a
 *      map key reading "High 17 · Moderate 61"; the hazard strip and the
 *      hazard filter gave different counts for the same hazard.
 *  A12 A searched place was not in the address, Back left the site, and
 *      "See details" went to My places rather than the place.
 *  A19 The track record showed one hand-written test case and nothing else.
 *  A20 Latest forecasts were not in time order.
 *  A21-A23, A27, A29, A30, A32 copy, structure and layout glitches.
 *
 * Nominatim is never called: the place search is answered by a stub.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const VERDICTS = require(path.join(ROOT, 'data', 'model-verdicts.json'));

test.after(closeAllWindows);

const GEO = {
  concepcion: [{ lat: '-36.83', lon: '-73.05', name: 'Concepción', addresstype: 'city', display_name: 'Concepción, Biobío, Chile',
    address: { city: 'Concepción', state: 'Biobío', country: 'Chile', country_code: 'cl' } }]
};
function stubGeocoder(w) {
  const real = w.fetch;
  w.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (/nominatim\.openstreetmap\.org/.test(u)) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '').toLowerCase().trim();
      return { ok: true, status: 200, json: async () => GEO[q] || [] };
    }
    return real(input, init);
  };
}
const settled = d => /\d/.test((d.getElementById('kEvents') || {}).textContent || '') &&
  d.querySelector('#hazardStrip .hazard');

async function home(opts) {
  return renderPage('index.html', Object.assign({ timeoutMs: 10000, waitFor: settled }, opts || {}));
}

/* ------------------------------------------------------------------ A5 */

test('A5: the live-events note adds up, in the map key’s own levels', async () => {
  const r = await home();
  const d = r.document, w = r.window;
  const total = Number(d.getElementById('kEvents').textContent);
  const note = d.getElementById('kEventsNote').textContent;
  const parts = note.split(' · ').map(p => /^(\d+) (.+)$/.exec(p));
  assert.ok(parts.every(Boolean), 'note is not a list of counts: ' + note);
  assert.equal(parts.reduce((s, p) => s + Number(p[1]), 0), total, note + ' does not add up to ' + total);
  /* The same levels, counted the same way, as the key under the map. */
  const map = w.__pndMaps.find(m => m.getContainer() && m.getContainer().id === 'leafletMap');
  map.__pndKey.render();
  const key = {};
  map.__pndKey.element.querySelectorAll('li').forEach(li => {
    const name = li.querySelector('.pnd-key-name').textContent, n = Number(li.querySelector('.pnd-key-n').textContent);
    if (name !== 'Our forecasts') key[name.toLowerCase()] = n;
  });
  const fromNote = Object.fromEntries(parts.map(p => [p[2], Number(p[1])]));
  assert.deepEqual(fromNote, key);
  r.close();
});

test('A5: the hazard filter and the hazard strip count the same events', async () => {
  const r = await home();
  const d = r.document;
  const strip = {};
  d.querySelectorAll('#hazardStrip .hazard').forEach(h => {
    const name = h.querySelector('b').textContent.replace(/^\S+\s/, '').trim();
    strip[name] = Number(/(\d+) reported/.exec(h.querySelector('span').textContent)[1]);
  });
  const opts = [...d.getElementById('hazardFilter').options];
  assert.equal(opts[0].textContent, 'All hazards', 'the first option is cut off as "All hazards (8"');
  for (const [name, n] of Object.entries(strip)) {
    const o = opts.find(x => x.value === name);
    assert.ok(o, 'the filter has no ' + name);
    assert.equal(o.textContent, name + ' (' + n + ')', 'filter and strip disagree about ' + name);
  }
  r.close();
});

test('A5: home map marks are coloured by the record’s one level, and forecasts are marked as ours', async () => {
  const r = await home();
  const w = r.window;
  const map = w.__pndMaps.find(m => m.getContainer() && m.getContainer().id === 'leafletMap');
  const marks = [];
  map.eachLayer(l => { if (l.options && l.options.pndLevel) marks.push(l); });
  assert.ok(marks.length > 5);
  const events = (await sampleEvents()).filter(e => e.live !== false);
  for (const m of marks) {
    const ll = m.getLatLng();
    const e = events.find(x => +x.lat === ll.lat && +x.lon === ll.lng && w.PND.esc(x.title) === (m.getPopup().getContent().match(/<b>(.*?)<\/b>/) || [])[1]);
    if (!e) continue;
    assert.equal(m.options.pndLevel, w.PND.riskKey(e), e.id);
    assert.equal(!!m.options.pndForecast, !!e.forecast, e.id);
  }
  r.close();
});

/* ------------------------------------------------------------------ A12 */

test('A12: a searched place goes in the address, See details opens it, and Back undoes it', async () => {
  const r = await home({ beforeParse: stubGeocoder });
  const d = r.document, w = r.window;
  d.getElementById('placeQ').value = 'Concepcion';
  d.getElementById('checkForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 60 && !d.querySelector('#placeResult h2'); i++) await new Promise(res => setTimeout(res, 50));
  const q = new URLSearchParams(w.location.search);
  assert.equal(q.get('place'), 'Concepción, Biobío, Chile');
  assert.equal(q.get('lat'), '-36.83');
  assert.equal(q.get('lon'), '-73.05');
  const more = d.getElementById('viewEvidence');
  const u = new URL(more.getAttribute('href'), 'http://x');
  assert.equal(u.pathname, '/location-detail');
  assert.equal(u.searchParams.get('location'), 'Concepción, Biobío, Chile');
  assert.equal(u.searchParams.get('lat'), '-36.83');
  assert.equal(u.searchParams.get('cc'), 'CL');
  /* Back: the address loses the place, and so does the page. */
  w.history.replaceState(null, '', '/index.html');
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  await new Promise(res => setTimeout(res, 50));
  assert.ok(d.getElementById('placeResult').hidden, 'Back left the answer on screen');
  r.close();
});

test('A12: a shared address answers its place on arrival', async () => {
  const r = await home({ search: '?place=' + encodeURIComponent('Concepción, Chile') + '&lat=-36.83&lon=-73.05&cc=CL&country=Chile',
    waitFor: d => settled(d) && /Concepción/.test((d.querySelector('#placeResult h2') || {}).textContent || '') });
  const d = r.document;
  assert.equal(d.querySelector('#placeResult h2').textContent, 'Concepción, Chile');
  assert.equal(d.getElementById('placeQ').value, 'Concepción, Chile');
  r.close();
});

test('A6: the home answer says an agency’s level in the agency’s terms', async () => {
  const r = await home({ search: '?place=' + encodeURIComponent('Concepción, Chile') + '&lat=-36.83&lon=-73.05&cc=CL&country=Chile',
    waitFor: d => settled(d) && d.querySelector('#placeResult h2') && !/Checking/.test(d.getElementById('placeResult').textContent) });
  const t = r.document.getElementById('placeResult').textContent;
  /* glossary.js may write USGS out in full the first time it appears. */
  assert.match(t, /Low \(no (?:USGS|United States Geological Survey \(USGS\)) PAGER impact alert issued\)/, t.slice(0, 400));
  r.close();
});

/* ------------------------------------------------------------------ A19 */

test('A19: the track record states what has been graded, in /accuracy’s words, and calls the test case one', async () => {
  /* It reads data/accuracy-summary.json, the figures and wording /accuracy
     opens with (forecast-honesty: one verdict per forecast, model forecasts
     graded from settled measurements only), rather than writing its own
     sentence from data/model-verdicts.json counts. */
  const S = require(path.join(ROOT, 'data', 'accuracy-summary.json'));
  const r = await home({ waitFor: d => settled(d) && /graded/.test((d.getElementById('trackFacts') || {}).textContent || '') });
  const t = r.document.getElementById('trackFacts').textContent.replace(/\s+/g, ' ');
  const plain = s => s.replace(/\s+/g, ' ');
  assert.ok(t.includes(plain(S.answer.lead)), t);
  const c = VERDICTS.counts;
  assert.match(t, new RegExp(c.issued + ' forecasts in advance'));
  assert.match(r.document.querySelector('.verification').textContent, /1 hand-written test case/);
  r.close();
});

/* ------------------------------------------------------------------ A20 */

test('A20: latest forecasts are in order of when they start', async () => {
  const r = await home();
  const fc = (await sampleEvents()).filter(e => e.live !== false && e.forecast && !e.windowClosed);
  const t = e => Date.parse(e.targetStart || e.updated) || 0;
  const want = fc.slice().sort((a, b) => t(b) - t(a)).slice(0, 6).map(e => '/forecasts/' + encodeURIComponent(e.id));
  const got = [...r.document.querySelectorAll('#forecastRows tr')].map(tr => (tr.getAttribute('onclick') || '').match(/GO\('([^']+)'\)/)[1]);
  assert.deepEqual(got, want);
  r.close();
});

/* ------------------------------------------------------- copy and markup */

test('A22: the footer does not write an agency’s name out a second time', async () => {
  const r = await home({ waitFor: d => settled(d) && d.querySelector('.trust-foot') });
  const t = r.document.querySelector('.trust-foot').textContent.replace(/\s+/g, ' ');
  /* The trust note's name for USGS is "United States Geological Survey"
     (forecast-honesty C35); what A22 forbids is that name written out twice. */
  assert.match(t, /United States Geological Survey \(USGS\)/);
  assert.doesNotMatch(t, /Geological Survey\)? \(United States Geological Survey/);
  r.close();
});

test('A21-A23, A27, A29, A30, A32: home copy and structure', async () => {
  const r = await home();
  const d = r.document;
  /* What a reader sees: the page's own scripts are left out. */
  const body = d.body.cloneNode(true);
  body.querySelectorAll('script,style').forEach(x => x.remove());
  const t = body.textContent.replace(/\s+/g, ' ');
  assert.equal(d.querySelector('.kpi.quote'), null, 'the filler quote card is still there');
  assert.ok(!/Prepared communities save lives/.test(t));
  assert.ok(!/What should I do now\?/.test(t), 'the card that only opens the events list is still called this');
  assert.ok(/See live events/.test(t));
  assert.ok(!/View All/.test(t), '"View All" is still capitalised');
  assert.ok(!/Official Warnings/.test(t), '"Official Warnings" is still title case');
  assert.match(t, /Official warnings and watches/);
  assert.match(t, /live hazards/);
  assert.ok(!/live dangers/.test(t));
  assert.ok(!/observed only/.test(t), 'jargon: "observed only"');
  assert.match(t, /reports only, no forecast/);
  /* The header is links, and the logo is the same mark as every other page. */
  const nav = [...d.querySelectorAll('header .nav > *')];
  assert.ok(nav.length >= 5);
  assert.ok(nav.every(x => x.tagName === 'A' && x.getAttribute('href')), 'the header nav is not links');
  const logo = d.querySelector('header .logo');
  assert.equal(logo.tagName, 'A');
  assert.equal(logo.getAttribute('href'), '/');
  assert.match(logo.textContent, /◎/);
  /* Section titles are h2 under the page's h1. */
  for (const id of ['hazardStrip', 'forecastRows', 'recentRows', 'warningRows']) {
    const panel = d.getElementById(id).closest('section');
    assert.ok(panel.querySelector('.panel-head h2'), id + ': its title is not an h2');
  }
  /* The search message sits under the box and describes it. */
  const msg = d.getElementById('checkNote');
  assert.equal(msg.previousElementSibling && msg.previousElementSibling.id, 'checkForm');
  assert.match(d.getElementById('placeQ').getAttribute('aria-describedby') || '', /\bcheckNote\b/);
  r.close();
  assert.match(read('index.html'), /\.placefirst h1\{max-width:22ch;text-wrap:balance\}/);
});
