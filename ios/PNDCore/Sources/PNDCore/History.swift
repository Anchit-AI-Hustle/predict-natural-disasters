import Foundation

/// The static past-disasters timeline (`history-data.js`), parsed from the
/// site's own file so the two can never drift. The app bundles a copy of
/// that file at build time (see ios/scripts/copy-web-assets.sh).
public struct PastDisaster: Hashable, Sendable, Identifiable {
    public let year: String
    public let sort: Double
    public let type: String
    public let name: String
    public let location: String
    public let severity: String
    public let summary: String
    public var id: String { slug }

    public var slug: String { History.slug(name) }

    /// As a record, so the shared search and sorts apply to it.
    public var record: Record {
        Record(["year": .string(year), "sort": .number(sort), "type": .string(type), "name": .string(name),
                "title": .string(name), "location": .string(location), "severity": .string(severity), "summary": .string(summary),
                "id": .string(slug)])
    }

    /// "Catastrophic" uses the severe style, anything else the high style.
    public var badgeLevel: RiskLevel { severity == "Catastrophic" ? .severe : .high }
}

public enum History {
    public static func slug(_ s: String) -> String {
        let lower = s.lowercased()
        var out = ""
        var dash = false
        for u in lower.unicodeScalars {
            if (u.value >= 0x61 && u.value <= 0x7A) || (u.value >= 0x30 && u.value <= 0x39) {
                out.unicodeScalars.append(u); dash = false
            } else if !dash { out += "-"; dash = true }
        }
        while out.hasPrefix("-") { out.removeFirst() }
        while out.hasSuffix("-") { out.removeLast() }
        return out
    }

    public static let keyRe = JSRegex(#"([{,]\s*)([A-Za-z_]+):"#)

    /// Parses `window.PND_HISTORY=[{year:"...",...}, ...];`.
    public static func parse(js: String) -> [PastDisaster] {
        guard let a = js.firstIndex(of: "["), let b = js.lastIndex(of: "]") else { return [] }
        let body = String(js[a...b])
        let json = keyRe.replace(body) { g in (g[1] ?? "") + "\"" + (g[2] ?? "") + "\":" }
        guard let v = try? JSONValue.parse(Data(json.utf8)), let arr = v.arrayValue else { return [] }
        return arr.compactMap { x in
            let r = Record(x.objectValue ?? [:])
            guard !r.s("name").isEmpty else { return nil }
            return PastDisaster(year: r.s("year"), sort: r.numOf("sort"), type: r.s("type"), name: r.s("name"),
                                location: r.s("location"), severity: r.s("severity"), summary: r.s("summary"))
        }
    }

    /// Resolution order: slug of the name, the exact name, a numeric index,
    /// then a name containing the key.
    public static func find(_ list: [PastDisaster], _ key: String) -> PastDisaster? {
        if let e = list.first(where: { $0.slug == key || $0.name == key }) { return e }
        if !key.isEmpty, key.allSatisfy({ $0.isASCII && $0.isNumber }), let i = Int(key), i < list.count { return list[i] }
        return list.first { $0.name.lowercased().contains(key.lowercased()) }
    }

    /// Similar past disasters: same first hazard word or same first location part.
    public static func related(_ list: [PastDisaster], to e: PastDisaster) -> [PastDisaster] {
        let hz = e.type.components(separatedBy: "/")[0].trimmingCharacters(in: .whitespaces)
        let loc = e.location.components(separatedBy: ",")[0]
        return list.filter { $0 != e && ($0.type.contains(hz) || $0.location.components(separatedBy: ",")[0] == loc) }
    }

    public static let notice = "No complete list of every natural disaster in Earth\u{2019}s history exists. This timeline starts with early disasters that have good archaeological, geological or written evidence. It becomes more complete from the time modern instruments began recording. Its first entry is not \u{201C}the first natural disaster ever\u{201D}."
    public static let evidence = "We keep this entry for background and comparison. It is not a current event. How sure we can be about it depends on the evidence that survives: old writings, rocks and soil, ruins or instrument readings."
    public static let filters = ["Earthquake", "Flood", "Volcanic", "Cyclone", "Wildfire", "Tsunami"]
}

/// "Which country am I in", worked out on the device from the site's own
/// `/world-countries.json` (the position is never sent anywhere to be named).
public struct CountryLocator: Sendable {
    public let features: [(name: String, geometry: JSONValue)]

    public init(geoJSON: JSONValue) {
        features = (geoJSON["features"]?.arrayValue ?? []).compactMap { f in
            guard let n = f["properties"]?["n"]?.stringValue, let g = f["geometry"] else { return nil }
            return (n, g)
        }
    }

    public init?(data: Data) {
        guard let v = try? JSONValue.parse(data) else { return nil }
        self.init(geoJSON: v)
    }

    public var count: Int { features.count }

    public func country(lat: Double, lon: Double) -> String? {
        features.first { Geo.geometryContains($0.geometry, lat, lon) == true }?.name
    }

    /// The country outlines for the dark "Map" base layer.
    public var outlines: [(name: String, geometry: JSONValue)] { features }
}
