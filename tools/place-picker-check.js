#!/usr/bin/env node
'use strict';
/**
 * Can a reader pick a neighbourhood, a city or a district, in a real browser?
 *
 * The homepage and My places used to take the first place search result.
 * This drives both pages in Chromium with the place search answered from a
 * fixed list: a search that matches several places must offer all of them,
 * each with its level, and picking one must check (homepage) or fill in
 * (My places) exactly that place. It also checks the list fits a phone.
 *
 *   SITE_ROOT=$PWD PLAYWRIGHT=$PWD/node_modules/playwright node tools/place-picker-check.js
 *
 * CHROMIUM overrides the executable. Exits non-zero on any failure.
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
const PORT = Number(process.env.PORT || 8193);

const PLACES = [
  { lat: '19.1197', lon: '72.8464', name: 'Andheri West', addresstype: 'suburb', place_rank: 20,
    display_name: 'Andheri West, K/W Ward, Zone 3, Mumbai, Mumbai Suburban, Maharashtra, 400053, India',
    address: { suburb: 'Andheri West', city: 'Mumbai', state: 'Maharashtra', country: 'India', country_code: 'in' } },
  { lat: '19.0760', lon: '72.8777', name: 'Mumbai', addresstype: 'city', place_rank: 16,
    display_name: 'Mumbai, Mumbai Suburban, Maharashtra, India',
    address: { city: 'Mumbai', state: 'Maharashtra', country: 'India', country_code: 'in' } },
  { lat: '19.2', lon: '72.9', name: 'Mumbai Suburban', addresstype: 'state_district', place_rank: 12,
    display_name: 'Mumbai Suburban, Maharashtra, India',
    address: { state_district: 'Mumbai Suburban', state: 'Maharashtra', country: 'India', country_code: 'in' } }
];

/* Near the fixture feed's Nepal flood, so the place page has events to list. */
const KATHMANDU = [
  { lat: '27.7172', lon: '85.3240', name: 'Kathmandu', addresstype: 'city', place_rank: 16,
    display_name: 'Kathmandu, Kathmandu Metropolitan City, Bagmati Province, Nepal',
    address: { city: 'Kathmandu', state: 'Bagmati Province', country: 'Nepal', country_code: 'np' } },
  { lat: '27.7', lon: '85.4', name: 'Kathmandu', addresstype: 'county', place_rank: 12,
    display_name: 'Kathmandu, Bagmati Province, Nepal',
    address: { county: 'Kathmandu', state: 'Bagmati Province', country: 'Nepal', country_code: 'np' } }
];

