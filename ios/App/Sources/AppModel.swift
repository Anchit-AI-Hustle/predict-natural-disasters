import SwiftUI
import PNDCore

enum AppTab: String, CaseIterable, Hashable, Identifiable {
    case home, alerts, forecasts, places, map, track
    var id: String { rawValue }

    /// The site's five tabs (features.md section 0.1). Home is not a tab: it
    /// opens from the logo button, so iPhone never adds a system "More" tab.
    static let barTabs: [AppTab] = [.map, .alerts, .forecasts, .places, .track]

    var title: String {
        switch self {
        case .home: return "Home"
        case .map: return "Map"
        case .alerts: return "Alerts & events"
        case .forecasts: return "Forecasts"
        case .places: return "My places"
        case .track: return "Track record"
        }
    }
    var icon: String {
        switch self {
        case .home: return "magnifyingglass.circle"
        case .map: return "map"
        case .alerts: return "exclamationmark.triangle"
        case .forecasts: return "chart.line.uptrend.xyaxis"
        case .places: return "mappin.and.ellipse"
        case .track: return "checkmark.seal"
        }
    }
    var rootRoute: Route {
        switch self {
        case .home: return .home
        case .map: return .map
        case .alerts: return .alerts
        case .forecasts: return .forecasts
        case .places: return .myPlaces
        case .track: return .trackRecord
        }
    }

    /// `PND.NAV_ALIAS`: which tab a secondary screen belongs to.
    static func owning(_ r: Route) -> AppTab {
        switch r {
        case .home: return .home
        case .map: return .map
        case .alerts, .event, .alert, .calamity, .calamities: return .alerts
        case .collection(let v, _), .scopedCollection(let v, _, _):
            switch v {
            case .forecastList, .forecastCalendar: return .forecasts
            default: return .alerts
            }
        case .forecasts, .forecast: return .forecasts
        case .myPlaces: return .places
        case .trackRecord, .verification, .verificationDetail: return .track
        default: return .home
        }
    }
}

enum FeedStatus: Equatable {
    case loading
    case loaded
    case failed
}

/// App-wide state: the one shared feed, saved places, settings and navigation.
@MainActor
final class AppModel: ObservableObject {
    @Published var feed: Feed?
    @Published var status: FeedStatus = .loading
    @Published var refreshing = false
    @Published var places: [Place] = []
    @Published var zoneID: String { didSet { Format.zoneID = zoneID; UserDefaults.standard.set(zoneID, forKey: "pnd_timezone") } }
    @Published var selectedTab: AppTab = .home
    @Published var paths: [AppTab: [Route]] = [:]
    @Published var showMore = false
    @Published var alertsEnabled: Bool { didSet { UserDefaults.standard.set(alertsEnabled, forKey: "pnd_alerts_on") } }
    @Published var alertsInfo: JSONValue?

    let fixtureMode: Bool
    let failMode: Bool
    let client: APIClient
    let repo: FeedRepository
    let placesStore: PlacesStore
    let memory = NotificationMemory()
    let history: [PastDisaster]
    let locator: CountryLocator?
    private var timer: Timer?
    /// `-PNDOpenRoute /path` (UI tests): opened once after launch.
    private var pendingRoute: Route?
    private var enrichmentCache: [URL: (Enrichment, Date)] = [:]

