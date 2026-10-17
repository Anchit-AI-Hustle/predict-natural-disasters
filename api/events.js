'use strict';
/* Query parameters from req.url, never Vercel's url.parse()-based req.query. */
const { queryOf } = require('./_lib/http.js');
/**
 * Unified live global hazard feed.
 *
 * Every upstream is fetched independently and failures are isolated, so a
 * single provider outage degrades coverage instead of emptying the feed — and,
 * critically, it never collapses the experimental outlook set down to a single
 * record, which is what happened when outlook generation depended on GDACS
 * alone.
 *
 * CommonJS on purpose (see api/verified-support.js for why).
 */

const UA = 'PredictNaturalDisasters/2.0 (+https://predict-natural-disasters.anchit-tandon.com)';
const FETCH_TIMEOUT_MS = 6500;   // keep total wall-clock inside the function limit
let HAZARD_MODEL = null;
try { HAZARD_MODEL = require('../hazard-model.js'); } catch (e) { HAZARD_MODEL = null; }

// The append-only record of every outlook ever published, committed to the
// repository by the refresh job. Loaded defensively for the same reason as the
// hazard model: a missing file must not take the feed down.
let OUTLOOK_LEDGER = null;
try { OUTLOOK_LEDGER = require('../data/outlook-ledger.json'); } catch (e) { OUTLOOK_LEDGER = null; }
let FORECAST_CHANGES;
try { FORECAST_CHANGES = require('../data/forecast-changes.json'); }
catch (e) { FORECAST_CHANGES = null; }
const MODEL_RUN_MAX_AGE_MS = 36 * 3600e3;
let MODEL_OUTLOOKS;
try { MODEL_OUTLOOKS = require('../data/model-outlooks.json'); }
catch (e) { MODEL_OUTLOOKS = null; }

/* A bound against a runaway upstream, not a quota. At 24 it was the latter:
   measured on the live feed of 26 September 2026, 40 active official signals
   had an outlook window still open, one per place and hazard, and the 16
   ranked lowest - green-level floods and wildfires, and two tropical storms -
   were never published, with nothing anywhere saying so. Anything this bound
   still withholds is counted in meta.outlooksWithheld. */
const MAX_OUTLOOKS = 120;
const OUTLOOK_HORIZON_HOURS = 72;
/* GDACS's hazard codes, asked one at a time: tropical cyclone, earthquake,
   flood, volcano, drought, wildfire. */
const GDACS_EVENT_TYPES = ['TC', 'EQ', 'FL', 'VO', 'DR', 'WF'];
/* The most events GDACS's search answers with at once - measured: the
   single all-hazard search came back with exactly 100. */
const GDACS_PAGE_SIZE = 100;
const GDACS_MAX_PAGES = 3;
const AFTERSHOCK_HORIZON_HOURS = 168;

/* ------------------------------------------------------------------ utils */

const iso = d => new Date(d).toISOString().slice(0, 10);
/*
 * A number a provider published, or null where it published none.
 *
 * `+null` and `+''` are both 0, so the one-line version of this turned every
 * absent field into a measurement: a storm the hurricane centre had not yet
 * given a track was served as moving NORTH at 0 kt, a coordinate left blank
 * became 0,0 off West Africa, and an empty depth read as a surface quake.
 * Two callers below had already been bitten and guard for it themselves;
 * every other caller was still exposed. A genuine 0 is still 0.
 */
const num = v => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
};

async function timedFetch(url, opts) {
  const o = opts || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeout || FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: Object.assign({ accept: 'application/json', 'user-agent': UA }, o.headers || {})
    });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 220); } catch (e) { /* body unreadable */ }
      throw new Error('HTTP ' + r.status + (detail ? ' — ' + detail : ''));
    }
    return o.text ? await r.text() : await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function tag(name, block) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return m ? decodeXml(m[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Mean of a GeoJSON geometry's coordinates — good enough to place an alert polygon. */
/* A point guaranteed to lie inside the shape, which the mean of its vertices
   is not: for a C-shaped or multipart warning area the mean lands in the gap.
   That is tolerable for a map pin but not for the source link, which opens the
   National Weather Service's point forecast for exactly that coordinate — from
   outside the polygon it shows a location with no warning and omits the very
   alert the reader clicked through from.

   Rings are taken from the geometry, the centroid is used when it is actually
   inside one, and otherwise a horizontal scanline is run through the middle of
   the largest ring and the midpoint of its first crossed span taken, which is
   interior for any simple polygon. */
/* Polygons, each kept as its exterior ring plus its holes. The first version
   of this flattened every ring into one list and accepted a point inside any
   of them — so for a warning area with a hole, a point sitting in the hole
   passed, because it is also inside the exterior. GeoJSON defines a hole as
   outside the geometry, so that link could still open an unwarned location. */
function polygonsOf(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const isRing = c => Array.isArray(c) && c.length > 2 &&
    Array.isArray(c[0]) && typeof c[0][0] === 'number';
  const isPolygon = c => Array.isArray(c) && c.length && isRing(c[0]);
  const out = [];
  const walk = c => {
    if (!Array.isArray(c)) return;
    if (isPolygon(c)) { out.push({ outer: c[0], holes: c.slice(1) }); return; }
    c.forEach(walk);
  };
  walk(geometry.coordinates);
  return out;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Inside the shape means inside an exterior ring and outside every one of that
   polygon's holes. */
function inPolygon(lon, lat, poly) {
  if (!inRing(lon, lat, poly.outer)) return false;
  return !poly.holes.some(h => inRing(lon, lat, h));
}

/* A horizontal scanline, with the holes cutting it as well as the exterior.
   Sampling only the exterior's crossings meant a hole wider than the sampled
   midpoints swallowed every candidate: an outer square from -10 to 10 with a
   hole from -9 to 9 left a 1-unit rim that no sampled midpoint ever landed in.
   Every ring contributes its crossings, so the spans between them alternate
   correctly and the rim is found. */
function crossings(ring, lat) {
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x1 = ring[j][0], y1 = ring[j][1], x2 = ring[i][0], y2 = ring[i][1];
    if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
  }
  return xs;
}

function scanlinePoint(poly) {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly.outer) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  /* Several latitudes, because one line can graze a vertex or run along an
     edge; each is checked span by span against the real shape. */
  for (let k = 1; k < 16; k++) {
    const lat = lo + (hi - lo) * (k / 16);
    const xs = crossings(poly.outer, lat);
    for (const h of poly.holes) xs.push(...crossings(h, lat));
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n++) {
      const lon = (xs[n] + xs[n + 1]) / 2;
      if (Number.isFinite(lon) && inPolygon(lon, lat, poly)) return { lat, lon };
    }
  }
  return null;
}

function insidePoint(geometry, mean) {
  const polys = polygonsOf(geometry);
  if (!polys.length) return mean || null;
  if (mean && polys.some(p => inPolygon(mean.lon, mean.lat, p))) return mean;
  const ordered = polys.slice().sort((a, b) => boxArea(b.outer) - boxArea(a.outer));
  for (const p of ordered) {
    const pt = scanlinePoint(p);
    if (pt) return pt;
  }
  /* No verified interior point. The mean has already been rejected, so
     returning it would be handing back the coordinate this function exists to
     avoid. Nothing is better than somewhere wrong: the caller sends the reader
     to the agency's own front page instead. */
  return null;
}

function boxArea(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return (x1 - x0) * (y1 - y0);
}

/*
 * A warning polygon is carried to the browser so a saved place can be tested
 * against it. Some National Weather Service forecast zones are drawn in fine
 * detail - coastlines, river banks - and a day of widespread severe weather
 * puts hundreds of alerts in one response, so the shapes are budgeted.
 *
 * Over budget the shape is dropped, not simplified. A simplified boundary
 * moves the edge of a warned area, which would let this file tell someone
 * they are covered by a warning that does not cover them. Without the shape
 * the record falls back to its zone centroid and the interface says that
 * applicability could not be established, which is true.
 */
const GEOMETRY_VERTEX_BUDGET = 3000;

function countVertices(g) {
  if (!g) return 0;
  if (g.type === 'GeometryCollection') {
    return (g.geometries || []).reduce((n, x) => n + countVertices(x), 0);
  }
  const walk = a => (Array.isArray(a)
    ? (typeof a[0] === 'number' ? 1 : a.reduce((n, x) => n + walk(x), 0))
    : 0);
  return walk(g.coordinates);
}

function boundedGeometry(g) {
  if (!g) return null;
  const n = countVertices(g);
  return (n > 0 && n <= GEOMETRY_VERTEX_BUDGET) ? g : null;
}

function centroid(geometry) {
  if (!geometry) return null;
  const pts = [];
  const walk = c => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { pts.push(c); return; }
    c.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!pts.length) return null;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

