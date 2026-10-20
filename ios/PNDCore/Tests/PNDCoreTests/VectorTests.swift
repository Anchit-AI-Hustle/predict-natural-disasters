import XCTest
@testable import PNDCore

/// Every logic.md rule against `test-vectors.json`, the outputs of the
/// website's own JavaScript.
final class VectorTests: XCTestCase {
    func each(_ key: String, file: StaticString = #filePath, line: UInt = #line, _ body: (JSONValue, JSONValue, String) -> Void) {
        let g = Fixtures.group(key)
        XCTAssertFalse(g.isEmpty, "no vectors for \(key)", file: file, line: line)
        for (i, v) in g.enumerated() {
            let tz = v["tz"]?.stringValue
            withZone(tz) { body(v["in"] ?? .null, v["out"] ?? .null, "\(key)[\(i)] tz=\(tz ?? "-")") }
        }
    }

    func testRiskLevelOf() {
        each("risk.levelOf") { i, o, m in XCTAssertEqual(RiskScale.levelOf(i).rawValue, o.stringValue, m) }
    }

    func testMarkerIcon() {
        each("risk.markerIcon") { i, o, m in
            let mk = RiskScale.marker(alert: i.isNull ? nil : i.jsString, label: "Flood in X")
            XCTAssertEqual(mk.level.rawValue, o["level"]?.stringValue, m)
            XCTAssertEqual(mk.colourHex, o["colour"]?.stringValue, m)
            XCTAssertEqual(mk.size, o["iconSize"]?[0]?.numberValue, m)
            XCTAssertEqual(mk.label, o["label"]?.stringValue, m)
        }
    }

    func testRiskLabelAndFilter() {
        each("portal.riskLabel") { i, o, m in XCTAssertEqual(RiskScale.label(of: rec(i)), o.stringValue, m) }
        each("portal.matchesRiskLevel") { i, o, m in
            XCTAssertEqual(RiskScale.matches(rec(i[0]), i[1]?.stringValue), o.boolValue, m)
        }
        each("portal.riskLevelOptions") { _, o, m in
            XCTAssertEqual(RiskLevel.filterOptions.map { $0.rawValue }, o.arrayValue?.compactMap { $0["value"]?.stringValue }, m)
            XCTAssertEqual(RiskLevel.filterOptions.map { $0.label }, o.arrayValue?.compactMap { $0["label"]?.stringValue }, m)
        }
    }

    func testRiskTagTitle() {
        each("portal.riskTagHtml") { i, o, m in
            let html = o.stringValue ?? ""
            let e = rec(i)
            let title = RiskScale.badgeTitle(of: e)
            XCTAssertTrue(html.contains("title=\"" + title + "\""), m + " title: " + title)
            XCTAssertTrue(html.contains(">" + RiskScale.level(of: e).label + "</span>"), m)
            XCTAssertTrue(html.contains("risk-" + RiskScale.level(of: e).rawValue.lowercased()), m)
        }
    }

    func testHazardOf() {
        each("hazards.hazardOf.name") { i, o, m in XCTAssertEqual(Hazards.hazardOf(i.stringValue).name, o.stringValue, m) }
        each("hazards.horizonHours") { i, o, m in XCTAssertEqual(Double(Hazards.horizonHours(i.stringValue)), o.numberValue, m) }
    }

    func testSeverityOf() {
        each("hazards.severityOf") { i, o, m in
            let e = rec(i)
            let s = Hazards.severityOf(e)
            XCTAssertEqual(s.severity, o["severity"]?.stringValue, m)
            XCTAssertEqual(Double(s.rank), o["rank"]?.numberValue, m)
            XCTAssertEqual(Double(Hazards.impactRank(e)), o["impactRank"]?.numberValue, m)
            XCTAssertEqual(Double(Hazards.alertRank(e)), o["alertRank"]?.numberValue, m)
        }
    }

    func testCycloneCategory() {
        each("hazards.cycloneCategory") { i, o, m in
            XCTAssertEqual(Hazards.cycloneCategory(i.isNull ? nil : i.jsNumber), o.stringValue, m)
        }
    }

