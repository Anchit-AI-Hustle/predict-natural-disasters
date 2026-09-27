'use strict';

/*
 * Fixture quakes are dated relative to now, not to fixed days in September.
 *
 * They used to carry absolute timestamps, and an aftershock outlook runs seven
 * days from its mainshock — so on 2026-09-20T22:00Z the last of the three
 * windows closed, the outlooks stopped being generated, and "M5.5+ quakes
 * should produce an aftershock-sequence outlook" began failing for everyone,
 * on a suite nobody had touched. A fixture that expires is a test that reports
 * the calendar rather than the code.
 */
function agoHours(h) { return Date.now() - h * 3600e3; }
/* The same instant as an ISO string, for the feeds that publish text. */
function isoAgoHours(h) { return new Date(agoHours(h)).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
/**
 * Deterministic fixtures for every upstream the API talks to, plus a fetch
 * mock that routes by URL. Lets the real handlers run end-to-end offline.
 */

const NOW = new Date();
const isoNow = NOW.toISOString();

const FIXTURES = {
  gdacs: [
    {
      eventid: 1104999, eventtype: 'FL', name: 'Flood in Bagmati Province, Nepal',
      country: 'Nepal', location: 'Bagmati Province', alertlevel: 'Red',
      latitude: 27.7, longitude: 85.3, fromdate: '2026-09-10T00:00:00Z', todate: isoNow,
      description: 'Widespread riverine flooding with continuing displacement.',
      death: 42, displaced: 5100, affected: 120000
    },
    {
      eventid: 1105001, eventtype: 'TC', name: 'Tropical Cyclone RAI-26',
      country: 'Philippines', location: 'Eastern Visayas', alertlevel: 'Orange',
      latitude: 11.2, longitude: 125.0, fromdate: '2026-09-12T00:00:00Z', todate: isoNow,
      description: 'Active tropical cyclone approaching the eastern seaboard.',
      // GDACS publishes its measurement as a structured object whose unit
      // changes with the hazard: km/h of wind here, hectares on the wildfire.
      // GDACS labels this unit Kph in production, which a test for the substring
// "km/h" does not match. The fixture used the one spelling that happened
// to work, which hid the case that actually ships.
      severitydata: { severity: 120, severitytext: 'Tropical Storm, maximum wind speed 120 Kph', severityunit: 'Kph' }
    },
    {
      eventid: 1105002, eventtype: 'WF', name: 'Wildfire in Attica, Greece',
      country: 'Greece', location: 'Attica', alertlevel: 'Orange',
      latitude: 38.1, longitude: 23.9, fromdate: '2026-09-13T00:00:00Z', todate: isoNow,
      description: 'Uncontrolled wildfire with evacuation of nearby settlements.',
      severitydata: { severity: 3150, severitytext: 'burnt area of 3150 ha', severityunit: 'ha' },
      // An explicitly null count is still "the agency reported nothing", and
      // Number(null) is 0.
      death: null, displaced: '', affected: undefined
    },
    {
      eventid: 1105004, eventtype: 'EQ', name: 'Earthquake in West Java, Indonesia',
      country: 'Indonesia', location: 'West Java', alertlevel: 'Orange',
      latitude: -6.8, longitude: 107.1,
      /* The same instant as the USGS Cianjur quake it merges with; both are
         relative, so they cannot drift apart as the calendar moves. */
      fromdate: isoAgoHours(48), todate: isoNow,
      description: 'Strong earthquake with reported casualties.',
      // GDACS reports the same event USGS catalogues as us7000mnop, with a
      // death toll that outranks the USGS copy in the seismic merge. GDACS
      // publishes no depth, no PAGER assessment and no tsunami flag.
      severitydata: { severity: 5.6, severitytext: 'Magnitude 5.6M', severityunit: 'M' },
      death: 21
    },
    {
      eventid: 1105003, eventtype: 'DR', name: 'Drought in Horn of Africa',
      country: 'Kenya', location: 'Northern Kenya', alertlevel: 'Orange',
      latitude: 2.3, longitude: 37.9, fromdate: '2026-06-01T00:00:00Z', todate: isoNow,
      description: 'Multi-season rainfall deficit affecting pastoral communities.'
    }
  ],

  usgs: {
    features: [
      {
        id: 'us7000abcd',
        properties: { place: '12 km NNE of Teluknaga, Indonesia', mag: 6.5, time: agoHours(60), updated: agoHours(59), title: 'M 6.5 - 12 km NNE of Teluknaga, Indonesia', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', tsunami: 0, alert: 'orange' },
        geometry: { coordinates: [106.6, -5.9, 22.4] }
      },
      {
        id: 'us7000efgh',
        properties: { place: '40 km W of Concepcion, Chile', mag: 5.8, time: agoHours(24), updated: agoHours(23.5), title: 'M 5.8 - 40 km W of Concepcion, Chile', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000efgh', tsunami: 0 },
        geometry: { coordinates: [-73.5, -36.8, 30] }
      },
      {
        // The same earthquake GDACS reports as event 1105004, so the two merge.
        id: 'us7000mnop',
        properties: { place: '8 km SW of Cianjur, Indonesia', mag: 5.6, time: agoHours(48), updated: agoHours(47.5), title: 'M 5.6 - 8 km SW of Cianjur, Indonesia', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000mnop', tsunami: 0, alert: 'yellow' },
        geometry: { coordinates: [107.1, -6.8, 11.0] }
      },
      {
        id: 'us7000ijkl',
        properties: { place: '11 km NE of Ridgecrest, CA', mag: 3.1, time: Date.parse('2026-09-14T01:00:00Z'), updated: Date.parse('2026-09-14T01:05:00Z'), title: 'M 3.1 - 11 km NE of Ridgecrest, CA', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000ijkl', tsunami: 0 },
        geometry: { coordinates: [-117.7, 35.6, 8] }
      }
    ]
  },

  eonet: {
    events: [
      { id: 'EONET_7001', title: 'Wildfire - Northern California', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/x' }], geometry: [{ type: 'Point', date: '2026-09-09T00:00:00Z', coordinates: [-121.5, 40.2] }, { type: 'Point', date: isoNow, coordinates: [-121.4, 40.3] }] },
      { id: 'EONET_7002', title: 'Volcano - Mount Merapi', categories: [{ title: 'Volcanoes' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/y' }], geometry: [{ type: 'Point', date: isoNow, coordinates: [110.44, -7.54] }] },
      { id: 'EONET_7003', title: 'Wildfire MEERS, Comanche, Oklahoma', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/z' }], geometry: [{ type: 'Point', date: isoNow, coordinates: [-98.5, 34.7] }] },
      { id: 'EONET_7004', title: 'Prescribed Fire RX Flowing 24, Clay, Minnesota', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/w' }], geometry: [{ type: 'Point', date: isoNow, coordinates: [-96.5, 46.9] }] }
    ]
  },

  nhc: {
    activeStorms: [
      {
        id: 'al072026', binNumber: 'AT1', name: 'FIONA', classification: 'HU',
        intensity: '105', pressure: '948', latitudeNumeric: 24.4, longitudeNumeric: -70.1,
        movementDir: 315, movementSpeed: 12, lastUpdate: isoNow,
        publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/' }
      }
    ]
  },

  nws: {
    features: [
      {
        id: 'urn:oid:2.49.0.1.840.0.aaa',
        properties: {
          id: 'urn:oid:2.49.0.1.840.0.aaa', event: 'Flash Flood Warning', severity: 'Severe',
          areaDesc: 'Harris, TX; Fort Bend, TX', headline: 'Flash Flood Warning issued for Harris County',
          instruction: 'Move to higher ground now.', onset: '2026-09-14T02:00:00Z',
          effective: '2026-09-14T02:00:00Z', sent: isoNow, expires: '2026-09-14T08:00:00Z',
          senderName: 'NWS Houston/Galveston TX', '@id': 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.aaa'
        },
        geometry: { type: 'Polygon', coordinates: [[[-95.5, 29.6], [-95.2, 29.6], [-95.2, 29.9], [-95.5, 29.9], [-95.5, 29.6]]] }
      },
      {
        id: 'urn:oid:2.49.0.1.840.0.bbb',
        properties: {
          id: 'urn:oid:2.49.0.1.840.0.bbb', event: 'Excessive Heat Warning', severity: 'Extreme',
          areaDesc: 'Maricopa, AZ', headline: 'Dangerous heat', sent: isoNow, expires: '2026-09-16T00:00:00Z',
          senderName: 'NWS Phoenix AZ',
          affectedZones: ['https://api.weather.gov/zones/forecast/AZZ553', 'https://api.weather.gov/zones/forecast/AZZ554']
        },
        geometry: null // zone-based: the alert itself carries no polygon
      },
      {
        id: 'urn:oid:2.49.0.1.840.0.ccc',
        properties: { id: 'urn:oid:2.49.0.1.840.0.ccc', event: 'High Wind Warning', severity: 'Severe', areaDesc: 'Unknown', headline: 'Wind', sent: isoNow, senderName: 'NWS' },
        geometry: null // no polygon and no zone: genuinely unplaceable
      }
    ]
  },

  // ReliefWeb's public disasters feed: no coordinates, country in the title.
  reliefwebDisastersRss: `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Nepal: Floods and Landslides - Sep 2026</title><link>https://reliefweb.int/disaster/fl-2026-000167-npl</link><pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate><description>Heavy monsoon rainfall has caused widespread flooding.</description></item>
    <item><title>Philippines: Tropical Cyclone - Sep 2026</title><link>https://reliefweb.int/disaster/tc-2026-000200-phl</link><pubDate>Fri, 12 Sep 2026 00:00:00 GMT</pubDate><description>An active tropical cyclone is approaching.</description></item>
    <item><title>Atlantis: Mystery Event - Sep 2026</title><link>https://reliefweb.int/disaster/xx-2026-999</link><pubDate>Sat, 13 Sep 2026 00:00:00 GMT</pubDate><description>A country the geocoder cannot resolve.</description></item>
    <item><link>https://reliefweb.int/disaster/no-title</link><description>Item with no title at all.</description></item>
  </channel></rss>`,

  // Open-Meteo forward geocoding, keyed by the country asked for.
  geocode: {
    Nepal: { results: [{ name: 'Nepal', latitude: 28.16667, longitude: 84.25, country_code: 'NP' }] },
    Philippines: { results: [{ name: 'Philippines', latitude: 12.75, longitude: 122.73333, country_code: 'PH' }] },
    Atlantis: { results: [] }
  },

  /* Two zones, far enough apart that a place inside the second is nowhere
     near the first. An alert resolved from the first zone alone reports a
     place in the second as outside the warning area, which is the failure
     these fixtures exist to catch. */
  nwsZones: {
    AZZ553: {
      id: 'https://api.weather.gov/zones/forecast/AZZ553',
      properties: { id: 'AZZ553', name: 'Greater Phoenix Area' },
      geometry: { type: 'Polygon', coordinates: [[[-112.4, 33.2], [-111.8, 33.2], [-111.8, 33.7], [-112.4, 33.7], [-112.4, 33.2]]] }
    },
    AZZ554: {
      id: 'https://api.weather.gov/zones/forecast/AZZ554',
      properties: { id: 'AZZ554', name: 'Tucson Metro Area' },
      geometry: { type: 'Polygon', coordinates: [[[-111.2, 32.0], [-110.7, 32.0], [-110.7, 32.4], [-111.2, 32.4], [-111.2, 32.0]]] }
    }
  },

  usgsVolcano: [
    {
      obs_fullname: 'Alaska Volcano Observatory', obs_abbr: 'avo', volcano_name: 'Great Sitkin',
      vnum: '311120', notice_type_cd: 'DU', notice_identifier: 'DOI-USGS-AVO-2026-09-13T18:54:33+00:00',
      sent_utc: '2026-09-13 18:56:31', sent_unixtime: 1789325791, color_code: 'ORANGE', alert_level: 'WATCH',
      notice_url: 'https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-2026-09-13T18:54:33+00:00',
      // As in production: a URL to the notice, not the notice itself.
      notice_data: 'https://volcanoes.usgs.gov/hans-public/api/notice/getNotice/DOI-USGS-AVO-2026-09-13T18:54:33+00:00'
    },
    {
      obs_fullname: 'Hawaiian Volcano Observatory', obs_abbr: 'hvo', volcano_name: 'Kilauea',
      vnum: '332010', sent_utc: '2026-09-14 01:00:00', color_code: 'ORANGE', alert_level: 'WARNING',
      // Some records do carry coordinates inline.
      latitude: '19.421', longitude: '-155.287',
      notice_url: 'https://volcanoes.usgs.gov/hans-public/notice/hvo-1'
    }
  ],

  // Coordinates live one fetch away, nested inside the notice body — and an
  // observatory notice can reference more than one volcano, which is what put
  // Great Sitkin at Shishaldin's coordinates in production.
  usgsVolcanoNotice: {
    notice: {
      notice_identifier: 'DOI-USGS-AVO-2026-09-13T18:54:33+00:00',
      observatory: { obs_abbr: 'avo', name: 'Alaska Volcano Observatory' },
      volcanoes: [
        // Order matters: a depth-first walk reaches Shishaldin's pair first, so
        // "take the first coordinates found" mislabels Great Sitkin — exactly
        // what production showed.
        { volcano_name: 'Great Sitkin', vnum: '311120', latitude: 52.076, longitude: -176.13 },
        { volcano_name: 'Shishaldin', vnum: '311360', latitude: 54.755, longitude: -163.971 }
      ]
    }
  },

  emsc: {
    features: [
      { id: '20260913_0000123', properties: { unid: '20260913_0000123', mag: 5.2, magtype: 'mb', lat: 38.2, lon: 26.1, depth: 12, time: isoAgoHours(28), lastupdate: isoNow, flynn_region: 'AEGEAN SEA', auth: 'EMSC' }, geometry: { coordinates: [26.1, 38.2, 12] } },
      // The same earthquake the United States Geological Survey lists as
      // us7000abcd: a different solution for one event, not a second event.
      // Origin times differ by 23 seconds, epicentres by about 40 km.
      { id: '20260911_0000279', properties: { unid: '20260911_0000279', mag: 6.5, magtype: 'mw', lat: -6.1, lon: 106.9, depth: 25, time: isoAgoHours(60 - 23 / 3600), lastupdate: isoNow, flynn_region: 'JAVA, INDONESIA', auth: 'EMSC' }, geometry: { coordinates: [106.9, -6.1, 25] } }
    ]
  },

  googleNewsRss: `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Floods displace thousands in Bagmati province - Reuters</title><link>https://www.reuters.com/world/asia-pacific/nepal-floods-2026</link><pubDate>Sun, 14 Sep 2026 03:00:00 GMT</pubDate><description>Rescue teams reached cut-off villages overnight.</description><source url="https://www.reuters.com">Reuters</source></item>
    <item><title>Nepal army deploys helicopters for flood rescue - The Kathmandu Post</title><link>https://kathmandupost.com/national/2026/09/14/flood-rescue</link><pubDate>Sun, 14 Sep 2026 02:10:00 GMT</pubDate><description>Helicopter sorties resumed at first light.</description><source url="https://kathmandupost.com">The Kathmandu Post</source></item>
    <item><title>Aid agencies appeal for flood relief funds - Al Jazeera</title><link>https://www.aljazeera.com/news/2026/9/14/flood-appeal</link><pubDate>Sun, 14 Sep 2026 01:00:00 GMT</pubDate><description>An emergency appeal was launched.</description><source url="https://www.aljazeera.com">Al Jazeera</source></item>
  </channel></rss>`,

  bingNewsRss: `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Local volunteers open flood shelters</title><link>https://example-local-news.test/shelters</link><pubDate>Sun, 14 Sep 2026 04:00:00 GMT</pubDate><description>Community shelters opened in three districts.</description></item>
    <item><title>Floods displace thousands in Bagmati province</title><link>https://www.reuters.com/world/asia-pacific/nepal-floods-2026</link><pubDate>Sun, 14 Sep 2026 03:00:00 GMT</pubDate><description>Duplicate of the Google News item.</description></item>
  </channel></rss>`,

  reliefwebReports: {
    data: [
      { id: 4200001, fields: { title: 'Nepal: Floods and Landslides Situation Report No. 4', url: 'https://reliefweb.int/report/nepal/sitrep-4', source: [{ shortname: 'OCHA', name: 'UN Office for the Coordination of Humanitarian Affairs' }], date: { created: '2026-09-13T12:00:00+00:00' }, body: 'Humanitarian partners scaled up water and sanitation support.' } },
      { id: 4200002, fields: { title: 'IFRC Emergency Appeal: Nepal Floods', url: 'https://reliefweb.int/report/nepal/ifrc-appeal', source: [{ shortname: 'IFRC' }], date: { created: '2026-09-12T09:00:00+00:00' }, body: 'The appeal seeks CHF 5 million.' } }
    ]
  },

  reliefwebRss: `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Nepal: Floods and Landslides Situation Report No. 4</title><link>https://reliefweb.int/report/nepal/sitrep-4</link><pubDate>Sat, 13 Sep 2026 12:00:00 GMT</pubDate><description>Humanitarian partners scaled up water and sanitation support.</description><source url="https://reliefweb.int">OCHA</source></item>
    <item><title>IFRC Emergency Appeal: Nepal Floods</title><link>https://reliefweb.int/report/nepal/ifrc-appeal</link><pubDate>Fri, 12 Sep 2026 09:00:00 GMT</pubDate><description>The appeal seeks CHF 5 million.</description><source url="https://reliefweb.int">IFRC</source></item>
  </channel></rss>`,

  youtubeHtml: 'var ytInitialData = {"contents":' +
    '{"a":{"videoId":"AAAAAAAAAAA","x":1,"title":{"runs":[{"text":"Nepal floods: rescue operations continue"}]}},' +
    '"b":{"videoId":"BBBBBBBBBBB","x":1,"title":{"runs":[{"text":"Aerial footage of flooded districts"}]}}}};',

  // YouTube also serves a simpleText title shape...
  youtubeHtmlSimpleText: 'var ytInitialData = {"contents":' +
    '{"a":{"videoId":"CCCCCCCCCCC","x":1,"title":{"simpleText":"Flood rescue live"}}}};',

  // ...and a layout where only accessibility text carries the title.
  youtubeHtmlAccessibility: 'var ytInitialData = {"contents":' +
    '{"a":{"videoId":"DDDDDDDDDDD","lockupViewModel":{"x":1},"accessibilityText":"Drone footage of the flooded valley"}}};',

  // A consent interstitial: ids present, no titles at all.
  youtubeHtmlIdsOnly: 'var ytInitialData = {"c":[{"videoId":"EEEEEEEEEEE"},{"videoId":"FFFFFFFFFFF"}]};',

  // A bot wall with nothing usable.
  youtubeHtmlEmpty: '<html><body>Before you continue to YouTube</body></html>',

  bigDataCloud: {
    countryName: 'Nepal', countryCode: 'NP', principalSubdivision: 'Bagmati Province',
    city: 'Kathmandu', locality: 'Kathmandu', continent: 'Asia',
    localityInfo: { administrative: [{ name: 'Nepal' }, { name: 'Bagmati Province' }, { name: 'Kathmandu District' }] }
  }
};

function jsonResponse(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true, status: 200,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body)
  };
}
function failure(status) {
  return { ok: false, status: status || 503, text: async () => '', json: async () => ({}) };
}

/**
 * @param {object} opts
 *   down: array of source keys that should fail (or 'all')
 *   nwsRejects: query fragments api.weather.gov should answer with HTTP 400
 *   youtubeVariant: which youtubeHtml* fixture the search page should return
 *   volcanoNoticeMismatch: notice describes volcanoes other than the one asked for
 *   reliefwebEmptyUntil: only the candidate feed URL containing this returns items
 */
function makeFetch(opts) {
  const o = opts || {};
  const down = o.down === 'all' ? null : new Set(o.down || []);
  const isDown = key => (o.down === 'all' ? true : down.has(key));
  const calls = [];

  const fn = async (url) => {
    const u = String(url);
    calls.push(u);
    /* A test can replace one upstream's payload without rebuilding the rest:
       some defects only appear when two agencies report the same event. */
    const feeds = o.feeds || {};
    const route = (key, body) => (isDown(key) ? failure(503)
      : jsonResponse(Object.prototype.hasOwnProperty.call(feeds, key) ? feeds[key] : body));

    /* GDACS is asked one hazard at a time, and a page at a time; a test that
       has to answer those questions differently - a full page of wildfires,
       a page number the endpoint ignores - supplies o.gdacs(url). It returns
       a body, or null for a failed request, or undefined to fall through. */
    if (typeof o.gdacs === 'function' && u.includes('gdacs.org')) {
      const body = o.gdacs(u);
      if (body === null) return failure(503);
      if (body !== undefined) return jsonResponse(body);
    }
    if (u.includes('gdacs.org/gdacsapi') || u.includes('gdacs.org/xml/rss')) return route('gdacs', FIXTURES.gdacs);
    if (u.includes('earthquake.usgs.gov')) return route('usgs', FIXTURES.usgs);
    if (u.includes('eonet.gsfc.nasa.gov')) return route('eonet', FIXTURES.eonet);
    if (u.includes('nhc.noaa.gov/CurrentStorms')) return route('nhc', FIXTURES.nhc);
    if (u.includes('api.weather.gov/zones/')) {
      /* Answer for the zone that was asked for: routing every zone URL to one
         fixture would hide an alert that resolved only its first zone. */
      const id = (u.match(/zones\/forecast\/([A-Z0-9]+)/) || [])[1];
      /* One zone of a multi-zone warning failing is the case that decides
         whether a partial area gets published as the whole one. */
      if ((o.nwsZonesDown || []).includes(id)) return failure(503);
      const zone = FIXTURES.nwsZones[id];
      if (!zone) return failure(404);
      return route('nws', zone);
    }
    if (u.includes('api.weather.gov/alerts')) {
      // Reproduce production's HTTP 400: the API rejects one query parameter.
      if (o.nwsRejects && o.nwsRejects.some(p => u.includes(p))) {
        return { ok: false, status: 400, text: async () => '{"detail":"Invalid parameter"}', json: async () => ({}) };
      }
      return route('nws', FIXTURES.nws);
    }
    if (u.includes('reliefweb.int/disasters')) {
      // Mimic a Drupal miss: 200 with an HTML page and no <item> elements.
      if (o.reliefwebEmptyUntil && !u.includes(o.reliefwebEmptyUntil)) {
        return jsonResponse('<html><body>Page not found</body></html>');
      }
      return route('reliefweb', FIXTURES.reliefwebDisastersRss);
    }
    if (u.includes('reliefweb.int/updates/rss.xml')) return route('reliefweb_rss', FIXTURES.reliefwebRss);
    if (u.includes('geocoding-api.open-meteo.com')) {
      const name = decodeURIComponent((u.match(/[?&]name=([^&]*)/) || [])[1] || '');
      return route('geocode', FIXTURES.geocode[name] || { results: [] });
    }
    if (u.includes('volcanoes.usgs.gov/hans-public/api/notice/')) {
      if (o.volcanoNoticeMismatch) {
        return route('usgs_volcano_notice', {
          notice: { volcanoes: [
            { volcano_name: 'Pavlof', vnum: '312030', latitude: 55.42, longitude: -161.89 },
            { volcano_name: 'Veniaminof', vnum: '312070', latitude: 56.17, longitude: -159.38 }
          ] }
        });
      }
      return route('usgs_volcano_notice', FIXTURES.usgsVolcanoNotice);
    }
    if (u.includes('volcanoes.usgs.gov')) return route('usgs_volcano', FIXTURES.usgsVolcano);
    if (u.includes('seismicportal.eu')) return route('emsc', FIXTURES.emsc);
    if (u.includes('news.google.com/rss')) return route('google_news', FIXTURES.googleNewsRss);
    if (u.includes('bing.com/news')) return route('bing_news', FIXTURES.bingNewsRss);
    if (u.includes('youtube.com/results')) {
      const variant = o.youtubeVariant ? FIXTURES['youtubeHtml' + o.youtubeVariant] : FIXTURES.youtubeHtml;
      return route('youtube', variant);
    }
    if (u.includes('bigdatacloud.net')) return route('geocode', FIXTURES.bigDataCloud);

    return failure(404);
  };
  fn.calls = calls;
  return fn;
}

/** Minimal stand-in for the Vercel (req, res) pair. */
function mockRes() {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

module.exports = { FIXTURES, makeFetch, mockRes, jsonResponse, failure };
