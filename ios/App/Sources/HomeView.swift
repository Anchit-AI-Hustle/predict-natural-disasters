import SwiftUI
import PNDCore

/// The place chooser shared by Home, My places and Regions (design.md 4.10).
struct PlaceChooser: View {
    let candidates: [Place]
    let onPick: (Place) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(PlaceSearch.chooserHeading).font(.subheadline.bold()).foregroundStyle(Color(hex: "#D9EFE6"))
            ForEach(Array(candidates.enumerated()), id: \.offset) { _, c in
                Button { onPick(c) } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(c.name).font(.subheadline.bold()).foregroundStyle(Color(hex: "#EAFFF6")).multilineTextAlignment(.leading)
                            Spacer(minLength: 6)
                            Pill(text: c.level ?? "Place", color: Color(hex: "#9FE9C8"), border: Color(hex: "#2D7A5D"))
                        }
                        if let f = c.full, f != c.name {
                            Text(f).font(.caption).foregroundStyle(Color(hex: "#9DB9AD")).multilineTextAlignment(.leading)
                        }
                    }
                    .padding(.vertical, 9).padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .background(Theme.panelTop, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.panelBorder, lineWidth: 1))
                }
                .buttonStyle(.plainArea)
                .accessibilityIdentifier("placeCandidate")
            }
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @StateObject var location = LocationService()
    @State var query = ""
    @State var searching = false
    @State var note: String?
    @State var candidates: [Place] = []
    @State var checked: Place?
    @State var autoAnswered = false
    @State var sort = SortPicker.initial(Home.sortScreen, Home.sortKeys)
    @State var mapHazard = ""
    @State var mapQuery = ""
    @State var nudge: Screens.MapNudge?
    @State var selectedID: String?
    @State var focusID: String?

    var body: some View {
        ScreenScroll(title: "Predict Natural Disasters") {
            hero
            TrustNote(groups: [.feed, .models, .place])
            FeedBanner()
            if !candidates.isEmpty { PlaceChooser(candidates: candidates) { answer($0, note: nil); candidates = [] } }
            if let p = checked { PlaceResultCard(place: p) }
            kpis
            utilities
            explore
            mapAndLists
            trackTeaser
            Text(Copy.homeFooter).font(.footnote).foregroundStyle(Theme.muted)
            FooterAgencies().clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .onAppear(perform: autoAnswer)
        .onChange(of: model.places) { _, _ in autoAnswer() }
    }

    // MARK: hero

    var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScreenHeader(title: Copy.heroTitle, subtitle: Copy.heroSub)
            HStack(spacing: 8) {
                SearchField(prompt: "Search city, area or address", text: $query, onSubmit: search)
                    .accessibilityIdentifier("homeSearch")
                Button(action: search) { Text("Check risk") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(searching)
                    .opacity(searching ? 0.6 : 1)
                    .accessibilityIdentifier("checkRisk")
            }
            HStack {
                Button("\u{2316} Use my location") { useLocation() }
                    .buttonStyle(OutlinePillButtonStyle())
                    .accessibilityIdentifier("useMyLocation")
                Spacer()
            }
            if !model.places.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(model.places.prefix(4)) { p in
                            Button(p.kind + " \u{00B7} " + p.name) { answer(p, note: nil) }.buttonStyle(OutlinePillButtonStyle())
                        }
                    }
                }
            }
            if let n = note {
                Text(n).font(.subheadline).foregroundStyle(Theme.textSoft).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("homeNote")
            }
        }
    }

    func search() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        candidates = []
        guard !q.isEmpty else { note = PlaceSearch.emptyQuery; return }
        searching = true
        note = PlaceSearch.finding
        Task {
            defer { searching = false }
            do {
                let found = try await model.client.searchPlaces(q)
                if found.isEmpty { note = PlaceSearch.notFound }
                else if found.count == 1 { answer(found[0], note: nil) }
                else { note = PlaceSearch.foundMany(found.count); candidates = found }
            } catch {
                note = PlaceSearch.failedHome
            }
        }
    }

    func useLocation() {
        Task {
            do {
                let c = try await location.current()
                let country = model.locator?.country(lat: c.latitude, lon: c.longitude) ?? ""
                let p = Place(kind: "My location", name: "Your current location", lat: c.latitude, lon: c.longitude, country: country, countryCode: "")
                answer(p, note: country.isEmpty
                    ? "Checked at your current position. We could not tell which country it is in, so forecasts that cover a whole country are not included. Search for the place by name to include them."
                    : "Checked at your current position, in \(country). Save it to see it here each time you come back.")
            } catch {
                note = "Location was not shared, so nothing was checked."
            }
        }
    }

    func answer(_ p: Place, note n: String?) {
        checked = p
        note = n
    }

    func autoAnswer() {
        guard !autoAnswered, checked == nil, let p = model.placesStore.arrivalPlace else { return }
        autoAnswered = true
        checked = p
        note = p.id == Place.currentID ? "Showing your current location. Search above to check anywhere else."
            : "Showing your saved place \u{201C}\(p.name)\u{201D}. Search above to check anywhere else."
    }

    // MARK: KPIs

    var kpis: some View {
        let r = Home.render(model.live, hazardFilter: mapHazard, sort: sort)
        let loaded = model.feed != nil
        let down = model.feedDown
        let unavailable = "Live data unavailable"
        return VStack(alignment: .leading, spacing: 8) {
            Text("Around the world now").font(.title3.bold()).foregroundStyle(Theme.text)
            Text("What our sources are reporting right now.").font(.footnote).foregroundStyle(Theme.muted)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                kpi(loaded ? "\(r.kEvents)" : "-", "Live events", down ? unavailable : r.kEventsNote, .collection(.events, query: nil))
                kpi(loaded ? "\(r.kWarnings)" : "-", "Official warnings", down ? unavailable : Home.warningsTileNote,
                    .collection(.officialWarnings, query: nil), hint: Format.warningMeaning)
                kpi(loaded ? "\(r.kForecasts)" : "-", "Open forecasts", down ? unavailable : r.kForecastsNote, .collection(.forecastList, query: nil))
                kpi(loaded ? "\(r.kCountries)" : "-", "Countries", down ? unavailable : "Named in live reports", .regions)
                QuoteTile()
            }
        }
    }

    func kpi(_ value: String, _ label: String, _ sub: String, _ route: Route, hint: String = "") -> some View {
        RouteLink(value: route) {
            VStack(alignment: .leading, spacing: 3) {
                if model.status == .loading && model.feed == nil {
                    ShimmerBar()
                } else {
                    Text(value).font(.title2.bold().monospacedDigit()).foregroundStyle(Theme.text)
                }
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.text)
                Text(sub).font(.caption2).foregroundStyle(Color(hex: "#87AA9B")).multilineTextAlignment(.leading)
            }
            .padding(10).frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
            .background(Color(hex: "#072B20"), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#176148"), lineWidth: 1))
        }
        .buttonStyle(.plainArea)
        .accessibilityElement(children: .combine)
        .accessibilityHint(hint)
        .accessibilityIdentifier("kpi-" + label)
    }

    var utilities: some View {
        Panel("Keep watch over the places that matter to you") {
            Text("Save your places, see dangers near them, follow official advice and see how our forecasts turned out.")
                .font(.footnote).foregroundStyle(Theme.muted)
            let routes: [Route] = [.myPlaces, .collection(.events, query: nil), .forecasts, .trackRecord]
            let icons = ["\u{2316}", "!", "\u{25C9}", "\u{2713}"]
            ForEach(Array(Copy.utilities.enumerated()), id: \.offset) { i, u in
                RouteLink(value: routes[i]) {
                    HStack(alignment: .top, spacing: 10) {
                        Text(icons[i]).font(.title3.bold()).foregroundStyle(Theme.green).frame(width: 24).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.title).font(.subheadline.bold()).foregroundStyle(Theme.text)
                            Text(u.body).font(.caption).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                        }
                        Spacer()
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plainArea)
            }
        }
    }

    var explore: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Explore").font(.headline).foregroundStyle(Theme.text)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(Copy.regionsExplore, id: \.self) { r in
                        RouteLink(r == "World" ? "Whole world" : r, value: Route.region(r)).buttonStyle(OutlinePillButtonStyle())
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    RouteLink("My places", value: Route.myPlaces).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Risk map", value: Route.map).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Alerts and notifications", value: Route.collection(.alertsNotifications, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Forecast calendar", value: Route.collection(.forecastCalendar, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Past events", value: Route.collection(.historicalEvents, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Compare places", value: Route.collection(.compareLocations, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    RouteLink("Safety guides", value: Route.collection(.resources, query: nil)).buttonStyle(OutlinePillButtonStyle())
                }
            }
        }
    }

    // MARK: map and tables (features.md section 1.6)

    var mapAndLists: some View {
        let r = Home.render(model.live, hazardFilter: mapHazard, sort: sort)
        let tz = model.zoneID
        let down = model.feedDown
        return VStack(alignment: .leading, spacing: 12) {
            SearchField(prompt: "Search location", text: $mapQuery, onSubmit: mapSearch).accessibilityIdentifier("mapSearch")
            HStack {
                MenuPicker(label: "Filter the map by hazard", selection: $mapHazard,
                           options: Format.hazardOptions(model.live, selected: mapHazard).map { ($0.value, $0.label) })
                Spacer()
            }
            MapCard(records: r.list, height: 260) { model.push(Route.detail(for: $0)) }
                .picking(selected: selectedID, focus: focusID) { e in select(e) }
            if let n = nudge { MapNudgeCard(nudge: n) }
            liveEventsPanel(r, down: down, tz: tz)
            stripPanel(r, down: down)
            forecastsPanel(r, down: down, tz: tz)
            latestPanel(r, down: down, tz: tz)
            warningsPanel(r, down: down, tz: tz)
        }
    }

    /// A marker tap: the selected-event card, no fly-to (changelog C12).
    func select(_ e: Record) {
        selectedID = e.id
        nudge = Screens.selectedNudge(e)
    }

    /// The map search: an empty box does nothing; a hit is selected and the
    /// map moves to it; a miss clears the selection and says so.
    func mapSearch() {
        guard let n = Screens.homeMapSearch(model.live, query: mapQuery) else { return }
        nudge = n
        if let e = n.record {
            selectedID = e.id
            focusID = e.id
        } else {
            selectedID = nil
        }
    }

    func liveEventsPanel(_ r: Home.Render, down: Bool, tz: String) -> some View {
        Panel(Home.liveEventsHeading, trailing: AnyView(RouteLink("View all \u{2192}", value: Route.collection(.events, query: nil)).font(.caption))) {
            SortPicker(screen: Home.sortScreen, keys: Home.sortKeys, selection: $sort)
            if down {
                UnavailableCard()
            } else if model.feed == nil {
                Text(Copy.loading).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(Array(r.liveEvents.enumerated()), id: \.offset) { i, e in
                LiveEventRow(index: i + 1, record: e, selected: e.id == selectedID, tz: tz)
            }
        }
    }

    func stripPanel(_ r: Home.Render, down: Bool) -> some View {
        Panel("Live events by type") {
            if down { Text(Copy.loadError).font(.footnote).foregroundStyle(Theme.muted) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(r.hazardStrip, id: \.type) { t in HazardStripTile(tile: t) }
            }
        }
    }

    func forecastsPanel(_ r: Home.Render, down: Bool, tz: String) -> some View {
        Panel("Latest forecasts", trailing: AnyView(RouteLink("View all \u{2192}", value: Route.collection(.forecastList, query: nil)).font(.caption))) {
            if down {
                Text(Copy.loadError).font(.footnote).foregroundStyle(Theme.muted)
            } else if model.feed != nil && r.latestForecasts.isEmpty {
                Text(Home.noForecasts).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(r.latestForecasts) { e in
                HomeTableRow(record: e, labels: ["Starts", "Location", "Hazard"], cells: Array(Home.forecastCells(e, tz: tz).prefix(3)), showRisk: true)
            }
        }
    }

    func latestPanel(_ r: Home.Render, down: Bool, tz: String) -> some View {
        Panel("Latest events", trailing: AnyView(RouteLink("View all \u{2192}", value: Route.collection(.events, query: nil)).font(.caption))) {
            if down { Text(Copy.loadError).font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(r.latestEvents) { e in
                HomeTableRow(record: e, labels: ["Time", "Location", "Event", "Source"], cells: Home.latestEventCells(e, tz: tz), showRisk: false)
            }
        }
    }

    func warningsPanel(_ r: Home.Render, down: Bool, tz: String) -> some View {
        Panel("Official Warnings", trailing: AnyView(RouteLink("View all \u{2192}", value: Route.collection(.officialWarnings, query: nil)).font(.caption))) {
            if down {
                Text(Copy.loadError).font(.footnote).foregroundStyle(Theme.muted)
            } else if model.feed != nil && r.officialWarnings.isEmpty {
                Text(Home.noWarnings).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(r.officialWarnings) { e in
                HomeTableRow(record: e, labels: ["Agency", "Location", "Warning", "Ends"], cells: Home.warningCells(e, tz: tz), showRisk: false)
            }
        }
    }

    var trackTeaser: some View {
        Panel("Track record", trailing: AnyView(RouteLink("View all \u{2192}", value: Route.trackRecord).font(.caption))) {
            RouteLink(value: Route.forecast("ND-001")) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(Copy.nd001Title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                    Text(Copy.nd001Teaser).font(.caption).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                    VerdictPill(text: "PARTLY CORRECT", css: "partial")
                }
            }
            .buttonStyle(.plainArea)
            Text("What we check").font(.caption.bold()).foregroundStyle(Theme.label)
            Text(Copy.whatWeCheck).font(.footnote).foregroundStyle(Theme.text)
            Text("How we check forecasts").font(.caption.bold()).foregroundStyle(Theme.label)
            Text(Copy.howWeCheck).font(.footnote).foregroundStyle(Theme.text)
            RouteLink("See details \u{2192}", value: Route.verification).font(.footnote)
        }
    }
}

/// The quote tile beside the figures.
struct QuoteTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Copy.quoteTitle).font(.subheadline.bold()).foregroundStyle(Theme.text)
            Text(Copy.quoteSub).font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(10).frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
        .background(Color(hex: "#072B20"), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// The card over the home map: the selected event, or what a search found.
struct MapNudgeCard: View {
    let nudge: Screens.MapNudge
    var body: some View {
        CardBox {
            Eyebrow(text: nudge.eyebrow)
            Text(nudge.title).font(.headline).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
            Text(nudge.meta).font(.footnote).foregroundStyle(Theme.textSoft).fixedSize(horizontal: false, vertical: true)
            if let e = nudge.record {
                RouteLink("See details \u{2192}", value: Route.detail(for: e)).buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("nudgeDetail")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mapNudge")
    }
}

/// One row of the "Live events" card.
struct LiveEventRow: View {
    let index: Int
    let record: Record
    let selected: Bool
    let tz: String
    var body: some View {
        RouteLink(value: Route.detail(for: record)) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(index)").font(.headline.monospacedDigit()).foregroundStyle(Theme.green).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(record.title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                    Text(record.type + " \u{00B7} " + Format.placeOf(record, "Global")).font(.caption).foregroundStyle(Theme.muted)
                    Text("Updated " + Format.fmtDate(record.updated, tz: tz)).font(.caption2).foregroundStyle(Theme.muted)
                }
                Spacer()
                RecordRiskBadge(record: record)
            }
            .frame(minHeight: 44)
            .padding(4)
            .background(selected ? Color(hex: "#0C3527") : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plainArea)
        .accessibilityIdentifier("liveEvent")
    }
}

/// A chip of the home hazard strip (changelog C13).
struct HazardStripTile: View {
    let tile: Screens.HazardTile
    var body: some View {
        RouteLink(value: Route.hazard(type: tile.type, region: nil)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(tile.icon + " " + tile.type).font(.subheadline.bold()).foregroundStyle(Theme.text)
                Text(tile.text).font(.caption).foregroundStyle(Theme.muted)
            }
            .padding(8).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Theme.cardAlt, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plainArea)
        .accessibilityHint(tile.observedOnly ? "Observed only - no agency forecasts the onset of this hazard" : "")
        .accessibilityIdentifier("hazardChip")
    }
}

/// One row of the home tables, as labelled cells.
struct HomeTableRow: View {
    let record: Record
    let labels: [String]
    let cells: [String]
    let showRisk: Bool
    var body: some View {
        RouteLink(value: Route.detail(for: record)) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(zip(labels, cells).enumerated()), id: \.offset) { _, c in
                    HStack(alignment: .firstTextBaseline) {
                        Text(c.0.uppercased()).font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 80, alignment: .leading)
                        Text(c.1).font(.footnote).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                }
                if showRisk {
                    HStack {
                        Text("RISK").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 80, alignment: .leading)
                        RecordRiskBadge(record: record)
                    }
                }
            }
            .padding(8)
            .background(Color(hex: "#08211A"), in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.divider, lineWidth: 1))
        }
        .buttonStyle(.plainArea)
    }
}

