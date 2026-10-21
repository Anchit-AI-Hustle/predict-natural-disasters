import Foundation

/// `alert-rules.js` plus the major-event rule from `portal.js` (logic.md section 4,
/// features.md section 16.2). These decide what is worth a notification.
public enum AlertRules {
    public static let nearKm = 30.0
    public static let severeNearKm = 100.0
    public static let recentHours = 72.0
    /// Re-notify the same key only after six hours.
    public static let dedupeMs = 21_600_000.0
    public static let severe = JSRegex("red|orange|severe|extreme|catastrophic", caseInsensitive: true)

    public static let kindLabel = ["Home": "home", "Office": "office", "Family": "family place", "Travel": "travel place",
                            "Current location": "current location"]

    public static func placeLabel(_ p: Place) -> String { "your " + (kindLabel[p.kind] ?? "saved place") }

    public struct Alert: Equatable, Sendable {
        public let key: String
        public let eventId: String
        public let rank: Double
        public let title: String
        public let body: String
        public let url: String
        public let tag: String
    }

    /// `urlFor(e)`, the same rule as `PND.eventUrl`.
    public static func urlFor(_ e: Record) -> String { Format.eventPath(e) }

    /// `roundCoord(v)`: nil for null, undefined or blank; else rounded to 2 decimals.
    public static func roundCoord(_ v: JSONValue?) -> Double? {
        guard let v = v, !v.isNull else { return nil }
        if case .string(let s) = v, s.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        let n = v.jsNumber
        return n.isFinite ? JS.round(n * 100) / 100 : nil
    }

    public static func live(_ e: Record, now: Double) -> Bool {
        if e.forecast || e.isForecast || e.cached { return false }
        if e["live"] == .bool(false) { return false }
        if e.evidenceState == "official-warning" {
            guard let exp = e.ms("expiresAt") else { return true }
            return exp > now
        }
        let latest = max(e.ms("updated") ?? 0, e.ms("startedAt") ?? 0, e.ms("issuedAt") ?? 0)
        return latest > 0 && now - latest <= recentHours * 3_600_000
    }

    /// One record against one place: an alert, or nil.
    public static func alertFor(_ e: Record, _ place: Place, now: Double) -> Alert? {
        guard live(e, now: now), let r = PlaceRisk.riskRow(e, place) else { return nil }
        let level = e.first("alert", "severity")?.jsString ?? ""
        let what = e.type.isEmpty ? "Hazard" : e.type
        var title: String? = nil
        var rank = 0.0
        if r.band == .B && r.containment == true {
            title = "\(what) warning covers \(placeLabel(place))"; rank = 3
        } else if r.band == .A && r.containment == true {
            title = "\(what) reported where \(placeLabel(place)) is"; rank = 3
        } else if r.band == .A, r.claimDistance, let d = r.distanceKm, d <= severeNearKm, severe.test(level) || d <= nearKm {
            title = "\(what) " + JS.numberString(max(1, JS.round(d))) + " km from \(placeLabel(place))"
            rank = 2 - d / 1000
        }
        guard let t = title else { return nil }
        let source = e.source.isEmpty ? "" : " \u{00B7} " + e.source
        let id = e.id
        return Alert(key: id + "|" + r.band.rawValue + "|" + level.lowercased(), eventId: id, rank: rank, title: t,
                     body: (e.title.isEmpty ? what : e.title) + (level.isEmpty ? "" : " \u{00B7} " + level) + source,
                     url: urlFor(e), tag: "pnd-" + id)
    }

    /// Every alert for a set of places: the strongest per record, strongest first.
    public static func alertsFor(_ events: [Record], _ places: [Place], now: Double) -> [Alert] {
        var best: [String: Alert] = [:]
        var order: [String] = []
        for p in places {
            for e in events {
                guard let a = alertFor(e, p, now: now) else { continue }
                if let b = best[a.eventId] {
                    if a.rank > b.rank { best[a.eventId] = a }
                } else {
                    best[a.eventId] = a; order.append(a.eventId)
                }
            }
        }
        return Sorts.stableSort(order.map { best[$0]! }) { a, b in b.rank - a.rank }
    }

