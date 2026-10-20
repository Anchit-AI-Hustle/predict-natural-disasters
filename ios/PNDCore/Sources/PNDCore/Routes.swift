import Foundation

/// Every screen the app can open, and the web paths that map to them
/// (features.md section 0.1, `PND.canonicalDetailUrl`).
public enum Route: Hashable, Sendable {
    case home, map, alerts, forecasts, myPlaces, trackRecord
    case event(String), alert(String), calamity(String), forecast(String)
    case region(String)
    case location(name: String, lat: Double?, lon: Double?, level: String?, country: String?, cc: String?)
    case hazard(type: String, region: String?)
    case history(String)
    case source(String)
    case collection(CollectionView, query: String?)
    case calamities, regions, insights, methodology, about, settings, verification, verificationDetail, more

    /// The record's own detail screen (`eventUrl`).
    public static func detail(for e: Record) -> Route {
        if e.forecast { return .forecast(e.id) }
        if e.isOfficial && e.isRedOrOrange { return .alert(e.id) }
        return .event(e.id)
    }

    /// Parses a site URL or path. Anything that is not an app route returns nil
    /// (a notification then opens My places, as `sw.js` does).
    public static func parse(_ url: URL) -> Route? {
        if let host = url.host, host != API.siteHost && host != "www." + API.siteHost { return nil }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: true)
        var items: [String: String] = [:]
        for i in comps?.queryItems ?? [] { if items[i.name] == nil { items[i.name] = i.value ?? "" } }
        // Use the percent-encoded path so an id with an encoded slash survives.
        let rawPath = comps?.percentEncodedPath ?? url.path
        let parts = rawPath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        func dec(_ s: String) -> String { s.removingPercentEncoding ?? s }
        func q(_ k: String) -> String? { items[k].flatMap { $0.isEmpty ? nil : $0 } }
        guard let first = parts.first else { return .home }
        if parts.count >= 2 {
            let rest = dec(parts.dropFirst().joined(separator: "/"))
            switch first {
            case "disasters": return .event(rest)
            case "alerts": return .alert(rest)
            case "calamities": return .calamity(rest)
            case "forecasts": return .forecast(rest)
            case "regions": return .region(rest)
            case "locations":
                return .location(name: rest, lat: q("lat").flatMap(Double.init), lon: q("lon").flatMap(Double.init),
                                 level: q("level"), country: q("country"), cc: q("cc"))
            case "hazards": return .hazard(type: rest, region: q("region"))
            case "history": return .history(rest)
            case "sources": return .source(rest)
            default: break
            }
        }
        let name = first.replacingOccurrences(of: ".html", with: "")
        switch name {
        case "index", "home": return .home
        case "event-detail": return .event(q("id") ?? "")
        case "calamity-detail": return .calamity(q("id") ?? "")
        case "alert-detail": return .alert(q("id") ?? "")
        case "forecast-detail": return .forecast(q("id") ?? "ND-001")
        case "region-detail": return .region(q("region") ?? q("country") ?? "World")
        case "location-detail":
            return .location(name: q("location") ?? "World", lat: q("lat").flatMap(Double.init), lon: q("lon").flatMap(Double.init),
                             level: q("level"), country: q("country"), cc: q("cc"))
        case "hazard-detail": return .hazard(type: q("type") ?? "Flood", region: q("region"))
        case "historical-event-detail": return .history(q("id") ?? q("name") ?? "")
        case "source-detail": return .source(q("source") ?? "GDACS")
        case "live-map": return .map
        case "alerts": return .alerts
        case "forecasts": return .forecasts
        case "personal-risk": return .myPlaces
        case "accuracy": return .trackRecord
        case "verification": return .verification
        case "verification-detail": return .verificationDetail
        case "calamities": return .calamities
        case "regions": return .regions
        case "insights": return .insights
        case "methodology": return .methodology
        case "about": return .about
        case "resources": return .collection(.resources, query: nil)
        default:
            if let v = CollectionView(rawValue: name) { return .collection(v, query: q("q") ?? q("search")) }
            return nil
        }
    }

    public static func parse(path: String) -> Route? {
        guard let u = URL(string: path, relativeTo: API.baseURL) else { return nil }
        return parse(u.absoluteURL)
    }

    /// The canonical web URL, for sharing.
    public var webPath: String {
        let e = JS.encodeURIComponent
        switch self {
        case .home: return "/"
        case .map: return "/live-map"
        case .alerts: return "/alerts"
        case .forecasts: return "/forecasts"
        case .myPlaces: return "/personal-risk"
        case .trackRecord: return "/accuracy"
        case .event(let id): return "/disasters/" + e(id)
        case .alert(let id): return "/alerts/" + e(id)
        case .calamity(let id): return "/calamities/" + e(id)
        case .forecast(let id): return "/forecasts/" + e(id)
        case .region(let n): return "/regions/" + e(n)
        case .location(let n, let lat, let lon, let level, let country, let cc):
            var q: [String] = []
            if let la = lat, let lo = lon { q += ["lat=" + JS.numberString(la), "lon=" + JS.numberString(lo)] }
            if let l = level { q.append("level=" + e(l)) }
            if let c = country { q.append("country=" + e(c)) }
            if let c = cc { q.append("cc=" + e(c)) }
            return "/locations/" + e(n) + (q.isEmpty ? "" : "?" + q.joined(separator: "&"))
        case .hazard(let t, let r): return "/hazards/" + e(t) + ((r ?? "").isEmpty ? "" : "?region=" + e(r!))
        case .history(let s): return "/history/" + e(s)
        case .source(let s): return "/sources/" + e(s)
        case .collection(let v, let q): return "/" + v.rawValue + ((q ?? "").isEmpty ? "" : "?q=" + e(q!))
        case .calamities: return "/calamities"
        case .regions: return "/regions"
        case .insights: return "/insights"
        case .methodology: return "/methodology"
        case .about: return "/about"
        case .settings, .more: return "/"
        case .verification: return "/verification"
        case .verificationDetail: return "/verification-detail"
        }
    }

    public var webURL: URL { API.webURL(path: webPath) }
}

