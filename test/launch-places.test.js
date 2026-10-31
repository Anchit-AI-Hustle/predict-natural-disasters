'use strict';
/**
 * Launch audit A, the place pages: /location-detail and the contacts it shows.
 *
 *  A1  A place page was drawn as if a disaster had just struck it: it called
 *      the event enrichment with a made-up "<place> natural disaster" event,
 *      so Tokyo read "When it was reported ... just now ... Type Earthquake",
 *      followed by "Who may need help first".
 *  A2  Its news and videos were off-topic, years old or sensational, and the
 *      source chip ran into the badge ("News18Established newsroom").
 *  A3  Mumbai had "no verified national emergency number" while India's 112,
 *      NDMA and IMD were in the data all along: the page never said which
 *      country the place was in.
 *  A17 Hazard chips ran together ("Earthquake6events", "1 events").
 *  A18 The counts mixed our forecasts into "current events", and the answer
 *      badge sat on the same line as the subtitle.
 *
 * Geocoding is never called: these pages are opened with coordinates, and the
 * reverse lookup the API makes is answered by the upstream mock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const enrich = require(path.join(ROOT, 'api', 'event-enrichment.js'));
const support = require(path.join(ROOT, 'api', '_lib', 'verified-support.js'));

test.after(closeAllWindows);

const INDIA_GEOCODE = {
  countryName: 'India', countryCode: 'IN', principalSubdivision: 'Maharashtra',
  city: 'Mumbai', locality: 'Mumbai', continent: 'Asia', localityInfo: { administrative: [] }
};
const daysAgo = n => new Date(Date.now() - n * 864e5).toUTCString();
/* Google News as it really answers: the outlet stuck on the headline, and a
   description that repeats the headline with the outlet after it. */
const NEWS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Strong quake rattles Jakarta, buildings evacuated - Reuters</title><link>https://www.reuters.com/world/asia/jakarta-quake</link><pubDate>${daysAgo(2)}</pubDate><description>Strong quake rattles Jakarta, buildings evacuated&nbsp;&nbsp;Reuters</description><source url="https://www.reuters.com">Reuters</source></item>
  <item><title>The '26th': An Odd Link Behind Some Of World's Worst Tragedies - News18</title><link>https://www.news18.com/world/odd-link</link><pubDate>${daysAgo(45)}</pubDate><description>The '26th': An Odd Link Behind Some Of World's Worst Tragedies News18</description><source url="https://www.news18.com">News18</source></item>
  <item><title>Indonesia earthquake kills dozens - The Guardian</title><link>https://www.theguardian.com/world/2017/indonesia</link><pubDate>Sat, 02 Sep 2017 00:00:00 GMT</pubDate><description>From 2017.</description><source url="https://www.theguardian.com">The Guardian</source></item>
