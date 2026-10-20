import Foundation

/// The ND-001 forecast check screen (`verification-detail.html`, features.md
/// section 14, changelog C11): the stats and all eight comparison rows.
public enum ForecastCheck {
    public static let notReported = "Not reported by any of our sources"
    public static let notForecast = "Not included. This forecast does not predict casualties."
    public static let footnote = "Each row shows what we forecast next to what our sources have reported since. \u{201C}Not reported\u{201D} means none of our sources has reported that figure yet. That is not the same as a reported zero. If the same hazard happens again later in the same place, we check it as a separate event."
    public static let noMatches = "None of our sources has a matching report."
    public static let loadError = "Could not load reports. Trying again\u{2026}"

    /// The records about central Vietnam (the page's own pattern, case as written).
    public static let pattern = JSRegex("[Vv]ietnam|[\u{0110}\u{0111}]\u{00E0} [Nn]\u{1EB5}ng|[Hh]u\u{1EBF}|[Qq]u\u{1EA3}ng|[Qq]uang")
    static let magRe = JSRegex(#"\bM\s*(\d+(?:\.\d+)?)\b"#)
    static let magnitudeRe = JSRegex(#"\bmagnitude\s+(\d+(?:\.\d+)?)"#, caseInsensitive: true)

    public struct Row: Equatable, Sendable {
        public let metric: String
        public let forecast: String
        public let actual: String
    }

    public struct Result: Sendable {
        public let title: String
        public let kTarget: String
        public let kWindow: String
        public let kEvidence: String
        public let rows: [Row]
        /// The matching records, in the page's order (sort them for display).
        public let matches: [Record]
    }

    public static func title(_ id: String) -> String {
        id == "ND-001" ? "ND-001 \u{00B7} Central Vietnam flood and landslide forecast" : "Checking forecast " + id
    }

    /// `dateOf(v)`: the date part of `fmtWhen(v)`, or "".
    static func dateOf(_ v: String, tz: String?) -> String {
        guard JSDate.ms(v) != nil else { return "" }
        return JS.trim(Format.fmtWhen(v, nil, nil, tz: tz).components(separatedBy: ",")[0])
    }

    static func timeOf(_ v: String, tz: String?) -> String {
        guard JSDate.ms(v) != nil else { return "" }
        return Format.fmtTime(v, tz: tz)
    }

    static func or(_ a: String, _ b: String) -> String { a.isEmpty ? b : a }

    /// `load()` over every record (`getEvents({all:true})`).
    public static func build(_ events: [Record], id: String, tz: String? = nil) -> Result {
        let ev = events.filter { pattern.test([$0.title, $0.country, $0.region, $0.details].joined(separator: " ")) }
        let fc = Format.findEvent(events, id)
        let times = ev.compactMap { JSDate.ms($0.s("startedAt")) }.sorted()
        let firstSeen = times.first.map { JSDate.iso($0) } ?? ""
        let lastSeen = times.last.map { JSDate.iso($0) } ?? ""
        let anyDeaths = ev.contains { $0["deaths"]?.has ?? false }
        let deaths: Double? = anyDeaths ? ev.reduce(0) { n, e in
            let v = e["deaths"]?.jsNumber ?? .nan
            return n + (v.isFinite && v != 0 ? v : 0)
        } : nil
        var places: [String] = []
        for e in ev {
            let p = e.country.isEmpty ? e.region : e.country
            if !p.isEmpty && !places.contains(p) { places.append(p) }
        }
        let mags: [Double] = ev.compactMap { e in
            let m = magRe.exec(e.title) ?? magnitudeRe.exec(e.title)
            return m.flatMap { $0[1] }.map { JS.number($0) }
        }.filter { $0.isFinite }
        var alerts: [String] = []
        for e in ev where !e.alert.isEmpty && !alerts.contains(e.alert) { alerts.append(e.alert) }
        let fcStart = fc?.first("targetStart", "startedAt", "updated")?.jsString ?? ""
        let fcEnd = fc.map { $0.truthy("targetEnd") ? $0.s("targetEnd") : "" } ?? ""
        let fcDuration = fc == nil ? "" : Format.duration(fcStart, fcEnd)
        let actualDuration = or(Format.duration(firstSeen, lastSeen), times.isEmpty ? notReported : "Still developing")
        let widespread = ev.isEmpty ? notReported
            : "\(ev.count) matching report" + (ev.count == 1 ? "" : "s") + " from \(places.count) area" + (places.count == 1 ? "" : "s")
        let strength = !mags.isEmpty ? "Highest magnitude reported: " + JS.numberString(mags.max()!) : or(alerts.joined(separator: " \u{00B7} "), notReported)
        let rows = [
            Row(metric: "Area", forecast: or(fc.map { $0.region.isEmpty ? $0.country : $0.region } ?? "", "Not stated in the recorded forecast"),
                actual: places.isEmpty ? notReported : places.joined(separator: " \u{00B7} ")),
            Row(metric: "Start date", forecast: or(dateOf(fcStart, tz: tz), "Not stated"), actual: or(dateOf(firstSeen, tz: tz), notReported)),
            Row(metric: "Start time", forecast: or(timeOf(fcStart, tz: tz), "Not stated"), actual: or(timeOf(firstSeen, tz: tz), notReported)),
            Row(metric: "Duration", forecast: or(fcDuration, "Not stated"), actual: actualDuration),
            Row(metric: "How widespread", forecast: or(fc?.details ?? "", "Not measured in the recorded forecast"), actual: widespread),
            Row(metric: "Strength or severity", forecast: or(fc?.alert ?? "", "Not stated"), actual: strength),
            Row(metric: "Lives lost", forecast: notForecast, actual: deaths.map { JS.localeString($0) } ?? notReported),
            Row(metric: "Missing people", forecast: notForecast, actual: notReported)
        ]
        return Result(title: title(id), kTarget: or(dateOf(fcStart, tz: tz), "Not stated"), kWindow: or(fcDuration, "Not stated"),
                      kEvidence: "\(ev.count)", rows: rows, matches: ev)
    }
}
