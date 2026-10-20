import XCTest
@testable import PNDCore

/// Changelog rows that have no vector group (UI rules, copy and data
/// endpoints), checked against the site's own wording.
final class ParityChangeTests: XCTestCase {
    let feed = Feed(json: Fixtures.json("sample-events.json"))

    // C1: a continent page is never empty while the feed has reports there.
    func testContinentPagesFindTheirReports() {
        let reports = Format.observed(feed.live)
        for c in ["Asia", "Africa", "North America", "South America"] {
            let m = Screens.regionMatcher(c)
            XCTAssertFalse(reports.filter(m.matches).isEmpty, c + " should list the fixture's reports")
        }
        XCTAssertTrue(Screens.regionMatches(Record(["country": "Nepal"]), "Asia"))
        XCTAssertFalse(Screens.regionMatches(Record(["title": "Flood in Asia"]), "Asia"), "the title is never read for a continent")
        XCTAssertEqual(Screens.regionCoverage(region: "Asia", continent: "Asia", sourcesRatio: "8/8", here: 3, atSea: 1),
                       "Sources working now: 8/8. Current events here: 3. Asia is counted from the countries each report names. 1 report is at sea or name no country, so it is on no continent\u{2019}s page.")
    }

    // C2: Extreme Cold is not Extreme Heat on the strip or hazard detail.
    func testHazardsMatchWhole() {
        XCTAssertFalse(Screens.hazardMatches(Record(["type": "Extreme Heat"]), hazard: "Extreme Cold", region: ""))
        XCTAssertTrue(Screens.hazardMatches(Record(["type": "Volcanic Eruption"]), hazard: "Volcano", region: ""))
        XCTAssertTrue(Screens.hazardMatches(Record(["type": "Flood", "country": "Nepal"]), hazard: "Flood", region: "Asia"))
        let choice = Screens.hazardChoices(requested: "Ice", present: ["Ice"])
        XCTAssertEqual(choice.selected, "Ice", "an unknown type is offered as itself, never Flood")
        XCTAssertEqual(Screens.hazardForecastNote(count: 2, hazard: "Extreme Heat", here: true),
                       "We also have 2 open forecasts of extreme heat here. They are our own estimates, not events.")
        XCTAssertNil(Screens.hazardForecastNote(count: 0, hazard: "Flood", here: false))
        XCTAssertEqual(Screens.hazardEmptyDetail(here: false), "Our sources have no current report of this hazard. This does not mean there is no danger.")
    }

    // C8: every list's hazard filter is built from its own records.
    func testHazardFilterFromData() {
        let opts = Format.hazardOptions(feed.live.filter { $0.forecast }, selected: "")
        XCTAssertEqual(opts.first?.label, "All hazards (\(feed.live.filter { $0.forecast }.count))")
        XCTAssertTrue(opts.contains { $0.value == "Earthquake aftershock sequence" })
    }

    // C9 and C10: the trust note copy and its one zone.
    func testTrustCopyAndZone() {
        XCTAssertEqual(Trust.lead, "For real alerts, follow your national agency:")
        XCTAssertEqual(Trust.utc("2026-10-20T11:24:19Z"), "2026-10-20 11:24 UTC")
        XCTAssertEqual(Format.timezoneDefault(stored: nil, device: "Asia/Kathmandu"), "Asia/Kathmandu")
        XCTAssertEqual(Format.timezoneDefault(stored: "", device: nil), "Asia/Kolkata")
        let line = Trust.updatedLine(groups: [.feed, .models], feed: .loaded(generatedAt: feed.generatedAt, meta: feed.meta), tz: "America/New_York")
        XCTAssertTrue(line.contains(" ET"), line)
        XCTAssertFalse(line.contains("GMT"), line)
    }

    // C12: the home map's selected-event card and search.
    func testHomeMapSearch() {
        XCTAssertNil(Screens.homeMapSearch(feed.live, query: "   "))
        let hit = Screens.homeMapSearch(feed.live, query: "  Nepal ")
        XCTAssertEqual(hit?.eyebrow, "Selected event on map")
        XCTAssertNotNil(hit?.record)
        let miss = Screens.homeMapSearch(feed.live, query: " Atlantis ")
        XCTAssertEqual(miss, Screens.MapNudge(eyebrow: "Search", title: "No live event matches \u{201C}Atlantis\u{201D}",
                                              meta: "Try a country, a city or a type of hazard.", record: nil))
        let e = Record(["title": "Flood in X", "type": "Flood", "country": "Nepal", "source": "GDACS"])
        XCTAssertEqual(Screens.selectedNudge(e).meta, "Flood \u{00B7} Nepal \u{00B7} GDACS")
    }

