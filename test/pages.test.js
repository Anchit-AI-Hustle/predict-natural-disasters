'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');

// jsdom windows keep interval timers alive; without this the runner never exits.
test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

let EVENTS = null;
const events = async () => (EVENTS || (EVENTS = await sampleEvents()));

const pick = (list, fn) => {
  const hit = list.find(fn);
  assert.ok(hit, 'fixture feed has no matching record');
  return hit;
};
const q = id => '?id=' + encodeURIComponent(id);

/** Query strings that give each detail page a real subject to render. */
async function searchFor(page) {
  const evs = await events();
  const official = pick(evs, e => e.sourceType === 'official' && e.alert === 'Red');
  const outlook = pick(evs, e => e.forecast && e.id !== 'ND-001');
  return ({
    'event-detail.html': q(official.id),
    'alert-detail.html': q(official.id),
    'calamity-detail.html': q(official.id),
    'forecast-detail.html': q(outlook.id),
    'region-detail.html': '?region=Nepal',
    'location-detail.html': '?location=Nepal',
    'hazard-detail.html': '?type=Flood',
    'historical-event-detail.html': '?id=0',
    'source-detail.html': '?source=GDACS',
    'entity-detail.html': '?kind=insight&topic=flood-landslide',
    'verification-detail.html': '?id=ND-001'
  })[page] || '';
}

const settled = id => doc => {
  const n = doc.getElementById(id);
  return n && n.textContent.trim() && !/^(Loading|—)/.test(n.textContent.trim());
};
const enriched = doc => {
  const n = doc.getElementById('newsBody');
  return n && /Open coverage/.test(n.innerHTML);
};

/* ------------------------------------------ every page renders without error */

test('every page in the site renders with no uncaught JavaScript error', async () => {
  const failures = [];
  for (const page of PAGES) {
    const r = await renderPage(page, { search: await searchFor(page), timeoutMs: 2500, waitFor: () => false });
    if (r.errors.length) {
      failures.push(page + ': ' + r.errors.map(e => String((e && e.message) || e)).join(' | '));
    }
    assert.ok(r.text().length > 200, page + ' rendered almost no content');
    r.close();
  }
  assert.deepEqual(failures, [], 'pages with JavaScript errors:\n' + failures.join('\n'));
});

