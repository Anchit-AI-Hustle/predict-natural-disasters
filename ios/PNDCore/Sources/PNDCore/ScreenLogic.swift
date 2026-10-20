import Foundation

/// The per-screen computations, kept here so they run and are tested on any
/// platform. The SwiftUI views only lay these out.
public enum Screens {
    public static func isHighAlert(_ e: Record) -> Bool { ["Red", "Orange", "High"].contains(e.alert) }

    // MARK: Home (features.md section 1.3)

    public struct HomeKPIs: Equatable, Sendable {
        public let liveEvents: Int, liveSub: String
        public let warnings: Int
        public let openForecasts: Int, forecastSub: String
        public let countries: Int
    }

    public static func homeKPIs(_ live: [Record], hazardFilter: String = "") -> HomeKPIs {
        let reports = live.filter { !$0.forecast && (hazardFilter.isEmpty || $0.type.lowercased().contains(hazardFilter.lowercased())) }
        let serious = reports.filter { [.extreme, .severe].contains(RiskScale.level(of: $0)) }.count
        let minor = reports.filter { $0.severity == "Informational" }.count
        let liveSub = !hazardFilter.isEmpty ? "Matching the hazard you chose"
            : (serious > 0 || minor > 0 ? "\(serious) serious \u{00B7} \(minor) minor" : "From all our sources")
        let warnings = live.filter { $0.isOfficial && $0.isRedOrOrange }.count
        let open = live.filter { $0.forecast && !$0.windowClosed }
        let byLevel = RiskLevel.filterOptions.compactMap { l -> String? in
            let n = open.filter { RiskScale.matches($0, l.rawValue) }.count
            return n > 0 ? "\(n) \(l.label)" : nil
        }
        return HomeKPIs(liveEvents: reports.count, liveSub: liveSub, warnings: warnings, openForecasts: open.count,
                        forecastSub: byLevel.isEmpty ? "Recorded for grading" : byLevel.joined(separator: " \u{00B7} "),
                        countries: Format.countryCount(reports))
    }

    public struct HazardTile: Equatable, Sendable { public let type: String; public let count: Int; public let observedOnly: Bool }

    /// "Live events by type": hidden when zero; Earthquake is observed only.
    public static func hazardStrip(_ live: [Record]) -> [HazardTile] {
        Copy.homeHazards.compactMap { t in
            let stem = Hazards.stem(t)
            let n = live.filter { $0.type.lowercased().contains(stem) }.count
            return n > 0 ? HazardTile(type: t, count: n, observedOnly: !Hazards.hazardOf(t).forecastable) : nil
        }
    }

    // MARK: Regions (features.md section 8.1)

    /// Places with current events: non-forecast records grouped by country.
    public static func regionGroups(_ live: [Record]) -> [Record] {
        var groups: [String: (count: Int, high: Int, types: Set<String>, latest: Double)] = [:]
        var order: [String] = []
        for e in live where !e.forecast {
            var names = e.countries
            if names.isEmpty { names = [e.s("sea").isEmpty ? e.country : e.s("sea")] }
            for n in names where !n.isEmpty {
                if groups[n] == nil { order.append(n); groups[n] = (0, 0, [], 0) }
                groups[n]!.count += 1
                if isHighAlert(e) { groups[n]!.high += 1 }
                groups[n]!.types.insert(e.type)
                groups[n]!.latest = max(groups[n]!.latest, e.time)
            }
        }
        return order.map { n in
            let g = groups[n]!
            return Record(["name": .string(n), "title": .string(n), "count": .number(Double(g.count)), "high": .number(Double(g.high)),
                           "types": .number(Double(g.types.count)), "updated": .string(JSDate.iso(g.latest)), "id": .string(n)])
        }
    }

    public static func regionGroupLines(_ g: Record, now: Double? = nil) -> (String, String) {
        let c = Int(g.numOf("count")), h = Int(g.numOf("high")), t = Int(g.numOf("types"))
        return ("\(c) current event" + (c == 1 ? "" : "s") + " \u{00B7} \(h) high alert",
                "\(t) type" + (t == 1 ? "" : "s") + " of hazard \u{00B7} latest " + Format.age(g.updated, now: now))
    }

