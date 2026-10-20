import XCTest
@testable import PNDCore

/// The 36 vector groups added for the website audit fixes (changelog C1 to
/// C25 in features.md; logic.md sections 6.10 to 6.13, 8, 10.4b and 11).
/// Every one of them is asserted here; `VectorTests.testEveryVectorGroupIsCovered`
/// fails when a group in test-vectors.json has no test.
final class ParityVectorTests: XCTestCase {
    func each(_ key: String, file: StaticString = #filePath, line: UInt = #line, _ body: (JSONValue, JSONValue, String) -> Void) {
        let g = Fixtures.group(key)
        XCTAssertFalse(g.isEmpty, "no vectors for \(key)", file: file, line: line)
        for (i, v) in g.enumerated() {
            let tz = v["tz"]?.stringValue
            withZone(tz) { body(v["in"] ?? .null, v["out"] ?? .null, "\(key)[\(i)]") }
        }
    }

    func obj(_ key: String) -> JSONValue {
        let v = Fixtures.vectors[key]
        XCTAssertNotNil(v, "no vectors for \(key)")
        return v ?? .null
    }

    func strings(_ v: JSONValue?) -> [String] { v?.arrayValue?.compactMap { $0.stringValue } ?? [] }

    /// Fixture records by id.
    func fixture(_ key: String) -> [String: Record] {
        var out: [String: Record] = [:]
        for v in Fixtures.group(key) { let r = rec(v); out[r.id] = r }
        return out
    }

    func fixtureList(_ key: String) -> [Record] { Fixtures.group(key).map { rec($0) } }

    // MARK: C16 windowEnd

    func testSortWindowEndEnded() {
        let g = obj("sort.windowEndEnded")
        let list = (g["fixture"]?.arrayValue ?? []).map { rec($0) }
        let now = JSDate.ms(g["now"]?.stringValue)!
        let old = Format.now
        Format.now = { now }
        defer { Format.now = old }
        XCTAssertEqual(Sorts.apply(list, "windowEnd").map { $0.id }, strings(g["out"]))
        XCTAssertFalse(strings(g["out"]).isEmpty)
    }

    // MARK: C15 empty counts

    func testSearchEmptyCounts() {
        each("search.emptyHtml.counts") { i, o, m in
            let all = (i[1]?.arrayValue ?? []).map { rec($0) }
            let e = Search.empty(query: i[0]?.stringValue, all: all, noun: "events")
            let html = o.stringValue ?? ""
            XCTAssertTrue(html.contains("<b>" + e.title + "</b>"), m + " " + e.title)
            XCTAssertNotNil(e.detail, m)
            XCTAssertTrue(html.contains(e.detail ?? "-"), m + " " + (e.detail ?? ""))
        }
        each("search.countryCount") { i, o, m in
            XCTAssertEqual(Double(Search.countryCount((i[0]?.arrayValue ?? []).map { rec($0) })), o.numberValue, m)
        }
    }

    // MARK: C1 continents and inPlace

    func testContinents() {
        XCTAssertEqual(Continents.names, strings(Fixtures.vectors["continents.NAMES"]))
        each("continents.continentNamed") { i, o, m in
            XCTAssertEqual(Continents.continentNamed(i.stringValue), o.stringValue, m)
        }
        let places = fixture("fixtures.places.continents")
        XCTAssertEqual(places.count, Fixtures.group("fixtures.places.continents").count, "fixture ids are unique")
        each("continents.continentsOf") { i, o, m in
            XCTAssertEqual(Continents.continentsOf(places[i.stringValue!]!), strings(o), m)
        }
        each("continents.onContinent") { i, o, m in
            XCTAssertEqual(Continents.onContinent(places[i[0]!.stringValue!]!, i[1]?.stringValue), o.boolValue, m)
        }
        each("portal.inPlace") { i, o, m in
            XCTAssertEqual(Format.inPlace(places[i[0]!.stringValue!]!, i[1]?.stringValue), o.boolValue, m)
        }
    }

