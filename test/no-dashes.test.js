'use strict';
/**
 * No em or en dash in the code, copy or docs: a hyphen instead.
 *
 * Every tracked text file outside data/ and vendor/ is read. data/ holds
 * records, some of them frozen forecasts whose wording must never change
 * after the fact, and text quoted from the agencies; vendor/ is third-party
 * code. A dash typed as a character fails, and so does one written as a
 * \u escape (a placeholder written that way still prints one), except inside
 * a regex character class or alternation, where it only recognises dashes in
 * text that comes from elsewhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const ESC = /\\u201[34]/g;
/* Built here, so this file holds no dash of its own. */
const EM = String.fromCharCode(0x2014), BS = String.fromCharCode(92);
const escOf = code => BS + 'u' + code;

/* The one exception: ND-001's area, as its commit froze it on 13 September
   and as data/outlook-ledger.json records it. A frozen forecast's geography
   is never reworded after the fact, and the feed must serve the claim it
   froze, so this line keeps its en dash. */
const FROZEN = [['api/events.js', "region: 'Hu" + String.fromCharCode(0x1ebf, 0x2013, 0x110, 0xe0) + ' N' + String.fromCharCode(0x1eb5) + "ng corridor'"]];
const frozen = (f, line) => FROZEN.some(([file, text]) => file === f && line.includes(text));

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => f && !f.startsWith('data/') && !f.startsWith('vendor/'));
}

/** An escape that sits in a regex [...] class or right after a | only matches. */
function matchesOnly(line, at) {
  const before = line.slice(0, at);
  const open = before.lastIndexOf('['), close = before.lastIndexOf(']');
  return (open > close && before.lastIndexOf('/', open) >= 0) || /\|$/.test(before);
}

test('no tracked text file outside data/ and vendor/ has an em or en dash', () => {
  const bad = [];
  for (const f of tracked()) {
    let buf;
    try { buf = fs.readFileSync(path.join(ROOT, f)); } catch (e) { continue; }
    if (buf.includes(0)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (DASH.test(line) && !frozen(f, line)) bad.push(f + ':' + (i + 1) + ' has a dash character');
      for (const m of line.matchAll(ESC)) {
        if (!matchesOnly(line, m.index)) bad.push(f + ':' + (i + 1) + ' prints a dash through ' + m[0]);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('the frozen ND-001 area the guard allows is the one the ledger froze', () => {
  const row = require(path.join(ROOT, 'data', 'outlook-ledger.json')).find(r => r.id === 'ND-001');
  assert.equal("region: '" + row.region + "'", FROZEN[0][1], 'the allowed text is not the frozen record');
  assert.ok(fs.readFileSync(path.join(ROOT, 'api', 'events.js'), 'utf8').includes(FROZEN[0][1]), 'the feed no longer serves the frozen area');
});

test('the guard catches what it is for, and passes what it allows', () => {
  assert.ok(DASH.test('Ends ' + EM + ' 13 Nov'));
  const placeholder = "x = '" + escOf('2014') + "';";
  assert.equal(matchesOnly(placeholder, placeholder.indexOf(BS)), false, 'a placeholder escape must fail');
  const cls = 's.replace(/[' + BS + 's,;:' + escOf('2014') + "-]+$/, '')";
  assert.equal(matchesOnly(cls, cls.indexOf(escOf('2014'))), true, 'an escape in a regex class only matches');
  const alt = '/every (?:to|-|' + escOf('2013') + '|and)/';
  assert.equal(matchesOnly(alt, alt.indexOf(escOf('2013'))), true, 'an escape in an alternation only matches');
});