    /// Region detail match: World matches all; otherwise country, region,
    /// title and details joined contain the name.
    public static func regionMatches(_ e: Record, _ region: String) -> Bool {
        if region.isEmpty || region.lowercased() == "world" { return true }
        return [e.country, e.region, e.title, e.details].joined(separator: " ").lowercased().contains(region.lowercased())
    }

    public static func typeCounts(_ list: [Record]) -> [(type: String, count: Int)] {
        var c: [String: Int] = [:]; var order: [String] = []
        for e in list { let t = e.type.isEmpty ? "Natural hazard" : e.type; if c[t] == nil { order.append(t) }; c[t, default: 0] += 1 }
        return Sorts.stableSort(order.map { ($0, c[$0]!) }) { a, b in Double(b.1 - a.1) }.map { (type: $0.0, count: $0.1) }
    }

    /// The synthetic enrichment context for region, location and hazard screens.
    public static func syntheticRecord(title: String, country: String, region: String, type: String, updated: String,
                                       lat: Double?, lon: Double?, source: String) -> Record {
        var raw: [String: JSONValue] = ["title": .string(title), "country": .string(country), "region": .string(region),
                                        "type": .string(type), "updated": .string(updated), "source": .string(source), "forecast": .bool(false)]
        if let la = lat, let lo = lon { raw["lat"] = .number(la); raw["lon"] = .number(lo) }
        return Record(raw)
    }

    // MARK: Hazard detail

    public static let hazardOptions = ["Flood", "Earthquake", "Wildfire", "Volcano", "Tropical Cyclone", "Drought", "Landslide", "Severe Storm", "Tornado", "Extreme Cold"]

    public static func hazardMatches(_ e: Record, hazard: String, region: String) -> Bool {
        let target = hazard.lowercased().replacingOccurrences(of: "wildfire", with: "wild").replacingOccurrences(of: "volcano", with: "volcan")
        let first = target.components(separatedBy: " ")[0]
        return e.type.lowercased().contains(first) && (region.isEmpty || Search.matchesPlace(e, region.lowercased()))
    }

    // MARK: nearby lists

    /// Records within `km` of a centre, with `_d` set for the distance sort.
    public static func nearby(_ all: [Record], lat: Double, lon: Double, withinKm: Double, exclude: String? = nil, filter: (Record) -> Bool) -> [Record] {
        all.compactMap { x -> Record? in
            guard x.id != exclude, filter(x), let la = x.lat, let lo = x.lon else { return nil }
            let d = Geo.distanceKm(lat, lon, la, lo)
            return d < withinKm ? x.with(["_d": .number(d)]) : nil
        }
    }

    // MARK: Forecast detail (features.md section 7.4)

    public struct ForecastChecks: Sendable {
        public let ended: Bool
        public let timingWhy: String
        public let geoWhy: String
        public let hazardValue: String
        public let hazardWhy: String
        public let evidenceValue: String
        public let evidenceWhy: String
        public let nearby: [Record]
        public let trigger: String
        public let exposure: String
        public let verification: String
        public let kind: String
        public let severity: String
        public let advance: String
    }

    public static func placeText(_ e: Record) -> String {
        if !e.country.isEmpty { return e.country }
        if !e.region.isEmpty { return "the area covered by " + e.region }
        return "the forecast area"
    }

    public static func dayOf(_ iso: String?, _ other: String?, _ role: String? = nil, tz: String?) -> String? {
        guard JSDate.ms(iso) != nil else { return nil }
        let s = Format.fmtWhen(iso, other, role, tz: tz)
        if let r = s.range(of: ",", options: .backwards) { return String(s[..<r.lowerBound]) }
        return s
    }

