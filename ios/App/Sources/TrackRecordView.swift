import SwiftUI
import PNDCore

@MainActor
final class TrackRecordModel: ObservableObject {
    @Published var report: TrackRecord.Report?
    @Published var loading = true
    @Published var backtest: [Backtest.Row]?
    @Published var backtestDoc: JSONValue?
    @Published var backtestLoaded = false
    @Published var published: (status: String, rows: [[String]])?
    @Published var ledgerTimes: [String]?
    @Published var ledgerFailed = false

    func load(client: APIClient, zone: String) async {
        loading = true
        async let l = try? client.dataFile("outlook-ledger.json")
        async let v = try? client.dataFile("verification-ledger.json")
        async let o = try? client.dataFile("observed-disasters.json")
        async let s = try? client.dataFile("scan-ledger.json")
        async let bt = try? client.dataFile("model-backtest.json")
        async let mv = try? client.dataFile("model-verdicts.json")
        let inputs = TrackRecord.Inputs(outlookLedger: await l, verificationLedger: await v, observed: await o, scanLedger: await s)
        let btDoc = await bt
        backtestDoc = btDoc
        backtest = Backtest.rows(btDoc)
        backtestLoaded = true
        published = TrackRecord.published(await mv)
        let now = Format.now()
        let report: TrackRecord.Report = await Task.detached(priority: .userInitiated) {
            let p = TrackRecord.prepare(inputs)
            var graded: (verdicts: [JSONValue], assessments: [JSONValue])?
            if p.canGrade, let dir = Bundle.main.url(forResource: "Web", withExtension: nil),
               let engine = JSGradingEngine(directory: dir) {
                graded = try? engine.grade(p, scanLedger: inputs.scanLedger, now: now)
            }
            return TrackRecord.build(inputs, p, verdicts: graded?.verdicts, assessments: graded?.assessments, now: now, tz: zone)
        }.value
        self.report = report
        ledgerTimes = report.updatedTimes
        ledgerFailed = report.ledgerError != nil && report.updatedTimes.isEmpty
        loading = false
    }
}

/// Track record (features.md section 6).
struct TrackRecordView: View {
    @EnvironmentObject var model: AppModel
    @StateObject var tr = TrackRecordModel()
    @State var query = ""
    @State var result = ""
    @State var severity = ""
    @State var sort = SortPicker.initial("accuracy_sortBy", Sorts.ledgerSorts)
    @State var showMeaning = false
    @State var showCompare = false
    @State var showFull = false

    var body: some View {
        ScreenScroll(title: "Track record", onRefresh: { await tr.load(client: model.client, zone: model.zoneID) }) {
            ScreenHeader(title: "Track record", subtitle: TrackRecord.intro)
            TrustNote(groups: [.ledger], ledgerTimes: tr.ledgerTimes, ledgerFailed: tr.ledgerFailed)
            if let r = tr.report {
                content(r)
            } else {
                ProgressView("Loading the track record\u{2026}").tint(Theme.text).accessibilityIdentifier("trackLoading")
            }
        }
        .task { if tr.report == nil { await tr.load(client: model.client, zone: model.zoneID) } }
    }

