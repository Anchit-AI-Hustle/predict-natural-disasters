import Foundation

/// `PND.SORT_DEFS` and the per-screen extras (logic.md section 8).
public enum Sorts {
    static let riskRank: [String: Int] = ["red": 5, "critical": 5, "orange": 4, "high": 4, "veryhigh": 4,
                                          "moderate": 3, "watch": 2, "green": 1, "low": 1]

    /// `rankOf(e)`: severityRank when finite and > 0, else the alert word's rank.
    public static func rankOf(_ e: Record) -> Int {
        let r = e.jsNumber("severityRank")
        if r.isFinite && r > 0 { return Int(r) }
        return riskRank[e.alert.lowercased()] ?? 0
    }

    /// `textOf(e, ...keys)`: the first truthy key, glossary-expanded and
    /// lower-cased; U+FFFF when none, so missing values sort last.
    public static func textOf(_ e: Record, _ keys: String...) -> String {
        for k in keys {
            if let v = e[k], v.isTruthy { return Glossary.expandAlways(v.jsString).lowercased() }
        }
        return "\u{FFFF}"
    }

    /// A JavaScript-style comparator result; NaN (Infinity minus Infinity)
    /// counts as equal, as it does for `Array.prototype.sort`.
    static func sub(_ a: Double, _ b: Double) -> Double {
        let d = a - b
        return d.isNaN ? 0 : d
    }

    public typealias Comparator = (Record, Record) -> Double

    public struct Def: Sendable {
        public let key: String
        public let label: String
        let cmp: @Sendable (Record, Record) -> Double
    }

    static func chain(_ parts: Double...) -> Double {
        for p in parts where p != 0 { return p }
        return 0
    }

    static func windowEndMs(_ e: Record) -> Double {
        let v = e.ms("targetEnd") ?? 0
        return v == 0 ? .infinity : v
    }

    static let observedRank: [String: Int] = ["CATASTROPHIC": 6, "EXTREME": 5, "SEVERE": 4, "SIGNIFICANT": 3, "MODERATE": 2, "MINOR": 1]

    static func recordedMs(_ e: Record) -> Double {
        JSDate.ms(e.first("recordedAt", "observedAt")?.jsString) ?? .nan
    }