    public static func forecastChecks(_ e: Record, feed: [Record], now: Double, tz: String? = nil) -> ForecastChecks {
        let start = e.truthy("targetStart") ? e.s("targetStart") : nil, end = e.truthy("targetEnd") ? e.s("targetEnd") : nil
        let a = dayOf(start, end, tz: tz), b = dayOf(end, start, "end", tz: tz)
        let range = (a != nil && b != nil) ? (a == b ? a! : a! + " and " + b!) : (a ?? b ?? "the stated dates")
        var span = "the stated dates"
        if let a = a, let b = b {
            let days = max(1, Int(JS.round(((JSDate.ms(end) ?? 0) - (JSDate.ms(start) ?? 0)) / 86_400_000)))
            span = a == b ? a : "\(a) to \(b) (\(days) day" + (days == 1 ? "" : "s") + ")"
        }
        let ended = (JSDate.ms(end).map { $0 < now }) ?? false
        let place = placeText(e)
        let m = Copy.mechanism(e.type)
        let src = e.truthy("forecastOf") ? Format.findEvent(feed, e.s("forecastOf")) : nil
        var report = "a current " + (e.source.isEmpty ? "official" : e.source) + " report"
        if let s = src {
            report = "the \(s.source) \(s.type.lowercased()) report for " + Format.placeOf(s, place) +
                (s.alert.isEmpty ? "" : ", at alert level " + s.alert) + ", last updated " + Format.fmtDate(s.updated, tz: tz)
        }
        let agency = JSRegex("derived from\\s+(.+)$", caseInsensitive: true).exec(e.source)?[1] ?? (e.source.isEmpty ? "an official source" : e.source)
        let kindRaw = e.s("forecastKind")
        let trigger: String
        if kindRaw == "frozen-benchmark" {
            trigger = "This is our test case. We locked it while the outcome was still unknown, so we can check it afterwards without the benefit of hindsight. But we wrote it after its forecast period had already started, so it did not predict the start. The cause it describes is \(m.trigger)."
        } else if src != nil {
            trigger = "We did not make this forecast on our own. It follows \(report). The cause behind it is \(m.trigger). It is not a prediction made before that report. It says what may follow while the report stays current."
        } else {
            trigger = "This forecast follows a report from \(agency) that is no longer in our current data. The cause behind it is \(m.trigger)."
        }
        let exposure = "In \(place): " + m.exposure.prefix(1).lowercased() + m.exposure.dropFirst()
        let verification = kindRaw == "model-advance" && e.truthy("verificationRule")
            ? e.s("verificationRule") + " The result is shown on the track record page."
            : "We will check it only against what others report in \(place) between \(range). Rain, or a warning from another agency, does not make this forecast correct on its own. Damage or harm must be reported inside that area and during those dates."
        let timingWhy = ended ? "The forecast period ran to " + (b ?? "its end") + " and has ended. It is now waiting to be checked."
            : "Runs \(span). It stays open until the end of that period, whatever happens before then."
        let geoWhy = "Set to \(place) when we made the forecast, and never widened. Damage just outside it does not count."
        var close: [Record] = []
        if let la = e.lat, let lo = e.lon {
            close = Array(Sorts.apply(nearby(feed, lat: la, lon: lo, withinKm: 1000, exclude: e.id) { $0.isOfficial }, "newest").prefix(9))
        }
        func fam(_ t: String) -> String {
            JSRegex("aftershock|earthquake", caseInsensitive: true).test(t) ? "earthquake" : (t.lowercased().components(separatedBy: "/")[0].trimmingCharacters(in: .whitespaces))
        }
        let from = e.ms("targetStart") ?? 0
        let match = close.filter { x in
            !x.forecast && x.id != e.s("forecastOf") && fam(x.type) == fam(e.type) && (JSDate.ms(x.first("startedAt", "updated")?.jsString) ?? 0) >= from
        }
        let tl = e.type.lowercased()
        let hazardWhy = match.isEmpty
            ? "No official \(tl) report within 1,000 km yet. This will change as soon as one of our sources reports one."
            : "\(match.count) official \(tl) report" + (match.count == 1 ? "" : "s") + " within 1,000 km of this forecast. This shows the hazard is there. It does not show that it caused damage."
        let evidenceWhy = close.isEmpty ? "No official reports near this area right now."
            : "\(close.count) official report" + (close.count == 1 ? "" : "s") + " from our sources near this area, for any kind of hazard."
        let kind = Copy.forecastKinds[kindRaw] ?? (e.forecast ? "Our own estimate" : "Reported event")
        let sev = e.severity.isEmpty ? "Not assessed" : e.severity + (e.truthy("severityRank") ? " (level " + e.s("severityRank") + " of 5)" : "")
        var advance = "-"
        if let h = Hazards.leadTimeHours(e) {
            let r = Int(JS.round(h))
            advance = h <= 0 ? "None. The forecast period had already started when we made this."
                : h < 48 ? "\(r)" + (r == 1 ? " hour" : " hours") + " before the forecast period"
                : JS.numberString(JS.round(h / 24)) + " days before the forecast period"
        }
        return ForecastChecks(ended: ended, timingWhy: timingWhy, geoWhy: geoWhy,
                              hazardValue: match.isEmpty ? "None yet" : "\(match.count) reported", hazardWhy: hazardWhy,
                              evidenceValue: close.isEmpty ? "None right now" : "\(close.count) nearby report" + (close.count == 1 ? "" : "s"),
                              evidenceWhy: evidenceWhy, nearby: close, trigger: trigger, exposure: exposure, verification: verification,
                              kind: kind, severity: sev, advance: advance)
    }

