/*
 * One name for each country, wherever the site groups or counts by country.
 *
 * The providers spell the same country several ways. Measured on the live
 * feed of 29 October 2026, /regions listed Mexico, México and MX as three
 * places, Iran beside Islamic Republic of Iran, Myanmar beside Burma
 * (Myanmar), and Japan beside Japan region and Japan Region, each with its own
 * share of the count. USGS also names ocean features where a country would go
 * ("Reykjanes Ridge", "South of Fiji Islands"), and those were listed as
 * places too.
 *
 * canonical(name) is the one spelling for a country name or one of its
 * aliases, or '' when the name is not a country we know. place(names) turns a
 * record's list of names into its countries, with any ocean feature moved out
 * into `sea`. countryCount(list) is the one count of countries, used by every
 * page and by the feed, so the figures agree.
 *
 * Loaded as a plain script in the browser (window.PNDCountries) and with
 * require() in Node (api/events.js).
 */
(function (root) {
  'use strict';

  /* Spellings of one country, all mapped to the name we show. Lower-cased keys. */
  var ALIASES = {
    'mx': 'Mexico', 'méxico': 'Mexico', 'mexico': 'Mexico',
    'us': 'United States', 'u.s.': 'United States', 'usa': 'United States', 'u.s.a.': 'United States',
    'united states of america': 'United States', 'united states': 'United States',
    'uk': 'United Kingdom', 'great britain': 'United Kingdom', 'britain': 'United Kingdom',
    'united kingdom of great britain and northern ireland': 'United Kingdom',
    'iran': 'Iran', 'islamic republic of iran': 'Iran', 'iran, islamic republic of': 'Iran', 'iran (islamic republic of)': 'Iran',
    'myanmar': 'Myanmar', 'burma': 'Myanmar', 'burma (myanmar)': 'Myanmar', 'myanmar (burma)': 'Myanmar',
    'russia': 'Russia', 'russian federation': 'Russia',
    'vietnam': 'Vietnam', 'viet nam': 'Vietnam',
    'laos': 'Laos', 'lao pdr': 'Laos', "lao people's democratic republic": 'Laos',
    'syria': 'Syria', 'syrian arab republic': 'Syria',
    'south korea': 'South Korea', 'korea, republic of': 'South Korea', 'republic of korea': 'South Korea',
    'north korea': 'North Korea', "democratic people's republic of korea": 'North Korea', 'dprk': 'North Korea',
    "korea, democratic people's republic of": 'North Korea',
    'tanzania': 'Tanzania', 'united republic of tanzania': 'Tanzania', 'tanzania, united republic of': 'Tanzania',
    'bolivia': 'Bolivia', 'bolivia (plurinational state of)': 'Bolivia', 'plurinational state of bolivia': 'Bolivia',
    'venezuela': 'Venezuela', 'venezuela (bolivarian republic of)': 'Venezuela', 'bolivarian republic of venezuela': 'Venezuela',
    'moldova': 'Moldova', 'republic of moldova': 'Moldova', 'moldova, republic of': 'Moldova',
    'brunei': 'Brunei', 'brunei darussalam': 'Brunei',
    'türkiye': 'Türkiye', 'turkiye': 'Türkiye', 'turkey': 'Türkiye',
    'czechia': 'Czechia', 'czech republic': 'Czechia',
    'cabo verde': 'Cabo Verde', 'cape verde': 'Cabo Verde',
    "côte d'ivoire": "Côte d'Ivoire", "cote d'ivoire": "Côte d'Ivoire", 'ivory coast': "Côte d'Ivoire",
    'timor-leste': 'Timor-Leste', 'timor leste': 'Timor-Leste', 'east timor': 'Timor-Leste',
    'north macedonia': 'North Macedonia', 'macedonia': 'North Macedonia', 'the republic of north macedonia': 'North Macedonia',
    'republic of north macedonia': 'North Macedonia',
    'bosnia and herzegovina': 'Bosnia and Herzegovina', 'bosnia & herzegovina': 'Bosnia and Herzegovina', 'bosnia and herz.': 'Bosnia and Herzegovina',
    'eswatini': 'Eswatini', 'swaziland': 'Eswatini',
    'democratic republic of the congo': 'Democratic Republic of the Congo', 'democratic republic of congo': 'Democratic Republic of the Congo',
    'dem. rep. congo': 'Democratic Republic of the Congo', 'dr congo': 'Democratic Republic of the Congo', 'drc': 'Democratic Republic of the Congo',
    'congo-kinshasa': 'Democratic Republic of the Congo', 'congo, the democratic republic of the': 'Democratic Republic of the Congo',
    'republic of the congo': 'Republic of the Congo', 'republic of congo': 'Republic of the Congo', 'congo': 'Republic of the Congo',
    'congo-brazzaville': 'Republic of the Congo',
    'central african rep.': 'Central African Republic', 'dominican rep.': 'Dominican Republic',
    'eq. guinea': 'Equatorial Guinea', 'falkland is.': 'Falkland Islands', 's. sudan': 'South Sudan',
    'solomon is.': 'Solomon Islands', 'w. sahara': 'Western Sahara', 'n. cyprus': 'Northern Cyprus',
    'fr. s. antarctic lands': 'French Southern Territories', 'french southern and antarctic lands': 'French Southern Territories',
    'the gambia': 'Gambia', 'the bahamas': 'Bahamas', 'philippines (the)': 'Philippines',
    'micronesia (federated states of)': 'Micronesia', 'federated states of micronesia': 'Micronesia',
    'palestine, state of': 'Palestine', 'state of palestine': 'Palestine', 'occupied palestinian territory': 'Palestine',
    'curacao': 'Curaçao', 'reunion': 'Réunion', 'sao tome and principe': 'São Tomé and Príncipe',
    'uae': 'United Arab Emirates', 'hong kong sar': 'Hong Kong', 'macao': 'Macau',
    'us virgin islands': 'U.S. Virgin Islands', 'taiwan, province of china': 'Taiwan',
    'vanuatu islands': 'Vanuatu', 'fiji islands': 'Fiji', 'tonga islands': 'Tonga', 'samoa islands': 'Samoa',
    'mariana islands': 'Northern Mariana Islands', 'southern india': 'India'
  };

  /* Parts of a country that providers name in its place. Used to group a
     record under its country, never to read a typed place as its country:
     a search for Alaska is a search for Alaska. */
  var PARTS = {
    'alaska': 'United States', 'aleutian islands': 'United States', 'rat islands': 'United States',
    'andreanof islands': 'United States', 'fox islands': 'United States', 'unimak island': 'United States',
    'near islands': 'United States', 'hawaii': 'United States', 'island of hawaii': 'United States',
    'bonin islands': 'Japan', 'izu islands': 'Japan', 'ryukyu islands': 'Japan', 'volcano islands': 'Japan',
    'hokkaido': 'Japan', 'honshu': 'Japan', 'kyushu': 'Japan', 'shikoku': 'Japan',
    'kuril islands': 'Russia', 'kamchatka': 'Russia', 'komandorskiye ostrova': 'Russia',
    'kermadec islands': 'New Zealand', 'north island': 'New Zealand', 'south island': 'New Zealand',
    'santa cruz islands': 'Solomon Islands', 'loyalty islands': 'New Caledonia',
    'sumatra': 'Indonesia', 'java': 'Indonesia', 'sulawesi': 'Indonesia', 'halmahera': 'Indonesia',
    'mindanao': 'Philippines', 'luzon': 'Philippines', 'crete': 'Greece', 'sicily': 'Italy',
    'tibet': 'China', 'xizang': 'China', 'xinjiang': 'China', 'easter island': 'Chile'
  };

  /* Every other country or territory, spelled as we show it. */
  var NAMES = ('Afghanistan|Albania|Algeria|American Samoa|Andorra|Angola|Anguilla|Antarctica|Antigua and Barbuda|' +
    'Argentina|Armenia|Aruba|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|' +
    'Belize|Benin|Bermuda|Bhutan|Botswana|Brazil|British Virgin Islands|Bulgaria|Burkina Faso|Burundi|Cambodia|' +
    'Cameroon|Canada|Cayman Islands|Chad|Chile|China|Colombia|Comoros|Cook Islands|Costa Rica|Croatia|Cuba|Cyprus|' +
    'Denmark|Djibouti|Dominica|Ecuador|Egypt|El Salvador|Eritrea|Estonia|Ethiopia|Faroe Islands|Fiji|Finland|' +
    'France|French Guiana|French Polynesia|Gabon|Gambia|Georgia|Germany|Ghana|Gibraltar|Greece|Greenland|Grenada|' +
    'Guadeloupe|Guam|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|' +
    'Iraq|Ireland|Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Latvia|' +
    'Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|' +
    'Mali|Malta|Marshall Islands|Martinique|Mauritania|Mauritius|Mayotte|Monaco|Mongolia|Montenegro|Montserrat|' +
    'Morocco|Mozambique|Namibia|Nauru|Nepal|Netherlands|New Caledonia|New Zealand|Nicaragua|Niger|Nigeria|Niue|' +
    'Norfolk Island|Northern Mariana Islands|Norway|Oman|Pakistan|Palau|Panama|Papua New Guinea|Paraguay|Peru|' +
    'Philippines|Pitcairn Islands|Poland|Portugal|Puerto Rico|Qatar|Romania|Rwanda|Saint Barthélemy|Saint Helena|' +
    'Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|' +
    'Samoa|San Marino|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Sint Maarten|Slovakia|Slovenia|' +
    'Somalia|Somaliland|South Africa|South Georgia and the South Sandwich Islands|South Sudan|Spain|Sri Lanka|Sudan|' +
    'Suriname|Sweden|Switzerland|Taiwan|Tajikistan|Thailand|Togo|Tokelau|Trinidad and Tobago|Tunisia|Turkmenistan|' +
    'Turks and Caicos Islands|Tuvalu|Uganda|Ukraine|United Arab Emirates|Uruguay|Uzbekistan|Vatican City|' +
    'Wallis and Futuna|Yemen|Zambia|Zimbabwe|United States Minor Outlying Islands').split('|');

  var KNOWN = {};
  NAMES.forEach(function (n) { KNOWN[n.toLowerCase()] = n; });
  Object.keys(ALIASES).forEach(function (k) { KNOWN[k] = ALIASES[k]; KNOWN[ALIASES[k].toLowerCase()] = ALIASES[k]; });

  function tidy(v) {
    return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;.]+$/g, '').trim();
  }

  /** The one spelling of a country, or '' when the name is not one we know. */
  function canonical(name) {
    var k = tidy(name).toLowerCase();
    return k ? (KNOWN[k] || '') : '';
  }

  /* Words that make a name a stretch of sea rather than a place on land. */
  var SEA_WORDS = /\b(ridge|rise|ocean|sea|gulf|bay|strait|trench|fracture zone|basin|passage|channel|plateau|seamount|abyssal)\b/i;
  var OFFSHORE = /^(north|south|east|west|northeast|northwest|southeast|southwest|northern|southern|eastern|western|central|off|near)( of)?(\s+the)?(\s+coast of)?\s+/i;

  /*
   * Where one name a provider gave puts a record: { country } on land, or
   * { sea } when it names open water. "Japan region" is Japan; "South of Fiji
   * Islands" and "Reykjanes Ridge" are at sea; a name we do not know and that
   * reads as land is kept as it was written.
   */
  function locate(name) {
    var raw = tidy(name);
    if (!raw) return {};
    var known = canonical(raw);
    if (known) return { country: known };
    var lower = raw.toLowerCase();
    if (PARTS[lower]) return { country: PARTS[lower] };
    var region = /^(.*?)\s+region$/i.exec(raw);
    if (region) {
      var inner = canonical(region[1]) || PARTS[region[1].toLowerCase()] || '';
      return inner ? { country: inner } : { sea: raw };
    }
    if (OFFSHORE.test(raw) || SEA_WORDS.test(raw)) return { sea: raw };
    return { country: raw };
  }

  /* A label the regions page groups records with no country under. */
  var AT_SEA = 'At sea';

  /**
   * A record's list of names as countries, with any ocean feature moved to
   * `sea`. Duplicates after renaming are dropped, so ["Mexico", "México"] is
   * one country. `sea` is set only when no country remains.
   */
  function place(names) {
    var list = Array.isArray(names) ? names : String(names || '').split(',');
    var countries = [], sea = '';
    list.forEach(function (n) {
      var at = locate(n);
      if (at.country && countries.indexOf(at.country) < 0) countries.push(at.country);
      else if (at.sea && !sea) sea = at.sea;
    });
    var out = { countries: countries };
    if (!countries.length && sea) out.sea = sea;
    return out;
  }

  /** A record's countries: the feed's `countries` list, else its country field. */
  function of(e) {
    if (!e) return { countries: [] };
    var listed = Array.isArray(e.countries) && e.countries.length ? e.countries : String(e.country || e.affectedCountries || '').split(',');
    var p = place(listed);
    if (!p.countries.length && !p.sea && e.sea) p.sea = String(e.sea);
    return p;
  }

  /** How many countries a list of records names: each one once, by its one name. */
  function countryCount(list) {
    var seen = {};
    (list || []).forEach(function (e) {
      of(e).countries.forEach(function (c) { seen[c.toLowerCase()] = 1; });
    });
    return Object.keys(seen).length;
  }

  /* A whole-word test, so Niger is not Nigeria and India is not "Indian". */
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function wholeWord(text, word) {
    var w = tidy(word);
    if (!w) return false;
    return new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(w) + '(?=$|[^\\p{L}\\p{N}])', 'iu').test(String(text || ''));
  }

  /*
   * Is this record in the place named? A country is matched against the
   * record's countries exactly, by its one name; anything else (a state, a
   * city, an island) as a whole word in the record's place fields. Never in
   * its title or description, and never as part of a longer word. An empty
   * place is everywhere.
   */
  /* Not the title or the description: "flood" is not a place. */
  var PLACE_FIELDS = ['country', 'affectedCountries', 'region', 'location', 'place', 'sea'];
  function inPlace(e, q) {
    var want = tidy(q);
    if (!e) return false;
    if (!want) return true;
    if (want.toLowerCase() === AT_SEA.toLowerCase()) return !of(e).countries.length;
    var mine = of(e);
    var c = canonical(want);
    if (c && mine.countries.length) return mine.countries.indexOf(c) >= 0;
    var text = PLACE_FIELDS.map(function (k) { return e[k]; }).filter(function (v) { return v !== undefined && v !== null && v !== ''; }).join(' • ');
    if (wholeWord(text, want)) return true;
    return !c && mine.countries.some(function (x) { return x.toLowerCase() === want.toLowerCase(); });
  }

  var api = { ALIASES: ALIASES, PARTS: PARTS, NAMES: NAMES, AT_SEA: AT_SEA, canonical: canonical, locate: locate,
    place: place, of: of, countryCount: countryCount, inPlace: inPlace, wholeWord: wholeWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDCountries = api;
})(typeof window !== 'undefined' ? window : null);
