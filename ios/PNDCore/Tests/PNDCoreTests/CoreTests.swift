import XCTest
@testable import PNDCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class DecodingTests: XCTestCase {
    func testSampleEventsDecode() {
        let feed = Feed(json: Fixtures.json("sample-events.json"))
        XCTAssertEqual(feed.all.count, 63)
        XCTAssertEqual(feed.generatedAt, "2026-10-20T11:24:19.566Z")
        XCTAssertTrue(feed.metaLive)
        XCTAssertEqual(feed.notLive.count, 1, "the quiet USGS quake")
        XCTAssertEqual(feed.live.count, 62)
        let flood = Format.findEvent(feed.all, "gdacs-FL-1104999")!
        XCTAssertEqual(flood.num("deaths"), 42)
        XCTAssertEqual(flood.lat, 27.7)
        XCTAssertEqual(flood.countries, ["Nepal"])
        XCTAssertEqual(RiskScale.label(of: flood), "Severe")
        // Booleans stay booleans (a JSON true is not the number 1).
        XCTAssertEqual(flood["isForecast"], .bool(false))
        XCTAssertTrue(feed.all.contains { $0.forecast })
        // Every record carries the fields the screens rely on.
        for e in feed.all {
            XCTAssertFalse(e.id.isEmpty)
            XCTAssertNotNil(e.lat); XCTAssertNotNil(e.lon)
            XCTAssertFalse(e.title.isEmpty)
        }
        XCTAssertEqual(Format.statusText(feed.meta), "Live \u{00B7} 8 of 8 sources working")
    }

    func testMissingIsNotZero() {
        let e = Record(["deaths": .null, "affected": "", "displaced": 0])
        XCTAssertEqual(Screens.impactFigure(e, "deaths"), "Not reported")
        XCTAssertEqual(Screens.impactFigure(e, "affected"), "Not reported")
        XCTAssertEqual(Screens.impactFigure(e, "displaced"), "0")
        XCTAssertEqual(Screens.impactFigure(Record(["deaths": 120000]), "deaths"), "120,000")
    }

    func testLenientNumbers() {
        XCTAssertEqual(Record(["lat": "85.316"]).lat, 85.316)
        XCTAssertNil(Record(["lat": ""]).lat)
        XCTAssertNil(Record(["lat": .null]).lat)
        XCTAssertEqual(JSDate.ms("2026-10-20T11:24:19.566Z"), 1792495459566)
        XCTAssertEqual(JSDate.ms("2026-09-13T07:00:00+07:00"), JSDate.ms("2026-09-13T00:00:00Z"))
        XCTAssertNotNil(JSDate.ms("Sun, 14 Sep 2026 03:00:00 GMT"))
        XCTAssertNil(JSDate.ms("not a date"))
        XCTAssertNil(JSDate.ms("2026-02-31T00:00:00Z"))
        XCTAssertEqual(JSDate.iso(1792495459566), "2026-10-20T11:24:19.566Z")
    }

    func testEnrichmentPanels() {
        let s = Fixtures.json("sample-enrichment.json")
        let d = Enrichment(json: s["response"]!)
        let feed = Feed(json: Fixtures.json("sample-events.json"))
        let e = Format.findEvent(feed.all, "gdacs-FL-1104999")!
        let panels = withZone(nil) { EnrichmentPanels.build(d, event: e) }
        XCTAssertEqual(panels.map { $0.title }, EnrichmentPanels.panels.map { $0.title })
        XCTAssertEqual(panels[0].meta, "Updated 20 Oct 2026, 4:54 PM IST")
        XCTAssertTrue(panels[0].rows.contains { $0.key == "Coordinates" && $0.value == "27.7000, 85.3000" })
        XCTAssertEqual(panels[2].meta.hasSuffix("only from established newsrooms and official agencies"), true)
        XCTAssertTrue(panels[5].cards.contains { $0.phone == "100" })
        XCTAssertTrue(panels[8].cards.last?.title == "About donations")
        // A forecast gets no donation links.
        var resp = s["response"]!.objectValue!
        resp["reliefGroups"] = .array([])
        let fp = EnrichmentPanels.build(Enrichment(json: .object(resp)), event: e)
        XCTAssertEqual(fp[8].cards.first?.title, "Donation links held back")
        XCTAssertEqual(EnrichmentPanels.failure()[3].meta, "Trying again")
        XCTAssertEqual(EnrichmentPanels.tel("+41 22 730 4222"), "tel:+41227304222")
    }

    func testEnrichmentURLMatchesTheWebsite() {
        let s = Fixtures.json("sample-enrichment.json")
        let feed = Feed(json: Fixtures.json("sample-events.json"))
        let e = Format.findEvent(feed.all, "gdacs-FL-1104999")!
        let u = API.enrichmentURL(for: e)
        XCTAssertEqual(API.baseURL.absoluteString + s["request"]!.stringValue!, u.absoluteString)
    }
}