    func testKeyFacts() {
        each("hazards.keyFacts") { i, o, m in
            let facts = Hazards.keyFacts(rec(i))
            let want = o.arrayValue ?? []
            XCTAssertEqual(facts.count, want.count, m)
            for (f, w) in zip(facts, want) {
                XCTAssertEqual(f.key, w["key"]?.stringValue, m)
                XCTAssertEqual(f.label, w["label"]?.stringValue, m)
                XCTAssertEqual(f.reported, w["reported"]?.boolValue, m + " " + f.key)
                XCTAssertEqual(f.value, w["value"]?.stringValue, m + " " + f.key)
                XCTAssertEqual(f.note, w["note"]?.stringValue, m + " " + f.key)
            }
        }
        each("portal.keyFactsLine") { i, o, m in
            XCTAssertEqual(Hazards.keyFactsLine(rec(i[0]), max: Int(i[1]?.numberValue ?? 3)), o.stringValue, m)
        }
    }

    func testLeadTime() {
        each("hazards.leadTimeText") { i, o, m in
            let e = rec(i)
            XCTAssertEqual(Hazards.leadTimeHours(e), o["hours"]?.numberValue, m)
            XCTAssertEqual(Hazards.leadTimeText(e), o["text"]?.stringValue, m)
        }
    }

    func testClassifyForecast() {
        each("hazards.classifyForecast") { i, o, m in
            let parent = i[1].map { rec($0) }
            let c = Hazards.classifyForecast(rec(i[0]), parent: parent)
            if o.isNull { XCTAssertNil(c, m); return }
            XCTAssertEqual(c?.forecastClass, o["forecastClass"]?.stringValue, m)
            XCTAssertEqual(c?.reason, o["classificationReason"]?.stringValue, m)
        }
    }

    func testDistanceAndGeometry() {
        each("hazards.distanceKm") { i, o, m in
            let a = (i.arrayValue ?? []).map { $0.jsNumber }
            XCTAssertEqual(Geo.distanceKm(a[0], a[1], a[2], a[3]), o.numberValue!, accuracy: 0.001, m)
        }
        each("hazards.geometryContains") { i, o, m in
            let r = Geo.geometryContains(i[0], i[1]?.jsNumber ?? .nan, i[2]?.jsNumber ?? .nan)
            XCTAssertEqual(r, o.boolValue, m)
        }
    }

    func testRiskRow() {
        each("hazards.riskRow") { i, o, m in
            let r = PlaceRisk.riskRow(Fixtures.event(i[0]!.stringValue!), Fixtures.place(i[1]!.stringValue!))
            if o.isNull { XCTAssertNil(r, m); return }
            guard let row = r else { return XCTFail(m) }
            XCTAssertEqual(row.band.rawValue, o["band"]?.stringValue, m)
            if let d = o["distanceKm"]?.numberValue { XCTAssertEqual(row.distanceKm ?? -1, d, accuracy: 0.05, m) } else { XCTAssertNil(row.distanceKm, m) }
            XCTAssertEqual(row.claimDistance, o["claimDistance"]?.boolValue, m)
            XCTAssertEqual(row.containment, o["containment"]?.boolValue, m)
            XCTAssertEqual(row.applicability, o["applicability"]?.stringValue, m)
        }
    }

    func testAssess() {
        each("placeRisk.assess") { i, o, m in
            let place = Fixtures.place(i[0]!.stringValue!)
            let events = (i[1]?.arrayValue ?? []).map { Fixtures.event($0.stringValue!) }
            let a = PlaceRisk.assess(place, events)
            XCTAssertEqual(a.level?.rawValue, o["level"]?.stringValue, m)
            XCTAssertEqual(a.headline, o["headline"]?.stringValue, m)
            XCTAssertEqual(a.why, o["why"]?.stringValue, m)
            XCTAssertEqual(a.lead?.event.id, o["leadId"]?.stringValue, m)
            XCTAssertEqual(a.lead?.row.band.rawValue, o["leadBand"]?.stringValue, m)
            XCTAssertEqual(Double(a.searchedKm), o["searchedKm"]?.numberValue, m)
            let acts = PlaceRisk.actionsFor(a)
            XCTAssertEqual(acts.steps, o["actions"]?["steps"]?.arrayValue?.compactMap { $0.stringValue }, m)
            XCTAssertEqual(acts.authority, o["actions"]?["authority"]?.stringValue, m)
            XCTAssertEqual(acts.official, o["actions"]?["official"]?.boolValue, m)
        }
        each("placeRisk.nearLevel(table)") { i, o, m in
            let e = Record(["severity": i[0]!])
            XCTAssertEqual(PlaceRisk.nearLevel(e, i[1]!.jsNumber)?.rawValue, o["level"]?.stringValue, m)
        }
    }

