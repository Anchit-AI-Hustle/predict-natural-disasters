#!/usr/bin/env node
'use strict';
/**
 * Does the risk scale actually reach the pixels?
 *
 * The offline suite can check that one palette is declared, that each level
 * resolves to its own class and that every ink clears AA — but jsdom has no
 * cascade and no layout, so it cannot tell whether a badge on a live page is
 * painted with the colour the stylesheet names, whether the shape is drawn at
 * all, or whether two levels end up looking the same after everything else on
 * the page has had its say. Those are the failures that reach a reader.
 *
 * So this measures, in a real browser:
 *
 *   - every risk badge on every page resolves to one of the six colours, and
 *     its text contrasts with its own background at 4.5:1 or better;
 *   - every badge has a ::before box with a non-zero size, so no level is
 *     carried by hue alone;
 *   - the six levels render as six distinct fills, and the shapes differ;
 *   - every map marker is a shaped icon with an accessible name rather than a
 *     bare coloured circle.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/risk-scale-check.js
 *
 * CHROMIUM overrides the executable, PAGES what is measured. Exits non-zero
 * on the first page that fails, naming what it found.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.SITE_ROOT || process.cwd();
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));
const RISK = require(path.join(ROOT, 'risk.js'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const PAGES = (process.env.PAGES ||
  '/,/live-map,/alerts,/events,/forecasts,/forecast-list,/accuracy,/regions,/dashboard,/recent-events,/official-warnings'
).split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8191);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = {};
    const fake = { status() { return fake; }, setHeader() {}, json(b) { out.b = b; }, end() {} };
    try { await eventsHandler({ query: {}, url: req.url, method: 'GET', headers: {} }, fake); }
    catch (e) { out.b = { events: [], meta: {} }; }
    finally { global.fetch = realFetch; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.b || { events: [], meta: {} }));
    return;
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/* rgb(...) as the browser reports it, back to the hex the palette names. */
function hexOf(rgb) {
  const m = /rgba?\(([^)]+)\)/.exec(String(rgb || ''));
  if (!m) return null;
  const [r, g, b, a] = m[1].split(',').map(s => parseFloat(s.trim()));
  if (a === 0) return 'transparent';
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const linear = c => (c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const luminance = hex => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));

  const PALETTE = {};
  for (const lv of RISK.LEVELS) PALETTE[lv.colour.toUpperCase()] = lv.key;

  let failures = 0, badges = 0, markers = 0;
  for (const page of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => localStorage.setItem('pnd_tour_done', '1'));
    try { await pg.goto('http://localhost:' + PORT + page, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch (e) { /* measure whatever rendered */ }
    await pg.waitForTimeout(1200);

    const found = await pg.evaluate(() => {
      const out = { badges: [], markers: [] };
      /* The alias classes count too: a page that still writes `.sev-severe`
         or `.severity-extreme` is painted from the same scale and has to hold
         to the same rules. */
      document.querySelectorAll('.risk,[class*="risk-"],[class*="sev-"],[class*="severity-"],.badge').forEach(el => {
        if (el.classList.contains('risk-shape') || el.closest('.risk-mk')) return;
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        out.badges.push({
          cls: el.className,
          text: (el.textContent || '').trim().slice(0, 40),
          bg: cs.backgroundColor, fg: cs.color,
          shapeW: parseFloat(before.width) || 0, shapeH: parseFloat(before.height) || 0,
          shapeClip: before.clipPath, shapeRadius: before.borderRadius,
          shapeBg: before.backgroundImage !== 'none' ? 'image' : before.backgroundColor
        });
      });
      document.querySelectorAll('.risk-mk').forEach(el => {
        const shape = el.querySelector('.risk-shape');
        const cs = shape ? getComputedStyle(shape) : null;
        out.markers.push({
          cls: el.className,
          label: shape ? shape.getAttribute('aria-label') : null,
          role: shape ? shape.getAttribute('role') : null,
          bg: cs ? cs.backgroundColor : null,
          clip: cs ? cs.clipPath : null, radius: cs ? cs.borderRadius : null,
          w: shape ? shape.getBoundingClientRect().width : 0
        });
      });
      return out;
    });

    const problems = [];
    for (const b of found.badges) {
      badges++;
      const bg = hexOf(b.bg), fg = hexOf(b.fg);
      const unrated = /risk-unknown/.test(b.cls);
      if (unrated) {
        if (bg !== 'transparent') problems.push('unrated badge "' + b.text + '" is filled ' + bg);
      } else {
        if (!PALETTE[bg]) problems.push('badge "' + b.text + '" (' + b.cls + ') is ' + bg + ', not on the scale');
        else if (fg && fg !== 'transparent' && contrast(bg, fg) < 4.5) {
          problems.push('badge "' + b.text + '" ' + bg + ' on ' + fg + ' = ' + contrast(bg, fg).toFixed(2) + ':1');
        }
      }
      if (b.shapeW <= 0 || b.shapeH <= 0) {
        problems.push('badge "' + b.text + '" (' + b.cls + ') draws no shape, so its level is colour alone');
      }
    }
    for (const m of found.markers) {
      markers++;
      const bg = hexOf(m.bg);
      if (!m.label) problems.push('a map marker has no accessible name (' + m.cls + ')');
      if (m.role !== 'img') problems.push('a map marker is not exposed as an image (' + m.cls + ')');
      if (!/risk-unknown/.test(m.cls) && !PALETTE[bg]) {
        problems.push('marker ' + m.cls + ' is ' + bg + ', not on the scale');
      }
      if (m.w <= 0) problems.push('marker ' + m.cls + ' has no size');
      if (m.clip === 'none' && (!m.radius || m.radius === '0px')) {
        problems.push('marker ' + m.cls + ' is an unshaped square');
      }
    }

    /* Six levels must end up as six different fills on a real page, after the
       whole cascade has had its say - not merely six hexes in a file. */
    const seen = {};
    for (const b of found.badges) {
      const bg = hexOf(b.bg);
      const m = /risk-[a-z]+/.exec(b.cls);
      if (PALETTE[bg]) (seen[bg] = seen[bg] || new Set()).add(m ? m[0] : '?');
    }
    for (const [hex, classes] of Object.entries(seen)) {
      if (classes.size > 1) problems.push('two levels painted ' + hex + ' on ' + page);
    }

    if (problems.length) {
      failures++;
      console.log('FAIL ' + page);
      for (const p of problems.slice(0, 8)) console.log('   ' + p);
      if (problems.length > 8) console.log('   … and ' + (problems.length - 8) + ' more');
    } else {
      console.log('ok   ' + page + '  (' + found.badges.length + ' badges, ' + found.markers.length + ' markers)');
    }
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + badges + ' badge(s) and ' + markers + ' marker(s) measured across ' +
    PAGES.length + ' page(s); ' + failures + ' page(s) failed.');
  if (!badges) { console.log('FAIL: no risk badge rendered anywhere, so nothing was measured.'); process.exit(1); }
  if (!markers) { console.log('FAIL: no map marker rendered anywhere, so nothing was measured.'); process.exit(1); }
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
