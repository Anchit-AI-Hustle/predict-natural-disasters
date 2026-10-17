'use strict';
/**
 * The track record publishes the forecast models' backtest, and only what it
 * can show: each hazard at 3 and 5 days, how many days were scored, how often
 * the model caught the days that came, against what chance would have caught
 * issuing the same number of warnings, and the limits in plain words. It
 * never says the models predict disasters, and with no usable scores it says
 * "Not yet available" rather than printing a number.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, closeAllWindows } = require('./render.js');
const BV = require('../backtest-view.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model-backtest.json'), 'utf8'));

function openWith(body, status) {
  return renderPage('accuracy.html', {
    mock: {},
    waitFor: d => {
      const s = d.getElementById('btStatus');
      return !!s && s.dataset.state && s.dataset.state !== 'loading';
    },
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes('model-backtest.json') && body !== undefined) {
          return { ok: (status || 200) < 400, status: status || 200, headers: { get: () => null },
            json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
            text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
        }
        return real(input);
      };
    }
  });
}
const pct = v => Math.round(v * 100) + '%';

test('the rows come from the counts, with the chance baseline worked out the same way', () => {
  const rows = BV.rows(REAL);
  assert.equal(rows.length, 6);
  const h3 = rows.find(r => r.hazard === 'heat' && r.lead === 3);
  const t = REAL.results['heat@3'];
  assert.equal(h3.days, t.days);
  assert.equal(h3.caught, t.hits / (t.hits + t.misses));
  assert.equal(h3.caughtByChance, (t.hits + t.falseAlarms) / t.days, 'chance catches days at the rate warnings are issued');
  assert.equal(h3.rightWhenWarned, t.hits / (t.hits + t.falseAlarms));
  assert.equal(h3.rightByChance, (t.hits + t.misses) / t.days, 'chance is right as often as the event happens');
});

test('unusable scores give no rows at all', () => {
  assert.equal(BV.rows(null), null);
  assert.equal(BV.rows({}), null);
  const nulls = JSON.parse(JSON.stringify(REAL));
  for (const k of Object.keys(nulls.results)) Object.assign(nulls.results[k], { days: 0, hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0 });
  assert.equal(BV.rows(nulls), null, 'an all-null backtest was turned into rows');
});

test('the track record shows the real backtest: both horizons, sample sizes and the chance baseline', async () => {
  const r = await openWith(undefined);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  assert.equal(d.getElementById('btStatus').dataset.state, 'ready');
  const rows = [...d.querySelectorAll('#btRows tr')];
  assert.equal(rows.length, 6, 'one row per hazard and horizon');
  const all = rows.map(tr => tr.textContent).join('\n');
  assert.match(all, /3 days/); assert.match(all, /5 days/);
  const t = REAL.results['heat@3'];
  const heat3 = rows.find(tr => /Extreme heat/.test(tr.textContent) && /3 days/.test(tr.textContent)).textContent;
  assert.ok(heat3.includes(t.days.toLocaleString('en-GB')), 'sample size missing: ' + heat3);
  assert.ok(heat3.includes(pct(t.hits / (t.hits + t.misses))), 'hit rate missing: ' + heat3);
  assert.ok(heat3.includes(pct((t.hits + t.falseAlarms) / t.days)), 'chance baseline missing: ' + heat3);
  const section = d.getElementById('backtest').textContent;
  assert.match(section, /experimental/i);
  assert.ok(section.includes(String(REAL.places)), 'number of places missing');
  assert.match(section, /not disasters|does not forecast disasters|not whether a disaster/i, 'the limit that this is weather, not disasters, is missing');
  assert.ok(d.querySelectorAll('#btLimits li').length >= 4, 'the plain-language limits are missing');
  assert.doesNotMatch(section, /predicts? (natural )?disasters|predicted the disaster|accurately predict/i);
  r.close();
});

for (const [name, body, status] of [
  ['missing', '{"error":"not found"}', 404],
  ['empty', {}, 200],
  ['all-null', (() => { const n = JSON.parse(JSON.stringify(REAL)); for (const k of Object.keys(n.results)) Object.assign(n.results[k], { days: 0, hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0 }); return n; })(), 200],
  ['not JSON', 'not json', 200]
]) {
  test('with ' + name + ' backtest data the section says "Not yet available" and shows no figures', async () => {
    const r = await openWith(body, status);
    assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
    const d = r.document;
    assert.equal(d.getElementById('btStatus').dataset.state, 'empty');
    assert.match(d.getElementById('btStatus').textContent, /Not yet available/);
    assert.equal(d.querySelectorAll('#btRows tr').length, 0);
    assert.doesNotMatch(d.getElementById('backtest').textContent, /\d+%/, 'a percentage was shown without data');
    r.close();
  });
}

test('the test period is shown as plain dates, not as a midnight shifted into a time zone', async () => {
  /* The defect: "12 Jul 2026, 5:30 AM India Standard Time (IST)" for a
     window that is a run of whole days. West of UTC it read as the day
     before. */
  const r = await openWith(undefined);
  const s = r.document.getElementById('btStatus').textContent;
  const day = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  assert.ok(s.includes(day(REAL.window.from)) && s.includes(day(REAL.window.to)), s);
  assert.doesNotMatch(s, /\d{1,2}:\d{2}|\bAM\b|\bPM\b|IST|UTC|Standard Time/, 'a time or time zone was shown: ' + s);
  r.close();
});