/// A transport that answers from fixtures; no test ever calls a live service.
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    var requests: [(URL, [String: String])] = []
    let handler: (URL) -> (Data, Int)
    init(_ handler: @escaping (URL) -> (Data, Int)) { self.handler = handler }
    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (Data, Int) {
        requests.append((url, headers))
        let r = handler(url)
        if r.1 < 0 { throw URLError(.notConnectedToInternet) }
        return r
    }
}

final class APIClientTests: XCTestCase {
    let events = try! Data(contentsOf: Fixtures.url("sample-events.json"))

    func testEventsPlainAndFresh() async throws {
        let t = FixtureTransport { _ in (self.events, 200) }
        let c = APIClient(transport: t)
        let (f, _) = try await c.events(fresh: false)
        XCTAssertEqual(f.all.count, 63)
        XCTAssertEqual(t.requests[0].0.absoluteString, "https://predict-natural-disasters.anchit-tandon.com/api/events")
        XCTAssertTrue(t.requests[0].1["User-Agent"]!.hasPrefix("PredictNaturalDisasters-iOS/"))
        XCTAssertFalse(t.requests[0].1["User-Agent"]!.contains("@"), "no personal address in the User-Agent")
        _ = try await c.events(fresh: true)
        XCTAssertTrue(t.requests[1].0.query!.hasPrefix("ts="))
    }

    func testHTTPErrorIsAnError() async {
        let c = APIClient(transport: FixtureTransport { _ in (Data("oops".utf8), 503) })
        do { _ = try await c.events(fresh: false); XCTFail("should throw") } catch { XCTAssertEqual(error as? APIError, .http(503)) }
        let bad = APIClient(transport: FixtureTransport { _ in (Data("<html>".utf8), 200) })
        do { _ = try await bad.events(fresh: false); XCTFail("should throw") } catch { XCTAssertEqual(error as? APIError, .decoding) }
    }

    func testNominatimFromFixture() async throws {
        let body = Fixtures.vectors["placeSearch.candidates"]![0]!["in"]![0]!.data()
        let t = FixtureTransport { _ in (body, 200) }
        let places = try await APIClient(transport: t).searchPlaces("Koramangala")
        XCTAssertEqual(places.count, 1)
        XCTAssertEqual(places[0].countryCode, "IN")
        let u = t.requests[0].0.absoluteString
        XCTAssertTrue(u.hasPrefix("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=8&q=Koramangala"))
        XCTAssertEqual(t.requests[0].1["User-Agent"], API.userAgent)
    }