const GDACS_TYPES = { FL: 'Flood', EQ: 'Earthquake', TC: 'Tropical Cyclone', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire', TS: 'Tsunami' };
const gdacsHazardName = code => (GDACS_TYPES[code] || code).toLowerCase();

/** Normalise the many labels upstreams use into one hazard vocabulary. */
function normalizeType(raw, hint) {
  const t = String(raw || '').toLowerCase();
  const h = String(hint || '').toLowerCase();
  if (!t) return 'Natural Hazard';
  if (/tropical storm|tropical depression|hurricane|typhoon|cyclone/.test(h)) return 'Tropical Cyclone';
  if (/flash flood|flood|inundat/.test(t)) return 'Flood';
  if (/landslide|mudslide|debris flow/.test(t)) return 'Landslide';
  if (/tropical cyclone|hurricane|typhoon|tropical storm|tropical depression/.test(t)) return 'Tropical Cyclone';
  if (/tornado/.test(t)) return 'Tornado';
  /* A Special Marine Warning is the weather service's thunderstorm warning
     for water: strong winds, hail or waterspouts. It was being published as
     a hazard type of its own. */
  if (/marine warning/.test(t)) return 'Severe Storm';
  if (/severe (thunder)?storm|thunderstorm|severe weather|wind|hail|blizzard|winter storm|snow/.test(t)) return 'Severe Storm';
  if (/wildfire|bushfire|fire weather|\bfires?\b/.test(t)) return 'Wildfire';
  if (/volcan/.test(t)) return 'Volcano';
  if (/earthquake|seismic/.test(t)) return 'Earthquake';
  if (/tsunami/.test(t)) return 'Tsunami';
  if (/drought/.test(t)) return 'Drought';
  if (/heat/.test(t)) return 'Extreme Heat';
  if (/cold|freeze|frost/.test(t)) return 'Extreme Cold';
  if (/ice|iceberg|sea and lake ice/.test(t)) return 'Ice';
  if (/dust|haboob|sand/.test(t)) return 'Dust Storm';
  if (/epidemic|cholera|disease/.test(t)) return 'Epidemic';
  return String(raw).replace(/\b\w/g, c => c.toUpperCase()).slice(0, 48);
}

/*
 * Is this EONET "Severe Storms" event a tropical cyclone, and in which basin?
 *
 * EONET files every storm under one category, so its cyclones - the ones the
 * US Joint Typhoon Warning Center tracks in the Indian Ocean, the western
 * Pacific and the southern hemisphere - were published here as "Severe
 * Storm". That took them out of every cyclone filter and search, and gave them
 * a severe storm's two-day outlook window rather than a cyclone's five: on
 * 26 September 2026 cyclone 01B in the Bay of Bengal, last fixed two days
 * earlier, was left with no outlook at all while its window was still open.
 *
 * Only the storm category is considered, so a wildfire named after a place
 * called Cyclone stays a wildfire, and a storm that has become extratropical
 * or post-tropical is no longer a tropical cyclone.
 *
 * The basin comes from what the warning centre published, not from the
 * position: JTWC names its product file for the basin (io0126 is the North
 * Indian Ocean's 1st storm of 2026) and its designation ends in the sea it
 * formed in - 01B is the Bay of Bengal, 02A the Arabian Sea.
 */
const JTWC_BASINS = {
  io: 'North Indian Ocean', wp: 'western North Pacific', sh: 'southern hemisphere',
  ep: 'eastern North Pacific', cp: 'central North Pacific', al: 'North Atlantic'
};
const JTWC_SUFFIX_SEAS = {
  B: 'Bay of Bengal, North Indian Ocean', A: 'Arabian Sea, North Indian Ocean',
  S: 'South Indian Ocean', P: 'South Pacific'
};
function eonetTropicalCyclone(category, title, sources) {
  if (!/severe storm/i.test(String(category || ''))) return null;
  const t = String(title || '');
  if (/extra-?tropical|post-?tropical/i.test(t)) return null;
  if (!/\b(tropical (cyclone|storm|depression)|super typhoon|typhoon|hurricane|cyclone)\b/i.test(t)) return null;
  const url = ((Array.isArray(sources) ? sources : []).map(s => s && s.url).find(Boolean)) || '';
  const file = (/\/jtwc\/products\/([a-z]{2})\d{4}/i.exec(url) || [])[1];
  const suffix = (/\b\d{2}([A-Z])\b/.exec(t) || [])[1];
  const basin = (suffix && JTWC_SUFFIX_SEAS[suffix]) || (file && JTWC_BASINS[file.toLowerCase()]) || '';
  return { basin };
}

/* ---------------------------------------------------------------- handler */

/**
 * Merge the same earthquake reported by several agencies.
 *
 * The United States Geological Survey, EMSC and GDACS all publish the same
 * seismic events, and the dedupe key below includes the source name -- so one
 * earthquake arrived three times and was counted three times. The live feed
 * showed exactly that: "M 6.5 - 126 km NNE of Teluknaga, Indonesia" from USGS
 * beside "M 6.5 - JAVA, INDONESIA" from EMSC, one quake counted twice.
 *
 * Origin time is what makes merging safe here. Two distinct earthquakes
 * essentially never share an origin time to within 45 seconds, a location
 * within 200 km and a magnitude within half a unit; agency solutions for one
 * quake routinely differ by that much. Only seismic records are merged: a GDACS
 * flood alert and a ReliefWeb situation report about the same flood describe
 * different things and are both worth keeping.
 */
const ORIGIN_MS = 45000, SAME_KM = 200, SAME_MAG = 0.5;
const SEISMIC_PRIORITY = ['USGS', 'EMSC', 'GDACS'];

/** How grave each alert word is, for comparing two agencies' assessments. */
const ALERT_STRENGTH = { Green: 1, Watch: 1, Moderate: 2, Orange: 3, High: 3, Red: 4 };

function kmBetween(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** The agency behind a record, so two of its own records are never merged. */
// USGS PAGER is the only impact alert level any authority actually issues for
// an earthquake. Magnitude is a measurement, not an alert, so it must never be
// turned into one here: an unassessed quake stays Green and is reported as the
// observation it is.
const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam',
  AS: 'American Samoa', MP: 'Northern Mariana Islands'
};
const US_PLACE_NAMES = new Set(Object.values(US_STATES));

/** Write any United States postal code in a place string out in full. */
function spellUsPlaces(text) {
  // Only after a separator: a bare two-letter match would rewrite the bearing in
  // "11 km NE of Brentwood" to Nebraska. A state code only ever follows a comma
  // or a semicolon in these feeds.
  return String(text || '').replace(/([,;]\s*)([A-Z]{2})\b/g,
    (m, sep, code) => (US_STATES[code] ? sep + US_STATES[code] : m));
}

/**
 * The part of a place after the last comma. For a United States record that is
 * a state, not a country — "Malibu, CA" was being counted as a country of its
 * own, so the United States appeared fourteen times in the country total.
 */
function placeFromTitle(title) {
  const parts = String(title || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const mid = parts.length >= 3 ? parts[parts.length - 2] : '';
  if (US_PLACE_NAMES.has(last)) {
    return { country: 'United States', admin1: last, admin2: mid, region: [mid, last].filter(Boolean).join(', ') };
  }
  // Anything else: treat the last part as the country and the one before it as
  // the area within it, which is how EONET writes its non-US titles.
  return { country: last, admin1: mid, admin2: '', region: [mid, last].filter(Boolean).join(', ') };
}

function splitUsPlace(place) {
  const tail = place.includes(',') ? place.split(',').pop().trim() : '';
  if (US_PLACE_NAMES.has(tail)) return { country: 'United States', admin1: tail };
  return { country: tail, admin1: '' };
}

/**
 * The structured measurement GDACS attaches to an event. Its unit depends on
 * the hazard, so it is mapped onto the field that hazard actually uses rather
 * than into one generic "severity" number that would mean different things on
 * different records.
 */
/**
 * Unit handling for the structured measurement GDACS attaches to an event.
 *
 * Matching one spelling and treating everything else as the target unit is a
 * guess, and a wrong guess here is not cosmetic: read 120 km/h as 120 knots and
 * a tropical storm is published as a category 4. The spellings are therefore
 * enumerated, and an unrecognised unit yields null so the measurement is left
 * off rather than published in the wrong unit.
 */
function normaliseUnit(u) {
  return String(u || '').toLowerCase().replace(/[\s._-]/g, '');
}

/** Factor converting a wind speed in `unit` to knots, or null if unrecognised. */
function knotsFactor(unit) {
  const u = normaliseUnit(unit);
  if (/^(kt|kts|kn|kns|knot|knots)$/.test(u)) return 1;
  // GDACS has been seen to label this Kph; km/h, kmh and kmph all occur in the
  // wild and none of them matched a test for the substring "km/h".
  if (/^(kph|kmh|km\/h|kmph|km\/hr|kmhr|kilometers?perhour|kilometres?perhour)$/.test(u)) return 1 / 1.852;
  if (/^(mph|mileperhour|milesperhour)$/.test(u)) return 0.8689762;
  if (/^(ms|m\/s|meters?persecond|metres?persecond)$/.test(u)) return 1.9438445;
  return null;
}

/** Factor converting an area in `unit` to hectares, or null if unrecognised. */
function hectaresFactor(unit) {
  const u = normaliseUnit(unit);
  if (/^(ha|hectare|hectares)$/.test(u)) return 1;
  if (/^(km2|km\u00b2|sqkm|kmsq|squarekilometers?|squarekilometres?)$/.test(u)) return 100;
  if (/^(m2|m\u00b2|sqm|squaremeters?|squaremetres?)$/.test(u)) return 0.0001;
  if (/^(acre|acres|ac)$/.test(u)) return 0.40468564;
  return null;
}

function gdacsMeasurement(sd, eventType) {
  const d = sd && typeof sd === 'object' ? sd : null;
  if (!d) return {};
  // num() is Number-based and Number('') is 0, so an empty measurement would
  // publish "Magnitude 0.0" or "0 kt" as though the agency had measured it.
  const raw = d.severity !== undefined && d.severity !== null && d.severity !== ''
    ? d.severity : d.Severity;
  if (raw === undefined || raw === null || raw === '') return {};
  const value = num(raw);
  if (value === null) return {};
  const unit = d.severityunit || d.severityUnit || '';
  const out = {};
  if (/^wf$/i.test(eventType)) {
    // Burned area: hectares or square kilometres depending on the feed.
    const f = hectaresFactor(unit);
    if (f !== null) out.areaHa = value * f;
  } else if (/^tc$/i.test(eventType)) {
    // Maximum sustained wind. The rest of the feed, and every Saffir-Simpson
    // threshold in the hazard model, is in knots.
    const f = knotsFactor(unit);
    // Rounding here promotes a cyclone across a Saffir-Simpson boundary before
    // anything classifies it: 118 Kph is 63.7 kt, a tropical storm, but rounds
    // to 64 kt and is published as a category 1. The converted value is kept,
    // and only its printed form is rounded.
    if (f !== null) out.windKt = value * f;
  } else if (/^eq$/i.test(eventType)) {
    // A magnitude carries no unit conversion, so nothing is being assumed.
    out.magnitude = value;
  }
  const text = d.severitytext || d.severityText;
  if (text) out.severityText = String(text);
  return out;
}

/**
 * Publish a count only where the source actually carried one.
 *
 * Coercing an absent field to 0 loses the difference between "the agency
 * reported no deaths" and "the agency reported nothing", and the page then
 * prints "Lives lost 0" — a claim nobody made. All 100 GDACS records in the
 * live feed were carrying a manufactured zero this way.
 */
function reportedCounts(specs) {
  const out = {};
  for (const [field, ...candidates] of specs) {
    for (const v of candidates) {
      // num() coerces null and '' to 0, which is the same manufactured zero
      // one layer down, so an empty value is rejected before it is parsed.
      if (v === undefined || v === null || v === '') continue;
      const n = num(v);
      if (n !== null) { out[field] = n; break; }
    }
  }
  return out;
}

function pagerLevel(raw) {
  const v = String(raw || '').toLowerCase();
  return v === 'red' ? 'Red' : (v === 'orange' || v === 'yellow') ? 'Orange' : 'Green';
}

function agencyOf(e) { return String(e.source || '').split(' ')[0]; }

/** How much a record actually carries, so the fullest one survives the merge. */
function reportRank(e) {
  const priority = SEISMIC_PRIORITY.indexOf(agencyOf(e));
  return [
    (e.deaths ? 4 : 0) + (e.affected ? 2 : 0) + (e.displaced ? 2 : 0) +
      (e.sourceUrl ? 1 : 0) + (e.country ? 1 : 0),
    priority === -1 ? -SEISMIC_PRIORITY.length : -priority
  ];
}

function mergeSeismicReports(events) {
  const groups = [], groupOf = new Map();
  for (const e of events) {
    const t = Date.parse(e.startedAt || '');
    const seismic = e.type === 'Earthquake' && !e.forecast &&
      Number.isFinite(e.magnitude) && Number.isFinite(t) &&
      Number.isFinite(e.lat) && Number.isFinite(e.lon);
    if (!seismic) continue;
    // Only ever merge across agencies. A catalogue already deduplicates
    // itself, so two records from one agency are two earthquakes by that
    // agency's own determination -- the live feed carries doublets 21 and 44
    // seconds apart that are genuinely separate events.
    const hit = groups.find(g =>
      Math.abs(g.t - t) <= ORIGIN_MS &&
      Math.abs(g.members[0].magnitude - e.magnitude) <= SAME_MAG &&
      kmBetween(g.members[0], e) <= SAME_KM &&
      !g.members.some(m => agencyOf(m) === agencyOf(e)));
    if (hit) { hit.members.push(e); groupOf.set(e, hit); }
    else { const g = { t, members: [e] }; groups.push(g); groupOf.set(e, g); }
  }
  for (const g of groups) {
    const ranked = g.members.slice().sort((a, b) => {
      const [ra, pa] = reportRank(a), [rb, pb] = reportRank(b);
      return rb - ra || pb - pa;
    });
    g.lead = ranked[0];
    /* Only the lead record survives, so anything only one agency publishes
       would go with the discarded copies. GDACS earthquakes now carry a
       magnitude, which makes them eligible to lead a group, and a GDACS record
       reporting deaths outranks the USGS one — taking the depth, the PAGER
       assessment and the tsunami flag with it. The page then read "USGS issued
       no impact assessment" while naming USGS as corroboration. These are
       measurements of the same earthquake, taken from the highest-ranked
       member that published each one. */
    /* Impact counts belong here too. reportRank weighs them with a truthy
       test, so an agency reporting an explicit zero gets no credit for it and
       need not lead — and that reported zero, which is a finding, would then
       vanish with its record. Only fields the leader does not already have are
       taken, so no agency's figure overwrites another's. */
    for (const f of ['depthKm', 'pagerAlert', 'tsunamiFlag', 'magnitude',
      'deaths', 'displaced', 'affected']) {
      if (g.lead[f] !== undefined && g.lead[f] !== null) continue;
      const donor = ranked.find(m => m[f] !== undefined && m[f] !== null);
      if (donor) g.lead[f] = donor[f];
    }
    /* The gravest assessment any member published stands, whichever record ends
       up leading. Only one direction was handled before: a GDACS Red that
       happened to lead kept its Red, but a GDACS Red with no impact count loses
       the lead to USGS on agency priority, and its Red then vanished from a
       record still naming GDACS as corroboration. Both directions are the same
       rule, so it is applied over every member rather than to the leader. */
    let strongest = g.lead.alert;
    for (const m of g.members) {
      if ((ALERT_STRENGTH[m.alert] || 0) > (ALERT_STRENGTH[strongest] || 0)) strongest = m.alert;
    }
    // A leader that has just inherited a PAGER assessment must not keep the
    // Green it carried before it had one.
    if (g.lead.pagerAlert) {
      const fromPager = pagerLevel(g.lead.pagerAlert);
      if ((ALERT_STRENGTH[fromPager] || 0) > (ALERT_STRENGTH[strongest] || 0)) strongest = fromPager;
    }
    g.lead.alert = strongest;

    const others = ranked.slice(1).map(m => m.source).filter(s => s !== g.lead.source);
    // Independent corroboration is worth stating, not discarding.
    if (others.length) g.lead.corroboratedBy = [...new Set(others)];
    /* The provider records this one record stands for.
     *
     * Only the lead survives the merge, so the feed's account of an
     * earthquake carries whichever agency's id happened to lead - and the
     * lead changes the moment another agency publishes a death toll, which
     * outranks agency priority outright. Measured: a USGS record at 25.49 and
     * a GDACS record at 25.51 are one quake; GDACS then reports 12 deaths,
     * takes the lead, and the feed serves a different id at a latitude that
     * rounds to a different degree. Anything keeping its own record of what
     * has been reported sees a second earthquake, and one disaster is counted
     * twice for ever. The members are named so that identity survives a
     * change of lead. */
    if (g.members.length > 1) {
      g.lead.mergedFrom = ranked.map(m => ({
        id: m.id, source: m.source || null,
        sourceUrl: m.sourceUrl || null, updated: m.updated || null
      }));
    }
  }
  // Rebuild in the caller's order so the newest-first sort survives the merge.
  return events.filter(e => { const g = groupOf.get(e); return !g || g.lead === e; });
}

/* Said once on every forecast, and stripped from list cards that say it for
   the whole page. */
const FORECAST_DISCLAIMER = 'This is our own estimate, not an official warning.';

/** "28 Sep 2026, 12:00 UTC" - a time a reader can read, in the zone it is in. */
function utcText(v) {
  const t = Date.parse(v || '');
  if (!Number.isFinite(t)) return 'an unknown time';
  const d = new Date(t);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' UTC';
}

/* What an outlook is called: the hazard, the place, the window. */
function nearText(e) {
  let p = placeLabel(e);
  if (!p) return '';
  // "in coastal waters from ...", not "in Coastal waters from ..."
  p = p.replace(/^(Coastal waters|Waters|Offshore)\b/, w => w.toLowerCase());
  return /^\d+\s*km\b/i.test(p) ? p : (e.type === 'Earthquake' ? 'near ' + p : 'in ' + p);
}
function outlookTitle(e, windowWords) {
  const kind = e.type === 'Tropical Cyclone' ? 'Storm risk from ' + e.title
    : e.type + ' risk ' + nearText(e);
  return kind.replace(/\s+$/, '') + ' — ' + windowWords + ' forecast';
}

/* ------------------------------------------------ plain names and places */

/*
 * What a reader sees as a record's name and its place.
 *
 * The providers name things in their own shorthand. The hurricane centre
 * titles a storm "HU Nolo"; GDACS titles it "Tropical Cyclone NOLO-26" and
 * repeats that title as the event's location, so the homepage listed a storm
 * as "Tropical Cyclone · Tropical Cyclone ODALYS-26". A drought's location was
 * "Drought in Austria, Belgium, ... Ukraine," with the provider's trailing
 * comma. None of that tells a reader where anything is.
 *
 * The fields the forecast ledger freezes - country, region, coordinates - are
 * left exactly as the source gave them, because a frozen claim's geography is
 * never rewritten. What changes is the name on the record and a separate
 * `place` field that says, in words, where it is.
 */
const CYCLONE_CODES = {
  HU: 'Hurricane', MH: 'Major Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression',
  STS: 'Subtropical Storm', SS: 'Subtropical Storm', SD: 'Subtropical Depression',
  PTC: 'Potential Tropical Cyclone', PC: 'Post-Tropical Cyclone', TY: 'Typhoon', STY: 'Super Typhoon'
};
const NUMBER_WORDS = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16,
  SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19
};
const TENS_WORDS = { TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50 };

/** "TWENTYTHREE" -> 23, "POLO" -> null. */
function numberWord(w) {
  const u = String(w || '').toUpperCase();
  if (NUMBER_WORDS[u]) return NUMBER_WORDS[u];
  for (const t of Object.keys(TENS_WORDS)) {
    if (u === t) return TENS_WORDS[t];
    if (u.startsWith(t) && NUMBER_WORDS[u.slice(t.length)] && NUMBER_WORDS[u.slice(t.length)] < 10) {
      return TENS_WORDS[t] + NUMBER_WORDS[u.slice(t.length)];
    }
  }
  return null;
}

const nameCase = w => String(w || '').toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** A storm's own name with the provider's markings taken off: "POLO-26" -> "Polo". */
function stormName(title) {
  let t = String(title || '').trim();
  t = t.replace(/^(?:HU|MH|TS|TD|STS|SS|SD|PTC|PC|TY|STY)\s+/, '');
  t = t.replace(/^(?:super typhoon|typhoon|major hurricane|hurricane|tropical storm|tropical depression|subtropical storm|subtropical depression|severe tropical storm|potential tropical cyclone|post-tropical cyclone|severe cyclonic storm|very severe cyclonic storm|cyclonic storm|cyclone|tropical cyclone)\s+/i, '');
  t = t.replace(/-\d{2}$/, '').trim();
  return t;
}

/* "VANCOUVER ISLAND, CANADA REGION" -> "Vancouver Island, Canada region". */
function unshout(text) {
  const out = String(text || '').replace(/\b(\d+) NM\b/g, '$1 nautical miles').replace(/\b[A-Z][A-Z'.]{2,}(?:\s+[A-Z][A-Z'.]*)*\b/g, run =>
    run.split(/\s+/).map((w, i) => {
      // A compass bearing ("8 km SSW of") stays as it is written.
      if (/^[NSEW]{1,3}$/.test(w)) return w;
      const l = w.toLowerCase();
      if (/^(of|the|and|near|off|region)$/.test(l) && i) return l;
      return l.charAt(0).toUpperCase() + l.slice(1);
    }).join(' '));
  return out.replace(/\b(Northwest|Northeast|Southwest|Southeast|North|South|East|West) Of\b/g, '$1 of')
    .replace(/ (Islands?|Coast|Sea|Border) Region\b/g, ' $1 region');
}

function plainTitle(e) {
  let t = String(e.title || '').replace(/\s+/g, ' ').trim();
  if (e.forecast) return t;
  if (e.type !== 'Tropical Cyclone') {
    // "Prescribed Fire CRAWFORD CORRAL Prescribed Fire, Tulare" - the
    // expansion of EONET's "RX" leaves the phrase twice.
    t = t.replace(/^(Prescribed Fire)\s+(.+?)\s+Prescribed Fire\b/i, '$1 $2');
    // A GDACS list of countries in a title ends in a stray comma.
    t = t.replace(/[\s,]+$/, '');
    const list = /^(Drought|Flood|Forest fires?|Wildfires?) in (.+)$/i.exec(t);
    if (list && list[2].split(',').length > 3) {
      const parts = list[2].split(',').map(x => x.trim()).filter(Boolean);
      t = list[1] + ' in ' + parts[0] + ', ' + parts[1] + ' and ' + (parts.length - 2) + ' other countries';
    }
    return unshout(t);
  }
  let m = /^(HU|MH|TS|TD|STS|SS|SD|PTC|PC|TY|STY)\s+(.+)$/.exec(t);
  if (m) return CYCLONE_CODES[m[1]] + ' ' + nameCase(m[2]);
  m = /^Tropical Cyclone\s+([A-Z0-9]+)(?:-\d{2})?$/.exec(t);
  if (m) {
    const n = numberWord(m[1]);
    // "01B" is a warning centre's number for an unnamed storm, kept as written.
    return 'Tropical Cyclone ' + (n !== null ? n : /\d/.test(m[1]) ? m[1] : nameCase(m[1]));
  }
  return t;
}

/*
 * Which body of water a point at sea is in. Coarse, and only ever used for a
 * storm, where the basin is the place a reader knows it by. The Central
 * American isthmus is the one boundary drawn by hand: south of it is the
 * Pacific, north of it the Caribbean.
 */
const SEAS = [
  // [name, south, north, west, east] - enclosed seas a reader names first.
  ['Caspian Sea', 36.5, 47.5, 46.5, 54.5], ['Black Sea', 40.5, 47, 27.5, 42],
  ['Persian Gulf', 24, 30.5, 48, 57], ['Red Sea', 12, 30, 32, 44],
  ['Mediterranean Sea', 30, 46, -6, 36.5], ['South China Sea', 0, 23, 105, 121],
  ['Sea of Japan', 34, 52, 127, 142]
];
function oceanName(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  for (const [name, s, n, w, e] of SEAS) if (lat >= s && lat <= n && lon >= w && lon <= e) return name;
  if (lat >= 66) return 'Arctic Ocean';
  if (lat <= -60) return 'Southern Ocean';
  if (lat >= 0) {
    if (lon >= 100 || lon < -180) return 'Western Pacific Ocean';
    if (lon >= 77) return 'Bay of Bengal';
    if (lon >= 40) return 'Arabian Sea';
    if (lon < -140) return 'Central Pacific Ocean';
    if (lon < -100) return 'Eastern Pacific Ocean';
    if (lon < -77) {
      const coast = lon >= -83 ? 8.5 : lon >= -87 ? 11 : lon >= -92 ? 14 : 16.5;
      return lat < coast ? 'Eastern Pacific Ocean' : (lat >= 18 && lon < -81 ? 'Gulf of Mexico' : 'Caribbean Sea');
    }
    return 'Atlantic Ocean';
  }
  if (lon >= 20 && lon < 135) return 'South Indian Ocean';
  if (lon >= 135 || lon < -70) return 'South Pacific Ocean';
  return 'South Atlantic Ocean';
}