    func testRegionDetailMatches() {
        let places = fixtureList("fixtures.places.continents")
        each("regionDetail.matches") { i, o, m in
            let r = Screens.regionMatcher(i[0]!.stringValue!)
            let ids = Set(strings(i[1]))
            XCTAssertEqual(r.region, o["region"]?.stringValue, m)
            XCTAssertEqual(places.filter { ids.contains($0.id) }.filter(r.matches).map { $0.id }, strings(o["ids"]), m)
        }
    }

    // MARK: C2 and C21 hazards

    func testHazardKey() {
        each("portal.hazardKey") { i, o, m in XCTAssertEqual(Format.hazardKey(i.stringValue), o.stringValue, m) }
        each("portal.sameHazard") { i, o, m in XCTAssertEqual(Format.sameHazard(i[0]?.stringValue, i[1]?.stringValue), o.boolValue, m) }
    }

    func testHazardDetail() {
        each("hazardDetail.fillHazards") { i, o, m in
            let type = i[0]!.stringValue!
            let start = Screens.hazardChoices(requested: type, present: [])
            XCTAssertEqual(start.selected, o["selectedAtStart"]?.stringValue, m)
            let after = Screens.hazardChoices(requested: type, present: strings(i[1]), current: start.selected)
            XCTAssertEqual(after.options, strings(o["options"]), m)
            XCTAssertEqual(after.selected, o["selected"]?.stringValue, m)
        }
        let list = fixtureList("fixtures.events.hazards")
        XCTAssertEqual(list.count, 10)
        each("hazardDetail.select") { i, o, m in
            let h = i[0]!.stringValue!, r = i[1]?.stringValue ?? ""
            let here: (Record) -> Bool = { Screens.hazardMatches($0, hazard: h, region: r) }
            XCTAssertEqual(Format.observed(list).filter(here).map { $0.id }, strings(o["events"]), m)
            XCTAssertEqual(Format.openForecasts(list).filter(here).map { $0.id }, strings(o["openForecasts"]), m)
        }
    }

    // MARK: C3 and C14 one count per quantity

    func testOfficialWarnings() {
        let byId = fixture("fixtures.events.warnings")
        XCTAssertEqual(byId.count, 10)
        each("portal.isOfficialWarning") { i, o, m in
            XCTAssertEqual(Format.isOfficialWarning(i.stringValue.flatMap { byId[$0] }), o.boolValue, m)
        }
        let g = obj("portal.officialWarnings")
        XCTAssertEqual(Format.officialWarnings(strings(g["in"]).map { byId[$0]! }).map { $0.id }, strings(g["out"]))
        XCTAssertEqual(Format.warningMeaning, Fixtures.vectors["portal.WARNING_MEANING"]?.stringValue)
    }

    func testCounts() {
        let byId = fixture("fixtures.events.mixed")
        XCTAssertEqual(byId.count, 9)
        let o = obj("portal.observed"), f = obj("portal.openForecasts")
        XCTAssertEqual(Format.observed(strings(o["in"]).map { byId[$0]! }).map { $0.id }, strings(o["out"]))
        XCTAssertEqual(Format.openForecasts(strings(f["in"]).map { byId[$0]! }).map { $0.id }, strings(f["out"]))
        each("portal.isHighAlert") { i, o, m in XCTAssertEqual(Format.isHighAlert(i.stringValue.flatMap { byId[$0] }), o.boolValue, m) }
        each("portal.sourcesReporting") { i, o, m in
            XCTAssertEqual(Double(Format.sourcesReporting(strings(i[0]).map { byId[$0]! })), o.numberValue, m)
        }
    }

    // MARK: C5 live:false wording

    func testLiveWords() {
        each("portal.liveWord") { i, o, m in XCTAssertEqual(Format.liveWord(i.isNull ? nil : rec(i)), o.stringValue, m) }
        each("detail.statusWords") { i, o, m in
            let e = rec(i)
            XCTAssertEqual(Format.eventEyebrow(e), o["eventEyebrow"]?.stringValue, m)
            XCTAssertEqual(Format.liveWord(e), o["eventDataStatus"]?.stringValue, m)
            XCTAssertEqual(Format.eventRecordState(e), o["eventRecordState"]?.stringValue, m)
            XCTAssertEqual(Format.calamityStatus(e), o["calamityStatus"]?.stringValue, m)
        }
    }

