import Foundation

/// `verdicts.js` (logic.md sections 10.1 to 10.3).
public enum Verdicts {
    public static let verdicts: [String: String] = [
        "VERIFIED": "VERIFIED", "PARTIAL_VERIFICATION": "PARTIAL", "PARTIAL": "PARTIAL",
        "FALSE_ALARM": "FALSE_ALARM", "MISS_FALSE_POSITIVE": "FALSE_ALARM",
        "MISSED_EVENT": "MISSED", "FALSE_NEGATIVE_UNPREDICTED_EVENT": "MISSED",
        "COVERAGE_FAILURE": "COVERAGE_FAILURE", "PENDING": "PENDING"
    ]

    public static let occurred: [String: String] = [
        "VERIFIED": "Yes", "PARTIAL": "Partly", "FALSE_ALARM": "No", "MISSED": "Yes, but we did not forecast it",
        "COVERAGE_FAILURE": "Yes, but we were not checking that place", "OPEN": "Too early to say",
        "AWAITING": "Not checked yet", "UNGRADEABLE": "We cannot tell", "NOT_A_PREDICTION": "Not counted",
        "UNKNOWN": "Unrecognised result"
    ]

    public static let labels: [String: String] = [
        "VERIFIED": "Correct", "PARTIAL": "Partly correct", "FALSE_ALARM": "Wrong (false alarm)", "MISSED": "Missed event",
        "COVERAGE_FAILURE": "Missed: not checking there", "OPEN": "Still running", "AWAITING": "Not checked yet",
        "UNGRADEABLE": "Cannot be checked", "NOT_A_PREDICTION": "No proof it was made in time", "UNKNOWN": "Unrecognised result"
    ]

    public static let css: [String: String] = [
        "VERIFIED": "verified", "PARTIAL": "partial", "FALSE_ALARM": "alarm", "MISSED": "missed",
        "COVERAGE_FAILURE": "coverage", "OPEN": "open", "AWAITING": "awaiting",
        "UNGRADEABLE": "ungradeable", "NOT_A_PREDICTION": "notprediction", "UNKNOWN": "unknown"
    ]

    public static let engineStates = ["HIT": "VERIFIED", "PARTIAL_HIT": "PARTIAL", "MISS_FALSE_POSITIVE": "FALSE_ALARM",
                               "INVALID_POST_EVENT": "NOT_A_PREDICTION"]

    public static func normalise(_ status: String?) -> String {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if s.isEmpty { return "" }
        return verdicts[s] ?? "UNKNOWN"
    }

    public static func normalise(_ v: JSONValue?) -> String {
        guard let v = v, !v.isNull else { return "" }
        return normalise(v.jsString)
    }

    public static func stateOf(_ r: Record, now: Double) -> String {
        let graded = normalise(r.first("status", "outcome"))
        if !graded.isEmpty && graded != "PENDING" { return graded }
        guard let end = r.ms("targetEnd") else { return "AWAITING" }
        return end > now ? "OPEN" : "AWAITING"
    }

