#!/usr/bin/env node
/*
 * The tutorial, on the screens people actually hold.
 *
 * jsdom has no layout: every rectangle in it is zero, so nothing in the test
 * suite can tell whether the coach card is on the screen or off the side of
 * it. It was off the side of it. On every phone size the card sat at -171px
 * with its Back and Open buttons entirely past the left edge, because the
 * phone breakpoint forced left:12px!important while the script still had a
 * translate(-50%,-50%) on the card. Two mechanisms, each reasonable alone.
 *
 * So this walks the real tour in real Chromium at real device sizes and, for
 * every step, asserts what a person would check by looking: the card is inside
 * the viewport, so are its buttons, the highlight is inside the viewport too,
 * and the card is not sitting on top of the thing it is describing.
 *
 * Not part of `npm test`: it needs Playwright. Run it by hand when the tour,
 * the coach CSS or a tour target changes.
 *
 *   mkdir -p /tmp/tc && cd /tmp/tc && npm init -y
 *   npm install playwright@1.49.1 leaflet@1.9.4
 *   SITE_ROOT=/path/to/repo LEAFLET_DIST=$PWD/node_modules/leaflet/dist \
 *     PLAYWRIGHT=$PWD/node_modules/playwright node /path/to/repo/tools/tour-browser-check.js
 *
 * Set CHROMIUM=/path/to/chrome if Playwright's own browser download was skipped.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, '..');
const LEAFLET = process.env.LEAFLET_DIST;
if (!LEAFLET) {
  console.error('set LEAFLET_DIST (and PLAYWRIGHT) — see the header of this file');
  process.exit(2);
}
const eventsHandler = require(path.join(ROOT, 'api', 'events.js'));
const { makeFetch } = require(path.join(ROOT, 'test', 'mock-upstreams.js'));

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/events')) {
    const realFetch = global.fetch;
    global.fetch = makeFetch({});
    const out = {};
    const fake = { status(){ return fake }, setHeader(){}, json(b){ out.b = b }, end(){} };
    try {
      const q = {}; url.searchParams.forEach((v, k) => q[k] = v);
      await eventsHandler({ query:q, url:req.url, method:'GET', headers:{} }, fake);
    } finally { global.fetch = realFetch; }
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify(out.b));
    return;
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream'});
  res.end(fs.readFileSync(file));
});

/* Real handsets, smallest first, plus a tablet so the desktop path stays
   covered. The bug only ever showed below the 600px breakpoint. */
const SIZES = [
  ['small Android', 360, 740], ['iPhone SE', 375, 667], ['iPhone 14', 390, 844],
  ['Pixel 7', 412, 915], ['iPhone 14 Pro Max', 430, 932], ['iPad mini', 768, 1024]
];
const PAGES = (process.env.PAGES || 'index,personal-risk').split(',').map(s => s.trim()).filter(Boolean);

/*
 * How many of the five steps should actually highlight something, per page.
 *
 * Measured, then pinned, so a step that silently stops finding its target is a
 * failure rather than a quietly duller tutorial. It was one: the first step
 * looked for #map, the homepage calls its map #leafletMap, and the step
 * highlighted nothing there for as long as the tour has existed.
 *
 * personal-risk is 2 and not 5 because it has no map and three of the steps
 * describe homepage furniture. That is the current state, recorded so it
 * cannot get worse without saying so -- not a claim that 2 is right.
 */
const EXPECT_RINGS = { index: 5, 'personal-risk': 2 };

const measure = () => {
  const card = document.querySelector('.coach-card');
  if (!card) return { missing: true };
  const b = card.getBoundingClientRect();
  const ringEl = document.querySelector('.coach-ring');
  const shown = ringEl && getComputedStyle(ringEl).display !== 'none';
  const g = shown ? ringEl.getBoundingClientRect() : null;
  return {
    l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), bo: Math.round(b.bottom),
    vw: innerWidth, vh: innerHeight,
    step: (document.querySelector('.coach-progress') || {}).textContent || '',
    buttons: [...card.querySelectorAll('button,a')]
      .filter(e => getComputedStyle(e).display !== 'none')
      .map(e => ({ t: (e.textContent || '').trim().slice(0, 16),
        l: Math.round(e.getBoundingClientRect().left), r: Math.round(e.getBoundingClientRect().right) })),
    ring: g ? { l: Math.round(g.left), t: Math.round(g.top), r: Math.round(g.right), b: Math.round(g.bottom) } : null
  };
};

