/* One risk scale, in one place.
 *
 * The site had grown four of them. The nav badges used
 * critical/veryhigh/high/moderate/watch/routine/neutral over one set of
 * hexes, the severity pills used sev-extreme/severe/moderate/minor over a
 * second, the timeline bars a third, and the accuracy page a fourth inline in
 * its own <style>. Two of them disagreed about direction: `.badge.watch` was
 * blue (#4aa3df) while `.sev-moderate` was yellow, so the same underlying
 * level looked calmer in one table than in the next, and a reader comparing
 * two pages was comparing two scales.
 *
 * Worse, the map encoded risk in hue alone -- a circle marker coloured red,
 * orange or green and nothing else. For the eight percent of men with a
 * red-green deficiency that map carries no risk information at all.
 *
 * So: six levels, one palette, and every rendering carries colour AND text
 * AND a shape. The shapes are drawn in CSS from the ink colour rather than
 * written as glyph characters, because a glyph in a ::before is read out by
 * screen readers and "black diamond suit High" is not what the level is
 * called.
 *
 * Provenance -- who said it, and how -- is deliberately NOT on this scale.
 * An official warning is not a risk level, and painting it red would state a
 * severity nobody published. Those badges stay neutral and outlined.
 *
 * Loaded as a plain script in the browser (window.PNDRisk) and required by
 * the tools and tests.
 */
