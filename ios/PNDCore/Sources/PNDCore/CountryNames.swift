import Foundation

/// `country-names.js` (changelog C36): one name for each country, wherever the
/// app groups or counts by country, ocean features moved into `sea`, and
/// places matched exactly. The tables are copied verbatim from the website.
public enum CountryNames {
    /// Spellings of one country, all mapped to the name we show. Lower-cased keys, in the website's order.
    public static let aliasList: [(String, String)] = [
        ("mx", "Mexico"),
        ("méxico", "Mexico"),
        ("mexico", "Mexico"),
        ("us", "United States"),
        ("u.s.", "United States"),
        ("usa", "United States"),
        ("u.s.a.", "United States"),
        ("united states of america", "United States"),
        ("united states", "United States"),
        ("uk", "United Kingdom"),
        ("great britain", "United Kingdom"),
        ("britain", "United Kingdom"),
        ("united kingdom of great britain and northern ireland", "United Kingdom"),
        ("iran", "Iran"),
        ("islamic republic of iran", "Iran"),
        ("iran, islamic republic of", "Iran"),
        ("iran (islamic republic of)", "Iran"),
        ("myanmar", "Myanmar"),
        ("burma", "Myanmar"),
        ("burma (myanmar)", "Myanmar"),
        ("myanmar (burma)", "Myanmar"),
        ("russia", "Russia"),
        ("russian federation", "Russia"),
        ("vietnam", "Vietnam"),
        ("viet nam", "Vietnam"),
        ("laos", "Laos"),
        ("lao pdr", "Laos"),
        ("lao people's democratic republic", "Laos"),
        ("syria", "Syria"),
        ("syrian arab republic", "Syria"),
        ("south korea", "South Korea"),
        ("korea, republic of", "South Korea"),
        ("republic of korea", "South Korea"),
        ("north korea", "North Korea"),
        ("democratic people's republic of korea", "North Korea"),
        ("dprk", "North Korea"),
        ("korea, democratic people's republic of", "North Korea"),
        ("tanzania", "Tanzania"),
        ("united republic of tanzania", "Tanzania"),
        ("tanzania, united republic of", "Tanzania"),
        ("bolivia", "Bolivia"),
        ("bolivia (plurinational state of)", "Bolivia"),
        ("plurinational state of bolivia", "Bolivia"),
        ("venezuela", "Venezuela"),
        ("venezuela (bolivarian republic of)", "Venezuela"),
        ("bolivarian republic of venezuela", "Venezuela"),
        ("moldova", "Moldova"),
        ("republic of moldova", "Moldova"),
        ("moldova, republic of", "Moldova"),
        ("brunei", "Brunei"),
        ("brunei darussalam", "Brunei"),
        ("türkiye", "Türkiye"),
        ("turkiye", "Türkiye"),
        ("turkey", "Türkiye"),
        ("czechia", "Czechia"),
        ("czech republic", "Czechia"),
        ("cabo verde", "Cabo Verde"),
        ("cape verde", "Cabo Verde"),
        ("côte d'ivoire", "Côte d'Ivoire"),
        ("cote d'ivoire", "Côte d'Ivoire"),
        ("ivory coast", "Côte d'Ivoire"),
        ("timor-leste", "Timor-Leste"),
        ("timor leste", "Timor-Leste"),
        ("east timor", "Timor-Leste"),
        ("north macedonia", "North Macedonia"),
        ("macedonia", "North Macedonia"),
        ("the republic of north macedonia", "North Macedonia"),
        ("republic of north macedonia", "North Macedonia"),
        ("bosnia and herzegovina", "Bosnia and Herzegovina"),
        ("bosnia & herzegovina", "Bosnia and Herzegovina"),
        ("bosnia and herz.", "Bosnia and Herzegovina"),
        ("eswatini", "Eswatini"),
        ("swaziland", "Eswatini"),
        ("democratic republic of the congo", "Democratic Republic of the Congo"),
        ("democratic republic of congo", "Democratic Republic of the Congo"),
        ("dem. rep. congo", "Democratic Republic of the Congo"),
        ("dr congo", "Democratic Republic of the Congo"),
        ("drc", "Democratic Republic of the Congo"),
        ("congo-kinshasa", "Democratic Republic of the Congo"),
        ("congo, the democratic republic of the", "Democratic Republic of the Congo"),
        ("republic of the congo", "Republic of the Congo"),
        ("republic of congo", "Republic of the Congo"),
        ("congo", "Republic of the Congo"),
        ("congo-brazzaville", "Republic of the Congo"),
        ("central african rep.", "Central African Republic"),
        ("dominican rep.", "Dominican Republic"),
        ("eq. guinea", "Equatorial Guinea"),
        ("falkland is.", "Falkland Islands"),
        ("s. sudan", "South Sudan"),
        ("solomon is.", "Solomon Islands"),
        ("w. sahara", "Western Sahara"),
        ("n. cyprus", "Northern Cyprus"),
        ("fr. s. antarctic lands", "French Southern Territories"),
        ("french southern and antarctic lands", "French Southern Territories"),
        ("the gambia", "Gambia"),
        ("the bahamas", "Bahamas"),
        ("philippines (the)", "Philippines"),
        ("micronesia (federated states of)", "Micronesia"),
        ("federated states of micronesia", "Micronesia"),
        ("palestine, state of", "Palestine"),
        ("state of palestine", "Palestine"),
        ("occupied palestinian territory", "Palestine"),
        ("curacao", "Curaçao"),
        ("reunion", "Réunion"),
        ("sao tome and principe", "São Tomé and Príncipe"),
        ("uae", "United Arab Emirates"),
        ("hong kong sar", "Hong Kong"),
        ("macao", "Macau"),
        ("us virgin islands", "U.S. Virgin Islands"),
        ("taiwan, province of china", "Taiwan"),
        ("vanuatu islands", "Vanuatu"),
        ("fiji islands", "Fiji"),
        ("tonga islands", "Tonga"),
        ("samoa islands", "Samoa"),
        ("mariana islands", "Northern Mariana Islands"),
        ("southern india", "India"),
    ]
    public static let aliases: [String: String] = Dictionary(aliasList, uniquingKeysWith: { a, _ in a })

