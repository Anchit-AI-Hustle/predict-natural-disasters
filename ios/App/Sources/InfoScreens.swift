import SwiftUI
import PNDCore

/// Our sources (features.md section 10.1).
struct SourcesView: View {
    @EnvironmentObject var model: AppModel
    @State var sort = SortPicker.initial("resources_sortBy", Sorts.sourceSorts)

    var body: some View {
        let p = Screens.providerCards(model.meta, sort: sort, tz: model.zoneID)
        let tz = model.zoneID
        ScreenScroll(title: "Our sources") {
            ScreenHeader(title: CollectionView.resources.title, subtitle: CollectionView.resources.subtitle)
            TrustNote()
            FeedBanner()
            SortPicker(screen: "resources_sortBy", keys: Sorts.sourceSorts, selection: $sort)
            RefreshRow(status: model.status == .failed ? Copy.loadError : (model.feed == nil ? Copy.loading :
                Format.statusText(model.meta) + " \u{00B7} sources checked " + Format.fmtDate(model.meta?["scan"]?["scanTimestamp"]?.stringValue ?? model.feed?.generatedAt, tz: tz) +
                " \u{00B7} updated " + Format.age(model.feed?.generatedAt)))
            if let p = p {
                Panel { Text(p.summary).font(.subheadline.bold()).foregroundStyle(Theme.text) }
                ForEach(p.cards) { c in
                    CardBox {
                        Pill(text: c.statusText, color: statusColors(c.statusKind).0, border: statusColors(c.statusKind).1)
                        Text(c.label).font(.headline).foregroundStyle(Theme.text)
                        KeyValueRow(key: "Hazards", value: c.hazards)
                        KeyValueRow(key: "Reach", value: c.reach)
                        KeyValueRow(key: "What it lists", value: c.lists)
                        KeyValueRow(key: "If it reports nothing", value: c.absence)
                        KeyValueRow(key: "Can a forecast be made from it?", value: c.input)
                        Text(c.footer).font(.caption).foregroundStyle(Theme.muted)
                        if let ep = c.endpoint, let u = URL(string: ep) { SwiftUI.Link(ep, destination: u).font(.caption).foregroundStyle(Theme.link).lineLimit(2) }
                    }
                }
            } else if model.feed != nil {
                MessageCard(title: "We could not get the list of sources read this time, so this page cannot show them. This does not mean no sources were read.")
            }
            Panel("Source profiles") {
                FlowRow(spacing: 8) { ForEach(Copy.sourceProfiles, id: \.name) { RouteLink($0.name, value: Route.source($0.name)).buttonStyle(OutlinePillButtonStyle()) } }
            }
        }
    }
}

func statusColors(_ kind: String) -> (Color, Color) {
    switch kind {
    case "ok": return (Theme.ok, Theme.okBorder)
    case "warn": return (Theme.warn, Theme.warnBorder)
    case "bad": return (Theme.bad, Theme.badBorder)
    default: return (Theme.mutedPill, Theme.mutedPillBorder)
    }
}

/// Source detail (features.md section 10.2). An unknown name with no current
/// report says so (changelog C22).
struct SourceDetailView: View {
    @EnvironmentObject var model: AppModel
    let name: String
    @State var sort = SortPicker.initial("source_sortBy", Sorts.eventSorts)

