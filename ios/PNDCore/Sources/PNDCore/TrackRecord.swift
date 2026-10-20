import Foundation

/// The Track record screen, ported from the inline `load()` of `accuracy.html`
/// (logic.md section 10.4). `verify()` and `assessCoverage()` come from the
/// website's own JavaScript (`JSGradingEngine`); everything else is here.
public enum TrackRecord {
    public struct Inputs: Sendable {
        public var outlookLedger: JSONValue?      // nil = could not be read
        public var verificationLedger: JSONValue?
        public var observed: JSONValue?
        public var scanLedger: JSONValue?
        public init(outlookLedger: JSONValue?, verificationLedger: JSONValue?, observed: JSONValue?, scanLedger: JSONValue?) {
            self.outlookLedger = outlookLedger; self.verificationLedger = verificationLedger
            self.observed = observed; self.scanLedger = scanLedger
        }
    }

    /// What the engine needs: the classified predictions and the disasters.
    public struct Prepared: Sendable {
        public let rows: [Record]
        public let preds: [Record]
        public let obsEvents: [JSONValue]
        public let supporting: [JSONValue]
        public let unavailable: [String]
        public var canGrade: Bool { unavailable.isEmpty }
    }

    public static func prepare(_ i: Inputs) -> Prepared {
        let un = [i.outlookLedger == nil ? "our record of forecasts" : nil,
                  i.verificationLedger == nil ? "our record of hand-checked results" : nil,
                  i.observed == nil ? "our record of disasters" : nil,
                  i.scanLedger == nil ? "our record of which places we checked" : nil].compactMap { $0 }
        let rows = (i.outlookLedger?.arrayValue ?? []).compactMap { Record(json: $0) }
        let preds = rows.map { r -> Record in
            var raw = r.raw
            raw["forecastClass"] = Verdicts.forecastClassOf(r).map { .string($0) } ?? .null
            return Record(raw)
        }
        let obs = (i.observed?["events"]?.arrayValue ?? []).filter { !($0["supersededBy"]?.isTruthy ?? false) }
        return Prepared(rows: rows, preds: preds, obsEvents: obs, supporting: i.observed?["supporting"]?.arrayValue ?? [], unavailable: un)
    }

    public struct Metric: Sendable, Identifiable { public var id: String { label }; public let label: String; public let value: String }

    public struct LedgerRow: Sendable, Identifiable {
        public let id: String
        public let record: Record
        public let state: String
        public let title: String
        public let occurred: String
        public let result: String
        public let resultCSS: String
        public let notes: [String]
        public let kind: String
        public let severity: String?
        public let hazardPlace: (String, String)
        public let lockedOn: String
        public let period: String
        public let threshold: String
        public let matched: String
        public let evidence: String
        public let serious: Bool
    }

    public struct ObservedRow: Sendable, Identifiable {
        public var id: String { name + started }
        public let name, reason, type, place, started, deaths, displaced, evidence, verdict, why: String
        public let forecastInAdvance: Bool
    }

    public struct Report: Sendable {
        public var ledgerError: String? = nil
        public var answerLead = ""
        public var answerPoints: [String] = []
        public var keyFigures: [Metric] = []
        public var honesty = ""
        public var gradingAvailable = true
        public var rows: [LedgerRow] = []
        public var observedRows: [ObservedRow] = []
        public var observedEmpty = ""
        public var cameTrue: [LedgerRow] = []
        public var missed: [LedgerRow] = []
        public var cameTrueEmpty = "No forecast has come true yet."
        public var missedEmpty = "No significant missed events have been recorded by hand yet."
        public var listText: String? = nil
        public var comparisons: [LedgerRow] = []
        public var sample: [Metric] = []
        public var advance: [Metric] = []
        public var advanceNote = ""
        public var other: [Metric] = []
        public var otherNote = ""
        public var disasters: [Metric] = []
        public var disastersNote = ""
        public var methodNote = ""
        public var classBreak = ""
        /// Raw counts for tests and the macOS parity check.
        public var figures: [String: String] = [:]
        public var updatedTimes: [String] = []
    }

    static func pl(_ x: Int, _ one: String, _ many: String) -> String { "\(x) " + (x == 1 ? one : many) }
    static func listText(_ a: [String], _ conj: String) -> String {
        a.count < 2 ? a.joined() : a.dropLast().joined(separator: ", ") + " " + conj + " " + a.last!
    }
    static func sentence(_ v: String) -> String { v.isEmpty ? "" : v.prefix(1).uppercased() + v.dropFirst().lowercased() }