    /// Parts of a country that providers name in its place. Used to group a record under its country only.
    public static let parts: [String: String] = [
        "alaska": "United States",
        "aleutian islands": "United States",
        "rat islands": "United States",
        "andreanof islands": "United States",
        "fox islands": "United States",
        "unimak island": "United States",
        "near islands": "United States",
        "hawaii": "United States",
        "island of hawaii": "United States",
        "bonin islands": "Japan",
        "izu islands": "Japan",
        "ryukyu islands": "Japan",
        "volcano islands": "Japan",
        "hokkaido": "Japan",
        "honshu": "Japan",
        "kyushu": "Japan",
        "shikoku": "Japan",
        "kuril islands": "Russia",
        "kamchatka": "Russia",
        "komandorskiye ostrova": "Russia",
        "kermadec islands": "New Zealand",
        "north island": "New Zealand",
        "south island": "New Zealand",
        "santa cruz islands": "Solomon Islands",
        "loyalty islands": "New Caledonia",
        "sumatra": "Indonesia",
        "java": "Indonesia",
        "sulawesi": "Indonesia",
        "halmahera": "Indonesia",
        "mindanao": "Philippines",
        "luzon": "Philippines",
        "crete": "Greece",
        "sicily": "Italy",
        "tibet": "China",
        "xizang": "China",
        "xinjiang": "China",
        "easter island": "Chile"
    ]

    /// Every other country or territory, spelled as we show it.
    public static let names: [String] = ("Afghanistan|Albania|Algeria|American Samoa|Andorra|Angola|Anguilla|Antarctica|Antigua and Barbuda|Argentina|" +
        "Armenia|Aruba|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|" +
        "Bermuda|Bhutan|Botswana|Brazil|British Virgin Islands|Bulgaria|Burkina Faso|Burundi|Cambodia|Cameroon|Canada|" +
        "Cayman Islands|Chad|Chile|China|Colombia|Comoros|Cook Islands|Costa Rica|Croatia|Cuba|Cyprus|Denmark|Djibouti|" +
        "Dominica|Ecuador|Egypt|El Salvador|Eritrea|Estonia|Ethiopia|Faroe Islands|Fiji|Finland|France|French Guiana|" +
        "French Polynesia|Gabon|Gambia|Georgia|Germany|Ghana|Gibraltar|Greece|Greenland|Grenada|Guadeloupe|Guam|" +
        "Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iraq|Ireland|" +
        "Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Latvia|Lebanon|Lesotho|" +
        "Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|" +
        "Marshall Islands|Martinique|Mauritania|Mauritius|Mayotte|Monaco|Mongolia|Montenegro|Montserrat|Morocco|" +
        "Mozambique|Namibia|Nauru|Nepal|Netherlands|New Caledonia|New Zealand|Nicaragua|Niger|Nigeria|Niue|" +
        "Norfolk Island|Northern Mariana Islands|Norway|Oman|Pakistan|Palau|Panama|Papua New Guinea|Paraguay|Peru|" +
        "Philippines|Pitcairn Islands|Poland|Portugal|Puerto Rico|Qatar|Romania|Rwanda|Saint Barthélemy|Saint Helena|" +
        "Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|" +
        "Samoa|San Marino|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Sint Maarten|Slovakia|Slovenia|" +
        "Somalia|Somaliland|South Africa|South Georgia and the South Sandwich Islands|South Sudan|Spain|Sri Lanka|Sudan|" +
        "Suriname|Sweden|Switzerland|Taiwan|Tajikistan|Thailand|Togo|Tokelau|Trinidad and Tobago|Tunisia|Turkmenistan|" +
        "Turks and Caicos Islands|Tuvalu|Uganda|Ukraine|United Arab Emirates|Uruguay|Uzbekistan|Vatican City|" +
        "Wallis and Futuna|Yemen|Zambia|Zimbabwe|United States Minor Outlying Islands").components(separatedBy: "|")

