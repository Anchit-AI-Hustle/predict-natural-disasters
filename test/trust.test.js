'use strict';
/*
 * What a visitor is told before trusting a page (trust.js).
 *
 * A portfolio review found the site credible but unsafe to hand to a
 * stranger: the only "not an official warning" line was one sentence at the
 * very bottom, no page said which public data its forecasts were built from,
 * and two pages printed the visitor's own clock as "Last updated". These pin
 * the note, the sources it names and the time it shows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, callApi, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const head = f => read(f).split('</head>')[0];
const trustTag = f => (head(f).match(/<script src="\/trust\.js"[^>]*><\/script>/) || [''])[0];
const groupsOf = f => ((trustTag(f).match(/data-trust="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean);

/* trust.js, as a page sees it: its registry, without a document. */
function registry() {
  const sandbox = { window: { fetch: null }, document: { currentScript: null, readyState: 'loading', addEventListener() {} } };
  new Function('window', 'document', read('trust.js'))(sandbox.window, sandbox.document);
  return sandbox.window.PNDTrust;
}

test('every page loads the note in its head, before any script that could fetch', () => {
  const bad = [];
  for (const f of PAGES) {
    const h = head(f), tag = trustTag(f);
    if (!tag) { bad.push(f + ': no trust.js in <head>'); continue; }
    const first = h.search(/<script(?![^>]*type="application\/ld\+json")/);
    if (h.indexOf(tag) !== first) bad.push(f + ': trust.js is not the first script');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('a page built from the live feed says so, and names only groups trust.js knows', () => {
  const T = registry();
  const bad = [];
  for (const f of PAGES) {
    const g = groupsOf(f), src = read(f);
    g.forEach(x => { if (!T.SOURCES[x]) bad.push(f + ': unknown group ' + x); });
    const usesFeed = /getEvents|\/api\/events|collection\.js/.test(src.replace(/<script src="\/trust\.js"[^>]*>/, ''));
    const exempt = ['404.html', 'about.html', 'methodology.html', 'accuracy.html'];
    if (usesFeed && !exempt.includes(f) && !g.includes('feed')) bad.push(f + ': shows the live feed without naming it');
    if (/place-search\.js/.test(src) && !g.includes('place')) bad.push(f + ': searches places without naming the geocoder');
    if (!/place-search\.js/.test(src) && g.includes('place')) bad.push(f + ': names a geocoder it never calls');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every source named is one the code actually calls', () => {
  const T = registry();
  /* The hosts each group's code reaches, read from the code itself. */
  const hostsIn = files => new Set(files.flatMap(f => [...read(f).matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase())));
  const CODE = {
    feed: hostsIn(['api/events.js']),
    models: hostsIn(['tools/run-models.js', 'tools/build-climatology.js']),
    place: hostsIn(['place-search.js']),
    ledger: hostsIn(['tools/run-models.js', 'tools/backtest-models.js'])
  };
  const domain = h => h.split('.').slice(-2).join('.');
  const bad = [];
  for (const [group, list] of Object.entries(T.SOURCES)) {
    for (const s of list) {
      if (!/^https:/.test(s.url)) continue;   // a page of this site
      const host = new URL(s.url).hostname;
      const called = [...CODE[group]].some(h => h === host || domain(h) === domain(host) && (host.startsWith('www.') || h.endsWith('.' + domain(host))));
      if (!called) bad.push(group + ': ' + s.name + ' (' + host + ') is not called by that code');
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every provider the feed reads is listed, with its status read from the feed', () => {
  const T = registry();
  const keys = T.SOURCES.feed.filter(s => s.key).map(s => s.key).sort();
  const providers = [...read('api/events.js').matchAll(/^    (\w+): \{\n      label:/gm)].map(m => m[1]).sort();
  assert.deepEqual(keys, providers);
});

test('the time shown is the feed’s own, in the visitor’s zone, never the clock', async () => {
  const r = await renderPage('forecasts.html', {
    waitFor: d => d.querySelector('.trust-when time')
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  const note = d.querySelector('main > .trust');
  assert.ok(note, 'no note at the top of the page');
  assert.match(note.textContent, /Experimental model, not an official warning/);
  for (const name of ['IMD', 'NDMA', 'NWS', 'USGS', 'GDACS']) {
    assert.ok([...note.querySelectorAll('a')].some(a => a.textContent === name), name + ' is not linked in the note');
  }
  const feed = await (await callApi(require(path.join(ROOT, 'api', 'events.js')), '/api/events')).json();
  const times = [...d.querySelectorAll('.trust-when time')].map(t => t.getAttribute('datetime'));
  /* The feed's own generatedAt, to the second: a later test-side call
     differs by milliseconds, a page clock by much more on a real visit. */
  assert.ok(Math.abs(Date.parse(times[0]) - Date.parse(feed.generatedAt)) < 60000, 'not the feed time: ' + times[0]);
  assert.equal(times[1], feed.meta.modelRun && feed.meta.modelRun.at, 'the model run time is not the run’s own');
  assert.match(d.querySelector('.trust-when time').textContent, /[A-Z]{2,}|GMT|UTC/, 'the time zone is not named');
  const items = d.querySelectorAll('.trust-src li');
  assert.equal(items.length, registry().SOURCES.feed.length + registry().SOURCES.models.length);
  assert.ok(d.querySelector('.trust-src li .trust-ok, .trust-src li .trust-down'), 'no provider status from the feed');
});

test('when the feed does not answer, no time is invented', async () => {
  const r = await renderPage('forecasts.html', {
    feedDown: true,
    waitFor: d => /did not load/.test((d.querySelector('.trust-when') || {}).textContent || '')
  });
  const when = r.document.querySelector('.trust-when');
  assert.match(when.textContent, /did not load/);
  assert.equal(when.querySelectorAll('time').length, 0);
});

test('every footer names the official agencies, once', async () => {
  for (const page of ['about.html', 'alerts.html', 'index.html', 'live-map.html']) {
    const r = await renderPage(page, { waitFor: d => d.querySelector('.trust-foot') });
    const feet = r.document.querySelectorAll('.trust-foot');
    assert.equal(feet.length, 1, page + ': ' + feet.length + ' footers');
    const t = feet[0].textContent;
    assert.match(t, /experimental model, not an official warning service/i, page);
    for (const url of ['https://mausam.imd.gov.in/', 'https://ndma.gov.in/', 'https://www.weather.gov/', 'https://earthquake.usgs.gov/', 'https://www.gdacs.org/']) {
      assert.ok(feet[0].querySelector('a[href="' + url + '"]'), page + ': no link to ' + url);
    }
    const repeats = [...r.document.querySelectorAll('footer p, .seo-nav p')]
      .filter(p => !p.closest('.trust-foot') && /not an official warning service/i.test(p.textContent));
    assert.equal(repeats.length, 0, page + ': the old one-line disclaimer is still there too');
  }
});

test('a page with no prediction on it gets the footer and no note', async () => {
  const r = await renderPage('methodology.html', { waitFor: d => d.querySelector('.trust-foot') });
  assert.equal(r.document.querySelector('.trust'), null);
  assert.ok(r.document.querySelector('.trust-foot'));
});

test('a record’s page names its own address as canonical', async () => {
  const r = await renderPage('event-detail.html', { url: '/disasters/abc-123' });
  assert.equal(r.document.querySelector('link[rel="canonical"]').href,
    'https://predict-natural-disasters.anchit-tandon.com/disasters/abc-123');
  const q = await renderPage('forecast-detail.html', { search: '?id=F%201' });
  assert.equal(q.document.querySelector('link[rel="canonical"]').href,
    'https://predict-natural-disasters.anchit-tandon.com/forecasts/F%201');
});

test('every page has a title, a description, a preview image and a canonical address', () => {
  const bad = [];
  for (const f of PAGES) {
    const h = head(f);
    if (!/<title>[^<]{10,}<\/title>/.test(h)) bad.push(f + ': title');
    if (!/<meta name="description" content="[^"]{40,}">/.test(h)) bad.push(f + ': description');
    if (!/<meta property="og:image" content="https:\/\/[^"]+">/.test(h)) bad.push(f + ': og:image');
    if (!/<link rel="canonical" href="https:\/\/predict-natural-disasters\.anchit-tandon\.com\/[^"]*">/.test(h)) bad.push(f + ': canonical');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('no page shows its own clock as the time its data was updated', () => {
  const bad = [];
  for (const f of PAGES) {
    const s = read(f);
    for (const re of [/[Uu]pdated\.textContent\s*=\s*[^;]*new Date\(\)\.toLocale/, /mUpdated\.textContent\s*=\s*PND\.fmtDate\(new Date\(\)/]) {
      if (re.test(s)) bad.push(f + ' :: ' + re);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('a detail page’s ledger request is not taken for the feed it rendered', async () => {
  /* An id the feed does not carry sends forecast-detail on to ?ledger=1,
     whose answer has a generatedAt but no provider statuses. */
  const r = await renderPage('forecast-detail.html', {
    search: '?id=not-a-real-forecast',
    waitFor: d => d.querySelector('.trust-src li .trust-ok, .trust-src li .trust-down')
  });
  assert.ok(r.apiCalls.some(u => /ledger=1/.test(u)), 'the page did not ask for the ledger, so this tests nothing');
  assert.ok(r.document.querySelector('.trust-src li .trust-ok, .trust-src li .trust-down'), 'provider statuses were replaced by the ledger answer');
  assert.match(r.document.querySelector('.trust-when').textContent, /weather models run/);
});

test('when the track record does not load, the note says so rather than loading forever', async () => {
  const r = await renderPage('accuracy.html', {
    beforeParse(w) { const f = w.fetch; w.fetch = u => /\/data\//.test(String(u)) ? Promise.resolve({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) }) : f(u); },
    waitFor: d => /did not load/.test((d.querySelector('.trust-when') || {}).textContent || '')
  });
  assert.match(r.document.querySelector('.trust-when').textContent, /track record did not load/);
  assert.equal(r.document.querySelectorAll('.trust-when time').length, 0);
});

test('the note is in every page’s HTML, identical to what trust.js draws, so nothing moves when it loads', () => {
  const { update, registry: reg } = require(path.join(ROOT, 'tools', 'trust-markup.js'));
  const T = reg();
  const stale = PAGES.filter(f => update(f, T) !== read(f));
  assert.deepEqual(stale, [], 'run node tools/trust-markup.js: ' + stale.join(', '));
  for (const f of PAGES) {
    assert.match(head(f), /<link rel="stylesheet" href="\/trust\.css"><script src="\/trust\.js"/, f + ': trust.css must load with the script');
    const html = read(f), hasNote = /<aside class="trust"/.test(html);
    assert.equal(hasNote, groupsOf(f).length > 0, f + (hasNote ? ': a note on a page with no prediction' : ': no note in the HTML'));
  }
  assert.doesNotMatch(read('trust.js'), /createElement\('style'\)/, 'the note’s styles belong in trust.css, before first paint');
});

test('the track record’s files are not read a second time for the note', () => {
  /* Only the feed is watched: the ledgers are 5 MB, and the page hands
     over their time itself. */
  assert.doesNotMatch(read('trust.js'), /isData|state\.files/);
  assert.match(read('accuracy.html'), /PNDTrust\.recorded\(/);
});
