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

// Route coverage moved to routes.test.js: this test asserted that every detail
// page is named as a rewrite destination, which is what was wrong — cleanUrls
// serves them directly, and the rewrites that named them were dead in production.

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

/* ------------------------------------------------------------------ sorting */

// Pages that are static prose with no list of records to order. 404.html belongs
// here too: its only list is a fixed set of six places to go next.
const NO_LIST_PAGES = new Set(['about.html', 'insights.html', 'methodology.html', '404.html']);

test('every page that lists records offers a sort control', async () => {
  const missing = [];
  for (const page of PAGES) {
    if (NO_LIST_PAGES.has(page)) continue;
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    if (!/id="sortBy"/.test(html)) missing.push(page);
  }
  assert.deepEqual(missing, [], 'pages with a record list but no sort control:\n' + missing.join('\n'));
});

test('the sort control is populated with labelled options on every page', async () => {
  const empty = [];
  for (const page of PAGES) {
    if (NO_LIST_PAGES.has(page)) continue;
    const r = await renderPage(page, {
      search: await searchFor(page), timeoutMs: 4000,
      waitFor: doc => {
        const el = doc.getElementById('sortBy');
        return el && el.options && el.options.length > 1;
      }
    });
    const el = r.document.getElementById('sortBy');
    if (!el || !el.options || el.options.length < 2 || !el.options[0].textContent.trim()) {
      empty.push(page + ' (' + (el ? el.options.length + ' options' : 'control missing') + ')');
    } else {
      assert.ok(el.value, page + ': sort control has no selected value');
      assert.equal(r.errors.length, 0, page + ': ' + r.errors.map(String).join('|'));
    }
    r.close();
  }
  assert.deepEqual(empty, [], 'sort controls that never populated:\n' + empty.join('\n'));
});

/** Read the visible ordering of a rendered list container. */
const orderOf = (doc, id) =>
  [...doc.getElementById(id).querySelectorAll('h3, .event-title, td:nth-child(2)')]
    .map(n => n.textContent.trim()).filter(Boolean);

test('changing the sort reorders the list on a collection page', async () => {
  const r = await renderPage('events.html', {
    waitFor: doc => doc.getElementById('cards').children.length > 2 &&
      doc.getElementById('sortBy').options.length > 1
  });
  const doc = r.document, win = r.window;
  const bySeverity = orderOf(doc, 'cards');
  assert.ok(bySeverity.length > 2, 'not enough cards to compare orderings');

  const sel = doc.getElementById('sortBy');
  sel.value = 'title';
  sel.dispatchEvent(new win.Event('change'));
  const byTitle = orderOf(doc, 'cards');

  assert.equal(byTitle.length, bySeverity.length, 'sorting changed how many records are shown');
  assert.deepEqual([...byTitle].sort(), [...bySeverity].sort(), 'sorting changed which records are shown');
  const alphabetical = [...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual(byTitle, alphabetical, 'title sort did not produce A-Z order');
  assert.notDeepEqual(byTitle, bySeverity, 'the ordering did not actually change');
  r.close();
});

test('the chosen sort is remembered for next time', async () => {
  const r = await renderPage('events.html', {
    waitFor: doc => doc.getElementById('sortBy').options.length > 1
  });
  const sel = r.document.getElementById('sortBy');
  sel.value = 'newest';
  sel.dispatchEvent(new r.window.Event('change'));
  assert.equal(r.window.localStorage.getItem('pnd_sort_/events.html_sortBy'), 'newest');
  r.close();
});

test('a detail page can reorder its nearby-events list', async () => {
  const official = pick(await events(), e => e.sourceType === 'official' && e.alert === 'Red');
  const r = await renderPage('event-detail.html', {
    search: q(official.id),
    waitFor: doc => doc.getElementById('related').children.length > 1 &&
      doc.getElementById('sortBy').options.length > 1
  });
  const doc = r.document;
  const sel = doc.getElementById('sortBy');
  // Distance is the sensible default for a "nearby" list.
  assert.equal(sel.options[0].value, 'distance');
  const byDistance = orderOf(doc, 'related');
  sel.value = 'title';
  sel.dispatchEvent(new r.window.Event('change'));

  // This page re-runs its async load() on a sort change; let that settle before
  // reading the DOM, and before closing the window out from under it.
  const deadline = Date.now() + 5000;
  let byTitle = orderOf(doc, 'related');
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 80));
    byTitle = orderOf(doc, 'related');
    const alpha = [...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (byTitle.length && byTitle.join('|') === alpha.join('|')) break;
  }
  await new Promise(res => setTimeout(res, 150));

  assert.deepEqual([...byTitle].sort(), [...byDistance].sort(), 'reordering changed the record set');
  const alphabetical = [...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual(byTitle, alphabetical, 'nearby list did not reorder A-Z');
  r.close();
});

test('the homepage sorts without portal.js', async () => {
  // index.html is self-contained and carries its own sort implementation.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/src="\/portal\.js/.test(html), 'index.html now loads portal.js — use the shared helper instead');
  const r = await renderPage('index.html', {
    waitFor: doc => doc.getElementById('sortBy').options.length > 1 &&
      doc.getElementById('topEvents').children.length > 1
  });
  const doc = r.document, sel = doc.getElementById('sortBy');
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.ok(sel.options.length >= 8, 'homepage sort should offer the full option set');
  const before = orderOf(doc, 'topEvents');
  sel.value = 'title';
  sel.dispatchEvent(new r.window.Event('change'));
  const after = orderOf(doc, 'topEvents');
  // This panel shows the top N, so re-sorting legitimately changes which rows
  // appear — what must hold is that the rows shown are in the chosen order.
  assert.equal(after.length, before.length, 'row count changed');
  const alphabetical = [...after].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual(after, alphabetical, 'homepage title sort is not A-Z');
  assert.notDeepEqual(after, before, 'homepage ordering did not change');
  r.close();
});
