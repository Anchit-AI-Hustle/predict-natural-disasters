'use strict';
/**
 * Launch audit A4: /compare-locations could not compare anything. It had one
 * box that text-matched event titles ("No events match 'Tokyo'"), listed all
 * 850 events when empty (150,000 px tall on a phone), and offered risk levels
 * that matched nothing.
 *
 * It is now two or three geocoded places, each with the answer the home page
 * gives, side by side, with the places in the address so it can be shared.
 * Geocoding is stubbed here: Nominatim is never called from a test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');

const PR = require(path.join(__dirname, '..', 'place-risk.js'));

test.after(closeAllWindows);

/* Nominatim's jsonv2 answer, cut to the fields place-search.js reads. */
const GEO = {
  chillan: [{ lat: '-36.6', lon: '-72.1', name: 'Chillán', addresstype: 'city', display_name: 'Chillán, Ñuble, Chile',
    address: { city: 'Chillán', state: 'Ñuble', country: 'Chile', country_code: 'cl' } }],
  concepcion: [{ lat: '-36.83', lon: '-73.05', name: 'Concepción', addresstype: 'city', display_name: 'Concepción, Biobío, Chile',
    address: { city: 'Concepción', state: 'Biobío', country: 'Chile', country_code: 'cl' } }],
  jakarta: [{ lat: '-6.2', lon: '106.8', name: 'Jakarta', addresstype: 'city', display_name: 'Jakarta, Indonesia',
    address: { city: 'Jakarta', country: 'Indonesia', country_code: 'id' } }],
  springfield: [
    { lat: '39.8', lon: '-89.65', name: 'Springfield', addresstype: 'city', display_name: 'Springfield, Illinois, United States', address: { city: 'Springfield', state: 'Illinois', country: 'United States', country_code: 'us' } },
    { lat: '42.1', lon: '-72.59', name: 'Springfield', addresstype: 'city', display_name: 'Springfield, Massachusetts, United States', address: { city: 'Springfield', state: 'Massachusetts', country: 'United States', country_code: 'us' } }
  ]
};
function stubGeocoder(w, asked) {
  const real = w.fetch;
  w.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (/nominatim\.openstreetmap\.org/.test(u)) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '').toLowerCase().trim();
      asked.push(q);
      return { ok: true, status: 200, json: async () => GEO[q] || [] };
    }
    return real(input, init);
  };
}

const sharedUrl = '?place1=' + encodeURIComponent('Chillán, Ñuble, Chile') + '&lat1=-36.6&lon1=-72.1&cc1=CL&country1=Chile' +
  '&place2=' + encodeURIComponent('Jakarta, Indonesia') + '&lat2=-6.2&lon2=106.8&cc2=ID&country2=Indonesia';

test('A4: with nothing entered the page shows an empty state, not every event', async () => {
  const asked = [];
  const r = await renderPage('compare-locations.html', { beforeParse: w => stubGeocoder(w, asked),
    waitFor: d => d.querySelector('#cmpOut .cmp-empty') });
  const d = r.document;
  assert.ok(d.querySelector('#cmpOut .cmp-empty'), 'no empty state');
  assert.equal(d.querySelectorAll('.event-card, #cmpOut .cmpcard').length, 0, 'events listed before any place was chosen');
  assert.equal(d.getElementById('level'), null, 'the old risk filter is still there');
  assert.equal(d.getElementById('cards'), null, 'the old list of every event is still there');
  assert.equal(d.querySelectorAll('#cmpForm input').length, 3, 'two or three place boxes');
  assert.deepEqual(asked, [], 'a place was looked up before anyone asked');
  assert.deepEqual(r.errors.map(String), []);
  r.close();
});