    public static let tsunamiRe = JSRegex("tsunami", caseInsensitive: true)
    public static let cycloneRe = JSRegex("cyclone|typhoon|hurricane", caseInsensitive: true)
    public static let severeCycloneRe = JSRegex(#"cat(egory)?\s*[345]|severe|super"#, caseInsensitive: true)

    /// The major global event rule (`evaluateRiskNotifications`, second half).
    public static func majorEventAlerts(_ events: [Record], now: Double) -> [Alert] {
        var out: [Alert] = []
        for e in events {
            if e.forecast || e.isForecast || !e.isLive || e.cached { continue }
            guard let t = JSDate.ms(e.first("updated", "startedAt", "issuedAt")?.jsString), now - t <= recentHours * 3_600_000 else { continue }
            let isRed = e.alert == "Red" && e.sourceType == "official"
            let mag = e.jsNumber("magnitude")
            let isM65 = e.type == "Earthquake" && mag >= 6.5
            let isTsunami = tsunamiRe.test(e.first("type", "title")?.jsString ?? "")
            let isSevereCyclone = cycloneRe.test(e.type) && (severeCycloneRe.test(e.first("severity", "title")?.jsString ?? "") || e.alert == "Red")
            if !isRed && !isM65 && !isTsunami && !isSevereCyclone { continue }
            let country = e.country.isEmpty ? "" : " (" + e.country + ")"
            var title = "Major Alert: " + (e.type.isEmpty ? "Disaster" : e.type)
            if isM65 { title = "Major Earthquake M" + (e["magnitude"]?.jsString ?? "") + country }
            else if isTsunami { title = "Tsunami Alert" + country }
            else if isSevereCyclone { title = "Severe Storm Alert: " + (e.first("title", "type")?.jsString ?? "") }
            else if isRed { title = "Red Alert: " + (e.type.isEmpty ? "Disaster" : e.type) + country }
            let body = (e.first("title", "type")?.jsString ?? "undefined") + " \u{00B7} " + (e.alert.isEmpty ? "" : e.alert + " alert \u{00B7} ") +
                (e.source.isEmpty ? "Official agency" : e.source)
            out.append(Alert(key: "major-" + e.id + "|" + e.alert.lowercased(), eventId: e.id, rank: 0, title: title, body: body,
                             url: Format.eventPath(e), tag: "pnd-major-" + e.id))
        }
        return out
    }

    /// Whether this device posts notifications now: the alerts switch is the
    /// off-switch for every notification, and the OS must allow them. Saved
    /// places are not required: major global events need none.
    public static func notificationsAllowed(switchOn: Bool, permissionGranted: Bool) -> Bool { switchOn && permissionGranted }

    /// The notifications to post now, given what was sent before (`pnd_notified`),
    /// and the updated memory. Same 6-hour de-duplication for both rules.
    public static func plan(events: [Record], places: [Place], seen: [String: Double], now: Double) -> (toSend: [Alert], seen: [String: Double]) {
        var memory = seen
        var send: [Alert] = []
        for a in alertsFor(events, places, now: now) {
            if let t = memory[a.key], now - t <= dedupeMs { continue }
            send.append(a); memory[a.key] = now
        }
        for a in majorEventAlerts(events, now: now) {
            if let t = memory[a.key], now - t <= dedupeMs { continue }
            send.append(a); memory[a.key] = now
        }
        return (send, memory)
    }

    /// The background payload per place: kind and coordinates rounded to two
    /// decimals, first ten with valid coordinates.
    public static func cleanPlaces(_ places: [Place]) -> [(kind: String, lat: Double, lon: Double)] {
        places.compactMap { p -> (String, Double, Double)? in
            guard let la = p.lat, let lo = p.lon, la.isFinite, lo.isFinite else { return nil }
            return (p.kind, JS.round(la * 100) / 100, JS.round(lo * 100) / 100)
        }.prefix(10).map { $0 }
    }
}
