'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { renderPage, sampleEvents, closeAllWindows } = require('./render.js');
// Titles are displayed with acronyms written out, so expected strings go
// through the same rules rather than being hand-maintained copies of them.
const { expandAlways } = require('../glossary.js');

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

test('the action panel answers all seven questions, and names whose claim it is', async () => {
  /* The panel named the hazard, the place, the severity and the confidence,
     and left the last question - whose claim is this, and in what voice - to
     a provenance paragraph at the foot of the page. A reader deciding whether
     to act needs the agency AND what kind of statement it is: an observation
     of something that happened, a warning that something is expected, or an
     outlook this site derived. Those three carry very different weight. */
  const official = pick(await events(), e => e.sourceType === 'official' && e.alert === 'Red');
  const r = await renderPage('event-detail.html', { search: q(official.id), waitFor: settled('title') });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const panel = doc.getElementById('actionPanel');
  assert.ok(panel, 'the action panel is gone');
  for (const [id, what] of [['aWhat', 'what is happening'], ['aWhere', 'where'],
    ['aSeverity', 'how serious'], ['aConfidence', 'how confident'],
    ['aWho', 'who says this'], ['actionUpdated', 'when updated']]) {
    const el = doc.getElementById(id);
    assert.ok(el, 'the panel does not answer ' + what);
    assert.ok(el.textContent.trim().length > 1 && el.textContent.trim() !== '\u2014',
      'the panel leaves "' + what + '" unanswered: ' + JSON.stringify(el.textContent));
  }
  assert.ok(doc.getElementById('actionSteps').textContent.length > 20,
    'the panel does not say what to do');
  assert.ok(doc.getElementById('aWho').textContent.includes(official.source),
    'the panel does not name the agency behind the record');
  assert.match(doc.getElementById('aWho').textContent,
    /observed event|official warning|derived by this site|not established/,
    'the panel names a source without saying what kind of statement it is');
  /* And the authoritative link is still offered. */
  assert.ok(doc.getElementById('officialAction').textContent.length > 10);
  r.close();
});