    func testRepositoryKeepsSavedCopy() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pnd-cache-\(UUID().uuidString)")
        let cache = FeedCache(directory: dir)
        let ok = FeedRepository(client: APIClient(transport: FixtureTransport { _ in (self.events, 200) }), cache: cache)
        _ = try await ok.load(fresh: false)
        let offline = FeedRepository(client: APIClient(transport: FixtureTransport { _ in (Data(), -1) }), cache: cache)
        do { _ = try await offline.load(fresh: true); XCTFail("offline should throw") } catch {}
        let saved = await offline.savedCopy()
        XCTAssertEqual(saved?.isSavedCopy, true)
        XCTAssertEqual(saved?.generatedAt, "2026-10-20T11:24:19.566Z", "a saved copy keeps its own data time")
        cache.clear()
    }

    #if !os(Linux)
    /// The real URLSession path, answered by a URLProtocol stub.
    func testURLSessionWithStubProtocol() async throws {
        StubProtocol.body = events
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubProtocol.self]
        let c = APIClient(transport: URLSessionTransport(session: URLSession(configuration: cfg)))
        let (f, _) = try await c.events(fresh: false)
        XCTAssertEqual(f.all.count, 63)
        XCTAssertEqual(StubProtocol.lastUserAgent, API.userAgent)
    }
    #endif
}

#if !os(Linux)
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var body = Data()
    nonisolated(unsafe) static var lastUserAgent: String?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        StubProtocol.lastUserAgent = request.value(forHTTPHeaderField: "User-Agent")
        let resp = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: StubProtocol.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif

final class RouteTests: XCTestCase {
    func testUniversalLinks() {
        let base = "https://predict-natural-disasters.anchit-tandon.com"
        XCTAssertEqual(Route.parse(URL(string: base + "/disasters/gdacs-FL-1104999")!), .event("gdacs-FL-1104999"))
        XCTAssertEqual(Route.parse(URL(string: base + "/alerts/nws-urn%3Aoid%3A2.49")!), .alert("nws-urn:oid:2.49"))
        XCTAssertEqual(Route.parse(URL(string: base + "/forecasts/ND-001")!), .forecast("ND-001"))
        XCTAssertEqual(Route.parse(URL(string: base + "/calamities/x")!), .calamity("x"))
        XCTAssertEqual(Route.parse(URL(string: base + "/regions/Nepal")!), .region("Nepal"))
        XCTAssertEqual(Route.parse(URL(string: base + "/hazards/Flood?region=Nepal")!), .hazard(type: "Flood", region: "Nepal"))
        XCTAssertEqual(Route.parse(URL(string: base + "/history/mount-vesuvius-eruption")!), .history("mount-vesuvius-eruption"))
        XCTAssertEqual(Route.parse(URL(string: base + "/sources/USGS")!), .source("USGS"))
        XCTAssertEqual(Route.parse(URL(string: base + "/locations/Andheri?lat=19.1&lon=72.8&level=Area&country=India&cc=IN")!),
                       .location(name: "Andheri", lat: 19.1, lon: 72.8, level: "Area", country: "India", cc: "IN"))
        XCTAssertEqual(Route.parse(URL(string: base + "/event-detail?id=usgs-1")!), .event("usgs-1"))
        XCTAssertEqual(Route.parse(URL(string: base + "/forecast-list?q=flood")!), .collection(.forecastList, query: "flood"))
        XCTAssertNil(Route.parse(URL(string: "https://example.com/disasters/x")!))
        XCTAssertEqual(Route.parse(path: "/alerts/usgs-2"), .alert("usgs-2"))
        // Slashes in ids survive the round trip.
        let r = Route.event("a b/c")
        XCTAssertEqual(r.webPath, "/disasters/a%20b%2Fc")
        XCTAssertEqual(Route.parse(r.webURL), r)
    }

    func testDetailForRecord() {
        XCTAssertEqual(Route.detail(for: Record(["id": "OUT-1", "forecast": true])), .forecast("OUT-1"))
        XCTAssertEqual(Route.detail(for: Record(["id": "g", "sourceType": "official", "alert": "Red"])), .alert("g"))
        XCTAssertEqual(Route.detail(for: Record(["id": "u", "sourceType": "official", "alert": "Green"])), .event("u"))
    }

