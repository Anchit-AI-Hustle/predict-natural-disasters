import Foundation

/// `continents.js` (logic.md section 6.12, changelog C1): a continent is the
/// countries on it. No record names its continent, so a text match left most
/// of the world reading "No current events here".
public enum Continents {
    /// The name lists, copied verbatim from `continents.js` (in its order).
    public static let lists: [(name: String, countries: String)] = [
        ("Africa", "Algeria|Angola|Benin|Botswana|Burkina Faso|Burundi|Cameroon|Cape Verde|Cabo Verde|Central African Rep.|Central African Republic|Chad|Comoros|Congo|Republic of Congo|Republic of the Congo|Congo-Brazzaville|Dem. Rep. Congo|Democratic Republic of Congo|Democratic Republic of the Congo|DR Congo|Congo-Kinshasa|Côte d'Ivoire|Cote d'Ivoire|Ivory Coast|Djibouti|Egypt|Eq. Guinea|Equatorial Guinea|Eritrea|eSwatini|Eswatini|Swaziland|Ethiopia|Gabon|Gambia|The Gambia|Ghana|Guinea|Guinea-Bissau|Kenya|Lesotho|Liberia|Libya|Madagascar|Malawi|Mali|Mauritania|Mauritius|Mayotte|Morocco|Mozambique|Namibia|Niger|Nigeria|Réunion|Reunion|Rwanda|Saint Helena|São Tomé and Príncipe|Sao Tome and Principe|Senegal|Seychelles|Sierra Leone|Somalia|Somaliland|South Africa|S. Sudan|South Sudan|Sudan|Tanzania|Togo|Tunisia|Uganda|W. Sahara|Western Sahara|Zambia|Zimbabwe"),
        ("Asia", "Afghanistan|Armenia|Azerbaijan|Bahrain|Bangladesh|Bhutan|Brunei|Cambodia|China|Hong Kong|Macau|Macao|Georgia|India|Southern India|Indonesia|Iran|Iraq|Israel|Japan|Jordan|Kazakhstan|Kuwait|Kyrgyzstan|Laos|Lebanon|Malaysia|Maldives|Mongolia|Myanmar|Burma|Nepal|North Korea|Oman|Pakistan|Palestine|Philippines|Qatar|Saudi Arabia|Singapore|South Korea|Korea|Sri Lanka|Syria|Taiwan|Tajikistan|Thailand|Timor-Leste|Timor Leste|East Timor|Turkey|Türkiye|Turkiye|Turkmenistan|United Arab Emirates|UAE|Uzbekistan|Vietnam|Viet Nam|Yemen|N. Cyprus|Northern Cyprus|Cyprus|Russia|Russian Federation"),
        ("Europe", "Albania|Andorra|Austria|Belarus|Belgium|Bosnia and Herz.|Bosnia and Herzegovina|Bosnia & Herzegovina|Bulgaria|Croatia|Czechia|Czech Republic|Denmark|Estonia|Faroe Islands|Finland|France|Germany|Gibraltar|Greece|Hungary|Iceland|Ireland|Italy|Kosovo|Latvia|Liechtenstein|Lithuania|Luxembourg|Macedonia|North Macedonia|Malta|Moldova|Monaco|Montenegro|Netherlands|Norway|Poland|Portugal|Romania|Russia|Russian Federation|San Marino|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Ukraine|United Kingdom|UK|Vatican City|Turkey|Türkiye|Turkiye|Georgia|Armenia|Azerbaijan|Kazakhstan|Cyprus|N. Cyprus|Northern Cyprus"),
        ("North America", "Anguilla|Antigua and Barbuda|Aruba|Bahamas|The Bahamas|Barbados|Belize|Bermuda|British Virgin Islands|Canada|Cayman Islands|Costa Rica|Cuba|Curaçao|Curacao|Dominica|Dominican Rep.|Dominican Republic|El Salvador|Greenland|Grenada|Guadeloupe|Guatemala|Haiti|Honduras|Jamaica|Martinique|Mexico|México|MX|Montserrat|Nicaragua|Panama|Puerto Rico|Saint Barthélemy|Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|Sint Maarten|Trinidad and Tobago|Turks and Caicos Islands|United States|United States of America|USA|US|U.S. Virgin Islands|US Virgin Islands"),
        ("South America", "Argentina|Bolivia|Brazil|Chile|Colombia|Ecuador|Falkland Is.|Falkland Islands|French Guiana|Guyana|Paraguay|Peru|South Georgia and the South Sandwich Islands|South Sandwich Islands|Suriname|Uruguay|Venezuela"),
        ("Oceania", "American Samoa|Australia|Cook Islands|Fiji|French Polynesia|Guam|Kiribati|Marshall Islands|Micronesia|Nauru|New Caledonia|New Zealand|Niue|Norfolk Island|Northern Mariana Islands|Palau|Papua New Guinea|Pitcairn Islands|Samoa|Solomon Is.|Solomon Islands|Tokelau|Tonga|Tuvalu|Vanuatu|Wallis and Futuna"),
        ("Antarctica", "Antarctica|Fr. S. Antarctic Lands|French Southern Territories|French Southern and Antarctic Lands")
    ]

    /// `PNDContinents.NAMES`.
    public static let names: [String] = lists.map { $0.name }

    /// Every continent whose list holds a name (lower-cased).
    public static let byCountry: [String: [String]] = {
        var out: [String: [String]] = [:]
        for l in lists {
            for n in l.countries.components(separatedBy: "|") {
                let k = n.lowercased()
                if !(out[k] ?? []).contains(l.name) { out[k, default: []].append(l.name) }
            }
        }
        return out
    }()

    /// The `NAMES` entry equal to the trimmed name ignoring case, else "".
    /// No URL decoding: "North%20America" is not a continent.
    public static func continentNamed(_ name: String?) -> String {
        let n = JS.trim(name ?? "").lowercased()
        return names.first { $0.lowercased() == n } ?? ""
    }

    private static let regionSuffix = JSRegex(#"\s+region$"#, caseInsensitive: true)

    /// The record's countries: `countries[]` (when a non-empty array) plus
    /// the comma-split `country`, each trimmed, with a trailing " region" cut.
    public static func countriesOf(_ e: Record) -> [String] {
        var list: [String] = []
        if let a = e["countries"]?.arrayValue, !a.isEmpty { list = a.map { $0.jsString } }
        for c in e.country.components(separatedBy: ",") where !JS.trim(c).isEmpty { list.append(c) }
        return list.map { regionSuffix.replace(JS.trim($0)) { _ in "" } }.filter { !$0.isEmpty }
    }

    /// Every continent a record's countries are on; [] for a record at sea.
    public static func continentsOf(_ e: Record) -> [String] {
        var out: [String] = []
        for c in countriesOf(e) {
            for k in byCountry[c.lowercased()] ?? [] where !out.contains(k) { out.append(k) }
        }
        return out
    }

    public static func onContinent(_ e: Record, _ name: String?) -> Bool {
        let k = continentNamed(name)
        return !k.isEmpty && continentsOf(e).contains(k)
    }
}
