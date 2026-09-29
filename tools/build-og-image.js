#!/usr/bin/env node
'use strict';
/**
 * The picture a shared link shows.
 *
 * No page had an og:image, so a link to this site posted on LinkedIn, Slack,
 * WhatsApp or X unfurled as a bare line of grey text - the first thing most
 * people ever see of it. This draws one card for every page: the site's mark
 * and name, what it does in one line, and the world from the same Natural
 * Earth outlines the maps use.
 *
 * Nothing on the card can go stale or overstate. It carries no counts, no
 * event positions and no dates, because the image is cached by every site it
 * is shared to for days; the agency names are the providers the feed reads.
 *
 * Usage, with Playwright and a Chromium available:
 *
 *   PLAYWRIGHT=$(npm root -g)/playwright node tools/build-og-image.js
 *
 * CHROMIUM overrides the executable. Writes og-image.png (1200x630) at the
 * site root.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.join(__dirname, '..');
const W = 1200, H = 630;

/** The land, as one SVG path in a 360 x 180 box: x is longitude + 180, y is 90 - latitude.
    The card shows 84 N to 60 S; below that Antarctica flattens into a strip. */
function landPath() {
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-countries.json'), 'utf8'));
  const d = [];
  const ring = r => r.forEach((p, i) => d.push((i ? 'L' : 'M') + (p[0] + 180).toFixed(2) + ' ' + (90 - p[1]).toFixed(2)));
  for (const f of world.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const r of poly) { ring(r); d.push('Z'); }
  }
  return d.join('');
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(circle at 78% 30%,#0d4433 0,#04160f 55%,#020d0a 100%);
  font-family:Inter,"DejaVu Sans",system-ui,sans-serif;color:#f5fbf8;position:relative}
svg.world{position:absolute;right:-110px;top:92px;width:1000px;height:400px}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#030f0b 0,#030f0bee 38%,#030f0b55 62%,transparent 80%)}
.copy{position:absolute;left:72px;top:58px;width:800px}
.brand{display:flex;align-items:center;gap:16px;font-size:28px;font-weight:800;letter-spacing:-.01em}
.mark{width:46px;height:46px;border:4px solid #25e29c;border-radius:50%;display:grid;place-items:center;box-shadow:0 0 28px rgba(37,226,156,.35)}
.mark i{width:14px;height:14px;border-radius:50%;background:#25e29c}
h1{font-size:50px;line-height:1.08;letter-spacing:-.03em;margin-top:44px;font-weight:850}
p{font-size:25px;line-height:1.4;color:#c4d8cf;margin-top:20px;max-width:640px}
.chip{display:inline-block;white-space:nowrap;margin-top:26px;padding:10px 18px;border:2px solid #1d7a58;border-radius:999px;background:#06261d;
  color:#8ff0ca;font-size:20px;font-weight:700}
.foot{position:absolute;left:72px;right:72px;bottom:46px;display:flex;justify-content:space-between;align-items:flex-end;
  font-size:20px;color:#91b4a6}
.foot b{color:#f5fbf8;font-weight:700}
</style></head><body>
<svg class="world" viewBox="0 6 360 144" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <path d="${landPath()}" fill="#0f4a37" stroke="#25e29c" stroke-opacity=".55" stroke-width=".35" fill-rule="evenodd"/>
</svg>
<div class="fade"></div>
<div class="copy">
  <div class="brand"><span class="mark"><i></i></span>Predict Natural Disasters</div>
  <h1>Live natural disasters,<br>on one map</h1>
  <p>Earthquakes, floods, storms, wildfires and volcanoes, as official agencies report them. Check any place in the world.</p>
  <span class="chip">Experimental forecasts, checked in public, misses included</span>
</div>
<div class="foot"><b>predict-natural-disasters.anchit-tandon.com</b><span>GDACS · USGS · NOAA · EMSC · NASA · ReliefWeb</span></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const out = path.join(ROOT, 'og-image.png');
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log('og-image.png ' + fs.statSync(out).size + ' bytes');
})().catch(e => { console.error(e); process.exit(1); });
