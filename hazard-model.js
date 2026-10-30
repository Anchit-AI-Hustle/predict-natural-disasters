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
      leadTime: 'None. No agency can forecast when a particular earthquake will strike, and neither can we.'
    },
    'Earthquake aftershock sequence': {
      name: 'Aftershock sequence',
      definition: 'The decaying series of smaller earthquakes that follows a mainshock in the same rupture area. The largest aftershock is typically about one magnitude below the mainshock.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 168,
      duration: 'Days to months, decaying roughly with the reciprocal of elapsed time.',
      severityBasis: 'Mainshock magnitude and the state of already-damaged structures in the affected area.',
      leadTime: 'Hours to days. Aftershocks can be forecast once the main earthquake has happened; the main earthquake cannot.'
    },
    'Tropical Cyclone': {
      name: 'Tropical cyclone',
      definition: 'A rotating storm system over warm ocean with organised convection and a closed low-level circulation. Named at tropical-storm strength; hurricane or typhoon strength begins at 64 knots of sustained wind.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 120,
      duration: 'Days at sea; landfall impacts run roughly 12 to 72 hours at a given place.',
      severityBasis: 'Saffir-Simpson category from sustained wind, plus expected storm surge and rainfall over populated coast.',
      leadTime: 'Three to five days. Storms can be forecast further ahead than most hazards, which is why official storm tracks cover five days.'
    },
    Flood: {
      name: 'Flood',
      definition: 'Water covering ground that is normally dry, from river overflow, intense rainfall, storm surge or dam failure. Flash floods develop within hours; riverine floods build over days.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Hours for flash flooding; days to weeks for large river basins.',
      severityBasis: 'People displaced and affected, depth and extent over inhabited land, and the issuing agency’s own alert level.',
      leadTime: 'Hours to days. River flooding downstream of heavy rain that has already fallen is the easiest to forecast.'
    },
    'Flood / Landslide': {
      name: 'Flood and landslide',
      definition: 'Intense or prolonged rainfall producing both inundation and slope failure in the same area. The two hazards share a driver and usually arrive together in steep terrain.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 96,
      duration: 'Days, with slope failures often continuing after the rain stops.',
      severityBasis: 'Combined displacement and casualties, and whether failures reach settlements or transport routes.',
      leadTime: 'One to four days, based on rainfall forecasts and how wet the ground already is.'
    },
    Landslide: {
      name: 'Landslide',
      definition: 'Downslope movement of rock, soil or debris, usually triggered by rainfall, earthquake shaking or undercutting. Includes debris flows and rockfalls.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Minutes for a single failure; the period of elevated susceptibility lasts days after saturation.',
      severityBasis: 'Whether the runout reaches settlements or routes, and observed casualties.',
      leadTime: 'Hours to days, and only for an area at risk. Never a particular slope at a particular time.'
    },
    Wildfire: {
      name: 'Wildfire',
      definition: 'Uncontrolled fire in vegetation. Behaviour is driven by fuel dryness, wind and terrain; most large-fire growth happens on a small number of extreme fire-weather days.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 72,
      duration: 'Days to months for a large incident; most detections stay open until containment is reported.',
      severityBasis: 'Area burned, proximity to settlements, evacuation orders and smoke exposure downwind.',
      leadTime: 'One to three days for dangerous fire weather. When and where a fire starts cannot be forecast.'
    },
    Drought: {
      name: 'Drought',
      definition: 'A prolonged deficit of water relative to normal for a place and season. Meteorological drought is a rainfall deficit; agricultural and hydrological drought follow later as soil moisture and storage fall.',
      onset: 'slow',
      forecastable: true,
      horizonH: 720,
      duration: 'Months to years. Drought does not have a three-day window and must never be published with one.',
      severityBasis: 'Extent and duration of the deficit, and the population dependent on rain-fed agriculture or affected water supply.',
      leadTime: 'Weeks to months. Drought builds slowly, so long-range forecasts give real warning.'
    },
    Volcano: {
      name: 'Volcanic activity',
      definition: 'Eruptive activity or unrest at a volcano: ash emission, lava, pyroclastic density currents, lahars or gas. Aviation and ground alerts are issued on separate colour-coded scales.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 168,
      duration: 'Days to years. Unrest episodes commonly persist for weeks.',
      severityBasis: 'The observatory’s own alert level, exclusion-zone population, and ash dispersal over air routes and settlements.',
      leadTime: 'A volcano is usually restless for days to weeks before an eruption, but the exact start is still uncertain.'
    },
    'Extreme Heat': {
      name: 'Extreme heat',
      definition: 'A period of temperature and humidity high enough to threaten health, defined against local norms rather than a single global threshold. Overnight minima matter as much as daytime peaks.',
      onset: 'rapid',
      forecastable: true,
      horizonH: 120,
      duration: 'Days to a few weeks.',
      severityBasis: 'Duration, night-time minima, and the size of the exposed population without cooling.',
      leadTime: 'Three to seven days. These are among the most reliable forecasts for any hazard.'
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
      leadTime: 'Hours to two days. Forecasts become much less reliable after the first day.'
    },
    Tornado: {
      name: 'Tornado',
      definition: 'A violently rotating column of air in contact with both a convective cloud and the ground. Rated after the fact on the Enhanced Fujita scale from observed damage.',
      onset: 'sudden',
      forecastable: true,
      horizonH: 24,
      duration: 'Minutes for an individual tornado; an outbreak lasts hours.',
      severityBasis: 'Observed damage rating and whether the track crosses built-up areas.',
      leadTime: 'Minutes for a warning about a particular tornado, and up to a day for the area at risk. Never an exact place and time in advance.'
    },
    Tsunami: {
      name: 'Tsunami',
      definition: 'Long-wavelength ocean waves generated by seafloor displacement, usually from an earthquake. Travels at jet speed across open ocean and builds height in shallow water.',
      onset: 'sudden',
      forecastable: true,
      horizonH: 24,
      duration: 'Hours of wave trains; the first wave is often not the largest.',
      severityBasis: 'Expected run-up height against coastal population and evacuation time available.',
      leadTime: 'Minutes to hours, depending on how far the wave has to travel. It is not forecast by any model.'
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
    /* The weather models' own hazards (forecast-models.js MODEL_HAZARDS) are
       weather lines, not disasters, and are named so; they belong to the
       family of the disaster they bear on. */
    if (/^unusually hot days$/.test(k)) return HAZARDS['Extreme Heat'];
    if (/^unusually heavy rain$/.test(k)) return HAZARDS.Flood;
    if (/^high fire-weather index$/.test(k)) return HAZARDS.Wildfire;
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

  /** Severity from the published level, rather than a number invented per
      event: an authority's own alert where the provider issues one, and this
      site's mapping of a measured intensity where it does not (a record says
      which, under alertBasis). Both are evidence about how grave the hazard
      is; only the first is evidence that an authority declared anything, and
      that distinction is the observed ledger's business, not this ranking's. */
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

    /*
     * Two vocabularies, and they are not the same scale.
     *
     * Red / Orange / Green is what an authority publishes about something it
     * has assessed. High / Moderate / Watch is what this site's derived
     * outlooks carry, and api/events.js sets it deliberately one step below
     * the signal it came from: a Red signal produces a High outlook, an
     * Orange one a Moderate outlook. Ranking High and Red the same erased
     * that step, so every outlook came out at the severity of the warning it
     * was derived from - measured on the live feed, five outlooks derived
     * from Red and Orange signals all published as Severe, the same word the
     * warnings themselves carried, and the risk badge said so on every card.
     *
     * The forecast vocabulary therefore ranks one step below the official
     * one, which is the step api/events.js took in the first place. Only
     * forecasts use it: nothing observed in the feed carries High, Moderate
     * or Watch.
     */
    var issued = 0;
    /* A weather model's forecast is not derived from anyone's alert, so it
       is not set one step below one. Its "High" means the place's
       99th percentile was forecast to be crossed and is ranked as high;
       its "Moderate", the 95th, as moderate. They were published as
       Moderate and Watch. */
    if (e.forecastKind === 'model-advance') {
      var mk = String(e.alert || '');
      if (mk === 'High') return Math.max(assessed, wind, 4);
      if (mk === 'Moderate') return Math.max(assessed, wind, 3);
    }
    switch (String(e.alert || '')) {
      case 'Red': issued = 4; break;
      case 'Orange': issued = 3; break;
      case 'High': issued = 3; break;
      case 'Moderate': issued = 2; break;
      case 'Watch': issued = 1; break;
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
  /*
   * A named storm is never shown below its agency category.
   *
   * GDACS colours a cyclone by the population its winds reach, so a super
   * typhoon over open sea is Green, and an outlook derived from it was then
   * set a step lower still: "Low · Storm risk from Super Typhoon In-fa". The
   * category the agency gave the storm is a floor, on the same steps as the
   * wind speed: a tropical storm Minor (Watch), a typhoon, hurricane or
   * category 1 to 2 Moderate, category 3 Severe, category 4 to 5 or a super
   * typhoon Extreme.
   */
  function cycloneCategoryRank(e) {
    if (!e) return 0;
    var t = String(e.type || '') + ' ' + String(e.title || '') + ' ' + String(e.name || '') + ' ' + String(e.region || '');
    if (!/cyclone|hurricane|typhoon|tropical storm/i.test(t)) return 0;
    var cat = Number(e.category);
    var m = /\bcategory\s*([1-5])\b/i.exec(t);
    if (!(cat >= 1 && cat <= 5) && m) cat = +m[1];
    var r = 0;
    if (/\bsuper\s+typhoon\b/i.test(t)) r = 5;
    else if (cat >= 4) r = 5;
    else if (cat === 3) r = 4;
    else if (cat >= 1 || /\b(?:typhoon|hurricane)\b/i.test(t)) r = 3;
    else if (/\btropical storm\b/i.test(t)) r = 2;
    return r;
  }

  function severityOf(e) {
    var r = Math.max(impactRank(e || {}), alertRank(e || {}), cycloneCategoryRank(e || {}), 1);
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
    var n = function (x, unit) { x = Math.round(x); return x + ' ' + unit + (x === 1 ? '' : 's'); };
    if (h < 0) return 'Made ' + n(Math.abs(h), 'hour') + ' after the forecast period began, so it gave no advance warning.';
    if (h === 0) return 'No advance warning. This forecast began when it was made, so it describes something already under way.';
    if (h < 48) return 'Made ' + n(h, 'hour') + ' before the forecast period begins.';
    return 'Made ' + n(h / 24, 'day') + ' before the forecast period begins.';
  }


  /**
   * The facts that matter for each hazard, in the order a reader wants them.
   * Each names a field on the record; a field the connected sources do not
   * publish still appears, marked not reported, because a silent omission reads
   * as a zero.
   */
  /*
   * What every disaster is measured by, whoever reported it.
   *
   * Each hazard names its own measures first and then this, so the impact
   * block reads the same on a wildfire as on an earthquake. It is the same
   * list the observed record tracks, and it is stated in full rather than
   * per hazard because a count that is missing from the grid is a count the
   * reader has no reason to ask about: an earthquake page that lists deaths
   * and says nothing about injuries does not read as "we have no injury
   * figure", it reads as though injuries were not a thing that happened.
   */
  var IMPACT = ['deaths', 'injuries', 'missing', 'displaced', 'evacuated', 'affected'];
  /** This hazard's own measures, then the impact every hazard is measured by. */
  function metrics() {
    return Array.prototype.slice.call(arguments).concat(IMPACT);
  }

  var METRICS = {
    Earthquake: metrics('magnitude', 'depthKm', 'pagerAlert', 'tsunamiFlag'),
    'Earthquake aftershock sequence': metrics('mainshockMagnitude'),
    'Tropical Cyclone': metrics('windKt', 'category', 'pressureMb', 'movement'),
    Flood: metrics(),
    'Flood / Landslide': metrics(),
    Landslide: metrics(),
    Wildfire: metrics('areaHa'),
    Drought: metrics(),
    Volcano: metrics('alertLevel', 'aviationColour'),
    'Extreme Heat': metrics(),
    'Extreme Cold': metrics(),
    'Severe Storm': metrics(),
    Tornado: metrics(),
    Tsunami: metrics()
  };

  var LABELS = {
    magnitude: 'Magnitude', mainshockMagnitude: 'Mainshock magnitude',
    depthKm: 'Depth', pagerAlert: 'USGS impact alert',
    tsunamiFlag: 'Tsunami flag', windKt: 'Maximum sustained wind', category: 'Category',
    pressureMb: 'Minimum central pressure', movement: 'Moving',
    areaHa: 'Area burned', alertLevel: 'Observatory alert level',
    aviationColour: 'Aviation colour code',
    deaths: 'Lives lost', injuries: 'Injured', missing: 'Missing or unaccounted for',
    displaced: 'People displaced', evacuated: 'People evacuated',
    affected: 'People affected'
  };

  /* Which of the sixteen compass points a bearing falls in. Published as a
     bearing by the hurricane centre; "north-west" is what a reader in its
     path reads without having to picture a protractor. */
  var COMPASS = ['north', 'north-north-east', 'north-east', 'east-north-east',
    'east', 'east-south-east', 'south-east', 'south-south-east',
    'south', 'south-south-west', 'south-west', 'west-south-west',
    'west', 'west-north-west', 'north-west', 'north-north-west'];
  /*
   * Absent is absent, and Number(null) is 0.
   *
   * The API writes null where the hurricane centre published nothing, and
   * every one of those nulls became a zero here: a storm with no bearing was
   * reported as moving NORTH, and a bearing with no forward speed as moving
   * at 0 kt. Both are numbers nobody published, on the one field a reader in
   * a storm's path acts on. The test for this only ever passed `undefined`,
   * which Number turns into NaN, so it never saw what the feed actually
   * sends.
   */
  function published(v) {
    return v !== undefined && v !== null && v !== '' && isFinite(Number(v));
  }
  function compassOf(deg) {
    if (!published(deg)) return null;
    var d = Number(deg);
    return COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  }

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
      case 'pressureMb': {
        var mb = Number(v);
        var okMb = has && isFinite(mb) && mb > 0;
        return { key: key, label: label, reported: okMb, value: okMb ? group(mb) + ' mb' : null,
          note: okMb ? null : 'This source publishes no central pressure for this system' };
      }
      case 'movement': {
        /* Two published fields read as the one thing a reader wants: where it
           is going and how fast. A bearing with no speed still says where,
           and a speed with no bearing says nothing on its own. */
        var where = compassOf(e.movementDirDeg);
        var fast = published(e.movementKt) && Number(e.movementKt) >= 0
          ? Math.round(Number(e.movementKt)) + ' kt' : null;
        var moving = where ? (where + (fast ? ' at ' + fast : '')) : null;
        return { key: key, label: label, reported: !!moving, value: moving,
          note: moving ? null : 'This source publishes no track for this system' };
      }
      case 'areaHa': {
        var ha = Number(e.areaHa);
        var ok = isFinite(ha) && ha > 0;
        // group() rounds to a whole number, so dividing first turned 150 ha
        // into "2 km²" - a third more ground than burned. Below 100 km² the
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
    /* A hazard this table does not model is still a disaster, and is still
       measured by what it did. The fallback was two of the six, so an EONET
       "Ice" record, an unmapped provider category or a record with no type at
       all quietly went back to omitting injuries, missing, displaced and
       evacuated - the same silence the impact block exists to break. What a
       hazard outside the table lacks is its OWN measures, not these. */
    var keys = METRICS[hazardName(h)] || IMPACT;
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
    /* "Outside" means outside every part. One part that could not be decided
       - an antimeridian-wrapping ring, a degenerate one - is not evidence that
       the point is not in it, and reporting false here told a reader they were
       outside a warning area on the strength of the parts that happened to be
       decidable. Any undecidable part makes the whole undecidable. */
    if (g.type === 'MultiPolygon') {
      if (!Array.isArray(g.coordinates)) return null;
      var undecidable = false;
      for (var i = 0; i < g.coordinates.length; i++) {
        var r = inPolygon(lon, lat, g.coordinates[i]);
        if (r === true) return true;
        if (r === null) undecidable = true;
      }
      return undecidable ? null : false;
    }
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      var unknown = false;
      for (var k = 0; k < g.geometries.length; k++) {
        var c = geometryContains(g.geometries[k], lat, lon);
        if (c === true) return true;
        if (c === null) unknown = true;
      }
      return unknown ? null : false;
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
   * it - not how alarming they look.
   */
  var RISK_BANDS = [
    { key: 'A', title: 'Confirmed events nearby',
      blurb: 'Events an official agency has reported at an exact spot within 500 km of one of your places.',
      empty: 'No reported event within 500 km of your places.' },
    { key: 'B', title: 'Official warnings for your places',
      blurb: 'Warnings in force now. Where the agency published the area a warning covers, we checked whether your place is inside it.',
      empty: 'No official warning covers your places right now.' },
    { key: 'C', title: 'Forecasts',
      blurb: 'Our own estimates of what may happen next. They are not reports that something has happened, and they are not official warnings.',
      empty: 'No forecast covers your places right now.' },
    { key: 'D', title: 'Wider-area reports',
      blurb: 'Reports that give only the centre of a large area, not an exact spot. They are listed because that centre is within range; your place may or may not be inside the affected area.',
      empty: 'No wider-area report near your places right now.' },
    /* Kept in the list and kept empty. The band is a real part of the answer
       to "how exposed is this place", and this project publishes no
       per-location history to fill it with - so it says that, rather than
       being quietly dropped or filled with something that looks like one. */
    { key: 'E', title: 'Past disasters',
      blurb: 'What has happened at a place before.',
      dataAvailable: false,
      empty: 'We do not publish a history of past events for each place, so nothing can be shown here. Your national or regional disaster agency keeps the official record.' }
  ];

  var APPLICABILITY = {
    insideIncident: 'Your place is inside the reported affected area.',
    insideWarning: 'Your place is inside the official warning area.',
    outsideWarning: 'Your place is outside the official warning area.',
    undetermined: 'This is a regional warning. We could not tell whether it covers your exact place.',
    forecast: 'This is a forecast of what may happen, not a report that something has happened.',
    outsideForecast: 'Your place is outside the forecast area.',
    countryForecast: 'This forecast covers the whole country your place is in, not one specific spot.',
    countryUnknownPlace: 'This forecast covers a whole country, but your saved place has no country recorded. Search for the place by name instead of entering coordinates, and we can check.',
    countryUnrecognisedPlace: 'This forecast covers a whole country, but we could not recognise the country of your saved place. This can happen if you searched in another language. Search for the place by name again to fix it.',
    areaLevel: 'This report gives only the centre of an area, not an exact spot. We could not tell whether your place is inside the affected area.'
  };

  /**
   * Which band a feed record falls in for one saved place, or null when the
   * record says nothing about it.
   *
   * distanceKm is always computed where both points exist, but claimDistance
   * says whether it may be shown to the reader as a distance to the hazard.
   */
  /*
   * Two names for one country, told apart from two different countries.
   *
   * The saved place's country comes from a geocoder that answers in the
   * browser's language, so a home saved in a German browser reads
   * "Deutschland" while every record in the feed says "Germany". Exact
   * lower-cased equality then failed, and the page did the quiet thing: it
   * dropped every Germany-wide outlook for that reader rather than being
   * wrong out loud. The place now carries the two-letter code the geocoder
   * returns, which no language changes, and the English name is derived from
   * it here. Names are compared on their letters alone, so "Viet Nam" and
   * "Vietnam" are one country; nothing further is inferred, and two genuinely
   * different names stay two countries.
   */
  function coordOf(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function countryKey(name) {
    var s = String(name || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^a-z]/g, '');
  }

  function countryFromCode(code) {
    var c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return null;
    try {
      if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        var n = new Intl.DisplayNames(['en'], { type: 'region' }).of(c);
        if (n && n !== c) return n;
      }
    } catch (err) { /* no ICU data for regions: fall back to the saved name */ }
    return null;
  }

  /** Every spelling this saved place can be recognised by; empty when it
      records no country at all, which is not the same as not matching. */
  function placeCountryKeys(place) {
    var keys = [], fromCode = countryFromCode(place && place.countryCode);
    if (fromCode) keys.push(countryKey(fromCode));
    var named = countryKey(place && place.country);
    if (named && keys.indexOf(named) < 0) keys.push(named);
    return keys;
  }

  function countryMatches(place, name) {
    var want = countryKey(name);
    return !!want && placeCountryKeys(place).indexOf(want) >= 0;
  }

  /* Every country name in English, keyed the same way, built once from the
     two-letter codes the platform knows. It is what lets a name that does not
     match be read correctly: "France" is a different country from Germany,
     while "Deutschland" is a name this comparison cannot place at all, and
     saying "does not apply" to the second would be the same silent drop in a
     new disguise. */
  var ENGLISH_COUNTRIES = null;
  function englishCountryKeys() {
    if (ENGLISH_COUNTRIES) return ENGLISH_COUNTRIES;
    ENGLISH_COUNTRIES = {};
    try {
      if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        var dn = new Intl.DisplayNames(['en'], { type: 'region' });
        for (var a = 65; a <= 90; a++) {
          for (var b = 65; b <= 90; b++) {
            var code = String.fromCharCode(a, b), name = dn.of(code);
            if (name && name !== code) ENGLISH_COUNTRIES[countryKey(name)] = code;
          }
        }
      }
    } catch (err) { /* no region data: the check below stands down */ }
    return ENGLISH_COUNTRIES;
  }

  /** Whether a name that did not match can be trusted to mean a different
      country. A code always can; an English name can; anything else cannot be
      told apart from this country under another name. */
  function countryComparable(place) {
    if (countryFromCode(place && place.countryCode)) return true;
    var k = countryKey(place && place.country);
    if (!k) return false;
    var names = englishCountryKeys();
    for (var any in names) {
      if (Object.prototype.hasOwnProperty.call(names, any)) {
        return Object.prototype.hasOwnProperty.call(names, k);
      }
    }
    return true;   // nothing to check against; the saved name stands
  }

  function riskRow(e, place, radiusKm) {
    e = e || {}; place = place || {};
    var R = isFinite(radiusKm) ? Number(radiusKm) : RISK_RADIUS_KM;
    /* Number(null) and Number('') are both 0, and 0,0 is a real position in
       the Gulf of Guinea, so an unlocated place or record would have been
       measured from Null Island and could read as kilometres from a reader's
       home. Absent is absent. */
    var pLat = coordOf(place.lat), pLon = coordOf(place.lon);
    var eLat = coordOf(e.lat), eLon = coordOf(e.lon);
    if (pLat === null || pLon === null) return null;

    var contains = geometryContains(e.geometry, pLat, pLon);
    var d = (eLat !== null && eLon !== null) ? distanceKm(pLat, pLon, eLat, eLon) : null;
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
      /* A country-wide outlook applies to the country, not to a radius around
         whichever point it was anchored at. A United States outlook anchored
         in Florida was dropped for a home in California - 3,500 km away and
         squarely inside the area the outlook names. Where the saved place
         records which country it is in, that is what decides it; where it does
         not, neither answer is available and the row says so rather than
         inventing one from the distance. */
      if (e.forecastScope === 'country' && e.country) {
        if (countryMatches(place, e.country)) return out('C', APPLICABILITY.countryForecast, false);
        /* It did not match, and whether that means a different country
           depends on whether the saved name can be placed at all. */
        if (placeCountryKeys(place).length) {
          if (countryComparable(place)) return null;
          return near ? out('C', APPLICABILITY.countryUnrecognisedPlace, false) : null;
        }
        /* No country on the saved place: neither "it applies" nor "it does
           not" can be established, so no row is invented for it. The page
           says how many outlooks this leaves out and how to fix it, rather
           than listing every country-wide outlook on earth against a place
           it cannot locate. */
        return near ? out('C', APPLICABILITY.countryUnknownPlace, false) : null;
      }
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
      label: 'Made in advance',
      definition: 'Recorded before the event it forecasts had started.',
      headline: true
    },
    'warning-derived': {
      label: 'Based on an official warning',
      definition: 'Made from an official warning that had already been issued.',
      headline: false
    },
    'continuation-outlook': {
      label: 'Follows an ongoing event',
      definition: 'Made after the event had started. It forecasts that the event will continue or get worse.',
      headline: false
    },
    'post-event-conditional': {
      label: 'After an earthquake',
      definition: 'Made after an event that has already happened, such as aftershocks following a large earthquake.',
      headline: false
    },
    'retrospective-benchmark': {
      label: 'Test case, not made in advance',
      definition: 'A test of the method, written after the period it covers had started.',
      headline: false
    },
    'invalid-post-event': {
      label: 'Not valid: no proof it came first',
      definition: 'Presented as made in advance, but nothing shows it existed before the period it covers.',
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
  /*
   * The providers whose records are warnings rather than observations.
   *
   * Held here, beside the classification that needs it, and pinned to the
   * feed's own evidence classification by test/forecastclass.js: if a
   * provider ever starts or stops publishing warnings, the test fails rather
   * than this list quietly going stale. Matched against the outlook's source
   * string, which the API builds from the parent record's own source.
   */
  var WARNING_PROVIDERS = /(?:National Weather Service|Volcano Hazards Program)/i;
  function warningProvider(source) {
    return WARNING_PROVIDERS.test(String(source || '')) ? 'official-warning' : null;
  }

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
      var parentState = (parent && parent.evidenceState) ||
        /* No parent to read.
         *
         * The append-only ledger records an outlook, not the record it was
         * derived from, and that record leaves the rolling feed within days.
         * Classifying a ledger row therefore had no parent to consult and
         * fell straight through to continuation-outlook - "written after the
         * hazard existed, forecasting that it continues" - for all 495
         * derived rows on record, including the 110 derived from National
         * Weather Service warnings and the 14 from volcano alert levels. A
         * warning says severe weather is EXPECTED; it is not a hazard
         * observed to exist, so that label claimed more for those outlooks
         * than the record supports.
         *
         * What the row does carry is the provider it came from, because the
         * API writes the parent's own source into it. For the providers whose
         * records are warnings rather than observations that is enough to
         * answer, and where it is not the row still says only what it can. */
        warningProvider(f.source);
      if (parentState === 'official-warning') {
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

  /*
   * What makes a frozen claim the claim it is.
   *
   * The ledger keyed a forecast on its id and the start of its window and
   * treated that pair as the whole claim. Measured: a second run carrying the
   * same id and start, a window eight days longer and a geography moved from
   * Nepal to Bihar, recorded nothing at all - and the feed then served the
   * revised claim carrying the original row's freeze timestamp, which is to
   * say a claim nobody ever froze, presented as having existed for days. The
   * key is every term the verifier grades on: change any of them and it is a
   * new claim, which needs its own immutable row before it can be counted.
   *
   * A term a row never recorded reads as absent rather than as equal. Those
   * rows cannot prove what they do not state, so a claim that now carries a
   * scope is frozen afresh - later than the old row, which is the direction
   * that can only cost a forecast credit, never grant it.
   */
  function coordToken(v) {
    var n = Number(v);
    return isFinite(n) ? n.toFixed(3) : '-';
  }
  /*
   * The types that name no hazard at all, kept in step with the observed
   * model's own list by test/ledger.js rather than by hope.
   *
   * The hazard a claim is graded on is read from its type, and from its title
   * only where the type is one of these. So for every other row the title is
   * prose and a rewording is not a new claim - but for these it is the only
   * thing that says what the outlook is about, and two rows sharing an id, a
   * window and a geography under type "Other" were one key and two different
   * hazards: measured, "Flood risk outlook" and "Landslide risk outlook"
   * collapsed onto one claim, so the second was never frozen and the feed
   * served it under the first one's freeze timestamp.
   */
  var TYPE_NAMES_NO_HAZARD = /^(?:|natural hazard|other|others|unknown|unspecified|unclassified|complex emergency)$/i;

  function claimKey(f) {
    f = f || {};
    /* Part of the claim exactly where it is part of what the claim says. */
    var title = TYPE_NAMES_NO_HAZARD.test(String(f.type || '').trim()) ? f.title : null;
    return [f.id, f.type, f.targetStart, f.targetEnd, f.country, f.region,
      coordToken(f.lat), coordToken(f.lon), f.forecastScope, title]
      .map(function (v) {
        return (v === undefined || v === null || v === '') ? '-' : String(v).trim();
      }).join('|');
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
    severityOf: severityOf, severityRank: severityRank, severityRanks: RANK, cycloneCategoryRank: cycloneCategoryRank,
    impactRank: impactRank, alertRank: alertRank,
    leadTimeHours: leadTimeHours, leadTimeText: leadTimeText,
    keyFacts: keyFacts, cycloneCategory: cycloneCategory, METRICS: METRICS,
    geometryContains: geometryContains, distanceKm: distanceKm,
    riskRow: riskRow, RISK_BANDS: RISK_BANDS, RISK_RADIUS_KM: RISK_RADIUS_KM,
    countryMatches: countryMatches, countryFromCode: countryFromCode,
    countryComparable: countryComparable,
    APPLICABILITY: APPLICABILITY,
    FORECAST_CLASSES: FORECAST_CLASSES, classifyForecast: classifyForecast,
    claimKey: claimKey,
    TYPE_NAMES_NO_HAZARD: TYPE_NAMES_NO_HAZARD,
    WARNING_PROVIDERS: WARNING_PROVIDERS,
    effectiveForecastStart: effectiveForecastStart,
    observationCanVerify: observationCanVerify,
    creditedWindowHours: creditedWindowHours
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDHazards = api;
})(typeof window !== 'undefined' ? window : null);
