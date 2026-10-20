import Foundation
#if canImport(JavaScriptCore)
import JavaScriptCore
#endif

/// Runs the website's own grading code (`verify` and `assessCoverage` from
/// `verification-model.js` and `observed-model.js`), so the Track record
/// figures match the site exactly (logic.md section 10.7, option 1).
public protocol GradingEngine: Sendable {
    func grade(_ p: TrackRecord.Prepared, scanLedger: JSONValue?, now: Double) throws -> (verdicts: [JSONValue], assessments: [JSONValue])
}

public enum GradingError: Error { case unavailable, scriptFailed(String) }

public enum GradingScripts {
    /// The site's files, loaded in this order. They are copied from the
    /// repository root into the app at build time so they never drift.
    public static let files = ["hazard-model.js", "observed-model.js", "verification-model.js", "verdicts.js"]

    /// The glue: the same calls `accuracy.html load()` makes.
    public static let driver = """
    function __pndGrade(input) {
      var d = JSON.parse(input);
      var VER = globalThis.PNDVerification, OBSM = globalThis.PNDObserved, H = globalThis.PNDHazards;
      var scan = d.scan || { scans: [] };
      var coverageFor = function (claim) { return VER.observedCoverageFor(scan, claim.hazards || claim.hazard, claim.geography); };
      var verdicts = d.preds.map(function (p) {
        return VER.verify(p, d.obs, { now: d.now, hazardFamilyOf: OBSM.familyOf, observedCoverage: coverageFor, supportingEvents: d.supporting });
      });
      var forecastableOf = function (e) {
        var HZ = H && H.HAZARDS; if (!HZ) return true;
        var h = HZ[e.hazardLabel] || HZ[e.type]; return h ? h.forecastable !== false : true;
      };
      var assessments = d.obs.map(function (e) {
        return VER.assessCoverage(e, d.preds, scan, { hazardFamilyOf: OBSM.familyOf, hazardForecastable: forecastableOf });
      });
      return JSON.stringify({ verdicts: verdicts, assessments: assessments });
    }
    """

    /// The engine's input as JSON.
    public static func input(_ p: TrackRecord.Prepared, scanLedger: JSONValue?, now: Double) -> String {
        let v: JSONValue = .object(["preds": .array(p.preds.map { .object($0.raw) }), "obs": .array(p.obsEvents),
                                    "supporting": .array(p.supporting), "scan": scanLedger ?? .object(["scans": .array([])]), "now": .number(now)])
        return String(decoding: v.data(), as: UTF8.self)
    }

    public static func output(_ s: String) throws -> (verdicts: [JSONValue], assessments: [JSONValue]) {
        guard let v = try? JSONValue.parse(Data(s.utf8)), let a = v["verdicts"]?.arrayValue, let b = v["assessments"]?.arrayValue else {
            throw GradingError.scriptFailed("unreadable output")
        }
        return (a, b)
    }
}

#if canImport(JavaScriptCore)
public final class JSGradingEngine: GradingEngine, @unchecked Sendable {
    let sources: [String]

    /// `sources` are the contents of `GradingScripts.files`, in order.
    public init(sources: [String]) { self.sources = sources }

    /// Loads the scripts from a directory (the app bundle, or the repo root in tests).
    public convenience init?(directory: URL) {
        var out: [String] = []
        for f in GradingScripts.files {
            guard let s = try? String(contentsOf: directory.appendingPathComponent(f), encoding: .utf8) else { return nil }
            out.append(s)
        }
        self.init(sources: out)
    }

    public func grade(_ p: TrackRecord.Prepared, scanLedger: JSONValue?, now: Double) throws -> (verdicts: [JSONValue], assessments: [JSONValue]) {
        guard let ctx = JSContext() else { throw GradingError.unavailable }
        var failure: String?
        ctx.exceptionHandler = { _, ex in failure = ex?.toString() }
        ctx.evaluateScript("var window = globalThis; var self = globalThis;")
        for s in sources { ctx.evaluateScript(s) }
        ctx.evaluateScript(GradingScripts.driver)
        if let f = failure { throw GradingError.scriptFailed(f) }
        let fn = ctx.objectForKeyedSubscript("__pndGrade")
        let result = fn?.call(withArguments: [GradingScripts.input(p, scanLedger: scanLedger, now: now)])
        if let f = failure { throw GradingError.scriptFailed(f) }
        guard let s = result?.toString() else { throw GradingError.scriptFailed("no result") }
        return try GradingScripts.output(s)
    }

    /// Runs any expression against the loaded scripts (parity tests).
    public func evaluate(_ js: String) throws -> String {
        guard let ctx = JSContext() else { throw GradingError.unavailable }
        var failure: String?
        ctx.exceptionHandler = { _, ex in failure = ex?.toString() }
        ctx.evaluateScript("var window = globalThis; var self = globalThis;")
        for s in sources { ctx.evaluateScript(s) }
        let r = ctx.evaluateScript(js)
        if let f = failure { throw GradingError.scriptFailed(f) }
        return r?.toString() ?? ""
    }
}
#endif
