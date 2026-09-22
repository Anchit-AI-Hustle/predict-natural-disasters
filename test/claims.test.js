'use strict';
/*
 * Nothing may claim more than the code can show.
 *
 * Copy drifts ahead of implementation quietly and in one direction. This app
 * promised background alerting it had no service worker for, a filter that
 * excluded regional centroids while reading a field almost nothing set, and a
 * hit rate computed entirely from outlooks about hazards already happening.
 * Each was found by reading the code beside the sentence.
 *
 * These are the rules that came out of that, written so a new page cannot
 * reintroduce them: the words that most often overstate are searched for
 * across the site, and each is either absent or accompanied by what makes it
 * true.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = () => fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
/* Visible copy only: a CSS class called .verified or an id like mVerified is
   not a claim to anybody. */
function copyOf(file) {
  let s = read(file);
  s = s.replace(/<style>[\s\S]*?<\/style>/g, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/g, ' ');
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/* --------------------------------------------- hazards that cannot be predicted */

test('nothing claims earthquakes can be predicted', () => {
  const offenders = [];
  for (const f of pages().concat(['README.md'])) {
    const copy = f.endsWith('.md') ? read(f) : copyOf(f);
    /* "predict" next to "earthquake" is not automatically wrong - the pages
       that say it cannot be done say both words - so this looks for the
       assertion, not the pairing. */
    for (const re of [
      /we (can )?predict (the )?earthquakes?/i,
      /earthquakes? (can|will) be predicted/i,
      /predicts? (the )?(exact )?(time|date|location) of (the )?(next )?earthquakes?/i,
      /accurate earthquake prediction/i
    ]) if (re.test(copy)) offenders.push(f + ' :: ' + re);
  }
  assert.deepEqual(offenders, [], 'these claim deterministic earthquake prediction');
});

test('the limits of earthquake forecasting are stated somewhere public', () => {
  const said = pages().some(f => /exact future quake prediction remains scientifically limited|not treated as scientifically established|does not claim scientifically established/i.test(copyOf(f)));
  assert.ok(said, 'no public page states that exact earthquake prediction is not established');
});

/* ------------------------------------------------- claims about what it does */

test('nothing offers alerting that reaches a closed tab', () => {
  const offenders = [];
  for (const f of pages()) {
    const copy = copyOf(f);
    for (const re of [/get warned when risk rises/i, /\bGet Notified\b/, /we(’|')?ll notify you/i,
      /alerts? sent to your (phone|device)/i, /background (alerts|monitoring)\b(?! service)/i]) {
      if (re.test(copy)) offenders.push(f + ' :: ' + re);
    }
  }
  assert.deepEqual(offenders, [], 'these promise alerting nothing here can deliver');
});

test('nothing claims a scan of the whole world', () => {
  const offenders = [];
  for (const f of pages().concat(['README.md'])) {
    const copy = f.endsWith('.md') ? read(f) : copyOf(f);
    for (const re of [/scans? the (entire|whole) world/i, /every hazard everywhere/i,
      /complete global coverage/i, /monitors? every (disaster|hazard)\b/i]) {
      if (re.test(copy)) offenders.push(f + ' :: ' + re);
    }
  }
  assert.deepEqual(offenders, [], 'these claim coverage the providers cannot deliver');
});

test('where the README claims global reach it also states the limit', () => {
  const r = read('README.md');
  assert.match(r, /no global cell-by-cell scan/i,
    'the README lists global sources without saying what none of them covers');
  assert.match(r, /not evidence that the\s+place is quiet|not evidence that the place is quiet/i,
    'the README does not say how to read an absence of records');
  // And the provider rows state their own bounds rather than implying global.
  assert.match(r, /Atlantic and eastern\/central Pacific basins only/,
    'the hurricane feed is listed without its basins');
  assert.match(r, /US observatory network only/,
    'the volcano feed is listed without its network');
});

/* ------------------------------------------------- claims about the record */

test('no page offers a track record the verification page does not have', () => {
  const offenders = [];
  for (const f of pages()) {
    if (f === 'accuracy.html') continue;   // the page that reports it, with its caveats
    const copy = copyOf(f);
    for (const re of [/proven track record/i, /\d+% accurate/i, /our accuracy is/i,
      /See verified, partial, false-alarm and missed-event outcomes/i]) {
      if (re.test(copy)) offenders.push(f + ' :: ' + re);
    }
  }
  assert.deepEqual(offenders, [],
    'these promise verified outcomes the verification page reports none of');
});

test('nothing presents a forecast as under verification while none can be graded', () => {
  const offenders = [];
  for (const f of pages()) {
    if (/Under verification/i.test(copyOf(f)) || /Under verification/i.test(read(f))) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    'these say grading is under way; nothing recorded can be graded until the observed ledger covers it');
});

/* ------------------------------------- the positioning the project stands on */

test('the project describes itself as experimental verification, not prediction', () => {
  const r = read('README.md');
  assert.match(r, /experimental forecast-verification/i,
    'the README no longer positions this as experimental verification');
  assert.equal(/reliable (advance )?prediction/i.test(r), false,
    'the README claims reliable advance prediction');
});

test('an outlook is never described as a prediction made ahead of its signal', () => {
  const detail = read('forecast-detail.html');
  assert.match(detail, /Nothing here is a prediction made ahead of that signal/,
    'the forecast detail page no longer distinguishes an outlook from a prediction');
});