    @ViewBuilder func content(_ r: TrackRecord.Report) -> some View {
        if let err = r.ledgerError {
            Notice(text: err, stale: true).accessibilityIdentifier("ledgerError")
        }
        VStack(alignment: .leading, spacing: 8) {
            Text(r.answerLead).font(.title3.bold()).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("answerLead")
            ForEach(r.answerPoints, id: \.self) { p in
                HStack(alignment: .top, spacing: 6) { Text("\u{2022}"); Text(p) }.font(.subheadline).foregroundStyle(Theme.textSoft)
            }
        }
        .padding(14)
        .background(Color(hex: "#071C16"), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#183F33"), lineWidth: 1))
        metrics(r.keyFigures).accessibilityElement(children: .contain).accessibilityIdentifier("keyFigures")
        DisclosureGroup("What these figures mean", isExpanded: $showMeaning) {
            Text(r.honesty).font(.footnote).foregroundStyle(Theme.textSoft).padding(.top, 6)
        }
        .tint(Theme.greenText).foregroundStyle(Theme.greenText)
        backtestSection
        Panel("\u{2713} Forecasts that came true") {
            if r.cameTrue.isEmpty { Text(r.listText ?? r.cameTrueEmpty).font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(r.cameTrue.prefix(20)) { row in miniCard(row) }
        }
        Panel("\u{26A0} Significant events we missed") {
            if r.missed.isEmpty { Text(r.listText ?? r.missedEmpty).font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(r.missed.prefix(20)) { row in miniCard(row) }
        }
        Panel("Significant disasters on record") {
            Text(TrackRecord.observedIntro).font(.footnote).foregroundStyle(Theme.muted)
            if r.observedRows.isEmpty { Text(r.observedEmpty).font(.footnote).foregroundStyle(Theme.muted) }
            LimitedList(items: r.observedRows, page: 10) { o in
                CardBox {
                    Text(o.name).font(.subheadline.bold()).foregroundStyle(Theme.text)
                    if !o.reason.isEmpty { Text(o.reason).font(.caption).foregroundStyle(Theme.muted) }
                    KeyValueRow(key: "Type", value: o.type)
                    KeyValueRow(key: "Where", value: o.place)
                    KeyValueRow(key: "Started", value: o.started)
                    KeyValueRow(key: "Deaths", value: o.deaths, muted: o.deaths == "Not reported")
                    KeyValueRow(key: "Displaced", value: o.displaced, muted: o.displaced == "Not reported")
                    KeyValueRow(key: "Evidence", value: o.evidence)
                    HStack { Text("FORECAST IN ADVANCE?").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label)
                        VerdictPill(text: o.verdict, css: o.forecastInAdvance ? "verified" : "alarm") }
                    if !o.why.isEmpty { KeyValueRow(key: "Why not", value: o.why) }
                }
            }
        }
        ledger(r)
        DisclosureGroup("What we forecast compared with what happened", isExpanded: $showCompare) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Each checked forecast, with what we forecast next to what we found.").font(.footnote).foregroundStyle(Theme.muted)
                if r.comparisons.isEmpty { Text(r.listText ?? "No forecast has been checked yet.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(r.comparisons.prefix(30)) { row in compare(row) }
            }
            .padding(.top, 6)
        }
        .tint(Theme.greenText).foregroundStyle(Theme.greenText)
        DisclosureGroup("Full details: advance forecasts, other forecasts and missed disasters", isExpanded: $showFull) {
            VStack(alignment: .leading, spacing: 10) {
                Text(TrackRecord.fullDetailsIntro).font(.footnote).foregroundStyle(Theme.muted)
                metrics(r.sample)
                Text("How our advance forecasts did").font(.headline).foregroundStyle(Theme.text)
                metrics(r.advance)
                Text(r.advanceNote).font(.footnote).foregroundStyle(Theme.muted)
                Text("How our other forecasts did").font(.headline).foregroundStyle(Theme.text)
                Text("These forecasts are about a danger already reported, or about what follows an event that already happened, such as aftershocks. We check them too, but never count them as advance forecasts.").font(.footnote).foregroundStyle(Theme.muted)
                metrics(r.other)
                Text(r.otherNote).font(.footnote).foregroundStyle(Theme.muted)
                Text("Disasters and what we missed").font(.headline).foregroundStyle(Theme.text)
                metrics(r.disasters)
                Text(r.disastersNote).font(.footnote).foregroundStyle(Theme.muted)
                Text("How we work out these numbers").font(.headline).foregroundStyle(Theme.text)
                Text(r.methodNote).font(.footnote).foregroundStyle(Theme.muted)
                Text(r.classBreak).font(.footnote).foregroundStyle(Theme.muted)
                Text("How we label results").font(.headline).foregroundStyle(Theme.text)
                Text(TrackRecord.labelsIntro).font(.footnote).foregroundStyle(Theme.muted)
                FlowRow {
                    RiskBadge(level: .extreme, text: "Extreme event"); RiskBadge(level: .severe, text: "Severe event"); RiskBadge(level: .high, text: "Significant event")
                    VerdictPill(text: "Correct", css: "verified"); VerdictPill(text: "Partly correct", css: "partial"); VerdictPill(text: "Wrong (false alarm)", css: "alarm")
                    VerdictPill(text: "Missed event", css: "missed"); VerdictPill(text: "Missed: not checking there", css: "coverage")
                    VerdictPill(text: "Cannot be checked", css: "ungradeable"); VerdictPill(text: "No proof it was made in time", css: "notprediction")
                }
                Text(TrackRecord.precisionRecall).font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(.top, 6)
        }
        .tint(Theme.greenText).foregroundStyle(Theme.greenText)
    }

    func metrics(_ m: [TrackRecord.Metric]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
            ForEach(m) { x in
                VStack(alignment: .leading, spacing: 4) {
                    Text(x.label.uppercased()).font(.caption2.weight(.heavy)).tracking(0.9).foregroundStyle(Color(hex: "#8EAA9F"))
                    Text(x.value).font(.title3.bold().monospacedDigit()).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: "#071C16"), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#183F33"), lineWidth: 1))
                .accessibilityElement(children: .combine)
            }
        }
    }

    var backtestSection: some View {
        Panel("Experimental forecast models: tested on past weather") {
            Text(TrackRecord.backtestIntro).font(.footnote).foregroundStyle(Theme.muted)
            if !tr.backtestLoaded {
                Text("Loading the test results\u{2026}").font(.footnote).foregroundStyle(Theme.muted)
            } else if let rows = tr.backtest, let doc = tr.backtestDoc {
                Text(TrackRecord.backtestStatus(doc)).font(.footnote).foregroundStyle(Theme.textSoft)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, b in
                    CardBox {
                        Text(b.label + " \u{00B7} \(b.lead) days ahead").font(.subheadline.bold()).foregroundStyle(Theme.text)
                        KeyValueRow(key: "Days tested", value: JS.group(Double(b.days)))
                        KeyValueRow(key: "Days it happened", value: JS.group(Double(b.happened)) + " (" + Backtest.pct(b.rightByChance) + ")")
                        KeyValueRow(key: "Caught by the model", value: Backtest.pct(b.caught))
                        KeyValueRow(key: "Caught by chance", value: Backtest.pct(b.caughtByChance))
                        KeyValueRow(key: "Right when the model warned", value: Backtest.pct(b.rightWhenWarned))
                        KeyValueRow(key: "Right by chance", value: Backtest.pct(b.rightByChance))
                    }
                }
                ForEach(TrackRecord.backtestLimits(doc, rows: rows), id: \.self) { t in
                    HStack(alignment: .top, spacing: 6) { Text("\u{2022}"); Text(t) }.font(.caption).foregroundStyle(Theme.muted)
                }
            } else {
                Text(TrackRecord.backtestEmpty).font(.footnote).foregroundStyle(Theme.muted)
            }
            Text("Published model forecasts").font(.headline).foregroundStyle(Theme.text)
            if let p = tr.published {
                Text(p.status).font(.footnote).foregroundStyle(Theme.textSoft)
                ForEach(Array(p.rows.enumerated()), id: \.offset) { _, row in
                    CardBox {
                        Text(row[0]).font(.subheadline.bold()).foregroundStyle(Theme.text)
                        let labels = ["Published", "Came true", "False alarms", "Missed days", "Waiting to be measured"]
                        ForEach(0..<5, id: \.self) { i in KeyValueRow(key: labels[i], value: row[i + 1]) }
                    }
                }
            } else {
                Text("Loading the grades\u{2026}").font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }

    func miniCard(_ row: TrackRecord.LedgerRow) -> some View {
        CardBox {
            HStack {
                if let s = row.severity { RiskBadge(level: RiskScale.levelOf(s), text: s) } else { RiskBadge(level: .unknown, text: "Severity not recorded") }
                VerdictPill(text: row.result, css: row.resultCSS)
            }
            Text((row.record.first("id", "eventId")?.jsString ?? "Observed event") + " \u{00B7} " + Format.placeOf(row.record, "Global"))
                .font(.subheadline.bold()).foregroundStyle(Theme.text)
            Text(row.hazardPlace.0 + " \u{00B7} " + (row.evidence == "Not checked yet" ? "Evidence not rated yet" : "Evidence: " + row.evidence))
                .font(.caption).foregroundStyle(Theme.muted)
        }
        .overlay(alignment: .leading) { if row.serious { Rectangle().fill(Theme.seriousRow).frame(width: 4) } }
    }

    func ledger(_ r: TrackRecord.Report) -> some View {
        let list = TrackRecord.filter(r.rows, query: query.lowercased(), result: result, severity: severity, sort: sort)
        return Panel("All recorded forecasts") {
            Text("Newest first. You can search, filter or sort. We show 25 at a time.").font(.footnote).foregroundStyle(Theme.muted)
            SearchField(prompt: "Search by ID, country, region or hazard", text: $query)
            FlowRow(spacing: 8) {
                MenuPicker(label: "Filter by result", selection: $result, options: TrackRecord.resultOptions)
                SortPicker(screen: "accuracy_sortBy", keys: Sorts.ledgerSorts, selection: $sort)
                MenuPicker(label: "Filter by actual severity", selection: $severity, options: TrackRecord.severityOptions)
            }
            if list.isEmpty { Text("No forecasts match these filters.").font(.footnote).foregroundStyle(Theme.muted) }
            LimitedList(items: list, page: 25) { row in ledgerRow(row) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ledgerTable")
    }

    func ledgerRow(_ row: TrackRecord.LedgerRow) -> some View {
        CardBox {
            Text(row.record.first("id", "eventId")?.jsString ?? "Observed").font(.subheadline.bold()).foregroundStyle(Theme.text)
            Text(row.title).font(.caption).foregroundStyle(Theme.muted)
            HStack { Text("Did it happen? ").font(.caption.bold()).foregroundStyle(Theme.label); Text(row.occurred).font(.footnote.bold()).foregroundStyle(Theme.text) }
            VerdictPill(text: row.result, css: row.resultCSS)
            ForEach(row.notes, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.muted) }
            KeyValueRow(key: "Type of forecast", value: row.kind)
            HStack { Text("ACTUAL SEVERITY").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label)
                if let s = row.severity { RiskBadge(level: RiskScale.levelOf(s), text: s) } else { RiskBadge(level: .unknown, text: "Not recorded") } }
            KeyValueRow(key: "Hazard and place", value: row.hazardPlace.0 + (row.hazardPlace.1.isEmpty ? "" : " \u{00B7} " + row.hazardPlace.1))
            KeyValueRow(key: "Locked on", value: row.lockedOn)
            KeyValueRow(key: "Forecast period", value: row.period)
            KeyValueRow(key: "What counted as a match", value: row.threshold)
            KeyValueRow(key: "Matching event", value: row.matched)
            KeyValueRow(key: "Evidence", value: row.evidence)
        }
        .overlay(alignment: .leading) { if row.serious { Rectangle().fill(Theme.seriousRow).frame(width: 4) } }
    }

    func compare(_ row: TrackRecord.LedgerRow) -> some View {
        let r = row.record
        return CardBox {
            Text(r.id + " \u{00B7} " + Format.placeOf(r, "")).font(.subheadline.bold()).foregroundStyle(Theme.text)
            HStack { VerdictPill(text: row.result, css: row.resultCSS); Text("Did it happen? " + row.occurred).font(.footnote.bold()).foregroundStyle(Theme.text) }
            Text("What we forecast").font(.caption.bold()).foregroundStyle(Theme.label)
            KeyValueRow(key: "Hazard", value: r.first("type", "hazard")?.jsString ?? "-")
            KeyValueRow(key: "Area", value: Format.placeOf(r, "-"))
            KeyValueRow(key: "Forecast period", value: Format.windowText(r, tz: model.zoneID))
            KeyValueRow(key: "Level forecast", value: r.first("severity", "alert")?.jsString ?? "-")
            KeyValueRow(key: "Confidence", value: r.s("confidence").ifEmpty("-"))
            KeyValueRow(key: "Based on", value: r.s("evidence").ifEmpty("-"))
            KeyValueRow(key: "How it is checked", value: r.s("verificationRule").ifEmpty("-"))
            Text("What actually happened").font(.caption.bold()).foregroundStyle(Theme.label)
            KeyValueRow(key: "Actual severity", value: row.severity ?? "Not recorded")
            KeyValueRow(key: "Evidence strength", value: r.truthy("evidenceConfidence") ? row.evidence : "-")
            KeyValueRow(key: "Was the place checked?", value: TrackRecord.coveredText(r))
            KeyValueRow(key: "What we found", value: r.s("summary").ifEmpty("-"))
            ForEach((r["criteria"]?.objectValue ?? [:]).keys.sorted(), id: \.self) { k in
                KeyValueRow(key: k, value: (r["criteria"]?[k]?.isTruthy ?? false) ? "met" : "not met")
            }
        }
    }
}