    func testCollectionRules() {
        let feed = Feed(json: Fixtures.json("sample-events.json"))
        let ow = feed.live.filter { CollectionView.officialWarnings.keep($0) }
        XCTAssertTrue(ow.allSatisfy { $0.isOfficial && ($0.isRedOrOrange || $0.source == "USGS") })
        XCTAssertTrue(CollectionView.fixedHazardMatches(Record(["type": "Tropical Cyclone"]), "Tropical Cyclone"))
        XCTAssertTrue(CollectionView.fixedHazardMatches(Record(["type": "Flood"]), "Floods"))
        let kept = feed.live.filter { CollectionView.events.keep($0) }
        let text = CollectionView.events.countText(shown: kept.count, kept: kept)
        XCTAssertTrue(text.contains("forecasts"), text)
        XCTAssertEqual(CollectionView.recentEvents.countText(shown: 1, kept: [Record(["id": "x"])]), "1 recent event")
    }
}

final class TrustTests: XCTestCase {
    func testNoteText() {
        XCTAssertEqual(Trust.noteText, "Experimental model, not an official warning. For real alerts, follow your national weather or disaster agency: IMD and NDMA in India, NWS and USGS in the US, GDACS worldwide.")
        XCTAssertEqual(Trust.summary([.feed, .models]), "Data sources (11): GDACS, USGS, EMSC, NASA EONET, NOAA NHC, NOAA NWS, ReliefWeb, USGS Volcanoes, Open-Meteo, NASA POWER")
        XCTAssertEqual(Trust.wmo.url, "https://wmo.int/about/governance/wmo-members")
    }

    func testWhenLineUsesDataTime() {
        let feed = Feed(json: Fixtures.json("sample-events.json"))
        let line = Trust.updatedLine(groups: [.feed, .models], feed: .loaded(generatedAt: feed.generatedAt, meta: feed.meta), tz: "Asia/Kolkata")
        XCTAssertTrue(line.hasPrefix("Live data fetched from the agencies 20 Oct 2026, 4:54 PM"), line)
        XCTAssertTrue(line.contains("weather models last run 20 Oct 2026, 3:07 PM"), line)
        XCTAssertEqual(Trust.updatedLine(groups: [.feed], feed: .failed), "The live data did not load, so no update time can be shown")
        XCTAssertEqual(Trust.updatedLine(groups: [.ledger], feed: .loading, ledgerTimes: [], ledgerFailed: true), "The track record did not load, so no update time can be shown")
        let st = Trust.status(Trust.sources[.feed]![0], meta: feed.meta, tz: "UTC")
        XCTAssertEqual(st.state, .answered)
        XCTAssertTrue(st.text.hasPrefix("answered \u{00B7} newest record 20 Oct 2026"), st.text)
    }
}

final class ScreenTests: XCTestCase {
    let feed = Feed(json: Fixtures.json("sample-events.json"))

    func testHomeKPIsAndStrip() {
        let k = Screens.homeKPIs(feed.live)
        XCTAssertEqual(k.liveEvents, feed.live.filter { !$0.forecast }.count)
        XCTAssertEqual(k.warnings, feed.live.filter { $0.isOfficial && $0.isRedOrOrange }.count)
        XCTAssertFalse(k.forecastSub.isEmpty)
        let strip = Screens.hazardStrip(feed.live)
        XCTAssertTrue(strip.allSatisfy { $0.count > 0 })
        XCTAssertEqual(strip.first { $0.type == "Earthquake" }?.observedOnly, true)
    }

    func testRegionGroupsAndCalendar() {
        let g = Screens.regionGroups(feed.live)
        XCTAssertTrue(g.contains { $0.s("name") == "Nepal" })
        let sorted = Sorts.apply(g, "priority")
        XCTAssertGreaterThanOrEqual(sorted[0].numOf("high"), sorted.last!.numOf("high"))
        let cal = withZone(nil) { Screens.calendar(feed.live.filter { $0.forecast }, now: Fixtures.now) }
        XCTAssertGreaterThanOrEqual(cal.days.count, 4)
        XCTAssertLessThanOrEqual(cal.days.count, 15)
        XCTAssertTrue(cal.groups.allSatisfy { g in g.bars.allSatisfy { $0.width >= 1.4 } })
        XCTAssertEqual(cal.groups.map { $0.type }, cal.groups.map { $0.type }.sorted())
    }