    // C18: the live map says what a search found.
    func testMapSearchNote() {
        let a = Record(["id": "a", "lat": 1, "lon": 2]), b = Record(["id": "b", "lat": 3, "lon": 4]), c = Record(["id": "c"])
        XCTAssertNil(Screens.mapSearchNote(query: " ", matching: [a]))
        XCTAssertEqual(Screens.mapSearchNote(query: "x", matching: [a]), "1 event match \u{201C}x\u{201D}. The map shows it.")
        XCTAssertEqual(Screens.mapSearchNote(query: "x ", matching: [a, b, c]), "3 events match \u{201C}x\u{201D}. The map shows them.")
        XCTAssertEqual(Screens.mapSearchNote(query: "x", matching: [c]), "No event matches \u{201C}x\u{201D}.")
    }

    // C17: /events?region= is honoured.
    func testRegionScopedRoute() {
        XCTAssertEqual(Route.parse(path: "/events?region=Asia"), .scopedCollection(.events, query: nil, region: "Asia"))
        XCTAssertEqual(Route.scopedCollection(.events, query: nil, region: "North America").webPath, "/events?region=North%20America")
        XCTAssertEqual(Route.parse(path: "/events?q=flood"), .collection(.events, query: "flood"))
        XCTAssertEqual(CollectionView.scopeNote(region: "Asia"), "Showing only Asia.")
        XCTAssertNil(CollectionView.scopeNote(region: "world"))
        let scoped = CollectionView.scoped(feed.live, region: "Asia")
        XCTAssertTrue(scoped.allSatisfy { Format.inPlace($0, "Asia") })
        XCTAssertFalse(scoped.isEmpty)
    }

    // C19: a failed feed says so.
    func testUnavailableCopy() {
        XCTAssertEqual(Format.unavailableTitle, "Live data unavailable.")
        XCTAssertEqual(Format.unavailableBody, "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.")
    }

    // C22: an unknown source says so.
    func testUnknownSource() {
        XCTAssertTrue(Copy.sourceNotFound("Nonsense", reports: 0))
        XCTAssertFalse(Copy.sourceNotFound("usgs", reports: 0))
        XCTAssertEqual(Copy.sourceStatus("Other agency", meta: feed.meta, reports: 2), "Named in current reports")
        XCTAssertEqual(Copy.sourceStatus("Other agency", meta: feed.meta, reports: 0), "Not read live")
        XCTAssertEqual(Copy.sourceProfile("Other agency").cls, "Source named in our current reports")
        XCTAssertEqual(Copy.sourceNotFoundText("X"), "None of our current reports names a source called \u{201C}X\u{201D}.")
    }

    // C23: an Enter search keeps the country it found.
    func testChosenPlaceKeepsCountry() {
        let k = PlaceSearch.chosenAs(name: "Kathmandu", lat: "27.717200", lon: "85.324000")
        XCTAssertFalse(PlaceSearch.editForgetsCountry(chosenAs: k, now: k, hasCountry: true))
        XCTAssertTrue(PlaceSearch.editForgetsCountry(chosenAs: k, now: PlaceSearch.chosenAs(name: "Kathmandu", lat: "27.8", lon: "85.324000"), hasCountry: true))
        XCTAssertFalse(PlaceSearch.editForgetsCountry(chosenAs: k, now: "x||", hasCountry: false))
    }

    // C24: a marker's tap area is at least 24 points; the mark keeps its size.
    func testMarkerTapArea() {
        for l in RiskLevel.filterOptions {
            XCTAssertGreaterThanOrEqual(l.markerTapSide, 24)
            XCTAssertGreaterThanOrEqual(l.markerTapSide, l.markerSize)
        }
        XCTAssertEqual(RiskLevel.extreme.markerTapSide, 27)
        XCTAssertEqual(RiskLevel.low.markerSize, 12)
    }

    // C25: ReliefWeb's endpoint is the RSS address, and data reads carry no ?ts=.
    func testEndpointsAndDataReads() {
        let cards = Screens.providerCards(feed.meta, sort: "curated")!.cards
        let rw = cards.first { $0.label.lowercased().contains("reliefweb") }
        XCTAssertEqual(rw?.endpoint, "https://reliefweb.int/disasters/rss.xml")
        XCTAssertFalse(cards.contains { ($0.endpoint ?? "").contains("/disasters/feed") })
        XCTAssertEqual(API.dataURL("verification-ledger.json").absoluteString,
                       "https://predict-natural-disasters.anchit-tandon.com/data/verification-ledger.json")
    }

    // iOS fix (b): foreground notifications match the site's /alerts rules:
    // major global events are sent with no saved place at all.
    func testMajorEventsNeedNoSavedPlace() {
        let quake = Record(["id": "u9", "type": "Earthquake", "magnitude": 7.0, "country": "Japan", "updated": "2026-10-20T10:00:00Z",
                            "alert": "Red", "sourceType": "official", "source": "USGS", "title": "M 7.0 - Honshu"])
        let plan = AlertRules.plan(events: [quake], places: [], seen: [:], now: Fixtures.now)
        XCTAssertEqual(plan.toSend.map { $0.key }, ["major-u9|red"])
        let again = AlertRules.plan(events: [quake], places: [], seen: plan.seen, now: Fixtures.now + 3_600_000)
        XCTAssertTrue(again.toSend.isEmpty, "the same 6 h memory")
    }
}
