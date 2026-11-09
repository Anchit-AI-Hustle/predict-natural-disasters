import XCTest
@testable import PNDCore

/// The launch audit's website changes (features.md changelog C28 to C47):
/// the vector groups they added, and one test per ported row.
final class LaunchParityTests: XCTestCase {
    /// Vector groups asserted here (`VectorTests.testEveryVectorGroupIsCovered` unions this set).
    static let groups: Set<String> = ["risk.keyFor", "risk.describe", "portal.riskTagHtml.levels", "hazards.cycloneCategoryRank", "portal.provenanceOf"]

    func each(_ key: String, file: StaticString = #filePath, line: UInt = #line, _ body: (JSONValue, JSONValue, String) -> Void) {
        let g = Fixtures.group(key)
        XCTAssertFalse(g.isEmpty, "no vectors for \(key)", file: file, line: line)
        for (i, v) in g.enumerated() { body(v["in"] ?? .null, v["out"] ?? .null, "\(key)[\(i)]") }
    }

    override func setUp() { Format.zoneID = "Asia/Kolkata"; Format.now = { Fixtures.now } }

    // MARK: C31 one risk level function

    func testKeyForDescribeAndBadges() {
        each("risk.keyFor") { i, o, m in XCTAssertEqual(RiskScale.keyFor(rec(i)).rawValue, o.stringValue, m) }
        each("risk.describe") { i, o, m in
            let d = RiskScale.describe(rec(i))
            XCTAssertEqual(d.key.rawValue, o["key"]?.stringValue, m)
            XCTAssertEqual(d.label, o["label"]?.stringValue, m)
            XCTAssertEqual(d.basis, o["basis"]?.stringValue, m)
            XCTAssertEqual(d.text, o["text"]?.stringValue, m)
        }
        each("portal.riskTagHtml.levels") { i, o, m in
            let html = o.stringValue ?? "", e = rec(i)
            XCTAssertTrue(html.contains("risk-" + RiskScale.keyFor(e).rawValue.lowercased() + "\""), m)
            XCTAssertTrue(html.contains("title=\"" + RiskScale.badgeTitle(of: e) + "\""), m + " " + RiskScale.badgeTitle(of: e))
            XCTAssertTrue(html.contains(">" + RiskScale.tagText(of: e) + "</span>"), m + " " + RiskScale.tagText(of: e))
        }
        each("hazards.cycloneCategoryRank") { i, o, m in XCTAssertEqual(Double(Hazards.cycloneCategoryRank(rec(i))), o.numberValue, m) }
    }

    func testMarkersAndFiltersUseTheOneLevel() {
        let typhoon = Record(["type": "Tropical Cyclone", "title": "Super Typhoon X", "alert": "Green", "source": "GDACS"])
        XCTAssertEqual(RiskScale.marker(for: typhoon).level, .extreme)
        XCTAssertTrue(RiskScale.matches(typhoon, "EXTREME"))
        // Only the levels present are offered, plus the chosen one.
        XCTAssertEqual(RiskScale.filterOptions(for: [typhoon], selected: nil), [.extreme])
        XCTAssertEqual(RiskScale.filterOptions(for: [typhoon], selected: "LOW"), [.extreme, .low])
        XCTAssertEqual(RiskScale.riskWords(Record(["type": "Earthquake", "source": "USGS", "severity": "Informational", "magnitude": 4.6])),
                       "Low (no USGS PAGER impact alert issued)")
    }

    // MARK: C33 open forecasts, and what each is

    func testProvenanceAndOpenForecastLists() {
        each("portal.provenanceOf") { i, o, m in XCTAssertEqual(Format.provenanceOf(rec(i)), o.stringValue, m) }
        let list = [Record(["forecast": true, "forecastKind": "model-advance"]), Record(["forecast": true, "forecastOf": "x"]),
                    Record(["forecast": true, "forecastKind": "model-advance"])]
        XCTAssertEqual(Format.forecastKinds(list), "Of these: 2 made in advance by our weather models, 1 restating an agency alert.")
        let ended = Record(["forecast": true, "windowClosed": true]), open = Record(["forecast": true])
        XCTAssertFalse(CollectionView.forecastList.keep(ended))
        XCTAssertTrue(CollectionView.forecastList.keep(open))
        XCTAssertEqual(CollectionView.forecastCalendar.countText(shown: 1, kept: [open]), "1 open forecast")
    }

    // MARK: C35 copy

    func testTitlesReadPlainHyphensAndModelNames() {
        XCTAssertEqual(Format.titleOf(Record(["title": "Storm \u{2014} Luzon"])), "Storm - Luzon")
        XCTAssertEqual(Format.titleOf(Record(["title": "Extreme heat forecast - Delhi", "forecastKind": "model-advance"])), "Unusually hot days forecast - Delhi")
        XCTAssertEqual(Format.titleOf("Aftershock-sequence outlook - north of Honshu"), "Aftershock risk north of Honshu - 7-day forecast")
    }

    // MARK: C36 one name per country, places matched exactly