test('every detail page is reachable through a configured route', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const destinations = cfg.rewrites.map(r => r.destination.split('?')[0].replace(/^\//, ''));
  const detailPages = PAGES.filter(p => p.endsWith('-detail.html'));
  for (const p of detailPages) {
    assert.ok(destinations.includes(p), p + ' has no rewrite destination in vercel.json');
  }
});

/* ------------------------------------------------------- incident detail */

test('incident detail page fills in when, where and impact', async () => {
  const official = pick(await events(), e => e.sourceType === 'official' && e.alert === 'Red');
  const r = await renderPage('event-detail.html', { search: q(official.id), waitFor: settled('title') });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(doc.getElementById('title').textContent, official.title);
  assert.ok(doc.getElementById('recordId').textContent.includes(official.id));
  assert.match(doc.getElementById('startedAt').textContent, /\d{4}|not supplied/i);
  assert.notEqual(doc.getElementById('updated').textContent, '—');
  assert.ok(doc.getElementById('originText').textContent.length > 2);
  assert.ok(doc.getElementById('locationText').textContent.length > 2);
  assert.match(doc.getElementById('coords').textContent, /-?\d+\.\d+, -?\d+\.\d+/);
  assert.ok(doc.getElementById('contextCards').children.length >= 3, 'distress-group cards missing');
  assert.ok(doc.getElementById('timeline').textContent.length > 20);
  r.close();
});

test('incident detail page renders the full humanitarian context block', async () => {
  const official = pick(await events(), e => e.sourceType === 'official' && e.alert === 'Red');
  const r = await renderPage('event-detail.html', { search: q(official.id), waitFor: enriched });
  const doc = r.document, body = doc.body.innerHTML;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  // Each of the ten context panels must exist and be populated.
  for (const id of ['whenWhere', 'distress', 'news', 'reports', 'videos',
    'helplines', 'authorities', 'support', 'relief', 'directories']) {
    const n = doc.getElementById(id + 'Body');
    assert.ok(n, 'missing panel: ' + id);
    assert.ok(n.textContent.trim().length > 10, 'empty panel: ' + id);
    assert.ok(!/^Loading…$/.test(n.textContent.trim()), 'panel never loaded: ' + id);
  }

  // News with attribution and a working outbound link.
  assert.match(doc.getElementById('newsBody').innerHTML, /reuters\.com/);
  assert.match(doc.getElementById('newsBody').textContent, /Reuters/);
  assert.match(doc.getElementById('newsBody').textContent, /Established newsroom/);
  // Official situation reports.
  assert.match(doc.getElementById('reportsBody').innerHTML, /reliefweb\.int/);
  // Video reporting.
  assert.match(doc.getElementById('videosBody').innerHTML, /youtube\.com\/watch/);
  // Dialable helpline numbers.
  assert.match(doc.getElementById('helplinesBody').innerHTML, /href="tel:/);
  // Contact email addresses.
  assert.match(body, /mailto:secretariat@ifrc\.org/);
  // Real donation links on official domains.
  assert.match(doc.getElementById('reliefBody').innerHTML, /https:\/\/www\.ifrc\.org\/donate/);
  assert.match(doc.getElementById('reliefBody').innerHTML, /help\.unicef\.org/);
  // Local support groups.
  assert.match(doc.getElementById('supportBody').textContent, /Red Cross/i);
  // National authorities.
  assert.ok(doc.getElementById('authoritiesBody').querySelectorAll('a').length >= 2);
  // Distress groups and safety actions.
  assert.match(doc.getElementById('distressBody').textContent, /Distress \/ priority groups/);
  assert.match(doc.getElementById('distressBody').textContent, /Safety actions/);
  // When and where, including the reverse-geocoded place.
  assert.match(doc.getElementById('whenWhereBody').textContent, /Where it originated/);
  assert.match(doc.getElementById('whenWhereBody').textContent, /Resolved location/);
  // Source provenance.
  assert.match(doc.getElementById('directoriesBody').textContent, /Google News|ReliefWeb/);
  r.close();
});

test('alert detail page shows issuing agency, expiry and the context block', async () => {
  const official = pick(await events(), e => e.sourceType === 'official' && e.alert === 'Red');
  const r = await renderPage('alert-detail.html', { search: q(official.id), waitFor: enriched });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(doc.getElementById('title').textContent, official.title);
  assert.ok(doc.getElementById('agency').textContent.length > 2);
  assert.ok(doc.getElementById('expires').textContent.length > 2);
  assert.ok(doc.getElementById('startedAt').textContent.length > 2);
  assert.match(doc.getElementById('helplinesBody').innerHTML, /href="tel:/);
  assert.match(doc.getElementById('reliefBody').innerHTML, /donate|give-now/i);
  r.close();
});

test('calamity detail page shows impact figures and the context block', async () => {
  const official = pick(await events(), e => e.sourceType === 'official' && e.deaths > 0);
  const r = await renderPage('calamity-detail.html', { search: q(official.id), waitFor: enriched });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(doc.getElementById('title').textContent, official.title);
  assert.match(doc.getElementById('deaths').textContent, /\d/);
  assert.ok(doc.getElementById('startedAt').textContent.length > 2);
  assert.match(doc.getElementById('newsBody').textContent, /Reuters/);
  assert.match(doc.getElementById('helplinesBody').innerHTML, /href="tel:/);
  r.close();
});

/* -------------------------------------------------------- forecast detail */

test('every experimental outlook has a working detail page', async () => {
  const outlooks = (await events()).filter(e => e.forecast);
  assert.ok(outlooks.length >= 5, 'expected several outlooks, got ' + outlooks.length);
  for (const o of outlooks) {
    const r = await renderPage('forecast-detail.html', { search: q(o.id), waitFor: settled('title'), timeoutMs: 6000 });
    const doc = r.document;
    assert.equal(r.errors.length, 0, o.id + ': ' + r.errors.map(String).join('|'));
    assert.equal(doc.getElementById('title').textContent, o.title, 'wrong record resolved for ' + o.id);
    assert.equal(doc.getElementById('rid').textContent, o.id);
    assert.notEqual(doc.getElementById('forecastWindow').textContent, '—');
    assert.ok(doc.getElementById('confidence').textContent.length > 5, 'no confidence on ' + o.id);
    assert.ok(doc.getElementById('evidence').textContent.length > 10, 'no evidence on ' + o.id);
    assert.ok(doc.getElementById('rule').textContent.length > 10, 'no verification rule on ' + o.id);
    r.close();
  }
});

test('outlook detail pages withhold donation prompts but still show helplines', async () => {
  const outlook = pick(await events(), e => e.forecast && e.id !== 'ND-001' && e.country);
  const r = await renderPage('forecast-detail.html', { search: q(outlook.id), waitFor: enriched });
  const doc = r.document;
  assert.match(doc.getElementById('reliefBody').textContent, /withheld/i);
  assert.ok(doc.getElementById('helplinesBody').textContent.length > 20);
  assert.match(doc.getElementById('distressBody').textContent, /Immediate needs/);
  r.close();
});

/* ------------------------------------------------ place and hazard pages */

test('region, location and hazard pages carry support and relief context', async () => {
  for (const [page, search] of [
    ['region-detail.html', '?region=Nepal'],
    ['location-detail.html', '?location=Nepal'],
    ['hazard-detail.html', '?type=Flood&region=Nepal']
  ]) {
    const r = await renderPage(page, { search, waitFor: enriched, timeoutMs: 9000 });
    assert.equal(r.errors.length, 0, page + ': ' + r.errors.map(String).join('|'));
    const doc = r.document;
    assert.ok(doc.getElementById('helplinesBody'), page + ' has no helpline panel');
    assert.match(doc.getElementById('helplinesBody').innerHTML, /href="tel:/, page + ' has no dialable helpline');
    assert.match(doc.getElementById('reliefBody').innerHTML, /https:\/\//, page + ' has no relief links');
    assert.ok(doc.getElementById('newsBody').textContent.length > 20, page + ' has no news panel content');
    r.close();
  }
});

test('historical archive detail resolves a record and adds context', async () => {
  const r = await renderPage('historical-event-detail.html', { search: '?id=0', waitFor: enriched, timeoutMs: 9000 });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.doesNotMatch(doc.getElementById('title').textContent, /not found/i);
  assert.ok(doc.getElementById('summary').textContent.length > 20);
  assert.ok(doc.getElementById('newsBody').textContent.length > 20);
  r.close();
});

test('entity detail page renders its catalog entry', async () => {
  const r = await renderPage('entity-detail.html', {
    search: '?kind=insight&topic=flood-landslide', waitFor: settled('title')
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.match(r.document.getElementById('title').textContent, /Flood/);
  assert.ok(r.document.getElementById('main').textContent.length > 50);
  r.close();
});

/* ------------------------------------------------------- collection pages */

test('collection pages list records and link to detail pages', async () => {
  for (const page of ['events.html', 'recent-events.html', 'official-warnings.html',
    'hazard-types.html', 'forecast-list.html', 'historical-events.html', 'alerts-notifications.html']) {
    const r = await renderPage(page, { waitFor: doc => doc.getElementById('cards').children.length > 0 });
    assert.equal(r.errors.length, 0, page + ': ' + r.errors.map(String).join('|'));
    const cards = r.document.getElementById('cards');
    assert.ok(cards.children.length > 0, page + ' rendered no cards');
    const links = [...cards.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    assert.ok(links.length > 0, page + ' has no detail links');
    assert.ok(links.every(h => /^\/(disasters|alerts|forecasts|calamities|history)\//.test(h) || /^https?:/.test(h)),
      page + ' has a card link that is not a detail route: ' + links.slice(0, 3).join(', '));
    r.close();
  }
});

test('forecast list shows every outlook, not just the benchmark', async () => {
  const expected = (await events()).filter(e => e.forecast).length;
  const r = await renderPage('forecast-list.html', { waitFor: doc => doc.getElementById('cards').children.length > 1 });
  assert.equal(r.document.getElementById('cards').children.length, expected,
    'forecast list should show all ' + expected + ' forecast records');
  assert.match(r.document.getElementById('statusLine').textContent, /matching records/);
  r.close();
});

/* ------------------------------------------------- upstream outage behaviour */

test('detail pages stay usable when every upstream provider is down', async () => {
  const r = await renderPage('event-detail.html', {
    search: q('ND-001'), mock: { down: 'all' }, waitFor: settled('title'), timeoutMs: 9000
  });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.match(doc.getElementById('title').textContent, /Vietnam/);
  // Static verified context must still render with no network providers.
  assert.match(doc.getElementById('helplinesBody').textContent, /113|114|115|no verified/i);
  assert.ok(doc.getElementById('distressBody').textContent.length > 50);
  assert.match(doc.getElementById('newsBody').textContent, /No indexed coverage/);
  r.close();
});

/* ---------------------------------------- shadowed element ids regression */

test('no element id is shadowed by a built-in Window property', async () => {
  // `<span id="status">` plus `status.textContent = ...` silently writes to
  // window.status instead of the element, leaving the panel stuck on "Loading…".
  const probe = await renderPage('about.html', { timeoutMs: 200, waitFor: () => true });
  const reserved = new Set();
  for (let o = probe.window; o; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) reserved.add(k);
  }
  probe.close();

  const PROPS = 'textContent|innerHTML|value|style|href|src|checked|onclick|onchange|oninput|classList|dataset|disabled|selectedIndex|options';
  const shared = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'portal.js')
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const offenders = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const ids = [...new Set([...html.matchAll(/\bid="([A-Za-z_][\w-]*)"/g)].map(m => m[1]))];
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const js = inline + '\n' + shared;
    for (const id of ids) {
      if (!reserved.has(id)) continue;
      if (new RegExp('(^|[^\\w.$"\'`])' + id + '\\s*\\.(?:' + PROPS + ')').test(js)) {
        offenders.push(page + ' -> ' + id);
      }
    }
  }
  assert.deepEqual(offenders, [], 'element ids shadowed by Window properties:\n' + offenders.join('\n'));
});