    func testAlertRules() {
        each("alertRules.alertFor") { i, o, m in
            var e = Fixtures.event(i[0]!.stringValue!)
            if let extra = i[2]?.objectValue { e = e.with(extra.mapValues { Optional($0) }) }
            let a = AlertRules.alertFor(e, Fixtures.place(i[1]!.stringValue!), now: Fixtures.now)
            if o.isNull { XCTAssertNil(a, m); return }
            XCTAssertEqual(a?.key, o["key"]?.stringValue, m)
            XCTAssertEqual(a?.eventId, o["eventId"]?.stringValue, m)
            XCTAssertEqual(a?.rank ?? -1, o["rank"]?.numberValue ?? -2, accuracy: 1e-9, m)
            XCTAssertEqual(a?.title, o["title"]?.stringValue, m)
            XCTAssertEqual(a?.body, o["body"]?.stringValue, m)
            XCTAssertEqual(a?.url, o["url"]?.stringValue, m)
            XCTAssertEqual(a?.tag, o["tag"]?.stringValue, m)
        }
        each("alertRules.alertsFor") { _, o, m in
            let events = (Fixtures.vectors["fixtures.events"]?.objectValue ?? [:]).keys.sorted().map { Fixtures.event($0) }
            let all = AlertRules.alertsFor(events, [Fixtures.place("home"), Fixtures.place("phx")], now: Fixtures.now)
            XCTAssertEqual(all.map { $0.key }, o.arrayValue?.compactMap { $0["key"]?.stringValue }, m)
        }
        each("alertRules.roundCoord") { i, o, m in XCTAssertEqual(AlertRules.roundCoord(i), o.numberValue, m) }
        each("alertRules.urlFor") { i, o, m in XCTAssertEqual(AlertRules.urlFor(rec(i)), o.stringValue, m) }
    }

    func testTitlePlaceSource() {
        each("portal.titleOf") { i, o, m in XCTAssertEqual(Format.titleOf(rec(i)), o.stringValue, m) }
        each("portal.placeOf") { i, o, m in
            XCTAssertEqual(Format.placeOf(rec(i[0]), i[1]?.stringValue ?? ""), o.stringValue, m)
        }
        each("portal.shortSource") { i, o, m in XCTAssertEqual(Format.shortSource(i.stringValue), o.stringValue, m) }
        each("portal.provenance") { i, o, m in XCTAssertEqual(Format.provenance(rec(i)), o.stringValue, m) }
        each("portal.eventUrl") { i, o, m in XCTAssertEqual(Format.eventPath(rec(i)), o.stringValue, m) }
    }

    func testDates() {
        each("portal.duration") { i, o, m in XCTAssertEqual(Format.duration(i[0]?.stringValue, i[1]?.stringValue), o.stringValue, m) }
        each("portal.fmtDate") { i, o, m in XCTAssertEqual(Format.fmtDate(i.isNull ? nil : i.jsString), o.stringValue, m) }
        each("portal.fmtTime") { i, o, m in XCTAssertEqual(Format.fmtTime(i.isNull ? nil : i.jsString), o.stringValue, m) }
        each("portal.fmtWhen") { i, o, m in
            XCTAssertEqual(Format.fmtWhen(i[0]?.stringValue, i[1]?.stringValue, i[2]?.stringValue), o.stringValue, m)
        }
        each("portal.windowText") { i, o, m in XCTAssertEqual(Format.windowText(rec(i)), o.stringValue, m) }
        each("portal.horizonText") { i, o, m in XCTAssertEqual(Format.horizonText(i), o.stringValue, m) }
        each("portal.age") { i, o, m in XCTAssertEqual(Format.age(i.stringValue), o.stringValue, m) }
    }

