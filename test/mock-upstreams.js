'use strict';
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
      description: 'Active tropical cyclone approaching the eastern seaboard.'
    },
    {
      eventid: 1105002, eventtype: 'WF', name: 'Wildfire in Attica, Greece',
      country: 'Greece', location: 'Attica', alertlevel: 'Orange',
      latitude: 38.1, longitude: 23.9, fromdate: '2026-09-13T00:00:00Z', todate: isoNow,
      description: 'Uncontrolled wildfire with evacuation of nearby settlements.'
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
        properties: { place: '12 km NNE of Teluknaga, Indonesia', mag: 6.5, time: Date.parse('2026-09-11T04:12:00Z'), updated: Date.parse('2026-09-11T05:00:00Z'), title: 'M 6.5 - 12 km NNE of Teluknaga, Indonesia', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', tsunami: 0 },
        geometry: { coordinates: [106.6, -5.9, 22.4] }
      },
      {
        id: 'us7000efgh',
        properties: { place: '40 km W of Concepcion, Chile', mag: 5.8, time: Date.parse('2026-09-13T22:00:00Z'), updated: Date.parse('2026-09-13T22:30:00Z'), title: 'M 5.8 - 40 km W of Concepcion, Chile', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000efgh', tsunami: 0 },
        geometry: { coordinates: [-73.5, -36.8, 30] }
      },
      {
        id: 'us7000ijkl',
        properties: { place: '5 km S of Ridgecrest, CA', mag: 3.1, time: Date.parse('2026-09-14T01:00:00Z'), updated: Date.parse('2026-09-14T01:05:00Z'), title: 'M 3.1 - 5 km S of Ridgecrest, CA', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000ijkl', tsunami: 0 },
        geometry: { coordinates: [-117.7, 35.6, 8] }
      }
    ]
  },

  eonet: {
    events: [
      { id: 'EONET_7001', title: 'Wildfire - Northern California', categories: [{ title: 'Wildfires' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/x' }], geometry: [{ type: 'Point', date: '2026-09-09T00:00:00Z', coordinates: [-121.5, 40.2] }, { type: 'Point', date: isoNow, coordinates: [-121.4, 40.3] }] },
      { id: 'EONET_7002', title: 'Volcano - Mount Merapi', categories: [{ title: 'Volcanoes' }], sources: [{ url: 'https://eonet.gsfc.nasa.gov/y' }], geometry: [{ type: 'Point', date: isoNow, coordinates: [110.44, -7.54] }] }
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
          affectedZones: ['https://api.weather.gov/zones/forecast/AZZ553']
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

  reliefwebDisasters: {
    data: [
      {
        id: 55501,
        fields: {
          name: 'Nepal: Floods and Landslides - Sep 2026', status: 'ongoing',
          url: 'https://reliefweb.int/disaster/fl-2026-000167-npl',
          type: [{ name: 'Flood' }],
          primary_country: { name: 'Nepal', iso3: 'npl', location: { lat: 28.2, lon: 84.0 } },
          country: [{ name: 'Nepal' }, { name: 'India' }],
          date: { created: '2026-09-01T00:00:00+00:00', changed: isoNow, event: '2026-08-26T00:00:00+00:00' }
        }
      },
      {
        id: 55502,
        fields: {
          name: 'Philippines: Tropical Cyclone - Sep 2026', status: 'alert',
          url: 'https://reliefweb.int/disaster/tc-2026-000200-phl',
          type: [{ name: 'Tropical Cyclone' }],
          primary_country: { name: 'Philippines', iso3: 'phl', location: { lat: 12.8, lon: 121.8 } },
          country: [{ name: 'Philippines' }],
          date: { created: '2026-09-12T00:00:00+00:00', changed: isoNow }
        }
      },
      {
        id: 55503,
        fields: { name: 'Past disaster record', status: 'past', url: 'https://reliefweb.int/disaster/x', type: [{ name: 'Flood' }], primary_country: { name: 'Chad', location: { lat: 12, lon: 15 } }, date: { created: '2020-01-01T00:00:00+00:00' } }
      }
    ]
  },

  nwsZone: {
    id: 'https://api.weather.gov/zones/forecast/AZZ553',
    properties: { id: 'AZZ553', name: 'Greater Phoenix Area' },
    geometry: { type: 'Polygon', coordinates: [[[-112.4, 33.2], [-111.8, 33.2], [-111.8, 33.7], [-112.4, 33.7], [-112.4, 33.2]]] }
  },

  usgsVolcano: [
    { vnum: 321050, volcano_name: 'Kilauea', latitude: 19.42, longitude: -155.29, alert_level: 'WATCH', color_code: 'ORANGE', obs_abbr: 'HVO', obs_fullname: 'Hawaiian Volcano Observatory', sent_utc: isoNow },
    { vnum: 331010, volcano_name: 'Great Sitkin', latitude: 52.08, longitude: -176.13, alert_level: 'ADVISORY', color_code: 'YELLOW', obs_abbr: 'AVO', sent_utc: isoNow }
  ],

  emsc: {
    features: [
      { id: '20260913_0000123', properties: { unid: '20260913_0000123', mag: 5.2, magtype: 'mb', lat: 38.2, lon: 26.1, depth: 12, time: '2026-09-13T18:00:00Z', lastupdate: isoNow, flynn_region: 'AEGEAN SEA', auth: 'EMSC' }, geometry: { coordinates: [26.1, 38.2, 12] } }
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
 */
function makeFetch(opts) {
  const o = opts || {};
  const down = o.down === 'all' ? null : new Set(o.down || []);
  const isDown = key => (o.down === 'all' ? true : down.has(key));
  const calls = [];

  const fn = async (url) => {
    const u = String(url);
    calls.push(u);
    const route = (key, body) => (isDown(key) ? failure(503) : jsonResponse(body));

    if (u.includes('gdacs.org/gdacsapi') || u.includes('gdacs.org/xml/rss')) return route('gdacs', FIXTURES.gdacs);
    if (u.includes('earthquake.usgs.gov')) return route('usgs', FIXTURES.usgs);
    if (u.includes('eonet.gsfc.nasa.gov')) return route('eonet', FIXTURES.eonet);
    if (u.includes('nhc.noaa.gov/CurrentStorms')) return route('nhc', FIXTURES.nhc);
    if (u.includes('api.weather.gov/zones/')) return route('nws', FIXTURES.nwsZone);
    if (u.includes('api.weather.gov/alerts')) {
      // Reproduce production's HTTP 400: the API rejects one query parameter.
      if (o.nwsRejects && o.nwsRejects.some(p => u.includes(p))) {
        return { ok: false, status: 400, text: async () => '{"detail":"Invalid parameter"}', json: async () => ({}) };
      }
      return route('nws', FIXTURES.nws);
    }
    if (u.includes('api.reliefweb.int') && u.includes('/disasters')) return route('reliefweb', FIXTURES.reliefwebDisasters);
    if (u.includes('api.reliefweb.int') && u.includes('/reports')) return route('reliefweb_reports', FIXTURES.reliefwebReports);
    if (u.includes('reliefweb.int/updates/rss.xml')) return route('reliefweb_rss', FIXTURES.reliefwebRss);
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
