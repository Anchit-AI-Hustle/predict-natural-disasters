import Foundation

/// The home page's map, tiles, "Live events" card, tables and hazard strip
/// (`index.html render()`, features.md sections 1.3 and 1.6). The page keeps
/// its own comparators, which differ from `SORT_DEFS` (logic.md section 8).
public enum Home {
    /// The card's sort keys (the first is the default), stored under
    /// `pnd_sort_home_sortBy`.
    public static let sortKeys = ["newest", "severity", "oldest", "deaths", "affected", "country", "type", "source", "title"]
    public static let sortScreen = "home_sortBy"

    public static let warningsTileNote = "Issued by agencies, in force now"
    public static let liveEventsHeading = "Live events"
    public static let noWarnings = "No official warning is in force in our sources right now."
    public static let noForecasts = "No open forecasts right now."

    public static let icons: [String: String] = [
        "Earthquake": "\u{2301}", "Wildfire": "\u{1F525}", "Flood": "\u{25CF}", "Drought": "\u{231B}", "Tropical Cyclone": "\u{25C9}",
        "Severe Storm": "\u{25C8}", "Volcano": "\u{25B2}", "Landslide": "\u{25B3}", "Tornado": "\u{2726}", "Extreme Cold": "\u{2744}",
        "Extreme Heat": "\u{2600}", "Tsunami": "\u{2248}"
    ]

    static let rankTable: [String: Int] = ["red": 5, "critical": 5, "orange": 4, "high": 4, "moderate": 3, "watch": 2, "green": 1]

    /// `when(e)`: `updated || targetStart` (no `startedAt`), or 0.
    public static func when(_ e: Record) -> Double { JSDate.ms(e.first("updated", "targetStart")?.jsString) ?? 0 }

    public static func rank(_ e: Record) -> Int {
        let r = e.jsNumber("severityRank")
        if r.isFinite && r > 0 { return Int(r) }
        return rankTable[e.alert.lowercased()] ?? 0
    }

    /// The first truthy key, lower-cased (no glossary expansion), or U+FFFF.
    static func textOf(_ e: Record, _ keys: [String]) -> String {
        for k in keys { if let v = e[k], v.isTruthy { return v.jsString.lowercased() } }
        return "\u{FFFF}"
    }

    public static func compare(_ key: String, _ a: Record, _ b: Record) -> Double {
        let newest = when(b) - when(a)
        switch key {
        case "severity": return Sorts.chain(Double(rank(b) - rank(a)), newest)
        case "oldest": return when(a) - when(b)
        case "deaths": return Sorts.chain(b.numOf("deaths") - a.numOf("deaths"), newest)
        case "affected": return Sorts.chain(b.numOf("affected") - a.numOf("affected"), newest)
        case "country": return Double(JS.localeCompare(textOf(a, ["place", "country", "region"]), textOf(b, ["place", "country", "region"])))
        case "type": return Double(JS.localeCompare(textOf(a, ["type"]), textOf(b, ["type"])))
        case "source": return Double(JS.localeCompare(textOf(a, ["source"]), textOf(b, ["source"])))
        case "title": return Double(JS.localeCompare(textOf(a, ["title"]), textOf(b, ["title"])))
        default: return newest
        }
    }

    public static func sorted(_ list: [Record], _ key: String) -> [Record] {
        let k = sortKeys.contains(key) ? key : "newest"
        return Sorts.stableSort(list) { compare(k, $0, $1) }
    }

    /// Does a record pass the map's hazard filter (`hazardKey`, ignoring case)?
    public static func passes(_ e: Record, hazardFilter: String) -> Bool {
        let h = hazardFilter.lowercased()
        if h.isEmpty || h == "all" { return true }
        return Format.hazardKey(e.type).lowercased() == Format.hazardKey(h).lowercased()
    }

    public struct Render: Sendable {
        /// Live records that pass the hazard filter (the map shows these).
        public let list: [Record]
        public let kEvents: Int
        public let kEventsNote: String
        public let kWarnings: Int
        public let kForecasts: Int
        public let kForecastsNote: String
        public let kCountries: Int
        /// The "Live events" card: the first 5 reports in the card's sort.
        public let liveEvents: [Record]
        /// The 5 newest reports.
        public let latestEvents: [Record]
        /// Warnings in force, most serious first, first 5.
        public let officialWarnings: [Record]
        /// Open forecasts, newest first, first 6.
        public let latestForecasts: [Record]
        public let hazardStrip: [Screens.HazardTile]
    }

    /// `render()` for the live records, a hazard choice and a sort key.
    public static func render(_ live: [Record], hazardFilter: String, sort: String) -> Render {
        let filterOn = !(hazardFilter.isEmpty || hazardFilter.lowercased() == "all")
        let list = live.filter { passes($0, hazardFilter: hazardFilter) }
        let reports = list.filter { !$0.forecast }
        let bad = reports.filter { $0.severity == "Extreme" || $0.severity == "Severe" }.count
        let routine = reports.filter { $0.severity == "Informational" }.count
        let note = !reports.isEmpty && (bad > 0 || routine > 0) ? "\(bad) serious \u{00B7} \(routine) minor"
            : (filterOn ? "Matching the hazard you chose" : "From all our sources")
        let warnAll = Format.officialWarnings(list)
        let fc = sorted(list.filter { $0.forecast && !$0.windowClosed }, "newest")
        let levels: [RiskLevel] = [.extreme, .severe, .high, .moderate, .watch, .low]
        let split = levels.compactMap { l -> String? in
            let n = fc.filter { RiskScale.matches($0, l.rawValue) }.count
            return n > 0 ? "\(n) \(l.label)" : nil
        }
        return Render(list: list, kEvents: reports.count, kEventsNote: note, kWarnings: warnAll.count, kForecasts: fc.count,
                      kForecastsNote: split.isEmpty ? "Recorded for grading" : split.joined(separator: " \u{00B7} "),
                      kCountries: Format.countryCount(reports),
                      liveEvents: Array(sorted(reports, sort).prefix(5)),
                      latestEvents: Array(sorted(reports, "newest").prefix(5)),
                      officialWarnings: Array(sorted(warnAll, "severity").prefix(5)),
                      latestForecasts: Array(fc.prefix(6)),
                      hazardStrip: Screens.hazardStrip(reports))
    }

    /// Latest events row: Time, Location, Event, Source.
    public static func latestEventCells(_ e: Record, tz: String? = nil) -> [String] {
        [Format.fmtDate(e.updated, tz: tz), Format.placeOf(e, "-"), e.type.isEmpty ? "Event" : e.type, e.source]
    }

    /// Official warnings row: Agency, Location, Warning, Ends.
    public static func warningCells(_ e: Record, tz: String? = nil) -> [String] {
        let ends = e.first("expiresAt", "expectedEnd")?.jsString
        return [e.source.isEmpty ? "Official" : e.source, Format.placeOf(e, "-"), e.title, ends.map { Format.fmtDate($0, tz: tz) } ?? "Not stated"]
    }

    /// Latest forecasts row: Starts, Location, Hazard, Risk.
    public static func forecastCells(_ e: Record, tz: String? = nil) -> [String] {
        [Format.fmtWhen(e.first("targetStart", "updated")?.jsString, nil, nil, tz: tz), Format.placeOf(e, "-"),
         e.type.isEmpty ? "Outlook" : e.type, RiskScale.label(of: e)]
    }
}