    func testCountsAndText() {
        each("portal.countryCount") { i, o, m in
            XCTAssertEqual(Double(Format.countryCount((i[0]?.arrayValue ?? []).map { rec($0) })), o.numberValue, m)
        }
        each("portal.impactText") { i, o, m in XCTAssertEqual(Format.impactText(rec(i)), o.stringValue, m) }
        each("portal.summary") { i, o, m in
            XCTAssertEqual(Format.summary(i[0]?.stringValue, max: Int(i[1]?.numberValue ?? 160)), o.stringValue, m)
        }
        each("portal.quietNote") { i, o, m in XCTAssertEqual(Format.quietNote(rec(i)), o.stringValue, m) }
        each("portal.statusText") { i, o, m in XCTAssertEqual(Format.statusText(i), o.stringValue, m) }
        each("portal.sourcesRatio") { i, o, m in XCTAssertEqual(Format.sourcesRatio(i), o.stringValue, m) }
    }

    func testFindEvent() {
        each("portal.findEvent") { i, o, m in
            let list = (i[0]?.arrayValue ?? []).map { rec($0) }
            XCTAssertEqual(Format.findEvent(list, i[1]?.stringValue)?.id, o.stringValue, m)
        }
    }

    func testHazardOptions() {
        each("portal.hazardOptions") { i, o, m in
            let opts = Format.hazardOptions((i[0]?.arrayValue ?? []).map { rec($0) }, selected: i[1]?.stringValue ?? "")
            let html = opts.map { "<option value=\"\($0.value)\"" + ($0.value == (i[1]?.stringValue ?? "") && !$0.value.isEmpty ? " selected" : "") + ">\($0.label)</option>" }.joined()
            XCTAssertEqual(html, o.stringValue, m)
        }
    }

    func testSorts() {
        let labels = Fixtures.vectors["portal.SORT_DEFS.labels"]?.objectValue ?? [:]
        for (k, v) in labels { XCTAssertEqual(Sorts.label(k), v.stringValue, k) }
        XCTAssertEqual(Sorts.eventSorts, Fixtures.vectors["portal.EVENT_SORTS"]?.arrayValue?.compactMap { $0.stringValue })
        let fixture = Fixtures.group("sort.fixture").map { rec($0) }
        for (k, v) in Fixtures.vectors["sort.results"]?.objectValue ?? [:] {
            XCTAssertEqual(Sorts.apply(fixture, k).map { $0.id }, v.arrayValue?.compactMap { $0.stringValue }, "sort " + k)
        }
        let byId = Dictionary(uniqueKeysWithValues: fixture.map { ($0.id, $0) })
        for v in Fixtures.group("sort.rankOf") {
            let id = v["id"]!.stringValue!
            let e: Record
            switch id {
            case "alertOnly-High": e = Record(["alert": "High"])
            case "alertOnly-Severe": e = Record(["alert": "Severe"])
            case "rank0": e = Record(["severityRank": 0, "alert": "Orange"])
            default: e = byId[id]!
            }
            XCTAssertEqual(Double(Sorts.rankOf(e)), v["rank"]?.numberValue, "rankOf " + id)
        }
        for v in Fixtures.group("sort.timeOf") {
            XCTAssertEqual(byId[v["id"]!.stringValue!]!.time, v["t"]?.numberValue, "timeOf")
        }
    }