    func testCountryNamesAndExactPlaces() {
        XCTAssertEqual(CountryNames.canonical("México"), "Mexico")
        XCTAssertEqual(CountryNames.canonical("MX"), "Mexico")
        XCTAssertEqual(CountryNames.place(["Japan region"]).countries, ["Japan"])
        XCTAssertEqual(CountryNames.place(["Reykjanes Ridge"]).sea, "Reykjanes Ridge")
        let mx = [Record(["country": "Mexico"]), Record(["country": "México"]), Record(["country": "MX"]), Record(["country": "Reykjanes Ridge"])]
        XCTAssertEqual(Format.countryCount(mx), 1)
        XCTAssertFalse(Format.inPlace(Record(["country": "Nigeria"]), "Niger"))
        XCTAssertTrue(Format.inPlace(Record(["country": "Niger"]), "Niger"))
        XCTAssertFalse(Format.inPlace(Record(["title": "Flood in Brazil", "country": "Brazil"]), "braz"))
        XCTAssertTrue(Format.inPlace(Record(["country": "United States", "region": "Alaska"]), "Alaska"))
        XCTAssertTrue(Search.matches(Record(["title": "Earthquake", "country": "Türkiye"]), "turkey"))
        XCTAssertEqual(Format.timezoneDefault(stored: "Asia/Calcutta", device: nil), "Asia/Kolkata")
    }

    // MARK: C37 the place answer names both

    func testPlaceAnswerNamesReportAndForecast() {
        let home = Fixtures.place("home")
        let a = PlaceRisk.assess(home, [Fixtures.event("fcCountryNP"), Fixtures.event("quakeNear")])
        XCTAssertNotNil(a.observed)
        XCTAssertNotNil(a.forecast)
        XCTAssertTrue(a.why.hasSuffix(" One of our forecasts also covers your place."))
        XCTAssertTrue(PlaceRisk.summaryChip(a).hasSuffix(" \u{00B7} our forecast also covers it"), PlaceRisk.summaryChip(a))
    }

    // MARK: C38 home numbers

    func testHomeEventsNoteAddsUp() {
        let reports = [Record(["severity": "Extreme"]), Record(["severity": "Moderate"]), Record(["alert": "Green"]), Record([:])]
        let r = Home.render(reports, hazardFilter: "", sort: "newest")
        XCTAssertEqual(r.kEventsNote, "1 extreme \u{00B7} 1 moderate \u{00B7} 1 low \u{00B7} 1 not rated")
        XCTAssertEqual(Screens.HazardTile(type: "Earthquake", count: 2, observedOnly: true).text, "2 reported \u{00B7} reports only, no forecast")
    }

    // MARK: C39 official labels follow the evidence

    func testOfficialWordsAndEyebrows() {
        let watch = Record(["evidenceState": "official-warning", "officialProduct": "watch", "source": "NWS"])
        XCTAssertEqual(Format.officialWord(watch), "Official watch")
        XCTAssertEqual(Format.provenance(watch), "OFFICIAL WATCH")
        XCTAssertEqual(Format.eventEyebrow(watch), "OFFICIAL WATCH")
        XCTAssertEqual(Format.eventEyebrow(Record(["source": "USGS"])), "REPORTED EVENT")
        XCTAssertEqual(Format.alertEyebrow(Record(["source": "USGS"])), "REPORT FROM AN OFFICIAL AGENCY")
        XCTAssertEqual(Hazards.severityOf(Record(["alert": "Yellow"])).severity, "Minor")
    }

    // MARK: C40 help and needs only where grave

    func testLifeSafety() {
        XCTAssertTrue(Format.lifeSafety(Record(["evidenceState": "official-warning"])))
        XCTAssertFalse(Format.lifeSafety(Record(["evidenceState": "official-warning", "officialProduct": "advisory"])))
        XCTAssertTrue(Format.lifeSafety(Record(["alert": "Red"])))
        XCTAssertTrue(Format.lifeSafety(Record(["alert": "Green", "deaths": 2])))
        XCTAssertFalse(Format.lifeSafety(Record(["alert": "Green", "magnitude": 4.5])))
        XCTAssertFalse(Format.lifeSafety(Record(["forecast": true, "alert": "Red"])))
    }

    // MARK: C41 live by hours

    func testQuietWords() {
        XCTAssertEqual(Format.liveWord(Record(["live": false, "quietHours": 30, "quietDays": 1])), "Not updated for 30 hours")
        XCTAssertEqual(Format.liveWord(Record(["live": false, "quietDays": 3])), "Not updated for 3 days")
        XCTAssertEqual(Format.liveWord(Record(["live": false])), "Not updated for some time")
        XCTAssertEqual(Format.quietNote(Record(["live": false, "quietHours": 1, "source": "NHC"])), "Not updated by NHC for some time. It may have ended; check the source for its current status.")
        XCTAssertEqual(Format.quietNote(Record(["live": false, "quietHours": 1, "quietDays": 0, "source": "NHC"])), "Not updated by NHC for 1 hour. It may have ended; check the source for its current status.")
    }

    // MARK: C42 a merged-away id opens its record