    var body: some View {
        let p = Copy.sourceProfile(name)
        let es = Sorts.apply(Copy.sourceReports(name, in: model.live), sort)
        let latest = es.map { $0.time }.max()
        let missing = model.feed != nil && Copy.sourceNotFound(name, reports: es.count)
        ScreenScroll(title: missing ? "Source not found" : p.name) {
            if missing {
                VStack(alignment: .leading, spacing: 10) {
                    ScreenHeader(title: "Source not found", subtitle: Copy.sourceNotFoundText(name) + " See every source we read.")
                    RouteLink("See every source we read", value: Route.collection(.resources, query: nil)).buttonStyle(SecondaryButtonStyle())
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("notFound")
            } else {
                ScreenHeader(title: p.name, subtitle: p.cls)
                TrustNote()
                FeedBanner()
                StatGrid(items: [("Status", model.feed == nil ? model.figText("-") : Copy.sourceStatus(name, meta: model.meta, reports: es.count)),
                                 ("Current reports", model.fig(es.count)),
                                 ("Latest update", latest.map { Format.age(JSDate.iso($0)) } ?? "-"),
                                 ("Type", p.cls.components(separatedBy: " ").prefix(2).joined(separator: " "))])
                SourceProfilePanel(profile: p)
                Panel("Current reports from this source", trailing: AnyView(SortPicker(screen: "source_sortBy", keys: Sorts.eventSorts, selection: $sort))) {
                    if es.isEmpty { Text("No current reports from this source.").font(.footnote).foregroundStyle(Theme.muted) }
                    ForEach(es.prefix(20)) { e in RelatedRow(record: e, line: e.type + " \u{00B7} " + Format.placeOf(e, "Place not given")) }
                }
                Panel("Other sources") {
                    FlowRow(spacing: 8) { ForEach(Copy.sourceProfiles.filter { $0.name != p.name }, id: \.name) { RouteLink($0.name + " \u{2192}", value: Route.source($0.name)).buttonStyle(OutlinePillButtonStyle()) } }
                }
                Panel("How we treat sources") {
                    Text("We show each report as its source published it, with a link to the original. We never present our own forecasts as official reports, and we label saved copies.").font(.footnote).foregroundStyle(Theme.textSoft)
                }
            }
        }
        .toolbar { if !missing { ToolbarItem(placement: .topBarTrailing) { ShareButton(route: .source(p.name), title: p.name) } } }
    }
}

struct SourceProfilePanel: View {
    let profile: Copy.SourceProfile
    var body: some View {
        Panel("About this source") {
            KeyValueRow(key: "Name", value: profile.name)
            KeyValueRow(key: "Type of source", value: profile.cls)
            KeyValueRow(key: "What it covers", value: profile.coverage)
            KeyValueRow(key: "How we use it", value: profile.use)
            KeyValueRow(key: "How often we check it", value: profile.fresh)
            KeyValueRow(key: "Limits", value: profile.limits)
            if let u = URL(string: profile.url), !profile.url.isEmpty { SwiftUI.Link("Open the source\u{2019}s website \u{2197}", destination: u).buttonStyle(SecondaryButtonStyle()) }
        }
    }
}

/// Insights (features.md section 12).
struct InsightsView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        let bars = Screens.insightBars(model.live)
        let failed = model.status == .failed && model.feed == nil
        let obs = model.live.filter { !$0.forecast }
        ScreenScroll(title: "Insights") {
            ScreenHeader(eyebrow: "Patterns and background", title: "Insights", subtitle: Copy.insightsIntro)
            TrustNote()
            FeedBanner()
            StatGrid(items: [("Events and forecasts", failed ? "Unavailable" : (model.fig(model.live.count))),
                             ("Most reported hazard", failed ? "Unavailable" : (bars.first?.type ?? "-")),
                             ("Our forecasts", failed ? "Unavailable" : (model.fig(model.live.filter { $0.forecast }.count)))])
            if failed { Text("Our data could not be reached").font(.footnote).foregroundStyle(Theme.muted) }
            else if let b = bars.first { Text("\(b.count) event" + (b.count == 1 ? "" : "s") + " in the current data").font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(Copy.insightCards, id: \.title) { c in Panel(c.title) { Text(c.body).font(.footnote).foregroundStyle(Theme.textSoft) } }
            Panel("Hazards reported now") {
                if failed {
                    Text("Our data could not be reached, so we cannot show which hazards are being reported. We do not fill this panel with estimates.").font(.footnote).foregroundStyle(Theme.muted)
                } else if model.feed == nil {
                    Text(Copy.loading).font(.footnote).foregroundStyle(Theme.muted)
                } else if obs.isEmpty {
                    Text("Our sources are not reporting any hazards right now.").font(.footnote).foregroundStyle(Theme.muted)
                }
                ForEach(bars, id: \.type) { b in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(b.type).font(.subheadline.bold()).foregroundStyle(Theme.text)
                        GeometryReader { g in
                            RoundedRectangle(cornerRadius: 4).fill(Theme.green).frame(width: g.size.width * CGFloat(b.widthPct) / 100, height: 8)
                        }
                        .frame(height: 8)
                        .accessibilityHidden(true)
                        Text("\(b.count) event" + (b.count == 1 ? "" : "s") + " \u{00B7} \(b.countries) countries").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Panel("How to read this") { ForEach(Copy.howToRead, id: \.title) { KeyValueRow(key: $0.title, value: $0.body) } }
            Panel("Background notes") {
                ForEach(Copy.backgroundNotes, id: \.0) { n in
                    CardBox { Text(n.0).font(.subheadline.bold()).foregroundStyle(Theme.text); KeyValueRow(key: "Region", value: n.1); KeyValueRow(key: "What it means", value: n.2) }
                }
            }
        }
    }
}

/// How it works (static copy).
struct MethodologyView: View {
    var body: some View {
        ScreenScroll(title: "How it works", refreshable: false) {
            ScreenHeader(eyebrow: "Methodology", title: "How this site works", subtitle: Copy.methodologyIntro)
            ForEach(Copy.methodologySteps, id: \.title) { s in Panel(s.title) { Text(s.body).font(.footnote).foregroundStyle(Theme.textSoft) } }
            Panel("How we mark a forecast") { ForEach(Copy.markTable, id: \.title) { KeyValueRow(key: $0.title, value: $0.body) } }
            Text(Copy.distanceLimit).font(.footnote).foregroundStyle(Theme.textSoft)
            Panel("What we do not claim") { ForEach(Copy.doNotClaim, id: \.title) { KeyValueRow(key: $0.title, value: $0.body) } }
            Panel("Types of information") {
                ForEach(Copy.infoTypes, id: \.0) { t in KeyValueRow(key: t.0 + " \u{00B7} " + t.2, value: t.1) }
            }
            Text(Copy.methodologyClosing).font(.footnote).foregroundStyle(Theme.muted)
            FooterAgencies().clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// About, with the two live figures from `/api/events?summary=1`.
struct AboutView: View {
    @EnvironmentObject var model: AppModel
    @State var summary: JSONValue?
    @State var failed = false

    var body: some View {
        ScreenScroll(title: "About", refreshable: false) {
            ScreenHeader(eyebrow: "About this site", title: "Predict Natural Disasters", subtitle: Copy.aboutIntro)
            Panel("What we are trying to do") { Text(Copy.aboutAim).font(.footnote).foregroundStyle(Theme.textSoft) }
            StatGrid(items: [("Countries in the current data", failed ? "Unavailable" : (summary?["meta"]?["countryCount"]?.jsString ?? "-")),
                             ("Types of hazard in the current data", failed ? "Unavailable" : (summary?["meta"]?["hazardTypeCount"]?.jsString ?? "-"))])
            Panel("What we care about") { ForEach(Copy.aboutValues, id: \.title) { KeyValueRow(key: $0.title, value: $0.body) } }
            Panel("What is on this site") { ForEach(Copy.aboutSections, id: \.title) { KeyValueRow(key: $0.title, value: $0.body) } }
            Text(Copy.aboutDisclaimer).font(.footnote).foregroundStyle(Theme.muted)
            Text("Trust note").font(.headline).foregroundStyle(Theme.text)
            TrustNote()
            FooterAgencies().clipShape(RoundedRectangle(cornerRadius: 10))
            Text("Version " + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? PNDCore.version)).font(.caption).foregroundStyle(Theme.muted)
        }
        .task {
            do { summary = try await model.client.summary() } catch { failed = true }
        }
    }
}

/// Settings: time zone and alerts.
struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State var search = ""

    static let base = ["Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"]

    var zones: [String] {
        var out: [String] = []
        for z in [model.zoneID] + Self.base + TimeZone.knownTimeZoneIdentifiers.sorted() where !out.contains(z) { out.append(z) }
        return search.isEmpty ? out : out.filter { $0.lowercased().contains(search.lowercased()) }
    }

    var body: some View {
        List {
            Section {
                Text("Times are shown in this time zone, with the zone named. The default is this device\u{2019}s own time zone, as on the website.")
                    .font(.footnote).foregroundStyle(Theme.muted)
                Button("Use this device\u{2019}s time zone (\(TimeZone.current.identifier))") { model.zoneID = TimeZone.current.identifier }
                    .frame(minHeight: 44)
                TextField("Search time zones", text: $search).frame(minHeight: 44)
                ForEach(zones.prefix(80), id: \.self) { z in
                    Button {
                        model.zoneID = z
                    } label: {
                        HStack {
                            Text(z == "Asia/Kolkata" ? "IST \u{00B7} India" : z).foregroundStyle(Theme.text)
                            Spacer()
                            if z == model.zoneID { Image(systemName: "checkmark").foregroundStyle(Theme.green).accessibilityLabel("Selected") }
                        }
                        .frame(minHeight: 44)
                    }
                }
            } header: {
                Text("Time zone: " + model.zoneID + " (" + Format.tzLabel(model.zoneID) + ")")
            }
            Section("Alerts") {
                Toggle("Alerts for my places", isOn: Binding(get: { model.alertsEnabled }, set: { on in
                    if on {
                        Task {
                            if await NotificationService.shared.requestPermission() { model.alertsEnabled = true; model.reloadPlaces() }
                        }
                    } else { model.alertsEnabled = false; model.reloadPlaces() }
                }))
                .accessibilityIdentifier("alertsSwitch")
                Text(Copy.notificationsHonesty).font(.footnote).foregroundStyle(Theme.muted)
            }
            Section("About") {
                RouteLink("About this app", value: Route.about)
                RouteLink("How it works", value: Route.methodology)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Settings")
        .accessibilityIdentifier("settingsScreen")
    }
}

/// ND-001 forecast check (features.md section 14, changelog C11): the stats
/// and all eight rows of "Forecast compared with what happened".
struct VerificationDetailView: View {
    @EnvironmentObject var model: AppModel
    var id = "ND-001"
    @State var result: String?
    @State var sort = SortPicker.initial("verification-detail_sortBy", Sorts.eventSorts)

    var body: some View {
        let tz = model.zoneID
        let r = ForecastCheck.build(model.all, id: id, tz: tz)
        let matches = Sorts.apply(r.matches, sort)
        let loaded = model.feed != nil
        ScreenScroll(title: "Forecast check") {
            ScreenHeader(eyebrow: "Forecast check", title: r.title, subtitle: "What we forecast, what was reported and how we decide the result.")
            TrustNote(groups: [.feed, .models])
            StatGrid(items: [("ID", id), ("Result", result ?? "-"), ("Starts", loaded ? r.kTarget : "-"), ("Lasts", loaded ? r.kWindow : "-"),
                             ("Matching reports", loaded ? r.kEvidence : "-")])
            Panel("The forecast, as recorded", trailing: AnyView(RouteLink("How we check forecasts \u{2192}", value: Route.verification).font(.caption))) {
                ForEach(Copy.nd001Terms, id: \.0) { KeyValueRow(key: $0.0, value: $0.1) }
            }
            Panel("Forecast compared with what happened") {
                Text(model.status == .failed ? ForecastCheck.loadError : (loaded ? Format.statusText(model.meta) + " \u{00B7} " + Format.fmtDate(model.feed?.generatedAt, tz: tz) : Copy.loading))
                    .font(.caption).foregroundStyle(Theme.muted)
                if loaded {
                    ForEach(Array(r.rows.enumerated()), id: \.offset) { i, row in CompareRowView(index: i, row: row) }
                }
                Text(ForecastCheck.footnote).font(.footnote).foregroundStyle(Theme.muted)
            }
            Panel("Matching reports", trailing: AnyView(RouteLink("Forecast details \u{2192}", value: Route.forecast("ND-001")).font(.caption))) {
                SortPicker(screen: "verification-detail_sortBy", keys: Sorts.eventSorts, selection: $sort)
                if loaded && matches.isEmpty { MessageCard(title: ForecastCheck.noMatches) }
                LimitedList(items: matches, page: 20) { EventCard(record: $0) }
            }
            Panel("Rules we follow") { ForEach(Copy.nd001Rules, id: \.self) { Text($0).font(.footnote).foregroundStyle(Theme.textSoft) } }
        }
        .task {
            do {
                let v = try await model.client.dataFile("verification-ledger.json")
                result = Verdicts.checkResult(id: id, ledger: v, requestFailed: false)
            } catch APIError.http(_) {
                result = Verdicts.checkResult(id: id, ledger: nil, requestFailed: false)
            } catch {
                result = Verdicts.checkResult(id: id, ledger: nil, requestFailed: true)
            }
        }
    }
}

/// One row of the comparison: metric, what we forecast, what was reported.
struct CompareRowView: View {
    let index: Int
    let row: ForecastCheck.Row
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.metric).font(.subheadline.bold()).foregroundStyle(Theme.text)
            KeyValueRow(key: "Forecast", value: row.forecast, muted: row.forecast == ForecastCheck.notForecast)
            KeyValueRow(key: "Actual", value: row.actual, muted: row.actual == ForecastCheck.notReported)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#08211A"), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.divider, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("compareRow-\(index)")
    }
}