test('the life-safety instruction is shown on a life-safety record and not on every one', async () => {
  /* The spec asks for one sentence, prominently, on life-safety events. Shown
     on every record it becomes furniture a reader learns to skip, which costs
     exactly the page where it matters. */
  const evs = await events();
  const serious = pick(evs, e => !e.forecast && e.alert === 'Red');
  const hot = await renderPage('event-detail.html', { search: q(serious.id), waitFor: settled('title') });
  const line = hot.document.getElementById('lifeSafety');
  assert.ok(line, 'the life-safety instruction is not on the page at all');
  assert.equal(line.hidden, false,
    'a red-level record does not carry the life-safety instruction');
  assert.equal(line.textContent.trim(),
    'Follow instructions from the issuing authority and local emergency services.');
  assert.equal(line.getAttribute('role'), 'note');

  /* Once, not once plus two standing copies. The panel closed with the same
     instruction on every record and the Safety Context aside repeated it, so
     hiding the conditional one changed nothing a reader could see: a quiet
     record still carried the sentence twice, and a serious one carried it
     three times. */
  /* Counted on what a reader can see: jsdom has no layout, but a hidden
     attribute is in the markup, and textContent includes hidden nodes. */
  const seen = doc => {
    const copy = doc.body.cloneNode(true);
    copy.querySelectorAll('[hidden]').forEach(n => n.remove());
    return (copy.textContent.match(/(?:follow|Follow) (?:instructions from|the instructions of|the issuing authority)[^.]*issuing authority[^.]*emergency services|Follow instructions from the issuing authority and local emergency services/g) || []).length;
  };
  assert.equal(seen(hot.document), 1,
    'the life-safety instruction appears ' + seen(hot.document) + ' times on one record');

  hot.close();

  const quiet = evs.find(e => !e.forecast && e.alert === 'Green' &&
    e.evidenceState !== 'official-warning');
  assert.ok(quiet, 'fixture: the feed should carry a quiet informational record');
  const cool = await renderPage('event-detail.html', { search: q(quiet.id), waitFor: settled('title') });
  assert.equal(cool.document.getElementById('lifeSafety').hidden, true,
    'an informational green record carries a life-safety instruction');
  assert.equal(seen(cool.document), 0,
    'a quiet record still carries the life-safety instruction somewhere else on the page');
  /* What it does still say is what this page is, which is a different claim. */
  assert.match(cool.document.body.textContent, /not an instruction issued by any authority/,
    'the page no longer says that it is situational awareness rather than an instruction');
  cool.close();
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
    // The page writes acronyms out, so compare against the same transform
    // rather than against the raw feed title.
    assert.equal(doc.getElementById('title').textContent, expandAlways(o.title),
      'wrong record resolved for ' + o.id);
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
  /* One row per outlook. The list is a table now - thirty cards of the same
     shape is not a list anyone compares - so the count is of rows. */
  const r = await renderPage('forecast-list.html',
    { waitFor: doc => doc.querySelectorAll('#cards tbody tr').length > 1 });
  assert.equal(r.document.querySelectorAll('#cards tbody tr').length, expected,
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
  // Acronyms are written out asynchronously by the glossary pass, so the two
  // readings can straddle it. Normalising both sides makes the comparison
  // about ordering, which is what this test is for.
  assert.deepEqual([...byTitle].map(expandAlways).sort(), [...bySeverity].map(expandAlways).sort(),
    'sorting changed which records are shown');
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
  // Every list opens on the newest record; distance stays available here.
  assert.equal(sel.options[0].value, 'newest');
  assert.ok([...sel.options].some(o => o.value === 'distance'), 'distance is no longer offered');
  sel.value = 'distance';
  sel.dispatchEvent(new r.window.Event('change'));
  await new Promise(res => setTimeout(res, 300));
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

test('the homepage lists every outlook, not a hardcoded one', async () => {
  // The panel shipped with a single static ND-001 row and a KPI hardcoded to "1",
  // so the homepage claimed one upcoming forecast however many the feed carried.
  // The tile reads "Active Forecasts", so a frozen benchmark whose window has
  // already closed does not belong in it.
  const forecasts = (await events()).filter(e => e.forecast && !e.windowClosed);
  assert.ok(forecasts.length > 1, 'fixture feed needs several outlooks to make this meaningful');

  const r = await renderPage('index.html', {
    waitFor: doc => doc.getElementById('forecastRows').children.length > 0
  });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  assert.equal(doc.getElementById('kForecasts').textContent, String(forecasts.length),
    'the KPI does not match the number of outlooks in the feed');

  const rows = [...doc.getElementById('forecastRows').querySelectorAll('tr')];
  assert.ok(rows.length > 1, 'only ' + rows.length + ' forecast row rendered');
  assert.equal(rows.length, Math.min(6, forecasts.length));
  // Each row must open its own outlook, not a fixed record.
  const targets = rows.map(tr => (tr.getAttribute('onclick') || '').match(/GO\('([^']+)'\)/)?.[1]);
  assert.ok(targets.every(Boolean), 'a forecast row has no destination');
  assert.equal(new Set(targets).size, targets.length, 'forecast rows point at the same record');
  assert.ok(targets.every(t => t.startsWith('/forecasts/')), 'a row does not open an outlook page');
  r.close();
});

test('the homepage carries its own sort implementation', async () => {
  // The homepage renders its list before anything else has to load, so its
  // ordering is implemented inline rather than deferred to a shared helper.
  // It does load portal.js for the first-run tour; what must not come back is
  // the sort depending on it.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /const SORTS=\{/, 'index.html no longer defines its own sort table');
  assert.ok(!/PND\.(initSort|sortBy|sortValue|applySort)\b/.test(html),
    'index.html now sorts through portal.js — keep the homepage list self-contained');
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

/* --------------------------------------------- insights carries no fiction */

test('the insights page reports the live feed, not hardcoded figures', async () => {
  const evs = await events();
  const live = evs.filter(e => !e.forecast);
  const forecasts = evs.filter(e => e.forecast);

  const r = await renderPage('insights.html', { waitFor: settled('iEvents') });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  assert.equal(doc.getElementById('iEvents').textContent, String(evs.length),
    'the event count does not match the feed');
  assert.equal(doc.getElementById('iForecasts').textContent, String(forecasts.length),
    'the outlook count does not match the feed');

  // The top hazard class must be the one the feed actually reports most.
  const byType = {};
  for (const e of live) byType[e.type || 'Other'] = (byType[e.type || 'Other'] || 0) + 1;
  const ranked = Object.keys(byType).sort((a, b) => byType[b] - byType[a] || a.localeCompare(b));
  assert.equal(doc.getElementById('iTopHazard').textContent, expandAlways(ranked[0]),
    'the headline hazard class is not the most reported one');

  const dist = doc.getElementById('hazardDist');
  const names = [...dist.querySelectorAll('.metric')].map(m => m.firstElementChild.textContent);
  assert.ok(names.length > 1, 'the hazard distribution rendered ' + names.length + ' rows');
  assert.deepEqual(names, ranked.slice(0, names.length).map(expandAlways),
    'the distribution is not ordered by how much the feed reports');
  assert.equal(dist.querySelectorAll('.bar').length, names.length, 'a hazard row has no bar');

  // Bars are relative to the largest class, so the leader is always full width.
  assert.match(dist.querySelector('.bar i').getAttribute('style'), /width:100%/);
  r.close();
});

test('the insights page states that it has no data rather than inventing some', async () => {
  const r = await renderPage('insights.html', {
    feedDown: true, waitFor: settled('iEvents')
  });
  const doc = r.document;
  const text = doc.getElementById('hazardDist').textContent;
  assert.match(doc.getElementById('iEvents').textContent, /Unavailable/);
  assert.match(text, /could not be reached/);
  assert.ok(!/\d+\s*(record|countr)/i.test(text), 'a figure survived a dead feed: ' + text);
  r.close();
});

test('no page ships a figure that looks live but is written into the markup', () => {
  // insights.html shipped "96 visible events" and five "N regions" bars as
  // literals; they were wrong the moment the feed moved.
  const offenders = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    const re = /\b\d[\d,]*\s*(regions?|countries|events|records|alerts|forecasts|sources)\b/gi;
    for (const m of body.matchAll(re)) offenders.push(page + ': "' + m[0] + '"');
  }
  assert.deepEqual(offenders, [], 'static figures presented as live data:\n' + offenders.join('\n'));
});

test('every homepage headline figure is measured, not written into the page', async () => {
  // "195 Countries Monitored" was a literal sitting in a row of live counters,
  // and the outlook counter shipped a literal 1.
  const evs = await events();
  const r = await renderPage('index.html', { waitFor: settled('kCountries') });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  const countries = new Set(evs.map(e => e.country).filter(Boolean));
  assert.ok(countries.size > 1, 'fixture feed needs several countries');
  assert.equal(doc.getElementById('kCountries').textContent, String(countries.size));
  assert.equal(doc.getElementById('kEvents').textContent, String(evs.length));

  // The headline count is mostly routine detections, so the note beside it
  // breaks the total down by severity rather than describing where it came
  // from. Both halves have to be countable in the feed.
  const note = doc.getElementById('kEventsNote').textContent;
  const bad = evs.filter(e => e.severityRank >= 4).length;
  const routine = evs.filter(e => e.severityRank === 1).length;
  assert.equal(note, `${bad} severe or worse · ${routine} routine detections`);

  // Filtering the page must move the counters with it, and say that it did.
  const filter = doc.getElementById('hazardFilter');
  const flood = [...filter.options].find(o => /flood/i.test(o.value));
  assert.ok(flood, 'hazard filter offers no flood option');
  filter.value = flood.value;
  filter.dispatchEvent(new r.window.Event('change'));

  const shown = Number(doc.getElementById('kEvents').textContent);
  assert.ok(shown > 0 && shown < evs.length, 'the filter did not narrow the feed: ' + shown);

  // The note tracks the filter too — the split is of what is on screen now.
  const inView = evs.filter(e => String(e.type).toLowerCase().includes(flood.value.toLowerCase()));
  const badIn = inView.filter(e => e.severityRank >= 4).length;
  const routineIn = inView.filter(e => e.severityRank === 1).length;
  assert.equal(doc.getElementById('kEventsNote').textContent,
    badIn || routineIn
      ? `${badIn} severe or worse · ${routineIn} routine detections`
      : 'Matching the current hazard filter');
  assert.ok(Number(doc.getElementById('kCountries').textContent) <= countries.size);
  r.close();
});

/* ------------------------------------- forecasts laid out as time, not cards */

test('the forecast calendar is a calendar, not the same card grid renamed', async () => {
  // The page promised a calendar and rendered collection.js's generic grid,
  // filtered to forecasts. A forecast is a window in time and the grid could
  // not show one: every card read "starts just now".
  const outlooks = (await events()).filter(e => e.forecast);
  assert.ok(outlooks.length > 3, 'fixture feed needs several outlooks');

  const r = await renderPage('forecast-calendar.html', {
    waitFor: doc => doc.querySelectorAll('.tl-bar').length > 0
  });
  const doc = r.document;
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));

  const bars = [...doc.querySelectorAll('.tl-bar')];
  assert.equal(bars.length, outlooks.length, 'not every outlook has a bar');
  assert.equal(doc.querySelectorAll('.tl-day.is-today').length, 1, 'today is not marked exactly once');
  assert.ok(doc.querySelector('.tl-now'), 'nothing marks where now is');

  // A bar must span its own window, not a uniform block.
  const spans = bars.map(b => parseFloat(b.style.width));
  assert.ok(spans.every(w => w > 0 && w <= 100), 'a bar runs outside the axis');
  assert.ok(new Set(spans.map(w => w.toFixed(1))).size > 1,
    'every bar is the same width, so the window is not being drawn');
  assert.ok(bars.every(b => parseFloat(b.style.left) + parseFloat(b.style.width) <= 100.5),
    'a bar extends past the end of the axis');

  // Each bar opens its own outlook.
  const hrefs = bars.map(b => b.getAttribute('href'));
  assert.ok(hrefs.every(h => h && h.startsWith('/forecasts/')), 'a bar does not open an outlook');
  assert.equal(new Set(hrefs).size, hrefs.length, 'bars point at the same record');

  // Hazards are grouped, so the axis stays readable.
  const groups = [...doc.querySelectorAll('.tl-group-name')].map(n => n.textContent);
  assert.ok(groups.length > 1, 'outlooks are not grouped by hazard');
  assert.equal(new Set(groups).size, groups.length, 'a hazard is grouped twice');
  r.close();
});

test('the calendar escapes the card grid it used to live in', async () => {
  // #cards is an auto-fill grid; left alone, the whole timeline lands in one
  // narrow column with the footnote beside it.
  const r = await renderPage('forecast-calendar.html', {
    waitFor: doc => doc.querySelectorAll('.tl-bar').length > 0
  });
  const cards = r.document.getElementById('cards');
  assert.ok(!cards.classList.contains('event-grid'),
    'the timeline is still being laid out as a grid cell');
  r.close();
});

test('the shared disclaimer is stated once, not on every card', async () => {
  // It rides on 24 of 30 outlooks, so repeating it per card spent a third of
  // each one saying what is true of all of them.
  const r = await renderPage('forecast-list.html', {
    waitFor: doc => doc.querySelectorAll('.event-card').length > 0
  });
  const doc = r.document;
  // The cards said "not a deterministic prediction", the page note says
  // "not deterministic predictions"; match the claim, not the wording.
  const phrase = /deterministic prediction/i;
  const repeats = [...doc.querySelectorAll('.event-card')].filter(c => phrase.test(c.textContent));
  assert.equal(repeats.length, 0, repeats.length + ' cards still repeat the disclaimer');

  const note = doc.getElementById('forecastNote');
  assert.ok(note, 'the disclaimer is gone from the cards but stated nowhere');
  assert.match(note.textContent, phrase, 'the page-level note does not carry it');

  // The part that actually differs must survive the trim.
  const bodies = [...doc.querySelectorAll('.event-card p')].map(p => p.textContent.trim());
  assert.ok(bodies.every(b => b.length > 20), 'a card body was trimmed to nothing');
  r.close();
});

test('an event card states its figures once', async () => {
  /* Found reviewing the report that the app is cluttered: each card printed
     the key-facts line - "Lives lost 42 · People displaced 5,100 ..." - and
     then the same three numbers again as "42 deaths · 5,100 displaced ...",
     and a storm's prose repeated its wind and pressure a third time. */
  const r = await renderPage('events.html', { waitFor: d => d.querySelectorAll('.event-card').length > 3, timeoutMs: 8000 });
  const cards = [...r.document.querySelectorAll('.event-card')].map(c => c.textContent);
  assert.ok(cards.length > 3, 'fixture: the events page rendered no cards');
  const doubled = cards.filter(t => /Lives lost [\d,]+/.test(t) && /[\d,]+ deaths/.test(t));
  assert.deepEqual(doubled.map(t => t.slice(0, 60)), [], 'a card states its death toll twice');
  const storm = cards.find(t => /Maximum sustained wind/.test(t));
  if (storm) {
    assert.equal((storm.match(/sustained wind/gi) || []).length, 1, 'a storm card states its wind twice: ' + storm);
  }
  r.close();
});

test('Personal Risk says when it was updated and shows no empty warning box', async () => {
  /* From a screenshot of the live page: "Updated unknown" - the page read
     meta.generatedAt, which the API has never set; it publishes generatedAt at
     the top level - and an empty amber bar, a message box set to '' and left
     with its border and padding. */
  const r = await renderPage('personal-risk.html', { waitFor: settled('fresh'), timeoutMs: 8000 });
  assert.doesNotMatch(r.document.getElementById('fresh').textContent, /unknown/i,
    'Personal Risk cannot say when its data was updated');
  r.close();
  for (const css of ['portal.css', 'app-pages.css']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', css), 'utf8'), /\.notice:empty,\.stale:empty\{display:none\}/,
      css + ' draws an empty message box');
  }
});