(function () {

  /* The ink is not a taste decision: it is whichever of black or white clears
     4.5:1 against its own swatch, measured in test/risk.test.js. On the dark
     page background SEVERE is 2.6:1 and EXTREME 2.9:1, so neither may be used
     as text or as a bare border - these are filled swatches with chosen ink,
     which is why every level here carries one. */
  var LEVELS = [
    { key: 'LOW',      label: 'Low',      colour: '#22C55E', ink: '#000000', rank: 1,
      shape: 'circle',   shapeName: 'filled circle' },
    { key: 'WATCH',    label: 'Watch',    colour: '#FACC15', ink: '#000000', rank: 2,
      shape: 'ring',     shapeName: 'ring' },
    { key: 'MODERATE', label: 'Moderate', colour: '#F97316', ink: '#000000', rank: 3,
      shape: 'triangle', shapeName: 'triangle' },
    { key: 'HIGH',     label: 'High',     colour: '#EF4444', ink: '#000000', rank: 4,
      shape: 'diamond',  shapeName: 'diamond' },
    { key: 'SEVERE',   label: 'Severe',   colour: '#B91C1C', ink: '#FFFFFF', rank: 5,
      shape: 'hexagon',  shapeName: 'hexagon' },
    { key: 'EXTREME',  label: 'Extreme',  colour: '#7C3AED', ink: '#FFFFFF', rank: 6,
      shape: 'star',     shapeName: 'star' }
  ];

  /* Not a seventh risk level: the absence of one.
   *
   * An unrecognised label used to fall through to the amber "moderate" badge,
   * so 732 Green records in the live feed were painted as warnings while
   * their own text read Green. Nothing unrecognised is ever given a colour
   * from the scale above. */
  var UNKNOWN = { key: 'UNKNOWN', label: 'Not rated', colour: null, ink: null, rank: 0,
    shape: 'hollow', shapeName: 'hollow circle' };

  var BY_KEY = {};
  for (var i = 0; i < LEVELS.length; i++) BY_KEY[LEVELS[i].key] = LEVELS[i];
  BY_KEY.UNKNOWN = UNKNOWN;

  /*
   * Every vocabulary the providers and this app actually use, mapped onto the
   * six levels. Whole words only: "yellow" contains "low", and a substring
   * check painted a yellow alert as routine.
   *
   * Order matters twice over. "very high" contains "high", and
   * "catastrophic" must not be read as anything milder, so the strongest
   * patterns are tested first.
   *
   * A level whose NAME is a colour is painted that colour. The first version
   * of this table ranked the words on meaning alone and mapped GDACS Orange
   * onto HIGH and Red onto SEVERE - correct as an ordering, and measured in a
   * browser it produced a badge reading "Orange" filled in red beside one
   * reading "Moderate" filled in orange. A reader comparing two badges was
   * being asked to ignore the word on one of them. Green, Yellow, Orange, Red
   * and Purple therefore land on the swatch that matches, and the top two
   * levels are reached by words that are not colours - the impact-based
   * severities this site assigns from what was actually reported.
   */
  var VOCABULARY = [
    ['EXTREME',  /\b(?:extreme|catastrophic|very\s*high|purple)\b/i],
    ['SEVERE',   /\b(?:severe|critical)\b/i],
    ['HIGH',     /\b(?:high|red|significant)\b/i],
    ['MODERATE', /\b(?:moderate|orange)\b/i],
    ['WATCH',    /\b(?:watch|advisory|minor|yellow|amber|elevated)\b/i],
    ['LOW',      /\b(?:low|green|informational|routine|normal)\b/i]
  ];

  /** The level key a provider's word means, or UNKNOWN. */
  function levelOf(value) {
    var s = String(value === null || value === undefined ? '' : value);
    if (!s.trim()) return 'UNKNOWN';
    for (var i = 0; i < VOCABULARY.length; i++) {
      if (VOCABULARY[i][1].test(s)) return VOCABULARY[i][0];
    }
    return 'UNKNOWN';
  }

  /** The level record itself, never null. */
  function level(value) { return BY_KEY[levelOf(value)] || UNKNOWN; }

  /** The one class name that carries this level's colour and shape. */
  function classOf(value) { return 'risk-' + levelOf(value).toLowerCase(); }

  /** Where one level sits on the scale; 0 where it is not on it at all. */
  function rankOf(value) { return level(value).rank; }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /*
   * A risk badge: colour, text and shape, always all three.
   *
   * `text` is what the record itself says - "Red", "CATASTROPHIC", "Watch" -
   * because the six levels are a display scale and the provider's own word is
   * the fact. The scale is what makes two pages comparable; the word is what
   * makes the badge true. The shape span is empty and aria-hidden: it is
   * drawn from CSS, so it adds a second channel without adding a second
   * reading of the same thing.
   */
  function badge(value, opts) {
    var o = opts || {};
    var lv = level(value);
    var text = o.text === undefined || o.text === null
      ? (String(value || '').trim() || lv.label) : o.text;
    var extra = o.className ? ' ' + o.className : '';
    /* A caller with something more specific to say - the severity scale's own
       definition of the level, say - says it instead. */
    var title = o.title || (lv.key === 'UNKNOWN'
      ? 'No risk level was published for this record'
      : lv.label + ' on this site’s six-level risk scale');
    return '<span class="risk ' + classOf(value) + extra + '" title="' + esc(title) + '">' +
      '<i class="risk-shape" aria-hidden="true"></i>' + esc(text) + '</span>';
  }

  /** A badge for a level that has already been decided, by its key. */
  function badgeForLevel(key, opts) {
    var lv = BY_KEY[key] || UNKNOWN;
    var o = opts || {};
    var text = o.text === undefined || o.text === null ? lv.label : o.text;
    var extra = o.className ? ' ' + o.className : '';
    return '<span class="risk risk-' + lv.key.toLowerCase() + extra + '" title="' +
      esc(o.title || lv.label) + '">' +
      '<i class="risk-shape" aria-hidden="true"></i>' + esc(text) + '</span>';
  }

  /*
   * A map marker, on the same scale and with the same shape.
   *
   * Returned as the pieces a Leaflet divIcon needs rather than as a marker,
   * so this file never has to know whether Leaflet is present - the map pages
   * and the tests both build from the same description. The label is the
   * marker's accessible name: a dot whose only meaning is its hue is exactly
   * what this module exists to remove.
   */
  function markerIcon(value, label) {
    var lv = level(value);
    var name = (label ? label + ' - ' : '') + lv.label + ' risk';
    /* Low is the smallest mark and each level up is larger, so the few
       serious events stand out from the many routine ones around them. */
    var size = 9 + lv.rank * 3;
    return {
      className: 'risk-mk ' + classOf(value),
      html: '<span class="risk-shape" role="img" aria-label="' + esc(name) + '"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      level: lv.key,
      colour: lv.colour,
      label: name
    };
  }

  var R = { LEVELS: LEVELS, UNKNOWN: UNKNOWN, VOCABULARY: VOCABULARY, BY_KEY: BY_KEY,
    levelOf: levelOf, level: level, classOf: classOf, rankOf: rankOf,
    badge: badge, badgeForLevel: badgeForLevel, markerIcon: markerIcon };
  if (typeof window !== 'undefined') window.PNDRisk = R;
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})();
