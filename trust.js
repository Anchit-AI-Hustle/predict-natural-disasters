/* What a visitor needs before trusting anything on a page: that this is an
 * experimental project and not a warning service, where the real warnings
 * come from, which public data the page is built from, and how old that data
 * is.
 *
 * Loaded in <head> on every page, before any page script, so it can see the
 * page's own requests for data. It never asks for data itself: the time it
 * shows is the one carried by the response the page actually rendered, so the
 * note and the page cannot disagree, and the visitor's clock is never shown as
 * if it were the data's time.
 *
 * The page says which data it is built from on its own script tag:
 *
 *   <script src="/trust.js" data-trust="feed models place"></script>
 *
 *   feed    /api/events: the eight providers in api/events.js, and the
 *           Open-Meteo geocoder that places ReliefWeb's country-level records
 *   models  the daily weather-model run (tools/run-models.js): Open-Meteo's
 *           forecast and NASA POWER's 30-year record
 *   place   the place search (place-search.js): OpenStreetMap Nominatim
 *   ledger  the recorded track record (data/*.json): what was recorded from
 *           the feed, NASA POWER, and Open-Meteo's archived forecasts
 *
 * No data-trust at all is a page with no prediction or risk on it: it gets
 * the footer, and no note at the top.
 *
 * The note itself is in each page's HTML, written there by
 * tools/trust-markup.js from noteHtml() below, and styled by trust.css in the
 * page's <head>. Added by script after the page had drawn, it moved every
 * page down by its own height (layout shift 0.12 to 0.39 on a phone) and
 * became the largest thing on the first screen. This file only fills in the
 * two parts that depend on the data: the update time and the source list.
 * test/trust.test.js keeps every page's copy identical to noteHtml().
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var SITE = 'https://predict-natural-disasters.anchit-tandon.com';

  /* Where the real warnings come from, for the places this site covers most:
     India, the United States (where two of its providers publish only), and
     everywhere through GDACS. Everyone else is pointed at their own national
     service through the WMO's list of members rather than at a guess. The WMO
     is named only in the link's title: it is a directory, not a data source,
     and no page may read as if it were one (test/sources.test.js). */
  var OFFICIAL = [
    { region: 'India', agencies: [
      { name: 'IMD', full: 'India Meteorological Department', url: 'https://mausam.imd.gov.in/' },
      { name: 'NDMA', full: 'National Disaster Management Authority', url: 'https://ndma.gov.in/' }] },
    { region: 'United States', agencies: [
      { name: 'NWS', full: 'NOAA National Weather Service', url: 'https://www.weather.gov/' },
      { name: 'USGS', full: 'United States Geological Survey', url: 'https://earthquake.usgs.gov/' }] },
    { region: 'Worldwide', agencies: [
      { name: 'GDACS', short: 'GDACS', full: 'Global Disaster Alert and Coordination System', url: 'https://www.gdacs.org/' }] }
  ];
  /* The WMO's own list of members' national weather services, each linked.
     Its old governance page now redirects to a page with no list on it. */
  var WMO = { full: 'national weather services listed by the WMO', url: 'https://worldweather.wmo.int/en/members.html' };

  /* Only what the code reads. `key` is the provider's key in the feed's
     meta.sources, where it has one, so its status comes from the feed, and
     `feed` the source names its records carry, so a page can find them. */
  var SOURCES = {
    feed: [
      { key: 'gdacs', feed: ['GDACS'], name: 'GDACS', short: 'GDACS', url: 'https://www.gdacs.org/',
        adds: 'Alerts for earthquakes, tropical cyclones, floods, droughts, wildfires and volcanoes worldwide, with impact figures.' },
      { key: 'usgs', feed: ['USGS'], name: 'USGS Earthquake Hazards Program', short: 'USGS', url: 'https://earthquake.usgs.gov/',
        adds: 'Every earthquake of magnitude 2.5 or more in the past 7 days, and the shocks the 7-day aftershock outlooks follow.' },
      { key: 'emsc', feed: ['EMSC'], name: 'EMSC', short: 'EMSC', url: 'https://www.emsc-csem.org/',
        adds: 'An independent check on earthquakes of magnitude 4.5 or more.' },
      { key: 'eonet', feed: ['NASA EONET'], name: 'NASA EONET', short: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/',
        adds: 'Wildfires, storms, volcanoes and other events seen from satellites.' },
      { key: 'nhc', feed: ['NOAA National Hurricane Center', 'National Hurricane Center'], name: 'NOAA National Hurricane Center', short: 'NOAA NHC', url: 'https://www.nhc.noaa.gov/',
        adds: 'Active tropical cyclones in the Atlantic and eastern and central Pacific only.' },
      { key: 'nws', feed: ['NOAA / National Weather Service', 'NOAA National Weather Service', 'National Weather Service'], name: 'NOAA National Weather Service', short: 'NOAA NWS', url: 'https://www.weather.gov/',
        adds: 'Severe and extreme weather warnings in the United States.' },
      { key: 'reliefweb', feed: ['ReliefWeb (UN OCHA)', 'ReliefWeb'], name: 'ReliefWeb (UN OCHA)', short: 'ReliefWeb', url: 'https://reliefweb.int/',
        adds: 'Humanitarian disaster declarations, by country.' },
      { key: 'usgs_volcano', feed: ['USGS Volcano Hazards Program'], name: 'USGS Volcano Hazards Program', short: 'USGS Volcanoes', url: 'https://www.usgs.gov/programs/VHP',
        adds: 'US-monitored volcanoes at a raised alert level.' },
      { name: 'Open-Meteo Geocoding', short: 'Open-Meteo', url: 'https://open-meteo.com/en/docs/geocoding-api',
        adds: 'Places ReliefWeb’s country-level records, which carry no coordinates, at their country.' }
    ],
    models: [
      { model: true, name: 'Open-Meteo Forecast API', short: 'Open-Meteo', url: 'https://open-meteo.com/',
        adds: 'The coming week’s temperature, rain, dew point and wind that the heat, rain and fire-weather forecasts start from.' },
      { model: true, name: 'NASA POWER', short: 'NASA POWER', url: 'https://power.larc.nasa.gov/',
        adds: 'Each place’s 30-year record (1996 to 2025) a forecast is judged against, and the measured days it is graded on.' }
    ],
    place: [
      { name: 'OpenStreetMap Nominatim', short: 'OpenStreetMap', url: 'https://nominatim.openstreetmap.org/',
        adds: 'Finds the place you type, so nearby reports can be measured from it.' }
    ],
    ledger: [
      { name: 'The live feed, as recorded', short: 'Recorded live feed', url: '/resources',
        adds: 'What GDACS, USGS, EMSC, NASA EONET, NOAA and ReliefWeb reported, kept with each run so every forecast can be checked against what happened.' },
      { name: 'NASA POWER', short: 'NASA POWER', url: 'https://power.larc.nasa.gov/',
        adds: 'The measured weather each weather forecast is graded against.' },
      { name: 'Open-Meteo Previous Runs API', short: 'Open-Meteo', url: 'https://open-meteo.com/en/docs/previous-runs-api',
        adds: 'Forecasts really issued 3 and 5 days ahead, used to test the method on the past.' }
    ]
  };

  var me = document.currentScript;
  var groups = String((me && me.getAttribute('data-trust')) || '').split(/\s+/).filter(function (g) { return SOURCES[g]; });

  /* -------------------------------------------------- what the page fetched */

  /* `ledger` is the track record's own last-written time, handed over by the
     page that read it (recorded() below) rather than read again here: its
     files are 5 MB of JSON, and parsing them a second time cost a phone over
     a second of a main thread that was already blocked. */
  var state = { feed: null, feedFailed: false, ledger: undefined };

  function take(path, d) {
    if (!d || typeof d !== 'object') return;
    if (path === '/api/events') {
      /* Only the feed itself: a detail page also asks for ?ledger=1, which
         carries a generatedAt of its own but no provider statuses, and taking
         it would show a time for data the page did not render. The latest
         feed the page received is the one it drew, so it always wins. */
      if (!d.generatedAt || !d.meta || !d.meta.sources) return;
      state.feed = { generatedAt: d.generatedAt, meta: d.meta || {} };
      state.feedFailed = false;
    }
    render();
  }

  var realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (input) {
      var p = realFetch.apply(this, arguments);
      var path = '';
      try {
        var raw = typeof input === 'string' ? input : (input && input.url) || '';
        path = raw.split('#')[0].split('?')[0].replace(/^[a-z]+:\/\/[^/]+/i, '');
      } catch (e) { path = ''; }
      var failed = function () {
        if (!state.feed) state.feedFailed = true;
        render();
      };
      if (path === '/api/events') {
        p.then(function (r) {
          if (!r || !r.ok) { failed(); return; }
          /* A clone, so the page still reads the body it asked for. */
          var copy = typeof r.clone === 'function' ? r.clone() : r;
          if (copy && typeof copy.json === 'function') copy.json().then(function (d) { take(path, d); }, failed);
        }, failed);
      }
      return p;
    };
  }

  /* ------------------------------------------------------------- formatting */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* The visitor's own time zone, named, because "3:08 PM" alone is a
     different moment in every reader's zone. */
  function chosenZone() {
    /* A zone the visitor picked in the header, so the note and the page
       write one moment the same way; otherwise the visitor's own. */
    try { return localStorage.getItem('pnd_timezone') || undefined; } catch (e) { return undefined; }
  }
  function when(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    /* The page's own formatter where the page has one, so the note and the
       status line beside it write one moment one way. */
    var P = window.PND;
    if (P && typeof P.fmtDate === 'function') {
      return '<time datetime="' + esc(d.toISOString()) + '" title="' + esc(d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC') + '">' + esc(P.fmtDate(d.toISOString())) + '</time>';
    }
    var text, opts = { day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    var tz = chosenZone();
    try {
      text = d.toLocaleString(undefined, tz ? Object.assign({ timeZone: tz }, opts) : opts);
    } catch (e) { text = d.toString(); }
    return '<time datetime="' + esc(d.toISOString()) + '" title="' + esc(d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC') + '">' + esc(text) + '</time>';
  }

  function link(a, label) {
    return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener" title="' + esc(a.full || a.name) + '">' + esc(label || a.name) + '</a>';
  }

  function agencyLine() {
    return OFFICIAL.map(function (r) {
      return r.agencies.map(function (a) { return link(a); }).join(' and ') + ' ' + (r.region === 'Worldwide' ? 'worldwide' : 'in ' + (r.region === 'United States' ? 'the US' : r.region));
    }).join(', ');
  }

  /* --------------------------------------------------------------- the note */

  function listOf(gs) {
    var out = [];
    gs.forEach(function (g) { SOURCES[g].forEach(function (s) { out.push(s); }); });
    return out;
  }

  function statusOf(s) {
    var m = state.feed && state.feed.meta;
    if (s.key && m) {
      var src = m.sources && m.sources[s.key];
      var scan = m.scan && Array.isArray(m.scan.providers) ? m.scan.providers.filter(function (p) { return p.provider === s.key; })[0] : null;
      if (!src) return '';
      var bits = [src.ok ? '<span class="trust-ok">answered</span>' : '<span class="trust-down">not answering</span>'];
      if (scan && scan.dataFreshness) bits.push('newest record ' + when(scan.dataFreshness));
      return bits.join(' · ');
    }
    if (s.model && m && m.modelRun && m.modelRun.at) return 'used in the run of ' + when(m.modelRun.at);
    return '';
  }

  function updatedLine() {
    var bits = [];
    var f = state.feed;
    if (groups.indexOf('feed') >= 0) {
      if (f) {
        var m = f.meta || {};
        bits.push('Live data from the agencies ' + when(f.generatedAt) +
          (m.live === false ? ' (they were not answering, so saved copies are shown)' : ''));
      } else if (state.feedFailed) {
        bits.push('The live data did not load, so no update time can be shown');
      } else {
        bits.push('Live data: loading…');
      }
    }
    if (groups.indexOf('models') >= 0 && f && f.meta && f.meta.modelRun) {
      var mr = f.meta.modelRun;
      if (mr.at) bits.push('weather models run ' + when(mr.at) + (mr.served ? '' : ' (over 36 hours ago, so their forecasts are not shown)'));
    }
    if (groups.indexOf('ledger') >= 0) {
      bits.push(state.ledger ? 'Track record last recorded ' + when(state.ledger)
        : state.ledger === null ? 'The track record did not load, so no update time can be shown'
          : 'Track record: loading…');
    }
    return bits.join(' · ');
  }

  function itemsHtml(gs) {
    return listOf(gs).map(function (s) {
        var st = statusOf(s);
        var external = /^https?:/.test(s.url);
        return '<li><a href="' + esc(s.url) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.name) + '</a>' +
          (st ? ' <span class="trust-st">' + st + '</span>' : '') + '<br><span class="trust-adds" data-keep-acronyms>' + esc(s.adds) + '</span></li>';
    }).join('');
  }

  /* The note as it stands before any data has arrived: what every page
     carries in its HTML. Sized for that state too, so filling it in does not
     move what follows (trust.css reserves the update line's height). */
  function noteHtml(gs) {
    var short = [];
    listOf(gs).forEach(function (s) { if (short.indexOf(s.short) < 0) short.push(s.short); });
    var loading = gs.indexOf('feed') >= 0 ? 'Live data: loading…' : 'Track record: loading…';
    /* Named, not counted: one organisation can supply two datasets, so a
       count beside the names never matched them. */
    return '<aside class="trust" aria-label="About this information" data-keep-acronyms>' +
      '<p class="trust-warn"><span class="trust-ico" aria-hidden="true">i</span><span><b>Experimental model, not an official warning.</b> ' +
      'For real alerts, follow your national agency: ' + agencyLine() + '.</span></p>' +
      '<p class="trust-when" data-trust-when>' + loading + '</p>' +
      '<details class="trust-src"><summary>Data sources: ' + esc(short.join(', ')) + '</summary>' +
      '<ul data-trust-sources>' + itemsHtml(gs) + '</ul>' +
      '<p class="trust-more">What each source can and cannot see: <a href="/resources">Our sources</a> · <a href="/methodology">How it works</a></p></details></aside>';
  }

  var box = null;
  function render() {
    if (!box) return;
    /* Rebuilt only when something it says has changed: the feed is polled
       every minute, and replacing an unchanged list took keyboard focus out
       of it each time. */
    var u = box.querySelector('[data-trust-when]'), line = updatedLine();
    if (u && u.__html !== line) { u.innerHTML = line; u.__html = line; }
    var holder = box.querySelector('[data-trust-sources]'), items = itemsHtml(groups);
    if (holder && holder.__html !== items) { holder.innerHTML = items; holder.__html = items; }
  }

  function note() {
    if (!groups.length) return;
    box = document.querySelector('.trust');
    if (box) { render(); return; }
    /* A page whose HTML lost its copy still gets one, late, rather than none. */
    /* A page whose prediction sits above <main> - the homepage answers "is
       this place at risk" in its hero - names where the note goes instead. */
    var after = me && me.getAttribute('data-trust-after');
    var anchor = after ? document.querySelector(after) : null;
    var main = document.querySelector('main') || document.body;
    if (!main) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = noteHtml(groups);
    box = tmp.firstChild;
    if (anchor) anchor.insertAdjacentElement('afterend', box);
    else main.insertBefore(box, main.firstChild);
    render();
  }

  /* ------------------------------------------------------------- the footer */

  function footerHtml() {
    /* Names already written out (data-keep-acronyms): the glossary expanded
       "USGS" a second time right after the agency's full name, so the footer
       named the same agency twice in a row (launch audit A22). */
    return '<div class="trust-foot" data-keep-acronyms><p><b>This is an experimental model, not an official warning service.</b> ' +
      'For real alerts and what to do in an emergency, follow your national meteorological or disaster agency:</p><ul>' +
      OFFICIAL.map(function (r) {
        return '<li><span>' + esc(r.region) + ':</span> ' + r.agencies.map(function (a) {
          return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.full) + ' (' + esc(a.name) + ')</a> <small>' +
            esc(a.url.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</small>';
        }).join(', ') + '</li>';
      }).join('') +
      '<li><span>Elsewhere:</span> <a href="' + esc(WMO.url) + '" target="_blank" rel="noopener" title="' + esc(WMO.full) + '">find your country’s national weather service</a>.</li>' +
      '</ul></div>';
  }

  function footer() {
    if (document.querySelector('.trust-foot')) return;
    var foot = document.querySelector('footer.sitefoot') || document.querySelector('.seo-nav');
    if (!foot) {
      foot = document.createElement('footer');
      foot.className = 'sitefoot';
      foot.setAttribute('aria-label', 'More of this site');
      document.body.appendChild(foot);
    }
    /* The one-line disclaimer this replaces, so the footer says it once. */
    Array.prototype.forEach.call(foot.querySelectorAll('p'), function (p) {
      if (/not an official warning service/i.test(p.textContent)) p.remove();
    });
    foot.insertAdjacentHTML('beforeend', footerHtml());
  }

  /* -------------------------------------------------------------- canonical */

  /* A record's page is served from one template, and the template's own
     canonical named the template: every /disasters/<id> page told a search
     engine it was /event-detail. Each record now names its own address. */
  var PRETTY = /^\/(disasters|calamities|alerts|forecasts|regions|locations|hazards|history|sources)\/[^/]+\/?$/;
  var TEMPLATES = {
    'event-detail': ['disasters', 'id'], 'calamity-detail': ['calamities', 'id'], 'alert-detail': ['alerts', 'id'],
    'forecast-detail': ['forecasts', 'id'], 'region-detail': ['regions', 'region'], 'location-detail': ['locations', 'location'],
    'hazard-detail': ['hazards', 'type'], 'historical-event-detail': ['history', 'id'], 'source-detail': ['sources', 'source']
  };
  function canonical() {
    /* The not-found page answers any address; it must not claim one. */
    if (document.querySelector('meta[name="robots"][content*="noindex"]')) return;
    var path = location.pathname, url = '';
    if (PRETTY.test(path)) url = SITE + path.replace(/\/$/, '');
    else {
      var t = TEMPLATES[path.replace(/^\//, '').replace(/\.html$/, '')];
      var v = t && new URLSearchParams(location.search).get(t[1]);
      if (v) url = SITE + '/' + t[0] + '/' + encodeURIComponent(v);
    }
    if (!url) return;
    var c = document.querySelector('link[rel="canonical"]');
    if (!c) { c = document.createElement('link'); c.rel = 'canonical'; document.head.appendChild(c); }
    c.href = url;
    var og = document.querySelector('meta[property="og:url"]');
    if (og) og.setAttribute('content', url);
  }

  /* After the page's own start-up, which builds the shared footer this adds
     to: the page's scripts sit at the end of <body>, so their DOMContentLoaded
     handlers were registered after this one. */
  function start() { canonical(); note(); setTimeout(footer, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.PNDTrust = { OFFICIAL: OFFICIAL, SOURCES: SOURCES, groups: groups, state: state, when: when, noteHtml: noteHtml,
    /* The track record page hands over the time its records were last
       written, or null when none could be read. */
    recorded: function (iso) { state.ledger = iso || null; render(); } };
})();