    // MARK: Forecast calendar (features.md section 4.2)

    public struct CalendarBar: Sendable, Identifiable {
        public var id: String { record.id + "|" + String(start) }
        public let record: Record
        public let left: Double, width: Double
        public let live: Bool
        public let label: String
        public let start: Double
    }

    public struct Calendar: Sendable {
        public let days: [Double]
        public let from: Double, to: Double
        public let nowPct: Double
        public let groups: [(type: String, bars: [CalendarBar])]
    }

    /// The day axis from local midnight today to min(today+15d, max(today+4d, lastEnd+1d)).
    public static func calendar(_ list: [Record], now: Double, tz: String? = nil) -> Calendar {
        let day = 86_400_000.0
        var cal = Foundation.Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz ?? Format.zoneID) ?? TimeZone(identifier: "UTC")!
        let from = cal.startOfDay(for: Date(timeIntervalSince1970: now / 1000)).timeIntervalSince1970 * 1000
        let ends = list.compactMap { $0.ms("targetEnd") }
        let last = ends.max() ?? from + 3 * day
        let to = min(from + 15 * day, max(from + 4 * day, last + day))
        let span = to - from
        var days: [Double] = []
        var t = from
        while t < to { days.append(t); t += day }
        func pct(_ x: Double) -> Double { max(0, min(100, (x - from) / span * 100)) }
        var groups: [String: [Record]] = [:]
        for e in list { groups[e.type.isEmpty ? "Other" : e.type, default: []].append(e) }
        let out = groups.keys.sorted().map { type -> (String, [CalendarBar]) in
            let items = Sorts.stableSort(groups[type]!) { a, b in
                Sorts.sub(JSDate.ms(a.first("targetStart", "startedAt")?.jsString) ?? .nan, JSDate.ms(b.first("targetStart", "startedAt")?.jsString) ?? .nan)
            }
            return (type, items.map { e in
                let s = JSDate.ms(e.first("targetStart", "startedAt")?.jsString) ?? from
                let en = e.ms("targetEnd") ?? (s + day)
                let left = pct(s), right = pct(en)
                return CalendarBar(record: e, left: left, width: max(1.4, right - left), live: now >= s && now <= en,
                                   label: dayRange(s, en, tz: tz), start: s)
            })
        }
        return Calendar(days: days, from: from, to: to, nowPct: pct(now), groups: out.map { (type: $0.0, bars: $0.1) })
    }

    public static func dayRange(_ a: Double, _ b: Double, tz: String?) -> String {
        func f(_ t: Double) -> String {
            let p = Format.parts(t, tz ?? Format.zoneID)
            return "\(p.day) " + Format.months[p.month - 1].prefix(3)
        }
        let x = f(a), y = f(b)
        return x == y ? x : x + " - " + y
    }

    public static func dayLabel(_ t: Double, tz: String? = nil) -> (dow: String, day: Int, mon: String) {
        var cal = Foundation.Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz ?? Format.zoneID) ?? TimeZone(identifier: "UTC")!
        let d = Date(timeIntervalSince1970: t / 1000)
        let c = cal.dateComponents([.weekday, .day, .month], from: d)
        let dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return (dows[((c.weekday ?? 1) - 1) % 7], c.day ?? 1, String(Format.months[(c.month ?? 1) - 1].prefix(3)))
    }

    // MARK: Our sources (features.md section 10.1)

    public static let families: [(String, JSRegex)] = [
        ("earthquake", JSRegex(#"\b(?:earthquakes?|seismic|quakes?)\b"#, caseInsensitive: true)),
        ("tropical-cyclone", JSRegex(#"\b(?:cyclones?|hurricanes?|typhoons?|tropical storms?)\b"#, caseInsensitive: true)),
        ("flood", JSRegex(#"\b(?:floods?|flooding|inundation|flash.?floods?)\b"#, caseInsensitive: true)),
        ("landslide", JSRegex(#"\b(?:landslides?|mudslides?|slope failure)\b"#, caseInsensitive: true)),
        ("wildfire", JSRegex(#"\b(?:wildfires?|bushfires?|forest fires?|fires?)\b"#, caseInsensitive: true)),
        ("volcano", JSRegex(#"\b(?:volcano|volcanoes|volcanic|volcan\w*)\b"#, caseInsensitive: true)),
        ("drought", JSRegex(#"\b(?:droughts?)\b"#, caseInsensitive: true)),
        ("extreme-heat", JSRegex(#"\b(?:heat|heatwaves?|extreme heat)\b"#, caseInsensitive: true)),
        ("severe-weather", JSRegex(#"\b(?:storms?|tornado(?:es)?|winds?|hail|winter)\b"#, caseInsensitive: true))
    ]

    /// `PNDObserved.familiesOf(type, '')[0]`.
    public static func familyOf(_ type: String) -> String {
        families.first { $0.1.test(type) }?.0 ?? "other"
    }

    public struct ProviderCard: Sendable, Identifiable {
        public var id: String { label }
        public let statusText: String
        public let statusKind: String
        public let label: String
        public let hazards: String, reach: String, lists: String, absence: String, input: String
        public let footer: String
        public let endpoint: String?
    }

    public static func providerCards(_ meta: JSONValue?, sort: String, tz: String? = nil) -> (summary: String, cards: [ProviderCard])? {
        let ps = meta?["scan"]?["providers"]?.arrayValue ?? []
        if ps.isEmpty { return nil }
        let name: (JSONValue) -> String = { p in p["label"]?.isTruthy == true ? p["label"]!.jsString : (p["provider"]?.jsString ?? "") }
        var rs = ps
        if sort == "name" { rs = Sorts.stableSort(ps) { Double(JS.localeCompare(name($0), name($1))) } }
        if sort == "nameDesc" { rs = Sorts.stableSort(ps) { Double(JS.localeCompare(name($1), name($0))) } }
        var hz: [String: Bool] = [:]
        for p in ps {
            for h in p["hazards"]?.arrayValue ?? [] {
                let f = familyOf(h.jsString)
                if f == "other" { continue }
                if hz[f] == nil { hz[f] = false }
                if p["completeness"]?.stringValue == "exhaustive" && p["recordsObservations"] != .bool(false) { hz[f] = true }
            }
        }
        let blind = hz.keys.filter { !hz[$0]! }.sorted().map { $0.replacingOccurrences(of: "-", with: " ") }
        let blindText = blind.count > 1 ? blind.dropLast().joined(separator: ", ") + " and " + blind.last! : blind.joined()
        let answered = ps.filter { $0["status"]?.stringValue == "SCANNED" }.count
        let partial = ps.filter { $0["status"]?.stringValue == "INCOMPLETE_SCAN" }.count
        let summary = "\(answered) of \(ps.count) sources answered in full this time" + (partial > 0 ? ", and \(partial) in part" : "") + ". " +
            (blind.isEmpty ? "For every hazard listed here, at least one source gives a complete list of disasters that have happened. So if that source reports nothing, that is real evidence."
             : "For \(blindText), none of our sources gives a complete list of disasters that have happened. So we cannot say that no such disaster happened, only that none was reported.")
        let states = ["SCANNED": ("ok", "Answered this time"), "INCOMPLETE_SCAN": ("warn", "Answered in part"),
                      "DATA_UNAVAILABLE": ("bad", "Did not answer"), "NOT_ATTEMPTED": ("muted", "Not checked this time")]
        let cards = rs.map { p -> ProviderCard in
            let r = Record(p.objectValue ?? [:])
            let st = states[r.s("status")] ?? ("muted", r.s("status").isEmpty ? "Status not recorded" : r.s("status"))
            let reach = !r.s("geographicCoverage").isEmpty ? r.s("geographicCoverage") : (p["scope"]?["kind"]?.stringValue == "global" ? "Global" : "")
            let basis = r.s("completenessBasis")
            let absence: String
            if p["recordsObservations"] == .bool(false) {
                absence = "It lists warnings or published statuses, not observations of what happened. So if it lists nothing, that does not mean no disaster happened."
            } else if r.s("completeness") == "exhaustive" {
                absence = "It lists every event within its stated limits. So if it reports nothing, that is real evidence that nothing happened within those limits. " + basis
            } else {
                absence = "It does not list every event. So if it reports nothing, that is not evidence that nothing happened. " + basis
            }
            let input = r.s("inputKind") == "forecast" ? "It says what is expected, so a forecast can be made from it. " + r.s("inputBasis")
                : r.s("inputKind") == "observation" ? "It reports only what has already happened, so no forecast can be made from it. " + r.s("inputBasis")
                : "Not recorded, so we cannot say whether a forecast could be made from it."
            var counted: [String] = []
            if let n = p["recordsEvaluated"]?.numberValue { counted.append(JS.numberString(n) + " reports read") }
            if let n = p["recordsServed"]?.numberValue { counted.append(JS.numberString(n) + " shown on this site") }
            let footer = (counted.isEmpty ? "No count recorded this time" : counted.joined(separator: " \u{00B7} ")) +
                (r.truthy("failureReason") ? " \u{00B7} " + r.s("failureReason") : "") +
                (r.truthy("dataFreshness") ? " \u{00B7} latest data from " + Format.fmtDate(r.s("dataFreshness"), tz: tz) : "")
            let hz = (p["hazards"]?.arrayValue ?? []).map { $0.jsString }.joined(separator: ", ")
            return ProviderCard(statusText: st.1, statusKind: st.0, label: name(p), hazards: hz.isEmpty ? "Not stated" : hz,
                                reach: reach.isEmpty ? "Not stated" : reach, lists: r.s("coverageResolution").isEmpty ? "Not stated" : r.s("coverageResolution"),
                                absence: absence.trimmingCharacters(in: .whitespaces), input: input.trimmingCharacters(in: .whitespaces),
                                footer: footer, endpoint: r.truthy("endpoint") ? r.s("endpoint") : nil)
        }
        return (summary, cards)
    }

    // MARK: Insights (features.md section 12)

    public struct InsightBar: Sendable { public let type: String; public let count: Int; public let countries: Int; public let widthPct: Int }

    public static func insightBars(_ live: [Record]) -> [InsightBar] {
        let obs = live.filter { !$0.forecast }
        let tops = Array(typeCounts(obs).prefix(5))
        let mx = tops.first?.count ?? 1
        return tops.map { t in
            let cs = Format.countryCount(obs.filter { ($0.type.isEmpty ? "Natural hazard" : $0.type) == t.type })
            return InsightBar(type: t.type, count: t.count, countries: cs, widthPct: max(4, Int(JS.round(Double(t.count) / Double(mx) * 100))))
        }
    }

    // MARK: Calamities

    public static func calamityMatches(_ e: Record, text: String, country: String, hazard: String, level: String) -> Bool {
        let blob = [e.title, e.country, e.region, e.type, e.source].joined(separator: " ").lowercased()
        return (text.isEmpty || blob.contains(text.lowercased())) && (country.isEmpty || blob.contains(country.lowercased()))
            && (hazard.isEmpty || e.type.lowercased().contains(hazard.lowercased())) && RiskScale.matches(e, level)
    }

    /// Source status rows: `KEY` upper-cased with `_` as a space.
    public static func sourceRows(_ meta: JSONValue?, tz: String? = nil) -> [(name: String, ok: Bool, detail: String, checked: String)] {
        let src = meta?["sources"]?.objectValue ?? [:]
        return src.keys.sorted().map { k in
            let v = src[k]!
            let ok = v["ok"]?.isTruthy ?? false
            var detail = ok ? "Working" : "Not answering"
            if let w = v["window"], w.isTruthy { detail += " \u{00B7} " + w.jsString }
            if let er = v["error"], er.isTruthy { detail += " \u{00B7} " + er.jsString }
            let checked = v["checkedAt"]?.isTruthy == true ? Format.fmtDate(v["checkedAt"]!.jsString, tz: tz) : "-"
            return (k.uppercased().replacingOccurrences(of: "_", with: " "), ok, detail, checked)
        }
    }

    /// The figure shown for an impact count: grouped number, or "Not reported"
    /// (rule 8: a reported 0 shows 0).
    public static func impactFigure(_ e: Record, _ key: String) -> String {
        guard let n = e.num(key) else { return "Not reported" }
        return JS.localeString(n)
    }
}
