import SwiftUI
import CoreLocation
import PNDCore

/// The ten enrichment panels (features.md section 7.5).
struct EnrichmentSection: View {
    @EnvironmentObject var model: AppModel
    let record: Record
    @State var panels: [EnrichmentPanel] = EnrichmentPanels.loading()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(panels) { p in
                Panel(p.title) {
                    Text(p.meta).font(.caption).foregroundStyle(Theme.muted)
                    ForEach(p.rows) { r in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.key).font(.caption).foregroundStyle(Color(hex: "#89AB9D"))
                            Text(r.value).font(.subheadline).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                            if let n = r.note { Text(n).font(.caption).foregroundStyle(Theme.muted) }
                            linkRow(r.links)
                        }
                    }
                    ForEach(p.cards) { c in card(c) }
                }
            }
        }
        .accessibilityIdentifier("enrichment")
        .task(id: record.id + record.updated) { await load() }
        .task(id: record.id) {
            // Re-request every 5 minutes while the screen is open.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 300_000_000_000)
                await load()
            }
        }
    }

    func load() async {
        if let d = await model.enrichment(for: record) {
            panels = EnrichmentPanels.build(d, event: record, tz: model.zoneID)
        } else {
            panels = EnrichmentPanels.failure()
        }
    }

    @ViewBuilder func linkRow(_ links: [WebLink]) -> some View {
        if !links.isEmpty {
            FlowRow(spacing: 10) {
                ForEach(links, id: \.self) { l in
                    if let u = URL(string: l.url) {
                        SwiftUI.Link(l.label, destination: u).font(.footnote.weight(.semibold)).foregroundStyle(Theme.link).frame(minHeight: 44)
                    }
                }
            }
        }
    }

    @ViewBuilder func card(_ c: EnrichmentCard) -> some View {
        let inner = VStack(alignment: .leading, spacing: 6) {
            if !c.tags.isEmpty {
                FlowRow { ForEach(c.tags, id: \.self) { t in Pill(text: t, color: c.verifiedTags.contains(t) ? Theme.greenText : Theme.sourceText,
                                                                   border: c.verifiedTags.contains(t) ? Theme.green : Theme.provBorder) } }
            }
            if let img = c.imageURL, let u = URL(string: img) {
                AsyncImage(url: u) { i in i.resizable().scaledToFill() } placeholder: { Color(hex: "#062018") }
                    .aspectRatio(16 / 9, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 6))
                    .accessibilityHidden(true)
            }
            if !c.title.isEmpty { Text(c.title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading) }
            ForEach(c.body, id: \.self) { b in Text(b).font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.leading) }
            if let l = c.list { ForEach(l, id: \.self) { x in HStack(alignment: .top) { Text("\u{2022}"); Text(x) }.font(.caption).foregroundStyle(Color(hex: "#CFE7DD")) } }
            if let p = c.phone, let u = URL(string: EnrichmentPanels.tel(p)) {
                SwiftUI.Link(p, destination: u).font(c.phoneSmall ? .headline : .title.weight(.heavy)).foregroundStyle(Theme.greenText).frame(minHeight: 44)
                    .accessibilityLabel("Call " + p)
            }
            if let e = c.email, let u = URL(string: "mailto:" + e) { SwiftUI.Link(e, destination: u).font(.footnote).foregroundStyle(Theme.link).frame(minHeight: 44) }
            if let s = c.small { Text(s).font(.caption2).foregroundStyle(Theme.muted) }
            if let cta = c.cta { Text(cta).font(.footnote.bold()).foregroundStyle(Theme.link) }
            linkRow(c.links)
        }
        if let s = c.url, let u = URL(string: s) {
            SwiftUI.Link(destination: u) { CardBox { inner } }.buttonStyle(.plain)
        } else {
            CardBox { inner }
        }
    }
}

enum DetailKind { case event, alert, calamity }