test('A4: places in the address are compared side by side, with the home page’s answer', async () => {
  const events = (await sampleEvents()).filter(e => e.live !== false);
  const r = await renderPage('compare-locations.html', { search: sharedUrl,
    waitFor: d => d.querySelectorAll('#cmpOut .cmpcard .risk:not(.risk-unknown), #cmpOut .cmpcard h2').length >= 2 &&
      !/Checking/.test(d.getElementById('cmpOut').textContent) });
  const d = r.document;
  const cards = [...d.querySelectorAll('#cmpOut .cmpcard')];
  assert.equal(cards.length, 2);
  assert.ok(d.getElementById('cmpOut').classList.contains('cmpgrid'), 'not side by side');
  const want = [
    PR.assess({ name: 'Chillán, Ñuble, Chile', lat: -36.6, lon: -72.1, country: 'Chile', countryCode: 'CL' }, events),
    PR.assess({ name: 'Jakarta, Indonesia', lat: -6.2, lon: 106.8, country: 'Indonesia', countryCode: 'ID' }, events)
  ];
  cards.forEach((c, i) => {
    assert.equal(c.querySelector('h2').textContent, want[i].place.name);
    assert.equal(c.querySelector('.pr-top .risk').textContent.trim(), want[i].headline);
    /* glossary.js writes "M 5.8" out as "Magnitude 5.8" on the page, so the
       reason is compared up to its first full stop. */
    assert.ok(c.textContent.includes(want[i].why.split('. ')[0]), 'card ' + i + ' does not give the home page’s reason');
    const more = c.querySelector('a[data-cmp-details]');
    assert.ok(more, 'no way to the place page');
    const u = new URL(more.getAttribute('href'), 'http://x');
    assert.equal(u.pathname, '/location-detail');
    assert.equal(u.searchParams.get('lat'), String(want[i].place.lat));
  });
  /* The boxes show what is being compared. */
  assert.equal(d.getElementById('q1').value, 'Chillán, Ñuble, Chile');
  assert.equal(d.getElementById('q2').value, 'Jakarta, Indonesia');
  r.close();
});

test('A4: typed places are found, compared, and put in the address', async () => {
  const asked = [];
  const r = await renderPage('compare-locations.html', { beforeParse: w => stubGeocoder(w, asked),
    waitFor: d => d.getElementById('cmpForm') });
  const d = r.document, w = r.window;
  d.getElementById('q1').value = 'Chillan';
  d.getElementById('q2').value = 'Concepcion';
  d.getElementById('q3').value = 'Jakarta';
  d.getElementById('cmpForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 60 && d.querySelectorAll('#cmpOut .cmpcard h2').length < 3; i++) await new Promise(res => setTimeout(res, 50));
  assert.deepEqual(asked, ['chillan', 'concepcion', 'jakarta']);
  assert.equal(d.querySelectorAll('#cmpOut .cmpcard').length, 3);
  const q = new URLSearchParams(w.location.search);
  assert.equal(q.get('place1'), 'Chillán, Ñuble, Chile');
  assert.equal(q.get('lat2'), '-36.83');
  assert.equal(q.get('place3'), 'Jakarta, Indonesia');
  assert.equal(q.get('cc3'), 'ID');
  r.close();
});

test('A4: a name with several matches asks which one, in that box', async () => {
  const asked = [];
  const r = await renderPage('compare-locations.html', { beforeParse: w => stubGeocoder(w, asked),
    waitFor: d => d.getElementById('cmpForm') });
  const d = r.document, w = r.window;
  d.getElementById('q1').value = 'Springfield';
  d.getElementById('q2').value = 'Jakarta';
  d.getElementById('cmpForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 40 && !d.querySelector('#c1 [data-pick]'); i++) await new Promise(res => setTimeout(res, 50));
  const picks = d.querySelectorAll('#c1 [data-pick]');
  assert.equal(picks.length, 2, 'no choice offered for the first place');
  picks[1].click();
  for (let i = 0; i < 60 && d.querySelectorAll('#cmpOut .cmpcard h2').length < 2; i++) await new Promise(res => setTimeout(res, 50));
  const names = [...d.querySelectorAll('#cmpOut .cmpcard h2')].map(h => h.textContent);
  assert.deepEqual(names, ['Springfield, Massachusetts, United States', 'Jakarta, Indonesia']);
  r.close();
});

test('A4: a place that cannot be found says so and compares nothing yet', async () => {
  const asked = [];
  const r = await renderPage('compare-locations.html', { beforeParse: w => stubGeocoder(w, asked),
    waitFor: d => d.getElementById('cmpForm') });
  const d = r.document, w = r.window;
  d.getElementById('q1').value = 'Qwxzzy';
  d.getElementById('q2').value = 'Jakarta';
  d.getElementById('cmpForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 40 && !/could not find/i.test(d.getElementById('cmpNote').textContent); i++) await new Promise(res => setTimeout(res, 50));
  assert.match(d.getElementById('cmpNote').textContent, /We could not find “Qwxzzy”/);
  r.close();
});
