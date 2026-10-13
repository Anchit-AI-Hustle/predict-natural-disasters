'use strict';
/**
 * What every job that writes data checks before it writes.
 *
 * A job that cannot produce a sound result fails with a non-zero exit, and
 * leaves what is on disk alone, instead of writing something empty, all-null
 * or missing its keys and exiting 0. The first backtest run scored nothing and
 * committed a file of nulls; the ledger tools took a ledger they could not
 * parse for a first run and wrote an empty one over the history.
 */
const fs = require('fs');

function fail(message) {
  const e = new Error(message);
  e.dataError = true;
  throw e;
}

function readJson(file, what) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail(what + ' could not be read: ' + e.message); }
  try { return JSON.parse(text); } catch (e) { fail(what + ' is not valid JSON: ' + e.message); }
}

/** The fetched feed; an empty one is an outage, not a quiet hour. */
function readFeed(file) {
  const feed = readJson(file, 'the feed ' + file);
  if (!feed || !Array.isArray(feed.events)) fail('the feed ' + file + ' has no events list');
  if (!feed.events.length) fail('the feed ' + file + ' has no events');
  return feed;
}

/**
 * A ledger, or a fresh one when the file does not exist yet. One that exists
 * but cannot be read, or has the wrong shape, stops the job: starting again
 * from empty would write over the history.
 */
function readLedger(file, isValid, fresh) {
  if (!fs.existsSync(file)) return fresh();
  const raw = readJson(file, 'the ledger ' + file);
  if (!isValid(raw)) fail('the ledger ' + file + ' is not in the expected shape; refusing to start it again from empty');
  return raw;
}

/** Writes only when check(value) finds nothing wrong. */
function writeChecked(file, value, problems, text) {
  const found = problems(value);
  if (found.length) fail('not writing ' + file + ': ' + found.join('; '));
  fs.writeFileSync(file, text === undefined ? JSON.stringify(value, null, 2) + '\n' : text);
}

const isNum = v => typeof v === 'number' && isFinite(v);
const filled = v => v !== undefined && v !== null && v !== '';

function missingKeys(obj, keys) {
  return keys.filter(k => !obj || !filled(obj[k]));
}

/** At least half the places, each with every threshold the models read. */
function climatologyProblems(out, expectedPlaces) {
  const p = [];
  if (!out || !Array.isArray(out.places)) return ['no places list'];
  if (!filled(out.period)) p.push('no period');
  const need = Math.max(1, Math.ceil((expectedPlaces || 1) / 2));
  if (out.places.length < need) p.push('only ' + out.places.length + ' of ' + expectedPlaces + ' places built');
  const series = (v, n) => Array.isArray(v) && v.length === n;
  out.places.forEach(pl => {
    const miss = missingKeys(pl, ['id', 'lat', 'lon', 'heat', 'rain', 'fire']);
    if (miss.length) { p.push((pl && pl.id || '?') + ' is missing ' + miss.join(', ')); return; }
    if (!series(pl.heat.p95, 7) || !pl.heat.p95.every(isNum)) p.push(pl.id + ' has no heat thresholds');
    if (!series(pl.rain.p99, 12) || !series(pl.rain.p99x3, 12)) p.push(pl.id + ' has no rain thresholds');
    if (!series(pl.fire.p95, 12)) p.push(pl.id + ' has no fire thresholds');
  });
  return p;
}

const BACKTEST_KEYS = ['heat@3', 'heat@5', 'rain@3', 'rain@5', 'fire@3', 'fire@5'];

/** Every hazard at every lead scored on real days. */
function backtestProblems(out) {
  const p = [];
  if (!out || typeof out.results !== 'object' || !out.results) return ['no results'];
  if (!(out.places > 0)) p.push('no place was scored');
  for (const k of BACKTEST_KEYS) {
    const r = out.results[k];
    if (!r) { p.push(k + ' is missing'); continue; }
    if (!(r.days > 0)) p.push(k + ' scored no days');
    const miss = ['hits', 'misses', 'falseAlarms', 'correctNegatives'].filter(f => !isNum(r[f]));
    if (miss.length) p.push(k + ' is missing ' + miss.join(', '));
  }
  return p;
}

/** Most places checked; a week with no hazard is fine, a broken outlook is not. */
function modelRunProblems(out) {
  const p = [];
  if (!out || !Array.isArray(out.outlooks)) return ['no outlooks list'];
  if (!filled(out.period)) p.push('no climatology period');
  if (!(out.places > 0)) p.push('no places to check');
  else if (!(out.checked >= Math.ceil(out.places / 2))) p.push('only ' + out.checked + ' of ' + out.places + ' places checked');
  out.outlooks.forEach(o => {
    const miss = missingKeys(o, ['id', 'type', 'title', 'lat', 'lon', 'issuedAt', 'targetStart', 'targetEnd', 'forecastKind']);
    if (miss.length) p.push((o && o.id || '?') + ' is missing ' + miss.join(', '));
  });
  return p;
}

module.exports = { readFeed, readLedger, writeChecked, readJson, missingKeys,
  climatologyProblems, backtestProblems, modelRunProblems, BACKTEST_KEYS };