    func testForecastChecks() {
        let f = feed.all.first { $0.id == "OUT-gdacs-FL-1104999" }!
        let c = withZone(nil) { Screens.forecastChecks(f, feed: feed.all, now: Fixtures.now) }
        XCTAssertTrue(c.trigger.hasPrefix("We did not make this forecast on our own. It follows the GDACS flood report for"), c.trigger)
        XCTAssertEqual(c.geoWhy, "Set to Nepal when we made the forecast, and never widened. Damage just outside it does not count.")
        XCTAssertEqual(c.kind, "Short-term forecast based on an official report")
        let nd = feed.all.first { $0.id == "ND-001" }!
        let n = withZone(nil) { Screens.forecastChecks(nd, feed: feed.all, now: Fixtures.now) }
        XCTAssertTrue(n.ended)
        XCTAssertTrue(n.trigger.hasPrefix("This is our test case."))
    }

    func testProvidersAndSources() {
        let p = Screens.providerCards(feed.meta, sort: "curated")!
        XCTAssertTrue(p.summary.hasPrefix("8 of 8 sources answered in full this time") || p.summary.contains("sources answered in full"), p.summary)
        XCTAssertEqual(p.cards.count, feed.meta!["scan"]!["providers"]!.arrayValue!.count)
        XCTAssertNil(Screens.providerCards(.object([:]), sort: "curated"))
        XCTAssertEqual(Screens.familyOf("Tropical Cyclone"), "tropical-cyclone")
        XCTAssertEqual(Screens.sourceRows(feed.meta).first?.name, "EMSC")
        XCTAssertEqual(Screens.sourceRows(feed.meta).last?.name, "USGS VOLCANO")
    }

    func testHazardAndRegionMatching() {
        XCTAssertTrue(Screens.hazardMatches(Record(["type": "Wildfire"]), hazard: "Wildfire", region: ""))
        XCTAssertTrue(Screens.hazardMatches(Record(["type": "Volcano"]), hazard: "Volcano", region: ""))
        XCTAssertFalse(Screens.hazardMatches(Record(["type": "Flood", "country": "Japan"]), hazard: "Flood", region: "Nepal"))
        XCTAssertTrue(Screens.regionMatches(Record(["country": "Nepal"]), "World"))
        XCTAssertTrue(Screens.regionMatches(Record(["title": "Flood in Nepal"]), "nepal"))
    }

    func testMajorEventsAndPlan() {
        let now = Fixtures.now
        let quake = Record(["id": "u9", "type": "Earthquake", "magnitude": 7.0, "country": "Japan", "updated": "2026-10-20T10:00:00Z",
                            "alert": "Red", "sourceType": "official", "source": "USGS", "title": "M 7.0 - Honshu"])
        let m = AlertRules.majorEventAlerts([quake], now: now)
        XCTAssertEqual(m.first?.title, "Major Earthquake M7 (Japan)")
        XCTAssertEqual(m.first?.body, "M 7.0 - Honshu \u{00B7} Red alert \u{00B7} USGS")
        XCTAssertEqual(m.first?.key, "major-u9|red")
        XCTAssertEqual(m.first?.url, "/alerts/u9")
        let home = Fixtures.place("home")
        let events = [Fixtures.event("quakeNear"), quake]
        let first = AlertRules.plan(events: events, places: [home], seen: [:], now: now)
        XCTAssertEqual(first.toSend.count, 2)
        let again = AlertRules.plan(events: events, places: [home], seen: first.seen, now: now + 3_600_000)
        XCTAssertEqual(again.toSend.count, 0, "nothing is sent twice within 6 hours")
        let later = AlertRules.plan(events: events, places: [home], seen: first.seen, now: now + 21_600_001)
        XCTAssertEqual(later.toSend.count, 2)
        let forecastOnly = AlertRules.plan(events: [Fixtures.event("fcEvent")], places: [home], seen: [:], now: now)
        XCTAssertTrue(forecastOnly.toSend.isEmpty, "we never send alerts for our own forecasts")
    }