test('on a phone each row stacks as labelled lines instead of a sideways-scrolling table', async () => {
  /* At 390px the eight columns scrolled 640px sideways inside their box,
     so a phone showed the hazard and the sample size and none of the
     results. Every cell carries its column name, and below 700px the
     rows become cards that print it. */
  const r = await openWith(undefined);
  const d = r.document;
  const heads = [...d.querySelectorAll('#btTable thead th')].map(th => th.textContent);
  for (const tr of d.querySelectorAll('#btRows tr')) {
    assert.deepEqual([...tr.children].map(td => td.dataset.label), heads, 'a cell does not carry its column name');
  }
  const css = [...d.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const m = css.match(/@media\s*\(max-width:\s*700px\)\s*\{([^@]*#btTable[^@]*)\}/);
  assert.ok(m, 'no narrow-screen layout for the backtest table');
  assert.match(m[1], /#btTable\s+thead\s*\{[^}]*display:\s*none/, 'the header row should give way to the labels');
  assert.match(m[1], /#btTable\s+td::before\s*\{[^}]*content:\s*attr\(data-label\)/, 'the labels are not printed');
  r.close();
});

/* ---------------------------------------- the published model forecasts */
/*
 * Model forecasts are on /forecasts. The page said "None of their forecasts
 * is published on this site yet", and the disaster record said "Every
 * forecast we have published was about a danger already reported": both
 * untrue once the models' advance forecasts went up on 15 Oct. The page now
 * says they are published, and grades them from data/model-verdicts.json.
 */
function openWithVerdicts(verdicts, status) {
  return renderPage('accuracy.html', {
    mock: {},
    waitFor: d => { const s = d.getElementById('pubStatus'); return !!s && s.dataset.state && s.dataset.state !== 'loading'; },
    beforeParse(w) {
      const real = w.fetch;
      w.fetch = async (input) => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes('model-verdicts.json')) {
          const ok = verdicts !== undefined && (status || 200) < 400;
          return { ok, status: ok ? 200 : 404, headers: { get: () => null },
            json: async () => { if (!ok) throw new Error('not found'); return verdicts; }, text: async () => JSON.stringify(verdicts || {}) };
        }
        return real(input);
      };
    }
  });
}
const VERDICTS = {
  generatedAt: '2026-10-20T04:50:00Z',
  counts: { issued: 5, correct: 2, falseAlarms: 1, pending: 2, missedDays: 3 },
  outlooks: [
    { id: 'a', hazard: 'heat', verdict: 'correct' }, { id: 'b', hazard: 'heat', verdict: 'false alarm' },
    { id: 'c', hazard: 'heat', verdict: 'pending' }, { id: 'd', hazard: 'rain', verdict: 'correct' }, { id: 'e', hazard: 'fire', verdict: 'pending' }],
  misses: [{ placeId: 'x', hazard: 'heat', day: '2026-10-16' }, { placeId: 'y', hazard: 'heat', day: '2026-10-16' }, { placeId: 'x', hazard: 'rain', day: '2026-10-17' }]
};

test('the page says the model forecasts are published, and no longer that none are', async () => {
  const r = await openWithVerdicts(VERDICTS);
  const t = r.document.body.textContent;
  assert.doesNotMatch(t, /None of their forecasts is published/);
  assert.doesNotMatch(t, /Every forecast we have published was about a danger already reported/);
  assert.match(r.document.getElementById('backtest').textContent, /forecasts page/i);
  r.close();
});

test('published model forecasts are graded by hazard, misses and pending included', async () => {
  const r = await openWithVerdicts(VERDICTS);
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const d = r.document;
  assert.equal(d.getElementById('pubStatus').dataset.state, 'ready');
  const rows = [...d.querySelectorAll('#pubRows tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
  const heat = rows.find(c => /heat/i.test(c[0]));
  /* Published, correct, false alarms, missed days, waiting. */
  assert.deepEqual(heat.slice(1), ['3', '1', '1', '2', '1'], 'heat row: ' + heat.join(' | '));
  const rain = rows.find(c => /rain/i.test(c[0]));
  assert.deepEqual(rain.slice(1), ['1', '1', '0', '1', '0']);
  r.close();
});

test('with no grades yet, the section says so and shows no figures', async () => {
  for (const v of [undefined, { counts: { issued: 4, correct: 0, falseAlarms: 0, pending: 4, missedDays: 0 }, outlooks: [], misses: [] }]) {
    const r = await openWithVerdicts(v);
    const s = r.document.getElementById('pubStatus');
    assert.equal(s.dataset.state, 'empty', JSON.stringify(v));
    assert.match(s.textContent, /not (yet )?been graded|Not yet graded/i);
    assert.equal(r.document.querySelectorAll('#pubRows tr').length, 0);
    r.close();
  }
});
