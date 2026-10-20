/*
 * Which continent a record is on.
 *
 * The home page links to /regions/Asia, /regions/Europe and the rest, and the
 * region page found its records by looking for the region's name inside each
 * record's text. No record names its continent, so on the live feed Asia,
 * Europe, North America, South America and Oceania all read "No current
 * events here" - a false all-clear for most of the planet - while the
 * dashboard's own Asia scope counted 426.
 *
 * A continent is the countries on it. Each record names its countries (the
 * feed fills `countries` from the map outlines when a provider names none),
 * so the record is on every continent one of those countries is on. The names
 * are the outline names in world-countries.json, the spellings the providers
 * use, and the territories the outlines leave out. A record at sea names no
 * country and is on no continent, which the region page says rather than
 * hiding.
 */
(function (root) {
  var C = {
    Africa: 'Algeria|Angola|Benin|Botswana|Burkina Faso|Burundi|Cameroon|Cape Verde|Cabo Verde|Central African Rep.|Central African Republic|Chad|Comoros|Congo|Republic of Congo|Republic of the Congo|Congo-Brazzaville|Dem. Rep. Congo|Democratic Republic of Congo|Democratic Republic of the Congo|DR Congo|Congo-Kinshasa|Côte d\'Ivoire|Cote d\'Ivoire|Ivory Coast|Djibouti|Egypt|Eq. Guinea|Equatorial Guinea|Eritrea|eSwatini|Eswatini|Swaziland|Ethiopia|Gabon|Gambia|The Gambia|Ghana|Guinea|Guinea-Bissau|Kenya|Lesotho|Liberia|Libya|Madagascar|Malawi|Mali|Mauritania|Mauritius|Mayotte|Morocco|Mozambique|Namibia|Niger|Nigeria|Réunion|Reunion|Rwanda|Saint Helena|São Tomé and Príncipe|Sao Tome and Principe|Senegal|Seychelles|Sierra Leone|Somalia|Somaliland|South Africa|S. Sudan|South Sudan|Sudan|Tanzania|Togo|Tunisia|Uganda|W. Sahara|Western Sahara|Zambia|Zimbabwe',
    Asia: 'Afghanistan|Armenia|Azerbaijan|Bahrain|Bangladesh|Bhutan|Brunei|Cambodia|China|Hong Kong|Macau|Macao|Georgia|India|Southern India|Indonesia|Iran|Iraq|Israel|Japan|Jordan|Kazakhstan|Kuwait|Kyrgyzstan|Laos|Lebanon|Malaysia|Maldives|Mongolia|Myanmar|Burma|Nepal|North Korea|Oman|Pakistan|Palestine|Philippines|Qatar|Saudi Arabia|Singapore|South Korea|Korea|Sri Lanka|Syria|Taiwan|Tajikistan|Thailand|Timor-Leste|Timor Leste|East Timor|Turkey|Türkiye|Turkiye|Turkmenistan|United Arab Emirates|UAE|Uzbekistan|Vietnam|Viet Nam|Yemen|N. Cyprus|Northern Cyprus|Cyprus|Russia|Russian Federation',
    Europe: 'Albania|Andorra|Austria|Belarus|Belgium|Bosnia and Herz.|Bosnia and Herzegovina|Bosnia & Herzegovina|Bulgaria|Croatia|Czechia|Czech Republic|Denmark|Estonia|Faroe Islands|Finland|France|Germany|Gibraltar|Greece|Hungary|Iceland|Ireland|Italy|Kosovo|Latvia|Liechtenstein|Lithuania|Luxembourg|Macedonia|North Macedonia|Malta|Moldova|Monaco|Montenegro|Netherlands|Norway|Poland|Portugal|Romania|Russia|Russian Federation|San Marino|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Ukraine|United Kingdom|UK|Vatican City|Turkey|Türkiye|Turkiye|Georgia|Armenia|Azerbaijan|Kazakhstan|Cyprus|N. Cyprus|Northern Cyprus',
    'North America': 'Anguilla|Antigua and Barbuda|Aruba|Bahamas|The Bahamas|Barbados|Belize|Bermuda|British Virgin Islands|Canada|Cayman Islands|Costa Rica|Cuba|Curaçao|Curacao|Dominica|Dominican Rep.|Dominican Republic|El Salvador|Greenland|Grenada|Guadeloupe|Guatemala|Haiti|Honduras|Jamaica|Martinique|Mexico|México|MX|Montserrat|Nicaragua|Panama|Puerto Rico|Saint Barthélemy|Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|Sint Maarten|Trinidad and Tobago|Turks and Caicos Islands|United States|United States of America|USA|US|U.S. Virgin Islands|US Virgin Islands',
    'South America': 'Argentina|Bolivia|Brazil|Chile|Colombia|Ecuador|Falkland Is.|Falkland Islands|French Guiana|Guyana|Paraguay|Peru|South Georgia and the South Sandwich Islands|South Sandwich Islands|Suriname|Uruguay|Venezuela',
    Oceania: 'American Samoa|Australia|Cook Islands|Fiji|French Polynesia|Guam|Kiribati|Marshall Islands|Micronesia|Nauru|New Caledonia|New Zealand|Niue|Norfolk Island|Northern Mariana Islands|Palau|Papua New Guinea|Pitcairn Islands|Samoa|Solomon Is.|Solomon Islands|Tokelau|Tonga|Tuvalu|Vanuatu|Wallis and Futuna',
    Antarctica: 'Antarctica|Fr. S. Antarctic Lands|French Southern Territories|French Southern and Antarctic Lands'
  };
  var NAMES = Object.keys(C);
  var BY_COUNTRY = {};
  NAMES.forEach(function (k) {
    C[k].split('|').forEach(function (n) {
      var key = n.toLowerCase();
      (BY_COUNTRY[key] = BY_COUNTRY[key] || []).indexOf(k) < 0 && BY_COUNTRY[key].push(k);
    });
  });
  /* "Europe", "europe" and "North%20America" from a hand-typed URL. */
  function continentNamed(name) {
    var n = String(name || '').trim().toLowerCase();
    for (var i = 0; i < NAMES.length; i++) if (NAMES[i].toLowerCase() === n) return NAMES[i];
    return '';
  }
  function countriesOf(e) {
    var list = e && Array.isArray(e.countries) && e.countries.length ? e.countries.slice() : [];
    String((e && e.country) || '').split(',').forEach(function (c) { if (c.trim()) list.push(c); });
    return list.map(function (c) {
      /* "New Zealand region", "South Sandwich Islands Region": the place is
         the country the provider named before the word. */
      return String(c).trim().replace(/\s+region$/i, '');
    }).filter(Boolean);
  }
  /** Every continent a record's countries are on; [] for a record at sea. */
  function continentsOf(e) {
    var out = [];
    countriesOf(e).forEach(function (c) {
      (BY_COUNTRY[c.toLowerCase()] || []).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
    });
    return out;
  }
  function onContinent(e, name) {
    var k = continentNamed(name);
    return !!k && continentsOf(e).indexOf(k) >= 0;
  }
  var api = { NAMES: NAMES, continentNamed: continentNamed, continentsOf: continentsOf, onContinent: onContinent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDContinents = api;
})(typeof window !== 'undefined' ? window : null);
