#!/usr/bin/env node
'use strict';
/**
 * Can every page be reached, read and operated?
 *
 * Three questions the offline suite cannot answer, because each needs a real
 * browser: does every link in the navigation actually resolve; does every
 * control have a name a screen reader can announce; and can the page be
 * operated from the keyboard at all.
 *
 * jsdom renders the markup but the navigation is written by portal.js at run
 * time, focus styles come from :focus-visible, and an accessible name is
 * computed from several sources at once. So this measures the rendered page
 * in Chromium, the same way tools/layout-browser-check.js measures overflow.
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/a11y-nav-check.js
 *
 * CHROMIUM overrides the executable, PAGES the pages. Exits non-zero if any
 * check fails, naming the page and the element.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.SITE_ROOT || process.cwd();
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const PAGES = (process.env.PAGES ||
  '/,/alerts,/live-map,/forecasts,/personal-risk,/accuracy,/events,/regions,/methodology,/about,/insights,/calamities,/dashboard,/hazard-types,/official-warnings,/resources,/historical-events,/compare-locations,/forecast-calendar,/alerts-notifications,/recent-events'
).split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8191);

/* The deployed routing, read from vercel.json rather than restated here.
 *
 * /alerts/<id> is not a file: production rewrites it to /alert-detail?id=<id>.
 * A checker that does not apply the rewrites reports every detail link on the
 * site as broken, which is both wrong and useless. Reading the real config
 * also means this check fails if a rewrite is ever removed while links to it
 * remain. */
const REWRITES = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || [])
  .map(r => {
    const names = [];
    const pattern = r.source.replace(/:([A-Za-z0-9_]+)/g, (m, n) => { names.push(n); return '([^/]+)'; });
    return { re: new RegExp('^' + pattern + '$'), names: names, destination: r.destination };
  });

function applyRewrites(pathname) {
  for (const r of REWRITES) {
    const m = pathname.match(r.re);
    if (!m) continue;
    let dest = r.destination;
    r.names.forEach((n, i) => { dest = dest.split(':' + n).join(m[i + 1]); });
    return dest;
  }
  return pathname;
}

const served = new Set();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = {};
    const fake = { status() { return fake; }, setHeader() {}, json(b) { out.b = b; }, end() {} };
    try {
      const mod = p === '/api/events' ? eventsHandler
        : require(path.join(ROOT, 'api', p.replace('/api/', '') + '.js'));
      await mod({ query: Object.fromEntries(url.searchParams), url: req.url, method: 'GET', headers: {} }, fake);
    } catch (e) { out.b = { events: [], meta: {} }; }
    finally { global.fetch = realFetch; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.b || { events: [], meta: {} }));
    return;
  }
  if (p === '/') p = '/index.html';
  /* Rewrites first, and regardless of what the last path segment looks like:
     an NWS identifier is urn:oid:2.49.0.1.840.0.aaa, whose tail reads as a
     file extension and is not one. Testing for an extension before rewriting
     reported every NWS alert link on the site as broken. */
  p = applyRewrites(p).split('?')[0];
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not here'); return; }
  served.add(p);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/* Runs inside the page. Everything it reports is measured from the rendered
   DOM, never from the source. */
function audit() {
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const name = el => {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
      if (parts.length) return parts.map(text).join(' ');
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && text(lab)) return text(lab);
    }
    const wrap = el.closest('label');
    if (wrap && text(wrap)) return text(wrap);
    const ttl = el.getAttribute('title');
    if (ttl && ttl.trim()) return ttl.trim();
    /* A form control is not named by what is inside it. A <select> contains
       its options and an <input> may carry a placeholder; neither is an
       accessible name, and treating them as one reported every unlabelled
       filter on the site as fine. */
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return null;
    return text(el) || null;
  };
  const where = el => el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') +
    (el.getAttribute('href') ? ' [' + el.getAttribute('href') + ']' : '');

  const out = { links: [], problems: [] };
  const add = (kind, detail) => out.problems.push({ kind: kind, detail: detail });

  if (!document.documentElement.lang) add('lang', '<html> has no lang');
  if (!document.title.trim()) add('title', 'the page has no title');
  const h1 = document.querySelectorAll('h1');
  if (h1.length !== 1) add('h1', h1.length + ' <h1> elements');
  if (!document.querySelector('main')) add('landmark', 'no <main> landmark');

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return;
    out.links.push(href.split('?')[0].split('#')[0]);
    if (!name(a)) add('unnamed-link', where(a));
  });
  document.querySelectorAll('button').forEach(b => { if (!name(b)) add('unnamed-button', where(b)); });
  document.querySelectorAll('input,select,textarea').forEach(c => {
    if (c.type === 'hidden') return;
    if (!name(c)) add('unnamed-control', where(c) + (c.getAttribute('placeholder') ? ' (placeholder only)' : ''));
  });
  document.querySelectorAll('img').forEach(i => {
    if (i.getAttribute('aria-hidden') === 'true') return;
    if (i.getAttribute('alt') === null) add('img-no-alt', where(i));
  });
  document.querySelectorAll('[tabindex]').forEach(el => {
    if (Number(el.getAttribute('tabindex')) > 0) add('tabindex', where(el) + ' tabindex=' + el.getAttribute('tabindex'));
  });
  out.links = [...new Set(out.links)];
  return out;
}

