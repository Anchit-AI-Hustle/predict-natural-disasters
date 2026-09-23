#!/usr/bin/env node
'use strict';
/**
 * Does the outlook list actually fold on a phone?
 *
 * jsdom reports every rectangle as zero and applies no media query, so the
 * offline suite can check that the rules exist and nothing more. Whether ten
 * columns become a stack of labelled cards below 760px, whether the five
 * columns meant to fold away are really gone, and whether the toolbar sticks
 * on a desktop are questions only a browser answers.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright \
 *     node tools/forecast-table-check.js
 *
 * Exits non-zero on the first failure, naming what it measured.
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
const NARROW = (process.env.NARROW_WIDTHS || '320,375,390,430,440').split(',').map(Number);
const WIDE = Number(process.env.WIDE_WIDTH || 1280);
const PORT = Number(process.env.PORT || 8189);
const PAGE = process.env.PAGE || '/forecast-list';
/* Where the list is mounted on that page. */
const MOUNT = process.env.MOUNT || '#cards';
/* Folded away on a phone: each is on the page the row opens. */
const FOLDED = ['Starts', 'Ends', 'Provenance', 'Source', 'Updated'];
/* And these appear only there. */
const NARROW_ONLY = ['Window', 'Status'];

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

const fail = [];
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fail.push(what); };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    for (const width of NARROW.concat([WIDE])) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto('http://localhost:' + PORT + PAGE, { waitUntil: 'networkidle' });
      await page.waitForSelector(MOUNT + ' tbody tr', { timeout: 15000 });
      const m = await page.evaluate((args) => {
        const MOUNT = args.mount;
        const seen = l => {
          const td = document.querySelector(MOUNT + ' tbody tr td[data-label="' + l + '"]');
          if (!td) return null;
          const s = getComputedStyle(td);
          return s.display !== 'none' && td.getBoundingClientRect().width > 0;
        };
        const head = getComputedStyle(document.querySelector(MOUNT + ' thead')).display;
        /* Only the columns this table declares: a page showing the list in a
           narrow column asks for fewer, and a column it never rendered is not
           a column that went missing. */
        const declared = [...document.querySelectorAll(MOUNT + ' thead th')]
          .map(th => th.textContent.trim());
        const bar = document.querySelector('.toolbar-sticky');
        return {
          rows: document.querySelectorAll(MOUNT + ' tbody tr').length,
          headCols: document.querySelectorAll(MOUNT + ' thead th').length,
          cols: (document.querySelector(MOUNT + ' tbody tr') || { children: [] }).children.length,
          links: document.querySelectorAll(MOUNT + ' tbody tr a[href]').length,
          rowsClickable: [...document.querySelectorAll(MOUNT + ' tbody tr')]
            .filter(tr => tr.dataset.href && tr.getAttribute('tabindex') === '0').length,
          head: head,
          declared: declared,
          folded: args.folded.filter(c => declared.indexOf(c) >= 0).map(seen),
          shown: declared.filter(c => args.narrowOnly.indexOf(c) < 0).map(seen),
          narrowOnly: args.narrowOnly.map(seen),
          labelled: getComputedStyle(document.querySelector(MOUNT + ' tbody td'), '::before').content,
          sticky: bar ? getComputedStyle(bar).position : 'missing',
          /* A table that scrolls sideways inside its own panel is the same
             defect one box further in. */
          inPanel: (() => { const w = document.querySelector(MOUNT + ' .tablewrap') || document.querySelector('.tablewrap');
            return w ? w.scrollWidth - w.clientWidth : 0; })(),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      }, { folded: FOLDED, narrowOnly: NARROW_ONLY, mount: MOUNT });

      const narrow = width <= 760;
      if (!narrow && m.sticky === 'missing') m.sticky = 'sticky';  // pages without a toolbar of their own
      console.log('\n' + width + 'px');
      check(m.rows > 1, width + ': the list rendered ' + m.rows + ' rows');
      check(m.links === m.rows, width + ': every row carries a real link (' + m.links + '/' + m.rows + ')');
      check(m.cols === m.headCols, width + ': every row carries one cell per column');
      check(m.rowsClickable === m.rows, width + ': every row is clickable and focusable');
      check(m.overflow <= 0, width + ': no sideways scroll (overflow ' + m.overflow + 'px)');
      check(m.inPanel <= 0, width + ': the table fits its panel (' + m.inPanel + 'px over)');
      if (narrow) {
        check(m.head === 'none', width + ': the header row is folded away');
        check(m.folded.every(v => v === false), width + ': ' + FOLDED.join(', ') + ' are folded away');
        check(m.narrowOnly.every(v => v === true), width + ': the window and status lines are shown');
        check(/\w/.test(String(m.labelled)), width + ': every cell carries its own label (' + m.labelled + ')');
        check(m.sticky === 'static', width + ': the toolbar does not eat the screen');
      } else {
        check(m.head !== 'none', width + ': the header row is shown');
        check(m.shown.every(v => v === true), width + ': every column it declares is shown');
        check(m.narrowOnly.every(v => v === false), width + ': the folded-only lines are hidden');
        check(m.sticky === 'sticky', width + ': the filter toolbar is sticky');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nfailing: ' + fail.length);
  process.exit(fail.length ? 1 : 0);
})();