let feed = null;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    if (!feed) {
      const realFetch = global.fetch;
      global.fetch = makeFetch({});
      const out = {};
      const fake = { status() { return fake; }, setHeader() {}, json(b) { out.b = b; }, end() {} };
      try { await eventsHandler({ query: {}, url: '/api/events', method: 'GET', headers: {} }, fake); }
      finally { global.fetch = realFetch; }
      feed = JSON.stringify(out.b || { events: [], meta: {} });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(p.startsWith('/api/events') ? feed : '{}');
    return;
  }
  if (p === '/') p = '/index.html';
  /* The pretty URLs vercel.json rewrites; the page reads its subject from the path. */
  const pretty = /^\/(disasters|calamities|alerts|forecasts|regions|locations|hazards|history|sources)\/./.exec(p);
  if (pretty) p = '/' + { disasters: 'event-detail', calamities: 'calamity-detail', alerts: 'alert-detail',
    forecasts: 'forecast-detail', regions: 'region-detail', locations: 'location-detail', hazards: 'hazard-detail',
    history: 'historical-event-detail', sources: 'source-detail' }[pretty[1]] + '.html';
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(Object.assign(
    { args: ['--no-sandbox'] },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  ));
  const open = async (page, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const pg = await ctx.newPage();
    let asked = '';
    await pg.route(/nominatim\.openstreetmap\.org/, route => {
      asked = route.request().url();
      const list = /Kathmandu/i.test(decodeURIComponent(asked)) ? KATHMANDU : PLACES;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
    });
    await pg.addInitScript(() => localStorage.setItem('pnd_map_view', 'flat'));
    await pg.goto('http://localhost:' + PORT + page, { waitUntil: 'domcontentloaded' });
    return { ctx, pg, asked: () => asked };
  };

  for (const width of [390, 1280]) {
    /* The homepage: search, choose, answer. */
    const home = await open('/', width);
    await home.pg.fill('#placeQ', 'Mumbai');
    await home.pg.click('#checkBtn');
    await home.pg.waitForSelector('#placeChoices .pc-item', { timeout: 8000 });
    const items = await home.pg.$$eval('#placeChoices .pc-item', els => els.map(e => ({
      name: e.querySelector('.pc-name').textContent, level: e.querySelector('.pc-level').textContent })));
    check(/limit=8/.test(home.asked()), `home @${width}: the search asks for several matches`);
    check(items.length === 3, `home @${width}: all ${items.length} matches are offered`);
    check(items.map(i => i.level).join('|') === 'Area|City or town|District',
      `home @${width}: each match says its level (${items.map(i => i.level).join(', ')})`);
    const over = await home.pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 0, `home @${width}: the list fits the screen (${over}px sideways)`);
    await home.pg.click('#placeChoices .pc-item >> nth=0');
    await home.pg.waitForSelector('#placeResult:not([hidden]) h2', { timeout: 8000 });
    const answered = await home.pg.$eval('#placeResult h2', h => h.textContent);
    check(answered === 'Andheri West, Mumbai, Maharashtra, India', `home @${width}: the chosen area is checked ("${answered}")`);
    check(await home.pg.$eval('#placeChoices', b => b.hidden), `home @${width}: the list closes once a place is chosen`);
    await home.ctx.close();

    /* My places: search, choose, and the form holds that place. */
    const mine = await open('/personal-risk', width);
    await mine.pg.fill('#placeName', 'Mumbai');
    await mine.pg.click('#findPlace');
    await mine.pg.waitForSelector('#placeChoices .pc-item', { timeout: 8000 });
    await mine.pg.click('#placeChoices .pc-item >> nth=1');
    const form = await mine.pg.evaluate(() => ({ name: placeName.value, lat: lat.value, lon: lon.value,
      note: placeResult.textContent }));
    check(form.name === 'Mumbai, Maharashtra, India' && form.lat === '19.076000' && form.lon === '72.877700',
      `my places @${width}: the chosen city fills the form (${form.name} ${form.lat},${form.lon})`);
    check(/city or town/.test(form.note), `my places @${width}: the note says what was chosen ("${form.note}")`);
    await mine.pg.click('#f button:not([type="button"])');
    await mine.pg.waitForFunction(() => /Mumbai/.test(document.getElementById('saved').textContent), null, { timeout: 8000 });
    const saved = await mine.pg.$eval('#saved', s => s.textContent);
    check(/India/.test(saved) && !/country unknown/.test(saved), `my places @${width}: saved with its country`);
    await mine.ctx.close();

    /* Regions: find a city, open its page, see what is near it. */
    const reg = await open('/regions', width);
    await reg.pg.fill('#q', 'Kathmandu');
    await reg.pg.click('#findAreaBtn');
    await reg.pg.waitForSelector('#placeChoices .pc-item', { timeout: 8000 });
    await Promise.all([reg.pg.waitForNavigation({ timeout: 10000 }), reg.pg.click('#placeChoices .pc-item >> nth=0')]);
    const url = reg.pg.url();
    check(/\/locations\/.+\?lat=27\.7172&lon=85\.324&level=City%20or%20town/.test(url), `regions @${width}: the chosen city opens its place page (${url.replace(/^.*\/locations/, '/locations')})`);
    await reg.pg.waitForFunction(() => /km away/.test(document.getElementById('events').textContent) ||
      /No current events/.test(document.getElementById('events').textContent), null, { timeout: 10000 });
    const page = await reg.pg.evaluate(() => ({ title: document.getElementById('title').textContent,
      radius: document.getElementById('radius').value, rows: [...document.querySelectorAll('#events .event')].map(e => e.textContent),
      answer: document.getElementById('placeAnswer').hidden ? '' : document.getElementById('placeAnswer').textContent }));
    check(page.title === 'Disasters near Kathmandu, Bagmati Province, Nepal', `regions @${width}: page is about the city ("${page.title}")`);
    check(page.radius === '100', `regions @${width}: a city starts at 100 km (${page.radius})`);
    check(page.rows.length > 0 && page.rows.every(t => /(\d+) km away/.test(t) && Number(/(\d+) km away/.exec(t)[1]) <= 100),
      `regions @${width}: ${page.rows.length} events listed, each within 100 km with its distance`);
    check(page.answer.length > 20, `regions @${width}: the place's own risk answer is shown`);
    await reg.pg.selectOption('#radius', '25');
    await reg.pg.waitForTimeout(500);
    const narrower = await reg.pg.$$eval('#events .event', els => els.map(e => Number((/(\d+) km away/.exec(e.textContent) || [])[1])));
    check(narrower.every(d => d <= 25), `regions @${width}: narrowing to 25 km keeps only closer events (${narrower.join(', ') || 'none'})`);
    const over2 = await reg.pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over2 <= 0, `regions @${width}: the place page fits the screen (${over2}px sideways)`);
    await reg.ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\nfailing: ' + failures);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(2); });
