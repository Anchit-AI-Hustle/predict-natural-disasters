'use strict';
/**
 * Launch audit A5 and A6, the shared parts: one level per record, filters that
 * offer only levels that exist, a map key whose levels count reported events,
 * and agency levels said in the agency's own terms.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

async function portal() {
  const r = await renderPage('live-map.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#cards .event-card').length > 0 });
  return r;
}

test('A6: one function resolves a record’s level, and the chip, label and filter all use it', async () => {
  const r = await portal();
  const P = r.window.PND;
  const cases = [
    [{ severity: 'Severe', alert: 'Orange' }, 'SEVERE'],
    [{ alert: 'Orange' }, 'MODERATE'],
    [{ severity: 'Informational', alert: 'Red' }, 'LOW'],
    [{}, 'UNKNOWN']
  ];
  for (const [e, k] of cases) {
    assert.equal(P.riskKey(e), k, JSON.stringify(e));
    assert.equal(P.matchesRiskLevel(e, k), true);
    const label = k === 'UNKNOWN' ? 'Not rated' : r.window.PNDRisk.BY_KEY[k].label;
    assert.equal(P.riskLabel(e), label);
    assert.match(P.riskTag(e), new RegExp('>' + label + '<'));
  }
  r.close();
});

test('A6: a level an agency set is said in the agency’s terms', async () => {
  const r = await portal();
  const P = r.window.PND;
  assert.equal(P.riskWords({ source: 'USGS', type: 'Earthquake', alert: 'Green', severity: 'Informational', pagerAlert: 'green' }),
    'Low expected impact (USGS PAGER green)');
  assert.equal(P.riskWords({ source: 'USGS', type: 'Earthquake', alert: 'Green', severity: 'Informational' }),
    'Low (no USGS PAGER impact alert issued)');
  assert.equal(P.riskWords({ source: 'GDACS', type: 'Tropical Cyclone', alert: 'Green', severity: 'Informational' }),
    'Low expected impact (GDACS green)');
  assert.equal(P.riskWords({ source: 'GDACS', type: 'Flood', alert: 'Orange', severity: 'Moderate' }),
    'Moderate expected impact (GDACS orange)');
  /* Where this site, not the agency, set the level, it is only the level. */
  assert.equal(P.riskWords({ source: 'GDACS', type: 'Tropical Cyclone', alert: 'Green', severity: 'Extreme' }), 'Extreme');
  assert.equal(P.riskWords({ source: 'NASA EONET', type: 'Wildfire', alert: 'Green', severity: 'Informational' }), 'Low');
  assert.equal(P.riskWords({ forecast: true, source: 'GDACS', alert: 'Moderate', severity: 'Minor' }), 'Watch');
  r.close();
});

test('A5: a risk filter offers only the levels its records hold', async () => {
  const r = await portal();
  const P = r.window.PND;
  const html = P.riskLevelOptions('', [{ severity: 'Severe' }, { alert: 'Green' }]);
  const vals = [...html.matchAll(/value="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(vals, ['SEVERE', 'LOW']);
  /* The level the reader chose stays offered even once it is empty. */
  const kept = [...P.riskLevelOptions('HIGH', [{ alert: 'Green' }]).matchAll(/value="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(kept, ['HIGH', 'LOW']);
  /* Without records it is the whole scale, as before. */
  assert.equal([...P.riskLevelOptions('').matchAll(/<option/g)].length, 7);
  r.close();
});

test('A5: the risk filter on a list page drops levels the feed does not hold', async () => {
  const r = await renderPage('events.html', { timeoutMs: 8000,
    waitFor: d => d.querySelectorAll('#cards .event-card, #cards article').length > 0 });
  const sel = r.document.getElementById('level');
  const offered = [...sel.options].map(o => o.value).filter(Boolean);
  const have = new Set((await (await r.window.fetch('/api/events')).json()).events
    .filter(e => e.live !== false).map(e => r.window.PND.riskKey(e)));
  assert.ok(offered.length > 0);
  for (const v of offered) assert.ok(have.has(v), v + ' is offered but nothing in the feed is at that level');
  assert.ok(!offered.includes('HIGH'), 'High is offered over a feed with nothing at High');
  r.close();
});
