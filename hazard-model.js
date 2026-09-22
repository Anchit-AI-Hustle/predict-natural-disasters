'use strict';
/**
 * What each hazard is, how fast it moves, and how bad it is.
 *
 * Three things were being decided by a single constant before this file
 * existed. Every outlook ran 72 hours, so a drought that had already persisted
 * for 298 days was published with a three-day window. Severity was
 * whatever colour the alert field happened to carry, so a magnitude-5 tremor
 * with no casualties and a flood that displaced five thousand people sat at
 * the same level. And nothing recorded how far ahead of its window a forecast
 * was actually issued, which is the only number that says whether a forecast
 * was useful.
 *
 * Loaded as a plain script in the browser (window.PNDHazards) and required by
 * the API and the tests.
 */
(function (root) {
  var H = 3600e3;

  /**
   * onset      how the hazard arrives, which is what decides whether it can be
   *            anticipated at all: 'sudden' cannot be forecast, 'rapid' can be
   *            forecast hours to days ahead, 'slow' develops over weeks.
   * horizonH   the window an outlook for this hazard should cover. Set from how
   *            long the hazard itself runs and how far official practice
   *            forecasts it, not from one number applied to everything.
   * forecastable  whether the onset of this hazard can be predicted before it
   *            starts. Where false, anything we publish describes an event
   *            already under way and must say so.
   */
  var HAZARDS = {
    Earthquake: {
      name: 'Earthquake',
      definition: 'Ground shaking from a sudden release of stress on a fault. Measured by magnitude; damage depends on depth, local geology and building stock, not magnitude alone.',
      onset: 'sudden',
      forecastable: false,
      horizonH: 0,
      duration: 'Seconds to minutes of shaking; the aftershock sequence runs days to months.',
      severityBasis: 'USGS PAGER impact alert, which estimates expected fatalities and economic loss. Magnitude on its own is not a severity.',
      leadTime: 'None. No agency forecasts the onset of an individual earthquake, and neither do we.'
    },
    'Earthquake aftershock sequence': {
      name: 'Aftershock sequence',
      definition: 'The decaying series of smaller earthquakes that follows a mainshock in the same rupture area. The largest aftershock is typically about one magnitude below the mainshock.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 168,
      duration: 'Days to months, decaying roughly with the reciprocal of elapsed time.',
      severityBasis: 'Mainshock magnitude and the state of already-damaged structures in the affected area.',
      leadTime: 'Hours to days. The sequence is forecastable once the mainshock has happened; the mainshock is not.'
    },
    'Tropical Cyclone': {
      name: 'Tropical cyclone',
      definition: 'A rotating storm system over warm ocean with organised convection and a closed low-level circulation. Named at tropical-storm strength; hurricane or typhoon strength begins at 64 knots of sustained wind.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 120,
      duration: 'Days at sea; landfall impacts run roughly 12 to 72 hours at a given place.',
      severityBasis: 'Saffir-Simpson category from sustained wind, plus expected storm surge and rainfall over populated coast.',
      leadTime: 'Three to five days. This is the hazard with the longest genuinely skilful warning, which is why official tracks run to 120 hours.'
    },
    Flood: {
      name: 'Flood',
      definition: 'Water covering ground that is normally dry, from river overflow, intense rainfall, storm surge or dam failure. Flash floods develop within hours; riverine floods build over days.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Hours for flash flooding; days to weeks for large river basins.',
      severityBasis: 'People displaced and affected, depth and extent over inhabited land, and the issuing agency’s own alert level.',
      leadTime: 'Hours to days. Riverine flooding downstream of observed rainfall is the most reliably anticipated case.'
    },
    'Flood / Landslide': {
      name: 'Flood and landslide',
      definition: 'Intense or prolonged rainfall producing both inundation and slope failure in the same area. The two hazards share a driver and usually arrive together in steep terrain.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 96,
      duration: 'Days, with slope failures often continuing after the rain stops.',
      severityBasis: 'Combined displacement and casualties, and whether failures reach settlements or transport routes.',
      leadTime: 'One to four days, driven by quantitative rainfall forecasts and antecedent soil saturation.'
    },
    Landslide: {
      name: 'Landslide',
      definition: 'Downslope movement of rock, soil or debris, usually triggered by rainfall, earthquake shaking or undercutting. Includes debris flows and rockfalls.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Minutes for a single failure; the period of elevated susceptibility lasts days after saturation.',
      severityBasis: 'Whether the runout reaches settlements or routes, and observed casualties.',
      leadTime: 'Hours to days, and only as susceptibility over an area — never a specific slope at a specific time.'
    },
    Wildfire: {
      name: 'Wildfire',
      definition: 'Uncontrolled fire in vegetation. Behaviour is driven by fuel dryness, wind and terrain; most large-fire growth happens on a small number of extreme fire-weather days.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Days to months for a large incident; most detections stay open until containment is reported.',
      severityBasis: 'Area burned, proximity to settlements, evacuation orders and smoke exposure downwind.',
      leadTime: 'One to three days for fire-weather conditions. Ignition timing and location are not forecastable.'
    },
    Drought: {
      name: 'Drought',
      definition: 'A prolonged deficit of water relative to normal for a place and season. Meteorological drought is a rainfall deficit; agricultural and hydrological drought follow later as soil moisture and storage fall.',
      onset: 'slow',
      forecastable: true,
      horizonH: 720,
      duration: 'Months to years. Drought does not have a three-day window and must never be published with one.',
      severityBasis: 'Extent and duration of the deficit, and the population dependent on rain-fed agriculture or affected water supply.',
      leadTime: 'Weeks to seasons. Drought is the hazard where long-range outlooks genuinely add warning, because it develops slowly.'
    },
    Volcano: {
      name: 'Volcanic activity',
      definition: 'Eruptive activity or unrest at a volcano: ash emission, lava, pyroclastic density currents, lahars or gas. Aviation and ground alerts are issued on separate colour-coded scales.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 168,
      duration: 'Days to years. Unrest episodes commonly persist for weeks.',
      severityBasis: 'The observatory’s own alert level, exclusion-zone population, and ash dispersal over air routes and settlements.',
      leadTime: 'Days to weeks of unrest usually precede an eruption, though the eruption onset itself stays uncertain.'
    },
    'Extreme Heat': {
      name: 'Extreme heat',
      definition: 'A period of temperature and humidity high enough to threaten health, defined against local norms rather than a single global threshold. Overnight minima matter as much as daytime peaks.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 120,
      duration: 'Days to a few weeks.',
      severityBasis: 'Duration, night-time minima, and the size of the exposed population without cooling.',
      leadTime: 'Three to seven days, among the most skilful warnings available for any hazard.'
    },
    'Extreme Cold': {
      name: 'Extreme cold',
      definition: 'A period of temperature, wind chill or frost severe enough to threaten health, livestock or crops, defined against local norms.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 120,
      duration: 'Hours to days.',
      severityBasis: 'Wind chill, duration, and exposure of people without heating or of vulnerable crops.',
      leadTime: 'Three to seven days.'
    },
    'Severe Storm': {
      name: 'Severe storm',
      definition: 'Convective weather producing damaging wind, large hail or torrential rain. Distinct from a tropical cyclone: shorter-lived, smaller and driven by local instability.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 48,
      duration: 'Hours at any one place; a squall line or outbreak can affect a region for most of a day.',
      severityBasis: 'Wind gust, hail size, rainfall rate and the population under the storm track.',
      leadTime: 'Hours to two days. Skill falls away quickly beyond the first day.'
    },
    Tornado: {
      name: 'Tornado',
      definition: 'A violently rotating column of air in contact with both a convective cloud and the ground. Rated after the fact on the Enhanced Fujita scale from observed damage.',
      onset: 'sudden',
      forecastable: true,
      horizonH: 24,
      duration: 'Minutes for an individual tornado; an outbreak lasts hours.',
      severityBasis: 'Observed damage rating and whether the track crosses built-up areas.',
      leadTime: 'Minutes for a specific tornado warning; up to a day for the area at risk. Never a specific place and time in advance.'
    },
    Tsunami: {
      name: 'Tsunami',
      definition: 'Long-wavelength ocean waves generated by seafloor displacement, usually from an earthquake. Travels at jet speed across open ocean and builds height in shallow water.',
      onset: 'sudden',
      forecastable: true,
      horizonH: 24,
      duration: 'Hours of wave trains; the first wave is often not the largest.',
      severityBasis: 'Expected run-up height against coastal population and evacuation time available.',
      leadTime: 'Minutes to hours, set by travel time from the source — not by any predictive model.'
    }
  };

  var DEFAULT = {
    name: 'Natural hazard',
    definition: 'A natural process with the potential to cause loss of life, injury or damage.',
    onset: 'rapid',
    forecastable: true,
    horizonH: 72,
    duration: 'Varies by hazard.',
    severityBasis: 'The issuing agency’s alert level and any observed human impact.',
    leadTime: 'Varies by hazard.'
  };

  /** Resolve a feed `type` string to its hazard entry. */
  function hazardOf(type) {
    var t = String(type || '');
    if (HAZARDS[t]) return HAZARDS[t];
    var k = t.toLowerCase();
    // Ordered so a compound type lands on the entry that describes it best.
    if (/aftershock/.test(k)) return HAZARDS['Earthquake aftershock sequence'];
    if (/earthquake|seismic/.test(k)) return HAZARDS.Earthquake;
    if (/cyclone|hurricane|typhoon/.test(k)) return HAZARDS['Tropical Cyclone'];
    if (/tsunami/.test(k)) return HAZARDS.Tsunami;
    if (/tornado/.test(k)) return HAZARDS.Tornado;
    if (/flood/.test(k) && /landslide|mudslide/.test(k)) return HAZARDS['Flood / Landslide'];
    if (/flood/.test(k)) return HAZARDS.Flood;
    if (/landslide|mudslide/.test(k)) return HAZARDS.Landslide;
    if (/wildfire|bushfire|forest fire/.test(k)) return HAZARDS.Wildfire;
    if (/drought/.test(k)) return HAZARDS.Drought;
    if (/volcan/.test(k)) return HAZARDS.Volcano;
    if (/heat/.test(k)) return HAZARDS['Extreme Heat'];
    if (/cold|freeze|frost|winter/.test(k)) return HAZARDS['Extreme Cold'];
    if (/storm|thunder|hail|wind/.test(k)) return HAZARDS['Severe Storm'];
    return DEFAULT;
  }

  /** Outlook window for this hazard, in hours. */
  function horizonHours(type) { return hazardOf(type).horizonH || DEFAULT.horizonH; }

  /* --------------------------------------------------------------- severity */

  /**
   * One scale across every hazard, so a drought and an earthquake can be
   * compared. Ranked so the UI can lead with what matters and keep the
   * routine detections out of the way.
   */
  var SEVERITY = [
    { key: 'Informational', rank: 1, meaning: 'A detection or observation with no impact assessment attached. Most of the feed by volume.' },
    { key: 'Minor', rank: 2, meaning: 'Impact expected to stay limited and local.' },
    { key: 'Moderate', rank: 3, meaning: 'Localised damage, disruption or displacement; casualties possible.' },
    { key: 'Severe', rank: 4, meaning: 'Significant casualties, damage or displacement across a region.' },
    { key: 'Extreme', rank: 5, meaning: 'Mass casualties or national-scale impact expected or already observed.' }
  ];
  var RANK = {};
  SEVERITY.forEach(function (s) { RANK[s.key] = s.rank; });
  var BY_RANK = {};
  SEVERITY.forEach(function (s) { BY_RANK[s.rank] = s.key; });

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /**
   * Severity from observed human impact. Facts reported by the responding
   * agency, not an assessment of ours.
   */
  function impactRank(e) {
    var d = num(e.deaths), a = num(e.affected), disp = num(e.displaced);
    if (d >= 100 || a >= 1000000 || disp >= 100000) return 5;
    if (d >= 10 || a >= 100000 || disp >= 10000) return 4;
    if (d >= 1 || a >= 10000 || disp >= 1000) return 3;
    if (a > 0 || disp > 0) return 2;
    return 0;
  }

  /** Severity from the level the issuing authority actually published. */
  function alertRank(e) {
    /* Every assessment on the record is weighed and the gravest wins. Returning
       on the first one that matched meant a record could be made *less* severe
       by adding a milder assessment to it: a merged earthquake published Red by
       one agency and assessed yellow by USGS rated Moderate, where the Red
       alone rated Severe. Adding information must never lower a rating. */
    var pager = String(e.pagerAlert || '').toLowerCase();
    var assessed = pager === 'red' ? 5 : pager === 'orange' ? 4 : pager === 'yellow' ? 3 : 0;

    var mag = Number(e.magnitude);
    var kt = Number(e.windKt);
    var wind = 0;
    if (isFinite(kt) && kt > 0) {
      wind = kt >= 113 ? 5      // Saffir-Simpson category 4-5
        : kt >= 96 ? 4          // category 3
          : kt >= 64 ? 3        // category 1-2
            : 2;                // tropical storm or depression
    }

    var issued = 0;
    switch (String(e.alert || '')) {
      case 'Red': issued = 4; break;
      case 'Orange': issued = 3; break;
      case 'High': issued = 4; break;
      case 'Moderate': issued = 3; break;
      case 'Watch': issued = 2; break;
      default: break;
    }

    /* A cyclone's wind reading alone discarded the authority's own assessment.
       A weakening or slow-moving cyclone can carry a Red alert at well under 64
       knots because of surge, rainfall or where it is heading, and that read as
       Minor. GDACS cyclones only started carrying a wind speed in this branch,
       so that was newly reachable rather than long-standing. */
    if (assessed || wind || issued) return Math.max(assessed, wind, issued);
    // An earthquake with no PAGER assessment is a measurement, not a severity.
    if (isFinite(mag) && mag > 0) return 1;
    return 0;
  }

  /**
   * The severity to publish: the worse of what was observed and what the
   * issuing authority assessed. Never below Informational.
   */
  function severityOf(e) {
    var r = Math.max(impactRank(e || {}), alertRank(e || {}), 1);
    return BY_RANK[r];
  }
  function severityRank(e) { return RANK[severityOf(e)]; }

  /* -------------------------------------------------------------- lead time */

  /**
   * Hours between issuing a forecast and the start of the window it covers.
   * A continuation outlook derived from an already-active signal has a lead
   * time of zero: it describes something happening now. Saying so is the
   * difference between a forecast and a restatement.
   */
  function leadTimeHours(e) {
    if (!e || !e.forecast) return null;
    var issued = Date.parse(e.issuedAt || e.updated || '');
    var start = Date.parse(e.targetStart || '');
    if (!isFinite(issued) || !isFinite(start)) return null;
    return Math.round((start - issued) / H * 10) / 10;
  }

  function leadTimeText(e) {
    var h = leadTimeHours(e);
    if (h === null) return '';
    // Issued after the window opened is a different claim from issued as it
    // opened, and the benchmark turned out to be the former.
    if (h < 0) return 'Issued ' + Math.abs(Math.round(h)) + ' hours after the window opened, so it did not anticipate the onset.';
    if (h === 0) return 'No lead time — this window opened as the outlook was issued, so it describes conditions under way rather than anticipating them.';
    if (h < 48) return 'Issued ' + Math.round(h) + ' hours before the window opens.';
    return 'Issued ' + Math.round(h / 24) + ' days before the window opens.';
  }


  /**
   * The facts that matter for each hazard, in the order a reader wants them.
   * Each names a field on the record; a field the connected sources do not
   * publish still appears, marked not reported, because a silent omission reads
   * as a zero.
   */
  var METRICS = {
    Earthquake: ['magnitude', 'depthKm', 'pagerAlert', 'deaths', 'missing', 'affected', 'tsunamiFlag'],
    'Earthquake aftershock sequence': ['mainshockMagnitude', 'deaths', 'missing', 'affected'],
    'Tropical Cyclone': ['windKt', 'category', 'deaths', 'missing', 'displaced', 'affected'],
    Flood: ['deaths', 'missing', 'displaced', 'affected'],
    'Flood / Landslide': ['deaths', 'missing', 'displaced', 'affected'],
    Landslide: ['deaths', 'missing', 'displaced'],
    Wildfire: ['areaHa', 'deaths', 'missing', 'displaced', 'affected'],
    Drought: ['affected', 'displaced'],
    Volcano: ['alertLevel', 'aviationColour', 'deaths', 'displaced', 'affected'],
    'Extreme Heat': ['deaths', 'affected'],
    'Extreme Cold': ['deaths', 'affected'],
    'Severe Storm': ['deaths', 'missing', 'affected'],
    Tornado: ['deaths', 'missing', 'affected'],
    Tsunami: ['deaths', 'missing', 'displaced', 'affected']
  };

  var LABELS = {
    magnitude: 'Magnitude', mainshockMagnitude: 'Mainshock magnitude',
    depthKm: 'Depth', pagerAlert: 'USGS impact alert',
    tsunamiFlag: 'Tsunami flag', windKt: 'Maximum sustained wind', category: 'Category',
    areaHa: 'Area burned', alertLevel: 'Observatory alert level',
    aviationColour: 'Aviation colour code',
    deaths: 'Lives lost', missing: 'Missing or unaccounted for',
    displaced: 'People displaced', affected: 'People affected'
  };

  function group(n) {
    var x = Math.round(Number(n));
    return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Saffir-Simpson category from sustained wind in knots. */
  function cycloneCategory(kt) {
    var k = Number(kt);
    if (!isFinite(k) || k <= 0) return null;
    if (k >= 137) return 'Category 5';
    if (k >= 113) return 'Category 4';
    if (k >= 96) return 'Category 3';
    if (k >= 83) return 'Category 2';
    if (k >= 64) return 'Category 1';
    if (k >= 34) return 'Tropical storm';
    return 'Tropical depression';
  }

  /** Render one metric. Returns null only when the metric does not apply at all. */
  function factOf(e, key) {
    var label = LABELS[key] || key;
    var v = e[key];
    var has = v !== undefined && v !== null && v !== '';
    switch (key) {
      case 'mainshockMagnitude':
      case 'magnitude':
        // The label already says Magnitude, and the glossary expands a bare
        // "M 6.5" into "Magnitude 6.5", which would read twice over.
        return { key: key, label: label, reported: has,
          value: has ? Number(v).toFixed(1) : null };
      case 'depthKm':
        return { key: key, label: label, reported: has,
          value: has ? Math.round(Number(v)) + ' km' : null };
      case 'pagerAlert':
        return { key: key, label: label, reported: has,
          value: has ? String(v).toLowerCase() : null,
          note: has ? null : 'USGS issued no impact assessment for this earthquake' };
      case 'tsunamiFlag':
        // Only the USGS parser supplies this. On an EMSC or GDACS earthquake
        // the field is simply absent, and printing "Not raised" there would
        // turn an unknown into an authoritative negative.
        return { key: key, label: label, reported: has,
          value: has ? (v ? 'Raised' : 'Not raised') : null,
          note: has ? null : 'Only the United States Geological Survey publishes a tsunami flag' };
      case 'windKt': {
        // Rounding a converted wind to a whole number can print "64 kt" beside
        // the category "Tropical storm", whose upper bound is 64. A converted
        // value keeps one decimal so the two never disagree; a value the source
        // published as a whole number of knots prints as one.
        var k = Number(v);
        var kt = !has ? null
          : Number.isInteger(k) ? String(k) : String(Math.round(k * 10) / 10);
        return { key: key, label: label, reported: has,
          value: has ? kt + ' kt' : null };
      }
      case 'category': {
        var c = cycloneCategory(e.windKt);
        return { key: key, label: label, reported: !!c, value: c };
      }
      case 'areaHa': {
        var ha = Number(e.areaHa);
        var ok = isFinite(ha) && ha > 0;
        // group() rounds to a whole number, so dividing first turned 150 ha
        // into "2 km²" — a third more ground than burned. Below 100 km² the
        // fraction is kept; above it, rounding is under one percent.
        var km = ha / 100;
        var area = ha < 100 ? group(ha) + ' ha'
          : km < 100 ? String(Math.round(km * 10) / 10) + ' km²'
            : group(km) + ' km²';
        return { key: key, label: label, reported: ok, value: ok ? area : null };
      }
      case 'aviationColour':
        return { key: key, label: label, reported: has, value: has ? String(v) : null,
          note: has ? null : 'This source publishes no aviation colour code for this volcano' };
      case 'alertLevel':
        // e.alert is the colour this site maps a level onto, not the level the
        // observatory issued: every NASA EONET volcano carries 'Green' without
        // any observatory having said so, and USGS WATCH/WARNING would be
        // renamed to Orange/Red under a label claiming to quote the observatory.
        return { key: key, label: label, reported: !!e.alertLevel,
          value: e.alertLevel || null,
          note: e.alertLevel ? null
            : 'This source publishes no observatory alert level for this volcano' };
      default: {
        var n = Number(v);
        var reported = has && isFinite(n);
        return { key: key, label: label, reported: reported, value: reported ? group(n) : null };
      }
    }
  }

  /**
   * Every fact this hazard wants, reported or not. A count no source publishes
   * says so rather than showing a zero that would read as "nobody died".
   */
  function keyFacts(e) {
    var h = hazardOf(e && e.type);
    var keys = METRICS[hazardName(h)] || ['deaths', 'affected'];
    return keys.map(function (k) { return factOf(e || {}, k); }).filter(Boolean);
  }

  /** The METRICS key for a hazard entry. */
  function hazardName(h) {
    for (var k in HAZARDS) if (HAZARDS[k] === h) return k;
    return '';
  }

  /* ------------------------------------------ where a record applies */

  /*
   * Personal Risk asks one question: does this record say anything about a
   * place I saved? There are three ways to answer it and only one of them is
   * a distance.
   *
   * A warning published with a polygon answers by containment. The place is
   * inside the warned area or it is not, and the kilometres between the place
   * and the polygon's middle are a fact about the polygon's shape, not about
   * the hazard. A record placed at an incident - an epicentre, a storm centre,
   * a volcano - answers by distance, because there the coordinate IS the
   * hazard. A record placed at a country or basin centroid answers neither: it
   * says a hazard is active in an area containing the place, which is worth
   * showing and is not worth a number.
   *
   * These functions keep the three apart and never invent the answer a record
   * does not carry. Where applicability cannot be established, the row says
   * so instead of falling back to distance.
   */

  var RISK_RADIUS_KM = 500;

  /** A ring that wraps the antimeridian cannot be ray-cast in raw longitude. */
  function ringWraps(ring) {
    for (var i = 1; i < ring.length; i++) {
      if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
    }
    return false;
  }

  /* Ray casting against one ring in raw lon/lat. The areas this runs on are
     warning polygons a few degrees across, where treating degrees as a plane
     is wrong by far less than the polygon's own resolution. */
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (!isFinite(xi) || !isFinite(yi) || !isFinite(xj) || !isFinite(yj)) return false;
      if (((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function okRing(r) { return Array.isArray(r) && r.length > 2 && Array.isArray(r[0]); }

  /* A polygon is its outer ring minus its holes. */
  function inPolygon(lon, lat, rings) {
    if (!Array.isArray(rings) || !okRing(rings[0])) return null;
    for (var r = 0; r < rings.length; r++) {
      if (!okRing(rings[r])) return null;
      if (ringWraps(rings[r])) return null;
    }
    if (!inRing(lon, lat, rings[0])) return false;
    for (var h = 1; h < rings.length; h++) if (inRing(lon, lat, rings[h])) return false;
    return true;
  }

  /**
   * Does a GeoJSON geometry contain the point?
   * true / false when it can be decided, null when the geometry is absent,
   * unsupported or wraps the antimeridian. Null is never read as "outside".
   */
  function geometryContains(g, lat, lon) {
    if (!g || !isFinite(lat) || !isFinite(lon)) return null;
    if (g.type === 'Polygon') return inPolygon(lon, lat, g.coordinates);
    if (g.type === 'MultiPolygon') {
      if (!Array.isArray(g.coordinates)) return null;
      var decided = false;
      for (var i = 0; i < g.coordinates.length; i++) {
        var r = inPolygon(lon, lat, g.coordinates[i]);
        if (r === true) return true;
        if (r === false) decided = true;
      }
      return decided ? false : null;
    }
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      var any = null;
      for (var k = 0; k < g.geometries.length; k++) {
        var c = geometryContains(g.geometries[k], lat, lon);
        if (c === true) return true;
        if (c === false) any = false;
      }
      return any;
    }
    return null;
  }

  /** Great-circle kilometres between two points. */
  function distanceKm(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, R = 6371;
    var x = (bLat - aLat) * r, y = (bLon - aLon) * r;
    var z = Math.sin(x / 2) * Math.sin(x / 2) +
            Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(z));
  }

  /**
   * The evidence bands, strongest claim first. Each one states what it is
   * allowed to assert, because that is what decides which records may enter
   * it — not how alarming they look.
   */
  var RISK_BANDS = [
    { key: 'A', title: 'Confirmed nearby incidents',
      blurb: 'Reported by an authority at an incident location, within 500 km of a place you saved.',
      empty: 'No incident-located hazard within 500 km of a saved place.' },
    { key: 'B', title: 'Official warnings affecting this location',
      blurb: 'Warnings in force. Where the issuing agency published an affected area, your place was tested against that area rather than against a distance.',
      empty: 'No official warning currently reaches a saved place.' },
    { key: 'C', title: 'Forecast outlooks',
      blurb: 'Windows this project is watching. Nothing here is a report that an event has occurred, and nothing here is an official warning.',
      empty: 'No outlook currently covers a saved place.' },
    { key: 'D', title: 'Broader regional signals',
      blurb: 'Records whose coordinate marks an area rather than an incident. Listed because that area\u2019s centre point is within range \u2014 not because this place has been shown to fall inside it.',
      empty: 'No area-level record currently sits within range of a saved place.' },
    /* Kept in the list and kept empty. The band is a real part of the answer
       to "how exposed is this place", and this project publishes no
       per-location history to fill it with - so it says that, rather than
       being quietly dropped or filled with something that looks like one. */
    { key: 'E', title: 'Historical susceptibility',
      blurb: 'What a place has experienced before.',
      dataAvailable: false,
      empty: 'No per-location event history is published by this project, so nothing can be shown here. Your national or regional hazard agency holds the authoritative record for a location\u2019s past events.' }
  ];

  var APPLICABILITY = {
    insideIncident: 'Your saved place is inside the reported affected area.',
    insideWarning: 'Your saved place is inside the published warning area.',
    outsideWarning: 'Your saved place is outside the published warning area.',
    undetermined: 'Regional warning — exact applicability to this location has not been established.',
    forecast: 'A window being watched, not a report that anything has happened.',
    outsideForecast: 'Your saved place is outside the published outlook area.',
    areaLevel: 'Area-level record: its coordinate marks an area centre, not an incident. Whether this place falls inside the affected area has not been established.'
  };

  /**
   * Which band a feed record falls in for one saved place, or null when the
   * record says nothing about it.
   *
   * distanceKm is always computed where both points exist, but claimDistance
   * says whether it may be shown to the reader as a distance to the hazard.
   */
  function riskRow(e, place, radiusKm) {
    e = e || {}; place = place || {};
    var R = isFinite(radiusKm) ? Number(radiusKm) : RISK_RADIUS_KM;
    var pLat = Number(place.lat), pLon = Number(place.lon);
    var eLat = Number(e.lat), eLon = Number(e.lon);
    if (!isFinite(pLat) || !isFinite(pLon)) return null;

    var contains = geometryContains(e.geometry, pLat, pLon);
    var d = (isFinite(eLat) && isFinite(eLon)) ? distanceKm(pLat, pLon, eLat, eLon) : null;
    var near = d !== null && d <= R;
    var out = function (band, note, claim) {
      return {
        band: band, distanceKm: d, claimDistance: !!claim,
        containment: contains, applicability: note,
        reason: e.proximityReason || ''
      };
    };

    if (e.isForecast || e.forecast) {
      if (contains === true) return out('C', APPLICABILITY.forecast, false);
      if (contains === false) return near ? out('D', APPLICABILITY.outsideForecast, false) : null;
      return near ? out('C', APPLICABILITY.forecast, !!e.proximityEligible) : null;
    }

    if (e.evidenceState === 'official-warning') {
      if (contains === true) return out('B', APPLICABILITY.insideWarning, false);
      if (contains === false) return near ? out('D', APPLICABILITY.outsideWarning, false) : null;
      return near ? out('B', APPLICABILITY.undetermined, false) : null;
    }

    if (contains === true) return out('A', APPLICABILITY.insideIncident, false);
    if (e.proximityEligible && near) return out('A', '', true);
    if (contains === false) return near ? out('D', APPLICABILITY.outsideWarning, false) : null;
    return near ? out('D', APPLICABILITY.areaLevel, false) : null;
  }
  /* ------------------------------------------- what kind of forecast it is */

  /*
   * Not every forecast is a prediction.
   *
   * This project publishes outlooks derived from hazards that are already
   * happening, aftershock outlooks that follow an observed mainshock, and one
   * frozen benchmark written after its own window had opened. Grading all of
   * them together and calling the result an accuracy figure credits the system
   * for describing the present.
   *
   * So each forecast is placed in one of six classes, and only one of them -
   * independent-prospective - may reach a headline prediction figure. The
   * others are real forecasts and are graded, under their own labels.
   */
  var FORECAST_CLASSES = {
    'independent-prospective': {
      label: 'Independent prospective',
      definition: 'Frozen before the qualifying hazard was observed.',
      headline: true
    },
    'warning-derived': {
      label: 'Warning-derived',
      definition: 'Derived from an official warning that had already been issued.',
      headline: false
    },
    'continuation-outlook': {
      label: 'Continuation outlook',
      definition: 'Written after the hazard existed, forecasting that it continues or escalates.',
      headline: false
    },
    'post-event-conditional': {
      label: 'Post-event conditional',
      definition: 'Conditional on an event already observed, such as an aftershock sequence following a mainshock.',
      headline: false
    },
    'retrospective-benchmark': {
      label: 'Retrospective benchmark',
      definition: 'A benchmark or backtest, not issued prospectively.',
      headline: false
    },
    'invalid-post-event': {
      label: 'Invalid post-event',
      definition: 'Offered as prospective although nothing shows it existed before the window it claims.',
      headline: false
    }
  };

  function ms(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : null; }

  /**
   * The class of one forecast, given the signal it was derived from where
   * there is one. `parent` is the feed record named by forecastOf.
   *
   * Returns an object rather than a bare string, because a classification
   * nobody can check is not much better than no classification: the reason is
   * what a reader or an auditor needs.
   */
  function classifyForecast(f, parent) {
    f = f || {};
    if (!(f.forecast || f.isForecast)) return null;
    var say = function (k, why) { return { forecastClass: k, classificationReason: why }; };

    if (f.forecastKind === 'frozen-benchmark') {
      return say('retrospective-benchmark',
        'Recorded as a frozen benchmark rather than as a forecast issued ahead of its window.');
    }
    if (f.forecastKind === 'aftershock-sequence') {
      return say('post-event-conditional',
        'Conditional on an earthquake that had already been observed when this was written.');
    }
    if (f.forecastOf) {
      if (parent && parent.evidenceState === 'official-warning') {
        return say('warning-derived',
          'Derived from an official warning that the issuing agency had already published.');
      }
      return say('continuation-outlook',
        'Derived from a hazard already present in the feed, forecasting that it continues.');
    }

    /* Nothing declares where this came from, so it stands as its own claim and
       has to be able to show it existed first. */
    var freeze = ms(f.freezeTimestamp), start = ms(f.targetStart);
    /* A freeze that nothing outside the running process can check is not a
       freeze. Being unable to prove a forecast came first is the whole reason
       this class exists, so an unevidenced one is never counted as one that
       did. */
    if (freeze === null || f.freezeEvidenced === false) {
      return say('invalid-post-event',
        'No immutable record establishes that this forecast existed before the window it claims, so it cannot be counted as a prediction.');
    }
    if (start === null) {
      return say('invalid-post-event',
        'The forecast names no window, so nothing can establish that it preceded one.');
    }
    if (freeze > start) {
      return say('invalid-post-event',
        'The earliest record of this forecast is later than the start of the window it claims.');
    }
    return say('independent-prospective',
      'Frozen at ' + f.freezeTimestamp + ', before the window opening at ' + f.targetStart + '.');
  }

  /**
   * The earliest moment an observation may be used to verify a forecast.
   *
   * An upstream issuedAt is what a provider says about itself; it is not proof
   * this application held the forecast then. The defensible timestamp is the
   * earliest immutable record of it - the append-only ledger in the repository
   * - and a window cannot be credited from before the forecast is known to
   * have existed.
   */
  function effectiveForecastStart(f) {
    f = f || {};
    var start = ms(f.targetStart), freeze = ms(f.freezeTimestamp);
    if (start === null && freeze === null) return null;
    if (start === null) return f.freezeTimestamp;
    if (freeze === null) return f.targetStart;
    return freeze > start ? f.freezeTimestamp : f.targetStart;
  }

  /** May an observation at this time be used to verify this forecast? */
  function observationCanVerify(f, observedAt) {
    var from = ms(effectiveForecastStart(f)), end = ms((f || {}).targetEnd), at = ms(observedAt);
    if (at === null || from === null) return false;
    if (at < from) return false;
    return end === null ? true : at <= end;
  }

  /** How much of a claimed window the application can actually be credited for. */
  function creditedWindowHours(f) {
    var from = ms(effectiveForecastStart(f)), end = ms((f || {}).targetEnd);
    if (from === null || end === null) return null;
    return Math.max(0, (end - from) / H);
  }
  var api = {
    HAZARDS: HAZARDS, DEFAULT: DEFAULT, SEVERITY: SEVERITY,
    hazardOf: hazardOf, horizonHours: horizonHours,
    severityOf: severityOf, severityRank: severityRank, severityRanks: RANK,
    impactRank: impactRank, alertRank: alertRank,
    leadTimeHours: leadTimeHours, leadTimeText: leadTimeText,
    keyFacts: keyFacts, cycloneCategory: cycloneCategory, METRICS: METRICS,
    geometryContains: geometryContains, distanceKm: distanceKm,
    riskRow: riskRow, RISK_BANDS: RISK_BANDS, RISK_RADIUS_KM: RISK_RADIUS_KM,
    APPLICABILITY: APPLICABILITY,
    FORECAST_CLASSES: FORECAST_CLASSES, classifyForecast: classifyForecast,
    effectiveForecastStart: effectiveForecastStart,
    observationCanVerify: observationCanVerify,
    creditedWindowHours: creditedWindowHours
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDHazards = api;
})(typeof window !== 'undefined' ? window : null);