/// Event, alert and calamity detail (features.md sections 7.1 to 7.3).
struct RecordDetailView: View {
    @EnvironmentObject var model: AppModel
    let id: String
    let kind: DetailKind
    @State var sort = SortPicker.initial("detail_sortBy", Sorts.nearbySorts)

    var body: some View {
        let e = Format.findEvent(model.all, id)
        ScreenScroll(title: e.map { Format.titleOf($0) } ?? "Details") {
            if let e = e {
                content(e)
            } else if model.feed == nil && model.status != .failed {
                ProgressView(Copy.loading).tint(Theme.text)
            } else {
                notFound
            }
        }
        .toolbar {
            if let e = e {
                ToolbarItem(placement: .topBarTrailing) { ShareButton(route: route, title: Format.titleOf(e)) }
            }
        }
    }

    var route: Route {
        switch kind { case .event: return .event(id); case .alert: return .alert(id); case .calamity: return .calamity(id) }
    }

    var notFound: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.status == .failed {
                Notice(text: Copy.loadError, stale: true)
                Text(kind == .event ? "We could not update this event just now." : Copy.loadError).font(.subheadline).foregroundStyle(Theme.textSoft)
            } else {
                ScreenHeader(title: kind == .alert ? "Alert not found" : (kind == .calamity ? "Disaster not found" : "Event not found"),
                             subtitle: kind == .calamity ? "The source may no longer list this event. It may have ended."
                                : "The source may no longer list this event. See all events to find the latest ones.")
                Text(Copy.notFound).font(.subheadline).foregroundStyle(Theme.textSoft)
                FlowRow(spacing: 8) {
                    NavigationLink("Events", value: Route.collection(.events, query: nil)).buttonStyle(SecondaryButtonStyle())
                    NavigationLink("Official warnings", value: Route.collection(.officialWarnings, query: nil)).buttonStyle(SecondaryButtonStyle())
                    NavigationLink("Our forecasts", value: Route.collection(.forecastList, query: nil)).buttonStyle(SecondaryButtonStyle())
                    NavigationLink("Calamities", value: Route.calamities).buttonStyle(SecondaryButtonStyle())
                    NavigationLink("Regions", value: Route.regions).buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .accessibilityIdentifier("notFound")
    }

    @ViewBuilder func content(_ e: Record) -> some View {
        let tz = model.zoneID
        let eyebrow: String = kind == .alert ? "Official alert" : (kind == .calamity ? "Current disaster" : (e.forecast ? "Our forecast, not official" : "Live event"))
        ScreenHeader(eyebrow: eyebrow, title: Format.titleOf(e), subtitle: e.type + " \u{00B7} " + Format.placeOf(e, "Place not given"))
        QuietNote(text: Format.quietNote(e))
        TrustNote()
        FeedBanner()
        switch kind {
        case .event: eventBody(e, tz)
        case .alert: alertBody(e, tz)
        case .calamity: calamityBody(e, tz)
        }
        MapCard(records: [e], height: 240, center: e.lat.flatMap { la in e.lon.map { CLLocationCoordinate2D(latitude: la, longitude: $0) } },
                spanDegrees: e.type.lowercased().contains("earthquake") ? 4 : 8)
        related(e)
        Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
        EnrichmentSection(record: e)
    }

    // MARK: event (7.1)

    @ViewBuilder func eventBody(_ e: Record, _ tz: String) -> some View {
        StatGrid(items: [("Type", e.type.isEmpty ? "-" : e.type), ("Source", e.source.isEmpty ? "-" : e.source),
                         ("Source last updated", Format.age(e.updated)), ("Data status", e.cached ? "Saved copy" : (e.forecast ? "Our forecast" : "Live"))])
        HStack { Text("RISK LEVEL").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label); RecordRiskBadge(record: e) }
        actionPanel(e)
        Panel("Overview") {
            FlowRow { RecordRiskBadge(record: e); SourcePill(source: e.source); if e.forecast { Pill(text: "Our forecast, not official") } }
            KeyFactsGrid(record: e)
            KeyValueRow(key: "When it started", value: e.truthy("startedAt") ? Format.fmtDate(e.s("startedAt"), tz: tz) + " (" + Format.age(e.s("startedAt")) + ")"
                : (e.forecast && e.truthy("targetStart") ? "Forecast period starts " + Format.fmtWhen(e.s("targetStart"), nil, nil, tz: tz) : "The source did not give a start time"))
            KeyValueRow(key: "Last updated", value: Format.fmtDate(e.updated, tz: tz))
            KeyValueRow(key: "Where it started", value: Format.placeOf(e, "Not given by the source"))
            KeyValueRow(key: "Areas affected", value: areas(e))
            KeyValueRow(key: "Coordinates", value: coords(e))
            KeyValueRow(key: "Description", value: e.details.isEmpty ? "The source gave no further details." : e.details)
            KeyValueRow(key: "Also reported by", value: alsoReported(e))
            if let u = e.s("alertSourceUrl").isEmpty ? nil : URL(string: e.s("alertSourceUrl")), !e.s("alertSource").isEmpty, e.s("alertSource") != e.source {
                SwiftUI.Link("Open their report \u{2197}", destination: u).font(.footnote).foregroundStyle(Theme.link)
            }
            KeyValueRow(key: "Report ID", value: e.id.isEmpty ? "-" : e.id)
            if let u = e.sourceURL { SwiftUI.Link("Open the original report \u{2197}", destination: u).buttonStyle(SecondaryButtonStyle()) }
        }
        impactPanel(e, note: Copy.impactNote, status: nil)
        Panel("How up to date and reliable this is") {
            Text("The source last updated this \(Format.age(e.updated)) (\(Format.fmtDate(e.updated, tz: tz))).").font(.footnote).foregroundStyle(Theme.textSoft)
            KeyValueRow(key: "Type of source", value: e.isOfficial ? "Official source" : (e.forecast ? "Our own forecast, not official" : "Collected from other sources"))
            KeyValueRow(key: "Status", value: e.cached ? "Saved copy, not live" : (e.forecast ? "Forecast in progress" : "Live, as the source last reported it"))
        }
        Panel("Who may need help") {
            ForEach(Copy.responseContext(e.type), id: \.title) { i in KeyValueRow(key: i.title, value: i.body) }
        }
        Panel("Timeline") {
            KeyValueRow(key: "Source report \u{00B7} " + Format.fmtDate(e.updated, tz: tz), value: e.details.isEmpty ? "The latest report from the source." : e.details)
            KeyValueRow(key: "This page updated \u{00B7} " + Format.fmtDate(model.feed?.generatedAt, tz: tz), value: "We checked our sources again and found this event.")
        }
    }

