'use strict';
/**
 * Grading the published model forecasts, shared by tools/run-models.js (every
 * daily run) and tools/rebuild-model-grades.js (a rebuild from the committed
 * files). Both write data/model-verdicts.json from the same inputs with the
 * same function, so a rebuild reproduces what the daily run wrote.
 *
 * Inputs: the ledger (every forecast published), the runs (which places each
 * run watched), the climatology (each place's lines) and the archive of NASA
 * POWER measurements (data/model-measured.json). Nothing else: the verdicts
 * are a pure function of committed files.
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'forecast-models.js'));

const POWER_PARAMS = 'T2M_MAX,PRECTOTCORR,T2MDEW,WS10M';
const compact = d => d.replace(/-/g, '');
const ymd = t => new Date(t).toISOString().slice(0, 10);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function emptyArchive() {
  return {
    note: 'NASA POWER daily measurements for every place the forecast models watch, as fetched by tools/run-models.js. ' +
      'Each day is [maximum temperature °C, rain mm, dew point °C, wind km/h, date fetched]. A day is replaced by each newer ' +
      'fetch until it was ' + M.SETTLE_DAYS + ' days old when fetched; from then on it is settled and never replaced. Only ' +
      'settled days are used to grade.',
    settleDays: M.SETTLE_DAYS, updatedAt: null, places: {}
  };
}

/** The archive file, one place per line so a day's change is one line of diff. */
function writeArchive(file, a) {
  const ids = Object.keys(a.places).sort();
  const head = JSON.stringify({ note: a.note, settleDays: a.settleDays, updatedAt: a.updatedAt });
  const body = ids.map(id => {
    const days = a.places[id], keys = Object.keys(days).sort(), o = {};
    keys.forEach(k => { o[k] = days[k]; });
    return ' ' + JSON.stringify(id) + ': ' + JSON.stringify(o);
  }).join(',\n');
  fs.writeFileSync(file, head.slice(0, -1) + ',"places":{\n' + body + '\n}}\n');
}

/** Rows from a POWER daily response, for mergeMeasured. */
function powerRows(param, days) {
  const v = (k, d) => { const x = param[k] && param[k][compact(d)]; return x === undefined || x <= -900 ? NaN : x; };
  return days.map(d => ({ tmax: v('T2M_MAX', d), rain: v('PRECTOTCORR', d), dew: v('T2MDEW', d), wind: v('WS10M', d) * 3.6 }));
}

function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(ymd(t));
  return out;
}

/** Fetch POWER for one place and merge it into the archive. */
async function fetchInto(archive, place, from, to, fetchedOn, getJson) {
  const u = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=' + POWER_PARAMS +
    '&community=AG&latitude=' + place.lat + '&longitude=' + place.lon + '&start=' + compact(from) + '&end=' + compact(to) + '&format=JSON';
  const j = await getJson(u);
  const days = daysBetween(from, to);
  archive.places[place.id] = archive.places[place.id] || {};
  return M.mergeMeasured(archive.places[place.id], days, powerRows(j.properties.parameter, days), fetchedOn);
}

/** Places with a forecast whose window has ended and that has no verdict yet. */
function needsGrading(ledger, previous, today) {
  const done = new Set(((previous && previous.outlooks) || []).filter(o => o.verdict !== 'pending').map(o => o.id));
  const ids = new Set();
  for (const o of ledger) {
    const end = M.windowDays(o.targetStart, o.targetEnd).slice(-1)[0];
    if (end && end < today && !done.has(o.id) && o.model && o.model.placeId) ids.add(o.model.placeId);
  }
  return ids;
}

const NOTE = 'How each published model forecast turned out, from data/model-ledger.json, data/model-runs.json, data/climatology.json ' +
  'and data/model-measured.json by forecast-models.js gradeModelRecord (run by tools/run-models.js daily, reproducible with ' +
  'tools/rebuild-model-grades.js). Correct if its weather line was crossed on at least one day of its window, a false alarm if ' +
  'not, pending until every day of the window has a settled NASA POWER measurement (one at least ' + M.SETTLE_DAYS +
  ' days old when fetched). Verdicts and misses are both recomputed on every run from settled days only. A miss is a day the ' +
  'line was crossed at a place a published run was watching, with no forecast for it. "events" merges forecasts at one place ' +
  'for one hazard whose windows overlap or touch; "days" scores every watched place-day, as the backtest does.';

/** The verdicts file, from the committed inputs. */
function buildVerdicts(ledger, runs, climatology, archive) {
  const g = M.gradeModelRecord(ledger, runs, climatology, archive);
  return {
    note: NOTE,
    generatedAt: archive.updatedAt, settleDays: g.settleDays, measuredThrough: g.measuredThrough,
    counts: g.counts, events: g.events, days: g.days,
    outlooks: g.outlooks, misses: g.misses, eventList: g.eventList
  };
}

module.exports = { emptyArchive, writeArchive, readJson, powerRows, daysBetween, fetchInto, needsGrading, buildVerdicts, ymd };