/* The outlines abbreviate names to fit a small-scale map. */
const OUTLINE_NAMES = {
  'United States of America': 'United States', 'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic', 'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Dominican Rep.': 'Dominican Republic', 'Eq. Guinea': 'Equatorial Guinea', 'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Territories', 'N. Cyprus': 'Northern Cyprus',
  'S. Sudan': 'South Sudan', 'Solomon Is.': 'Solomon Islands', 'W. Sahara': 'Western Sahara',
  eSwatini: 'Eswatini', Macedonia: 'North Macedonia'
};
let WORLD = null;
/** The country a point falls in, from the same outlines the map draws; '' at sea. */
function countryAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  if (WORLD === null) {
    try {
      const fc = require('../world-countries.json');
      WORLD = (fc.features || []).map(f => ({ name: f.properties && f.properties.n, polys: polygonsOf(f.geometry) }))
        .filter(c => c.name && c.polys.length);
    } catch (e) { WORLD = []; }
  }
  for (const c of WORLD) if (c.polys.some(p => inPolygon(lon, lat, p))) return OUTLINE_NAMES[c.name] || c.name;
  return '';
}

/** "A, B, C, D," -> "A, B and 2 other countries". */
function countryListText(raw) {
  const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return parts[0] + ' and ' + parts[1];
  if (parts.length === 3) return parts[0] + ', ' + parts[1] + ' and ' + parts[2];
  return parts[0] + ', ' + parts[1] + ' and ' + (parts.length - 2) + ' other countries';
}

const NHC_BASIN_WORDS = { atlantic: 'Atlantic Ocean', 'eastern pacific': 'Eastern Pacific Ocean',
  'central pacific': 'Central Pacific Ocean', 'western pacific': 'Western Pacific Ocean',
  'indian ocean': 'Indian Ocean', 'southern hemisphere': '' };

/** Where a record is, in words a reader would use. */
function placeLabel(e) {
  const tidy = s => String(s || '').replace(/[\s,;·]+$/, '').replace(/\s+/g, ' ').trim();
  const title = tidy(e.sourceTitle || e.title).toLowerCase();
  let region = tidy(e.region);
  const country = tidy(e.country);
  // A region that only repeats the record's own name, or GDACS's "Flood in
  // Nepal", says nothing the country field does not.
  if (region && (region.toLowerCase() === title || region.toLowerCase() === tidy(e.title).toLowerCase() ||
    /^(floods?|droughts?|wildfires?|forest fires?|earthquakes?|volcan\w*|eruption|tropical cyclone)\b.*\bin\b/i.test(region) ||
    /^tropical cyclone\s/i.test(region))) region = '';
  // The hurricane centre's "Polo (eastern Pacific system 2)" is a storm name
  // and a basin; the basin is the place.
  // The weather service lists every county a warning covers.
  if (region.includes(';')) {
    const areas = region.split(';').map(tidy).filter(Boolean);
    region = areas[0] + (areas.length > 1 ? ' and ' + (areas.length - 1) + ' nearby area' + (areas.length > 2 ? 's' : '') : '');
  }
  const nhc = /\(([a-z ]+?) system \d+\)\s*$/i.exec(region);
  if (nhc) region = NHC_BASIN_WORDS[nhc[1].toLowerCase()] || '';
  /* A volcano record's region is the observatory that watches it. */
  const obs = /^(Alaska|Hawaiian|Cascades|California|Yellowstone|Northern Mariana Islands) Volcano Observatory$/i.exec(region);
  if (obs) region = { alaska: 'Alaska', hawaiian: 'Hawaii', cascades: 'Cascade Range',
    california: 'California', yellowstone: 'Yellowstone', 'northern mariana islands': 'Northern Mariana Islands' }[obs[1].toLowerCase()];
  region = unshout(region);
  const isStorm = e.type === 'Tropical Cyclone';
  if (isStorm) {
    const land = countryAt(e.lat, e.lon);
    const sea = land ? '' : (region && /ocean|sea|bay|gulf|pacific|atlantic/i.test(region)
      ? region.replace(/^(eastern|western|central|northern|southern)\b/, w => w[0].toUpperCase() + w.slice(1)) +
        (/ocean|sea|bay|gulf/i.test(region) ? '' : ' Ocean')
      : oceanName(e.lat, e.lon));
    /* A merged storm led by a report with no country keeps the countries
       another agency named in its path apart from its own (frozen) country;
       they are still where it may strike. */
    const inPath = country || tidy(e.affectedCountries);
    const affected = inPath ? countryListText(inPath) : '';
    if (land) return land;
    if (sea && affected) return sea + ' (may affect ' + affected + ')';
    return sea || affected;
  }
  const countries = unshout(country.includes(',') ? countryListText(country) : country);
  if (region && countries && region.toLowerCase().includes(country.toLowerCase())) return region;
  if (region && countries) return region + ', ' + countries;
  if (region || countries) return region || countries;
  return countryAt(e.lat, e.lon) || oceanName(e.lat, e.lon);
}

/*
 * Which countries a record belongs to, for anything that groups by country:
 * the source's own list where it gave one (for a merged storm, the countries
 * another agency named in its path), otherwise the country its coordinate
 * falls in, otherwise the sea it is in. Grouping on the raw field made
 * "Tropical Cyclone FAY-26" and "COLOMBIA" regions of their own.
 */
function countriesOf(e) {
  const listed = String(e.country || e.affectedCountries || '').split(',').map(s => unshout(s.trim())).filter(Boolean);
  const countries = listed.length ? listed : [countryAt(e.lat, e.lon)].filter(Boolean);
  return { countries, sea: countries.length ? '' : (oceanName(e.lat, e.lon) || '') };
}

/*
 * One storm, one record.
 *
 * Three agencies publish every active storm the hurricane centre tracks, and
 * two publish every other: measured on 28 September 2026, Hurricane Polo was
 * listed three times (NHC, GDACS, NASA EONET), and each copy was given its own
 * five-day outlook. The same rule as the earthquake merge: only ever across
 * agencies, the fullest record leads, and every member is named.
 */
const CYCLONE_PRIORITY = ['NOAA', 'GDACS', 'NASA'];
const SAME_STORM_KM = 600, SAME_STORM_MS = 2 * 864e5, NEAR_STORM_KM = 150;

function stormKey(e) {
  const n = stormName(e.sourceTitle || e.title).toLowerCase();
  const d = /^(\d{1,2})[a-z]?$/.exec(n);
  if (d) return 'n' + Number(d[1]);
  const w = numberWord(n);
  return w !== null ? 'n' + w : n;
}

