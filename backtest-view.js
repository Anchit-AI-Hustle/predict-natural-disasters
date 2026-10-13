/* What the track record shows of the forecast models' backtest.
 *
 * data/model-backtest.json scores the models day by day on forecasts that were
 * really issued 3 and 5 days ahead. This turns its counts into the figures the
 * page prints, each next to what chance would have managed: a forecaster with
 * no skill who warned on the same number of days, picked at random, catches
 * the days that came at the rate it warns, and is right as often as the
 * weather crosses the line anyway. Anything that cannot support those figures
 * gives null, and the page says "Not yet available" instead of a number.
 */
(function () {
'use strict';

const HAZARDS = [
  ['heat', 'Extreme heat', 'a daily high at or above the place’s 95th percentile for the date'],
  ['rain', 'Heavy rain', 'rain at or above the place’s 99th percentile for the month, and at least 10 mm'],
  ['fire', 'Wildfire weather', 'a Fire Weather Index in the “very high” class and at or above the place’s 95th percentile']
];
const LEADS = [3, 5];

const count = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);

/** One row per hazard and lead, or null when the scores cannot be shown. */
function rows(doc) {
  if (!doc || typeof doc !== 'object' || !doc.results || !(doc.places > 0)) return null;
  const out = [];
  for (const [hazard, label, threshold] of HAZARDS) {
    for (const lead of LEADS) {
      const t = doc.results[hazard + '@' + lead];
      if (!t) return null;
      const h = count(t.hits), m = count(t.misses), f = count(t.falseAlarms), c = count(t.correctNegatives);
      if ([h, m, f, c].some(v => v === null)) return null;
      const days = h + m + f + c;
      if (!days) return null;
      out.push({
        hazard, label, threshold, lead, days,
        happened: h + m, warned: h + f, hits: h,
        caught: h + m ? h / (h + m) : null,
        caughtByChance: (h + f) / days,
        rightWhenWarned: h + f ? h / (h + f) : null,
        rightByChance: (h + m) / days
      });
    }
  }
  return out;
}

const BV = { rows, HAZARDS, LEADS };
if (typeof window !== 'undefined') window.PNDBacktest = BV;
if (typeof module !== 'undefined' && module.exports) module.exports = BV;
})();
