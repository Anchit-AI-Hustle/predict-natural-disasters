import Foundation

/// Text helpers ported from `portal.js` (logic.md section 6).
public enum Format {
    /// The time zone every date is shown in. The site defaults to India time
    /// for everyone (features.md section 17); the app keeps that default and
    /// lets the reader change it in Settings.
    public static var zoneID: String = "Asia/Kolkata"
    public static let defaultZoneID = "Asia/Kolkata"

    /// Injectable clock for every "now" read (logic.md section 1).
    public static var now: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    public static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]

    // MARK: places and names

    private static let trailing = JSRegex(#"[\s,;]+$"#)
    private static let hazardInRe = JSRegex(#"^(flood|drought|wildfire|forest fires?|earthquake|volcano|tropical cyclone)\b.*\bin\b"#, caseInsensitive: true)
    private static let tcRe = JSRegex(#"^tropical cyclone\s"#, caseInsensitive: true)

    public static func tidy(_ v: String) -> String {
        trailing.replace(v) { _ in "" }.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `placeOf(e, fallback)`.
    public static func placeOf(_ e: Record?, _ fallback: String = "") -> String {
        guard let e = e else { return fallback }
        let p = tidy(e.s("place"))
        if !p.isEmpty { return p }
        let t = tidy(e.title).lowercased(), c = tidy(e.country)
        var r = tidy(e.region)
        if !r.isEmpty && (r.lowercased() == t || hazardInRe.test(r) || tcRe.test(r)) { r = "" }
        if !r.isEmpty && !c.isEmpty && !r.lowercased().contains(c.lowercased()) { return r + ", " + c }
        if !r.isEmpty { return r }
        if !c.isEmpty { return c }
        return fallback
    }

    private static let outlookRe = JSRegex(#"^(\d+)-(day|hour) (.+?) risk outlook - (.+)$"#)
    private static let aftershockRe = JSRegex(#"^Aftershock-sequence outlook - (.+)$"#)

    /// `titleOf(e)`: old forecast names rewritten for display.
    public static func titleOf(_ e: Record?) -> String { titleOf(e?.title ?? "") }

    public static func titleOf(_ t: String) -> String {
        if let m = outlookRe.exec(t) {
            return (m[3] ?? "") + " risk in " + (m[4] ?? "") + " - " + (m[1] ?? "") + "-" + (m[2] ?? "") + " forecast"
        }
        if let m = aftershockRe.exec(t), let place = m[1] {
            let digit = place.first.map { $0.isASCII && $0.isNumber } ?? false
            return "Aftershock risk " + (digit ? "" : "near ") + place + " - 7-day forecast"
        }
        return t
    }

    public static let sourceAbbr: [String: String] = [
        "NOAA / National Weather Service": "NOAA/NWS",
        "NOAA National Weather Service": "NOAA/NWS",
        "NOAA National Hurricane Center": "NOAA/NHC",
        "National Weather Service": "NWS",
        "National Hurricane Center": "NHC",
        "USGS Volcano Hazards Program": "USGS Volcano",
        "USGS verified recent snapshot": "USGS (verified)",
        "GDACS verified snapshot": "GDACS (verified)",
        "ReliefWeb (UN OCHA)": "ReliefWeb",
        "Predict Natural Disasters": "This site"
    ]
    private static let derivedRe = JSRegex(#"^(.*?)\s*[·|]\s*derived from\s+(.*)$"#, caseInsensitive: true)
    private static let parenRe = JSRegex(#"\(([A-Z][A-Za-z0-9/&. -]{1,24})\)\s*$"#)
    private static let slashRe = JSRegex(#"\s*/\s*"#)
    private static let clipTrail = JSRegex(#"[\s,;:.·-]+$"#)

    /// `shortSource(name)`: pill text; the full name is the accessibility label.
    public static func shortSource(_ name: String?) -> String {
        let s = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "Source not stated" }
        if let a = sourceAbbr[s] { return a }
        if let m = derivedRe.exec(s) { return clipSource("Derived \u{00B7} " + shortSource(m[2] ?? "")) }
        if let m = parenRe.exec(s), let inner = m[1] { return inner }
        let parts = slashRe.replace(s) { _ in "\u{0}" }.components(separatedBy: "\u{0}")
        if parts.count > 1 && utf16Count(parts[0]) <= 12 { return parts[0] }
        return clipSource(s)
    }

    public static func clipSource(_ s: String) -> String {
        if utf16Count(s) <= 28 { return s }
        return clipTrail.replace(utf16Prefix(s, 27)) { _ in "" } + "\u{2026}"
    }

    public static func utf16Count(_ s: String) -> Int { (s as NSString).length }
    public static func utf16Prefix(_ s: String, _ n: Int) -> String {
        let ns = s as NSString
        return ns.substring(to: min(n, ns.length))
    }

    /// `PND.provenance(e)`: a neutral pill, never a risk colour.
    public static func provenance(_ e: Record) -> String {
        let s = e.evidenceState
        if s == "forecast" || (s.isEmpty && e.forecast) {
            return e.s("forecastKind") == "frozen-benchmark" ? "TEST FORECAST" : "OUR FORECAST"
        }
        if s == "official-warning" { return "OFFICIAL WARNING" }
        return "REPORTED EVENT"
    }

    /// The card's forecast pill text.
    public static func forecastPill(_ e: Record) -> String? {
        guard e.forecast else { return nil }
        return e.s("forecastKind") == "frozen-benchmark" ? "Test case, not made in advance" : "Our forecast, not official"
    }

    // MARK: dates

    /// `tzLabel(tz)`.
    public static func tzLabel(_ tz: String = zoneID) -> String {
        let aliases = ["Asia/Kolkata": "IST", "UTC": "UTC", "America/New_York": "ET", "America/Los_Angeles": "PT",
                       "Europe/London": "UK", "Asia/Dubai": "GST", "Asia/Singapore": "SGT", "Asia/Tokyo": "JST",
                       "Australia/Sydney": "Sydney"]
        return aliases[tz] ?? tz
    }

    public struct Parts { let year: Int, month: Int, day: Int, hour: Int, minute: Int }

    public static func parts(_ ms: Double, _ tz: String) -> Parts {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz) ?? TimeZone(identifier: "UTC")!
        let d = Date(timeIntervalSince1970: ms / 1000)
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: d)
        return Parts(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1, hour: c.hour ?? 0, minute: c.minute ?? 0)
    }

    public static func two(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    public static func clock(_ p: Parts) -> String {
        let h12 = p.hour % 12 == 0 ? 12 : p.hour % 12
        return "\(h12):" + two(p.minute) + (p.hour < 12 ? " AM" : " PM")
    }

    /// `fmtDate(v)`: `dd MMM yyyy, h:mm AM {tzLabel}`, "-" when empty, the
    /// input unchanged when it cannot be parsed.
    public static func fmtDate(_ v: String?, tz: String? = nil) -> String {
        guard let v = v, !v.isEmpty else { return "-" }
        guard let ms = JSDate.ms(v) else { return v }
        return fmtDate(ms: ms, tz: tz)
    }

    public static func fmtDate(ms: Double, tz: String? = nil) -> String {
        let z = tz ?? zoneID
        let p = parts(ms, z)
        return two(p.day) + " " + months[p.month - 1] + " \(p.year), " + clock(p) + " " + tzLabel(z)
    }

    /// `fmtTime(v)`: `h:mm AM {tzLabel}`.
    public static func fmtTime(_ v: String?, tz: String? = nil) -> String {
        guard let v = v, !v.isEmpty else { return "-" }
        guard let ms = JSDate.ms(v) else { return v }
        let z = tz ?? zoneID
        return clock(parts(ms, z)) + " " + tzLabel(z)
    }

    private static let edgeRe = JSRegex(#"^(\d{4})-(\d\d)-(\d\d)T(00:00:00|23:59:59)(\.0+|\.9+)?Z$"#)

    public static func edge(_ x: String?) -> (t: Double, last: Bool)? {
        guard let x = x, let m = edgeRe.exec(x), let y = Int(m[1] ?? ""), let mo = Int(m[2] ?? ""), let d = Int(m[3] ?? "") else { return nil }
        return (Double(JSDate.daysFromCivil(y, mo, d)) * 86_400_000, m[4] == "23:59:59")
    }

    /// `fmtWhen(v, other, role)`: a whole-day window edge is that day for everyone.
    public static func fmtWhen(_ v: String?, _ other: String? = nil, _ role: String? = nil, tz: String? = nil) -> String {
        guard let v = v, !v.isEmpty else { return "-" }
        guard let m = edge(v), (other ?? "").isEmpty || edge(other) != nil else { return fmtDate(v, tz: tz) }
        let day = (m.last || role != "end") ? m.t : m.t - 86_400_000
        let p = parts(day, "UTC")
        return two(p.day) + " " + months[p.month - 1] + " \(p.year)"
    }

    /// `age(v)` against the injectable clock.
    public static func age(_ v: String?, now: Double? = nil) -> String {
        guard let v = v, !v.isEmpty else { return "unknown" }
        guard let t = JSDate.ms(v) else { return "unknown" }
        let m = max(0, JS.round(((now ?? self.now()) - t) / 60000))
        if m < 1 { return "just now" }
        if m < 60 { return JS.numberString(m) + " min ago" }
        if m < 1440 { return JS.numberString(JS.round(m / 60)) + " hr ago" }
        return JS.numberString(JS.round(m / 1440)) + " d ago"
    }

    /// `duration(from, to)`.
    public static func duration(_ from: String?, _ to: String?) -> String {
        guard let a = JSDate.ms(from), let b = JSDate.ms(to), b > a else { return "" }
        let hours = (b - a) / 3_600_000
        if hours < 1 { return "under an hour" }
        let h = JS.round(hours)
        if h < 48 { return JS.numberString(h) + (h == 1 ? " hour" : " hours") }
        let d = JS.round(h / 24)
        return JS.numberString(d) + (d == 1 ? " day" : " days")
    }

    /// `windowText(e)`: "Starts {date} · lasts {duration}".
    public static func windowText(_ e: Record, tz: String? = nil) -> String {
        guard let start = e.first("targetStart", "startedAt", "updated")?.jsString else { return "The source gives no start time" }
        let end = e.truthy("targetEnd") ? e.s("targetEnd") : nil
        let dur = duration(start, end)
        return "Starts " + fmtWhen(start, end, nil, tz: tz) + (dur.isEmpty ? " \u{00B7} length not stated" : " \u{00B7} lasts " + dur)
    }

    /// The forecast table's phone "Dates" cell.
    public static func datesCell(_ e: Record, tz: String? = nil) -> String {
        e.truthy("targetStart") || e.truthy("targetEnd") ? windowText(e, tz: tz) : "No dates recorded"
    }

    // MARK: status and counts

    /// `statusText(meta)`.
    public static func statusText(_ meta: JSONValue?) -> String {
        guard let meta = meta, !meta.isNull else { return "Refreshing" }
        let all = meta["sources"]?.objectValue.map { Array($0.values) } ?? []
        let n = all.filter { $0["ok"]?.isTruthy ?? false }.count
        if meta["live"]?.isTruthy ?? false {
            return "Live \u{00B7} \(n) of \(all.isEmpty ? n : all.count) sources working"
        }
        return "Our data sources are not answering \u{00B7} showing saved copies only"
    }

    /// `sourcesRatio(meta)`: "{ok}/{total}".
    public static func sourcesRatio(_ meta: JSONValue?) -> String {
        let all = meta?["sources"]?.objectValue.map { Array($0.values) } ?? []
        let n = all.filter { $0["ok"]?.isTruthy ?? false }.count
        return "\(n)/\(all.isEmpty ? n : all.count)"
    }

    public static func sourcesWorking(_ meta: JSONValue?) -> Int {
        (meta?["sources"]?.objectValue.map { Array($0.values) } ?? []).filter { $0["ok"]?.isTruthy ?? false }.count
    }

    /// `countryCount(list)`: comma-separated countries, distinct, case-insensitive.
    public static func countryCount(_ list: [Record]) -> Int {
        var s = Set<String>()
        for e in list {
            for c in e.country.components(separatedBy: ",") {
                let t = c.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { s.insert(t.lowercased()) }
            }
        }
        return s.count
    }

    /// `impactText(e)`: truthy deaths, displaced and affected.
    public static func impactText(_ e: Record) -> String {
        var p: [String] = []
        if e.truthy("deaths") { p.append(JS.localeString(e.jsNumber("deaths")) + " deaths") }
        if e.truthy("displaced") { p.append(JS.localeString(e.jsNumber("displaced")) + " displaced") }
        if e.truthy("affected") { p.append(JS.localeString(e.jsNumber("affected")) + " affected") }
        return p.joined(separator: " \u{00B7} ")
    }

    private static let boiler = JSRegex(#"\s*(This is not a deterministic prediction and must not replace official warnings|This is our own estimate, not an official warning)\.?\s*$"#)
    private static let spaces = JSRegex(#"\s+"#)
    private static let firstSentence = JSRegex(#"^.{20,}?[.!?](?=\s+[A-Z(]|$)"#)
    private static let cutTrail = JSRegex(#"[\s,;:\u00b7\x{2014}-]+$"#)

    /// `summary(text, max)`: the first sentence, at most `max` characters.
    public static func summary(_ text: String?, max: Int = 160) -> String {
        var t = boiler.replace(text ?? "") { _ in "" }
        t = spaces.replace(t) { _ in " " }.trimmingCharacters(in: .whitespacesAndNewlines)
        if let m = firstSentence.exec(t), let f = m[0] { t = f }
        if utf16Count(t) <= max { return t }
        let cut = utf16Prefix(t, max) as NSString
        let lastSpace = cut.range(of: " ", options: .backwards).location
        let idx = Swift.max(lastSpace == NSNotFound ? -1 : lastSpace, Int(Double(max) * 0.6))
        return cutTrail.replace(cut.substring(to: Swift.max(0, idx))) { _ in "" } + "\u{2026}"
    }

    /// The card's figures line: reported key facts, else the first sentence of
    /// the impact text or details (features.md section 0.4).
    public static func cardLine(_ e: Record) -> (text: String, isFacts: Bool) {
        let facts = Hazards.keyFactsLine(e, max: 3)
        if !facts.isEmpty { return (facts, true) }
        let impact = impactText(e)
        return (summary(impact.isEmpty ? e.details : impact), false)
    }

    /// `quietNote(e)`.
    public static func quietNote(_ e: Record) -> String {
        guard !e.isLive else { return "" }
        let d = e.jsNumber("quietDays")
        let src = e.source.isEmpty ? "its source" : e.source
        let span = d.isFinite ? JS.numberString(d) + " day" + (d == 1 ? "" : "s") : "some time"
        return "Not updated by \(src) for \(span). It may have ended; check the source for its current status."
    }

    /// `horizonText(meta)`.
    public static func horizonText(_ meta: JSONValue?, tz: String? = nil) -> String {
        guard let h = meta?["forecastHorizon"], let furthest = h["furthestWindowEnds"], furthest.isTruthy else {
            return "There are no open forecasts right now."
        }
        let d = h["daysAhead"]?.jsNumber ?? .nan
        let r = JS.round(d)
        let ahead = d >= 1 ? JS.numberString(r) + " day" + (r == 1 ? "" : "s") : "less than a day"
        let lens = h["windowLengthDays"]?.arrayValue?.map { $0.jsString } ?? []
        var lenText = ""
        if !lens.isEmpty {
            lenText = (lens.count > 1 ? lens.dropLast().joined(separator: ", ") + " or " + lens.last! : lens[0]) +
                " day" + (lens.count == 1 && lens[0] == "1" ? "" : "s")
        }
        return "Our forecasts reach as far as " + fmtWhen(furthest.jsString, nil, "end", tz: tz) + " (" + ahead + " from now)" +
            (lenText.isEmpty ? "" : ". Each one covers " + lenText) +
            ". We do not forecast further ahead than that. It does not mean nothing will happen after that date."
    }

    /// "Forecasts reach as far as" stat: the end with the trailing time removed.
    public static func horizonStat(_ meta: JSONValue?, tz: String? = nil) -> String {
        guard let f = meta?["forecastHorizon"]?["furthestWindowEnds"], f.isTruthy else { return "-" }
        let s = fmtWhen(f.jsString, nil, "end", tz: tz)
        if let r = s.range(of: ", ") { return String(s[..<r.lowerBound]) }
        return s
    }

    public struct ChangeSection: Equatable, Sendable {
        public let title: String
        public let count: Int
        public let rows: [String]
        public let more: Int
    }

    public struct Changes: Equatable, Sendable {
        public let headline: String
        public let sections: [ChangeSection]
    }

    /// `changesHtml(meta)` as structured text.
    public static func changes(_ meta: JSONValue?, tz: String? = nil, now: Double? = nil) -> Changes {
        guard let c = meta?["forecastChanges"], let co = c.objectValue else {
            return Changes(headline: "No changes have been recorded yet.", sections: [])
        }
        let at = co["at"]?.isTruthy == true ? co["at"]!.jsString : nil
        let when = fmtDate(at, tz: tz) + " \u{00B7} " + age(at, now: now)
        let active = co["activeOutlooks"]?.jsString ?? "undefined"
        if co["baseline"]?.isTruthy ?? false {
            return Changes(headline: "First check, " + when + ". " + active + " forecasts are open. There is nothing earlier to compare them with yet.", sections: [])
        }
        var gap = ""
        if let h = co["sinceHours"]?.numberValue, h > 0 {
            gap = " (" + (h < 1 ? JS.numberString(JS.round(h * 60)) + " minutes" : JS.numberString(h) + (h == 1 ? " hour" : " hours")) + " after the check before)"
        }
        let unRaw = co["unavailable"]?.jsNumber ?? .nan
        let un = unRaw.isFinite ? unRaw : 0
        let total = co["total"]?.jsNumber ?? 0
        let totalTruthy = co["total"]?.isTruthy ?? false
        if !totalTruthy && un == 0 {
            return Changes(headline: "Checked " + when + gap + ". None of the " + active + " open forecasts changed their risk level, dates or status.", sections: [])
        }
        let headline = totalTruthy ? JS.numberString(total) + " change" + (total == 1 ? "" : "s") + " across " + active + " open forecasts"
                                   : "no changes across " + active + " open forecasts"
        let caveat = un != 0 ? ", and " + JS.numberString(un) + " that could not be checked" : ""
        let recs = co["records"]?.objectValue ?? [:]
        func section(_ title: String, _ key: String, _ fmt: (Record) -> String) -> ChangeSection? {
            let list = (recs[key]?.arrayValue ?? []).compactMap { Record(json: $0) }
            guard !list.isEmpty else { return nil }
            return ChangeSection(title: title, count: list.count, rows: list.prefix(8).map(fmt), more: max(0, list.count - 8))
        }
        let sections = [
            section("New", "added") { titleOf($0) + " - " + $0["alert"].map { $0.isNull ? "null" : $0.jsString }.orUndefined },
            section("Raised", "raised") { titleOf($0) + " - " + $0["from"].jsOrUndefined + " \u{2192} " + $0["to"].jsOrUndefined },
            section("Lowered", "lowered") { titleOf($0) + " - " + $0["from"].jsOrUndefined + " \u{2192} " + $0["to"].jsOrUndefined },
            section("Dates changed", "windowMoved") { titleOf($0) + " - now ends " + fmtWhen($0.truthy("toEnd") ? $0.s("toEnd") : nil, nil, "end", tz: tz) },
            section("Stopped", "gone") { titleOf($0) + " - the event it followed is no longer reported" },
            section("Ended on schedule", "expired") { titleOf($0) + " - its forecast period ended" },
            section("Could not be checked", "unavailable") { titleOf($0) + " - we could not reach its source this time, so it is unchanged, not withdrawn" }
        ].compactMap { $0 }
        return Changes(headline: "Checked " + when + gap + " \u{00B7} " + headline + caveat + ".", sections: sections)
    }

    /// `hazardOptions(records, selected)`: [(value, label)].
    public static func hazardOptions(_ records: [Record], selected: String) -> [(value: String, label: String)] {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for e in records where !e.type.isEmpty {
            if counts[e.type] == nil { order.append(e.type) }
            counts[e.type, default: 0] += 1
        }
        if !selected.isEmpty && counts[selected] == nil { counts[selected] = 0; order.append(selected) }
        let sorted = order.enumerated().sorted { a, b in
            let ca = counts[a.element]!, cb = counts[b.element]!
            if ca != cb { return ca > cb }
            let c = JS.localeCompare(a.element, b.element)
            return c != 0 ? c < 0 : a.offset < b.offset
        }.map { $0.element }
        return [("", "All hazards (\(records.count))")] + sorted.map { ($0, "\($0) (\(counts[$0]!))") }
    }

    // MARK: links and lookup

    /// `eventUrl(e)`: which detail screen a record opens.
    public static func eventPath(_ e: Record) -> String {
        let id = JS.encodeURIComponent(e.id)
        if e.forecast { return "/forecasts/" + id }
        if e.isOfficial && e.isRedOrOrange { return "/alerts/" + id }
        return "/disasters/" + id
    }

    public static func norm(_ v: String) -> String {
        String(v.lowercased().unicodeScalars.filter { ($0.value >= 0x61 && $0.value <= 0x7A) || ($0.value >= 0x30 && $0.value <= 0x39) }.map { Character($0) })
    }

    /// `findEvent(events, id)`.
    public static func findEvent(_ events: [Record], _ id: String?) -> Record? {
        guard let raw = id, !raw.isEmpty else { return nil }
        let dec = JS.decodeURIComponent(raw) ?? raw
        for w in [raw, dec] { if let hit = events.first(where: { $0.id == w }) { return hit } }
        let n = norm(dec)
        if let hit = events.first(where: { norm($0.id) == n }) { return hit }
        if let hit = events.first(where: { norm($0.title) == n }) { return hit }
        return events.first { e in
            let k = norm(e.id)
            return k.hasSuffix(n) || n.hasSuffix(k)
        }
    }
}

extension Optional where Wrapped == JSONValue {
    /// `String(x)` where x may be undefined.
    public var jsOrUndefined: String {
        switch self {
        case .none: return "undefined"
        case .some(let v): return v.jsString
        }
    }
}

extension Optional where Wrapped == String {
    public var orUndefined: String { self ?? "undefined" }
}