    func testSearch() {
        each("search.matches") { i, o, m in XCTAssertEqual(Search.matches(rec(i[0]), i[1]?.stringValue), o.boolValue, m) }
        each("search.matchesPlace") { i, o, m in XCTAssertEqual(Search.matchesPlace(rec(i[0]), i[1]?.stringValue), o.boolValue, m) }
        each("search.emptyHtml") { i, o, m in
            let e = Search.empty(query: i[0]?.stringValue, all: (i[2]?.arrayValue ?? []).map { rec($0) }, noun: i[3]?.stringValue ?? "events")
            let html = o.stringValue ?? ""
            XCTAssertTrue(html.contains("<b>" + e.title + "</b>"), m + e.title)
            if let d = e.detail { XCTAssertTrue(html.contains(d), m + d) }
            if let b = e.buttonText { XCTAssertTrue(html.contains(b), m + b) }
        }
        each("glossary.expandAlways") { i, o, m in XCTAssertEqual(Glossary.expandAlways(i.stringValue ?? ""), o.stringValue, m) }
    }

    func testPlaceSearch() {
        each("placeSearch.levelOf") { i, o, m in XCTAssertEqual(PlaceSearch.levelOf(i), o.stringValue, m) }
        each("placeSearch.labelOf") { i, o, m in XCTAssertEqual(PlaceSearch.labelOf(i), o.stringValue, m) }
        each("placeSearch.candidates") { i, o, m in
            let c = PlaceSearch.candidates(i[0] ?? .array([]))
            let want = o.arrayValue ?? []
            XCTAssertEqual(c.count, want.count, m)
            for (a, b) in zip(c, want) {
                XCTAssertEqual(a.kind, b["kind"]?.stringValue, m)
                XCTAssertEqual(a.name, b["name"]?.stringValue, m)
                XCTAssertEqual(a.full, b["full"]?.stringValue, m)
                XCTAssertEqual(a.level, b["level"]?.stringValue, m)
                XCTAssertEqual(a.lat, b["lat"]?.numberValue, m)
                XCTAssertEqual(a.lon, b["lon"]?.numberValue, m)
                XCTAssertEqual(a.country, b["country"]?.stringValue, m)
                XCTAssertEqual(a.countryCode, b["countryCode"]?.stringValue, m)
            }
        }
    }

    func testVerdicts() {
        each("verdicts.normalise") { i, o, m in XCTAssertEqual(Verdicts.normalise(i), o.stringValue, m) }
        each("verdicts.stateOf") { i, o, m in XCTAssertEqual(Verdicts.stateOf(rec(i), now: Fixtures.now), o.stringValue, m) }
        each("verdicts.engineState") { i, o, m in XCTAssertEqual(Verdicts.engineState(i.isNull ? nil : i), o.stringValue, m) }
        each("verdicts.rate") { i, o, m in
            let r = Verdicts.rate(Int(i[0]!.jsNumber), Int(i[1]!.jsNumber))
            XCTAssertEqual(r.text, o["text"]?.stringValue, m)
            XCTAssertEqual(r.pct.map(Double.init), o["pct"]?.numberValue, m)
        }
        each("verdicts.tally") { i, o, m in
            let t = Verdicts.tally((i[0]?.arrayValue ?? []).map { rec($0) }, now: Fixtures.now)
            let pairs: [(Int, String)] = [(t.total, "total"), (t.open, "open"), (t.awaiting, "awaiting"), (t.verified, "verified"),
                (t.partial, "partial"), (t.falseAlarm, "falseAlarm"), (t.missed, "missed"), (t.coverageFailure, "coverageFailure"),
                (t.ungradeable, "ungradeable"), (t.notPrediction, "notPrediction"), (t.unknown, "unknown"), (t.matured, "matured"), (t.graded, "graded")]
            for (v, k) in pairs { XCTAssertEqual(Double(v), o[k]?.numberValue, m + " " + k) }
            XCTAssertEqual(t.precision.text, o["precision"]?["text"]?.stringValue, m)
            XCTAssertEqual(t.recall.text, o["recall"]?["text"]?.stringValue, m)
        }
        each("verdicts.joinVerdicts") { i, o, m in
            let j = Verdicts.joinVerdicts((i[0]?.arrayValue ?? []).map { rec($0) }, (i[1]?.arrayValue ?? []).map { rec($0) })
            let want = o["records"]?.arrayValue ?? []
            XCTAssertEqual(j.records.count, want.count, m)
            for (r, w) in zip(j.records, want) {
                for (k, v) in w.objectValue ?? [:] {
                    XCTAssertEqual(r[k] ?? .null, v, m + " " + k)
                }
            }
            XCTAssertEqual(j.unattached.map { $0.id }, o["unattached"]?.arrayValue?.compactMap { $0.stringValue }, m)
        }
    }

