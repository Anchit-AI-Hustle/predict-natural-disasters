#!/usr/bin/env node
'use strict';
/**
 * Rebuild data/model-verdicts.json from the committed files, deterministically.
 *
 *   node tools/rebuild-model-grades.js            regrade from the archive as it is
 *   node tools/rebuild-model-grades.js --fetch    first fetch NASA POWER for every
 *                                                 place, from FROM to today, into
 *                                                 data/model-measured.json
 *
 * Without --fetch the output depends only on data/model-ledger.json,
 * data/model-runs.json, data/climatology.json and data/model-measured.json, so
 * anyone can check that the published grades follow from them. --fetch is how
 * the archive was first filled (the daily run only keeps the last sixty days),
 * and how a place a run skipped gets measured.
 *
 * Requests carry no personal data: a fixed user agent and the place's
 * coordinates, nothing else.
 */
const fs = require('fs');
const path = require('path');
const G = require(path.join(__dirname, 'model-grades.js'));

const ROOT = path.join(__dirname, '..');
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const DATA = arg('--data') || path.join(ROOT, 'data');
const FROM = arg('--from') || '2026-08-15';
const FETCH = process.argv.includes('--fetch');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'predict-natural-disasters forecast models' } });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status);
      if (r.status !== 429 && r.status < 500) throw last;
    } catch (e) { last = e; if (/HTTP 4(?!29)/.test(e.message)) throw e; }
    await wait(1500 * Math.pow(2, i));
  }
  throw last || new Error('no answer');
}

(async () => {
  const f = n => path.join(DATA, n);
  const ledger = G.readJson(f('model-ledger.json'), []);
  const runs = G.readJson(f('model-runs.json'), []);
  const clim = G.readJson(f('climatology.json'), { places: [] });
  const archive = G.readJson(f('model-measured.json'), null) || G.emptyArchive();
  if (FETCH) {
    const now = new Date().toISOString(), today = G.ymd(now);
    const failed = [];
    let changed = 0;
    for (let i = 0; i < clim.places.length; i += 6) {
      await Promise.all(clim.places.slice(i, i + 6).map(async p => {
        try { const n = await G.fetchInto(archive, p, FROM, today, today, getJson); changed += n; }
        catch (e) { failed.push(p.id + ': ' + e.message); }
      }));
    }
    archive.updatedAt = now;
    console.log('fetched ' + (clim.places.length - failed.length) + '/' + clim.places.length + ' places, ' + changed + ' day(s) changed');
    failed.forEach(x => console.log('  failed ' + x));
    G.writeArchive(f('model-measured.json'), archive);
  }
  if (!archive.updatedAt) throw new Error('the archive has never been filled: run with --fetch');
  const v = G.buildVerdicts(ledger, runs, clim, archive);
  fs.writeFileSync(f('model-verdicts.json'), JSON.stringify(v, null, 1) + '\n');
  console.log('graded ' + JSON.stringify(v.counts) + ' events ' + JSON.stringify(v.events) + ' measured through ' + v.measuredThrough);
})().catch(e => { console.error(e); process.exit(1); });