/// The shared collection engine's views (`collection.js`, features.md section 3.2).
public enum CollectionView: String, CaseIterable, Hashable, Sendable {
    case events, recentEvents = "recent-events", officialWarnings = "official-warnings", alertsNotifications = "alerts-notifications"
    case hazardTypes = "hazard-types", historicalEvents = "historical-events", compareLocations = "compare-locations"
    case forecastList = "forecast-list", forecastCalendar = "forecast-calendar", resources

    public var title: String {
        switch self {
        case .events: return "Events happening now"
        case .recentEvents: return "Recent events"
        case .officialWarnings: return "Official warnings"
        case .alertsNotifications: return "Current alerts"
        case .hazardTypes: return "Events by type"
        case .historicalEvents: return "Past and recent events"
        case .compareLocations: return "Compare places"
        case .forecastList: return "Our forecasts"
        case .forecastCalendar: return "Forecast calendar"
        case .resources: return "Our sources"
        }
    }

    public var subtitle: String {
        switch self {
        case .events: return "Disasters reported by official agencies, and our own forecasts of what may happen next."
        case .recentEvents: return "The latest disasters reported by official agencies."
        case .officialWarnings: return "The most serious reports from official agencies, plus earthquakes reported by the USGS."
        case .alertsNotifications: return "The most serious current reports from official agencies, with a link to each source."
        case .hazardTypes: return "Browse current events by type: flood, earthquake, wildfire, volcano, storm and drought."
        case .historicalEvents: return "Recent past events from GDACS, plus the events happening now."
        case .compareLocations: return "Search for a place to see its current events. Then search for another place to compare."
        case .forecastList: return "All our current forecasts of what may happen next, including test cases that were not made in advance."
        case .forecastCalendar: return "Each current forecast, shown across the days it covers."
        case .resources: return "Every source we read, whether it answered this time, and what it means when a source reports nothing."
        }
    }

    public var noun: String {
        switch self {
        case .recentEvents: return "recent events"
        case .officialWarnings: return "official warnings"
        case .alertsNotifications: return "alerts"
        case .forecastList, .forecastCalendar: return "forecasts"
        case .resources: return "sources"
        default: return "events"
        }
    }

    public var sortKeys: [String] {
        switch self {
        case .historicalEvents: return Sorts.historicalSorts
        case .forecastList, .forecastCalendar: return Sorts.forecastListSorts
        case .resources: return Sorts.sourceSorts
        default: return Sorts.eventSorts
        }
    }

    /// Whether the view reads every record, including quiet ones.
    public var includesNotLive: Bool { self == .historicalEvents }

    public var isForecastView: Bool { self == .forecastList || self == .forecastCalendar }

    /// Records kept by this view.
    public func keep(_ e: Record) -> Bool {
        switch self {
        case .recentEvents: return e.isOfficial
        case .officialWarnings, .alertsNotifications: return e.isOfficial && (e.isRedOrOrange || e.source == "USGS")
        case .forecastList, .forecastCalendar: return e.forecast
        default: return true
        }
    }

    /// The fixed hazard filter of the non-forecast views.
    public static let fixedHazards = ["Flood", "Earthquake", "Wildfire", "Volcano", "Tropical Cyclone", "Drought"]

    /// Stem match: `type.toLowerCase().includes(option.toLowerCase().replace('s',''))`.
    public static func fixedHazardMatches(_ e: Record, _ option: String) -> Bool {
        if option.isEmpty { return true }
        var o = option.lowercased()
        if let r = o.range(of: "s") { o.removeSubrange(r) }
        return e.type.lowercased().contains(o)
    }

    /// `countText(shown, noun)`: "N events \u{00B7} M forecasts" where a list mixes them.
    public func countText(shown: Int, kept: [Record]) -> String {
        func one(_ n: Int, _ w: String) -> String { "\(n) " + (n == 1 && w.hasSuffix("s") ? String(w.dropLast()) : w) }
        let fc = isForecastView ? 0 : kept.filter { $0.forecast }.count
        return fc > 0 ? one(shown - fc, noun) + " \u{00B7} " + one(fc, "forecasts") : one(shown, noun)
    }
}