</channel></rss>`;

const place = (name, lat, lon, extra) =>
  '?location=' + encodeURIComponent(name) + '&lat=' + lat + '&lon=' + lon + (extra || '');

async function openPlace(search, opts) {
  return renderPage('location-detail.html', Object.assign({
    search, timeoutMs: 12000,
    waitFor: d => /\d/.test((d.getElementById('kEvents') || {}).textContent || '') &&
      d.querySelector('#placeContacts #helplinesBody .card:not(.loading)')
  }, opts || {}));
}

/* ------------------------------------------------------------------ A1 */

test('A1: a place page never draws the place as if an event just happened there', async () => {
  const r = await openPlace(place('Tokyo', 35.68, 139.76, '&country=Japan&cc=JP'));
  const t = r.text();
  for (const s of ['When and where it happened', 'Where it started', 'Who may need help',
    'Immediate needs', 'Other dangers to watch for']) {
    assert.ok(!t.includes(s), 'the place page still says "' + s + '"');
  }
  assert.equal(r.document.getElementById('eventEnrichment'), null, 'the event block is still on the page');
  const asked = r.apiCalls.filter(u => u.includes('/api/event-enrichment'));
  assert.ok(asked.length >= 1, 'no contacts were asked for');
  for (const u of asked) {
    const q = new URL(u, 'http://x').searchParams;
    assert.doesNotMatch(q.get('title') || '', /natural disaster/i, 'a made-up event was sent: ' + u);
  }
  assert.ok(asked.some(u => new URL(u, 'http://x').searchParams.get('mode') === 'place'),
    'the contacts were not asked for in place mode');
  assert.deepEqual(r.errors.map(String), []);
  r.close();
});

test('A1: the contacts-only mode renders contacts, agencies and support groups only', async () => {
  const r = await openPlace(place('Mumbai', 19.07, 72.87, '&country=India&cc=IN'));
  const box = r.document.getElementById('placeContacts');
  assert.ok(box, 'no contacts section');
  const heads = [...box.querySelectorAll('h2')].map(h => h.textContent);
  assert.deepEqual(heads, ['Emergency phone numbers', 'Official agencies and contacts', 'Local and national support groups']);
  r.close();
});

/* ------------------------------------------------------------------ A3 */

test('A3: Mumbai lists 112, NDMA and IMD', async () => {
  const r = await openPlace(place('Mumbai', 19.07, 72.87, '&country=India&cc=IN'));
  const box = r.document.getElementById('placeContacts');
  box.querySelectorAll('style').forEach(x => x.remove());
  const t = box.textContent;
  const phones = [...box.querySelectorAll('.intelphone')].map(x => x.textContent);
  assert.ok(phones.includes('112'), 'no 112: ' + phones.join(', '));
  assert.ok(phones.includes('1078'), 'no NDMA helpline: ' + phones.join(', '));
  assert.doesNotMatch(t, /@/, 'an email address on a place page');
  assert.match(t, /National Disaster Management Authority \(NDMA\)/);
  assert.match(t, /India Meteorological Department \(IMD\)/);
  assert.doesNotMatch(t, /no verified national emergency number/i);
  r.close();
});

test('A3: a place opened with coordinates only still finds its country', async () => {
  /* The page used to send the place name as the region and an empty country,
     so "Mumbai" matched no country at all. The API now falls back to the
     country its own reverse lookup found. */
  const res = await callApi(enrich, '/api/event-enrichment?mode=place&lat=19.07&lon=72.87&region=Mumbai',
    { feeds: { geocode: INDIA_GEOCODE } });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.helplines.country, 'India');
  assert.ok(d.helplines.emergency.some(x => x.phone === '112'));
  assert.ok(d.authorities.some(a => /NDMA/.test(a.name)));
  assert.ok(d.authorities.some(a => /IMD/.test(a.name)));
});

test('A3: place mode does not search news, reports or videos', async () => {
  const { makeFetch } = require('./mock-upstreams.js');
  const realFetch = global.fetch;
  const f = makeFetch({ feeds: { geocode: INDIA_GEOCODE } });
  global.fetch = f;
  const res = { statusCode: 0, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await enrich({ query: { mode: 'place', lat: '19.07', lon: '72.87', country: 'India' }, url: '/api/event-enrichment', method: 'GET', headers: {} }, res);
  } finally { global.fetch = realFetch; }
  assert.equal(res.statusCode, 200);
  const hosts = f.calls.map(u => new URL(u).hostname);
  assert.deepEqual(hosts.filter(h => /google|bing|youtube|reliefweb/.test(h)), [], 'searched: ' + hosts.join(', '));
  assert.deepEqual(res.body.news, []);
  assert.deepEqual(res.body.videos, []);
});

test('A3: the gaps filled are national numbers we know, and no country is guessed', () => {
  for (const [c, num] of [['Costa Rica', '911'], ['Panama', '911'], ['El Salvador', '911'],
    ['Honduras', '911'], ['Uruguay', '911'], ['Paraguay', '911'], ['Venezuela', '911'],
    ['Hong Kong', '999'], ['Puerto Rico', '911']]) {
    const s = support.supportFor(c);
    assert.ok(s.matched, c + ' has no entry');
    assert.ok(s.emergency.some(x => x.phone === num), c + ' has no ' + num);
  }
  /* A country left out keeps saying so rather than borrowing a number. */
  assert.deepEqual(support.supportFor('Atlantis').emergency, []);
});

/* ------------------------------------------------------------------ A2 */

test('A2: a calm place shows no news and no videos at all', async () => {
  const r = await openPlace(place('Mumbai', 19.07, 72.87, '&country=India&cc=IN'),
    { mock: { feeds: { google_news: NEWS } } });
  const t = r.text();
  assert.ok(!/News reports|Videos|Watch ↗/.test(t), 'news or videos on a place with no event');
  assert.ok(!r.document.querySelector('img.intelthumb'), 'a video thumbnail is still drawn');
  r.close();
});

test('A2: near a real event, only that event’s news from the last 30 days, with the source stripped', async () => {
  const r = await openPlace(place('Jakarta', -6.2, 106.8, '&country=Indonesia&cc=ID'), {
    mock: { feeds: { google_news: NEWS, bing_news: '<rss><channel></channel></rss>' } },
    waitFor: d => /\d/.test((d.getElementById('kEvents') || {}).textContent || '') &&
      d.querySelector('#placeNews .card:not(.loading)')
  });
  const d = r.document;
  const box = d.getElementById('placeNews');
  assert.ok(box, 'no news section beside a real event');
  /* Tied to the event: the search is for the event's own title, never a
     made-up "<place> natural disaster". */
  const newsCall = r.apiCalls.find(u => u.includes('/api/event-enrichment') &&
    new URL(u, 'http://x').searchParams.get('mode') === 'news');
  assert.ok(newsCall, 'the news was not asked for the event');
  assert.match(new URL(newsCall, 'http://x').searchParams.get('title'), /Teluknaga|West Java/);
  const cards = [...box.querySelectorAll('a.intelcard')];
  assert.equal(cards.length, 1, 'expected only the recent item, got ' + cards.map(c => c.textContent).join(' | '));
  const h = cards[0].querySelector('h3').textContent;
  assert.equal(h, 'Strong quake rattles Jakarta, buildings evacuated');
  assert.doesNotMatch(cards[0].textContent, /evacuated\s*Reuters/, 'the headline is repeated with the source on the end');
  /* The chips are two chips, not one word. */
  const chips = [...cards[0].querySelectorAll('.inteltag')].map(x => x.textContent);
  assert.deepEqual(chips, ['Reuters', 'Established newsroom']);
  assert.doesNotMatch(cards[0].textContent.replace(/\s+/g, ' '), /ReutersEstablished/);
  assert.ok(!/Videos/.test(r.text()), 'videos on a place page');
  r.close();
});

test('A24: a news item that gives only a date is shown as that date', () => {
  const s = require('node:fs').readFileSync(path.join(ROOT, 'event-enrichment.js'), 'utf8');
  const win = { PND: null };
  new Function('window', 'document', s)(win, { getElementById: () => null });
  const E = win.PNDEventEnrichment;
  assert.equal(E.newsDate('Sat, 02 Sep 2017 00:00:00 GMT'), '2 Sep 2017');
  assert.equal(E.newsDate('2026-09-01'), '1 Sep 2026');
  assert.equal(E.stripSource('Strong quake rattles Jakarta - Reuters', 'Reuters'), 'Strong quake rattles Jakarta');
  assert.equal(E.stripSource('Across The World News18', 'News18'), 'Across The World');
  assert.equal(E.stripSource('A headline | BBC News', 'BBC News'), 'A headline');
});

/* ------------------------------------------------------------- A17, A18 */

test('A17: hazard chips are spaced and count in the singular for one', async () => {
  const r = await openPlace(place('Concepcion', -36.83, -73.05, '&country=Chile&cc=CL'));
  const chips = [...r.document.querySelectorAll('#hazards .haz')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(chips.length, 'no hazard chips');
  for (const c of chips) {
    assert.doesNotMatch(c, /[a-z]\d|\devent/, 'run together: ' + c);
    assert.doesNotMatch(c, /\b1 events\b/, 'plural for one: ' + c);
  }
  assert.ok(chips.some(c => /\b1 event\b/.test(c)), chips.join(' | '));
  r.close();
});

test('A18: our forecasts are counted apart from reported events, and the answer has its own line', async () => {
  const r = await openPlace(place('Concepcion', -36.83, -73.05, '&country=Chile&cc=CL'));
  const d = r.document;
  /* One USGS quake and one aftershock forecast of ours lie within 100 km. */
  assert.equal(d.getElementById('kEvents').textContent, '1');
  assert.match(d.getElementById('coverage').textContent, /^1 reported event from 1 source · 1 forecast of ours\./);
  const ans = d.getElementById('placeAnswer');
  assert.ok(!ans.hidden);
  assert.ok(ans.querySelector('.pa-badge .risk'), 'the badge is not in a line of its own');
  assert.ok(ans.querySelector('.pa-why'), 'the reason is not in a line of its own');
  /* The key and the chip agree: both come from the one level function. */
  const chip = d.querySelector('#events .event .risk');
  assert.ok(chip, 'no chip');
  r.close();
});

/* ------------------------------------------------------------------ A25 */

test('A25: a place page that names no real place is not indexed', async () => {
  const r = await renderPage('location-detail.html', { search: '?location=Nowhereville',
    waitFor: d => /\d/.test((d.getElementById('kEvents') || {}).textContent || '') });
  const robots = r.document.querySelector('meta[name="robots"]');
  assert.ok(robots && /noindex/.test(robots.content), 'a soft 404 is indexable');
  r.close();
});

test('A5, A18: the map key counts reported events by level, and our forecasts on a line of their own', async () => {
  const r = await renderPage('location-detail.html', { timeoutMs: 8000,
    search: '?location=Concepcion&lat=-36.83&lon=-73.05',
    waitFor: d => /\d/.test((d.getElementById('kEvents') || {}).textContent || '') });
  const map = r.window.__pndMaps[0];
  assert.ok(map.__pndKey, 'no key');
  map.__pndKey.render();
  const key = map.__pndKey.element.textContent.replace(/\s+/g, ' ');
  assert.match(key, /Low\s*1/, key);
  assert.match(key, /Our forecasts\s*1/, key);
  assert.doesNotMatch(key, /Watch\s*1/, 'the forecast was counted as a reported Watch: ' + key);
  r.close();
});