    init() {
        let args = ProcessInfo.processInfo.arguments
        let fx = args.contains("-PNDFixtureMode")
        let fail = args.contains("-PNDFixtureFail")
        fixtureMode = fx
        failMode = fail
        let transport: HTTPTransport = fx ? BundleFixtureTransport(fail: fail, pager: args.contains("-PNDFixturePager")) : URLSessionTransport()
        let api = APIClient(transport: transport)
        client = api
        var cache: FeedCache? = FeedCache.defaultCache()
        if fx {
            cache = FeedCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("pnd-fixture-\(UUID().uuidString)"))
        }
        repo = FeedRepository(client: api, cache: cache)
        let defaults: UserDefaults = fx ? (UserDefaults(suiteName: "pnd-fixture") ?? .standard) : .standard
        if fx { defaults.removePersistentDomain(forName: "pnd-fixture") }
        let store = PlacesStore(defaults: defaults)
        placesStore = store
        // The stored choice, else the device's own zone, else India time
        // (changelog C9). Fixture mode pins India time so screenshots and UI
        // tests read the same on every machine.
        let storedZone = Format.timezoneDefault(stored: UserDefaults.standard.string(forKey: "pnd_timezone"), device: TimeZone.current.identifier)
        let zone = args.contains("-PNDFixtureMode") ? Format.defaultZoneID : storedZone
        zoneID = zone
        Format.zoneID = zone
        alertsEnabled = UserDefaults.standard.bool(forKey: "pnd_alerts_on")
        history = WebAssets.text("history-data.js").map { History.parse(js: $0) } ?? []
        locator = WebAssets.data("world-countries.json").flatMap { CountryLocator(data: $0) }
        if fx {
            Format.now = { JSDate.ms("2026-10-20T12:00:00Z")! }
            if args.contains("-PNDFixturePlaces") {
                store.save(Place(kind: "Home", name: "Kathmandu, Bagmati Province, Nepal", lat: 27.7172, lon: 85.324, country: "Nepal", countryCode: "NP"))
            }
        }
        places = store.places
        if let i = args.firstIndex(of: "-PNDOpenRoute"), i + 1 < args.count { pendingRoute = Route.parse(path: args[i + 1]) }
    }

    // MARK: feed

    var live: [Record] { feed?.live ?? [] }
    var all: [Record] { feed?.all ?? [] }
    var meta: JSONValue? { feed?.meta }

    var trustFeedState: Trust.FeedState {
        if let f = feed { return .loaded(generatedAt: f.generatedAt, meta: f.meta) }
        return status == .failed ? .failed : .loading
    }

    func start() {
        if let r = pendingRoute { pendingRoute = nil; open(r) }
        Task { await load(fresh: false) }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.load(fresh: false) }
        }
        Task { await loadAlertsInfo() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    /// Plain polls may be served the edge copy; a pull or a Refresh tap asks past it.
    func load(fresh: Bool) async {
        if fresh { refreshing = true }
        defer { refreshing = false }
        do {
            let f = try await repo.load(fresh: fresh)
            feed = f
            status = .loaded
            NotificationService.shared.evaluateForeground(model: self)
        } catch {
            status = .failed
            if feed == nil || feed?.isSavedCopy == true, let saved = await repo.savedCopy() { feed = saved }
        }
    }

    /// `feedState(loaded, failed)` for place answers (changelog C26). A saved
    /// or earlier feed counts as loaded, so a later failed refresh keeps the
    /// last real answer.
    var placeFeedState: PlaceRisk.FeedState { PlaceRisk.feedState(loaded: feed != nil, failed: status == .failed) }

    /// Nothing has loaded and the last load failed (`PND.feedDown`, changelog C19).
    var feedDown: Bool { feed == nil && status == .failed }

    /// A figure, "-" before the feed has loaded, or "Unavailable" when it
    /// failed before anything loaded (a failed load is not a zero).
    func fig(_ n: Int) -> String { feedDown ? Format.unavailable : (feed == nil ? "-" : String(n)) }
    func figText(_ t: String) -> String { feedDown ? Format.unavailable : (feed == nil ? "-" : t) }

    /// The status line under a list title.
    func statusLine(_ extra: String? = nil) -> String {
        if status == .failed { return Copy.loadError }
        guard let f = feed else { return Copy.loading }
        return Format.statusText(f.meta) + (extra.map { " \u{00B7} " + $0 } ?? "") + " \u{00B7} updated " + Format.age(f.generatedAt)
    }

    // MARK: enrichment (re-requested every 5 minutes)

    func enrichment(for e: Record) async -> Enrichment? {
        let url = API.enrichmentURL(for: e)
        if let c = enrichmentCache[url], Date().timeIntervalSince(c.1) < 300 { return c.0 }
        do {
            let d = try await client.enrichment(url)
            enrichmentCache[url] = (d, Date())
            return d
        } catch { return nil }
    }

    // MARK: places

    func reloadPlaces() { places = placesStore.places; NotificationService.shared.scheduleBackgroundRefresh(enabled: alertsEnabled) }

    @discardableResult
    func savePlace(_ p: Place) -> Place {
        let s = placesStore.save(p)
        reloadPlaces()
        return s
    }

    func removePlace(_ id: String) { placesStore.remove(id: id); reloadPlaces() }

    func setCurrentLocation(lat: Double, lon: Double) -> Place {
        let country = locator?.country(lat: lat, lon: lon) ?? ""
        let p = placesStore.setCurrent(lat: lat, lon: lon, country: country, now: JSDate.iso(Format.now()))
        reloadPlaces()
        return p
    }

    func loadAlertsInfo() async { alertsInfo = try? await client.alertsInfo() }

    // MARK: navigation

    func open(_ route: Route) {
        let tab = AppTab.owning(route)
        selectedTab = tab
        if route == tab.rootRoute { paths[tab] = []; return }
        paths[tab, default: []].append(route)
    }

    /// A tab bar tap: switch tabs, or go back to the root of the tab shown.
    func selectTab(_ tab: AppTab) {
        if selectedTab == tab { paths[tab] = [] } else { selectedTab = tab }
    }

    /// Bumped whenever a link asks for a tab, so the iPad sidebar follows
    /// even when that tab was already the selected one.
    @Published var tabRequest = 0

    /// A link to a tab's own screen: that tab, at its root.
    func showTab(_ tab: AppTab) {
        paths[tab] = []
        selectedTab = tab
        tabRequest += 1
    }

    /// The logo button: Home / Check a place.
    func goHome() { selectTab(.home) }

    func push(_ route: Route) {
        paths[selectedTab, default: []].append(route)
    }

    func path(_ tab: AppTab) -> Binding<[Route]> {
        Binding(get: { self.paths[tab] ?? [] }, set: { self.paths[tab] = $0 })
    }

    func handle(url: URL) {
        if let r = Route.parse(url) { open(r) } else { open(.myPlaces) }
    }
}