    func testVerificationScore() {
        each("verification.score") { i, o, m in
            let s = Verification.score(i[0]?.arrayValue ?? [], i[1]?.arrayValue ?? [])
            let pairs: [(Int, String)] = [(s.hit, "hit"), (s.partial, "partial"), (s.miss, "miss"), (s.pending, "pending"), (s.invalid, "invalid"),
                (s.hitsOutsideCoverage, "hitsOutsideCoverage"), (s.ungradeable, "ungradeable"), (s.eligibleMaturedPredictions, "eligibleMaturedPredictions"),
                (s.significantObservedEvents, "significantObservedEvents"), (s.predictedEvents, "predictedEvents"),
                (s.partlyPredictedEvents, "partlyPredictedEvents"), (s.falseNegatives, "falseNegatives")]
            for (v, k) in pairs { XCTAssertEqual(Double(v), o[k]?.numberValue, m + " " + k) }
            for (k, v) in o["coverage"]?.objectValue ?? [:] { XCTAssertEqual(Double(s.coverage[k] ?? -1), v.numberValue, m + " " + k) }
            for (k, v) in o["ungradeableBy"]?.objectValue ?? [:] { XCTAssertEqual(Double(s.ungradeableBy[k] ?? -1), v.numberValue, m + " " + k) }
            XCTAssertEqual(s.precision, o["precision"]?.numberValue, m)
            XCTAssertEqual(s.recall, o["recall"]?.numberValue, m)
            if let f = o["f1"]?.numberValue { XCTAssertEqual(s.f1 ?? -1, f, accuracy: 1e-12, m) } else { XCTAssertNil(s.f1, m) }
        }
        each("verification.predictingSince") { i, o, m in
            XCTAssertEqual(Verification.predictingSince((i[0]?.arrayValue ?? []).map { rec($0) }), o.numberValue, m)
        }
    }

    func testEveryVectorGroupIsCovered() {
        let covered: Set<String> = ["meta", "risk.levelOf", "risk.markerIcon", "portal.riskLabel", "portal.matchesRiskLevel", "portal.riskTagHtml",
            "portal.riskLevelOptions", "hazards.hazardOf.name", "hazards.horizonHours", "hazards.severityOf", "hazards.cycloneCategory",
            "hazards.keyFacts", "portal.keyFactsLine", "hazards.leadTimeText", "hazards.classifyForecast", "hazards.distanceKm",
            "hazards.geometryContains", "hazards.riskRow", "fixtures.places", "fixtures.events", "placeRisk.assess", "placeRisk.nearLevel(table)",
            "alertRules.alertFor", "alertRules.alertsFor", "alertRules.roundCoord", "alertRules.urlFor", "portal.titleOf", "portal.placeOf",
            "portal.shortSource", "portal.provenance", "portal.eventUrl", "portal.duration", "portal.fmtDate", "portal.fmtTime", "portal.fmtWhen",
            "portal.windowText", "portal.horizonText", "portal.age", "portal.countryCount", "portal.impactText", "portal.summary",
            "portal.quietNote", "portal.statusText", "portal.sourcesRatio", "portal.findEvent", "portal.hazardOptions", "portal.SORT_DEFS.labels",
            "portal.EVENT_SORTS", "sort.fixture", "sort.results", "sort.rankOf", "sort.timeOf", "search.matches", "search.matchesPlace",
            "search.emptyHtml", "glossary.expandAlways", "placeSearch.levelOf", "placeSearch.labelOf", "placeSearch.candidates",
            "verdicts.normalise", "verdicts.stateOf", "verdicts.engineState", "verdicts.rate", "verdicts.tally", "verdicts.joinVerdicts",
            "verification.score", "verification.predictingSince"]
        let all = Set((Fixtures.vectors.objectValue ?? [:]).keys)
        XCTAssertEqual(all.subtracting(covered), [], "vector groups without a test")
    }
}