    func actionPanel(_ e: Record) -> some View {
        let lifeSafety = e.evidenceState == "official-warning" || RiskScale.rankOf(e.first("severity", "alert")?.jsString) >= RiskLevel.high.rank
        return VStack(alignment: .leading, spacing: 8) {
            Text("What should I do now?").font(.headline).foregroundStyle(Theme.text)
            HStack { Pill(text: Format.provenance(e)); Text("Updated " + Format.age(e.updated)).font(.caption).foregroundStyle(Theme.muted) }
            KeyValueRow(key: "What", value: e.type.isEmpty ? "Natural hazard" : e.type)
            KeyValueRow(key: "Where", value: areas(e, fallback: "See the map"))
            KeyValueRow(key: "How serious", value: RiskScale.label(of: e))
            KeyValueRow(key: "How reliable", value: e.isOfficial ? "OFFICIAL SOURCE" : (e.forecast ? "OUR OWN ESTIMATE" : "NOT YET CONFIRMED"))
            KeyValueRow(key: "Who says this", value: (e.source.isEmpty ? "Source not stated" : e.source) + " \u{00B7} " + (Copy.voice[e.evidenceState] ?? Copy.voice["unknown"]!))
            if lifeSafety { Text(Copy.lifeSafety).font(.subheadline.bold()).foregroundStyle(Theme.authority).accessibilityIdentifier("lifeSafety") }
            Text("What matters most now").font(.subheadline.bold()).foregroundStyle(Theme.text)
            ForEach(Copy.responseContext(e.type), id: \.title) { i in
                (Text(i.title + ": ").bold() + Text(i.body)).font(.footnote).foregroundStyle(Theme.textSoft)
            }
            if let u = e.sourceURL {
                SwiftUI.Link("OPEN THE ORIGINAL SOURCE \u{2197}", destination: u).buttonStyle(PrimaryButtonStyle())
            } else {
                Notice(text: Copy.noSourceLink, stale: true)
            }
            Text(Copy.notAnInstruction).font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(12)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) { Rectangle().fill(Theme.actionAccent).frame(width: 4) }
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    func impactPanel(_ e: Record, note: String, status: String?) -> some View {
        Panel("Reported impact") {
            StatGrid(items: [("Lives lost", Screens.impactFigure(e, "deaths")), ("People displaced", Screens.impactFigure(e, "displaced")),
                             ("People affected", Screens.impactFigure(e, "affected"))] + (status.map { [("Data status", $0)] } ?? []))
            Text(note).font(.footnote).foregroundStyle(Theme.muted)
        }
        .accessibilityIdentifier("impactPanel")
    }

    func areas(_ e: Record, fallback: String = "Not given by the source") -> String {
        let a = [e.region, e.country].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        return a.isEmpty ? fallback : a
    }

    func coords(_ e: Record) -> String {
        guard let la = e.lat, let lo = e.lon else { return "-" }
        return JS.toFixed(la, 4) + ", " + JS.toFixed(lo, 4)
    }

    func alsoReported(_ e: Record) -> String {
        var t = e.corroboratedBy.isEmpty ? "No other agency we read has reported this event separately" : e.corroboratedBy.joined(separator: " \u{00B7} ")
        if !e.s("alertSource").isEmpty && e.s("alertSource") != e.source && !e.alert.isEmpty {
            t += " The \u{201C}" + e.alert + "\u{201D} alert level shown is from " + e.s("alertSource") + "."
        }
        return t
    }

    // MARK: alert (7.2)

    @ViewBuilder func alertBody(_ e: Record, _ tz: String) -> some View {
        HStack { Text("ALERT LEVEL").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label); RecordRiskBadge(record: e) }
        StatGrid(items: [("Agency or source", e.source.isEmpty ? "-" : e.source), ("Updated", Format.age(e.updated)), ("Status", e.cached ? "Saved copy" : "Live")])
        Panel("Alert summary") {
            KeyFactsGrid(record: e)
            KeyValueRow(key: "Hazard", value: e.type.isEmpty ? "-" : e.type)
            KeyValueRow(key: "Place", value: Format.placeOf(e, "-"))
            KeyValueRow(key: "Areas affected", value: areas(e, fallback: "-"))
            KeyValueRow(key: "When it started", value: e.truthy("startedAt") ? Format.fmtDate(e.s("startedAt"), tz: tz) : "The source did not give a start time")
            KeyValueRow(key: "Issued or last updated", value: Format.fmtDate(e.updated, tz: tz))
            KeyValueRow(key: "Warning ends", value: e.truthy("expiresAt") ? Format.fmtDate(e.s("expiresAt"), tz: tz) : "The source did not give an end time")
            KeyValueRow(key: "What the alert says", value: e.details.isEmpty ? "-" : e.details)
            KeyValueRow(key: "Source report ID", value: e.first("rawId", "id")?.jsString ?? "-")
            if let u = e.sourceURL { SwiftUI.Link("Open the original report \u{2197}", destination: u).buttonStyle(SecondaryButtonStyle()) }
        }
        impactPanel(e, note: Copy.alertImpactNote, status: e.cached ? "Saved copy" : "Live")
        Panel("Source checks") {
            KeyValueRow(key: "Official source named?", value: "Yes")
            KeyValueRow(key: "Source\u{2019}s update time shown?", value: "Yes")
            KeyValueRow(key: "Is this a saved copy?", value: e.cached ? "Yes, and it is labelled" : "No")
            KeyValueRow(key: "Link to the original report?", value: e.sourceURL != nil ? "Yes" : "No, the source gave none")
        }
        Panel("Safety") {
            Text(Copy.alertSafety).font(.footnote).foregroundStyle(Theme.textSoft)
            Text(Copy.alertSafety2).font(.footnote).foregroundStyle(Theme.textSoft)
        }
    }