    // MARK: C3, C14 and C17 collection lists

    func testCollectionKeep() {
        let list = fixtureList("fixtures.events.collection")
        XCTAssertEqual(list.count, 29)
        each("collection.keep") { i, o, m in
            guard let v = CollectionView(rawValue: i[0]!.stringValue!) else { return XCTFail(m) }
            let kept = list.filter { v.keep($0) }
            let scoped = CollectionView.scoped(kept, region: i[1]?.stringValue)
            XCTAssertEqual(kept.map { $0.id }, strings(o["kept"]), m)
            XCTAssertEqual(scoped.map { $0.id }, strings(o["scoped"]), m)
            XCTAssertEqual(v.countText(shown: scoped.count, kept: scoped, noun: "items"), o["countText"]?.stringValue, m)
        }
    }

    // MARK: C4 graded forecast status

    func testVerdictLabels() {
        let want = Fixtures.vectors["verdicts.LABELS"]?.objectValue ?? [:]
        XCTAssertFalse(want.isEmpty)
        XCTAssertEqual(Verdicts.labels, want.mapValues { $0.stringValue ?? "" })
        each("verdicts.label") { i, o, m in XCTAssertEqual(Verdicts.label(i), o.stringValue, m) }
    }

    func testForecastGrade() {
        let files = obj("fixtures.verdictFiles")
        let ledger = files["/data/verification-ledger.json"], models = files["/data/model-verdicts.json"]
        XCTAssertNotNil(ledger)
        XCTAssertNotNil(models)
        each("forecastDetail.gradeOf") { i, o, m in
            let id = i[0]!.stringValue!
            let down = i[2]?.boolValue ?? false
            let l = down ? nil : ledger, md = down ? nil : models
            let g = Verdicts.gradeOf(id: id, ledger: l, models: md)
            // The model file is read only when the ledger has no grade.
            if !Verdicts.needsModelVerdicts(id: id, ledger: l) { XCTAssertEqual(Verdicts.gradeOf(id: id, ledger: l, models: nil), g, m) }
            if o["grade"]?.isNull ?? true {
                XCTAssertNil(g, m)
            } else {
                XCTAssertEqual(g?.label, o["grade"]?["label"]?.stringValue, m)
                XCTAssertEqual(g?.summary, o["grade"]?["summary"]?.stringValue, m)
            }
            XCTAssertEqual(Verdicts.forecastStatus(grade: g, targetEnd: i[1]?.stringValue, now: Fixtures.now), o["status"]?.stringValue, m)
        }
    }

    // MARK: C9 time zone default

    func testTimezoneDefault() {
        each("portal.timezoneDefault") { i, o, m in
            let browser = i[1]?.stringValue
            let tz = Format.timezoneDefault(stored: i[0]?.stringValue, device: browser == "throws" ? nil : browser)
            XCTAssertEqual(tz, o["timezone"]?.stringValue, m)
            XCTAssertEqual(Format.tzLabel(tz), o["tzLabel"]?.stringValue, m)
            XCTAssertEqual(Format.fmtDate("2026-10-20T11:24:19Z", tz: tz), o["fmtDate"]?.stringValue, m)
            // The trust note writes the same moment the same way (one zone per screen).
            XCTAssertEqual(Trust.when("2026-10-20T11:24:19Z", tz: tz), o["fmtDate"]?.stringValue, m)
        }
    }

    // MARK: C3, C7, C8 and C13 the home page