/// The place answer's badge: a level, "Nothing reported nearby" once the
/// feed has loaded, or "Checking…" / "Live data unavailable" before it.
struct AnswerBadge: View {
    let card: PlaceRisk.AnswerCard
    var body: some View {
        if let l = card.level {
            RiskBadge(level: l)
        } else if card.state == .loaded {
            NothingNearbyChip()
        } else {
            PendingChip(text: card.badge)
        }
    }
}

/// "Checking…" or "Live data unavailable": the unknown style, never a level.
struct PendingChip: View {
    let text: String
    var body: some View {
        RiskBadge(level: .unknown, text: text, accessibilityText: text)
            .accessibilityIdentifier("pendingChip")
    }
}

/// The KPI loading shimmer (stops with Reduce Motion).
struct ShimmerBar: View {
    @Environment(\.accessibilityReduceMotion) var reduce
    @State var phase = false
    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(LinearGradient(colors: [Color(hex: "#0C3326"), Color(hex: "#17563F"), Color(hex: "#0C3326")],
                                 startPoint: phase ? .trailing : .leading, endPoint: phase ? UnitPoint(x: 2, y: 0.5) : .trailing))
            .frame(width: 60, height: 22)
            .onAppear { if !reduce { withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { phase = true } } }
            .accessibilityLabel("Loading")
    }
}

