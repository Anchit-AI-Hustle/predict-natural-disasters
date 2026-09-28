/*
 * Every acronym states its full form.
 *
 * The first time a term appears on a page it is written out in full with the
 * acronym in brackets -- "United States Geological Survey (USGS)" -- and later
 * occurrences stay short, which is the ordinary editorial convention and keeps
 * tables readable. Compass bearings, magnitude scales and state codes read
 * naturally in full, so those expand every time.
 *
 * This runs over the rendered text rather than at each of the thirty-odd places
 * that print a source name, so upstream titles are covered too and a new render
 * site cannot forget. Text node data is rewritten in place -- no nodes are
 * added -- so the observer below cannot retrigger on its own output.
 */
(function (root) {
  var installing = typeof window !== 'undefined' && window.document;
  if (installing && window.__pndGlossary) return;

  /* Written out once per page, then left short. Longest first: the alternation
     is tried in order, so "UN OCHA" must be offered before "UN". */
  /* Deliberately absent: SAR. It reads "search and rescue" in a humanitarian
     context but "Special Administrative Region" in the country list ("Hong Kong
     SAR China"), and this pass cannot tell them apart. The app spells out
     "search and rescue" in its own copy, so nothing is lost. */
  var ONCE = [
    ['NASA EONET', 'National Aeronautics and Space Administration Earth Observatory Natural Event Tracker'],
    ['UN OCHA', 'United Nations Office for the Coordination of Humanitarian Affairs'],
    ['GDACS', 'Global Disaster Alert and Coordination System'],
    ['USGS', 'United States Geological Survey'],
    ['NOAA', 'National Oceanic and Atmospheric Administration'],
    ['EONET', 'Earth Observatory Natural Event Tracker'],
    ['NASA', 'National Aeronautics and Space Administration'],
    ['EMSC', 'European-Mediterranean Seismological Centre'],
    ['NEIC', 'National Earthquake Information Center'],
    ['NCHMF', 'National Centre for Hydro-Meteorological Forecasting'],
    ['PAGASA', 'Philippine Atmospheric, Geophysical and Astronomical Services Administration'],
    ['UNICEF', 'United Nations Children’s Fund'],
    ['IFRC', 'International Federation of Red Cross and Red Crescent Societies'],
    ['OCHA', 'Office for the Coordination of Humanitarian Affairs'],
    ['CERF', 'Central Emergency Response Fund'],
    ['NDRF', 'National Disaster Response Force'],
    ['NDMA', 'National Disaster Management Authority'],
    ['NEOC', 'National Emergency Operations Centre'],
    ['BMKG', 'Meteorology, Climatology and Geophysical Agency of Indonesia'],
    ['WFP', 'World Food Programme'],
    ['WMO', 'World Meteorological Organization'],
    ['WHO', 'World Health Organization'],
    ['NWS', 'National Weather Service'],
    ['NHC', 'National Hurricane Center'],
    ['IMD', 'India Meteorological Department'],
    ['JMA', 'Japan Meteorological Agency'],
    ['IST', 'India Standard Time'],
    ['UTC', 'Coordinated Universal Time'],
    ['BCE', 'Before Common Era'],
    ['UN', 'United Nations'],
    ['AI', 'artificial intelligence']
  ];

  var BEARINGS = {
    N: 'north', S: 'south', E: 'east', W: 'west',
    NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west',
    NNE: 'north-north-east', ENE: 'east-north-east', ESE: 'east-south-east',
    SSE: 'south-south-east', SSW: 'south-south-west', WSW: 'west-south-west',
    WNW: 'west-north-west', NNW: 'north-north-west'
  };
  var MAGNITUDES = { mw: 'moment magnitude', mb: 'body-wave magnitude',
                     ml: 'local magnitude', ms: 'surface-wave magnitude' };
  /* Only codes that are not also ISO country codes. On a global hazard site
     "Berlin, DE", "New Delhi, IN" and "Toronto, CA" are countries, and rendering
     them as Delaware, Indiana and California is worse than leaving them short.
     Excluded for that reason: AL AR AZ CA CO DE GA ID IL IN KY LA MA MD ME MN MO
     MS MT NC NE PA PR SC SD TN VA VI. */
  var STATES = {
    AK: 'Alaska', CT: 'Connecticut', DC: 'District of Columbia', FL: 'Florida',
    HI: 'Hawaii', IA: 'Iowa', KS: 'Kansas', MI: 'Michigan', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', RI: 'Rhode Island', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia',
    WY: 'Wyoming'
  };;

  var spelled = {};                                   // terms currently written out on the page
  var onceRe = new RegExp('\\b(' + ONCE.map(function (p) { return p[0]; }).join('|') + ')\\b', 'g');
  var full = {};
  ONCE.forEach(function (p) { full[p[0]] = p[1]; });
  // A bearing only ever means a direction in "126 km NNE of ...".
  var bearingRe = new RegExp('\\b(' + Object.keys(BEARINGS).join('|') + ')\\s+of\\b', 'g');
  var scales = Object.keys(MAGNITUDES).join('|');
  // "Magnitude 6.5 mw" must not become "Magnitude 6.5 moment magnitude"; the
  // scale name replaces the generic word rather than trailing after it.
  /* Only expand a scale code that follows the word "magnitude". A bare
     "948 mb" is millibars of pressure, "30 ms" is milliseconds and "500 ml" is
     millilitres -- this feed publishes cyclone pressure in exactly that form,
     and the unanchored rule turned it into "94body-wave magnitude 8". */
  var magNamedRe = new RegExp('\\bMagnitude\\s+(\\d(?:\\.\\d+)?)\\s+(' + scales + ')\\b', 'g');
  // United States Geological Survey and EMSC titles lead with "M 6.5 - ...".
  var magPrefixRe = /\bM\s+(\d(?:\.\d+)?)/g;
  var capitalise = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  // A state code only ever follows a place name, as "Citrus, FL".
  var stateRe = new RegExp(',\\s(' + Object.keys(STATES).join('|') + ')\\b', 'g');

  /* The rules that read naturally in full, so they apply every time. Stateless,
     which is what lets a test expand an expected string without side effects. */
  function expandAlways(text) {
    return String(text)
      .replace(bearingRe, function (m, b) { return BEARINGS[b] + ' of'; })
      // "M 6.5 mw" becomes "Magnitude 6.5 mw" first, so the named rule then sees it.
      .replace(magPrefixRe, function (m, n) { return 'Magnitude ' + n; })
      .replace(magNamedRe, function (m, n, u) { return capitalise(MAGNITUDES[u]) + ' ' + n; })
      .replace(stateRe, function (m, s) { return ', ' + STATES[s]; });
  }

  /*
   * A run of capitals is a label, not prose.
   *
   * Field labels on this site are written in capitals and styled down - WHAT,
   * WHERE, SEVERITY / STATUS - and one of them is the question "WHO SAYS
   * THIS?". Measured on a phone, that label rendered as "World Health
   * Organization (WHO) SAYS THIS": the glossary had no way to tell the
   * English word from the agency, because in capitals there is nothing to
   * tell them apart by. Lower case already protected "who said so"; capitals
   * had the opposite effect and made every collision certain.
   *
   * The rule follows what this file already says about badges. A label is
   * short on purpose, the full form belongs in the prose underneath it, and
   * text with no lower-case letter in it offers no evidence that a token is
   * an acronym rather than a word being shouted. So it is left alone - which
   * also keeps an all-capitals heading from swallowing a line.
   */
  function isShouted(text) {
    return /[A-Z]/.test(text) && !/[a-z]/.test(text);
  }

  function rewrite(text) {
    var out = expandAlways(text);
    /* Notation is expanded either way - "M 6.5" is a magnitude in any case,
       and a bearing is a bearing - so the guard applies only to the acronym
       pass below, which is the one that has a word to confuse. */
    if (isShouted(out)) return out;
    return out.replace(onceRe, function (m, term, offset, whole) {
      if (spelled[term]) return m;
      /* The text already writes it out.
       *
       * A provider label is "GDACS (Global Disaster Alert and Coordination
       * System)" and expanding it produced "Global Disaster Alert and
       * Coordination System (GDACS) (Global Disaster Alert and Coordination
       * System)". Written the other way round - "Global Disaster Alert and
       * Coordination System (GDACS)" - it was worse: the bracketed rule
       * replaced the acronym with the full form and swallowed the very
       * acronym the brackets existed to introduce. Where the full form is
       * already present, the term has been introduced and nothing is
       * rewritten. */
      if (whole.toLowerCase().indexOf(full[term].toLowerCase()) >= 0) {
        spelled[term] = true;
        return m;
      }
      spelled[term] = true;
      // "ReliefWeb (UN OCHA)" should not become "ReliefWeb (... (UN OCHA))".
      var bracketed = whole.charAt(offset - 1) === '(' && whole.charAt(offset + m.length) === ')';
      return bracketed ? full[term] : full[term] + ' (' + term + ')';
    });
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, OPTION: 1 };
  /*
   * A badge is a label, not prose, and it is not where a term gets explained.
   *
   * Expanding the first "GDACS" on a page turned a source pill into "Global
   * Disaster Alert and Coordination System (GDACS)", and the first derived
   * outlook's pill into "Predict Natural Disasters \u00b7 derived from NOAA /
   * National Weather Service" - measured on a phone, that one wrapped across
   * two lines and broke mid-phrase, and the row of pills stopped reading as a
   * row. The full name is already on these pills as their title attribute and
   * is written out in the prose below them, so nothing is lost by leaving the
   * label short.
   */
  var LABEL = { risk: 1, badge: 1, source: 1, prov: 1, verdict: 1, provenance: 1,
    sev: 1, pill: 1, 'provenance-badge': 1,
    /* A map's credit line and its imagery caption are labels too. Expanded,
       "NASA" in the credits became "National Aeronautics and Space
       Administration (NASA)", and on a phone the attribution wrapped to three
       lines and ran under the caption above it. */
    'leaflet-control-attribution': 1, 'pnd-imagery-note': 1 };
  function isLabel(el) {
    if (!el || !el.classList) return false;
    for (var i = 0; i < el.classList.length; i++) if (LABEL[el.classList[i]]) return true;
    return false;
  }
  /* A card in a list is a label for the record behind it, and so is a
     heading. With acronyms written out there, the first card for each source
     became the longest thing on the page - "Experimental 5-day outlook derived
     from an active National Oceanic and Atmospheric Administration (NOAA)
     National Hurricane Center..." ran to 62 words on /live-map, and a list of
     mixed sources expanded one acronym per card until every card was a
     paragraph. Acronyms stay short there; the line at the end of the page
     says what each stands for, and prose everywhere else still writes them
     out. Bearings, magnitudes and state codes are still expanded: those read
     naturally in full wherever they are. */
  var SHORT_CLASSES = { card: 1, 'event-card': 1 };
  var SHORT_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1 };
  function keepsAcronymsShort(el) {
    if (!el || !el.classList) return false;
    if (SHORT_TAGS[el.tagName]) return true;
    for (var i = 0; i < el.classList.length; i++) if (SHORT_CLASSES[el.classList[i]]) return true;
    return false;
  }

  function walk(root) {
    if (!root || !root.ownerDocument && root.nodeType !== 9 && root.nodeType !== 1) return;
    var doc = root.ownerDocument || document;
    var walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
      acceptNode: function (node) {
        for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
          if (SKIP[p.tagName] || p.hasAttribute('data-keep-acronyms') || isLabel(p)) return 2 /* REJECT */;
        }
        return /[A-Za-z]/.test(node.data) ? 1 /* ACCEPT */ : 2;
      }
    });
    var node, pending = [];
    while ((node = walker.nextNode())) pending.push(node);
    for (var i = 0; i < pending.length; i++) {
      var short = false;
      for (var q = pending[i].parentNode; q && q.nodeType === 1; q = q.parentNode) {
        if (keepsAcronymsShort(q)) { short = true; break; }
      }
      var next = short ? expandAlways(pending[i].data) : rewrite(pending[i].data);
      if (next !== pending[i].data) pending[i].data = next;   // in place: adds no nodes
    }
  }

  /*
   * Which terms are written out *right now*. These pages re-render their panels
   * on a timer, and an innerHTML assignment throws away the expansion already
   * made -- so a flag saying "we expanded this once" leaves the short form on
   * screen with its full form nowhere on the page. Re-derive from the document
   * instead, so a term is expanded again whenever a re-render has removed it.
   */
  function refreshSpelled() {
    var text = document.body ? document.body.textContent : '';
    spelled = {};
    for (var i = 0; i < ONCE.length; i++) {
      var acronym = ONCE[i][0], full = ONCE[i][1];
      var atFull = text.indexOf(full);
      if (atFull === -1) continue;
      // The full form has to come first. A card headed "WMO" above a paragraph
      // that happens to spell it out still shows the reader an acronym before
      // its definition, so that heading is expanded rather than left short.
      var atAcronym = text.search(new RegExp('\\b' + acronym + '\\b'));
      if (atAcronym === -1 || atFull <= atAcronym) spelled[acronym] = true;
    }
  }

  /*
   * The acronyms that only ever appear inside a label, written out once.
   *
   * Leaving a badge short is right - it is a label, not prose - but a reader
   * who has only ever seen "GDACS" in a pill has not been told what it is,
   * and on /alerts and /calamities that was every source on the page. So the
   * page states them itself, in one line at the end of the content, built
   * from what is actually on it rather than from a fixed list: no source that
   * is not shown is named, and nothing has to be maintained per page.
   */
  var NOTE_ID = 'pnd-acronym-note';
  /* The words a reader can see, not the page's source. body.textContent
     carries every inline <script> as well, so code on the page was read as
     if it were prose. */
  var UNREAD = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  /* A label in capitals counts only when it is made of acronyms, like a
     "GDACS" badge. "WHO SAYS THIS" is a question in capitals, and reading it
     as the agency printed "WHO stands for World Health Organization" under
     a page that never mentions it (see isShouted above). */
  var ACRONYM_WORDS = {};
  ONCE.forEach(function (p) { p[0].split(' ').forEach(function (w) { ACRONYM_WORDS[w] = 1; }); });
  function shoutedPhrase(text) {
    if (!isShouted(text)) return false;
    var words = text.match(/[A-Z]{2,}/g) || [];
    for (var i = 0; i < words.length; i++) if (!ACRONYM_WORDS[words[i]]) return true;
    return false;
  }
  function readableText(skip) {
    var parts = [];
    var walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */, {
      acceptNode: function (node) {
        for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
          if (UNREAD[p.tagName] || p === skip) return 2 /* REJECT */;
        }
        return shoutedPhrase(node.data) ? 2 /* REJECT */ : 1 /* ACCEPT */;
      }
    });
    var node;
    while ((node = walker.nextNode())) parts.push(node.data);
    return parts.join(' ');
  }
  function noteLabelAcronyms() {
    if (typeof document === 'undefined' || !document.body) return;
    var note = document.getElementById(NOTE_ID);
    /* The note's own text does not count as the page stating the full form.
       Without this it does: the note appears, the next pass sees every full
       form present, removes it, the pass after that adds it back, and the
       observer runs between the two for ever. */
    var text = readableText(note);
    var wanted = [];
    for (var i = 0; i < ONCE.length; i++) {
      var term = ONCE[i][0], full = ONCE[i][1];
      /* On the page as a word of its own, and its full form nowhere on it.
         A bare substring test defined "UN" on every page headed "PAGE NOT
         FOUND" and "AI" wherever a label read "DETAILS". */
      if (!new RegExp('\\b' + term + '\\b').test(text)) continue;
      if (text.indexOf(full) >= 0) continue;
      /* Longest first, so a term already covered by one being written out -
         "OCHA" inside "UN OCHA" - is not repeated. */
      var covered = false;
      for (var j = 0; j < wanted.length; j++) if (wanted[j][0].indexOf(term) >= 0) covered = true;
      if (!covered) wanted.push([term, full]);
    }
    if (!wanted.length) { if (note) note.remove(); return; }
    /* "stands for" rather than "is the": the list holds proper names and
       common nouns alike, and "AI is the artificial intelligence" is not a
       sentence. */
    var say = wanted.map(function (w) { return w[0] + ' stands for ' + w[1] + '.'; }).join(' ');
    if (!note) {
      note = document.createElement('p');
      note.id = NOTE_ID;
      note.className = 'muted';
      note.setAttribute('data-keep-acronyms', '');
      note.style.cssText = 'font-size:11px;line-height:1.5;margin:10px 16px 18px;max-width:80ch';
      var host = document.querySelector('main') || document.body;
      host.appendChild(note);
    }
    if (note.textContent !== say) note.textContent = say;
  }

  function pass() {
    refreshSpelled();
    walk(document.body);
    noteLabelAcronyms();
  }

  /** Does this mutation carry any text worth looking at? */
  function carriesText(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if ((n.nodeType === 1 || n.nodeType === 3) && /[A-Za-z]/.test(n.textContent || '')) return true;
    }
    return false;
  }

  function start() {
    pass();
    /* Mutations arrive in batches, so one pass per batch rather than per node --
       but a full pass reads the whole document, and Leaflet adds and removes
       tile <img> elements continuously while the map is panned. Those carry no
       text, so skipping them keeps the map's animation off this path. */
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (carriesText(muts[i].addedNodes)) { pass(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  var api = { rewrite: rewrite, expandAlways: expandAlways, ONCE: ONCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!installing) return;
  window.__pndGlossary = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(this);