/// Files copied from the repository root at build time (ios/scripts/copy-web-assets.sh).
enum WebAssets {
    static func url(_ name: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Web") ?? Bundle.main.url(forResource: name, withExtension: nil)
    }
    static func data(_ name: String) -> Data? { url(name).flatMap { try? Data(contentsOf: $0) } }
    static func text(_ name: String) -> String? { data(name).map { String(decoding: $0, as: UTF8.self) } }
}

/// Fixture mode: every request is answered from the app bundle, so UI tests
/// need no network (launch argument `-PNDFixtureMode`).
final class BundleFixtureTransport: HTTPTransport, @unchecked Sendable {
    let fail: Bool
    /// `-PNDFixturePager`: 45 official reports and one aggregator record, the
    /// feed the `alerts.pager` vectors were made with, so the Alerts pager shows.
    let pager: Bool
    init(fail: Bool, pager: Bool = false) { self.fail = fail; self.pager = pager }

    static func pagerFeed() -> Data {
        let now = JSDate.ms("2026-10-20T12:00:00Z")!
        var events: [JSONValue] = []
        for i in 0..<45 {
            let d = Double(i)
            var o: [String: JSONValue] = [:]
            o["id"] = .string("usgs-p\(i)")
            o["type"] = .string("Earthquake")
            o["title"] = .string("M 4.\(i % 10) - Testville \(i), Japan")
            o["source"] = .string("USGS")
            o["sourceType"] = .string("official")
            o["evidenceState"] = .string("observed")
            o["alert"] = .string("Green")
            o["severityRank"] = .number(1)
            o["country"] = .string("Japan")
            o["lat"] = .number(33 + d / 20)
            o["lon"] = .number(130 + d / 10)
            o["updated"] = .string(JSDate.iso(now - (d + 1) * 3_600_000))
            events.append(.object(o))
        }
        var x: [String: JSONValue] = [:]
        x["id"] = .string("eonet-x")
        x["type"] = .string("Wildfire")
        x["title"] = .string("Not official")
        x["source"] = .string("NASA EONET")
        x["sourceType"] = .string("aggregator")
        x["lat"] = .number(1)
        x["lon"] = .number(1)
        x["updated"] = .string(JSDate.iso(now))
        events.append(.object(x))
        let sources: [String: JSONValue] = ["usgs": .object(["ok": .bool(true)])]
        let meta: [String: JSONValue] = ["live": .bool(true), "sources": .object(sources)]
        let feed: JSONValue = .object(["generatedAt": .string(JSDate.iso(now)), "meta": .object(meta), "events": .array(events)])
        return feed.data()
    }

    func fixture(_ name: String) -> Data? {
        Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Fixtures").flatMap { try? Data(contentsOf: $0) }
            ?? Bundle.main.url(forResource: name, withExtension: nil).flatMap { try? Data(contentsOf: $0) }
    }

    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (Data, Int) {
        if fail { throw URLError(.notConnectedToInternet) }
        let path = url.path
        if url.host == "nominatim.openstreetmap.org" { return (fixture("nominatim.json") ?? Data("[]".utf8), 200) }
        if path == "/api/events" {
            if url.query?.contains("summary") == true, let d = fixture("sample-events.json"), var j = try? JSONValue.parse(d).objectValue {
                j.removeValue(forKey: "events")
                return (JSONValue.object(j).data(), 200)
            }
            if pager { return (Self.pagerFeed(), 200) }
            return (fixture("sample-events.json") ?? Data(), 200)
        }
        if path == "/api/event-enrichment", let d = fixture("sample-enrichment.json"), let j = try? JSONValue.parse(d) {
            var resp = j["response"] ?? .object([:])
            if url.query?.contains("forecast=true") == true, case .object(var o) = resp { o["reliefGroups"] = .array([]); resp = .object(o) }
            return (resp.data(), 200)
        }
        if path == "/api/alerts" { return (fixture("alerts.json") ?? Data("{}".utf8), 200) }
        if path.hasPrefix("/data/") {
            let name = String(path.dropFirst("/data/".count))
            if let d = fixture(name) { return (d, 200) }
            return (Data(), 404)
        }
        return (Data(), 404)
    }
}