    func testHomeRender() {
        let g = obj("home.render")
        let feed = (g["feed"]?.arrayValue ?? []).map { rec($0) }
        XCTAssertFalse(feed.isEmpty)
        let live = feed.filter { $0.isLive }
        let opts = Format.hazardOptions(live, selected: "")
        XCTAssertEqual(opts.map { $0.value }, (g["hazardFilterOptions"]?.arrayValue ?? []).map { $0["value"]?.stringValue ?? "" })
        XCTAssertEqual(opts.map { $0.label }, (g["hazardFilterOptions"]?.arrayValue ?? []).map { $0["label"]?.stringValue ?? "" })
        XCTAssertEqual(Home.sortKeys, (g["sortOptions"]?.arrayValue ?? []).map { $0["value"]?.stringValue ?? "" })
        XCTAssertEqual(Home.sortKeys.map { Sorts.label($0) }, (g["sortOptions"]?.arrayValue ?? []).map { $0["label"]?.stringValue ?? "" })
        XCTAssertEqual(Home.warningsTileNote, g["warningsTileNote"]?.stringValue)
        XCTAssertEqual(Format.warningMeaning, g["warningsTileTitle"]?.stringValue)
        XCTAssertEqual(Home.liveEventsHeading, g["liveEventsHeading"]?.stringValue)
        let cases = g["cases"]?.arrayValue ?? []
        XCTAssertEqual(cases.count, 8)
        withZone(nil) {
            for c in cases {
                let h = c["in"]?["hazardFilter"]?.stringValue ?? "", s = c["in"]?["sort"]?.stringValue ?? ""
                let o = c["out"] ?? .null
                let m = "home.render \(h)/\(s)"
                let r = Home.render(live, hazardFilter: h, sort: s)
                XCTAssertEqual("\(r.kEvents)", o["kEvents"]?.stringValue, m)
                XCTAssertEqual(r.kEventsNote, o["kEventsNote"]?.stringValue, m)
                XCTAssertEqual("\(r.kWarnings)", o["kWarnings"]?.stringValue, m)
                XCTAssertEqual("\(r.kForecasts)", o["kForecasts"]?.stringValue, m)
                XCTAssertEqual(r.kForecastsNote, o["kForecastsNote"]?.stringValue, m)
                XCTAssertEqual("\(r.kCountries)", o["kCountries"]?.stringValue, m)
                XCTAssertEqual(r.liveEvents.map { $0.id }, strings(o["liveEvents"]), m)
                func cells(_ v: JSONValue?) -> [[String]] { (v?.arrayValue ?? []).map { strings($0) } }
                XCTAssertEqual(r.latestEvents.map { Home.latestEventCells($0) }, cells(o["latestEvents"]), m)
                XCTAssertEqual(r.officialWarnings.isEmpty ? [[Home.noWarnings]] : r.officialWarnings.map { Home.warningCells($0) }, cells(o["officialWarnings"]), m)
                XCTAssertEqual(r.latestForecasts.isEmpty ? [[Home.noForecasts]] : r.latestForecasts.map { Home.forecastCells($0) }, cells(o["latestForecasts"]), m)
                let strip = o["hazardStrip"]?.arrayValue ?? []
                XCTAssertEqual(r.hazardStrip.map { $0.type }, strip.map { $0["hazard"]?.stringValue ?? "" }, m)
                XCTAssertEqual(r.hazardStrip.map { $0.text }, strip.map { $0["text"]?.stringValue ?? "" }, m)
                XCTAssertEqual(r.hazardStrip.map { $0.link }, strip.map { $0["link"]?.stringValue ?? "" }, m)
                // Screens.homeKPIs is the same answer.
                let k = Screens.homeKPIs(live, hazardFilter: h)
                XCTAssertEqual(k.liveEvents, r.kEvents, m)
                XCTAssertEqual(k.warnings, r.kWarnings, m)
            }
        }
    }

    // MARK: C6 the Alerts pager

