'use strict';
/**
 * Per-event enrichment: everything a disaster detail page needs beyond the raw
 * feed record — when/where it started, who is exposed, live news coverage,
 * video reports, official situation reports, verified helplines, national
 * authorities and real donation links.
 *
 * CommonJS on purpose (see api/verified-support.js for why).
 */

const { supportFor, GLOBAL_RELIEF, GLOBAL_DIRECTORIES } = require('./verified-support.js');

const REFRESH_SECONDS = 300; // matches the 5-minute refresh cycle

/* ------------------------------------------------------------------ utils */

function decodeXml(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
function strip(s) {
  return decodeXml(String(s == null ? '' : s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function pick(tag, block) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? decodeXml(m[1]).trim() : '';
}
function cleanTitle(t) {
  // Google News appends " - Outlet"; keep the headline, the outlet is separate.
  return String(t || '').replace(/\s+-\s+[^-]{1,80}$/, '').trim();
}
function outletFromTitle(t) {
  const m = String(t || '').match(/\s+-\s+([^-]{1,80})$/);
  return m ? m[1].trim() : '';
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
function dedupe(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
async function getText(url, timeout, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 6500);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: Object.assign({
        'user-agent': 'PredictNaturalDisasters/2.0 (+https://predict-natural-disasters.anchit-tandon.com)',
        'accept-language': 'en'
      }, headers || {})
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}
async function getJson(url, timeout, headers) {
  return JSON.parse(await getText(url, timeout, Object.assign({ accept: 'application/json' }, headers || {})));
}

/* ------------------------------------------------------- news / reporting */

/**
 * Outlets with published editorial standards and corrections policies. Used
 * only to badge an item as an established newsroom — every item always shows
 * its own outlet name and a direct link so the reader can judge the source.
 */
const ESTABLISHED_OUTLETS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'afp.com', 'aljazeera.com', 'theguardian.com',
  'nytimes.com', 'washingtonpost.com', 'cnn.com', 'npr.org', 'abcnews.go.com', 'cbsnews.com',
  'nbcnews.com', 'dw.com', 'france24.com', 'euronews.com', 'skynews.com', 'independent.co.uk',
  'ft.com', 'economist.com', 'bloomberg.com', 'abc.net.au', 'sbs.com.au', 'cbc.ca', 'ctvnews.ca',
  'nhk.or.jp', 'japantimes.co.jp', 'kyodonews.net', 'straitstimes.com', 'channelnewsasia.com',
  'scmp.com', 'thehindu.com', 'ndtv.com', 'indianexpress.com', 'hindustantimes.com',
  'timesofindia.indiatimes.com', 'deccanherald.com', 'thequint.com', 'news18.com', 'pti.in',
  'dawn.com', 'thedailystar.net', 'kathmandupost.com', 'myrepublica.nagariknetwork.com',
  'onlinekhabar.com', 'vnexpress.net', 'tuoitrenews.vn', 'bangkokpost.com', 'nationthailand.com',
  'thejakartapost.com', 'antaranews.com', 'kompas.com', 'inquirer.net', 'rappler.com', 'gmanetwork.com',
  'philstar.com', 'reliefweb.int', 'un.org', 'who.int', 'ifrc.org', 'unicef.org', 'wfp.org',
  'noaa.gov', 'weather.gov', 'usgs.gov', 'nasa.gov', 'gdacs.org', 'copernicus.eu', 'metoffice.gov.uk',
  'bom.gov.au', 'jma.go.jp', 'pagasa.dost.gov.ph', 'bmkg.go.id', 'imd.gov.in', 'mausam.imd.gov.in'
];

function isEstablished(url, outlet) {
  const host = hostOf(url);
  if (host && ESTABLISHED_OUTLETS.some(d => host === d || host.endsWith('.' + d))) return true;
  const o = String(outlet || '').toLowerCase();
  return ['reuters', 'associated press', 'ap news', 'bbc', 'afp', 'al jazeera', 'the guardian',
    'reliefweb', 'united nations', 'unicef', 'ifrc', 'red cross', 'noaa', 'usgs', 'nasa']
    .some(x => o.includes(x));
}

function parseRss(xml, max) {
  const items = [...String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].slice(0, max || 24);
  return items.map(m => {
    const b = m[1];
    const rawTitle = strip(pick('title', b));
    const link = strip(pick('link', b));
    const outlet = strip(pick('source', b)) || outletFromTitle(rawTitle) || hostOf(link);
    return {
      title: cleanTitle(rawTitle) || rawTitle,
      link,
      outlet,
      publishedAt: strip(pick('pubDate', b)) || strip(pick('published', b)),
      summary: strip(pick('description', b)).slice(0, 320)
    };
  }).filter(x => x.title && x.link);
}

async function googleNews(query) {
  const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
  try { return parseRss(await getText(u), 24).map(x => Object.assign(x, { via: 'Google News' })); } catch (e) { return []; }
}

async function bingNews(query) {
  const u = 'https://www.bing.com/news/search?q=' + encodeURIComponent(query) + '&format=RSS';
  try { return parseRss(await getText(u), 20).map(x => Object.assign(x, { via: 'Bing News' })); } catch (e) { return []; }
}

/** UN OCHA ReliefWeb: authoritative situation reports, assessments and appeals. */
async function reliefwebReports(query, country) {
  const params = new URLSearchParams({
    appname: 'predict-natural-disasters',
    profile: 'list',
    limit: '12',
    'query[value]': [query, country].filter(Boolean).join(' ').slice(0, 240),
    'sort[]': 'date:desc'
  });
  try {
    const j = await getJson('https://api.reliefweb.int/v1/reports?' + params.toString());
    return (j.data || []).map(d => {
      const f = d.fields || {};
      return {
        title: f.title || 'ReliefWeb report',
        link: f.url || ('https://reliefweb.int/node/' + d.id),
        outlet: (f.source && f.source[0] && (f.source[0].shortname || f.source[0].name)) || 'ReliefWeb',
        publishedAt: (f.date && (f.date.created || f.date.original)) || '',
        summary: strip(f.body || '').slice(0, 320),
        via: 'ReliefWeb (UN OCHA)'
      };
    }).filter(x => x.title && x.link);
  } catch (e) { return []; }
}

async function youtubeVideos(query) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=CAI%253D';
  try {
    const html = await getText(url, 7000);
    const out = [];
    const re = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^"]{2,200})"/g;
    let m;
    while ((m = re.exec(html)) && out.length < 12) {
      out.push({
        id: m[1],
        title: decodeXml(m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"')),
        url: 'https://www.youtube.com/watch?v=' + m[1],
        thumbnail: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg'
      });
    }
    return dedupe(out, x => x.id);
  } catch (e) { return []; }
}

/* --------------------------------------------------------- place resolving */

/** Free, key-less reverse geocode so "where it originated" can name a city/state. */
async function resolvePlace(lat, lon) {
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
  const u = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
    encodeURIComponent(+lat) + '&longitude=' + encodeURIComponent(+lon) + '&localityLanguage=en';
  try {
    const j = await getJson(u, 5500);
    const admin = Array.isArray(j.localityInfo && j.localityInfo.administrative)
      ? j.localityInfo.administrative.map(a => a.name).filter(Boolean)
      : [];
    return {
      country: j.countryName || '',
      countryCode: j.countryCode || '',
      state: j.principalSubdivision || '',
      city: j.city || j.locality || '',
      locality: j.locality || '',
      continent: j.continent || '',
      administrativeChain: admin.slice(0, 6),
      resolvedBy: 'BigDataCloud reverse geocoding'
    };
  } catch (e) { return null; }
}

/* ------------------------------------------------------- hazard playbooks */

function hazardPlaybook(type) {
  const t = String(type || '').toLowerCase();
  const P = (distress, needs, risks, actions) => ({ distressGroups: distress, immediateNeeds: needs, secondaryRisks: risks, safetyActions: actions });

  if (/flood|inundat/.test(t)) return P(
    ['People in low-lying, riverbank and floodplain communities', 'Households cut off by damaged roads, bridges or washed-out tracks',
      'Children, older adults, pregnant women and people with disabilities', 'People in informal settlements and single-storey housing',
      'Farming households whose crops, seed stores and livestock are submerged', 'People dependent on wells or piped water now contaminated'],
    ['Evacuation, boat rescue and temporary shelter', 'Clean drinking water, water purification and sanitation',
      'Dry food, cooking fuel, essential medicines and hygiene kits', 'Restoration of road access, power and mobile communications',
      'Cash assistance and livelihood/livestock support'],
    ['Water-borne disease outbreaks from contaminated supplies', 'Secondary landslides on saturated slopes',
      'Bridge, embankment and road collapse days after peak water', 'Prolonged displacement and loss of the current harvest'],
    ['Move to higher ground before water rises; never drive or walk through moving floodwater',
      'Switch off electricity at the mains before water enters a building',
      'Boil or treat all drinking water until authorities confirm the supply is safe',
      'Follow the evacuation routes and shelter list published by the local authority']
  );

  if (/landslide|mudslide|slope|debris flow|lahar/.test(t)) return P(
    ['Residents living below or on unstable slopes and cut terrain', 'Remote mountain and valley communities with a single access road',
      'Travellers and drivers on exposed hill roads', 'Households already isolated by earlier slope or road failure',
      'Construction and quarry workers on cut slopes'],
    ['Search and rescue access and heavy lifting equipment', 'Emergency shelter away from the slope toe',
      'Road clearance, alternative transport and airlift where roads are severed', 'Trauma care, medical evacuation and communications restoration'],
    ['Repeat failures on the same slope after further rain', 'Landslide-dammed rivers that can breach suddenly',
      'Complete severance of supply routes to communities uphill'],
    ['Leave the area below an active or cracking slope immediately — do not return for belongings',
      'Treat new cracks, tilting trees/poles and sudden changes in stream flow as a warning sign',
      'Avoid hill roads during and immediately after heavy rainfall']
  );

  if (/cyclone|storm|hurricane|typhoon|tornado|wind/.test(t)) return P(
    ['Coastal, estuarine and low-lying communities exposed to storm surge', 'People in informal, lightweight or unreinforced housing',
      'Fishers, maritime workers and anyone at sea or on the shoreline', 'Children, older adults and people dependent on powered medical equipment',
      'People on small islands and in isolated coastal settlements'],
    ['Evacuation and storm-safe shelter before landfall', 'Emergency food, water and infant supplies for several days',
      'Power, water and telecommunications restoration', 'Medical care, search and rescue and debris clearance',
      'Emergency shelter materials and tarpaulins after roof loss'],
    ['Storm surge and coastal inundation, often the deadliest component', 'Inland river flooding and landslides from the rain band',
      'Extended power and communications loss', 'Contaminated water and post-storm disease risk'],
    ['Evacuate on the official instruction — surge, not wind, drives most deaths',
      'Shelter in the strongest interior room away from windows once travel is unsafe',
      'Stay sheltered during the eye; the second wind shift can be the more destructive one',
      'Never touch fallen power lines and treat all floodwater as electrified']
  );

  if (/wildfire|fire|bushfire|smoke/.test(t)) return P(
    ['Communities inside or immediately outside the active fire perimeter', 'People with asthma, COPD, heart disease or other respiratory conditions',
      'Older adults, infants and people with limited mobility', 'Outdoor and agricultural workers exposed to smoke',
      'Livestock owners and people unable to evacuate animals'],
    ['Evacuation, transport for people without vehicles and safe shelter', 'Air-quality protection, clean-air spaces and respirator masks',
      'Medical support for smoke inhalation and burns', 'Livestock evacuation, fodder and animal welfare support',
      'Emergency accommodation and cash support for displaced households'],
    ['Rapid wind-driven changes in fire direction', 'Hazardous air quality far downwind of the fire',
      'Power shut-offs, road closures and water contamination', 'Post-fire debris flows and slope instability in the next rains'],
    ['Leave early on the official warning rather than waiting to see the fire',
      'Keep windows and vents closed and stay indoors when smoke is heavy',
      'Follow the designated evacuation route only — do not improvise through unburnt bush']
  );

  if (/earthquake|seismic|quake/.test(t)) return P(
    ['People inside damaged, cracked or unreinforced buildings', 'Injured and mobility-limited residents unable to self-evacuate',
      'Communities on slopes or reclaimed/liquefiable ground', 'Coastal communities where a tsunami advisory applies',
      'Households displaced by structural damage and now sleeping outdoors'],
    ['Urban search and rescue and heavy lifting equipment', 'Trauma care, surgical capacity and medical supplies',
      'Temporary shelter, blankets, water and sanitation', 'Rapid structural safety assessment of homes, schools and hospitals',
      'Restoration of communications and route clearance'],
    ['Aftershocks bringing down already weakened structures', 'Fire from ruptured gas lines and damaged electrical systems',
      'Landslides, rockfall and soil liquefaction', 'Tsunami where the rupture is offshore and shallow'],
    ['Drop, cover and hold on during shaking; move away from the coast afterwards if near it',
      'Do not re-enter a damaged building until it has been assessed',
      'Expect aftershocks and keep exits clear',
      'Shut off gas if you smell or hear a leak']
  );

  if (/volcan|ash|eruption/.test(t)) return P(
    ['Communities inside or near the declared exclusion zone', 'People downwind and exposed to ashfall',
      'Farmers, livestock owners and those with ash-covered water sources', 'People with asthma and other respiratory conditions',
      'Communities in valleys exposed to lahars and pyroclastic flows'],
    ['Evacuation and shelter outside the exclusion zone', 'Respiratory protection, eye protection and clean water',
      'Ash clearance from roofs before collapse', 'Livestock, fodder and agricultural support',
      'Aviation and transport rerouting information'],
    ['Lahars (volcanic mudflows) triggered by rain on fresh ash', 'Roof collapse under accumulated wet ash',
      'Aviation and regional transport disruption', 'Long-term contamination of water and grazing land'],
    ['Stay outside the exclusion zone declared by the volcano observatory',
      'Wear a mask and goggles and keep indoors while ash is falling',
      'Clear ash from roofs safely before rain makes it heavy',
      'Avoid valleys and river channels draining the volcano']
  );

  if (/drought|water (stress|scarcity)|famine/.test(t)) return P(
    ['Water-insecure households and communities on failing sources', 'Smallholder farmers and pastoralists losing crops and livestock',
      'Children at risk of acute malnutrition', 'Women and girls walking further for water',
      'Communities dependent entirely on rain-fed agriculture'],
    ['Safe water access, trucking and borehole rehabilitation', 'Food assistance and treatment for acute malnutrition',
      'Livestock feed, veterinary support and destocking assistance', 'Cash transfers and livelihood protection',
      'Health and sanitation support as water quality falls'],
    ['Acute malnutrition, particularly in children under five', 'Distress migration and displacement',
      'Water-point conflict and loss of productive assets', 'Multi-season recovery long after the rains return'],
    ['Follow official water-rationing and distribution schedules',
      'Protect remaining seed and breeding livestock',
      'Seek nutrition screening for young children early rather than late']
  );

  if (/heat/.test(t)) return P(
    ['Outdoor, construction and agricultural workers', 'Older adults living alone and people with chronic illness',
      'Infants and young children', 'People without cooling, shade or reliable power', 'People experiencing homelessness'],
    ['Cooling centres and shaded public space', 'Drinking water distribution', 'Medical capacity for heat illness',
      'Reliable power for fans, cooling and medical equipment', 'Welfare checks on isolated residents'],
    ['Heat stroke and excess mortality, peaking days into the event', 'Power grid strain and outages',
      'Wildfire ignition risk', 'Water supply stress'],
    ['Stay out of the sun in the hottest hours and drink water before feeling thirsty',
      'Check on older neighbours and people living alone daily',
      'Never leave children or animals in a parked vehicle']
  );

  if (/tsunami/.test(t)) return P(
    ['Everyone in low-lying coastal zones and on beaches', 'People in coastal hospitals, schools and care facilities',
      'Fishers, port workers and people on boats near shore', 'Visitors unfamiliar with local evacuation routes'],
    ['Immediate vertical or inland evacuation', 'Search and rescue and emergency medical care',
      'Shelter, water and sanitation on high ground', 'Clear public information on when it is safe to return'],
    ['Later waves that are larger than the first', 'Strong and unpredictable harbour currents for many hours',
      'Debris, structural collapse and contaminated water'],
    ['Move inland and uphill immediately after strong or long shaking — do not wait for an official alert',
      'Stay away from the shoreline until the authority formally cancels the warning',
      'Follow the marked tsunami evacuation route']
  );

  return P(
    ['People directly inside the hazard footprint', 'Children, older adults, pregnant women and people with disabilities',
      'Displaced, isolated or cut-off households', 'People in fragile housing or without safe shelter'],
    ['Emergency shelter and evacuation support', 'Food, clean water and sanitation', 'Medical care and essential medicines',
      'Restoration of communications, power and transport'],
    ['Cascading infrastructure failure', 'Disrupted access for responders and supplies', 'Prolonged displacement'],
    ['Follow the instructions of the issuing authority and local emergency services',
      'Keep a charged phone, essential documents and medication ready',
      'Agree a meeting point and out-of-area contact with your household']
  );
}

/* ------------------------------------------------------------- the handler */

function readQuery(req) {
  if (req && req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url, 'https://local');
    const out = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch (e) { return {}; }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=' + REFRESH_SECONDS + ', stale-while-revalidate=900');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const q = readQuery(req);
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const title = str(q.title, 180);
  const country = str(q.country, 80);
  const type = str(q.type, 80);
  const region = str(q.region, 160);
  const updated = str(q.updated, 80);
  const lat = q.lat === undefined || q.lat === '' ? null : Number(q.lat);
  const lon = q.lon === undefined || q.lon === '' ? null : Number(q.lon);
  const isForecast = String(q.forecast || '') === 'true' || String(q.forecast || '') === '1';

  if (!title && !country && !type) {
    return res.status(400).json({ error: 'Missing event context', hint: 'Pass at least one of title, country or type.' });
  }

  const base = [title, type, country, region].filter(Boolean).join(' ').trim();
  const newsQuery = base + ' (disaster OR emergency OR flood OR earthquake OR cyclone OR storm OR wildfire OR landslide OR volcano OR relief)';
  const videoQuery = base + ' disaster news report';

  const [googleItems, bingItems, rwItems, videos, place] = await Promise.all([
    googleNews(newsQuery),
    bingNews(base + ' disaster'),
    reliefwebReports(title || type, country),
    youtubeVideos(videoQuery),
    resolvePlace(lat, lon)
  ]);

  const news = dedupe(
    [].concat(googleItems, bingItems),
    x => (x.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90)
  ).map(x => Object.assign({}, x, {
    outlet: x.outlet || hostOf(x.link) || 'News source',
    established: isEstablished(x.link, x.outlet)
  })).slice(0, 24);

  const situationReports = rwItems.slice(0, 12).map(x => Object.assign({}, x, { established: true }));

  const support = supportFor(country, region);
  const play = hazardPlaybook(type);

  const affectedRegions = dedupe([
    region,
    place && place.city,
    place && place.state,
    place && place.country,
    country
  ].filter(Boolean).map(x => String(x).trim()), x => x.toLowerCase());

  const originArea = [
    place && place.locality,
    place && place.city && place.city !== (place && place.locality) ? place.city : '',
    place && place.state,
    place && place.country
  ].filter(Boolean).join(', ') || region || country || 'Not supplied by the upstream source';

  const coordsOk = Number.isFinite(lat) && Number.isFinite(lon);

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    query: base,
    event: { title, type, country, region, updated: updated || null, lat: coordsOk ? lat : null, lon: coordsOk ? lon : null, forecast: isForecast },

    when: {
      reportedAt: updated || null,
      label: updated ? 'Latest timestamp supplied by the reporting source' : 'No timestamp supplied by the upstream source',
      note: 'Feed timestamps mark when the source last updated the record, which can be later than when the event began.'
    },

    where: {
      originArea,
      resolvedPlace: place,
      coordinates: coordsOk ? { lat, lon } : null,
      affectedRegions,
      affectedAreaText: affectedRegions.join(' · ') || 'Not supplied by the upstream source',
      mapLinks: coordsOk ? {
        openStreetMap: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=9/' + lat + '/' + lon,
        googleMaps: 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon,
        windy: 'https://www.windy.com/?' + lat + ',' + lon + ',7'
      } : null
    },

    distressGroups: play.distressGroups,
    immediateNeeds: play.immediateNeeds,
    secondaryRisks: play.secondaryRisks,
    safetyActions: play.safetyActions,

    news,
    situationReports,
    videos,

    helplines: {
      country: support.countryName || country || '',
      matched: support.matched,
      emergency: support.emergency,
      note: support.fallbackNote
    },
    authorities: support.authorities,
    supportGroups: support.nationalRelief,
    reliefGroups: isForecast ? [] : (support.globalRelief || GLOBAL_RELIEF),
    directories: support.directories || GLOBAL_DIRECTORIES,
    donationPolicy: isForecast
      ? 'This record is an experimental outlook, not a confirmed impact event. Donation prompts are withheld until meaningful impact is independently verified.'
      : 'Donation links point at the organisation’s own official domain. Confirm the organisation is running an appeal for this specific emergency before giving.',

    searches: {
      googleNews: 'https://news.google.com/search?q=' + encodeURIComponent(base),
      youtube: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(videoQuery),
      reliefweb: 'https://reliefweb.int/updates?search=' + encodeURIComponent(base),
      gdacs: 'https://www.gdacs.org/',
      ocha: 'https://www.unocha.org/',
      ifrc: 'https://www.ifrc.org/emergencies/all'
    },

    sources: [
      { name: 'Google News', role: 'Live press coverage aggregation', url: 'https://news.google.com/', items: googleItems.length },
      { name: 'Bing News', role: 'Secondary press coverage aggregation', url: 'https://www.bing.com/news', items: bingItems.length },
      { name: 'ReliefWeb (UN OCHA)', role: 'Official situation reports and humanitarian updates', url: 'https://reliefweb.int/', items: rwItems.length },
      { name: 'YouTube', role: 'Video and field reporting search', url: 'https://www.youtube.com/', items: videos.length },
      { name: 'BigDataCloud', role: 'Reverse geocoding of the source coordinates', url: 'https://www.bigdatacloud.com/', items: place ? 1 : 0 },
      { name: 'Verified support directory', role: 'National emergency numbers, authorities and relief organisations', url: 'https://www.ifrc.org/national-societies-directory', items: support.emergency.length + support.authorities.length }
    ],

    coverage: {
      refreshTarget: '5 minutes',
      scope: 'Every event in the live feed, worldwide',
      newsProviders: ['Google News', 'Bing News', 'ReliefWeb (UN OCHA)'],
      videoProviders: ['YouTube'],
      humanitarian: ['IFRC', 'UNICEF', 'WFP', 'UNHCR', 'UN Crisis Relief', 'MSF', 'Direct Relief', 'Save the Children', 'CARE', 'ReliefWeb', 'OCHA']
    },

    disclaimer: 'Distress groups, needs and safety actions are hazard-response guidance categories, not claims that every listed group is confirmed affected in this specific event. Only nationally published emergency numbers are shown; where none is stored the national authority link is shown instead and no number is guessed. News and video items are third-party reporting shown with their outlet and a direct link — verify against the official source before acting.'
  });
}

module.exports = handler;
module.exports.default = handler;
module.exports.hazardPlaybook = hazardPlaybook;
module.exports.parseRss = parseRss;
module.exports.isEstablished = isEstablished;