    func testFindEventFollowsMergedFrom() {
        let merged = Record(["id": "usgs-1", "mergedFrom": [["id": "emsc-9"], ["id": "gdacs-EQ-3"]]])
        XCTAssertEqual(Format.findEvent([Record(["id": "other"]), merged], "emsc-9")?.id, "usgs-1")
        XCTAssertNil(Format.findEvent([merged], "---"))
    }

    // MARK: C43 cyclones by basin

    func testCycloneClassByBasin() {
        XCTAssertEqual(Hazards.cycloneClass(100, 15, 88)?.scale, "IMD class")
        XCTAssertEqual(Hazards.cycloneClass(100, 15, 88)?.value, "Extremely Severe Cyclonic Storm")
        XCTAssertEqual(Hazards.cycloneClass(140, 15, 135)?.value, "Super typhoon")
        XCTAssertEqual(Hazards.cycloneClass(100, 25, -60)?.value, "Category 3")
        XCTAssertEqual(Hazards.cycloneClass(40, -15, 60)?.value, "Tropical cyclone")
        XCTAssertEqual(Hazards.cycloneClass(100, nil, nil)?.scale, "Category")
        XCTAssertEqual(Hazards.cycloneAuthority(Record(["lat": 15, "lon": 88]))?.short, "IMD")
        let fact = Hazards.factOf(Record(["type": "Tropical Cyclone", "windKt": 70, "lat": 20, "lon": 130]), "category")
        XCTAssertEqual(fact.label, "JMA class (JTWC above 130 kt)")
        XCTAssertEqual(fact.value, "Typhoon")
    }

    // MARK: C44 dates and ages

    func testDayPrecisionMonthsAndYears() {
        XCTAssertEqual(Format.fmtOf(Record(["updated": "2026-09-05T00:00:00Z", "datePrecision": "day"])), "05 Sep 2026")
        XCTAssertEqual(Format.fmtDate("2026-09-05T06:00:00Z"), "05 Sep 2026, 11:30 AM IST")
        let now = JSDate.ms("2026-10-20T00:00:00Z")!
        XCTAssertEqual(Format.age("2026-06-01T00:00:00Z", now: now), "5 months ago")
        XCTAssertEqual(Format.age("2023-01-01T00:00:00Z", now: now), "3 years ago")
    }

    // MARK: C45 one address per record, sorts with figures

    func testOneAddressAndFigureSorts() {
        XCTAssertEqual(Format.eventPath(Record(["id": "g-1", "sourceType": "official", "alert": "Red"])), "/disasters/g-1")
        let a = Record(["countries": ["Philippines"], "place": "10 km WSW of Esperanza"])
        let b = Record(["countries": ["Philippines"], "place": "1 km WSW of Butulan"])
        XCTAssertEqual(Sorts.apply([a, b], "country").map { $0.s("place") }, ["1 km WSW of Butulan", "10 km WSW of Esperanza"])
        XCTAssertEqual(Sorts.offered(Sorts.eventSorts, [a, b]), ["newest", "severity", "oldest", "country", "type", "source", "title"])
        XCTAssertTrue(Sorts.offered(Sorts.eventSorts, [Record(["deaths": 3])]).contains("deaths"))
        XCTAssertFalse(CollectionView.events.keep(Record(["forecast": true, "forecastKind": "frozen-benchmark"])))
        XCTAssertTrue(CollectionView.historicalEvents.keep(Record(["live": false])))
        XCTAssertFalse(CollectionView.historicalEvents.keep(Record(["live": true])))
    }

    // MARK: C46 history slugs

    func testHistorySlugsFoldAccents() {
        XCTAssertEqual(History.slug("Tōhoku earthquake and tsunami"), "tohoku-earthquake-and-tsunami")
        XCTAssertEqual(History.legacySlug("Tōhoku earthquake and tsunami"), "t-hoku-earthquake-and-tsunami")
    }

    // MARK: C29 one verdict per forecast

    func testFirstVersionCountsOnce() {
        let rows = [Record(["id": "A", "recordedAt": "2026-10-02T00:00:00Z"]), Record(["id": "A", "recordedAt": "2026-10-01T00:00:00Z"]),
                    Record(["id": "B", "targetStart": "2026-10-05T00:00:00Z"])]
        XCTAssertEqual(TrackRecord.firstVersionIndex(rows), [1, 2])
        // Claim keys round coordinates as JavaScript's toFixed does (the exact stored value, not a tie).
        XCTAssertEqual(JS.toFixed(34.8625, 3), "34.862")
        XCTAssertEqual(JS.toFixed(2.5, 0), "3")
        XCTAssertEqual(JS.toFixed(1.005, 2), "1.00")
    }

    // MARK: C47 India's zone label

    func testIndiaZoneLabel() {
        XCTAssertEqual(Format.tzMenuLabel("Asia/Kolkata"), "India (IST)")
        XCTAssertEqual(Format.tzLabel("Asia/Calcutta"), "IST")
        XCTAssertEqual(Format.zoneName("Asia/Katmandu"), "Asia/Kathmandu")
    }
}