    static let isoRe = JSRegex(#"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})"#)
    static func niceDates(_ t: String, tz: String?) -> String { isoRe.replace(t) { g in Format.fmtDate(g[0] ?? "", tz: tz) } }

    static let whyNotText: [String: (String, String)] = [
        "ABSENCE_NOT_ESTABLISHABLE": (" is for a hazard and place that none of our sources fully covers, so a lack of reports there proves nothing", " are for a hazard and place that none of our sources fully covers, so a lack of reports there proves nothing"),
        "OBSERVED_RECORD_EMPTY": (" had no check of our sources on record to compare with", " had no check of our sources on record to compare with"),
        "OBSERVED_RECORD_STARTS_LATER": (" started before we first checked its hazard and place", " started before we first checked their hazard and place"),
        "OBSERVED_RECORD_NOT_YET_UPDATED": (" ended after our latest check of its hazard and place", " ended after our latest check of their hazard and place"),
        "OBSERVED_RECORD_HAS_A_GAP": (" fell in a gap of more than 6 hours between our checks", " fell in a gap of more than 6 hours between our checks"),
        "SEQUENCE_ATTRIBUTION_AMBIGUOUS": (" matched activity that fits a forecast about a different disaster just as well", " matched activity that fits a forecast about a different disaster just as well"),
        "CONTINUATION_EVIDENCE_UNAVAILABLE": (" followed a disaster with no report dated inside the forecast period", " followed disasters with no report dated inside the forecast period")
    ]

    static func whyNot(_ s: Verification.Score) -> String {
        let keys = Sorts.stableSort(s.ungradeableOrder) { a, b in Double((s.ungradeableBy[b] ?? 0) - (s.ungradeableBy[a] ?? 0)) }
        return keys.map { k in
            let n = s.ungradeableBy[k] ?? 0
            return "\(n)" + (whyNotText[k].map { n == 1 ? $0.0 : $0.1 } ?? " cannot be checked (\(k))")
        }.joined(separator: "; ")
    }

    static let forecastInAdvance = ["NOT_FORECASTABLE": "No: cannot be forecast", "DATA_UNAVAILABLE": "No: reason unknown",
                                    "COVERAGE_FAILURE": "No: not checking there", "FORECAST_FAILURE": "No: missed by our forecasts",
                                    "NO_PROSPECTIVE_INPUT": "No: no advance source"]
    static let covered = ["SCANNED": "Yes", "UNVERIFIABLE_NO_SCAN_LEDGER": "We cannot tell: no record of checks"]

    static func pct(_ x: Double?, _ n: String, _ unit: String) -> String {
        guard let x = x else { return "Cannot be calculated" }
        return JS.numberString(JS.round(x * 1000) / 10) + "% (" + n + " " + unit + ")"
    }

    /// Builds the screen. `verdicts` align with `prepared.preds`, `assessments`
    /// with `prepared.obsEvents`; pass nil when the engine could not run.
    public static func build(_ i: Inputs, _ p: Prepared, verdicts: [JSONValue]?, assessments: [JSONValue]?, now: Double, tz: String? = nil) -> Report {
        var r = Report()
        let l = p.rows
        let outlookRead = i.outlookLedger?.arrayValue != nil
        var times = [i.verificationLedger, i.observed, i.scanLedger].compactMap { $0?["updatedAt"]?.stringValue }
        times += l.compactMap { $0.opt("recordedAt") }
        let tms = times.compactMap { JSDate.ms($0) }
        r.updatedTimes = tms.max().map { [JSDate.iso($0)] } ?? []
        let recordUpdated = tms.max().map { Format.fmtDate(ms: $0, tz: tz) } ?? "Unavailable"
        let verifications = (i.verificationLedger?["verifications"]?.arrayValue ?? []).compactMap { Record(json: $0) }
        let joined = Verdicts.joinVerdicts(l, verifications)
        let engineOK = verdicts != nil && assessments != nil
        var unavailable = p.unavailable
        if p.canGrade && !engineOK { unavailable.append("our automatic checker, which could not run on this device") }
        let canGrade = unavailable.isEmpty
        let vds = canGrade ? (verdicts ?? []) : []
        var byKey: [String: JSONValue] = [:]
        for (k, v) in zip(p.preds, vds) { byKey[Hazards.claimKey(k)] = v }
        let observed = (i.verificationLedger?["observedEvents"]?.arrayValue ?? []).compactMap { Record(json: $0) }.map { x -> Record in
            x.truthy("status") ? x : x.with(["status": .string("MISSED_EVENT")])
        }
        let decidedSet: Set<String> = ["VERIFIED", "PARTIAL", "FALSE_ALARM", "NOT_A_PREDICTION"]
        let ledgerGradedSet: Set<String> = ["VERIFIED", "PARTIAL", "FALSE_ALARM", "MISSED", "COVERAGE_FAILURE"]
        var recs: [(Record, String, String?, Bool, JSONValue?)] = (joined.records + observed).map { rr in
            let led = Verdicts.stateOf(rr, now: now)
            let v = byKey[Hazards.claimKey(rr)]
            let eng = Verdicts.engineState(v)
            let decided = eng.map { decidedSet.contains($0) } ?? false
            let ledGraded = ledgerGradedSet.contains(led)
            let state = decided ? eng! : (ledGraded ? led : (eng ?? led))
            let ledgerState = (decided && eng != led && ledGraded) ? led : nil
            let unrep = !decided && ledGraded && eng == "UNGRADEABLE"
            return (rr.with(["_state": .string(state)]), state, ledgerState, unrep, v)
        }
        recs = Sorts.stableSort(recs) { a, b in
            Sorts.sub(JSDate.ms(b.0.first("recordedAt", "observedAt")?.jsString) ?? .nan, JSDate.ms(a.0.first("recordedAt", "observedAt")?.jsString) ?? .nan)
        }
        let distinct = Set(l.map { $0.s("id") }).count
        let recordedText = pl(l.count, "forecast has", "forecasts have") + " been recorded. We record a forecast again each time we update it, so " +
            (l.count == 1 ? "it comes" : "these come") + " from " + pl(distinct, "different forecast", "different forecasts") + ". "
        r.gradingAvailable = canGrade
        r.rows = recs.map { row(rec: $0.0, state: $0.1, ledgerState: $0.2, unrep: $0.3, v: $0.4, graded: canGrade, tz: tz) }

        let keyLabels = ["Forecasts recorded", "Still running", "Ended, not checked yet", "Ended, cannot be checked", "Checked so far",
                         "Correct", "Partly correct", "Wrong (false alarm)", "Missed events", "No proof made in time"]

        if !canGrade {
            r.ledgerError = "Some track record data could not be loaded: " + listText(unavailable, "and") +
                ". So no figure on this page tells you what happened. This is not the same as nothing having been recorded."
            let un = "Unavailable"
            r.keyFigures = zip(keyLabels, [outlookRead ? "\(l.count)" : un] + Array(repeating: un, count: 9)).map { Metric(label: $0.0, value: $0.1) }
            let os = l.compactMap { $0.ms("targetStart") }, oe = l.compactMap { $0.ms("targetEnd") }
            let period = !outlookRead ? un : (!os.isEmpty && !oe.isEmpty
                ? "From " + Format.fmtDate(ms: os.min()!, tz: tz) + " to " + Format.fmtDate(ms: oe.max()!, tz: tz) : "No forecasts recorded")
            r.sample = [Metric(label: "Forecasts recorded", value: outlookRead ? pl(l.count, "forecast", "forecasts") : un),
                        Metric(label: "Forecast periods covered", value: period), Metric(label: "First advance forecast", value: un),
                        Metric(label: "Last updated", value: recordUpdated)]
            let cannot = "We could not load " + listText(unavailable, "or") + ". So nothing here has been checked, and no figure below tells you what happened. Reload the page or try again later."
            r.honesty = (outlookRead ? recordedText : "") + cannot
            r.advanceNote = cannot; r.otherNote = cannot; r.disastersNote = cannot
            r.answerLead = "The track record could not be loaded."
            r.answerPoints = [cannot]
            r.methodNote = "Nothing was checked. " + cannot
            r.observedEmpty = cannot
            r.listText = cannot
            r.advance = ["Advance forecasts", "Checked", "Correct", "Partly correct", "Wrong (false alarm)", "Still running or cannot be checked",
                         "No proof made in time", "Precision: how often right", "Recall: share of disasters forecast", "F1 score: the two combined"].map { Metric(label: $0, value: un) }
            r.other = ["Other forecasts", "Checked", "Correct", "Partly correct", "Wrong (false alarm)", "Still running or cannot be checked",
                       "Precision: how often right"].map { Metric(label: $0, value: un) }
            r.disasters = ["Significant disasters", "Not forecast in advance", "Missed: not checking there", "Missed by our forecasts",
                           "Reason unknown", "Cannot be forecast", "No advance source"].map { Metric(label: $0, value: un) }
            r.figures = Dictionary(uniqueKeysWithValues: zip(["mTotal", "mOpen", "mAwaiting", "mUngradeable", "mGraded", "mVerified", "mPartial", "mFalse", "mMissed", "mNotPrediction"], r.keyFigures.map { $0.value }))
            return r
        }

        let records = recs.map { $0.0 }
        let t = Verdicts.tally(records, now: now)
        r.keyFigures = zip(keyLabels, [l.count, t.open, t.awaiting, t.ungradeable, t.graded, t.verified, t.partial, t.falseAlarm, t.missed, t.notPrediction])
            .map { Metric(label: $0.0, value: "\($0.1)") }
        let disagree = recs.filter { $0.2 != nil }.count
        let unrep = recs.filter { $0.3 }.count
        var h = recordedText + pl(t.graded, "of them has", "of them have") + " been checked. " + pl(t.graded - unrep, "was", "were") + " checked automatically"
        h += unrep > 0 ? ", and " + pl(unrep, "was checked by hand", "were checked by hand") + ". Our automatic checker cannot repeat the hand checks from our own record of disasters, so they are not used in any rate on this page" : ""
        h += ". "
        if t.ungradeable > 0 { h += pl(t.ungradeable, "forecast has", "forecasts have") + " ended but cannot be checked either way. Our record of disasters does not fully cover the hazard, place and time " + (t.ungradeable == 1 ? "it names" : "they name") + ". So a lack of reports there does not show that nothing happened. " }
        if t.notPrediction > 0 { h += pl(t.notPrediction, "forecast does", "forecasts do") + " not count as made in advance at all, because nothing shows " + (t.notPrediction == 1 ? "it was" : "they were") + " made before the period " + (t.notPrediction == 1 ? "it covers" : "they cover") + ". " }
        if t.awaiting > 0 { h += pl(t.awaiting, "forecast", "forecasts") + " ended without being checked, so " + (t.awaiting == 1 ? "it counts" : "they count") + " neither for nor against us. " }
        h += "Every rate on this page shows how many forecasts it is based on. None of them is based on enough forecasts to be a real track record yet. The rates are under \u{201C}Full details\u{201D} below, where advance forecasts and other forecasts are kept apart."
        if disagree > 0 { h += " " + pl(disagree, "forecast got", "forecasts got") + " a different result when checked by hand. We show and count the automatic result, and show the hand result beside it." }
        if !joined.unattached.isEmpty { h += " " + pl(joined.unattached.count, "hand-checked result", "hand-checked results") + " could not be matched to a recorded forecast, so " + (joined.unattached.count == 1 ? "it is" : "they are") + " not counted." }
        if t.unknown > 0 { h += " " + pl(t.unknown, "forecast has", "forecasts have") + " a result this page does not recognise. " + (t.unknown == 1 ? "It is" : "They are") + " counted as not checked." }
        r.honesty = h

        let headlineIdx = p.preds.indices.filter { p.preds[$0].s("forecastClass") == "independent-prospective" }
        let condIdx = p.preds.indices.filter { let c = p.preds[$0].s("forecastClass"); return !c.isEmpty && c != "independent-prospective" && c != "invalid-post-event" }
        let asm = assessments ?? []
        let sH = Verification.score(headlineIdx.map { vds[$0] }, asm)
        let since = Verification.predictingSince(p.preds)
        let recallIdx = p.obsEvents.indices.filter { Verification.inRecallPeriod(p.obsEvents[$0], since: since) }
        let sR = Verification.score(headlineIdx.map { vds[$0] }, recallIdx.map { asm[$0] })
        let outsideRecall = p.obsEvents.count - recallIdx.count
        let sC = Verification.score(condIdx.map { vds[$0] }, [])

        let onsets = l.compactMap { $0.ms("targetStart") }
        let endsMax = l.compactMap { $0.ms("targetEnd") }.max()
        let period = onsets.isEmpty ? "No forecasts recorded"
            : "From " + Format.fmtWhen(JSDate.iso(onsets.min()!), nil, nil, tz: tz) + " to " + Format.fmtWhen(endsMax.map { JSDate.iso($0) } ?? "", nil, "end", tz: tz)
        let firstP = headlineIdx.compactMap { JSDate.ms(p.preds[$0].first("freezeTimestamp", "recordedAt")?.jsString) }
        r.sample = [Metric(label: "Forecasts recorded", value: pl(l.count, "forecast", "forecasts")), Metric(label: "Forecast periods covered", value: period),
                    Metric(label: "First advance forecast", value: firstP.min().map { Format.fmtDate(ms: $0, tz: tz) } ?? "None yet"),
                    Metric(label: "Last updated", value: recordUpdated)]
        let invalid = vds.filter { $0["classification"]?.stringValue == "INVALID_POST_EVENT" }.count
        r.advance = [Metric(label: "Advance forecasts", value: "\(headlineIdx.count)"), Metric(label: "Checked", value: "\(sH.eligibleMaturedPredictions)"),
                     Metric(label: "Correct", value: "\(sH.hit)"), Metric(label: "Partly correct", value: "\(sH.partial)"),
                     Metric(label: "Wrong (false alarm)", value: "\(sH.miss)"), Metric(label: "Still running or cannot be checked", value: "\(sH.pending)"),
                     Metric(label: "No proof made in time", value: "\(invalid)"),
                     Metric(label: "Precision: how often right", value: pct(sH.precision, "\(sH.eligibleMaturedPredictions)", "checked")),
                     Metric(label: "Recall: share of disasters forecast", value: pct(sR.recall, "\(sR.significantObservedEvents)", "disasters")),
                     Metric(label: "F1 score: the two combined", value: pct(sR.f1, "\(sR.eligibleMaturedPredictions) checked, \(sR.significantObservedEvents)", "disasters"))]

        func otherNote(_ s: Verification.Score) -> String { s.ungradeable > 0 ? " Of " + pl(s.ungradeable, "other ended forecast", "other ended forecasts") + ": " + whyNot(s) + "." : "" }
        func outsideNote(_ s: Verification.Score) -> String {
            let n = s.hitsOutsideCoverage
            return n > 0 ? " " + pl(n, "forecast came", "forecasts came") + " true but " + (n == 1 ? "is" : "are") + " left out of this rate. For " + (n == 1 ? "its" : "their") +
                " hazard and place, we could never have found out if " + (n == 1 ? "it" : "they") + " had been wrong. Including them would count the successes but not the failures." : ""
        }
        var recallNote = ""
        if outsideRecall > 0 {
            let one = outsideRecall == 1
            recallNote = " " + pl(outsideRecall, "disaster on record", "disasters on record") + " " + (since == nil
                ? (one ? "is" : "are") + " listed as not forecast in the table of significant disasters. " + (one ? "It is" : "They are") + " not used for recall (the share of real disasters we forecast in advance), because we were not making advance forecasts when " + (one ? "it" : "they") + " happened."
                : "happened before our first advance forecast was recorded (" + Format.fmtDate(ms: since!, tz: tz) + "), or " + (one ? "has" : "have") + " no recorded start time. " + (one ? "It is" : "They are") + " listed as not forecast in the table of significant disasters, and " + (one ? "is" : "are") + " not used for recall (the share of real disasters we forecast in advance).")
        }
        r.advanceNote = (headlineIdx.isEmpty
            ? "We have never recorded a disaster forecast made in advance. So we have no hit rate for advance disaster forecasts, and we do not show one. Every disaster forecast here was about a danger already reported, followed an event that had already happened, or was a test case written after its period began. The experimental weather models do forecast in advance; they are graded separately, under \"Experimental forecast models\" below."
            : (sH.eligibleMaturedPredictions == 0
                ? "None of our advance forecasts can be checked yet. Of " + pl(sH.ungradeable, "ended forecast", "ended forecasts") + ": " + whyNot(sH) + "." + outsideNote(sH)
                : "Based on " + pl(sH.eligibleMaturedPredictions, "checked advance forecast", "checked advance forecasts") + ". With so few, one result can change the rate a lot." + otherNote(sH) + outsideNote(sH))) + recallNote

        r.other = [Metric(label: "Other forecasts", value: "\(condIdx.count)"), Metric(label: "Checked", value: "\(sC.eligibleMaturedPredictions)"),
                   Metric(label: "Correct", value: "\(sC.hit)"), Metric(label: "Partly correct", value: "\(sC.partial)"),
                   Metric(label: "Wrong (false alarm)", value: "\(sC.miss)"), Metric(label: "Still running or cannot be checked", value: "\(sC.pending)"),
                   Metric(label: "Precision: how often right", value: pct(sC.precision, "\(sC.eligibleMaturedPredictions)", "checked"))]
        let anyScan = !(i.scanLedger?["scans"]?.arrayValue ?? []).isEmpty
        r.otherNote = sC.eligibleMaturedPredictions == 0
            ? "None of these can be checked yet. Of " + pl(sC.ungradeable, "ended forecast", "ended forecasts") + ": " + whyNot(sC) + ". " +
                (anyScan ? "We track the places we check separately for each hazard. A check made while the sources for that hazard were down does not count." : "We have not recorded any check of our sources yet, so there is nothing to compare these forecasts with.") + outsideNote(sC)
            : "Based on " + pl(sC.eligibleMaturedPredictions, "checked forecast", "checked forecasts") + ". This is not a rate for advance forecasts." + otherNote(sC) + outsideNote(sC)

        let c = sH.coverage
        r.disasters = [Metric(label: "Significant disasters", value: "\(p.obsEvents.count)"), Metric(label: "Not forecast in advance", value: "\(sH.falseNegatives)"),
                       Metric(label: "Missed: not checking there", value: "\(c["COVERAGE_FAILURE"] ?? 0)"), Metric(label: "Missed by our forecasts", value: "\(c["FORECAST_FAILURE"] ?? 0)"),
                       Metric(label: "Reason unknown", value: "\(c["DATA_UNAVAILABLE"] ?? 0)"), Metric(label: "Cannot be forecast", value: "\(c["NOT_FORECASTABLE"] ?? 0)"),
                       Metric(label: "No advance source", value: "\(c["NO_PROSPECTIVE_INPUT"] ?? 0)")]
        r.disastersNote = p.obsEvents.isEmpty
            ? "No significant disaster has been recorded yet. Our hourly update adds them from our live sources. Until it has run, recall cannot be worked out, so it is not shown. An empty record is not a claim that nothing happened."
            : "A disaster counts as \u{201C}not forecast in advance\u{201D} when no forecast made in advance covered it. If we have no record of checking that hazard and place at the time, we cannot tell why it was missed. We say so, rather than blame our checks or our forecasts."

        // The answer box.
        r.answerLead = headlineIdx.isEmpty
            ? "We do not have a track record of advance forecasts yet. Every forecast we have recorded was made after the danger was already known."
            : (sH.eligibleMaturedPredictions == 0 ? "We have made some forecasts in advance, but none of them can be checked yet."
               : "Of the " + pl(sH.eligibleMaturedPredictions, "advance forecast", "advance forecasts") + " we could check, " + JS.numberString(JS.round((sH.precision ?? 0) * 1000) / 10) + "% came true. A partly correct forecast counts as half.")
        var pts: [String] = []
        pts.append(pl(l.count, "forecast has", "forecasts have") + " been recorded. We record a forecast again each time we update it, so " + (l.count == 1 ? "it comes" : "these come") + " from " + pl(distinct, "different forecast", "different forecasts") + "." +
            (headlineIdx.isEmpty ? "" : " " + pl(headlineIdx.count, "was", "were") + " made in advance. We count the rest separately."))
        pts.append(pl(t.graded, "forecast has", "forecasts have") + " been checked: \(t.verified) correct, \(t.partial) partly correct and \(t.falseAlarm) wrong." +
            (unrep > 0 ? " \(unrep) of these " + (unrep == 1 ? "was" : "were") + " checked by hand." : "") +
            (t.ungradeable > 0 ? " Another " + pl(t.ungradeable, "has", "have") + " ended but cannot be checked either way. No record of events covers that place and time well enough." : ""))
        var why: [String] = []
        func was(_ x: Int) -> String { x == 1 ? "was" : "were" }
        if let n = c["NOT_FORECASTABLE"], n > 0 { why.append("\(n) \(was(n)) of a kind nobody can forecast.") }
        if let n = c["DATA_UNAVAILABLE"], n > 0 { why.append("For \(n), we cannot tell whether we were checking that place at the time.") }
        if let n = c["NO_PROSPECTIVE_INPUT"], n > 0 { why.append("\(n) could not have been foreseen from any source we read.") }
        if let n = c["COVERAGE_FAILURE"], n > 0 { why.append("\(n) \(was(n)) missed because we were not checking that place.") }
        if let n = c["FORECAST_FAILURE"], n > 0 { why.append("\(n) \(was(n)) missed by our forecasts.") }
        let predicted = p.obsEvents.count - sH.falseNegatives
        pts.append(p.obsEvents.isEmpty ? "No significant disaster has been recorded yet. This does not mean nothing happened."
            : pl(p.obsEvents.count, "significant disaster has", "significant disasters have") + " been recorded. " +
              (predicted > 0 ? "We forecast \(predicted) of them in advance." : "We forecast none of them in advance.") + (why.isEmpty ? "" : " " + why.joined(separator: " ")))
        if t.missed > 0 { pts.append(pl(t.missed, "more missed event was", "more missed events were") + " recorded by hand.") }
        r.answerPoints = pts
        let m = Verification.Score.methodology
        r.methodNote = [m["precision"]!, m["recall"]!, m["f1"]!, m["partialHitWeight"]!].joined(separator: " ") + " Checker version: " + Verification.Score.version + "."
        let parts = Verdicts.partitionByClass(records)
        let classCounts = parts.byClass.keys.sorted().map { k in (Hazards.forecastClasses[k]?.label ?? k) + ": \(parts.byClass[k]!.count)" }
        r.classBreak = "Forecasts recorded, by type. " + (classCounts.isEmpty ? "None recorded" : classCounts.joined(separator: " \u{00B7} ")) + "." +
            (parts.unclassified.isEmpty ? "" : " " + pl(parts.unclassified.count, "forecast", "forecasts") + " could not be given a type, so " + (parts.unclassified.count == 1 ? "it is" : "they are") + " not used in any rate.")

        r.observedRows = p.obsEvents.enumerated().map { (idx, e) in
            let a = idx < asm.count ? asm[idx] : .object([:])
            let fn = a["falseNegative"]?.isTruthy ?? false
            let g = e["geography"] ?? .object([:])
            func s(_ v: JSONValue?) -> String { (v?.isTruthy ?? false) ? v!.jsString : "" }
            func fig(_ v: JSONValue?) -> String { (v == nil || v!.isNull) ? "Not reported" : v!.jsString }
            let place = [s(g["region"]), s(g["country"])].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
            return ObservedRow(name: s(e["canonicalEventId"]), reason: s(e["significanceReason"]),
                               type: [s(e["hazardLabel"]), s(e["hazard"])].first { !$0.isEmpty } ?? "-",
                               place: place.isEmpty ? "-" : place, started: s(e["onset"]).isEmpty ? "-" : Format.fmtDate(s(e["onset"]), tz: tz),
                               deaths: fig(e["deaths"]), displaced: fig(e["displaced"]),
                               evidence: s(e["evidenceConfidence"]).isEmpty ? "-" : sentence(s(e["evidenceConfidence"])),
                               verdict: fn ? (forecastInAdvance[s(a["status"])] ?? "No") : "Yes", why: niceDates(s(a["reason"]), tz: tz), forecastInAdvance: !fn)
        }
        r.observedEmpty = "No significant disaster has been recorded yet. Our hourly update adds them from our live sources. An empty record is not a claim that nothing happened."
        r.cameTrue = r.rows.filter { ["VERIFIED", "PARTIAL"].contains($0.state) }
        r.missed = r.rows.filter { ["MISSED", "COVERAGE_FAILURE"].contains($0.state) }
        r.comparisons = r.rows.filter { ["VERIFIED", "PARTIAL", "FALSE_ALARM"].contains($0.state) }
        r.figures = [
            "mTotal": "\(l.count)", "mOpen": "\(t.open)", "mAwaiting": "\(t.awaiting)", "mUngradeable": "\(t.ungradeable)", "mGraded": "\(t.graded)",
            "mVerified": "\(t.verified)", "mPartial": "\(t.partial)", "mFalse": "\(t.falseAlarm)", "mMissed": "\(t.missed)", "mNotPrediction": "\(t.notPrediction)",
            "ipTotal": "\(headlineIdx.count)", "ipMatured": "\(sH.eligibleMaturedPredictions)", "ipHit": "\(sH.hit)", "ipPartial": "\(sH.partial)",
            "ipMiss": "\(sH.miss)", "ipPending": "\(sH.pending)", "ipInvalid": "\(invalid)", "ipPrecision": r.advance[7].value,
            "ipRecall": r.advance[8].value, "ipF1": r.advance[9].value,
            "cdTotal": "\(condIdx.count)", "cdMatured": "\(sC.eligibleMaturedPredictions)", "cdHit": "\(sC.hit)", "cdPartial": "\(sC.partial)",
            "cdMiss": "\(sC.miss)", "cdPending": "\(sC.pending)", "cdPrecision": r.other[6].value,
            "obTotal": "\(p.obsEvents.count)", "obFalseNeg": "\(sH.falseNegatives)", "obCoverage": "\(c["COVERAGE_FAILURE"] ?? 0)",
            "obForecast": "\(c["FORECAST_FAILURE"] ?? 0)", "obUnknown": "\(c["DATA_UNAVAILABLE"] ?? 0)", "obNotForecastable": "\(c["NOT_FORECASTABLE"] ?? 0)",
            "obNoInput": "\(c["NO_PROSPECTIVE_INPUT"] ?? 0)", "answerLead": r.answerLead
        ]
        return r
    }

    static func row(rec r: Record, state: String, ledgerState: String?, unrep: Bool, v: JSONValue?, graded: Bool, tz: String?) -> LedgerRow {
        var notes: [String] = []
        if !graded { notes.append("We could not load the record needed to check this forecast, so no result is shown.") }
        if let ls = ledgerState { notes.append("Checked by hand as \u{201C}" + (Verdicts.labels[ls] ?? ls) + "\u{201D}. The automatic result is the one we count.") }
        if unrep { notes.append("Checked by hand. Our automatic checker cannot repeat this check from our record of disasters, so no rate on this page uses it.") }
        if let v = v, v["gradeable"]?.isTruthy != true, let reason = v["classificationReason"], reason.isTruthy { notes.append(niceDates(reason.jsString, tz: tz)) }
        let isF = Verdicts.isForecastRow(r)
        let cls = v?["forecastClass"]?.isTruthy == true ? v!["forecastClass"]!.jsString : (Verdicts.forecastClassOf(r) ?? "")
        let kind = isF ? (Hazards.forecastClasses[cls]?.label ?? (cls.isEmpty ? "-" : cls)) : "-"
        var threshold = "-"
        if let th = v?["originalThresholds"], th.isTruthy {
            let by = th["geographyToleranceKmByHazard"]?.objectValue ?? [:]
            let tol = by.count > 1 ? by.keys.sorted().map { (by[$0]?.jsString ?? "") + " km for " + $0.replacingOccurrences(of: "-", with: " ") }.joined(separator: ", ")
                : (th["geographyToleranceKm"]?.jsString ?? "") + " km"
            let country = v?["originalGeography"]?["country"].flatMap { $0.isTruthy ? $0.jsString : nil }
            threshold = "A significant event within " + tol + (country.map { " (" + $0 + ")" } ?? "")
        }
        var matched = "-"
        if let v = v {
            let ids = (v["observedEventIds"]?.arrayValue ?? []).map { $0.jsString }
            matched = !ids.isEmpty ? ids.joined(separator: ", ") : ((v["gradeable"]?.isTruthy ?? false) ? "None found" : (v["ungradeableReason"]?.stringValue == "WINDOW_STILL_OPEN" ? "Too early to say" : "Cannot be checked"))
        }
        let sev = r.s("observedSeverity")
        let place = [r.region, r.country].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        return LedgerRow(id: r.id + "|" + r.s("targetStart") + "|" + r.s("recordedAt") + "|" + r.s("observedAt") + "|" + UUID().uuidString, record: r, state: state,
                         title: Format.titleOf(r),
                         occurred: graded ? (Verdicts.occurred[state] ?? "Unknown") : "Unavailable",
                         result: graded ? (Verdicts.labels[state] ?? state) : "Unavailable", resultCSS: graded ? (Verdicts.css[state] ?? "") : "ungradeable",
                         notes: notes, kind: kind, severity: sev.isEmpty ? nil : sentence(sev),
                         hazardPlace: (r.first("hazard", "type")?.jsString ?? "-", place),
                         lockedOn: r.truthy("freezeTimestamp") ? Format.fmtDate(r.s("freezeTimestamp"), tz: tz) : "-",
                         period: r.truthy("targetStart") ? Format.windowText(r, tz: tz) : "An event, not a forecast",
                         threshold: threshold, matched: matched,
                         evidence: r.truthy("evidenceConfidence") ? sentence(r.s("evidenceConfidence")) : "Not checked yet",
                         serious: ["CATASTROPHIC", "EXTREME", "SEVERE"].contains(sev))
    }

    /// The ledger table's filters (search, result, actual severity) and sort.
    public static func filter(_ rows: [LedgerRow], query: String, result: String, severity: String, sort: String) -> [LedgerRow] {
        let kept = rows.filter { Search.matches($0.record, query) && (result.isEmpty || $0.state == result) && (severity.isEmpty || $0.record.s("observedSeverity") == severity) }
        guard let def = Sorts.defs[sort] else { return kept }
        return Sorts.stableSort(kept) { def.cmp($0.record, $1.record) }
    }

    public static let resultOptions: [(String, String)] = [("", "All results"), ("VERIFIED", "Correct"), ("PARTIAL", "Partly correct"),
        ("FALSE_ALARM", "Wrong (false alarm)"), ("MISSED", "Missed event"), ("COVERAGE_FAILURE", "Missed: not checking there"),
        ("AWAITING", "Not checked yet"), ("UNGRADEABLE", "Cannot be checked"), ("NOT_A_PREDICTION", "No proof it was made in time"), ("OPEN", "Still running")]
    public static let severityOptions: [(String, String)] = [("", "All severities"), ("CATASTROPHIC", "Catastrophic"), ("EXTREME", "Extreme"),
        ("SEVERE", "Severe"), ("SIGNIFICANT", "Significant"), ("MODERATE", "Moderate"), ("MINOR", "Minor")]

    public static let intro = "How the forecasts we have recorded turned out. This includes the ones we got wrong, the ones we could not check and the disasters we missed."
    public static let fullDetailsIntro = "A forecast counts as made in advance only if we recorded it before the danger it names was known. Other forecasts are made later: about a flood that is already happening, about aftershocks after an earthquake, or as a test case written after its period began. These are real forecasts, but they do not foresee something nobody knew about. We report the two kinds separately and never add them together."
    public static let precisionRecall = "Precision answers this question: when we forecast an event, how often did it happen? Recall answers this one: of the significant disasters that really happened, how many had a forecast that counts, made in advance? Forecasts that are still running are left out until their period ends. A forecast based on an official warning gets no credit just because the warning already existed."
    public static let observedIntro = "Every significant disaster in our record, including the ones we did not forecast. If we have no record of checking that place at the time, we cannot say why a disaster was missed. The table says so, rather than blaming our checks or our forecasts."
    public static let labelsIntro = "For each forecast or event, we keep 4 separate labels: how severe the event was, how the forecast turned out, whether we were checking that place, and how strong the evidence is."
    public static let backtestIntro = "Our experimental models forecast extreme heat, heavy rain and wildfire weather a few days ahead. Their forecasts are on the forecasts page, marked as made in advance. Each one is recorded when it is published and graded below once its days have been measured, misses included. The models are also tested on weather forecasts that were really issued 3 and 5 days in advance; those results are in the first table."

    /// "Was the place checked?" for the comparison cards.
    public static func coveredText(_ r: Record) -> String {
        let c = r.s("coverageStatus")
        if let v = covered[c] { return v }
        return c.isEmpty ? "-" : sentence(c.replacingOccurrences(of: "_", with: " "))
    }

    // MARK: backtest copy

    public static func backtestStatus(_ doc: JSONValue) -> String {
        let w = doc["window"] ?? .object([:])
        let skipped = doc["skipped"]?.arrayValue?.count ?? 0
        func day(_ t: JSONValue?) -> String {
            let s = t?.jsString ?? ""
            guard let ms = JSDate.ms(String(s.prefix(10)) + "T00:00:00Z") else { return s }
            let p = Format.parts(ms, "UTC")
            let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"][p.month - 1]
            return "\(p.day) \(mon) \(p.year)"
        }
        let places = JS.group(doc["places"]?.jsNumber ?? 0)
        let period = doc["climatologyPeriod"]?.isTruthy == true ? doc["climatologyPeriod"]!.jsString : "30-year"
        return "Tested in \(places) cities" + (skipped > 0 ? " (\(skipped) more could not be tested)" : "") + ", on days from " + day(w["from"]) + " to " + day(w["to"]) +
            ", against weather measured by NASA POWER, with each place\u{2019}s " + period + " record as its normal. \"By chance\" is what a forecaster with no skill would score, warning on the same number of days picked at random."
    }

    public static func backtestLimits(_ doc: JSONValue, rows: [Backtest.Row]) -> [String] {
        let places = JS.group(doc["places"]?.jsNumber ?? 0)
        let heat = rows.first { $0.hazard == "heat" && $0.lead == 3 }
        var heatText = ""
        if let heat = heat {
            if doc["heatLine"]?.stringValue != "trend" {
                heatText = "Days crossed the heat line on " + Backtest.pct(heat.rightByChance) + " of the days tested, though the line is meant to be crossed on about 5%. Recent measurements run warmer than the 30-year record, so heat is easier to score well on than intended."
            } else {
                var alt = doc
                if case .object(var o) = alt, case .object(var res)? = o["results"] {
                    res["heat@3"] = res["heatUnshifted@3"] ?? .null; o["results"] = .object(res); alt = .object(o)
                }
                let p0 = Backtest.rows(alt)?.first { $0.hazard == "heat" && $0.lead == 3 }
                heatText = "The heat line is each city\u{2019}s 95th percentile for the date over 1996 to 2025, moved by that city\u{2019}s own temperature trend over those years to the year it is used in: up where it has warmed and down where it has cooled. " +
                    (heat.rightByChance <= 0.065
                        ? "Days crossed it on " + Backtest.pct(heat.rightByChance) + " of the days tested, about the 5% the name suggests" + (p0.map { " (the line without the trend: " + Backtest.pct($0.rightByChance) + ")." } ?? ".")
                        : "Even so, days crossed it on " + Backtest.pct(heat.rightByChance) + " of the days tested" + (p0.map { ", against " + Backtest.pct($0.rightByChance) + " for the line without the trend" } ?? "") + ", not the 5% the name suggests: these months ran hotter than the trend predicts.") +
                    " A heat warning here means hotter than 19 in 20 days of that trend, not of today\u{2019}s climate."
            }
        }
        return [
            "These are weather forecasts, not disasters. A hit means a day crossed a local weather line, such as " + (rows.first?.threshold ?? "") + ". It does not mean a disaster happened, and a miss does not mean one was missed.",
            "One season only: about three months, in \(places) cities. The models may do better or worse in other seasons and places.",
            heatText,
            "Measured weather comes from NASA POWER, a grid with cells about 50 to 70 km across, not from weather stations, so a city\u{2019}s own readings can differ.",
            "Wildfire weather is tested with the index built from measured weather up to the day before, so only the last day is forecast. The live models forecast every day, and should be expected to do worse than this.",
            "Each day is scored on its own here. A published heat or fire forecast needs two days in a row, and is graded in the table below once its days have been measured."
        ].filter { !$0.isEmpty }
    }

    public static let backtestEmpty = "Not yet available. The test results could not be read, or the last test scored nothing, so no figures are shown."

    /// Published model forecasts table and status (`model-verdicts.json`).
    public static func published(_ v: JSONValue?) -> (status: String, rows: [[String]]) {
        let c = v?["counts"]
        let issued = c?["issued"]?.jsNumber ?? 0
        let correct = c?["correct"]?.jsNumber ?? 0, fa = c?["falseAlarms"]?.jsNumber ?? 0
        guard c != nil, correct + fa > 0 else {
            return (issued > 0 ? "Not yet graded. " + JS.group(issued) + " published so far, each waiting for its days to be measured by NASA POWER, which runs about three days behind."
                    : "Not yet graded. The grades appear here once the daily model run has measured the days of a published forecast.", [])
        }
        let list = v?["outlooks"]?.arrayValue ?? [], miss = v?["misses"]?.arrayValue ?? []
        let rows = [("heat", "Extreme heat"), ("rain", "Heavy rain"), ("fire", "Wildfire weather")].map { (k, label) -> [String] in
            let of = list.filter { $0["hazard"]?.stringValue == k }
            func n(_ w: String) -> Int { of.filter { $0["verdict"]?.stringValue == w }.count }
            return [label, "\(of.count)", "\(n("correct"))", "\(n("false alarm"))", "\(miss.filter { $0["hazard"]?.stringValue == k }.count)", "\(n("pending"))"]
        }
        let gen = v?["generatedAt"]?.jsString ?? ""
        let gd: String = {
            guard let ms = JSDate.ms(String(gen.prefix(10)) + "T00:00:00Z") else { return gen }
            let p = Format.parts(ms, "UTC")
            return "\(p.day) " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"][p.month - 1] + " \(p.year)"
        }()
        let missed = c?["missedDays"]?.jsNumber ?? 0
        let status = "Graded " + gd + ". Of " + JS.group(issued) + " published, " + JS.group(correct) + " came true and " + JS.group(fa) + " were false alarms; " +
            JS.group(c?["pending"]?.jsNumber ?? 0) + " are waiting for their days to be measured. " + JS.group(missed) + " day" + (missed == 1 ? "" : "s") +
            " crossed a line at a place the models were watching without a forecast for it."
        return (status, rows)
    }
}
