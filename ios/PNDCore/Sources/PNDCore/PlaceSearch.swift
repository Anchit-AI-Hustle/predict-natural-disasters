import Foundation

/// `place-search.js` (logic.md section 3.5): levels, labels and candidates
/// from OpenStreetMap Nominatim results.
public enum PlaceSearch {
    static let levels: [(String, JSRegex)] = [
        ("Area", JSRegex("^(neighbourhood|suburb|quarter|city_district|borough|locality|village|hamlet|isolated_dwelling|croft|allotments|city_block|residential|farm)$")),
        ("City or town", JSRegex("^(city|town|municipality)$")),
        ("District", JSRegex("^(county|district|state_district|subdistrict|district_council)$")),
        ("State or region", JSRegex("^(state|province|region|territory)$")),
        ("Country", JSRegex("^(country|nation)$")),
        ("Address or landmark", JSRegex("^(road|house|house_number|building|amenity|shop|tourism|leisure|office|highway|railway|aeroway|man_made|historic|natural|place_of_worship|school|university|hospital|postcode)$"))
    ]

    public static func levelOf(_ r: JSONValue) -> String {
        let t = (r["addresstype"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? r["type"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? "").lowercased()
        for (name, re) in levels where re.test(t) { return name }
        let rank = r["place_rank"]?.jsNumber ?? .nan
        if rank.isFinite {
            if rank <= 4 { return "Country" }
            if rank <= 8 { return "State or region" }
            if rank <= 12 { return "District" }
            if rank <= 16 { return "City or town" }
            if rank <= 25 { return "Area" }
            return "Address or landmark"
        }
        return "Place"
    }

    static func str(_ v: JSONValue?) -> String { (v?.isTruthy ?? false) ? v!.jsString : "" }

    public static func labelOf(_ r: JSONValue) -> String {
        let a = r["address"] ?? .object([:])
        let display = str(r["display_name"])
        var name = str(r["name"])
        if name.isEmpty { name = (display.components(separatedBy: ",").first ?? "").trimmingCharacters(in: .whitespaces) }
        let town = [a["city"], a["town"], a["village"], a["municipality"], a["county"]].map(str).first { !$0.isEmpty } ?? ""
        let state = [a["state"], a["region"], a["province"]].map(str).first { !$0.isEmpty } ?? ""
        var out: [String] = []
        for p in [name, town, state, str(a["country"])] {
            let t = p.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty && !out.map({ $0.lowercased() }).contains(t.lowercased()) { out.append(t) }
        }
        let joined = out.joined(separator: ", ")
        return joined.isEmpty ? display : joined
    }

    public static func candidate(_ r: JSONValue) -> Place? {
        let lat = r["lat"]?.jsNumber ?? .nan, lon = r["lon"]?.jsNumber ?? .nan
        guard lat.isFinite, lon.isFinite else { return nil }
        let a = r["address"] ?? .object([:])
        return Place(kind: "Searched", name: labelOf(r), lat: lat, lon: lon, country: str(a["country"]),
                     countryCode: str(a["country_code"]).uppercased(), level: levelOf(r), full: str(r["display_name"]))
    }

    /// Results as candidates, the same place never listed twice.
    public static func candidates(_ results: JSONValue) -> [Place] {
        var seen = Set<String>()
        var out: [Place] = []
        for r in results.arrayValue ?? [] {
            guard let c = candidate(r) else { continue }
            let k = c.name.lowercased() + "|" + (c.level ?? "")
            if seen.contains(k) { continue }
            seen.insert(k); out.append(c)
        }
        return out
    }

    /// The default location-detail radius by level (features.md section 8.3).
    public static func defaultRadius(level: String?) -> Int {
        switch level {
        case "Area": return 50
        case "City or town": return 100
        case "District": return 150
        case "State or region": return 300
        default: return 100
        }
    }

    public static let radiusOptions = [25, 50, 100, 150, 300, 500]

    // Copy for the search states (features.md sections 1.1 and 5.2).
    public static let emptyQuery = "Type a city, area or address first."
    public static let finding = "Finding the place\u{2026}"
    public static let notFound = "We could not find that place. Check the spelling, or add the city or country, for example \u{201C}Andheri, Mumbai\u{201D}."
    public static let failedHome = "Place search is not working right now, so we cannot check this place. Your saved places on the My places page still work."
    public static let failedPlaces = "Place search is not working right now. You can type the latitude and longitude instead."
    public static func foundMany(_ n: Int) -> String { "We found \(n) places with that name. Choose one." }
    public static let chooserHeading = "Which place do you mean?"
}