    public static func engineState(_ v: JSONValue?) -> String? {
        let c = (v?["classification"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if c.isEmpty { return nil }
        if c == "PENDING" { return v?["ungradeableReason"]?.stringValue == "WINDOW_STILL_OPEN" ? "OPEN" : "UNGRADEABLE" }
        return engineStates[c] ?? "UNKNOWN"
    }

    public struct Rate: Equatable, Sendable {
        public let text: String
        public let hit: Int
        public let total: Int
        public let pct: Int?
    }

    public static func rate(_ hit: Int, _ total: Int) -> Rate {
        if total == 0 { return Rate(text: "Not enough checked forecasts", hit: hit, total: total, pct: nil) }
        let pct = Int(JS.round(Double(hit) / Double(total) * 100))
        return Rate(text: "\(pct)% (\(hit) of \(total))", hit: hit, total: total, pct: pct)
    }

    public struct Tally: Equatable, Sendable {
        public var total = 0, open = 0, awaiting = 0, verified = 0, partial = 0, falseAlarm = 0, missed = 0
        public var coverageFailure = 0, ungradeable = 0, notPrediction = 0, unknown = 0, matured = 0
        public var graded: Int { verified + partial + falseAlarm }
        public var precision: Rate { Verdicts.rate(verified + partial, graded) }
        public var recall: Rate { Verdicts.rate(verified + partial, verified + partial + missed + coverageFailure) }
    }

    public static func tally(_ records: [Record], now: Double) -> Tally {
        var t = Tally()
        for r in records {
            t.total += 1
            let s = r.truthy("_state") ? r.s("_state") : stateOf(r, now: now)
            if let end = r.ms("targetEnd"), end <= now { t.matured += 1 }
            switch s {
            case "OPEN": t.open += 1
            case "AWAITING": t.awaiting += 1
            case "VERIFIED": t.verified += 1
            case "PARTIAL": t.partial += 1
            case "FALSE_ALARM": t.falseAlarm += 1
            case "MISSED": t.missed += 1
            case "COVERAGE_FAILURE": t.coverageFailure += 1
            case "UNGRADEABLE": t.ungradeable += 1
            case "NOT_A_PREDICTION": t.notPrediction += 1
            default: t.unknown += 1
            }
        }
        return t
    }

    public static func windowKey(_ r: Record) -> String {
        func m(_ k: String) -> String { r.ms(k).map { JS.numberString($0) } ?? "" }
        return r.s("id") + "@" + m("targetStart") + ".." + m("targetEnd")
    }

    public static let claimFields = ["id", "type", "title", "country", "admin1", "region", "lat", "lon", "alert", "severity",
        "severityRank", "issuedAt", "sourceIssuedAt", "targetStart", "targetEnd", "forecastKind", "forecastClass",
        "classificationReason", "effectiveForecastStart", "freezeTimestamp", "freezeBasis", "forecastOf", "source",
        "sourceUrl", "confidence", "evidence", "verificationRule"]

    /// `joinVerdicts(ledgerRows, verifications)`.
    public static func joinVerdicts(_ rows: [Record], _ verifications: [Record]) -> (records: [Record], unattached: [Record]) {
        var windows = Set<String>()
        var countsById: [String: Int] = [:]
        for r in rows {
            windows.insert(windowKey(r))
            countsById[r.s("id"), default: 0] += 1
        }
        var attached: [String: Record] = [:]
        var unattached: [Record] = []
        for v in verifications {
            let wk = windowKey(v)
            if windows.contains(wk) { attached[wk] = v; continue }
            if countsById[v.s("id")] == 1, let only = rows.first(where: { $0.s("id") == v.s("id") }) {
                attached[windowKey(only)] = v; continue
            }
            unattached.append(v)
        }
        let merged = rows.map { r -> Record in
            guard let v = attached[windowKey(r)] else { return r }
            var out = r.raw
            for (k, val) in v.raw { out[k] = val }
            for f in claimFields {
                if let val = r.raw[f] { out[f] = val } else { out.removeValue(forKey: f) }
            }
            return Record(out)
        }
        return (merged, unattached)
    }

    public static func forecastClassOf(_ r: Record) -> String? {
        if r.truthy("forecastClass") { return r.s("forecastClass") }
        var raw = r.raw
        raw["forecast"] = .bool(true)
        for (k, v) in r.raw { raw[k] = v }
        return Hazards.classifyForecast(Record(raw))?.forecastClass
    }

    public static func isForecastRow(_ r: Record) -> Bool {
        r.truthy("targetStart") || r.truthy("targetEnd") || r.truthy("forecastKind") || r.truthy("forecastClass")
    }

    public struct Partition: Sendable {
        public var headline: [Record] = []
        public var conditional: [Record] = []
        public var unclassified: [Record] = []
        public var byClass: [String: [Record]] = [:]
    }

    public static func partitionByClass(_ records: [Record]) -> Partition {
        var out = Partition()
        for r in records {
            let isF = isForecastRow(r)
            let k = isF ? forecastClassOf(r) : nil
            if let k = k { out.byClass[k, default: []].append(r) }
            if !isF { out.headline.append(r); out.conditional.append(r); continue }
            if k == nil { out.unclassified.append(r) }
            else if Hazards.forecastClasses[k!]?.headline == true { out.headline.append(r) }
            else { out.conditional.append(r) }
        }
        return out
    }
}

/// `verification-model.js score`, `predictingSince` and `inRecallPeriod`
/// (logic.md section 10.5). `verify` and `assessCoverage` themselves run as
/// the website's own JavaScript (see `JSGradingEngine`).
public enum Verification {
    public static let coverageKeys = ["COVERAGE_FAILURE", "FORECAST_FAILURE", "DATA_UNAVAILABLE", "NOT_FORECASTABLE", "NO_PROSPECTIVE_INPUT"]

    public struct Score: Equatable, Sendable {
        public var hit = 0, partial = 0, miss = 0, pending = 0, invalid = 0, hitsOutsideCoverage = 0, ungradeable = 0
        public var ungradeableBy: [String: Int] = [:]
        public var ungradeableOrder: [String] = []
        public var eligibleMaturedPredictions = 0, significantObservedEvents = 0, predictedEvents = 0, partlyPredictedEvents = 0, falseNegatives = 0
        public var coverage: [String: Int] = Dictionary(uniqueKeysWithValues: Verification.coverageKeys.map { ($0, 0) })
        public var precision: Double? = nil, recall: Double? = nil, f1: Double? = nil
        public static let methodology = [
            "precision": "Precision = (correct + 0.5 \u{00D7} partly correct) \u{00F7} forecasts checked.",
            "recall": "Recall = (disasters fully forecast + 0.5 \u{00D7} disasters partly forecast) \u{00F7} significant disasters that started on or after our first advance forecast.",
            "f1": "F1 = 2 \u{00D7} precision \u{00D7} recall \u{00F7} (precision + recall). It combines the two into one score. It is not a measure of accuracy.",
            "partialHitWeight": "A partly correct forecast counts as 0.5. It was right about the hazard and the period but wrong about part of the place, so it counts as half."
        ]
        public static let version = "verify-1.3.1"
    }

    public static func score(_ verifications: [JSONValue], _ assessments: [JSONValue]) -> Score {
        var s = Score()
        for v in verifications {
            let reason = v["ungradeableReason"]?.isTruthy == true ? v["ungradeableReason"]!.jsString : ""
            if v["gradeable"] == .bool(false) && !reason.isEmpty && reason != "WINDOW_STILL_OPEN" {
                s.ungradeable += 1
                if s.ungradeableBy[reason] == nil { s.ungradeableOrder.append(reason) }
                s.ungradeableBy[reason, default: 0] += 1
            }
            let symmetric = v["absenceEstablishable"] != .bool(false)
            switch v["classification"]?.stringValue ?? "" {
            case "HIT": if symmetric { s.hit += 1 } else { s.hitsOutsideCoverage += 1 }
            case "PARTIAL_HIT": if symmetric { s.partial += 1 } else { s.hitsOutsideCoverage += 1 }
            case "MISS_FALSE_POSITIVE": s.miss += 1
            case "PENDING": s.pending += 1
            case "INVALID_POST_EVENT": s.invalid += 1
            default: break
            }
        }
        s.eligibleMaturedPredictions = s.hit + s.partial + s.miss
        s.significantObservedEvents = assessments.count
        for a in assessments {
            if a["falseNegative"]?.isTruthy != true {
                let matched = a["matched"]?.arrayValue ?? []
                if matched.contains(where: { $0["result"]?.stringValue == "HIT" }) { s.predictedEvents += 1 } else { s.partlyPredictedEvents += 1 }
            } else {
                s.falseNegatives += 1
                let st = a["status"]?.jsString ?? ""
                s.coverage[st, default: 0] += 1
            }
        }
        if s.eligibleMaturedPredictions > 0 {
            s.precision = (Double(s.hit) + 0.5 * Double(s.partial)) / Double(s.eligibleMaturedPredictions)
        }
        if !assessments.isEmpty {
            s.recall = (Double(s.predictedEvents) + 0.5 * Double(s.partlyPredictedEvents)) / Double(assessments.count)
        }
        if let p = s.precision, let r = s.recall, p + r > 0 { s.f1 = 2 * p * r / (p + r) }
        return s
    }

    public static func predictingSince(_ preds: [Record]) -> Double? {
        let ts = preds.filter { $0.s("forecastClass") == "independent-prospective" }
            .compactMap { JSDate.ms($0.first("freezeTimestamp", "recordedAt")?.jsString) }
        return ts.min()
    }

    public static func inRecallPeriod(_ e: JSONValue, since: Double?) -> Bool {
        guard let since = since, let onset = JSDate.ms(e["onset"]?.isTruthy == true ? e["onset"]!.jsString : nil) else { return false }
        return onset >= since
    }
}

/// `backtest-view.js` (logic.md section 10.8).
public enum Backtest {
    public struct Row: Equatable, Sendable {
        public let hazard: String, label: String, threshold: String
        public let lead: Int, days: Int, happened: Int, warned: Int, hits: Int
        public let caught: Double?, caughtByChance: Double, rightWhenWarned: Double?, rightByChance: Double
    }

    public static let hazards: [(String, String, String)] = [
        ("heat", "Extreme heat", "a daily high at or above the place\u{2019}s 95th percentile for the date"),
        ("rain", "Heavy rain", "rain at or above the place\u{2019}s 99th percentile for the month, and at least 10 mm"),
        ("fire", "Wildfire weather", "a Fire Weather Index in the \u{201C}very high\u{201D} class and at or above the place\u{2019}s 95th percentile")
    ]

    public static func rows(_ doc: JSONValue?) -> [Row]? {
        guard let doc = doc, let results = doc["results"], results.objectValue != nil else { return nil }
        guard let places = doc["places"]?.numberValue, places > 0 else { return nil }
        func count(_ v: JSONValue?) -> Int? {
            guard let d = v?.numberValue, d.isFinite, d >= 0 else { return nil }
            return Int(d)
        }
        var out: [Row] = []
        for (hazard, label, threshold) in hazards {
            for lead in [3, 5] {
                guard let t = results[hazard + "@\(lead)"], t.isTruthy else { return nil }
                guard let h = count(t["hits"]), let m = count(t["misses"]), let f = count(t["falseAlarms"]), let c = count(t["correctNegatives"]) else { return nil }
                let days = h + m + f + c
                if days == 0 { return nil }
                out.append(Row(hazard: hazard, label: label, threshold: threshold, lead: lead, days: days, happened: h + m, warned: h + f, hits: h,
                               caught: h + m > 0 ? Double(h) / Double(h + m) : nil, caughtByChance: Double(h + f) / Double(days),
                               rightWhenWarned: h + f > 0 ? Double(h) / Double(h + f) : nil, rightByChance: Double(h + m) / Double(days)))
            }
        }
        return out
    }

    public static func pct(_ v: Double?) -> String {
        guard let v = v else { return "Cannot be calculated" }
        return JS.numberString(JS.round(v * 100)) + "%"
    }
}
