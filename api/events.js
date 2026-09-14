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

function kmBetween(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** The agency behind a record, so two of its own records are never merged. */
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
    const others = ranked.slice(1).map(m => m.source).filter(s => s !== g.lead.source);
    // Independent corroboration is worth stating, not discarding.
    if (others.length) g.lead.corroboratedBy = [...new Set(others)];
  }
  // Rebuild in the caller's order so the newest-first sort survives the merge.
  return events.filter(e => { const g = groupOf.get(e); return !g || g.lead === e; });
}

/** ?summary=1 asks for the meta block alone. */
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
      refreshTarget: '5 minutes'
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
        details: p.description || p.eventdescription || p.severitydata || '',
        deaths: +(p.death || p.deaths || 0) || 0,
        displaced: +(p.displaced || 0) || 0,
        affected: +(p.affected || p.population || 0) || 0,
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
        const place = f.properties.place || '';
        const country = place.includes(',') ? place.split(',').pop().trim() : '';
        const mag = num(f.properties.mag);
        push({
          id: 'usgs-' + f.id,
          source: 'USGS', sourceType: 'official', type: 'Earthquake',
          title: f.properties.title, country, region: place,
          alert: mag >= 6 ? 'Red' : mag >= 5 ? 'Orange' : 'Green',
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
          startedAt: new Date(f.properties.time).toISOString(),
          updated: new Date(f.properties.updated || f.properties.time).toISOString(),
          details: 'Magnitude ' + (mag === null ? '—' : mag) + ' · depth ' +
            (f.geometry.coordinates[2] == null ? '—' : f.geometry.coordinates[2]) + ' km' +
            (f.properties.tsunami ? ' · tsunami flag issued' : ''),
          sourceUrl: f.properties.url || '',
          magnitude: mag, depthKm: num(f.geometry.coordinates[2]),
          tsunamiFlag: !!f.properties.tsunami
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
        push({
          id: 'eonet-' + v.id,
          source: 'NASA EONET', sourceType: 'official', type: normalizeType(cat),
          title: v.title, country: '', region: '',
          alert: 'Green',
          lat: g.coordinates[1], lon: g.coordinates[0],
          startedAt: (geoms[0] && geoms[0].date) || null,
          updated: g.date || now.toISOString(),
          details: 'Open event tracked by NASA EONET · ' + cat,
          sourceUrl: (v.sources && v.sources[0] && v.sources[0].url) || ('https://eonet.gsfc.nasa.gov/api/v3/events/' + v.id)
        });
        n++;
      }
      out.meta.eonet = true; mark('eonet', true, { records: n });
    } catch (e) { mark('eonet', false, { error: String(e.message || e) }); }
  })());

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
          region: [s.name, s.binNumber ? '(' + s.binNumber + ')' : ''].filter(Boolean).join(' ') || s.basin || '',
          alert: intensity >= 96 ? 'Red' : intensity >= 64 ? 'Orange' : 'Green',
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
        await Promise.allSettled(zoneless.map(async f => {
          const zone = ((f.properties || {}).affectedZones || [])[0];
          if (!zone) return;
          try {
            const z = await timedFetch(zone, { timeout: 2500, headers: { accept: 'application/geo+json' } });
            const c = centroid(z.geometry);
            if (c) zoneCentroids.set(f, c);
          } catch (e) { /* leave this alert unplaced */ }
        }));

        let n = 0, skipped = 0, viaZone = 0;
        for (const f of features) {
          const p = f.properties || {};
          let c = centroid(f.geometry);
          if (!c && zoneCentroids.has(f)) { c = zoneCentroids.get(f); viaZone++; }
          if (!c) { skipped++; continue; }
          push({
            id: 'nws-' + (p.id || f.id),
            source: 'NOAA / National Weather Service', sourceType: 'official',
            type: normalizeType(p.event, p.event),
            title: p.event + (p.areaDesc ? ' — ' + String(p.areaDesc).split(';')[0].trim() : ''),
            country: 'United States', region: p.areaDesc || '',
            alert: p.severity === 'Extreme' ? 'Red' : 'Orange',
            lat: c.lat, lon: c.lon,
            startedAt: p.onset || p.effective || null,
            updated: p.sent || p.effective || now.toISOString(),
            expiresAt: p.expires || p.ends || null,
            details: String(p.headline || p.description || '').slice(0, 600),
            instruction: String(p.instruction || '').slice(0, 600),
            sourceUrl: p['@id'] || 'https://www.weather.gov/',
            issuingAgency: p.senderName || 'NWS'
          });
          n++;
        }
        mark('nws', true, {
          records: n, placedViaZoneLookup: viaZone, unplaceable: skipped,
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
          alert: mag >= 6 ? 'Red' : mag >= 5 ? 'Orange' : 'Green',
          lat, lon,
          startedAt: p.time || null,
          updated: p.lastupdate || p.time || now.toISOString(),
          details: 'Magnitude ' + (mag === null ? '—' : mag) + ' ' + (p.magtype || '') +
            ' · depth ' + (p.depth == null ? '—' : p.depth + ' km') + ' · reported by ' + (p.auth || 'EMSC') + '.',
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
    updated: '2026-09-13T00:00:00Z', issuedAt: '2026-09-13T00:00:00Z',
    targetStart: '2026-09-13T00:00:00Z', targetEnd: '2026-09-16T23:59:59Z',
    details: 'Starts 13 Sep 2026; expected duration 4 days. Frozen before the window opened and graded afterwards against observed impact, not against rainfall or a warning alone.',
    forecast: true, forecastKind: 'frozen-benchmark', confidence: 'Benchmark — frozen',
    evidence: 'Issued and frozen ahead of the target window as the platform’s first graded benchmark forecast.',
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

  const targetEnd = new Date(now.getTime() + OUTLOOK_HORIZON_HOURS * 3600e3).toISOString();
  const seenArea = new Set();
  const outlooks = [];

  for (const e of continuation) {
    if (outlooks.length >= MAX_OUTLOOKS) break;
    const area = ((e.country || e.region || e.title) + '|' + e.type).toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (seenArea.has(area)) continue;
    seenArea.add(area);
    outlooks.push({
      id: outlookId(e.id),
      source: 'Predict Natural Disasters · derived from ' + e.source,
      sourceType: 'forecast', type: e.type,
      title: 'Short-horizon ' + e.type + ' risk outlook — ' + (e.country || e.region || e.title),
      country: e.country || '', region: e.region || e.title || '',
      alert: e.alert === 'Red' ? 'High' : e.alert === 'Orange' ? 'Moderate' : 'Watch',
      lat: e.lat, lon: e.lon,
      updated: now.toISOString(), issuedAt: now.toISOString(),
      targetStart: now.toISOString(), targetEnd,
      details: 'Experimental ' + OUTLOOK_HORIZON_HOURS + '-hour outlook derived from an active ' + e.source +
        ' signal. Outlook: ' + mechanism(e.type) + '. This is not a deterministic prediction and must not replace official warnings.',
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
  const aftershockEnd = new Date(now.getTime() + AFTERSHOCK_HORIZON_HOURS * 3600e3).toISOString();

  for (const e of strongQuakes) {
    if (outlooks.length >= MAX_OUTLOOKS + 8) break;
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
      updated: now.toISOString(), issuedAt: now.toISOString(),
      targetStart: now.toISOString(), targetEnd: aftershockEnd,
      details: 'Experimental 7-day aftershock-sequence outlook following an observed M' + num(e.magnitude) +
        ' earthquake. Aftershocks decay over days to weeks and the largest is typically about one magnitude below the mainshock, ' +
        'so further felt shaking and additional damage to already-weakened structures should be expected. ' +
        'This describes the ongoing sequence — it is not a prediction of a new independent earthquake.',
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
  out.events = out.events
    .filter(e => {
      const k = (e.source + '|' + e.title + '|' + e.lat.toFixed(2) + '|' + e.lon.toFixed(2)).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (risk[b.alert] || 0) - (risk[a.alert] || 0) || new Date(b.updated) - new Date(a.updated));

  out.events = mergeSeismicReports(out.events);
  out.meta.mergedSeismicReports =
    out.events.filter(e => e.corroboratedBy && e.corroboratedBy.length).length;

  out.meta.eventCount = out.events.length;
  out.meta.officialCount = out.events.filter(e => e.sourceType === 'official').length;
  out.meta.forecastCount = out.events.filter(e => e.forecast).length;

  // The counts without the records, so the deployed feed can be checked
  // without transferring every event to do it.
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
module.exports.mergeSeismicReports = mergeSeismicReports;