    func testAlertsPager() {
        let g = obj("alerts.pager")
        let total = Int(g["officialRecords"]?.numberValue ?? 0), page = Int(g["pageSize"]?.numberValue ?? 0)
        XCTAssertEqual(page, Screens.alertsPage)
        XCTAssertLessThan(total, Int(g["feedRecords"]?.numberValue ?? 0), "the pager counts official records only")
        let steps = g["steps"]?.arrayValue ?? []
        XCTAssertEqual(steps.count, 2)
        var limit = page
        for s in steps {
            if s["action"]?.stringValue == "show more" { limit += page }
            let p = Screens.alertsPager(total: total, limit: limit)
            let o = s["out"] ?? .null
            XCTAssertEqual(Double(p.shown), o["shown"]?.numberValue, s["action"]?.stringValue ?? "")
            XCTAssertEqual(p.note, o["note"]?.stringValue)
            XCTAssertEqual(p.button, o["button"]?.stringValue)
            XCTAssertEqual("\(total)", o["kOfficial"]?.stringValue)
        }
        // Forty or fewer: no note at all.
        XCTAssertEqual(Screens.alertsPager(total: 12, limit: 40), Screens.Pager(shown: 12, note: nil, button: nil))
    }

    // MARK: C11 the ND-001 check

    func testVerificationDetail() {
        let g = obj("verificationDetail.render")
        let fc = rec(g["fixtures"]?["forecast"])
        let reports = (g["fixtures"]?["reports"]?.arrayValue ?? []).map { rec($0) }
        var byId: [String: Record] = [fc.id: fc]
        for r in reports { byId[r.id] = r }
        let cases = g["cases"]?.arrayValue ?? []
        XCTAssertEqual(cases.count, 3)
        withZone(nil) {
            for c in cases {
                let m = c["in"]?["name"]?.stringValue ?? ""
                let events = strings(c["in"]?["events"]).map { byId[$0]! }
                let r = ForecastCheck.build(events, id: "ND-001")
                let o = c["out"] ?? .null
                XCTAssertEqual(Verdicts.checkResult(id: "ND-001", ledger: c["in"]?["ledger"], requestFailed: false), o["kVerdict"]?.stringValue, m)
                XCTAssertEqual(r.kEvidence, o["kEvidence"]?.stringValue, m)
                XCTAssertEqual(r.kTarget, o["kTarget"]?.stringValue, m)
                XCTAssertEqual(r.kWindow, o["kWindow"]?.stringValue, m)
                let rows = (o["rows"]?.arrayValue ?? []).map { strings($0) }
                XCTAssertEqual(rows.count, 8, m)
                XCTAssertEqual(r.rows.map { [$0.metric, $0.forecast, $0.actual] }, rows, m)
                XCTAssertEqual(Sorts.apply(r.matches, Sorts.eventSorts[0]).map { Format.eventPath($0) }, strings(o["evidence"]), m)
            }
        }
        XCTAssertEqual(Verdicts.checkResult(id: "ND-001", ledger: nil, requestFailed: true), "Not available")
        XCTAssertEqual(ForecastCheck.title("ND-001"), "ND-001 \u{00B7} Central Vietnam flood and landslide forecast")
        XCTAssertEqual(ForecastCheck.title("OUT-1"), "Checking forecast OUT-1")
    }

    /// The groups this file asserts (VectorTests checks every group has a test).
    static let groups: Set<String> = ["sort.windowEndEnded", "search.emptyHtml.counts", "search.countryCount", "continents.NAMES",
        "continents.continentNamed", "fixtures.places.continents", "continents.continentsOf", "continents.onContinent", "portal.inPlace",
        "regionDetail.matches", "portal.hazardKey", "portal.sameHazard", "hazardDetail.fillHazards", "fixtures.events.hazards",
        "hazardDetail.select", "fixtures.events.warnings", "portal.isOfficialWarning", "portal.officialWarnings", "portal.WARNING_MEANING",
        "fixtures.events.mixed", "portal.observed", "portal.openForecasts", "portal.isHighAlert", "portal.sourcesReporting",
        "portal.liveWord", "detail.statusWords", "fixtures.events.collection", "collection.keep", "verdicts.LABELS", "verdicts.label",
        "fixtures.verdictFiles", "forecastDetail.gradeOf", "portal.timezoneDefault", "home.render", "alerts.pager",
        "verificationDetail.render"]

    func testThirtySixNewGroups() {
        XCTAssertEqual(Self.groups.count, 36)
        let all = Set((Fixtures.vectors.objectValue ?? [:]).keys)
        XCTAssertEqual(Self.groups.subtracting(all), [], "groups named here but missing from test-vectors.json")
    }
}