    private static let known: [String: String] = {
        var m: [String: String] = [:]
        for n in names { m[n.lowercased()] = n }
        for (k, v) in aliasList { m[k] = v; m[v.lowercased()] = v }
        return m
    }()

    public static let atSea = "At sea"

    private static let spaces = JSRegex(#"\s+"#)
    private static let ends = JSRegex(#"^[\s,;]+|[\s,;.]+$"#)

    static func tidy(_ v: String?) -> String {
        let a = spaces.replace(v ?? "") { _ in " " }
        return JS.trim(ends.replace(a) { _ in "" })
    }

    /// The one spelling of a country, or "" when the name is not one we know.
    public static func canonical(_ name: String?) -> String {
        let k = tidy(name).lowercased()
        return k.isEmpty ? "" : (known[k] ?? "")
    }

    private static let seaWords = JSRegex(#"\b(ridge|rise|ocean|sea|gulf|bay|strait|trench|fracture zone|basin|passage|channel|plateau|seamount|abyssal)\b"#, caseInsensitive: true)
    private static let offshore = JSRegex(#"^(north|south|east|west|northeast|northwest|southeast|southwest|northern|southern|eastern|western|central|off|near)( of)?(\s+the)?(\s+coast of)?\s+"#, caseInsensitive: true)
    private static let regionRe = JSRegex(#"^(.*?)\s+region$"#, caseInsensitive: true)

    /// Where one name puts a record: a country on land, or a sea.
    public static func locate(_ name: String?) -> (country: String?, sea: String?) {
        let raw = tidy(name)
        if raw.isEmpty { return (nil, nil) }
        let c = canonical(raw)
        if !c.isEmpty { return (c, nil) }
        if let p = parts[raw.lowercased()] { return (p, nil) }
        if let m = regionRe.exec(raw), let r = m[1] {
            var inner = canonical(r)
            if inner.isEmpty { inner = parts[r.lowercased()] ?? "" }
            return inner.isEmpty ? (nil, raw) : (inner, nil)
        }
        if offshore.test(raw) || seaWords.test(raw) { return (nil, raw) }
        return (raw, nil)
    }

    /// A list of names as countries, with any ocean feature moved to `sea` (set only when no country remains).
    public static func place(_ list: [String]) -> (countries: [String], sea: String?) {
        var countries: [String] = []
        var sea = ""
        for n in list {
            let at = locate(n)
            if let c = at.country, !countries.contains(c) { countries.append(c) }
            else if let s = at.sea, sea.isEmpty { sea = s }
        }
        return (countries, countries.isEmpty && !sea.isEmpty ? sea : nil)
    }

    /// A record's countries: the feed's `countries` list, else its country (or affectedCountries) field.
    public static func of(_ e: Record) -> (countries: [String], sea: String?) {
        let listed: [String]
        if let a = e["countries"]?.arrayValue, !a.isEmpty { listed = a.map { $0.jsString } }
        else { listed = (e.first("country", "affectedCountries")?.jsString ?? "").components(separatedBy: ",") }
        let p = place(listed)
        if p.countries.isEmpty && p.sea == nil && e.truthy("sea") { return (p.countries, e.s("sea")) }
        return p
    }

    /// How many countries a list of records names: each one once, by its one name.
    public static func countryCount(_ list: [Record]) -> Int {
        var seen = Set<String>()
        for e in list { for c in of(e).countries { seen.insert(c.lowercased()) } }
        return seen.count
    }

    /// A whole-word test, so Niger is not Nigeria and India is not "Indian".
    public static func wholeWord(_ text: String?, _ word: String?) -> Bool {
        let w = tidy(word)
        if w.isEmpty { return false }
        let re = JSRegex(#"(^|[^\p{L}\p{N}])"# + NSRegularExpression.escapedPattern(for: w) + #"(?=$|[^\p{L}\p{N}])"#, caseInsensitive: true)
        return re.test(text ?? "")
    }

    private static let placeFields = ["country", "affectedCountries", "region", "location", "place", "sea"]

    /// Is this record in the place named? A country exactly, by its one name,
    /// against the record's countries; anything else as a whole word in its
    /// place fields, never its title or description. An empty place is everywhere.
    public static func inPlace(_ e: Record, _ q: String?) -> Bool {
        let want = tidy(q)
        if want.isEmpty { return true }
        if want.lowercased() == atSea.lowercased() { return of(e).countries.isEmpty }
        let mine = of(e)
        let c = canonical(want)
        if !c.isEmpty && !mine.countries.isEmpty { return mine.countries.contains(c) }
        let text = placeFields.compactMap { k -> String? in
            guard let v = e[k], !v.isNull else { return nil }
            if v == .string("") { return nil }
            return v.jsString
        }.joined(separator: " \u{2022} ")
        if wholeWord(text, want) { return true }
        return c.isEmpty && mine.countries.contains { $0.lowercased() == want.lowercased() }
    }
}