    public static let defs: [String: Def] = {
        var d: [String: Def] = [:]
        func add(_ key: String, _ label: String, _ cmp: @escaping @Sendable (Record, Record) -> Double) {
            d[key] = Def(key: key, label: label, cmp: cmp)
        }
        add("severity", "Most serious first") { a, b in chain(Double(rankOf(b) - rankOf(a)), b.time - a.time) }
        add("newest", "Newest first") { a, b in b.time - a.time }
        add("oldest", "Oldest first") { a, b in a.time - b.time }
        add("deaths", "Most deaths first") { a, b in chain(b.numOf("deaths") - a.numOf("deaths"), b.time - a.time) }
        add("affected", "Most people affected first") { a, b in
            chain(b.numOf("affected") - a.numOf("affected"), b.numOf("displaced") - a.numOf("displaced"), b.time - a.time)
        }
        add("country", "Place (A to Z)") { a, b in
            chain(Double(JS.localeCompare(textOf(a, "place", "country", "region"), textOf(b, "place", "country", "region"))), b.time - a.time)
        }
        add("type", "Type of hazard (A to Z)") { a, b in
            chain(Double(JS.localeCompare(textOf(a, "type"), textOf(b, "type"))), Double(rankOf(b) - rankOf(a)))
        }
        add("source", "Source (A to Z)") { a, b in
            chain(Double(JS.localeCompare(textOf(a, "source"), textOf(b, "source"))), b.time - a.time)
        }
        add("title", "Name (A to Z)") { a, b in Double(JS.localeCompare(textOf(a, "title", "name"), textOf(b, "title", "name"))) }
        add("distance", "Nearest first") { a, b in
            let x = a.num("_d") ?? .infinity, y = b.num("_d") ?? .infinity
            return sub(x, y)
        }
        add("windowEnd", "Ending soonest first") { a, b in sub(windowEndMs(a), windowEndMs(b)) }
        add("yearNew", "Most recent first") { a, b in b.numOf("sort") - a.numOf("sort") }
        add("yearOld", "Earliest first") { a, b in a.numOf("sort") - b.numOf("sort") }
        add("name", "Name (A to Z)") { a, b in Double(JS.localeCompare(textOf(a, "name", "title"), textOf(b, "name", "title"))) }
        add("countDesc", "Most events first") { a, b in b.numOf("count") - a.numOf("count") }
        add("countAsc", "Fewest events first") { a, b in a.numOf("count") - b.numOf("count") }
        // Screen-specific definitions.
        add("nearby", "Distance: nearest first") { _, _ in 0 }
        add("priority", "Most high alerts first") { a, b in chain(b.numOf("high") - a.numOf("high"), b.numOf("count") - a.numOf("count")) }
        add("curated", "Suggested order") { _, _ in 0 }
        add("nameDesc", "Name - Z to A") { a, b in Double(JS.localeCompare(textOf(b, "name", "title"), textOf(a, "name", "title"))) }
        add("recorded", "Date recorded - newest first") { a, b in sub(recordedMs(b), recordedMs(a)) }
        add("hazard", "Hazard type - A to Z") { a, b in
            let x = (a.first("hazard", "type")?.jsString ?? "\u{FFFF}").lowercased()
            let y = (b.first("hazard", "type")?.jsString ?? "\u{FFFF}").lowercased()
            return Double(JS.localeCompare(x, y))
        }
        add("observed", "Actual severity - highest first") { a, b in
            let ra = observedRank[a.s("observedSeverity").uppercased()] ?? 0, rb = observedRank[b.s("observedSeverity").uppercased()] ?? 0
            return chain(Double(rb - ra), sub(recordedMs(b), recordedMs(a)))
        }
        return d
    }()

    public static func label(_ key: String) -> String { defs[key]?.label ?? key }

    // Per-screen key lists (the first is the default).
    public static let eventSorts = ["newest", "severity", "oldest", "deaths", "affected", "country", "type", "source", "title"]
    public static let forecastTabSorts = ["severity", "windowEnd", "newest", "oldest", "country", "type", "title"]
    public static let forecastListSorts = ["newest", "severity", "windowEnd", "oldest", "country", "type", "title"]
    public static let historicalSorts = ["newest", "oldest", "severity", "country", "type", "title"]
    public static let nearbySorts = ["newest", "distance", "severity", "oldest", "type", "title"]
    public static let locationSorts = ["distance"] + eventSorts
    public static let myPlacesSorts = ["nearby", "severity", "newest", "type", "country"]
    public static let regionSorts = ["newest", "priority", "countDesc", "countAsc", "name"]
    public static let sourceSorts = ["curated", "name", "nameDesc"]
    public static let ledgerSorts = ["recorded", "windowEnd", "observed", "hazard", "country", "title"]
    public static let historySorts = ["yearNew", "yearOld", "name", "type"]

    /// A stable sorted copy; an unknown key leaves the order untouched.
    public static func apply(_ list: [Record], _ key: String) -> [Record] {
        guard let def = defs[key] else { return list }
        return stableSort(list, def.cmp)
    }

    public static func stableSort<T>(_ list: [T], _ cmp: (T, T) -> Double) -> [T] {
        list.enumerated().sorted { x, y in
            let c = cmp(x.element, y.element)
            if c < 0 { return true }
            if c > 0 { return false }
            return x.offset < y.offset
        }.map { $0.element }
    }

    /// Compare two records by key (for callers that add their own tie-breaks).
    public static func compare(_ key: String, _ a: Record, _ b: Record) -> Double {
        defs[key]?.cmp(a, b) ?? 0
    }
}