    // MARK: calamity (7.3); a reported 0 shows 0 (rule 8)

    @ViewBuilder func calamityBody(_ e: Record, _ tz: String) -> some View {
        StatGrid(items: [("Status", e.cached ? "Saved copy" : "Reported"), ("Hazard", e.type.isEmpty ? "-" : e.type),
                         ("Lives lost", Screens.impactFigure(e, "deaths")), ("People displaced", Screens.impactFigure(e, "displaced")),
                         ("Updated", Format.age(e.updated))])
        Panel("About this disaster") {
            HStack { RecordRiskBadge(record: e); SourcePill(source: e.source) }
            KeyValueRow(key: "Event", value: Format.titleOf(e))
            KeyValueRow(key: "Type", value: e.type.isEmpty ? "-" : e.type)
            KeyValueRow(key: "Country or area", value: areas(e, fallback: "-"))
            KeyValueRow(key: "Alert level", value: e.alert.isEmpty ? "Not reported by the source" : e.alert)
            KeyValueRow(key: "Official source", value: e.source.isEmpty ? "-" : e.source)
            KeyValueRow(key: "When it started", value: e.truthy("startedAt") ? Format.fmtDate(e.s("startedAt"), tz: tz) : "Not reported by the source")
            KeyValueRow(key: "Last updated by the source", value: Format.fmtDate(e.updated, tz: tz))
            KeyValueRow(key: "Coordinates", value: coords(e))
            KeyValueRow(key: "Lives lost", value: Screens.impactFigure(e, "deaths"))
            KeyValueRow(key: "People displaced", value: Screens.impactFigure(e, "displaced"))
            KeyValueRow(key: "People affected", value: Screens.impactFigure(e, "affected"))
            KeyValueRow(key: "Latest details from the source", value: e.details.isEmpty ? "Not reported by the source" : e.details)
            if let u = e.sourceURL { SwiftUI.Link("Open the original report \u{2197}", destination: u).buttonStyle(SecondaryButtonStyle()) }
        }
        Panel("How up to date this is") {
            KeyValueRow(key: "Source last updated", value: Format.fmtDate(e.updated, tz: tz))
            KeyValueRow(key: "We last checked", value: Format.fmtDate(model.feed?.generatedAt, tz: tz))
            KeyValueRow(key: "Age of the data", value: Format.age(e.updated))
            KeyValueRow(key: "Status", value: e.cached ? "Saved copy" : "Reported")
        }
        Panel("Safety and sources") {
            Text(Copy.calamitySafety).font(.footnote).foregroundStyle(Theme.textSoft)
            Text(Copy.calamitySafety2).font(.footnote).foregroundStyle(Theme.textSoft)
        }
    }

