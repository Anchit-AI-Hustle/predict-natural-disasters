import Foundation

/// `glossary.js` (logic.md section 9.2).
public enum Glossary {
    public static let bearings: [String: String] = [
        "N": "north", "S": "south", "E": "east", "W": "west",
        "NE": "north-east", "NW": "north-west", "SE": "south-east", "SW": "south-west",
        "NNE": "north-north-east", "ENE": "east-north-east", "ESE": "east-south-east",
        "SSE": "south-south-east", "SSW": "south-south-west", "WSW": "west-south-west",
        "WNW": "west-north-west", "NNW": "north-north-west"
    ]
    public static let magnitudes: [String: String] = ["mw": "moment magnitude", "mb": "body-wave magnitude",
                                               "ml": "local magnitude", "ms": "surface-wave magnitude"]
    public static let states: [String: String] = [
        "AK": "Alaska", "CT": "Connecticut", "DC": "District of Columbia", "FL": "Florida",
        "HI": "Hawaii", "IA": "Iowa", "KS": "Kansas", "MI": "Michigan", "NH": "New Hampshire",
        "NJ": "New Jersey", "NM": "New Mexico", "NV": "Nevada", "NY": "New York", "OH": "Ohio",
        "OK": "Oklahoma", "OR": "Oregon", "RI": "Rhode Island", "TX": "Texas", "UT": "Utah",
        "VT": "Vermont", "WA": "Washington", "WI": "Wisconsin", "WV": "West Virginia", "WY": "Wyoming"
    ]
    // Key order matches the JavaScript object order, which decides alternation order.
    public static let bearingRe = JSRegex(#"\b(N|S|E|W|NE|NW|SE|SW|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW)\s+of\b"#)
    public static let magPrefixRe = JSRegex(#"\bM\s+(\d(?:\.\d+)?)"#)
    public static let magNamedRe = JSRegex(#"\bMagnitude\s+(\d(?:\.\d+)?)\s+(mw|mb|ml|ms)\b"#)
    public static let stateRe = JSRegex(#",\s(AK|CT|DC|FL|HI|IA|KS|MI|NH|NJ|NM|NV|NY|OH|OK|OR|RI|TX|UT|VT|WA|WI|WV|WY)\b"#)

    /// The rules that always apply: bearings, "M 6.5", magnitude scales and US
    /// state codes that are not also country codes.
    public static func expandAlways(_ text: String) -> String {
        var s = bearingRe.replace(text) { g in (bearings[g[1] ?? ""] ?? (g[1] ?? "")) + " of" }
        s = magPrefixRe.replace(s) { g in "Magnitude " + (g[1] ?? "") }
        s = magNamedRe.replace(s) { g in
            let name = magnitudes[g[2] ?? ""] ?? ""
            return name.prefix(1).uppercased() + name.dropFirst() + " " + (g[1] ?? "")
        }
        s = stateRe.replace(s) { g in ", " + (states[g[1] ?? ""] ?? "") }
        return s
    }

    /// The first-use acronym expansions for body prose (`ONCE`).
    public static let once: [(String, String)] = [
        ("NASA EONET", "National Aeronautics and Space Administration Earth Observatory Natural Event Tracker"),
        ("UN OCHA", "United Nations Office for the Coordination of Humanitarian Affairs"),
        ("GDACS", "Global Disaster Alert and Coordination System"),
        ("USGS", "United States Geological Survey"),
        ("NOAA", "National Oceanic and Atmospheric Administration"),
        ("EONET", "Earth Observatory Natural Event Tracker"),
        ("NASA", "National Aeronautics and Space Administration"),
        ("EMSC", "European-Mediterranean Seismological Centre"),
        ("NDMA", "National Disaster Management Authority"),
        ("WMO", "World Meteorological Organization"),
        ("NWS", "National Weather Service"),
        ("NHC", "National Hurricane Center"),
        ("IMD", "India Meteorological Department"),
        ("IFRC", "International Federation of Red Cross and Red Crescent Societies")
    ]
}

/// `search.js` (logic.md section 9.1, features.md section 0.3).
public enum Search {
    public static let fields = ["title", "name", "country", "affectedCountries", "region", "location", "type", "hazard",
                         "source", "src", "details", "summary", "id", "eventId"]
    public static let placeFields = ["country", "affectedCountries", "region", "location"]

    public static func buildSearchText(_ raw: [String: JSONValue]) -> String {
        let t = fields.compactMap { k -> String? in
            guard let v = raw[k], v.has else { return nil }
            return v.jsString
        }.joined(separator: " ")
        return (t + " " + Glossary.expandAlways(t)).lowercased()
    }

    public static func terms(_ q: String?) -> [String] {
        (q ?? "").lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    /// Every whitespace-separated term must appear.
    public static func matches(_ e: Record, _ q: String?) -> Bool {
        let ts = terms(q)
        if ts.isEmpty { return true }
        return ts.allSatisfy { e.searchText.contains($0) }
    }

    /// Place fields only (never titles).
    public static func matchesPlace(_ e: Record, _ q: String?) -> Bool {
        let ts = terms(q)
        if ts.isEmpty { return true }
        let t = placeFields.compactMap { k -> String? in
            guard let v = e[k], v.has else { return nil }
            return v.jsString
        }.joined(separator: " ").lowercased()
        return ts.allSatisfy { t.contains($0) }
    }

    /// `emptyHtml(query, pool, all, noun)` as structured text.
    public struct Empty: Equatable, Sendable {
        public let title: String
        public let detail: String?
        /// When the query matches records elsewhere: how many, and the button text.
        public let elsewhere: Int
        public let buttonText: String?
        public let query: String
    }

    public static func empty(query: String?, all: [Record], noun: String) -> Empty {
        let q = (query ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return Empty(title: "No \(noun) to show right now.", detail: nil, elsewhere: 0, buttonText: nil, query: "") }
        let elsewhere = all.filter { matches($0, q) }.count
        let title = "No \(noun) match \u{201C}\(q)\u{201D}."
        if elsewhere > 0 {
            let detail = "\(elsewhere) other event" + (elsewhere == 1 ? "" : "s") + " in our current data " +
                (elsewhere == 1 ? "matches" : "match") + " this search. This page shows only \(noun)."
            let button = "See " + (elsewhere == 1 ? "it" : "all \(elsewhere)") + " on the events page \u{2192}"
            return Empty(title: title, detail: detail, elsewhere: elsewhere, buttonText: button, query: q)
        }
        var countries: [String] = []
        for e in all {
            let c = e.country
            if !c.isEmpty && !countries.contains(c) { countries.append(c) }
        }
        let detail = "Nothing in our current data matches it. Right now we have \(all.count) event" + (all.count == 1 ? "" : "s") +
            " from \(countries.count)" + (countries.count == 1 ? " country or territory" : " countries and territories") + ". " +
            "We only show what official sources are reporting. If a place has no current official report, it is not listed here. That does not mean nothing is happening there."
        return Empty(title: title, detail: detail, elsewhere: 0, buttonText: nil, query: q)
    }
}
