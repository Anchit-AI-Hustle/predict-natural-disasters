import XCTest
@testable import PNDCore

final class TrackRecordTests: XCTestCase {
    func testFailedLedgerShowsUnavailableAndGradesNothing() {
        let i = TrackRecord.Inputs(outlookLedger: .array([.object(["id": "A", "targetStart": "2026-10-01T00:00:00Z", "targetEnd": "2026-10-03T00:00:00Z"])]),
                                   verificationLedger: nil, observed: .object(["events": .array([])]), scanLedger: .object(["scans": .array([])]))
        let p = TrackRecord.prepare(i)
        XCTAssertFalse(p.canGrade)
        let r = TrackRecord.build(i, p, verdicts: nil, assessments: nil, now: Fixtures.now)
        XCTAssertEqual(r.ledgerError, "Some track record data could not be loaded: our record of hand-checked results. So no figure on this page tells you what happened. This is not the same as nothing having been recorded.")
        XCTAssertEqual(r.figures["mTotal"], "1")
        XCTAssertEqual(r.figures["mGraded"], "Unavailable")
        XCTAssertFalse(r.gradingAvailable)
        XCTAssertEqual(r.answerLead, "The track record could not be loaded.")
        XCTAssertTrue(r.rows.allSatisfy { $0.result == "Unavailable" })
    }

    func testEngineMissingIsSaidOutLoud() {
        let i = TrackRecord.Inputs(outlookLedger: .array([]), verificationLedger: .object([:]), observed: .object(["events": .array([])]), scanLedger: .object(["scans": .array([])]))
        let p = TrackRecord.prepare(i)
        XCTAssertTrue(p.canGrade)
        let r = TrackRecord.build(i, p, verdicts: nil, assessments: nil, now: Fixtures.now)
        XCTAssertNotNil(r.ledgerError)
        XCTAssertTrue(r.ledgerError!.contains("our automatic checker"))
    }

    func testEmptyRecordAnswer() {
        let i = TrackRecord.Inputs(outlookLedger: .array([]), verificationLedger: .object([:]), observed: .object(["events": .array([])]), scanLedger: .object(["scans": .array([])]))
        let p = TrackRecord.prepare(i)
        let r = TrackRecord.build(i, p, verdicts: [], assessments: [], now: Fixtures.now)
        XCTAssertNil(r.ledgerError)
        XCTAssertEqual(r.answerLead, "We do not have a track record of advance forecasts yet. Every forecast we have recorded was made after the danger was already known.")
        XCTAssertEqual(r.figures["ipPrecision"], "Cannot be calculated")
        XCTAssertEqual(r.answerPoints.last, "No significant disaster has been recorded yet. This does not mean nothing happened.")
    }

    func testBacktestRows() {
        let doc: JSONValue = ["places": 10, "results": [
            "heat@3": ["hits": 2, "misses": 2, "falseAlarms": 1, "correctNegatives": 95], "heat@5": ["hits": 1, "misses": 3, "falseAlarms": 2, "correctNegatives": 94],
            "rain@3": ["hits": 0, "misses": 1, "falseAlarms": 0, "correctNegatives": 99], "rain@5": ["hits": 0, "misses": 1, "falseAlarms": 0, "correctNegatives": 99],
            "fire@3": ["hits": 1, "misses": 0, "falseAlarms": 0, "correctNegatives": 9], "fire@5": ["hits": 1, "misses": 0, "falseAlarms": 1, "correctNegatives": 8]]]
        let rows = Backtest.rows(doc)!
        XCTAssertEqual(rows.count, 6)
        XCTAssertEqual(rows[0].caught, 0.5)
        XCTAssertEqual(Backtest.pct(rows[2].rightWhenWarned), "Cannot be calculated")
        XCTAssertNil(Backtest.rows(["places": 0, "results": [:]]))
    }

    // MARK: parity with the site's own /accuracy page

    func loadData(_ name: String) -> JSONValue? {
        let u = Fixtures.repoRoot.appendingPathComponent("data").appendingPathComponent(name)
        guard let d = try? Data(contentsOf: u) else { return nil }
        return try? JSONValue.parse(d)
    }

    /// Compares every figure with the page rendered by
    /// ios/scripts/track-record-expected.js (PND_TRACK_EXPECTED). On Apple
    /// platforms the grading runs in JavaScriptCore; on Linux a JSON file of
    /// the engine's output can be supplied in PND_TRACK_GRADED.
    func testFiguresMatchTheSite() throws {
        let env = ProcessInfo.processInfo.environment
        guard let exp = env["PND_TRACK_EXPECTED"], let expData = try? Data(contentsOf: URL(fileURLWithPath: exp)) else {
            throw XCTSkip("PND_TRACK_EXPECTED not set")
        }
        let expected = try JSONValue.parse(expData)
        let now = expected["now"]!.jsNumber
        let i = TrackRecord.Inputs(outlookLedger: loadData("outlook-ledger.json"), verificationLedger: loadData("verification-ledger.json"),
                                   observed: loadData("observed-disasters.json"), scanLedger: loadData("scan-ledger.json"))
        let p = TrackRecord.prepare(i)
        XCTAssertTrue(p.canGrade)
        var graded: (verdicts: [JSONValue], assessments: [JSONValue])?
        if let out = env["PND_TRACK_INPUT_OUT"] {
            try GradingScripts.input(p, scanLedger: i.scanLedger, now: now).write(toFile: out, atomically: true, encoding: .utf8)
        }
        if let g = env["PND_TRACK_GRADED"], let s = try? String(contentsOfFile: g, encoding: .utf8) {
            graded = try GradingScripts.output(s)
        }
        #if canImport(JavaScriptCore)
        if graded == nil {
            let engine = try XCTUnwrap(JSGradingEngine(directory: Fixtures.repoRoot))
            graded = try engine.grade(p, scanLedger: i.scanLedger, now: now)
        }
        #endif
        guard let g = graded else { throw XCTSkip("no grading engine on this platform") }
        let r = TrackRecord.build(i, p, verdicts: g.verdicts, assessments: g.assessments, now: now)
        for (k, v) in expected["figures"]?.objectValue ?? [:] {
            XCTAssertEqual(r.figures[k], v.stringValue, k)
        }
    }
}
