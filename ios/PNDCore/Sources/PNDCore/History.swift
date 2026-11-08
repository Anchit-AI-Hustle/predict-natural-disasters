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
    /// The archive's own facts (changelog C46): the date, the toll with its note, and the source.
    public var date: String = ""
    public var deaths: String = ""
    public var deathsNote: String = ""
    public var source: String = ""
    public var sourceUrl: String = ""
    public var id: String { slug }

    /// The date the entry is dated by: its `date`, else its year.
    public var when: String { date.isEmpty ? year : date }

    /// "Lives lost": the toll and its note, the note alone, or "No reliable figure."
    public var deathsText: String {
        if !deaths.isEmpty { return deaths + (deathsNote.isEmpty ? "" : ". " + deathsNote) }
        return deathsNote.isEmpty ? "No reliable figure." : deathsNote
    }

    /// What its severity means (`PND_HISTORY_SEVERITY`).
    public var severityMeaning: String { severity + ": " + (History.severityMeanings[severity] ?? "") }

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
    /// `PND_HISTORY_SEVERITY` (history-data.js).
    public static let severityMeanings = [
        "Catastrophic": "A commonly cited toll of 10,000 deaths or more, or damage on a national scale.",
        "Major": "A disaster with a toll below 10,000 or with severe regional damage."
    ]

    /// `PND.slug`: accents folded first, so "Tōhoku" is "tohoku" (changelog C46).
    public static func slug(_ s: String) -> String {
        legacySlug(String(String.UnicodeScalarView(s.decomposedStringWithCanonicalMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) })))
    }

    /// `PND.legacySlug`: the slug history pages were published under before accents were folded.
    public static func legacySlug(_ s: String) -> String {
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
            var p = PastDisaster(year: r.s("year"), sort: r.numOf("sort"), type: r.s("type"), name: r.s("name"),
                                 location: r.s("location"), severity: r.s("severity"), summary: r.s("summary"))
            p.date = r.s("date"); p.deaths = r.s("deaths"); p.deathsNote = r.s("deathsNote"); p.source = r.s("source"); p.sourceUrl = r.s("sourceUrl")
            return p
        }
    }

    /// Resolution order: slug of the name, the exact name, a numeric index,
    /// then a name containing the key.
    public static func find(_ list: [PastDisaster], _ key: String) -> PastDisaster? {
        // The slug, the name, the slug published before accents were folded, or an index; then the key's own slug (changelog C46).
        func found(_ k: String) -> PastDisaster? {
            if let e = list.first(where: { $0.slug == k || $0.name == k }) { return e }
            if let e = list.first(where: { legacySlug($0.name) == k }) { return e }
            if !k.isEmpty, k.allSatisfy({ $0.isASCII && $0.isNumber }), let i = Int(k), i < list.count { return list[i] }
            return nil
        }
        let k = JS.trim(key)
        if k.isEmpty { return nil }
        return found(k) ?? found(slug(k))
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
