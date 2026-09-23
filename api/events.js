'use strict';
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

const MAX_OUTLOOKS = 24;
const OUTLOOK_HORIZON_HOURS = 72;
const AFTERSHOCK_HORIZON_HOURS = 168;

/* ------------------------------------------------------------------ utils */

const iso = d => new Date(d).toISOString().slice(0, 10);
const num = v => (Number.isFinite(+v) ? +v : null);

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
  }
  // Rebuild in the caller's order so the newest-first sort survives the merge.
  return events.filter(e => { const g = groupOf.get(e); return !g || g.lead === e; });
}

/** ?summary=1 asks for the meta block alone. */
function wantsLedger(req) {
  const v = (req && req.query && req.query.ledger) ||
    (req && req.url && new URL(req.url, 'http://x').searchParams.get('ledger'));
  return v === '1' || v === 'true';
}

function wantsSummary(req) {
  const v = (req && req.query && req.query.summary) ||
    (req && req.url && new URL(req.url, 'http://x').searchParams.get('summary'));
  return v === '1' || v === 'true';
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

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
      /* The feed itself is recomputed from the upstream sources on every
         request, so a page load is never serving a cached forecast. What runs
         on a schedule is the written record — the ledger and the change log —
         and that is described by refreshRecorded, measured rather than
         declared. This field used to state a five-minute rate, which was the cron's
         request and about a fortieth of what GitHub actually granted it. */
      refreshTarget: 'recomputed on every request'
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

  const parseGdacsJson = j => {
    const arr = Array.isArray(j) ? j : (j.features || j.data || j.results || []);
    let n = 0;
    for (const x of arr) {
      const p = x.properties || x;
      let coords = (x.geometry && x.geometry.coordinates) || [p.longitude || p.lon, p.latitude || p.lat];
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
      push({
        id: 'gdacs-' + et + '-' + eid,
        source: 'GDACS', sourceType: 'official',
        type: GDACS_TYPES[et] || normalizeType(et),
        title: p.name || p.title || p.eventname || (et + ' event'),
        country: p.country || p.countryname || p.iso3 || '',
        region: p.location || p.description || '',
        alert: p.alertlevel || p.alertLevel || 'Green',
        lat: coords[1], lon: coords[0],
        startedAt: p.fromdate || p.fromDate || null,
        updated: p.todate || p.toDate || p.fromdate || p.fromDate || p.date || now.toISOString(),
        details: [p.description || p.eventdescription || '', measured.severityText || '']
          .filter(Boolean).join(' · '),
        ...counts,
        ...measured,
        sourceUrl: 'https://www.gdacs.org/report.aspx?eventid=' + encodeURIComponent(eid) + '&eventtype=' + encodeURIComponent(et),
        rawId: eid, rawType: et
      });
      n++;
    }
    return n;
  };

  const parseGdacsRss = xml => {
    let n = 0;
    for (const m of String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
      const b = m[1];
      const lat = num(tag('geo:lat', b) || tag('lat', b));
      const lon = num(tag('geo:long', b) || tag('long', b));
      const et = tag('gdacs:eventtype', b) || 'Disaster';
      const eid = tag('gdacs:eventid', b) || tag('guid', b);
      if (lat === null || lon === null || !eid) continue;
      push({
        id: 'gdacs-' + et + '-' + eid,
        source: 'GDACS', sourceType: 'official',
        type: GDACS_TYPES[et] || normalizeType(et),
        title: tag('title', b) || (et + ' event'),
        country: tag('gdacs:country', b) || '',
        region: tag('gdacs:location', b) || '',
        alert: tag('gdacs:alertlevel', b) || 'Green',
        lat, lon,
        startedAt: tag('gdacs:fromdate', b) || null,
        updated: tag('gdacs:todate', b) || tag('pubDate', b) || now.toISOString(),
        details: tag('description', b) || '',
        sourceUrl: tag('link', b) || 'https://www.gdacs.org/',
        rawId: eid, rawType: et
      });
      n++;
    }
    return n;
  };

  const jobs = [];

  // 1. GDACS — multi-hazard global alerts (JSON, app endpoint, then RSS).
  jobs.push((async () => {
    const search = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=' +
      iso(from) + '&toDate=' + iso(now) + '&alertlevel=Green;Orange;Red';
    try {
      const n = parseGdacsJson(await timedFetch(search));
      out.meta.gdacs = true; mark('gdacs', true, { records: n, endpoint: 'search' });
      return;
    } catch (e) { /* fall through */ }
    try {
      const n = parseGdacsJson(await timedFetch('https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP'));
      out.meta.gdacs = true; mark('gdacs', true, { records: n, endpoint: 'events4app' });
      return;
    } catch (e) { /* fall through */ }
    try {
      const n = parseGdacsRss(await timedFetch('https://www.gdacs.org/xml/rss.xml', { text: true, headers: { accept: 'application/rss+xml, application/xml' } }));
      out.meta.gdacs = true; mark('gdacs', true, { records: n, endpoint: 'rss' });
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
          alert: pagerLevel(f.properties.alert),
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
        push({
          id: 'eonet-' + v.id,
          source: 'NASA EONET', sourceType: 'official', type: normalizeType(cat),
          // "RX" is fire-management shorthand for a prescribed fire, so EONET titles
          // read "Prescribed Fire RX Tom Green" — the same words twice, one of them
          // an abbreviation.
          title: eonetTitle,
          country: eonetPlace ? eonetPlace.country : '',
          admin1: eonetPlace ? eonetPlace.admin1 : '',
          admin2: eonetPlace ? eonetPlace.admin2 : '',
          region: eonetPlace ? eonetPlace.region : '',
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
          alert: intensity >= 96 ? 'Red' : intensity >= 64 ? 'Orange' : 'Green',
          windKt: intensity,
          lat, lon,
          updated: s.lastUpdate || now.toISOString(),
          details: 'Active system · maximum sustained wind ' + (intensity === null ? '—' : intensity + ' kt') +
            (s.pressure ? ' · minimum pressure ' + s.pressure + ' mb' : '') +
            (s.movementDir != null ? ' · moving ' + s.movementDir + '° at ' + (s.movementSpeed || '—') + ' kt' : ''),
          sourceUrl: (s.publicAdvisory && s.publicAdvisory.url) || 'https://www.nhc.noaa.gov/',
          windKt: intensity
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
            alert: p.severity === 'Extreme' ? 'Red' : 'Orange',
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

  // 6. ReliefWeb (UN OCHA) — currently listed humanitarian disasters.
  //    The v2 API needs an appname approved by ReliefWeb, so read the public
  //    disasters feed instead: no credential, no setup.
  //
  //    The feed carries no coordinates, so each record is placed at its
  //    country's location via Open-Meteo's key-less geocoder and flagged
  //    precision:'country' — this is a country-level humanitarian record, not
  //    an incident position, and the UI says so. A record whose country cannot
  //    be resolved is left out rather than placed somewhere plausible.
  jobs.push((async () => {
    // The exact feed path is not documented, and a Drupal miss can answer 200
    // with an HTML page, so try each candidate and require it to parse into
    // items before accepting it. `endpoint` records which one answered.
    const feeds = [
      'https://reliefweb.int/disasters/rss.xml?view=ongoing',
      'https://reliefweb.int/disasters/rss.xml',
      'https://reliefweb.int/disasters/feed'
    ];
    let xml = '', endpoint = '', lastError = 'no candidate feed returned items';
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
    if (!xml) { mark('reliefweb', false, { error: lastError, tried: feeds.length }); return; }

    try {
      const items = [];
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
      mark('reliefweb', true, { records: n, unplacedCountries: unplaced, endpoint });
    } catch (e) {
      mark('reliefweb', false, { error: String(e.message || e) });
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
          title: name + ' — ' + (level || 'elevated') + ' alert level',
          country: 'United States', region: v.obs_fullname || v.observatory || v.obs_abbr || '',
          alert: level === 'WARNING' ? 'Red' : level === 'WATCH' ? 'Orange' : 'Green',
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
    details: 'Starts 13 Sep 2026; expected duration 4 days. Written 19 hours after the window opened, so it carries no lead time; it is still graded against independently observed impact rather than against rainfall or a warning alone.',
    forecast: true, forecastKind: 'frozen-benchmark', confidence: 'Benchmark — frozen, but not issued in advance',
    /* The record already names a corridor. Saying so keeps its coordinate
       from being read as the point where the flooding was expected. */
    forecastScope: 'regional',
    evidence: 'Frozen as the platform’s first graded benchmark. The record was committed at 2026-09-13T19:20:03Z against a window that opened at 2026-09-13T00:00:00Z, so it did not anticipate the onset.',
    verificationRule: 'Counts as correct only if meaningful flood or landslide impact is independently observed inside the frozen geography and window.',
    sourceUrl: '/verification'
  });

  /* ------------------------------------------------- experimental outlooks */

  const mechanism = t => {
    const s = String(t).toLowerCase();
    if (/flood/.test(s)) return 'continued or renewed flooding and inundation where hydrological stress persists';
    if (/cyclone|storm|hurricane|typhoon|tornado/.test(s)) return 'continued wind, surge and rainfall impacts along the active storm footprint';
    if (/wildfire|fire/.test(s)) return 'continued fire spread, smoke and evacuation pressure while the fire remains uncontrolled';
    if (/volcan/.test(s)) return 'continued volcanic unrest, ashfall or exclusion-zone impacts while official activity remains elevated';
    if (/landslide/.test(s)) return 'additional slope failures where terrain remains saturated or unstable';
    if (/drought/.test(s)) return 'continued water stress and agricultural impacts while drought conditions persist';
    if (/heat/.test(s)) return 'continued heat-health impacts while the heat episode persists';
    if (/tsunami/.test(s)) return 'continued coastal and harbour hazard while the marine advisory remains in force';
    return 'continued hazard impacts while the official signal remains active';
  };

  const outlookId = sourceId => 'OUT-' + String(sourceId).replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-48);

  const priority = { Red: 4, Orange: 3, High: 3, Green: 1 };
  const officialSignals = out.events.filter(e =>
    e.sourceType === 'official' && !e.forecast && Number.isFinite(+e.lat) && Number.isFinite(+e.lon));

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

  for (const e of continuation) {
    if (outlooks.length >= MAX_OUTLOOKS) break;
    // The signal's own last-updated time, not the clock: see below.
    const anchorMs = Date.parse(e.updated) || now.getTime();
    const windowEndMs = anchorMs + horizonFor(e.type) * 3600e3;
    // A window that has already closed is history, not an outlook.
    if (windowEndMs <= now.getTime()) continue;
    const area = ((e.country || e.region || e.title) + '|' + e.type).toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (seenArea.has(area)) continue;
    seenArea.add(area);
    outlooks.push({
      id: outlookId(e.id),
      source: 'Predict Natural Disasters · derived from ' + e.source,
      sourceType: 'forecast', type: e.type,
      title: windowText(horizonFor(e.type)) + ' ' + e.type + ' risk outlook — ' + (e.country || e.region || e.title),
      country: e.country || '', region: e.region || e.title || '',
      alert: e.alert === 'Red' ? 'High' : e.alert === 'Orange' ? 'Moderate' : 'Watch',
      lat: e.lat, lon: e.lon,
      updated: new Date(anchorMs).toISOString(), issuedAt: new Date(anchorMs).toISOString(),
      targetStart: new Date(anchorMs).toISOString(),
      targetEnd: new Date(windowEndMs).toISOString(),
      details: 'Experimental ' + windowText(horizonFor(e.type)) + ' outlook derived from an active ' + e.source +
        ' signal, over a window matched to how this hazard develops rather than a fixed three days. Outlook: ' +
        mechanism(e.type) + '. This is not a deterministic prediction and must not replace official warnings.',
      /* An outlook is no more precise than the area it is issued for, and
         the title above names that area: the signal's country where it has
         one, else its region, else the single event itself. Without this the
         outlook inherited the parent's coordinate meaning through the source
         string - so a wildfire outlook headed "United States" was read as an
         incident and could be reported as kilometres from a saved home. */
      forecastScope: e.country ? 'country' : (e.region ? 'regional' : 'event'),
      forecast: true, forecastKind: 'signal-derived-outlook', forecastOf: e.id,
      confidence: e.alert === 'Red' ? 'Elevated — driven by a red-level official signal'
        : e.alert === 'Orange' ? 'Moderate — driven by an orange-level official signal'
          : 'Watch — driven by an active but lower-level official signal',
      evidence: 'Active ' + e.source + ' record “' + e.title + '” (' + (e.alert || 'active') + ') last updated ' + e.updated + '.',
      sourceUrl: e.sourceUrl || '',
      verificationRule: 'Grade only against independently observed impacts during the stated window; the pre-existing source alert itself does not count as a successful prediction.'
    });
  }

  // (b) Aftershock-sequence outlooks. Aftershock probability is a recognised
  //     forecast product; the mainshock itself is never presented as predicted.
  const strongQuakes = officialSignals
    .filter(e => /earthquake/i.test(e.type) && num(e.magnitude) !== null && num(e.magnitude) >= 5.5)
    .sort((a, b) => (num(b.magnitude) || 0) - (num(a.magnitude) || 0));
  const seenQuakeArea = new Set();

  for (const e of strongQuakes) {
    if (outlooks.length >= MAX_OUTLOOKS + 8) break;
    const shockMs = Date.parse(e.startedAt || e.updated) || now.getTime();
    const shockEndMs = shockMs + AFTERSHOCK_HORIZON_HOURS * 3600e3;
    if (shockEndMs <= now.getTime()) continue;
    const area = (Math.round(e.lat) + ',' + Math.round(e.lon));
    if (seenQuakeArea.has(area)) continue;
    seenQuakeArea.add(area);
    outlooks.push({
      id: outlookId('aftershock-' + e.id),
      source: 'Predict Natural Disasters · derived from ' + e.source,
      sourceType: 'forecast', type: 'Earthquake aftershock sequence',
      title: 'Aftershock-sequence outlook — ' + (e.region || e.country || e.title),
      country: e.country || '', region: e.region || e.title || '',
      alert: num(e.magnitude) >= 6.5 ? 'High' : 'Moderate',
      lat: e.lat, lon: e.lon,
      updated: new Date(shockMs).toISOString(), issuedAt: new Date(shockMs).toISOString(),
      targetStart: new Date(shockMs).toISOString(),
      targetEnd: new Date(shockEndMs).toISOString(),
      details: 'Experimental 7-day aftershock-sequence outlook following an observed M' + num(e.magnitude) +
        ' earthquake. Aftershocks decay over days to weeks and the largest is typically about one magnitude below the mainshock, ' +
        'so further felt shaking and additional damage to already-weakened structures should be expected. ' +
        'This describes the ongoing sequence — it is not a prediction of a new independent earthquake.',
      /* The magnitude of the mainshock this sequence follows, kept under its own
         name: the outlook itself has no magnitude, and calling it one would
         read as a forecast of a quake that size. The narrative already states
         it, so leaving the field off made the page contradict its own text. */
      ...(num(e.magnitude) !== null ? { mainshockMagnitude: num(e.magnitude) } : {}),
      /* Aftershocks occur around the mainshock, so this one really is as
         localised as the epicentre it is derived from. */
      forecastScope: 'event',
      forecast: true, forecastKind: 'aftershock-sequence', forecastOf: e.id,
      confidence: 'Sequence-based — derived from observed mainshock magnitude and standard aftershock decay behaviour',
      evidence: 'Observed ' + e.source + ' event “' + e.title + '” at ' + e.updated + '.',
      sourceUrl: e.sourceUrl || '',
      verificationRule: 'Grade against observed aftershock activity and any additional impacts in the window. No claim is made about predicting the mainshock.'
    });
  }

  outlooks.forEach(push);
  out.meta.outlooks = outlooks.length;
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

  /* Merging can raise a record's alert — a leader that inherits a graver
     assessment from a discarded member — and the feed was sorted before that
     happened, so a newly Red record kept the position it held while Green. */
  out.events = mergeSeismicReports(out.events).sort(byAlertThenTime);
  out.meta.mergedSeismicReports =
    out.events.filter(e => e.corroboratedBy && e.corroboratedBy.length).length;

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
  if (Array.isArray(OUTLOOK_LEDGER)) {
    for (const row of OUTLOOK_LEDGER) {
      const k = String(row.id) + '@' + String(row.targetStart);
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
    const k = String(e.id) + '@' + String(e.targetStart);
    const proofs = [];
    if (ledgerFreeze.has(k)) {
      proofs.push({ at: ledgerFreeze.get(k), basis: 'Earliest row in the append-only outlook ledger in the repository.' });
    }
    if (e.issuedAtBasis && e.issuedAt) {
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
      e.freezeBasis = 'Nothing in the repository records this forecast yet, so it is not established before the moment this response computed it.';
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
      hazards: ['Earthquake', 'Tropical Cyclone', 'Flood', 'Drought', 'Wildfire', 'Volcano'],
      geographicCoverage: 'Global',
      coverageResolution: 'Only events GDACS itself raises to an alert level. Flood, drought and wildfire records describe alert areas, not incident points.',
      endpoint: 'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP',
      scope: { kind: 'global' },
      completeness: 'selective',
      completenessBasis: 'GDACS lists only events it raises to an alert level, so a disaster it does not carry may simply be below that threshold.'
    },
    usgs: {
      label: 'USGS Earthquake Hazards Program',
      hazards: ['Earthquake'],
      geographicCoverage: 'Global',
      coverageResolution: 'Every earthquake of magnitude 2.5 or above in the past seven days, at its epicentre. Anything smaller, or older, is outside this feed.',
      endpoint: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
      scope: { kind: 'global' },
      completeness: 'exhaustive',
      completenessBasis: 'A complete catalogue of earthquakes of magnitude 2.5 and above for the past seven days, so an absence above that threshold is meaningful.'
    },
    emsc: {
      label: 'EMSC (European-Mediterranean Seismological Centre)',
      hazards: ['Earthquake'],
      geographicCoverage: 'Global, with the densest network in Europe and the Mediterranean',
      coverageResolution: 'Earthquakes of magnitude 4.5 or above, at epicentre.',
      endpoint: 'https://www.emsc-csem.org/',
      scope: { kind: 'global' },
      completeness: 'exhaustive',
      completenessBasis: 'A complete catalogue above magnitude 4.5.'
    },
    eonet: {
      label: 'NASA EONET',
      hazards: ['Wildfire', 'Volcano', 'Severe Storm', 'Ice', 'Landslide'],
      geographicCoverage: 'Global',
      coverageResolution: 'A curated set of events drawn from Earth-observation sources. EONET does not claim to list every event, so absence here is not evidence of absence.',
      endpoint: 'https://eonet.gsfc.nasa.gov/api/v3/events',
      scope: { kind: 'global' },
      completeness: 'selective',
      completenessBasis: 'A curated set; EONET does not claim to list every event, so its silence is not evidence.'
    },
    nhc: {
      label: 'NOAA National Hurricane Center',
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
      completenessBasis: 'Every active tropical cyclone in the basins it publishes for.'
    },
    nws: {
      label: 'NOAA / National Weather Service',
      hazards: ['Flood', 'Severe Weather', 'Extreme Heat', 'Winter Storm', 'Tornado'],
      geographicCoverage: 'United States and its territories only',
      coverageResolution: 'Alerts at severe or extreme severity, carrying the affected-area polygon where the agency published one and a forecast-zone centre where it did not.',
      endpoint: 'https://api.weather.gov/alerts/active',
      scope: { kind: 'countries', countries: ['United States'] },
      completeness: 'selective',
      completenessBasis: 'Exhaustive for active warnings, but a warning is not an observation: these records never enter the observed-disaster ledger, so this provider cannot establish that no disaster occurred.'
    },
    reliefweb: {
      label: 'ReliefWeb (UN OCHA)',
      hazards: ['Flood', 'Drought', 'Earthquake', 'Tropical Cyclone', 'Complex Emergency'],
      geographicCoverage: 'Global',
      coverageResolution: 'Country-level humanitarian disaster declarations. These carry no incident coordinates and are placed at a country centroid.',
      endpoint: 'https://reliefweb.int/disasters/feed',
      scope: { kind: 'global' },
      completeness: 'selective',
      completenessBasis: 'Only disasters ReliefWeb has declared, which is a subset of those that occur.'
    },
    usgs_volcano: {
      label: 'USGS Volcano Hazards Program',
      hazards: ['Volcano'],
      geographicCoverage: 'Volcanoes monitored by the United States volcano observatories',
      coverageResolution: 'Volcanoes currently at an elevated alert level. Volcanoes outside the US observatory network are not covered by this provider.',
      endpoint: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
      scope: { kind: 'countries', countries: ['United States'] },
      completeness: 'exhaustive',
      completenessBasis: 'Every volcano at an elevated alert level in the observatory network it covers.'
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
        geographicCoverage: PROVIDERS[key].geographicCoverage,
        coverageResolution: PROVIDERS[key].coverageResolution,
        scope: PROVIDERS[key].scope,
        completeness: PROVIDERS[key].completeness,
        completenessBasis: PROVIDERS[key].completenessBasis,
        endpoint: PROVIDERS[key].endpoint,
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
        'is recomputed from the upstream sources on every request.' });
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