(async () => {
  await new Promise(r => server.listen(8097, r));
  /* Playwright finds its own browser; CHROMIUM overrides that for a machine
     where the download was skipped and one is installed elsewhere. Hard-coding
     this environment's path broke the standalone workflow in the header above,
     which installs Playwright and expects its own Chromium. */
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));
  let failures = 0, checked = 0;

  for (const page0 of PAGES) {
    for (const [name, w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h },
        deviceScaleFactor: 2, isMobile: w < 700, hasTouch: w < 700 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.route(/unpkg\.com\/leaflet@/, r => {
        const u = r.request().url();
        r.fulfill({ status: 200, contentType: u.endsWith('.css') ? 'text/css' : 'text/javascript',
          body: fs.readFileSync(path.join(LEAFLET, u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js')) });
      });
      /* Cesium and the imagery hosts are unreachable here and irrelevant to the
         tutorial's geometry, so they are failed rather than waited on. */
      await page.route(/unpkg\.com\/cesium@|arcgisonline\.com|terrain\.reearth\.land/, r => r.abort());

      await page.goto('http://localhost:8097/' + page0, { waitUntil: 'load', timeout: 60000 });
      const appeared = await page.waitForSelector('.coach-card', { timeout: 20000 }).then(() => true).catch(() => false);
      if (!appeared) {
        console.log('  FAIL ' + (page0 + ' / ' + name).padEnd(30) + ' the tour never opened');
        failures++; await ctx.close(); continue;
      }

      /* Every step, not just the one that happens to be showing: each places
         the card against a different target, and one of them being off-screen
         is exactly the failure this exists to catch. */
      let step = 0, bad = 0, lines = [], rings = 0;
      while (step < 5) {
        await page.waitForTimeout(2200);
        const m = await page.evaluate(measure);
        if (m.missing) { lines.push('    step ' + (step + 1) + ': card vanished'); bad++; break; }
        checked++;
        const offL = m.l < 0, offR = m.r > m.vw, offT = m.t < 0, offB = m.bo > m.vh;
        const btn = m.buttons.filter(b => b.l < 0 || b.r > m.vw);
        const g = m.ring;
        const ringOff = g ? (g.l < -8 || g.t < -8 || g.r > m.vw + 8 || g.b > m.vh + 8) : false;
        const covers = g ? !(m.r <= g.l || m.l >= g.r || m.bo <= g.t || m.t >= g.b) : false;
        /* A ring has to be big enough to be a highlight. A hidden element has a
           0x0 rectangle at the origin, which draws a 14px ring at (-7,-7) --
           inside the tolerance below, and counted as a highlight. That is the
           stale-or-hidden selector this checker exists to catch, passing. */
        const tiny = g ? (g.r - g.l < 24 || g.b - g.t < 24) : false;
        if (g && !tiny) rings++;
        const ok = !offL && !offR && !offT && !offB && !btn.length && !ringOff && !covers && !tiny;
        if (!ok) {
          bad++;
          lines.push('    ' + (m.step || 'step ' + (step + 1)) + ': card ' +
            m.l + ',' + m.t + '..' + m.r + ',' + m.bo + ' in ' + m.vw + 'x' + m.vh +
            (offL ? ' OFF-LEFT' : '') + (offR ? ' OFF-RIGHT' : '') +
            (offT ? ' OFF-TOP' : '') + (offB ? ' OFF-BOTTOM' : '') +
            (ringOff ? ' RING-OFFSCREEN' : '') + (covers ? ' CARD-COVERS-RING' : '') +
            (tiny ? ' RING-TOO-SMALL(' + (g.r - g.l) + 'x' + (g.b - g.t) + ') — a hidden target' : '') +
            btn.map(b => ' BUTTON-CLIPPED("' + b.t + '" ' + b.l + '..' + b.r + ')').join(''));
        }
        step++;
        if (step < 5) await page.click('.coach-card [data-a=next]');
      }
      if (errors.length) { bad++; lines.push('    page error: ' + errors[0].slice(0, 120)); }
      const want = EXPECT_RINGS[page0];
      if (want !== undefined && rings !== want) {
        bad++;
        lines.push('    highlighted ' + rings + ' of 5 steps, expected ' + want +
          ' — a step has stopped finding what it describes');
      }
      if (bad) failures++;
      console.log((bad ? '  FAIL ' : '  ok   ') + (page0 + ' / ' + name).padEnd(30) +
        ' ' + w + 'x' + h + ' — ' + step + ' steps, ' + rings + ' highlighted');
      lines.forEach(l => console.log(l));
      await page.screenshot({ path: 'tour-' + page0 + '-' + name.replace(/\s+/g, '-') + '.png' });
      await ctx.close();
    }
  }
  console.log('\nchecks: ' + checked + ' across ' + (PAGES.length * SIZES.length) +
    ' page/size combinations, failing combinations: ' + failures);
  await browser.close();
  server.close();
  /* A checker that reports failures and exits 0 reads as green to anything
     wrapping it. */
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