function mergeCycloneReports(events) {
  const groups = [], groupOf = new Map();
  for (const e of events) {
    const t = Date.parse(e.updated || '');
    if (e.type !== 'Tropical Cyclone' || e.forecast || !Number.isFinite(t) ||
      !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const key = stormKey(e);
    const hit = groups.find(g => {
      const lead = g.members[0];
      if (g.members.some(m => agencyOf(m) === agencyOf(e))) return false;
      if (Math.abs(g.t - t) > SAME_STORM_MS) return false;
      const km = kmBetween(lead, e);
      return (key && key === g.key && km <= SAME_STORM_KM) || km <= NEAR_STORM_KM;
    });
    if (hit) { hit.members.push(e); groupOf.set(e, hit); }
    else { const g = { t, key, members: [e] }; groups.push(g); groupOf.set(e, g); }
  }
  let merged = 0;
  for (const g of groups) {
    if (g.members.length < 2) { g.lead = g.members[0]; continue; }
    const rank = m => { const i = CYCLONE_PRIORITY.indexOf(agencyOf(m)); return i === -1 ? 99 : i; };
    const ranked = g.members.slice().sort((a, b) => rank(a) - rank(b) ||
      (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0));
    const lead = g.lead = ranked[0];
    for (const f of ['windKt', 'pressureMb', 'movementDirDeg', 'movementKt', 'deaths', 'displaced', 'affected']) {
      if (lead[f] !== undefined && lead[f] !== null) continue;
      const donor = ranked.find(m => m[f] !== undefined && m[f] !== null);
      if (donor) lead[f] = donor[f];
    }
    /* GDACS names the countries in a storm's forecast path. That is not the
       storm's own country, and the frozen country of any outlook already
       derived from the leader must not change, so it is kept apart. */
    if (!lead.country) {
      const withCountry = ranked.find(m => m.country);
      if (withCountry) lead.affectedCountries = withCountry.country;
    }
    /* GDACS calls every storm a "Tropical Cyclone"; the warning centres say
       which kind - a typhoon, a super typhoon, a hurricane. */
    if (/^Tropical Cyclone\s/.test(lead.title)) {
      const named = ranked.find(m => m !== lead && !/^Tropical Cyclone\s/.test(m.title) && stormKey(m) === stormKey(lead));
      if (named) { lead.sourceTitle = lead.sourceTitle || lead.title; lead.title = named.title; }
    }
    let strongest = lead;
    for (const m of ranked) if ((ALERT_STRENGTH[m.alert] || 0) > (ALERT_STRENGTH[strongest.alert] || 0)) strongest = m;
    /* The graver level is carried over with the agency that gave it. The
       lead's own source and link stay the lead's, so without this the badge
       said a GDACS Red was "published by NOAA" and linked to NOAA for it. */
    if (strongest !== lead) {
      lead.alert = strongest.alert;
      lead.alertBasis = strongest.alertBasis || 'issued';
      lead.alertSource = strongest.source || null;
      lead.alertSourceUrl = strongest.sourceUrl || null;
    }
    const others = ranked.slice(1).map(m => m.source).filter(s => s !== lead.source);
    if (others.length) lead.corroboratedBy = [...new Set(others)];
    lead.mergedFrom = ranked.map(m => ({ id: m.id, source: m.source || null,
      sourceUrl: m.sourceUrl || null, updated: m.updated || null }));
    merged += g.members.length - 1;
  }
  const out = events.filter(e => { const g = groupOf.get(e); return !g || g.lead === e; });
  out.mergedCycloneReports = merged;
  return out;
}

/*
 * Is a record still live?
 *
 * GDACS is asked for 120 days of events so that no active storm is lost to its
 * 100-result page, and NASA EONET leaves a wildfire open until someone closes
 * it. So the "live" feed carried floods whose last report was three months old
 * and storms that had dissipated weeks before, and counted all of them as live
 * events. A record that its own provider has not updated for longer than the
 * hazard ever goes quiet while it is still happening is kept - its page still
 * opens - but marked as no longer live, and says for how long it has been
 * silent.
 */
const LIVE_DAYS = {
  'Tropical Cyclone': 3, 'Severe Storm': 3, Tornado: 2, Earthquake: 7, Flood: 10,
  Landslide: 14, Wildfire: 10, Volcano: 45, Drought: 60, 'Extreme Heat': 7, 'Extreme Cold': 7
};
function markLive(events, nowMs) {
  let quiet = 0;
  for (const e of events) {
    if (e.forecast) continue;
    const t = Date.parse(e.updated || '');
    if (!Number.isFinite(t)) continue;
    const days = (nowMs - t) / 864e5;
    /* A humanitarian record is a response page opened when the disaster was
       declared; it stays current for weeks after its date. */
    const limit = e.humanitarian ? 60 : (LIVE_DAYS[e.type] || 14);
    /* An event its provider still expects to be running is live however
       long ago it started, and so is a warning its issuer has not yet let
       expire: the agency's own expiry is the better word on whether it is
       still in force than how long ago it was last reissued. */
    e.live = days <= limit || Date.parse(e.expectedEnd || '') > nowMs ||
      Date.parse(e.expiresAt || '') > nowMs;
    if (!e.live) {
      quiet++;
      e.quietDays = Math.floor(days);
    }
  }
  return quiet;
}

/** A GDACS location that is a place, not the event's name repeated. */
function gdacsPlace(location, name, description) {
  const l = String(location || '').trim();
  if (!l) return '';
  const same = v => v && String(v).trim().toLowerCase() === l.toLowerCase();
  return same(name) || same(description) ? '' : l;
}

/*
 * When GDACS last reported on an event.
 *
 * "todate" is the last day GDACS saw the event, except that a flood's can lie
 * in the future, where GDACS expects it to run to: a flood in Guinea was
 * published as updated at 01:00 the next morning, so it sorted first and a
 * forecast window was opened from a time that had not happened. A future end
 * date is kept, but as the expected end, and the report's own modification
 * time - or its start - stands as the update.
 */
function gdacsWhen(modified, to, from, now) {
  const nowMs = now.getTime();
  const m = gdacsTime(modified), t = gdacsTime(to), f = gdacsTime(from);
  const past = v => v && Date.parse(v) <= nowMs + 5 * 60e3;
  const out = {};
  if (t && !past(t)) out.expectedEnd = t;
  out.updated = (past(t) && t) || (past(m) && m) || (past(f) && f) || now.toISOString();
  return out;
}

/** GDACS writes "2026-09-29T01:00:00" with no zone; it means UTC. */
function gdacsTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const withZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : (/T\d/.test(s) ? s + 'Z' : s);
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** ?summary=1 asks for the meta block alone. */
function wantsLedger(req) {
  const v = queryOf(req).ledger;
  return v === '1' || v === 'true';
}

function wantsSummary(req) {
  const v = queryOf(req).summary;
  return v === '1' || v === 'true';
}

function isCron(req) {
  return !!queryOf(req).cron;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  /* One shared copy at Vercel's edge, never in a browser. Rebuilding the feed
     from every provider took 3 to 6 seconds, measured on the live site, and
     every visitor paid it: a detail page read "Loading event…" for that long
     and the homepage's forecast table for 13 seconds. A copy is rebuilt once
     it is 30 seconds old, and the stale one is served for up to a minute more
     while that happens, so no copy is older than 90 seconds. Pages print when
     their copy was made. The scheduled jobs ask with ?cron=<time> and the
     Refresh buttons with ?ts=<time>, so neither is ever served a copy. */
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=30, stale-while-revalidate=60');

  const now = new Date();
  const from = new Date(now.getTime() - 120 * 864e5);

  const out = {
    generatedAt: now.toISOString(),
    meta: {
      live: false,
      gdacs: false, usgs: false, eonet: false,
      sources: {},
      sourceCount: 0,
      coverage: 'Global terrestrial and coastal coverage; all countries and territories are supported by the UI, subject to upstream reporting.',
      forecasting: 'Experimental short-horizon risk outlooks are derived only from active official hazard signals. They are not deterministic predictions or emergency warnings.',
      /* The feed itself is recomputed from the upstream sources whenever the
         shared copy is more than 30 seconds old (see the handler's headers). What runs
         on a schedule is the written record — the ledger and the change log —
         and that is described by refreshRecorded, measured rather than
         declared. This field used to state a five-minute rate, which was the cron's
         request and about a fortieth of what GitHub actually granted it. */
      refreshTarget: 'recomputed when the last copy is more than 30 seconds old; no copy served is older than 90 seconds'
    },
    events: []
  };

  const push = e => {
    if (!e) return;
    const lat = num(e.lat), lon = num(e.lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    out.events.push(Object.assign({}, e, { lat, lon, type: e.type || 'Natural Hazard' }));
  };

  const mark = (key, ok, extra) => {
    out.meta.sources[key] = Object.assign({ ok: !!ok, checkedAt: now.toISOString() }, extra || {});
  };

  /* ------------------------------------------------------------ upstreams */

  /* GDACS is asked more than once per refresh (see the job below), and the
     same event can come back from two of those questions - so a record is
     published once per GDACS event id, however many answers carried it. */
  const gdacsSeen = new Set();
  const pushGdacs = rec => {
    if (gdacsSeen.has(rec.id)) return false;
    gdacsSeen.add(rec.id);
    push(rec);
    return true;
  };

  /* Resolves to how many events the answer listed and how many of them were
     new, because a page that listed only events already held is how an
     endpoint that ignores its page number shows it. */
  const parseGdacsJson = j => {
    const arr = Array.isArray(j) ? j : (j.features || j.data || j.results || []);
    let n = 0, listed = 0;
    const ids = [];
    for (const x of arr) {
      const p = x.properties || x;
      /* ?? rather than ||: a longitude or latitude of 0 is a place - the
         prime meridian, the equator - and || read it as missing and dropped
         the event. */
      let coords = (x.geometry && x.geometry.coordinates) || [p.longitude ?? p.lon, p.latitude ?? p.lat];
      if (!Array.isArray(coords) || Array.isArray(coords[0])) continue;
      const et = p.eventtype || p.eventType || p.type || 'Disaster';
      const eid = p.eventid || p.eventId || p.id;
      if (!eid) continue;
      const measured = gdacsMeasurement(p.severitydata || p.severityData, et);
      const counts = reportedCounts([
        ['deaths', p.death, p.deaths],
        ['displaced', p.displaced],
        ['affected', p.affected, p.population]
      ]);
      listed++;
      ids.push('gdacs-' + et + '-' + eid);
      if (pushGdacs({
        id: 'gdacs-' + et + '-' + eid,
        source: 'GDACS', sourceType: 'official',
        type: GDACS_TYPES[et] || normalizeType(et),
        title: p.name || p.title || p.eventname || (et + ' event'),
        country: p.country || p.countryname || p.iso3 || '',
        /* GDACS repeats the event's name as its description ("Flood in
           Nepal"), and that was being published as the place. */
        region: gdacsPlace(p.location, p.name || p.title || p.eventname, p.description),
        alert: p.alertlevel || p.alertLevel || 'Green',
        alertBasis: 'issued',
        lat: coords[1], lon: coords[0],
        startedAt: gdacsTime(p.fromdate || p.fromDate) || null,
        ...gdacsWhen(p.datemodified || p.dateModified, p.todate || p.toDate,
          p.fromdate || p.fromDate || p.date, now),
        details: [p.description || p.eventdescription || '', measured.severityText || '']
          .filter(Boolean).join(' · '),
        ...counts,
        ...measured,
        sourceUrl: 'https://www.gdacs.org/report.aspx?eventid=' + encodeURIComponent(eid) + '&eventtype=' + encodeURIComponent(et),
        rawId: eid, rawType: et
      })) n++;
    }
    return { listed, added: n, ids };
  };

  const parseGdacsRss = xml => {
    let n = 0, listed = 0;
    for (const m of String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
      const b = m[1];
      const lat = num(tag('geo:lat', b) || tag('lat', b));
      const lon = num(tag('geo:long', b) || tag('long', b));
      const et = tag('gdacs:eventtype', b) || 'Disaster';
      const eid = tag('gdacs:eventid', b) || tag('guid', b);
      if (lat === null || lon === null || !eid) continue;
      listed++;
      if (pushGdacs({
        id: 'gdacs-' + et + '-' + eid,
        source: 'GDACS', sourceType: 'official',
        type: GDACS_TYPES[et] || normalizeType(et),
        title: tag('title', b) || (et + ' event'),
        country: tag('gdacs:country', b) || '',
        region: gdacsPlace(tag('gdacs:location', b), tag('title', b), ''),
        alert: tag('gdacs:alertlevel', b) || 'Green',
        alertBasis: 'issued',
        lat, lon,
        startedAt: gdacsTime(tag('gdacs:fromdate', b)) || null,
        ...gdacsWhen(tag('pubDate', b), tag('gdacs:todate', b), tag('gdacs:fromdate', b), now),
        details: tag('description', b) || '',
        sourceUrl: tag('link', b) || 'https://www.gdacs.org/',
        rawId: eid, rawType: et
      })) n++;
    }
    return { listed, added: n };
  };

  const jobs = [];

  // 1. GDACS — multi-hazard global alerts: one hazard at a time, plus what is
  //    active now; the app endpoint and then RSS if the searches fail.
  //
  // It used to be one question - every hazard, every alert level, the last
  // 120 days - and GDACS answers a search with one page of at most 100
  // events. Measured on the live feed on 26 September 2026: exactly 100 GDACS
  // records, 63 of them wildfires, and neither Typhoon Dujuan in the western
  // North Pacific nor cyclone 01B in the Bay of Bengal among them, though
  // both were open storms that day. A busy wildfire season fills the page,
  // so a cyclone could be dropped for a grass fire on another continent.
  //
  // Now each hazard gets its own page, so none can crowd out another. A page
  // that comes back full is followed to the next, as far as GDACS_MAX_PAGES,
  // and a next page that lists nothing new ends it - which is also how an
  // endpoint that ignores the page number shows itself. GDACS's list of the
  // events active now is read as well, so a running event is carried even
  // where its hazard's history was cut short. And where it was, the scan says
  // so rather than reporting a clean sweep: see scanStatusOf.
  jobs.push((async () => {
    const searchUrl = (t, page) => 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=' + t +
      '&fromDate=' + iso(from) + '&toDate=' + iso(now) + '&alertlevel=Green;Orange;Red' +
      (page > 1 ? '&pagenumber=' + page : '');
    const byHazard = {}, incomplete = [], failed = {};
    const history = GDACS_EVENT_TYPES.map(async t => {
      const mine = new Set();
      for (let page = 1; page <= GDACS_MAX_PAGES; page++) {
        let r;
        try { r = parseGdacsJson(await timedFetch(searchUrl(t, page))); } catch (e) {
          if (page === 1) failed[t] = String(e.message || e);
          else incomplete.push(t);
          break;
        }
        const fresh = r.ids.filter(id => !mine.has(id));
        fresh.forEach(id => mine.add(id));
        if (r.listed < GDACS_PAGE_SIZE) break;
        if (page > 1 && !fresh.length) { incomplete.push(t); break; }
        if (page === GDACS_MAX_PAGES) incomplete.push(t);
      }
      if (!(t in failed)) byHazard[t] = mine.size;
    });
    const current = (async () => {
      try {
        return parseGdacsJson(await timedFetch('https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP'));
      } catch (e) { return null; }
    })();
    await Promise.all(history);
    const now4app = await current;
    const searched = Object.keys(byHazard).length;
    if (searched || now4app) {
      /* A hazard whose search failed outright was not read at all, which is
         as incomplete as a history cut short - unless the active list
         answered, in which case its running events are still carried. */
      Object.keys(failed).forEach(t => incomplete.push(t));
      out.meta.gdacs = true;
      mark('gdacs', true, {
        records: gdacsSeen.size,
        endpoint: searched ? 'search' : 'events4app',
        byHazard,
        activeListed: now4app ? now4app.listed : null,
        incomplete: incomplete.sort(),
        ...(Object.keys(failed).length ? { failed } : {})
      });
      return;
    }
    try {
      const r = parseGdacsRss(await timedFetch('https://www.gdacs.org/xml/rss.xml', { text: true, headers: { accept: 'application/rss+xml, application/xml' } }));
      out.meta.gdacs = true; mark('gdacs', true, { records: r.added, endpoint: 'rss' });
    } catch (e) {
      mark('gdacs', false, { error: String(e.message || e) });
    }
  })());

  // 2. USGS — earthquakes, M2.5+ over the last 7 days.
  jobs.push((async () => {
    try {
      const j = await timedFetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson');
      let n = 0;
      for (const f of j.features || []) {
        const place = spellUsPlaces(f.properties.place || '');
        const { country, admin1 } = splitUsPlace(place);
        const mag = num(f.properties.mag);
        push({
          id: 'usgs-' + f.id,
          source: 'USGS', sourceType: 'official', type: 'Earthquake',
          title: spellUsPlaces(f.properties.title), country, admin1, region: place,
          /* USGS PAGER's own impact alert, renamed to this site's colours. */
          alert: pagerLevel(f.properties.alert),
          alertBasis: 'issued',
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
          startedAt: new Date(f.properties.time).toISOString(),
          updated: new Date(f.properties.updated || f.properties.time).toISOString(),
          details: 'Magnitude ' + (mag === null ? '—' : mag) + ' · depth ' +
            (f.geometry.coordinates[2] == null ? '—' : f.geometry.coordinates[2]) + ' km' +
            (f.properties.tsunami ? ' · tsunami flag issued' : '') +
            (f.properties.alert
              ? ' · USGS PAGER impact alert: ' + String(f.properties.alert).toLowerCase()
              : ' · no USGS PAGER impact alert issued'),
          sourceUrl: f.properties.url || '',
          magnitude: mag, depthKm: num(f.geometry.coordinates[2]),
          tsunamiFlag: !!f.properties.tsunami,
          pagerAlert: f.properties.alert ? String(f.properties.alert).toLowerCase() : null
        });
        n++;
      }
      out.meta.usgs = true; mark('usgs', true, { records: n, window: '7 days, M2.5+' });
    } catch (e) { mark('usgs', false, { error: String(e.message || e) }); }
  })());

  // 3. NASA EONET — satellite-observed open natural events.
  jobs.push((async () => {
    try {
      const j = await timedFetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300');
      let n = 0;
      for (const v of j.events || []) {
        const geoms = Array.isArray(v.geometry) ? v.geometry : [];
        const g = geoms[geoms.length - 1];
        if (!g || g.type !== 'Point') continue;
        const cat = (v.categories && v.categories[0] && v.categories[0].title) || 'Natural Event';
        const eonetTitle = String(v.title || '').replace(/\bPrescribed Fire RX\b/gi, 'Prescribed Fire')
          .replace(/\bRX\b/g, 'Prescribed Fire').trim();
        const eonetPlace = placeFromTitle(eonetTitle);
        const tc = eonetTropicalCyclone(cat, eonetTitle, v.sources);
        push({
          id: 'eonet-' + v.id,
          source: 'NASA EONET', sourceType: 'official', type: tc ? 'Tropical Cyclone' : normalizeType(cat),
          // "RX" is fire-management shorthand for a prescribed fire, so EONET titles
          // read "Prescribed Fire RX Tom Green" — the same words twice, one of them
          // an abbreviation.
          title: eonetTitle,
          country: eonetPlace ? eonetPlace.country : '',
          admin1: eonetPlace ? eonetPlace.admin1 : '',
          admin2: eonetPlace ? eonetPlace.admin2 : '',
          /* A storm title names the storm, not a place, so a cyclone carried
             no place at all and "Bay of Bengal" found nothing. Its warning
             centre's basin is the place a reader knows it by. */
          region: eonetPlace ? eonetPlace.region : ((tc && tc.basin) || ''),
          alert: 'Green',
          lat: g.coordinates[1], lon: g.coordinates[0],
          startedAt: (geoms[0] && geoms[0].date) || null,
          updated: g.date || now.toISOString(),
          details: 'Open event tracked by NASA EONET · ' + cat,
          /* Falling back to the API URL would put raw JSON behind a link that
             reads as a source. Every EONET record carries a page today; if one
             ever does not, the reader gets the tracker, not a payload. */
          sourceUrl: (v.sources && v.sources[0] && v.sources[0].url) || 'https://eonet.gsfc.nasa.gov/',
          sourceApiUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/' + v.id
        });
        n++;
      }
      out.meta.eonet = true; mark('eonet', true, { records: n });
    } catch (e) { mark('eonet', false, { error: String(e.message || e) }); }
  })());

  const BASINS = {
    AL: 'Atlantic', AT: 'Atlantic', EP: 'eastern Pacific', CP: 'central Pacific',
    WP: 'western Pacific', IO: 'Indian Ocean', SH: 'southern hemisphere'
  };
  /** "EP4" on its own means nothing to a reader. */
  const basinText = bin => {
    const m = /^([A-Z]{2})(\d+)$/.exec(String(bin || '').trim().toUpperCase());
    if (!m || !BASINS[m[1]]) return bin ? '(' + bin + ')' : '';
    return '(' + BASINS[m[1]] + ' system ' + Number(m[2]) + ')';
  };

  // 4. NOAA National Hurricane Center — active tropical cyclones.
  jobs.push((async () => {
    try {
      const j = await timedFetch('https://www.nhc.noaa.gov/CurrentStorms.json');
      const storms = j.activeStorms || j.storms || [];
      let n = 0;
      for (const s of storms) {
        const lat = num(s.latitudeNumeric != null ? s.latitudeNumeric : s.lat);
        const lon = num(s.longitudeNumeric != null ? s.longitudeNumeric : s.lon);
        if (lat === null || lon === null) continue;
        const intensity = num(s.intensity);
        push({
          id: 'nhc-' + (s.id || s.binNumber || s.name),
          source: 'NOAA National Hurricane Center', sourceType: 'official', type: 'Tropical Cyclone',
          title: [s.classification, s.name].filter(Boolean).join(' ') || 'Active tropical cyclone',
          country: '',
          region: [s.name, basinText(s.binNumber)].filter(Boolean).join(' ') || s.basin || '',
          // 64 kt and 96 kt are the Saffir-Simpson category 1 and category 3
          // boundaries, not thresholds of our own.
          //
          // It is still a colour this site computes from a wind speed, not an
          // alert the hurricane centre issued, and the difference decides
          // whether a storm counts as a disaster that happened: read as an
          // authority's alert, a category-3 hurricane over open water with no
          // reported impact entered the record of observed disasters and the
          // recall denominator, described as having been "raised to a red
          // alert by the issuing authority". It says what it is.
          alert: intensity >= 96 ? 'Red' : intensity >= 64 ? 'Orange' : 'Green',
          alertBasis: 'derived-from-intensity',
          lat, lon,
          updated: s.lastUpdate || now.toISOString(),
          details: 'Active system · maximum sustained wind ' + (intensity === null ? '—' : intensity + ' kt') +
            (s.pressure ? ' · minimum pressure ' + s.pressure + ' mb' : '') +
            (s.movementDir != null ? ' · moving ' + s.movementDir + '° at ' + (s.movementSpeed || '—') + ' kt' : ''),
          sourceUrl: (s.publicAdvisory && s.publicAdvisory.url) || 'https://www.nhc.noaa.gov/',
          /* The measures the hurricane centre publishes, as fields.
           *
           * Central pressure and the track were read from this feed and then
           * written into the sentence above and nowhere else - so the one
           * place a reader looks for a storm's numbers, the key-facts grid,
           * showed the wind and marked everything else as though the centre
           * had not published it. Central pressure is the measure forecasters
           * actually watch for intensification, and where a storm is heading
           * is the question anyone in its path is asking. Both were in hand
           * the whole time. */
          windKt: intensity,
          pressureMb: num(s.pressure),
          movementDirDeg: num(s.movementDir),
          movementKt: num(s.movementSpeed)
        });
        n++;
      }
      mark('nhc', true, { records: n });
    } catch (e) { mark('nhc', false, { error: String(e.message || e) }); }
  })());

  // 5. NOAA / NWS — active severe and extreme US warnings with a mapped area.
  //    A single fixed query is brittle: one parameter the API rejects takes the
  //    whole provider offline with a bare 400. Walk a ladder instead.
  jobs.push((async () => {
    const queries = [
      'status=actual&message_type=alert&severity=Extreme,Severe',
      'status=actual&severity=Extreme,Severe',
      'severity=Extreme,Severe',
      'status=actual',
      ''
    ];
    let lastError = '';
    for (const query of queries) {
      try {
        const j = await timedFetch(
          'https://api.weather.gov/alerts/active' + (query ? '?' + query : ''),
          { headers: { accept: 'application/geo+json' } }
        );
        // Most Extreme/Severe alerts are issued against forecast zones and carry
        // no polygon of their own. Resolve a bounded number of those zones so
        // they can be mapped, rather than dropping them.
        const features = (j.features || []).filter(f => {
          const p = f.properties || {};
          return query !== '' || ['Extreme', 'Severe'].includes(p.severity);
        });
        const zoneless = features.filter(f => !centroid(f.geometry)).slice(0, 12);
        const zoneCentroids = new Map();
        /* The zone's shape, not only its middle. An alert with no inline
           geometry still gets its point-forecast link from somewhere, and
           passing a null geometry to insidePoint made it accept the mean
           unchecked — so a concave or multipart forecast zone could still
           send the reader to a place that is not under the warning. */
        const zoneGeometry = new Map();
        /*
         * All of the zones, or none of them.
         *
         * A warning routinely names several forecast zones, and resolving only
         * the first one and publishing it as the affected area is worse than
         * publishing nothing: a saved place in the second zone is tested
         * against the first, found outside, and told it is outside the warning
         * area. That is a false negative on the one question a warning exists
         * to answer.
         *
         * So the polygon is only published when every zone resolved. The
         * centroid still comes from the first zone, because it is a weaker
         * claim that is already labelled a zone centre rather than an
         * incident, and it is what keeps the alert on the map at all.
         */
        const ZONE_FETCH_BUDGET = 40;
        let zoneBudget = ZONE_FETCH_BUDGET;
        const zonePlan = zoneless.map(f => {
          const zones = ((f.properties || {}).affectedZones || []).filter(Boolean);
          /* Reserve the whole alert or none of it, so a partly-funded alert
             never ends up with a partial area. */
          const affordable = zones.length > 0 && zones.length <= zoneBudget;
          if (affordable) zoneBudget -= zones.length;
          return { f, zones, complete: affordable };
        });
        let zonePartialArea = 0;

        const combinePolygons = geoms => {
          const parts = [];
          for (const g of geoms) {
            if (!g) return null;
            if (g.type === 'Polygon') parts.push(g.coordinates);
            else if (g.type === 'MultiPolygon') { for (const q of g.coordinates) parts.push(q); }
            else return null;   // a shape this cannot combine is not combined
          }
          return parts.length ? { type: 'MultiPolygon', coordinates: parts } : null;
        };

        await Promise.allSettled(zonePlan.map(async plan => {
          const { f, zones, complete } = plan;
          if (!zones.length) return;
          const wanted = complete ? zones : zones.slice(0, 1);
          const got = await Promise.all(wanted.map(async url => {
            try {
              const z = await timedFetch(url, { timeout: 2500, headers: { accept: 'application/geo+json' } });
              return z.geometry || null;
            } catch (e) { return null; }
          }));
          const first = got[0];
          const c = first ? centroid(first) : null;
          if (c) zoneCentroids.set(f, c);
          if (!complete) { if (zones.length > 1) zonePartialArea++; return; }
          if (got.some(g => !g)) { zonePartialArea++; return; }
          const all = combinePolygons(got);
          if (all) zoneGeometry.set(f, all); else zonePartialArea++;
        }));

        let n = 0, skipped = 0, viaZone = 0, withArea = 0, overBudget = 0;
        for (const f of features) {
          const p = f.properties || {};
          let c = centroid(f.geometry);
          if (!c && zoneCentroids.has(f)) { c = zoneCentroids.get(f); viaZone++; }
          if (!c) { skipped++; continue; }
          const raw = f.geometry || zoneGeometry.get(f) || null;
          if (raw) { if (boundedGeometry(raw)) withArea++; else overBudget++; }
          push({
            id: 'nws-' + (p.id || f.id),
            source: 'NOAA / National Weather Service', sourceType: 'official',
            type: normalizeType(p.event, p.event),
            title: p.event + (p.areaDesc ? ' — ' + spellUsPlaces(String(p.areaDesc).split(';')[0].trim()) : ''),
            country: 'United States', region: spellUsPlaces(p.areaDesc || ''),
            /* The severity the alert itself carries, in this site's colours. */
            alert: p.severity === 'Extreme' ? 'Red' : 'Orange',
            alertBasis: 'issued',
            lat: c.lat, lon: c.lon,
            /* The affected area, not just its middle. It was already fetched -
               resolved from the zone where the alert carries no polygon of its
               own - and then thrown away, which left the app with a centroid it
               could only compare by distance. Carrying it means a saved
               location can be tested for containment, which is the question
               a warning actually answers. */
            geometry: boundedGeometry(f.geometry || zoneGeometry.get(f) || null),
            startedAt: p.onset || p.effective || null,
            updated: p.sent || p.effective || now.toISOString(),
            expiresAt: p.expires || p.ends || null,
            details: String(p.headline || p.description || '').slice(0, 600),
            instruction: String(p.instruction || '').slice(0, 600),
            /* p['@id'] is the CAP record's API URL: opening it drops the reader
               into raw GeoJSON. The point forecast page is the National Weather
               Service's own human page for this location and lists the warnings
               active there. The API URL is kept for provenance, under a name
               that says what it is, and is never offered as a source to read. */
            sourceUrl: (() => {
              /* Linked from a point proven to be inside the warned area, not
                 from the marker's coordinate, which for a concave, multipart
                 or holed alert can sit outside it. When no such point can be
                 established the reader goes to the agency's own front page
                 rather than to a forecast for somewhere that is not warned. */
              const link = insidePoint(f.geometry || zoneGeometry.get(f) || null, c);
              return link && Number.isFinite(link.lat) && Number.isFinite(link.lon)
                ? 'https://forecast.weather.gov/MapClick.php?lat=' + Number(link.lat).toFixed(4) +
                  '&lon=' + Number(link.lon).toFixed(4)
                : 'https://www.weather.gov/';
            })(),
            sourceApiUrl: p['@id'] || '',
            issuingAgency: p.senderName || 'NWS'
          });
          n++;
        }
        mark('nws', true, {
          records: n, placedViaZoneLookup: viaZone, unplaceable: skipped,
          withAffectedArea: withArea, areaOverBudget: overBudget,
          areaWithheldIncompleteZones: zonePartialArea,
          query: query || '(no filters)'
        });
        return;
      } catch (e) {
        lastError = String(e.message || e);
      }
    }
    mark('nws', false, { error: lastError });
  })());

  // 6. ReliefWeb (UN OCHA) - currently listed humanitarian disasters.
  //    With RELIEFWEB_APPNAME set to an appname ReliefWeb has approved, read
  //    the v2 API (apidoc.reliefweb.int): disasters with status "current".
  //    ("alert" is a disaster expected, and this provider reports ones that
  //    have happened.) Without one, or if the API fails, read the public
  //    disasters feeds, which since October 2026 answer HTTP 406 to servers.
  //
  //    Neither carries coordinates, so each record is placed at its
  //    country's location via Open-Meteo's key-less geocoder and flagged
  //    precision:'country' - this is a country-level humanitarian record, not
  //    an incident position, and the UI says so. A record whose country cannot
  //    be resolved is left out rather than placed somewhere plausible.
  jobs.push((async () => {
    const appname = String(process.env.RELIEFWEB_APPNAME || '').trim();
    const RW_API = 'https://api.reliefweb.int/v2/disasters';
    const HINT = 'Set RELIEFWEB_APPNAME to an appname ReliefWeb has approved (apidoc.reliefweb.int) to read its API.';
    /* The appname is configuration, not for the page: never echoed back. */
    const quiet = m => (appname ? String(m).split(appname).join('[appname]') : String(m));
    let items = null, via = '', endpoint = '', apiError, withoutDateOrLink = 0;

    if (appname) {
      try {
        const fields = ['name', 'status', 'date.changed', 'date.created', 'date.event', 'url', 'url_alias',
          'primary_country.name', 'primary_type.name', 'description'];
        const q = ['appname=' + encodeURIComponent(appname), 'filter[field]=status', 'filter[value]=current',
          'sort[]=date.changed:desc', 'limit=40'].concat(fields.map(f => 'fields[include][]=' + f)).join('&');
        const j = await timedFetch(RW_API + '?' + q);
        if (!j || !Array.isArray(j.data)) throw new Error('no data array in the answer');
        const first = v => (Array.isArray(v) ? v[0] : v) || {};
        items = [];
        for (const d of j.data) {
          const f = (d && d.fields) || {};
          const title = String(f.name || '').trim();
          const country = String(first(f.primary_country).name || '').trim();
          if (!title || !country) continue;
          const date = f.date || {};
          const published = date.changed || date.created || date.event || '';
          const link = /^https:\/\/reliefweb\.int\//.test(f.url_alias || '') ? f.url_alias : (f.url || '');
          /* Nothing to date it by, or to send a reader to: left out, and counted. */
          if (!published || !link || isNaN(Date.parse(published))) { withoutDateOrLink++; continue; }
          items.push({
            title, link, country,
            hazard: String(first(f.primary_type).name || '').trim() || title.slice(title.indexOf(':') + 1).trim(),
            published,
            summary: String(f.description || '').replace(/[#*_>`\[\]]+/g, ' ').replace(/\(https?:[^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
          });
        }
        via = 'api'; endpoint = RW_API;
      } catch (e) {
        items = null;
        apiError = quiet(e.message || e) + '. Check that RELIEFWEB_APPNAME is an appname ReliefWeb has approved.';
      }
    }

    if (!items) {
      // The exact feed path is not documented, and a Drupal miss can answer 200
      // with an HTML page, so try each candidate and require it to parse into
      // items before accepting it. `endpoint` records which one answered.
      const feeds = [
        'https://reliefweb.int/disasters/rss.xml?view=ongoing',
        'https://reliefweb.int/disasters/rss.xml',
        'https://reliefweb.int/disasters/feed'
      ];
      let xml = '', lastError = 'no candidate feed returned items';
      for (const url of feeds) {
        try {
          const body = await timedFetch(url, {
            text: true, headers: { accept: 'application/rss+xml, application/xml' }
          });
          if (/<item[\s>]/i.test(body)) { xml = body; endpoint = url; break; }
          lastError = 'no <item> elements at ' + url;
        } catch (e) {
          lastError = String(e.message || e);
        }
      }
      if (!xml) {
        mark('reliefweb', false, { error: lastError, tried: feeds.length, apiError, hint: appname ? undefined : HINT });
        return;
      }
      try {
        items = [];
        for (const m of String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
          const b = m[1];
          const title = tag('title', b);
          const link = tag('link', b) || tag('guid', b);
          if (!title || !link) continue;
          // "Nepal: Floods and Landslides - Sep 2026"
          const split = title.indexOf(':');
          const country = split > 0 ? title.slice(0, split).trim() : '';
          const rest = split > 0 ? title.slice(split + 1) : title;
          if (!country) continue;
          items.push({
            title, link, country,
            hazard: rest.replace(/\s*-\s*[A-Za-z]{3}\s*\d{4}\s*$/, '').trim(),
            published: tag('pubDate', b) || '',
            summary: tag('description', b).slice(0, 400)
          });
          if (items.length >= 40) break;
        }
        via = 'feed';
      } catch (e) {
        mark('reliefweb', false, { error: String(e.message || e), apiError });
        return;
      }
    }

    try {
      // One geocode per distinct country, capped and run in parallel.
      const countries = [...new Set(items.map(i => i.country))].slice(0, 12);
      const located = new Map();
      await Promise.allSettled(countries.map(async name => {
        try {
          const g = await timedFetch(
            'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
            encodeURIComponent(name), { timeout: 2500 });
          const hit = (g.results || [])[0];
          const lat = num(hit && hit.latitude), lon = num(hit && hit.longitude);
          if (lat !== null && lon !== null) located.set(name, { lat, lon });
        } catch (e) { /* leave this country unplaced */ }
      }));

      let n = 0, unplaced = 0;
      for (const it of items) {
        const at = located.get(it.country);
        if (!at) { unplaced++; continue; }
        push({
          id: 'reliefweb-' + String(it.link).replace(/[^a-z0-9]+/gi, '-').slice(-48),
          source: 'ReliefWeb (UN OCHA)', sourceType: 'official',
          type: normalizeType(it.hazard, it.title),
          title: it.title,
          country: it.country, region: it.country,
          alert: 'Green',
          lat: at.lat, lon: at.lon,
          precision: 'country',
          updated: it.published ? new Date(it.published).toISOString() : now.toISOString(),
          details: 'UN OCHA ReliefWeb humanitarian disaster record. ' +
            (it.summary ? it.summary + ' ' : '') +
            'Mapped at country level, not at an incident location — open the source record for the affected areas, ' +
            'situation reports, appeals and response updates.',
          sourceUrl: it.link,
          humanitarian: true
        });
        n++;
      }
      mark('reliefweb', true, { records: n, unplacedCountries: unplaced, endpoint, via, apiError,
        withoutDateOrLink: via === 'api' ? withoutDateOrLink : undefined });
    } catch (e) {
      mark('reliefweb', false, { error: String(e.message || e), apiError });
    }
  })());

  // 7. USGS Volcano Hazards Program — volcanoes at elevated alert level.
  //    The elevated-volcanoes payload is a list of notices: no coordinates, and
  //    `notice_data` is a URL to the full notice rather than the data itself.
  //    Fetch those few notices to place each volcano.
  jobs.push((async () => {
    try {
      const j = await timedFetch('https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes');
      const arr = Array.isArray(j) ? j : (j.data || j.volcanoes || j.results || j.features || []);

      // Collect every latitude/longitude pair in an arbitrarily nested object,
      // together with whatever identifies the volcano it sits on. An AVO notice
      // can reference more than one volcano, so taking the first pair found put
      // Great Sitkin at Shishaldin's coordinates in production.
      const collectCoords = node => {
        const found = [];
        const stack = [{ node, vnum: '', name: '' }];
        const seen = new Set();
        while (stack.length) {
          const { node: cur, vnum, name } = stack.pop();
          if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
          seen.add(cur);
          let lat = null, lon = null;
          let ownVnum = vnum, ownName = name;
          const children = [];
          for (const [k, v] of Object.entries(cur)) {
            const key = k.toLowerCase();
            if (v && typeof v === 'object') { children.push(v); continue; }
            if (lat === null && /^(v?lat|latitude)$/.test(key)) lat = num(v);
            if (lon === null && /^(v?lon|v?lng|longitude)$/.test(key)) lon = num(v);
            if (/^(vnum|volcano_?number|volcano_?id)$/.test(key) && v) ownVnum = String(v);
            if (/^(volcano_?name|name)$/.test(key) && v) ownName = String(v);
          }
          for (const child of children) stack.push({ node: child, vnum: ownVnum, name: ownName });
          if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            found.push({ lat, lon, vnum: ownVnum, name: ownName });
          }
        }
        return found;
      };

      /**
       * Pick the pair that belongs to this volcano. Identity wins; a single
       * unambiguous pair is accepted; anything else is left unplaced, because a
       * volcano alert shown at the wrong place is worse than one not shown.
       */
      const coordsFor = (candidates, vnum, name) => {
        if (!candidates.length) return null;
        const wantNum = String(vnum || '').trim();
        const wantName = String(name || '').trim().toLowerCase();
        if (wantNum) {
          const hit = candidates.find(c => String(c.vnum || '').trim() === wantNum);
          if (hit) return hit;
        }
        if (wantName) {
          const hit = candidates.find(c => String(c.name || '').trim().toLowerCase() === wantName);
          if (hit) return hit;
        }
        const distinct = [];
        for (const c of candidates) {
          if (!distinct.some(d => d.lat === c.lat && d.lon === c.lon)) distinct.push(c);
        }
        return distinct.length === 1 ? distinct[0] : null;
      };

      const entries = (Array.isArray(arr) ? arr : []).map(raw => {
        const v = raw.properties || raw;
        return { v, coords: coordsFor(collectCoords(v), v.vnum, v.volcano_name || v.volcanoName || v.name) };
      });

      // Only a handful of volcanoes are ever elevated, so this stays cheap.
      const needsNotice = entries.filter(e => !e.coords && typeof e.v.notice_data === 'string').slice(0, 8);
      await Promise.allSettled(needsNotice.map(async e => {
        try {
          const notice = await timedFetch(e.v.notice_data, { timeout: 2500 });
          e.coords = coordsFor(collectCoords(notice), e.v.vnum, e.v.volcano_name || e.v.volcanoName || e.v.name);
          if (e.coords) e.viaNotice = true;
        } catch (err) { /* leave this volcano unplaced */ }
      }));

      let n = 0, viaNotice = 0;
      const unplaced = entries.filter(e => !e.coords).length;
      for (const { v, coords, viaNotice: fromNotice } of entries) {
        if (!coords) continue;
        if (fromNotice) viaNotice++;
        const name = v.volcano_name || v.volcanoName || v.name || 'Volcano';
        const level = String(v.alert_level || v.alertLevel || v.alert || '').toUpperCase();
        const colour = v.color_code || v.colorCode || '';
        push({
          id: 'usgs-volcano-' + (v.vnum || v.volcanoId || name),
          source: 'USGS Volcano Hazards Program', sourceType: 'official', type: 'Volcano',
          /* USGS writes the level in capitals; it is a word, not a shout. */
          title: name + ' volcano — ' + (level
            ? 'alert level ' + level.charAt(0) + level.slice(1).toLowerCase() : 'raised alert level'),
          country: 'United States', region: v.obs_fullname || v.observatory || v.obs_abbr || '',
          alert: level === 'WARNING' ? 'Red' : level === 'WATCH' ? 'Orange' : 'Green',
          alertBasis: 'issued',
          // The observatory's own wording, kept apart from the colour the UI
          // maps it to. Only a source that publishes a level gets one: every
          // EONET volcano carries alert 'Green', which EONET never assessed.
          ...(level ? { alertLevel: level } : {}),
          ...(colour ? { aviationColour: String(colour).toUpperCase() } : {}),
          lat: coords.lat, lon: coords.lon,
          updated: v.sent_utc ? String(v.sent_utc).replace(' ', 'T') + 'Z' : (v.sent || now.toISOString()),
          details: 'Volcano alert level ' + (level || 'elevated') +
            (colour ? ' · aviation colour code ' + colour : '') + '.',
          sourceUrl: v.notice_url || 'https://www.usgs.gov/programs/VHP'
        });
        n++;
      }

      const shape = n === 0 && entries.length
        ? {
            payload: Array.isArray(j) ? 'array' : typeof j,
            entries: entries.length,
            firstKeys: Object.keys(entries[0].v).slice(0, 20),
            firstEntry: JSON.stringify(entries[0].v).slice(0, 700)
          }
        : null;
      mark('usgs_volcano', true, shape
        ? { records: n, placedViaNotice: viaNotice, unplaced, shape }
        : { records: n, placedViaNotice: viaNotice, unplaced });
    } catch (e) { mark('usgs_volcano', false, { error: String(e.message || e) }); }
  })());

  // 8. EMSC / seismicportal — independent seismic cross-check.
  jobs.push((async () => {
    try {
      const j = await timedFetch('https://www.seismicportal.eu/fdsnws/event/1/query?limit=80&format=json&minmag=4.5');
      let n = 0;
      for (const f of j.features || []) {
        const p = f.properties || {};
        const lat = num(p.lat != null ? p.lat : (f.geometry && f.geometry.coordinates && f.geometry.coordinates[1]));
        const lon = num(p.lon != null ? p.lon : (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]));
        if (lat === null || lon === null) continue;
        const mag = num(p.mag);
        push({
          id: 'emsc-' + (p.unid || f.id || n),
          source: 'EMSC', sourceType: 'official', type: 'Earthquake',
          title: 'M ' + (mag === null ? '—' : mag.toFixed(1)) + ' — ' + (p.flynn_region || 'earthquake'),
          country: '', region: p.flynn_region || '',
          alert: 'Green',
          lat, lon,
          startedAt: p.time || null,
          updated: p.lastupdate || p.time || now.toISOString(),
          details: 'Magnitude ' + (mag === null ? '—' : mag) + ' ' + (p.magtype || '') +
            ' · depth ' + (p.depth == null ? '—' : p.depth + ' km') + ' · reported by ' + (p.auth || 'EMSC') + '. EMSC publishes detections, not impact alert levels.',
          sourceUrl: p.unid ? 'https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=' + p.unid : 'https://www.emsc-csem.org/',
          magnitude: mag, depthKm: num(p.depth)
        });
        n++;
      }
      mark('emsc', true, { records: n, window: 'M4.5+' });
    } catch (e) { mark('emsc', false, { error: String(e.message || e) }); }
  })());

  await Promise.allSettled(jobs);

  const okSources = Object.values(out.meta.sources).filter(s => s && s.ok);
  out.meta.sourceCount = okSources.length;
  out.meta.sourceTotal = Object.keys(out.meta.sources).length;
  out.meta.live = okSources.length > 0;

  /* ---------------------------------------------- verified fallback records */

  const hasNepal = out.events.some(e => /nepal/i.test([e.title, e.country, e.region].join(' ')) && /flood/i.test(e.type));
  if (!hasNepal) push({
    id: 'gdacs-FL-1104124', source: 'GDACS verified snapshot', sourceType: 'official', type: 'Flood',
    title: 'Nepal flood — Bagmati / Rasuwa impact and recovery',
    country: 'Nepal', region: 'Bagmati Province · Rasuwagadhi · Bhote Koshi · Trishuli corridor',
    alert: 'Red', lat: 28.18, lon: 85.39,
    startedAt: '2026-08-26T00:00:00Z', updated: '2026-09-05T18:50:00Z',
    details: 'GDACS FL-2026-000167-NPL. Major late-August flood with continuing response and recovery updates; retained when the rolling GDACS live list omits the event.',
    deaths: 955, displaced: 3458,
    sourceUrl: 'https://www.gdacs.org/report.aspx?eventid=1104124&eventtype=FL', cached: true
  });

  const hasIndonesia = out.events.some(e => /indonesia|teluknaga/i.test([e.title, e.country, e.region].join(' ')) && /earthquake/i.test(e.type));
  if (!hasIndonesia) push({
    id: 'recent-IDN-20260911-M65', source: 'USGS verified recent snapshot', sourceType: 'official', type: 'Earthquake',
    title: 'M 6.5 earthquake north-northeast of Teluknaga, Indonesia',
    country: 'Indonesia', region: 'Banten / Java Sea vicinity',
    alert: 'Red', lat: -5.9, lon: 106.6,
    startedAt: '2026-09-11T00:00:00Z', updated: '2026-09-11T00:00:00Z',
    details: 'Recent M6.5 Indonesia earthquake retained as a verified recent-event snapshot when it falls outside or is absent from the rolling live feed. Check the linked USGS feed for the authoritative event record.',
    magnitude: 6.5, sourceUrl: 'https://earthquake.usgs.gov/earthquakes/search/', cached: true
  });

  /* ---------------------------------------------------- frozen benchmark */

  push({
    id: 'ND-001', source: 'Predict Natural Disasters', sourceType: 'forecast', type: 'Flood / Landslide',
    title: 'Central Vietnam flash-flood + landslide forecast',
    country: 'Vietnam', region: 'Huế–Đà Nẵng corridor',
    alert: 'High', lat: 16.2, lon: 107.8,
    updated: '2026-09-13T19:20:03Z', issuedAt: '2026-09-13T19:20:03Z',
    issuedAtBasis: 'First verifiable timestamp: the commit that introduced this record. Any earlier drafting cannot be evidenced, so the later time is used.',
    targetStart: '2026-09-13T00:00:00Z', targetEnd: '2026-09-16T23:59:59Z',
    details: 'Starts 13 Sep 2026 and lasts 4 days. It was written 19 hours after that period began, so it gave no advance warning. It is still checked against damage or harm that others reported, not against rainfall or a warning alone.',
    forecast: true, forecastKind: 'frozen-benchmark', confidence: 'Test case: locked when it was made, but not made in advance',
    /* The record already names a corridor. Saying so keeps its coordinate
       from being read as the point where the flooding was expected.

       This is said as the coordinate's precision and deliberately NOT as a
       forecastScope. The scope is one of the terms the claim is graded and
       identified on, and it was not in the commit this record was frozen by:
       adding it nine days later made the feed present a different claim
       under the same id while still citing that commit as its proof, and the
       ledger writer duly recorded the new claim as frozen on 13 September. */
    precision: 'regional',
    evidence: 'Locked as our first test case. It was saved on 13 Sep 2026 at 19:20 UTC, after its forecast period began at 00:00 UTC that day, so it did not give advance warning.',
    verificationRule: 'Counts as correct only if others report real flood or landslide damage inside the locked area and dates.',
    sourceUrl: '/verification'
  });

  /* ------------------------------------------------- experimental outlooks */

  const mechanism = t => {
    const s = String(t).toLowerCase();
    if (/flood/.test(s)) return 'flooding may continue or return where rivers and ground are still full of water';
    if (/cyclone|hurricane|typhoon/.test(s)) return 'the storm may keep bringing strong wind, storm surge and heavy rain along its path';
    if (/storm|tornado/.test(s)) return 'more strong wind, hail or heavy rain may follow while the storm lasts';
    if (/wildfire|fire/.test(s)) return 'the fire may keep spreading, with smoke and evacuations, until it is under control';
    if (/volcan/.test(s)) return 'the volcano may stay restless, with ash fall and closed areas, while its alert level stays raised';
    if (/landslide/.test(s)) return 'more landslides may happen where slopes are still soaked or unstable';
    if (/drought/.test(s)) return 'water shortages and crop losses may continue while the drought lasts';
    if (/heat/.test(s)) return 'the heat may keep harming health while it lasts';
    if (/tsunami/.test(s)) return 'coasts and harbours may stay dangerous while the marine warning is in force';
    return 'the danger may continue while the official report stays active';
  };

  const outlookId = sourceId => 'OUT-' + String(sourceId).replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-48);

  /* One earthquake, one record, before anything is derived from it.
   *
   * The agencies' reports were merged only after the outlooks were built, so
   * an aftershock outlook was derived from each agency's copy of one quake.
   * The area guard below rounds a position to the nearest degree, which two
   * solutions of the same earthquake straddle as easily as not: measured, a
   * USGS record at -5.9/106.6 and a GDACS record at -5.45/106.45 - 52 km
   * apart, the same event by the merge's own rule - produced
   * OUT-aftershock-usgs-us7000abcd and OUT-aftershock-gdacs-EQ-9001, two
   * frozen claims about one sequence, both recorded in the append-only ledger
   * and both counted in the conditional rate. The second also pointed at a
   * record the feed then stopped serving, because its own agency's copy had
   * been merged away.
   *
   * Merging first also means an outlook is derived from the record as it is
   * finally published, including any graver assessment the merge carried over
   * from a discarded copy. */
  out.events = mergeSeismicReports(out.events);

  /* Plain names first, so the storm merge and every outlook title read them;
     the provider's own title is kept beside it, and it - not the plain name -
     is what an outlook falls back to for its frozen region. */
  for (const e of out.events) {
    const plain = plainTitle(e);
    if (plain && plain !== e.title) { e.sourceTitle = e.title; e.title = plain; }
  }
  out.events = mergeCycloneReports(out.events);
  out.meta.mergedCycloneReports = out.events.mergedCycloneReports || 0;
  out.meta.notLive = markLive(out.events, now.getTime());

  const priority = { Red: 4, Orange: 3, High: 3, Green: 1 };
  /* Only a live record can drive a new outlook: a storm that dissipated four
     days ago was still producing a five-day cyclone outlook for India. */
  const officialSignals = out.events.filter(e =>
    e.sourceType === 'official' && !e.forecast && e.live !== false &&
    Number.isFinite(+e.lat) && Number.isFinite(+e.lon));

  // (a) Hazard-continuation outlooks from every non-seismic active official signal.
  const continuation = officialSignals
    .filter(e => !/earthquake/i.test(e.type))
    .sort((a, b) => (priority[b.alert] || 0) - (priority[a.alert] || 0) || new Date(b.updated) - new Date(a.updated));

  const horizonFor = t =>
    (HAZARD_MODEL && HAZARD_MODEL.horizonHours(t)) || OUTLOOK_HORIZON_HOURS;
  const windowText = h => h >= 48
    ? Math.round(h / 24) + '-day'
    : h + '-hour';
  const seenArea = new Set();
  const outlooks = [];

  /* Counted after the window and place checks, so it is the number of
     outlooks that would have been published, not the number of signals. */
  let outlooksWithheld = 0;
  for (const e of continuation) {
    // The signal's own last-updated time, not the clock: see below.
    const anchorMs = Date.parse(e.updated) || now.getTime();
    const windowEndMs = anchorMs + horizonFor(e.type) * 3600e3;
    // A window that has already closed is history, not an outlook.
    if (windowEndMs <= now.getTime()) continue;
    const area = ((e.country || e.region || e.sourceTitle || e.title) + '|' + e.type).toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (seenArea.has(area)) continue;
    seenArea.add(area);
    if (outlooks.length >= MAX_OUTLOOKS) { outlooksWithheld++; continue; }
    outlooks.push({
      id: outlookId(e.id),
      source: 'Predict Natural Disasters · derived from ' + e.source,
      sourceType: 'forecast', type: e.type,
      title: outlookTitle(e, windowText(horizonFor(e.type))),
      country: e.country || '', region: e.region || e.sourceTitle || e.title || '',
      alert: e.alert === 'Red' ? 'High' : e.alert === 'Orange' ? 'Moderate' : 'Watch',
      lat: e.lat, lon: e.lon,
      updated: new Date(anchorMs).toISOString(), issuedAt: new Date(anchorMs).toISOString(),
      targetStart: new Date(anchorMs).toISOString(),
      targetEnd: new Date(windowEndMs).toISOString(),
      details: 'Our own ' + windowText(horizonFor(e.type)) + ' forecast, made from a current report by ' + e.source +
        '. The period matches how long this kind of hazard usually lasts. What may happen: ' +
        mechanism(e.type) + '. ' + FORECAST_DISCLAIMER,
      /* An outlook is no more precise than the area it is issued for, and
         the title above names that area: the signal's country where it has
         one, else its region, else the single event itself. Without this the
         outlook inherited the parent's coordinate meaning through the source
         string - so a wildfire outlook headed "United States" was read as an
         incident and could be reported as kilometres from a saved home. */
      /* As wide as the report it follows, and no wider. Every outlook from a
         report that named a country used to be issued for that whole
         country, so a drought centred in Andhra Pradesh was published as
         covering Mumbai, 800 km away, and a wildfire in one county as a risk
         to all of the United States. Only a report that is itself placed at
         country level makes a country-wide outlook now. Rows already in the
         ledger keep the scope they were recorded with. */
      forecastScope: e.precision === 'country' ? 'country' : 'event',
      forecast: true, forecastKind: 'signal-derived-outlook', forecastOf: e.id,
      /* Said as what the level rests on. A storm's colour is this site's
         reading of its wind speed, not an alert anyone issued. */
      confidence: e.alertBasis === 'derived-from-intensity'
        ? (e.alert === 'Red' ? 'Higher — a major storm (category 3 or stronger)'
          : e.alert === 'Orange' ? 'Moderate — a hurricane-strength storm'
            : 'Watch — a weaker storm')
        : (e.alert === 'Red' ? 'Higher — the agency issued its highest (red) alert'
          : e.alert === 'Orange' ? 'Moderate — the agency issued an orange alert'
            : 'Watch — the agency issued a lower-level alert'),
      evidence: 'Based on the ' + e.source + ' report “' + e.title + '”' +
        (e.alert ? ' (' + e.alert.toLowerCase() + ' level)' : '') + ', last updated ' + utcText(e.updated) + '.',
      sourceUrl: e.sourceUrl || '',
      verificationRule: 'We check this forecast only against damage or impacts that others report during the forecast period. The original alert does not count as the forecast coming true.'
    });
  }

  // (b) Aftershock-sequence outlooks. Aftershock probability is a recognised
  //     forecast product; the mainshock itself is never presented as predicted.
  const strongQuakes = officialSignals
    .filter(e => /earthquake/i.test(e.type) && num(e.magnitude) !== null && num(e.magnitude) >= 5.5)
    .sort((a, b) => (num(b.magnitude) || 0) - (num(a.magnitude) || 0));
  /*
   * One outlook per earthquake, and the earthquake is the merged record.
   *
   * This used to skip any quake whose position rounded to a whole-degree cell
   * already used - a stand-in for "the same quake reported twice", written
   * before mergeSeismicReports ran above and made that case impossible here.
   * What it decides now is where a degree boundary happens to fall: a degree
   * is about 111 km, so two separate earthquakes share a cell as easily as
   * not. Measured on two M6 shocks 46 km and ten hours apart - two records
   * after the merge, and two disasters by this project's own earthquake rule
   * of 100 km and two hours - only the larger was given a sequence outlook.
   * The second quake's sequence was not published at all, and would have been
   * had the same two epicentres straddled a boundary.
   *
   * The duplicate this guard was written for is handled by the merge above,
   * so the identity here is the merged record's: anything still holding a
   * separate record is a separate earthquake by the same definition the rest
   * of the system uses - the observed ledger records it as its own disaster
   * and the verifier grades its sequence under its own subject - and this
   * guard is only a safety net against one arriving twice.
   *
   * The cost, stated rather than hidden: a swarm now produces an outlook per
   * shock instead of one for the cell. Measured on twenty M5.6+ shocks over
   * two and a half days, 22 aftershock outlooks against the old one, with the
   * run's total held at 32 by the cap this loop already breaks on. They are
   * not duplicates - each follows a different earthquake and is graded on
   * that earthquake's own activity - but they do overlap, and if that ever
   * needs narrowing it should be narrowed on the published tolerance and
   * window, which say what a sequence is, and not on a grid, which says only
   * where a boundary fell.
   */
  const seenQuake = new Set();

  for (const e of strongQuakes) {
    if (outlooks.length >= MAX_OUTLOOKS + 8) break;
    const shockMs = Date.parse(e.startedAt || e.updated) || now.getTime();
    const shockEndMs = shockMs + AFTERSHOCK_HORIZON_HOURS * 3600e3;
    if (shockEndMs <= now.getTime()) continue;
    if (seenQuake.has(e.id)) continue;
    seenQuake.add(e.id);
    outlooks.push({
      id: outlookId('aftershock-' + e.id),
      source: 'Predict Natural Disasters · derived from ' + e.source,
      sourceType: 'forecast', type: 'Earthquake aftershock sequence',
      title: 'Aftershock risk ' + nearText(e) + ' — 7-day forecast',
      country: e.country || '', region: e.region || e.sourceTitle || e.title || '',
      alert: num(e.magnitude) >= 6.5 ? 'High' : 'Moderate',
      lat: e.lat, lon: e.lon,
      updated: new Date(shockMs).toISOString(), issuedAt: new Date(shockMs).toISOString(),
      targetStart: new Date(shockMs).toISOString(),
      targetEnd: new Date(shockEndMs).toISOString(),
      details: 'Our own 7-day aftershock forecast after a magnitude ' + num(e.magnitude) + ' earthquake. ' +
        'Aftershocks usually become less frequent over days to weeks, and the largest is often about one magnitude smaller than the main earthquake. ' +
        'More shaking can damage buildings that are already weakened. ' +
        'This is about the aftershocks of this earthquake. It does not predict a new, separate earthquake.',
      /* The magnitude of the mainshock this sequence follows, kept under its own
         name: the outlook itself has no magnitude, and calling it one would
         read as a forecast of a quake that size. The narrative already states
         it, so leaving the field off made the page contradict its own text. */
      ...(num(e.magnitude) !== null ? { mainshockMagnitude: num(e.magnitude) } : {}),
      /* Aftershocks occur around the mainshock, so this one really is as
         localised as the epicentre it is derived from. */
      forecastScope: 'event',
      forecast: true, forecastKind: 'aftershock-sequence', forecastOf: e.id,
      confidence: 'Based on the size of the main earthquake and how aftershocks usually behave',
      evidence: 'Based on the ' + e.source + ' report “' + e.title + '” at ' + utcText(e.updated) + '.',
      sourceUrl: e.sourceUrl || '',
      verificationRule: 'We check this against aftershocks and any further damage reported in the 7 days. We do not claim to have predicted the main earthquake.'
    });
  }

  // (c) Advance predictive model outlooks from data/model-outlooks.json.
  /* Only from a run made in the last 36 hours. The file was committed once,
     by hand, on 14 Oct, and nothing refreshed it: three days later the site
     was still showing that run's forecasts as current. The models now run
     daily (forecast-models.yml); a run older than this is left out, and the
     feed says so, rather than shown as today's. */
  const modelRunAt = MODEL_OUTLOOKS ? Date.parse(MODEL_OUTLOOKS.generatedAt || '') : NaN;
  const modelFresh = Number.isFinite(modelRunAt) && now.getTime() - modelRunAt <= MODEL_RUN_MAX_AGE_MS;
  out.meta.modelRun = MODEL_OUTLOOKS ? {
    at: Number.isFinite(modelRunAt) ? new Date(modelRunAt).toISOString() : null,
    served: modelFresh,
    note: modelFresh ? 'Forecasts from the experimental weather models, run ' + new Date(modelRunAt).toISOString() + '.'
      : 'The experimental weather models have not run in the last 36 hours, so none of their forecasts is shown.'
  } : null;
  if (!isCron(req) && modelFresh && Array.isArray(MODEL_OUTLOOKS.outlooks)) {
    for (const mo of MODEL_OUTLOOKS.outlooks) {
      if (!mo || !mo.targetEnd) continue;
      const endMs = Date.parse(mo.targetEnd);
      if (Number.isFinite(endMs) && endMs > now.getTime()) {
        outlooks.push(Object.assign({}, mo, {
          updated: mo.updated || mo.issuedAt || new Date(now).toISOString(),
          precision: mo.precision || 'regional',
          forecastScope: mo.forecastScope || 'regional',
          issuedAtBasis: mo.issuedAtBasis || 'Timestamp of the numerical weather prediction model run, issued before the target window.'
        }));
      }
    }
  }

  outlooks.forEach(push);
  out.meta.outlooks = outlooks.length;
  out.meta.outlooksWithheld = outlooksWithheld;
  out.meta.forecastNote = outlooks.length
    ? outlooks.length + ' active experimental outlooks derived from ' + okSources.length + ' online official sources, plus the frozen ND-001 benchmark.'
    : 'No active official hazard signal is currently available to derive an outlook from. Only the frozen ND-001 benchmark is shown.';

  /* --------------------------------------------------------- dedupe + sort */

  const seen = new Set();
  const risk = { Red: 4, Orange: 3, High: 3, Moderate: 2, Watch: 1, Green: 1 };
  const byAlertThenTime = (a, b) =>
    (risk[b.alert] || 0) - (risk[a.alert] || 0) || new Date(b.updated) - new Date(a.updated);
  out.events = out.events
    .filter(e => {
      const k = (e.source + '|' + e.title + '|' + e.lat.toFixed(2) + '|' + e.lon.toFixed(2)).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(byAlertThenTime);
  for (const e of out.events) {
    const p = placeLabel(e); if (p) e.place = p;
    const where = countriesOf(e);
    e.countries = where.countries;
    if (where.sea) e.sea = where.sea;
  }

  /* Merging can raise a record's alert — a leader that inherits a graver
     assessment from a discarded member — and the feed was sorted before that
     happened, so a newly Red record kept the position it held while Green.
     The merge itself now runs before the outlooks are derived, above. */
  out.events = out.events.sort(byAlertThenTime);
  out.meta.mergedSeismicReports =
    out.events.filter(e => e.type === 'Earthquake' && e.corroboratedBy && e.corroboratedBy.length).length;

  /* ------------------------------------------------- location precision */

  /*
   * What a record's coordinate actually means.
   *
   * Every source here hands back a single lat/lon, and until now the app
   * treated them all alike. They are not alike. A USGS epicentre is a measured
   * point for the phenomenon itself; a GDACS flood coordinate is the centroid
   * of an alert area that can span a basin; a ReliefWeb record is a country.
   * Personal Risk reads "only incident-level coordinates qualify as nearby
   * risks" off a `precision` field that was set in exactly one branch of this
   * file, so every unlabelled record - which was all of them but ReliefWeb -
   * passed as incident-level and got banded HIGH/ELEVATED by distance. A
   * drought spanning the Horn of Africa could be reported as a hazard 40 km
   * from someone's saved home.
   *
   * Two different questions fall out of this, and conflating them is what
   * went wrong the first time:
   *
   *   proximityEligible - may this record's point carry "N km from you"?
   *                       Only when the point is the incident itself.
   *   areaEligible      - may this record be tested for containment?
   *                       Only when a real affected-area polygon travels
   *                       with it.
   *
   * A National Weather Service warning has both a polygon and a centroid. It
   * is area-eligible and NOT proximity-eligible: whether the warning covers a
   * given place is answerable, while the distance to the middle of a warning
   * zone is a fact about the zone's shape, not about the hazard.
   *
   * This runs after dedupe and seismic merging so the counts published in meta
   * describe the records actually served, not the longer pre-merge list.
   */
  const PRECISION = {
    INCIDENT: 'incident',   // measured point for the phenomenon itself
    POLYGON: 'polygon',     // a real affected-area polygon travels with it
    ADMIN2: 'admin2',       // placed at a county / district
    ADMIN1: 'admin1',       // placed at a state / province
    REGIONAL: 'regional',   // basin, hazard area, multi-admin region
    COUNTRY: 'country',     // country centroid
    UNKNOWN: 'unknown'      // provenance cannot establish any of the above
  };

  /* GDACS publishes one representative point per event and its meaning depends
     on the hazard: EQ is an epicentre, TC a storm centre, VO the volcano. FL,
     DR and WF are alert areas whose point is a centroid, not an incident. */
  const GDACS_INCIDENT = /^(EQ|TC|VO)$/i;

  /* Derived records by id, so an outlook can be read against the signal it was
     derived from rather than against the sentence describing that derivation. */
  const byId = new Map(out.events.map(e => [e.id, e]));

  function classifyPrecision(e, depth) {
    if (e.precision) return e.precision;           // a source that already said
    if (e.geometry) return PRECISION.POLYGON;      // carries its own area
    /* A forecast's source reads "derived from USGS", which the tests below
       would match as an epicentre. It is not one: an outlook is exactly as
       localised as the area it was issued for, which is recorded when it is
       built. Only an outlook tied to one signal may inherit that signal's
       precision, and only by looking the signal up. */
    if (e.forecast) {
      if (e.forecastScope === 'country') return PRECISION.COUNTRY;
      if (e.forecastScope === 'regional') return PRECISION.REGIONAL;
      if (e.forecastScope === 'event' && e.forecastOf && !(depth > 0)) {
        const parent = byId.get(e.forecastOf);
        if (parent) return classifyPrecision(parent, 1);
      }
      return PRECISION.UNKNOWN;
    }
    const src = String(e.source || '');
    if (/USGS/i.test(src) || /EMSC/i.test(src)) return PRECISION.INCIDENT;
    if (/Hurricane Center/i.test(src)) return PRECISION.INCIDENT;
    if (/EONET/i.test(src)) return PRECISION.INCIDENT;
    if (/Weather Service/i.test(src)) return PRECISION.ADMIN2;  // zone centroid
    if (/GDACS/i.test(src)) {
      const t = String(e.rawType || e.gdacsType || '');
      return GDACS_INCIDENT.test(t) ? PRECISION.INCIDENT : PRECISION.REGIONAL;
    }
    return PRECISION.UNKNOWN;
  }

  /* Said in the interface wherever a record is shown against a saved place, so
     the reader is told what the number in front of them is derived from. */
  const PROXIMITY_REASON = {
    incident: 'Incident-level coordinate from the reporting authority.',
    polygon: 'Published with an affected-area polygon: whether a place is covered is decided by containment, not by distance.',
    admin2: 'Placed at the centre of a warning zone, not at an incident.',
    admin1: 'Placed at the centre of a state or province, not at an incident.',
    regional: 'Placed at the centre of a hazard area that can span a region.',
    country: 'Placed at a country centroid, not at an incident.',
    unknown: 'The record does not establish what its coordinate refers to.'
  };

  /* What KIND of evidence a record is, kept separate from where it is. A
     forecast can carry an incident-grade coordinate and still must never be
     listed among things that have happened; a country-level humanitarian
     record is an observation even though it cannot carry a distance.
     Conflating the two axes is what let outlooks and warnings read as
     incidents. */
  function classifyEvidence(e) {
    if (e.forecast) return 'forecast';
    if (/Weather Service/i.test(String(e.source || ''))) return 'official-warning';
    if (e.expiresAt && e.sourceType === 'official') return 'official-warning';
    /* A published hazard status is not an observation of a disaster.
     *
     * A volcano observatory's WATCH or WARNING says a hazardous eruption is
     * imminent, under way or suspected - it does not establish which, and the
     * record carries no impact of its own. Classified as observed, its red or
     * orange colour cleared the significance bar on its own and Kilauea and
     * Great Sitkin were recorded in the ledger of disasters that happened,
     * inflating the recall denominator with two events that may not have
     * occurred. An eruption that does cause harm is reported as an event by a
     * provider that reports events, and that record is the observation. */
    if (e.alertLevel && e.sourceType === 'official') return 'official-warning';
    if (e.sourceType === 'official' || e.sourceType === 'observed') return 'observed';
    return 'unknown';
  }

  for (const e of out.events) {
    const p = classifyPrecision(e);
    e.evidenceState = classifyEvidence(e);
    e.isForecast = !!e.forecast;
    e.locationPrecision = p;
    e.precision = p;                               // back-compat for older reads
    e.proximityEligible = (p === PRECISION.INCIDENT);
    e.areaEligible = !!e.geometry;
    e.proximityReason = PROXIMITY_REASON[p] || PROXIMITY_REASON.unknown;
  }
  out.meta.locationPrecision = out.events.reduce((m, e) => {
    m[e.locationPrecision] = (m[e.locationPrecision] || 0) + 1; return m;
  }, {});
  out.meta.proximityEligible = out.events.filter(e => e.proximityEligible).length;
  out.meta.areaEligible = out.events.filter(e => e.areaEligible).length;
  out.meta.evidenceState = out.events.reduce((m, e) => {
    m[e.evidenceState] = (m[e.evidenceState] || 0) + 1; return m;
  }, {});

  /* ------------------------------------------------- forecast causality */

  /*
   * When can this application prove it held a forecast?
   *
   * Not from issuedAt. For a derived outlook, issuedAt is the anchor time of
   * the upstream signal - the moment the hazard was reported, which is before
   * the outlook existed at all. Grading a window from there credits the system
   * for the stretch between the hazard appearing and anything being written
   * down about it.
   *
   * The defensible timestamp is the earliest immutable record: a row in the
   * append-only outlook ledger, which lives in git. Where a record documents
   * its own repository provenance - the frozen benchmark names the commit that
   * introduced it - that stands. Failing both, the forecast is not known to
   * have existed before this response computed it, and says so.
   */
  const ledgerFreeze = new Map();
  /* Every id the ledger holds a claim for, whatever its terms. */
  const ledgerIds = new Set();
  if (Array.isArray(OUTLOOK_LEDGER)) {
    for (const row of OUTLOOK_LEDGER) {
      if (row && row.id !== undefined) ledgerIds.add(row.id);
      /* Every term the verifier grades on, not the id and the window's start:
         a row proves the claim it recorded, and cannot prove one whose window
         or geography has since moved. Shared with the ledger writer so the
         two cannot disagree about what a claim is. */
      const k = HAZARD_MODEL.claimKey(row);
      const at = row.freezeTimestamp || row.recordedAt;
      /* Append-only, but a row can only ever have been written once; if two
         carry the same key the earlier one is the one that proves existence. */
      if (at && (!ledgerFreeze.has(k) || at < ledgerFreeze.get(k))) ledgerFreeze.set(k, at);
    }
  }

  const byIdForClass = new Map(out.events.map(e => [e.id, e]));
  const generatedAt = now.toISOString();

  for (const e of out.events) {
    if (!e.forecast) continue;
    e.generatedAt = generatedAt;
    /* What the upstream signal said about itself, kept under a name that says
       whose claim it is. issuedAt stays put so older readers are unaffected. */
    if (e.issuedAt && e.sourceIssuedAt === undefined) e.sourceIssuedAt = e.issuedAt;

    /* The EARLIEST proof, not the first one looked at. A record can be backed
       by more than one immutable artefact - the frozen benchmark names the
       commit that introduced it and was also written to the ledger two days
       later - and taking whichever came to hand would move a freeze later than
       the repository can already show. Later is the safer direction, but it is
       still not what the evidence says. */
    const k = HAZARD_MODEL.claimKey(e);
    const proofs = [];
    if (ledgerFreeze.has(k)) {
      proofs.push({ at: ledgerFreeze.get(k), basis: 'Earliest row in the append-only outlook ledger in the repository.' });
    }
    /* A record's own repository provenance proves the terms it was committed
       with. Once the ledger holds this id under other terms and none under
       these, the terms have been revised since, and the commit it names is
       proof of the earlier claim - which the ledger already carries - not of
       this one. */
    const revised = ledgerIds.has(e.id) && !ledgerFreeze.has(k);
    if (e.issuedAtBasis && e.issuedAt && !revised) {
      proofs.push({ at: e.issuedAt, basis: e.issuedAtBasis });
    }
    proofs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (proofs.length) {
      e.freezeTimestamp = proofs[0].at;
      e.freezeBasis = proofs[0].basis;
      e.freezeEvidenced = true;
    } else {
      /* A timestamp, but not a proof: this is when the response ran, which
         nothing outside the response can check. Readers downstream - the
         ledger writer, the classifier - need to be able to tell the two
         apart, so the difference is stated rather than left to be inferred
         from the wording. */
      e.freezeTimestamp = generatedAt;
      e.freezeBasis = revised
        ? 'The ledger records this forecast only under earlier terms. Nothing in the repository records these terms yet, so they are not established before the moment this response computed them.'
        : 'Nothing in the repository records this forecast yet, so it is not established before the moment this response computed it.';
      e.freezeEvidenced = false;
    }

    if (HAZARD_MODEL && HAZARD_MODEL.classifyForecast) {
      const c = HAZARD_MODEL.classifyForecast(e, byIdForClass.get(e.forecastOf));
      if (c) { e.forecastClass = c.forecastClass; e.classificationReason = c.classificationReason; }
      e.effectiveForecastStart = HAZARD_MODEL.effectiveForecastStart(e);
      const credited = HAZARD_MODEL.creditedWindowHours(e);
      if (credited !== null) e.creditedWindowHours = Math.round(credited * 10) / 10;
      const cls = HAZARD_MODEL.FORECAST_CLASSES[e.forecastClass];
      e.countsTowardHeadlineAccuracy = !!(cls && cls.headline);
    }
  }

  out.meta.forecastClass = out.events.reduce((m, e) => {
    if (e.forecastClass) m[e.forecastClass] = (m[e.forecastClass] || 0) + 1;
    return m;
  }, {});
  out.meta.headlineEligibleForecasts = out.events.filter(e => e.countsTowardHeadlineAccuracy).length;

  /* ------------------------------------------------------- scan provenance */

  /*
   * What was actually looked at, and what it can and cannot cover.
   *
   * The app reported which upstreams answered, and nothing else. That is
   * enough to say a provider was reachable and not nearly enough to say a
   * disaster would have been seen: a flood in a country ReliefWeb has not
   * declared, an earthquake below USGS's 2.5 threshold, or a storm outside the
   * two basins the National Hurricane Center publishes are all invisible here,
   * and the absence of a record for them says nothing about the world.
   *
   * That distinction is what separates a missed forecast from an unscanned
   * place, so each provider states its own reach in terms the code can be held
   * to, and the scan records which of them were actually evaluated on this
   * run. There is no global cell-level scan and this never claims one.
   */
  const ENGINE_VERSION = 'scan-1.0.0';

  const COVERAGE_STATUS = {
    SCANNED: 'SCANNED',                 // evaluated, within the reach stated below
    INCOMPLETE_SCAN: 'INCOMPLETE_SCAN', // evaluated, but the run is known to have missed part of it
    NOT_SCANNED: 'NOT_SCANNED',         // not attempted on this run
    DATA_UNAVAILABLE: 'DATA_UNAVAILABLE'// attempted and the provider did not answer
  };

  const PROVIDERS = {
    gdacs: {
      label: 'GDACS (Global Disaster Alert and Coordination System)',
      inputKind: 'observation',
      inputBasis: 'GDACS raises alerts on events it has already detected, so its records say what is happening rather than what will.',
      hazards: ['Earthquake', 'Tropical Cyclone', 'Flood', 'Drought', 'Wildfire', 'Volcano'],
      geographicCoverage: 'Global',
      coverageResolution: 'Only events GDACS itself raises to an alert level. Flood, drought and wildfire records describe alert areas, not incident points.',
      endpoint: 'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP',
      scope: { kind: 'global' },
      completeness: 'selective',
      recordsObservations: true,
      completenessBasis: 'GDACS lists only events it raises to an alert level, so a disaster it does not carry may simply be below that threshold.'
    },
    usgs: {
      label: 'USGS Earthquake Hazards Program',
      inputKind: 'observation',
      inputBasis: 'A catalogue of earthquakes that have occurred.',
      hazards: ['Earthquake'],
      geographicCoverage: 'Global',
      coverageResolution: 'Every earthquake of magnitude 2.5 or above in the past seven days, at its epicentre. Anything smaller, or older, is outside this feed.',
      endpoint: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
      scope: { kind: 'global' },
      completeness: 'exhaustive',
      recordsObservations: true,
      completenessBasis: 'A complete catalogue of earthquakes of magnitude 2.5 and above for the past seven days, so an absence above that threshold is meaningful.'
    },
    emsc: {
      label: 'EMSC (European-Mediterranean Seismological Centre)',
      inputKind: 'observation',
      inputBasis: 'A catalogue of earthquakes that have occurred.',
      hazards: ['Earthquake'],
      geographicCoverage: 'Global, with the densest network in Europe and the Mediterranean',
      coverageResolution: 'Earthquakes of magnitude 4.5 or above, at epicentre.',
      endpoint: 'https://www.emsc-csem.org/',
      scope: { kind: 'global' },
      completeness: 'exhaustive',
      recordsObservations: true,
      completenessBasis: 'A complete catalogue above magnitude 4.5.'
    },
    eonet: {
      label: 'NASA EONET',
      inputKind: 'observation',
      inputBasis: 'A curated catalogue of natural events already under way.',
      hazards: ['Wildfire', 'Volcano', 'Severe Storm', 'Tropical Cyclone', 'Ice', 'Landslide'],
      geographicCoverage: 'Global',
      coverageResolution: 'A curated set of events drawn from Earth-observation sources. EONET does not claim to list every event, so absence here is not evidence of absence.',
      endpoint: 'https://eonet.gsfc.nasa.gov/api/v3/events',
      scope: { kind: 'global' },
      completeness: 'selective',
      recordsObservations: true,
      completenessBasis: 'A curated set; EONET does not claim to list every event, so its silence is not evidence.'
    },
    nhc: {
      label: 'NOAA National Hurricane Center',
      inputKind: 'forecast',
      inputBasis: 'The hurricane centre publishes advisories for active systems, including where a storm is expected to go, which is an input to a forecast of what it has not yet done.',
      hazards: ['Tropical Cyclone'],
      geographicCoverage: 'Atlantic, eastern Pacific and central Pacific basins only',
      coverageResolution: 'Active tropical cyclones, at storm centre. Storms in the western Pacific, Indian Ocean and southern hemisphere are outside this provider entirely.',
      endpoint: 'https://www.nhc.noaa.gov/CurrentStorms.json',
      /* The published basin bounds, approximated as boxes. Approximate in the
         safe direction: a storm this cannot place is treated as outside the
         provider's reach, which makes coverage unestablished rather than
         blaming the forecasting engine for missing it. */
      scope: { kind: 'boxes', boxes: [
        { name: 'Atlantic', minLat: -5, maxLat: 60, minLon: -100, maxLon: 0 },
        { name: 'Eastern and central Pacific', minLat: -5, maxLat: 60, minLon: -180, maxLon: -75 }
      ] },
      completeness: 'exhaustive',
      recordsObservations: true,
      completenessBasis: 'Every active tropical cyclone in the basins it publishes for.'
    },
    nws: {
      label: 'NOAA / National Weather Service',
      inputKind: 'forecast',
      inputBasis: 'A watch or warning states that severe weather is expected, which is a statement about what has not happened yet.',
      hazards: ['Flood', 'Severe Weather', 'Extreme Heat', 'Winter Storm', 'Tornado'],
      geographicCoverage: 'United States and its territories only',
      coverageResolution: 'Alerts at severe or extreme severity, carrying the affected-area polygon where the agency published one and a forecast-zone centre where it did not.',
      endpoint: 'https://api.weather.gov/alerts/active',
      scope: { kind: 'countries', countries: ['United States'] },
      completeness: 'selective',
      recordsObservations: false,
      completenessBasis: 'Exhaustive for active warnings, but a warning is not an observation: these records never enter the observed-disaster ledger, so this provider cannot establish that no disaster occurred.'
    },
    reliefweb: {
      label: 'ReliefWeb (UN OCHA)',
      inputKind: 'observation',
      inputBasis: 'Situation reports and declarations published after a disaster has occurred.',
      hazards: ['Flood', 'Drought', 'Earthquake', 'Tropical Cyclone', 'Complex Emergency'],
      geographicCoverage: 'Global',
      coverageResolution: 'Country-level humanitarian disaster declarations. These carry no incident coordinates and are placed at a country centroid.',
      endpoint: 'https://reliefweb.int/disasters/feed',
      scope: { kind: 'global' },
      completeness: 'selective',
      recordsObservations: true,
      completenessBasis: 'Only disasters ReliefWeb has declared, which is a subset of those that occur.'
    },
    usgs_volcano: {
      label: 'USGS Volcano Hazards Program',
      inputKind: 'forecast',
      inputBasis: 'A volcano alert level states expected activity - a watch or warning is issued for unrest before an eruption, not after it.',
      hazards: ['Volcano'],
      geographicCoverage: 'Volcanoes monitored by the United States volcano observatories',
      coverageResolution: 'Volcanoes currently at an elevated alert level. Volcanoes outside the US observatory network are not covered by this provider.',
      endpoint: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
      scope: { kind: 'countries', countries: ['United States'] },
      completeness: 'exhaustive',
      recordsObservations: false,
      completenessBasis: 'Exhaustive for elevated alert levels in the observatory network it covers, which is not the same as exhaustive for eruptions that caused harm: an alert level is a published status, these records never enter the observed-disaster ledger, and their silence establishes only that nothing was elevated.'
    }
  };

  /* Which provider a served record came from, decided once from the source
     label so the freshness and record counts below cannot drift from the
     events themselves. Volcano is tested before the general USGS pattern,
     since its label contains both. */
  const PROVIDER_OF_SOURCE = [
    [/USGS Volcano/i, 'usgs_volcano'],
    [/GDACS/i, 'gdacs'],
    [/USGS/i, 'usgs'],
    [/EMSC/i, 'emsc'],
    [/EONET/i, 'eonet'],
    [/Hurricane Center/i, 'nhc'],
    [/Weather Service/i, 'nws'],
    [/ReliefWeb/i, 'reliefweb']
  ];

  function providerOf(source) {
    const s = String(source || '');
    /* A derived outlook names the signal it came from inside its own source
       string. It is this engine's own record, not the provider's, and counting
       it as one would inflate what the provider was seen to deliver. */
    if (/^Predict Natural Disasters/i.test(s)) return null;
    for (const [re, key] of PROVIDER_OF_SOURCE) if (re.test(s)) return key;
    return null;
  }

  /* A run that fell back to a thinner feed, or dropped records it could not
     place, scanned less than the provider covers, and says so rather than
     reporting a clean sweep. */
  function scanStatusOf(key, s) {
    if (!s) return { status: COVERAGE_STATUS.NOT_SCANNED, reason: 'Not attempted on this run.' };
    if (!s.ok) {
      return { status: COVERAGE_STATUS.DATA_UNAVAILABLE,
        reason: s.error ? String(s.error) : 'The provider did not answer.' };
    }
    if (key === 'gdacs' && s.endpoint === 'rss') {
      return { status: COVERAGE_STATUS.INCOMPLETE_SCAN,
        reason: 'The JSON endpoints did not answer and the RSS fallback carries fewer fields per event.' };
    }
    /* A hazard whose search failed, or whose history filled every page this
       run asked for, was not read in full: the events GDACS lists as active
       are still carried, but older ones may not be. */
    if (key === 'gdacs' && Array.isArray(s.incomplete) && s.incomplete.length) {
      return { status: COVERAGE_STATUS.INCOMPLETE_SCAN,
        reason: 'GDACS was not read in full for ' + s.incomplete.map(gdacsHazardName).join(', ') +
          ': the search failed or every page asked for came back full.' };
    }
    if (key === 'nws') {
      if (s.query && s.query !== 'status=actual&message_type=alert&severity=Extreme,Severe') {
        return { status: COVERAGE_STATUS.INCOMPLETE_SCAN,
          reason: 'The full alert query was rejected and a broader fallback was used: ' + s.query };
      }
      if (s.unplaceable > 0) {
        return { status: COVERAGE_STATUS.INCOMPLETE_SCAN,
          reason: s.unplaceable + ' alert(s) could not be placed and were left out.' };
      }
    }
    if (key === 'reliefweb' && s.unplacedCountries > 0) {
      return { status: COVERAGE_STATUS.INCOMPLETE_SCAN,
        reason: s.unplacedCountries + ' declaration(s) named a country that could not be resolved and were left out.' };
    }
    return { status: COVERAGE_STATUS.SCANNED, reason: '' };
  }

  const scanId = 'scan-' + now.toISOString().replace(/[:.]/g, '-');
  const freshest = {};
  const served = {};
  for (const e of out.events) {
    const key = providerOf(e.source);
    if (!key) continue;
    served[key] = (served[key] || 0) + 1;
    const t = Date.parse(e.updated || '');
    if (Number.isFinite(t) && (!freshest[key] || t > freshest[key])) freshest[key] = t;
  }

  out.meta.scan = {
    scanId: scanId,
    scanTimestamp: now.toISOString(),
    engineVersion: ENGINE_VERSION,
    /* Said once, plainly, so nothing downstream has to infer it: this engine
       evaluates what these providers publish. It does not sweep the world. */
    coverageLimitation: 'This engine evaluates what the providers below publish. There is no global cell-by-cell scan, ' +
      'and no claim is made about hazards outside each provider’s stated reach. A place absent from every provider ' +
      'was not examined and must not be read as quiet.',
    providers: Object.keys(PROVIDERS).map(key => {
      const s = out.meta.sources[key];
      const st = scanStatusOf(key, s);
      return {
        provider: key,
        label: PROVIDERS[key].label,
        hazards: PROVIDERS[key].hazards,
        /* Whether this source can support a forecast at all, or only report
           what has already happened. A scan of a catalogue of things that
           have occurred puts nothing in a position to predict one. */
        inputKind: PROVIDERS[key].inputKind,
        inputBasis: PROVIDERS[key].inputBasis,
        geographicCoverage: PROVIDERS[key].geographicCoverage,
        coverageResolution: PROVIDERS[key].coverageResolution,
        scope: PROVIDERS[key].scope,
        completeness: PROVIDERS[key].completeness,
        completenessBasis: PROVIDERS[key].completenessBasis,
        recordsObservations: PROVIDERS[key].recordsObservations,
        /* ReliefWeb answers from its API or its feed: name the one that did. */
        endpoint: key === 'reliefweb' && s && s.via === 'api' ? s.endpoint : PROVIDERS[key].endpoint,
        status: st.status,
        success: !!(s && s.ok),
        failureReason: st.reason || null,
        recordsEvaluated: (s && typeof s.records === 'number') ? s.records : (served[key] || 0),
        recordsServed: served[key] || 0,
        dataFreshness: freshest[key] ? new Date(freshest[key]).toISOString() : null,
        checkedAt: (s && s.checkedAt) || null
      };
    })
  };
  out.meta.scan.coverage = out.meta.scan.providers.reduce((m, p) => {
    m[p.status] = (m[p.status] || 0) + 1; return m;
  }, {});

  // Severity is comparable across hazards; alert level is not, because each
  // agency publishes its own scale. Lead time says whether a forecast was
  // issued ahead of its window or merely restates something already under way.
  if (HAZARD_MODEL) {
    for (const e of out.events) {
      e.severity = HAZARD_MODEL.severityOf(e);
      e.severityRank = HAZARD_MODEL.severityRank(e);
      const lead = HAZARD_MODEL.leadTimeHours(e);
      if (lead !== null) e.leadTimeHours = lead;
    }
    out.meta.severityCounts = out.events.reduce((m, e) => {
      m[e.severity] = (m[e.severity] || 0) + 1; return m;
    }, {});
    out.meta.highSeverityCount = out.events.filter(e => e.severityRank >= 4).length;
    out.meta.aheadOfWindowForecastCount =
      out.events.filter(e => e.forecast && Number(e.leadTimeHours) > 0).length;
  }
  out.meta.hazardModel = HAZARD_MODEL ? 'loaded' : 'unavailable';
  /* What moved in the forecast set since the previous recorded run, and how
     often that recording actually happens. Both are read from what the job
     wrote, so neither can drift from the schedule the job really keeps. */
  if (FORECAST_CHANGES && Array.isArray(FORECAST_CHANGES.runs) && FORECAST_CHANGES.runs.length) {
    const last = FORECAST_CHANGES.runs[FORECAST_CHANGES.runs.length - 1];
    const n = a => (Array.isArray(a) ? a.length : 0);
    out.meta.forecastChanges = {
      at: last.at,
      sinceHours: last.sinceHours,
      activeOutlooks: last.active,
      baseline: !!last.baseline,
      added: n(last.added),
      raised: n(last.raised),
      lowered: n(last.lowered),
      windowMoved: n(last.windowMoved),
      gone: n(last.gone),
      expired: n(last.expired),
      unavailable: n(last.unavailable),
      sourcesDown: last.sourcesDown || [],
      total: n(last.added) + n(last.raised) + n(last.lowered) +
        n(last.windowMoved) + n(last.gone) + n(last.expired),
      records: {
        added: last.added || [], raised: last.raised || [],
        lowered: last.lowered || [], windowMoved: last.windowMoved || [],
        gone: last.gone || [], expired: last.expired || [],
        unavailable: last.unavailable || []
      }
    };
    out.meta.refreshRecorded = Object.assign(
      { schedule: 'hourly', runsRecorded: FORECAST_CHANGES.runs.length },
      FORECAST_CHANGES.observedCadenceHours || {},
      { note: 'The written record is what runs on a schedule. The feed above ' +
        'is recomputed from the upstream sources whenever the last copy is more than ' +
        '30 seconds old, and no copy served is older than 90 seconds.' });
  } else {
    out.meta.forecastChanges = null;
  }


  // What has actually been written down, as opposed to what is live now.
  if (Array.isArray(OUTLOOK_LEDGER)) {
    const closed = OUTLOOK_LEDGER.filter(o => Date.parse(o.targetEnd) <= now.getTime());
    out.meta.ledger = {
      status: 'loaded',
      recorded: OUTLOOK_LEDGER.length,
      windowClosed: closed.length,
      graded: closed.filter(o => o.outcome).length,
      awaitingGrading: closed.filter(o => !o.outcome).length
    };
  } else {
    out.meta.ledger = { status: 'unavailable' };
  }

  /* A forecast whose window has already closed is history, not an outlook.
     Signal-derived outlooks are dropped once their window ends, but the frozen
     ND-001 benchmark is deliberately kept so its grading stays visible — and it
     was being counted among the active forecasts four days after its window
     closed. It is marked instead of removed. */
  for (const e of out.events) {
    if (e.forecast && e.targetEnd && Date.parse(e.targetEnd) <= now.getTime()) e.windowClosed = true;
  }

  out.meta.eventCount = out.events.length;
  out.meta.officialCount = out.events.filter(e => e.sourceType === 'official').length;
  out.meta.forecastCount = out.events.filter(e => e.forecast).length;
  out.meta.activeForecastCount = out.events.filter(e => e.forecast && !e.windowClosed).length;
  out.meta.closedForecastCount = out.events.filter(e => e.windowClosed).length;
  out.meta.countryCount = new Set(out.events.map(e => e.country).filter(Boolean)).size;
  /* How far ahead this site actually looks. The horizon was implicit in each
     record's own window and stated nowhere, so "until when have predictions
     been made" could only be answered by opening all thirty of them. */
  const openWindows = out.events.filter(e => e.forecast && !e.windowClosed);
  const ends = openWindows.map(e => Date.parse(e.targetEnd || ''))
    .filter(Number.isFinite).sort((a, b) => a - b);
  const lengths = [...new Set(openWindows.map(e => {
    const a = Date.parse(e.targetStart || ''), b = Date.parse(e.targetEnd || '');
    return Number.isFinite(a) && Number.isFinite(b)
      ? Math.round((b - a) / 86400000 * 10) / 10 : null;
  }).filter(v => v !== null))].sort((a, b) => a - b);
  out.meta.forecastHorizon = ends.length ? {
    nextWindowEnds: new Date(ends[0]).toISOString(),
    furthestWindowEnds: new Date(ends[ends.length - 1]).toISOString(),
    daysAhead: Math.round((ends[ends.length - 1] - now.getTime()) / 86400000 * 10) / 10,
    windowLengthDays: lengths,
    /* Said once, here, so no page has to phrase it for itself: nothing on this
       site looks further ahead than this, and the absence of a forecast beyond
       it is a limit of the method, not a forecast of calm. */
    note: 'No outlook on this site extends past the furthest window end. ' +
      'Beyond it there is no forecast at all — which is not the same as a forecast of no hazard.'
  } : null;

  out.meta.hazardTypeCount = new Set(out.events.map(e => e.type).filter(Boolean)).size;
  out.meta.highRiskForecastCount =
    out.events.filter(e => e.forecast && !e.windowClosed && e.alert === 'High').length;
  out.meta.officialWarningCount =
    out.events.filter(e => e.sourceType === 'official' && (e.alert === 'Red' || e.alert === 'Orange')).length;

  // The counts without the records, so the deployed feed can be checked
  // without transferring every event to do it.
  if (wantsLedger(req)) {
    res.status(200).json({
      generatedAt: out.generatedAt,
      meta: { ledger: out.meta.ledger },
      ledger: Array.isArray(OUTLOOK_LEDGER) ? OUTLOOK_LEDGER : []
    });
    return;
  }

  if (wantsSummary(req)) {
    res.status(200).json({ generatedAt: out.generatedAt, meta: out.meta });
    return;
  }

  res.status(200).json(out);
}

module.exports = handler;
module.exports.default = handler;
module.exports.normalizeType = normalizeType;
module.exports.centroid = centroid;
module.exports.insidePoint = insidePoint;
module.exports.inRing = inRing;
module.exports.polygonsOf = polygonsOf;
module.exports.inPolygon = inPolygon;
module.exports.mergeSeismicReports = mergeSeismicReports;
module.exports.mergeCycloneReports = mergeCycloneReports;
module.exports.countriesOf = countriesOf;
module.exports.plainTitle = plainTitle;
module.exports.placeLabel = placeLabel;
module.exports.oceanName = oceanName;
module.exports.countryAt = countryAt;
module.exports.markLive = markLive;
module.exports.gdacsTime = gdacsTime;
module.exports.eonetTropicalCyclone = eonetTropicalCyclone;