/* A detail page needs a real record to be a page at all, so the ids come from
   the feed rather than from a list here that would go stale. Without this the
   sweep covers the 21 index pages and none of the 17 detail templates behind
   them, which is where most of the site's text actually is. */
function detailPages(feed) {
  const ev = (feed.events || []);
  const pick = f => (ev.find(f) || {}).id;
  const observed = pick(e => !e.forecast);
  const forecast = pick(e => e.forecast);
  const warning = pick(e => e.evidenceState === 'official-warning');
  const withPlace = ev.find(e => e.country);
  const out = [];
  if (observed) out.push('/disasters/' + encodeURIComponent(observed), '/calamities/' + encodeURIComponent(observed));
  if (warning || observed) out.push('/alerts/' + encodeURIComponent(warning || observed));
  if (forecast) out.push('/forecasts/' + encodeURIComponent(forecast));
  if (withPlace) out.push('/regions/' + encodeURIComponent(withPlace.country),
    '/locations/' + encodeURIComponent(withPlace.country),
    '/hazards/' + encodeURIComponent(withPlace.type || 'Earthquake'));
  out.push('/sources/' + encodeURIComponent('USGS'), '/verification', '/directory',
    '/forecast-list', '/entity-detail', '/404');
  return out;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  if (!process.env.PAGES) {
    const feed = await new Promise(res => {
      http.get('http://localhost:' + PORT + '/api/events', r => {
        let b = ''; r.on('data', d => { b += d; }); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res({}); } });
      }).on('error', () => res({}));
    });
    for (const p of detailPages(feed)) if (!PAGES.includes(p)) PAGES.push(p);
  }
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));
  const base = 'http://localhost:' + PORT;
  const titles = new Map();
  let failures = 0, checked = 0;
  const linkCache = new Map();

  const resolves = async href => {
    if (linkCache.has(href)) return linkCache.get(href);
    const ok = await new Promise(res => {
      http.get(base + href, r => { r.resume(); res(r.statusCode === 200); })
        .on('error', () => res(false));
    });
    linkCache.set(href, ok);
    return ok;
  };

  for (const page of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => localStorage.setItem('pnd_tour_done', '1'));
    const pageErrors = [];
    pg.on('pageerror', e => pageErrors.push(String(e)));
    try { await pg.goto(base + page, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch (e) { pageErrors.push('navigation: ' + e.message); }
    await pg.waitForTimeout(900);

    const r = await pg.evaluate(audit);
    const problems = r.problems.slice();
    for (const e of pageErrors) problems.push({ kind: 'script-error', detail: e });

    const title = await pg.title();
    if (titles.has(title)) problems.push({ kind: 'duplicate-title', detail: 'same <title> as ' + titles.get(title) });
    else titles.set(title, page);

    for (const href of r.links) {
      if (!await resolves(href)) problems.push({ kind: 'broken-link', detail: href });
    }

    /* Keyboard: the first Tab must land on something visible, and the focused
       element must be visibly marked. A focus ring nobody can see is the same
       as no focus ring. */
    const focus = await pg.evaluate(() => {
      const first = document.querySelector('a[href],button,input,select,textarea,[tabindex="0"]');
      if (!first) return { none: true };
      first.focus();
      const el = document.activeElement;
      if (el !== first) return { unfocusable: first.tagName };
      const cs = getComputedStyle(el);
      const marked = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        cs.boxShadow !== 'none' || cs.textDecorationLine !== 'none';
      return { marked: marked, what: el.tagName + (el.className ? '.' + String(el.className).split(/\s+/)[0] : '') };
    });
    if (focus.none) problems.push({ kind: 'keyboard', detail: 'no focusable element on the page' });
    else if (focus.unfocusable) problems.push({ kind: 'keyboard', detail: focus.unfocusable + ' cannot take focus' });
    else if (!focus.marked) problems.push({ kind: 'focus-invisible', detail: focus.what + ' shows nothing when focused' });

    checked++;
    if (problems.length) {
      failures++;
      console.log('FAIL ' + page);
      for (const p of problems) console.log('       ' + p.kind + ': ' + p.detail);
    } else {
      console.log('  ok ' + page);
    }
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\npages checked: ' + checked + ', failing: ' + failures);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