    func testSummaryChip() {
        let a = PlaceRisk.assess(Fixtures.place("home"), [Fixtures.event("quakeNear")])
        XCTAssertEqual(PlaceRisk.summaryChip(a), "WATCH \u{00B7} event 14 km away")
        XCTAssertEqual(PlaceRisk.summaryChip(PlaceRisk.assess(Fixtures.place("home"), [])), "NOTHING REPORTED NEARBY")
        XCTAssertEqual(PlaceRisk.summaryChip(PlaceRisk.assess(Fixtures.place("phx"), [Fixtures.event("nwsInside")])), "SEVERE \u{00B7} inside an official warning area")
    }
}

final class SiteFileTests: XCTestCase {
    func testHistoryParsesFromTheSiteFile() throws {
        let u = Fixtures.repoRoot.appendingPathComponent("history-data.js")
        guard let js = try? String(contentsOf: u, encoding: .utf8) else { throw XCTSkip("repository root not available") }
        let list = History.parse(js: js)
        XCTAssertGreaterThanOrEqual(list.count, 30)
        XCTAssertEqual(History.find(list, "mount-vesuvius-eruption")?.year, "79 CE")
        XCTAssertEqual(History.find(list, "0")?.name, list[0].name)
        XCTAssertFalse(History.related(list, to: list[0]).contains(list[0]))
        XCTAssertEqual(History.slug("Thera (Santorini) eruption"), "thera-santorini-eruption")
    }

    func testCountryLocator() throws {
        let u = Fixtures.repoRoot.appendingPathComponent("world-countries.json")
        guard let d = try? Data(contentsOf: u) else { throw XCTSkip("repository root not available") }
        let loc = try XCTUnwrap(CountryLocator(data: d))
        XCTAssertGreaterThan(loc.count, 150)
        XCTAssertEqual(loc.country(lat: 27.7, lon: 85.32), "Nepal")
        XCTAssertNil(loc.country(lat: 0, lon: -30), "mid-Atlantic is no country")
    }

    func testPlacesStore() {
        let d = UserDefaults(suiteName: "pnd-test-\(UUID().uuidString)")!
        let s = PlacesStore(defaults: d)
        var n = 1000.0
        s.clock = { n += 1; return n }
        let p = s.save(Place(kind: "Home", name: "Home", lat: 27.7, lon: 85.32, country: "Nepal", countryCode: "NP"))
        XCTAssertTrue(p.id.hasPrefix("loc-"))
        s.setCurrent(lat: 27.70456, lon: 85.31999, country: "Nepal", now: "2026-10-20T12:00:00Z")
        XCTAssertEqual(s.places.first?.id, Place.currentID)
        XCTAssertEqual(s.places.first?.lat, 27.7)
        XCTAssertEqual(s.places.first?.lon, 85.32)
        s.setCurrent(lat: 1, lon: 2, country: "", now: "x")
        XCTAssertEqual(s.places.filter { $0.id == Place.currentID }.count, 1)
        XCTAssertEqual(s.arrivalPlace?.id, Place.currentID)
        s.remove(id: p.id)
        XCTAssertEqual(s.places.count, 1)
        // The web's saved format decodes too (string coordinates).
        let web = Data(#"[{"id":"loc-1","kind":"Office","name":"Desk","lat":"12.9","lon":"77.6","country":"India","countryCode":"IN"}]"#.utf8)
        d.set(web, forKey: PlacesStore.key)
        XCTAssertEqual(s.places.first?.lat, 12.9)
        let mem = NotificationMemory(defaults: d)
        mem.seen = ["a": 5, "b": 6]
        XCTAssertEqual(mem.seen["b"], 6)
    }
}