    // MARK: related lists

    @ViewBuilder func related(_ e: Record) -> some View {
        switch kind {
        case .event:
            let near = Sorts.apply(e.lat.flatMap { la in e.lon.map { lo in
                Screens.nearby(model.all, lat: la, lon: lo, withinKm: 1200, exclude: e.id) { !$0.forecast } } } ?? [], sort)
            Panel("Other events nearby", trailing: AnyView(SortPicker(screen: "detail_sortBy", keys: Sorts.nearbySorts, selection: $sort))) {
                if near.isEmpty { Text("No other current events nearby.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(near.prefix(6)) { x in
                    RelatedRow(record: x, line: JS.group(x.num("_d") ?? 0) + " km away \u{00B7} " + x.type)
                }
            }
        case .alert:
            let key = e.country.isEmpty ? e.region : e.country
            let same = Sorts.apply(model.live.filter { $0.id != e.id && !$0.forecast && Search.matchesPlace($0, key) }, "newest")
            Panel("Other events in the same country or area") {
                if same.isEmpty { Text("No other current events in this area.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(same.prefix(9)) { x in RelatedRow(record: x, line: x.type + " \u{00B7} " + Format.placeOf(x, "Place not given")) }
            }
        case .calamity:
            let rel = model.live.filter { $0.id != e.id && (($0.country == e.country && !e.country.isEmpty) || $0.type == e.type) }
            Panel("Related events") {
                if rel.isEmpty { Text("No related events right now.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(rel.prefix(6)) { x in RelatedRow(record: x, line: x.type + " \u{00B7} " + Format.placeOf(x, "Place not given")) }
            }
        }
    }
}

/// Forecast detail (features.md section 7.4).
struct ForecastDetailView: View {
    @EnvironmentObject var model: AppModel
    let id: String
    @State var ledgerRecord: Record?
    @State var ledgerChecked = false

    var body: some View {
        let live = Format.findEvent(model.all, id)
        let e = live ?? ledgerRecord
        ScreenScroll(title: e.map { Format.titleOf($0) } ?? "Forecast") {
            if let e = e {
                content(e, frozenAt: live == nil ? ledgerRecord?.first("recordedAt", "freezeTimestamp")?.jsString : nil)
            } else if (model.feed == nil && model.status != .failed) || (model.feed != nil && !ledgerChecked) {
                ProgressView(Copy.loading).tint(Theme.text)
            } else if model.status == .failed && model.feed == nil {
                Notice(text: Copy.loadError, stale: true)
            } else {
                ScreenHeader(title: "Forecast not found", subtitle: "We cannot find this forecast in our current data or in our record of past forecasts. Check the link, or go to the forecasts list.")
                    .accessibilityIdentifier("notFound")
                NavigationLink("Our forecasts", value: Route.collection(.forecastList, query: nil)).buttonStyle(SecondaryButtonStyle())
            }
        }
        .toolbar {
            if let e = e { ToolbarItem(placement: .topBarTrailing) { ShareButton(route: .forecast(id), title: Format.titleOf(e)) } }
        }
        .task(id: model.feed?.generatedAt) {
            guard model.feed != nil, Format.findEvent(model.all, id) == nil, ledgerRecord == nil else { ledgerChecked = true; return }
            if let r = try? await model.client.ledgerRow(id: id) {
                var raw = r.raw
                raw["forecast"] = .bool(true)
                ledgerRecord = Record(raw)
            }
            ledgerChecked = true
        }
    }

    @ViewBuilder func content(_ e: Record, frozenAt: String?) -> some View {
        let tz = model.zoneID
        let c = Screens.forecastChecks(e, feed: model.all, now: Format.now(), tz: tz)
        let hz = Hazards.hazardOf(e.type)
        ScreenHeader(eyebrow: "Forecast details", title: Format.titleOf(e), subtitle: e.type + " \u{00B7} " + Format.placeOf(e, "Global"))
        if let f = frozenAt {
            QuietNote(text: "This forecast is no longer being published. It is shown exactly as it was recorded on " + Format.fmtDate(f, tz: tz) + ".")
        } else {
            QuietNote(text: Format.quietNote(e))
        }
        Pill(text: "OUR FORECAST, NOT OFFICIAL", uppercase: true)
        TrustNote()
        FeedBanner()
        HStack { Text("RISK").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label); RecordRiskBadge(record: e) }
        StatGrid(items: [("Location", Format.placeOf(e, "-")), ("Last updated", Format.age(e.updated)), ("Status", c.ended ? "Ended, not yet checked" : "Active")])
        Panel("The forecast") {
            KeyFactsGrid(record: e)
            KeyValueRow(key: "Hazard", value: e.type.isEmpty ? "-" : e.type)
            KeyValueRow(key: "Place", value: [e.region, e.country].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ").ifEmpty("-"))
            KeyValueRow(key: "Description", value: e.details.ifEmpty("-"))
            KeyValueRow(key: "Last updated", value: Format.fmtDate(e.updated, tz: tz))
            KeyValueRow(key: "Forecast period", value: e.truthy("targetStart") ? Format.windowText(e, tz: tz) : "No start date recorded")
            KeyValueRow(key: "Kind of forecast", value: c.kind)
            KeyValueRow(key: "Severity", value: c.severity)
            KeyValueRow(key: "Advance notice", value: c.advance)
            KeyValueRow(key: "Confidence", value: e.s("confidence").ifEmpty("Not stated for this forecast"))
            KeyValueRow(key: "Evidence", value: e.s("evidence").ifEmpty("Made from the current official report named as its source."))
            KeyValueRow(key: "How it will be checked", value: e.s("verificationRule").ifEmpty("Checked against damage or harm that others report inside the stated area and dates."))
            KeyValueRow(key: "Forecast ID", value: e.id)
        }
        Panel("What counts as " + hz.name.lowercased()) {
            Text(hz.definition).font(.footnote).foregroundStyle(Theme.textSoft)
            KeyValueRow(key: "How it starts", value: hz.onsetText)
            KeyValueRow(key: "How long it lasts", value: hz.duration)
            KeyValueRow(key: "How much warning there is", value: hz.leadTime)
            KeyValueRow(key: "How severity is judged", value: hz.severityBasis)
            KeyValueRow(key: "Why this forecast period", value: Hazards.horizonText(e.type) + ". We set this from how this hazard develops. Each hazard has its own forecast period.")
        }
        Panel("How this forecast works") {
            KeyValueRow(key: "1. What sets it off", value: c.trigger)
            KeyValueRow(key: "2. How it spreads", value: Copy.mechanism(e.type).transmission)
            KeyValueRow(key: "3. Who and what is exposed", value: c.exposure)
            KeyValueRow(key: "4. How we will check it", value: c.verification)
        }
        Panel("What we will check") {
            matrix("Inside the locked forecast period", c.ended ? "Ended" : "Open", c.timingWhy)
            matrix("Inside the forecast area", c.ended ? "Ended" : "Open", c.geoWhy)
            matrix("Hazard reported", c.hazardValue, c.hazardWhy)
            matrix("Serious harm", "Not assumed", Copy.seriousHarmWhy)
            matrix("Official reports nearby", c.evidenceValue, c.evidenceWhy)
        }
        MapCard(records: [e], height: 240, center: e.lat.flatMap { la in e.lon.map { CLLocationCoordinate2D(latitude: la, longitude: $0) } },
                spanDegrees: 9, circleKm: 250, circleColor: Theme.amber, circleFill: 0.08)
        Panel("What this forecast means") {
            Text(e.s("forecastKind") == "frozen-benchmark" ? Copy.claimFrozen : Copy.claimDerived).font(.footnote).foregroundStyle(Theme.textSoft)
            Text(Hazards.leadTimeText(e)).font(.footnote).foregroundStyle(Theme.textSoft)
            Text(e.s("verificationRule")).font(.footnote).foregroundStyle(Theme.textSoft)
            Text(Copy.inEmergency).font(.footnote.bold()).foregroundStyle(Theme.authority)
        }
        Panel("Official reports near the forecast area") {
            if c.nearby.isEmpty { Text("No official reports near this area right now.").font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(c.nearby) { x in RelatedRow(record: x, line: JS.numberString(JS.round(x.num("_d") ?? 0)) + " km \u{00B7} " + x.type) }
        }
        Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
        EnrichmentSection(record: e)
    }

    func matrix(_ label: String, _ value: String, _ why: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text(label).font(.subheadline.bold()).foregroundStyle(Theme.text); Spacer(); Pill(text: value) }
            Text(why).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

extension String {
    func ifEmpty(_ s: String) -> String { isEmpty ? s : self }
}