/// The place result card (features.md section 1.2).
struct PlaceResultCard: View {
    @EnvironmentObject var model: AppModel
    let place: Place
    @State var saveNote: String?

    var body: some View {
        // Before the feed loads the answer is "Checking…" or "Live data
        // unavailable", never an all-clear (changelog C26). It answers again
        // by itself when the data arrives; a later failed refresh keeps it.
        let card = PlaceRisk.answerCard(place, events: model.live, state: model.placeFeedState,
                                        generatedAt: model.feed?.generatedAt, tz: model.zoneID)
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: card.eyebrow)
            HStack(alignment: .center, spacing: 8) {
                AnswerBadge(card: card)
                Text(place.name).font(.headline).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("placeResultHeader")
            block("What\u{2019}s happening") { happening(card) }
            if let why = card.why {
                block("Why we\u{2019}re showing this") { Text(why).font(.subheadline).foregroundStyle(Color(hex: "#DCECE4")).accessibilityIdentifier("placeWhy") }
            }
            block("What should I do?") {
                ForEach(card.steps, id: \.self) { s in
                    HStack(alignment: .top, spacing: 6) { Text("\u{2022}"); Text(s) }.font(.subheadline).foregroundStyle(Color(hex: "#DCECE4"))
                }
                Text(card.authority).font(.subheadline).foregroundStyle(Theme.authority)
            }
            if card.state == .loaded { block("Source") { source(card.lead) } }
            block("Last checked") {
                Text(card.lastChecked).font(.footnote).foregroundStyle(Color(hex: "#DCECE4")).accessibilityIdentifier("lastChecked")
            }
            FlowRow(spacing: 8) {
                Button("Save place") { save() }.buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("savePlace")
                Button("Alert me if this changes") { alertMe() }.buttonStyle(SecondaryButtonStyle())
                if let e = card.lead {
                    RouteLink("See details", value: Route.detail(for: e)).buttonStyle(SecondaryButtonStyle())
                } else {
                    RouteLink("See details", value: Route.myPlaces).buttonStyle(SecondaryButtonStyle())
                }
            }
            if let n = saveNote { Text(n).font(.footnote).foregroundStyle(Theme.greenText).accessibilityIdentifier("saveNote") }
        }
        .padding(14)
        .background(Theme.panelTop, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.panelBorder, lineWidth: 1))
        .accessibilityElement(children: .contain)
        // iOS has no aria-busy; a card still checking is marked as updating.
        .accessibilityAddTraits(card.busy ? .updatesFrequently : [])
        .accessibilityIdentifier("placeResult")
    }

    @ViewBuilder func happening(_ card: PlaceRisk.AnswerCard) -> some View {
        if card.unavailableCard {
            UnavailableCard()
        } else if let t = card.leadTitle {
            Text(t).font(.subheadline.bold()).foregroundStyle(Color(hex: "#DCECE4"))
            Text(card.leadLine ?? "").font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
        } else {
            Text(card.happeningText ?? "").font(.subheadline).foregroundStyle(Color(hex: "#DCECE4"))
        }
    }

    @ViewBuilder func source(_ lead: Record?) -> some View {
        if let e = lead {
            Text(Format.provenance(e) + " \u{00B7} " + (e.source.isEmpty ? "Source not stated" : e.source)).font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
            if let u = e.sourceURL { Link("Open the original report \u{2192}", destination: u).font(.footnote).foregroundStyle(Theme.link) }
        } else {
            Text("No report was used for this answer.").font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
        }
    }

    func block<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption2.weight(.heavy)).tracking(0.9).foregroundStyle(Theme.label).accessibilityAddTraits(.isHeader)
            c()
        }
    }

    func save() {
        let already = model.places.contains { $0.name == place.name && $0.lat == place.lat && $0.lon == place.lon }
        if !already {
            var p = place
            p.kind = place.kind == "Searched" ? "Place" : place.kind
            model.savePlace(p)
        }
        saveNote = "Saved. You can find it on the My places page."
    }

    func alertMe() {
        let already = model.places.contains { $0.name == place.name && $0.lat == place.lat && $0.lon == place.lon }
        if !already {
            var p = place
            p.kind = place.kind == "My location" ? "Current location" : (place.kind == "Searched" ? "Place" : place.kind)
            model.savePlace(p)
        }
        Task {
            let ok = await NotificationService.shared.requestPermission()
            if ok {
                model.alertsEnabled = true
                model.reloadPlaces()
                saveNote = "Saved, and alerts are on. This device checks for dangers at or near this place each time the app updates, and in the background when iOS allows. You can manage alerts on the My places page."
            } else {
                saveNote = "Notifications were not allowed, so nothing will be sent."
            }
        }
    }
}
