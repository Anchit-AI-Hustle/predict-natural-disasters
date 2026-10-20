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
                .buttonStyle(.plain)
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
    @State var sort = SortPicker.initial("home_sortBy", Sorts.eventSorts)
    @State var mapHazard = ""

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
        let k = Screens.homeKPIs(model.live)
        let loaded = model.feed != nil
        return VStack(alignment: .leading, spacing: 8) {
            Text("Around the world now").font(.title3.bold()).foregroundStyle(Theme.text)
            Text("What our sources are reporting right now.").font(.footnote).foregroundStyle(Theme.muted)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                kpi(loaded ? "\(k.liveEvents)" : "-", "Live events", k.liveSub, .collection(.events, query: nil))
                kpi(loaded ? "\(k.warnings)" : "-", "Official warnings", "Red or orange level", .collection(.officialWarnings, query: nil))
                kpi(loaded ? "\(k.openForecasts)" : "-", "Open forecasts", k.forecastSub, .collection(.forecastList, query: nil))
                kpi(loaded ? "\(k.countries)" : "-", "Countries", "Named in live reports", .regions)
                VStack(alignment: .leading, spacing: 4) {
                    Text(Copy.quoteTitle).font(.subheadline.bold()).foregroundStyle(Theme.text)
                    Text(Copy.quoteSub).font(.caption).foregroundStyle(Theme.muted)
                }
                .padding(10).frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
                .background(Color(hex: "#072B20"), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    func kpi(_ value: String, _ label: String, _ sub: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
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
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("kpi-" + label)
    }

    var utilities: some View {
        Panel("Keep watch over the places that matter to you") {
            Text("Save your places, see dangers near them, follow official advice and see how our forecasts turned out.")
                .font(.footnote).foregroundStyle(Theme.muted)
            let routes: [Route] = [.myPlaces, .collection(.events, query: nil), .forecasts, .trackRecord]
            let icons = ["\u{2316}", "!", "\u{25C9}", "\u{2713}"]
            ForEach(Array(Copy.utilities.enumerated()), id: \.offset) { i, u in
                NavigationLink(value: routes[i]) {
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
                .buttonStyle(.plain)
            }
        }
    }

    var explore: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Explore").font(.headline).foregroundStyle(Theme.text)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(Copy.regionsExplore, id: \.self) { r in
                        NavigationLink(r == "World" ? "Whole world" : r, value: Route.region(r)).buttonStyle(OutlinePillButtonStyle())
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    NavigationLink("My places", value: Route.myPlaces).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Risk map", value: Route.map).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Alerts and notifications", value: Route.collection(.alertsNotifications, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Forecast calendar", value: Route.collection(.forecastCalendar, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Past events", value: Route.collection(.historicalEvents, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Compare places", value: Route.collection(.compareLocations, query: nil)).buttonStyle(OutlinePillButtonStyle())
                    NavigationLink("Safety guides", value: Route.collection(.resources, query: nil)).buttonStyle(OutlinePillButtonStyle())
                }
            }
        }
    }

    // MARK: map and tables

    var mapAndLists: some View {
        let filtered = Sorts.apply(model.live.filter { mapHazard.isEmpty || $0.type.lowercased().contains(mapHazard.lowercased()) }, sort)
        let top5 = Array(Sorts.apply(model.live, "severity").prefix(5))
        let forecasts = Array(filtered.filter { $0.forecast && !$0.windowClosed }.prefix(6))
        let events = Array(filtered.filter { !$0.forecast }.prefix(5))
        let warnings = Array(filtered.filter { $0.isOfficial && $0.isRedOrOrange }.prefix(5))
        let tz = model.zoneID
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                MenuPicker(label: "Filter the map by hazard", selection: $mapHazard,
                           options: [("", "All hazards")] + Copy.homeHazards.map { ($0, $0) })
                SortPicker(screen: "home_sortBy", keys: Sorts.eventSorts, selection: $sort)
            }
            MapCard(records: filtered, height: 260) { model.push(Route.detail(for: $0)) }
            Panel("Most serious live events", trailing: AnyView(NavigationLink("View all \u{2192}", value: Route.collection(.events, query: nil)).font(.caption))) {
                if top5.isEmpty { Text(model.status == .failed ? Copy.loadError : Copy.loading).font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(Array(top5.enumerated()), id: \.offset) { i, e in
                    NavigationLink(value: Route.detail(for: e)) {
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(i + 1)").font(.headline.monospacedDigit()).foregroundStyle(Theme.green).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Format.titleOf(e)).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                                Text(e.type + " \u{00B7} " + Format.placeOf(e, "Global")).font(.caption).foregroundStyle(Theme.muted)
                                Text("Updated " + Format.fmtDate(e.updated, tz: tz)).font(.caption2).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            RecordRiskBadge(record: e)
                        }
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
            }
            Panel("Live events by type") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                    ForEach(Screens.hazardStrip(model.live), id: \.type) { t in
                        NavigationLink(value: Route.hazard(type: t.type, region: nil)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.type).font(.subheadline.bold()).foregroundStyle(Theme.text)
                                Text("\(t.count) tracked" + (t.observedOnly ? " \u{00B7} observed only" : "")).font(.caption).foregroundStyle(Theme.muted)
                            }
                            .padding(8).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .background(Theme.cardAlt, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(t.observedOnly ? "Observed only - no agency forecasts the onset of this hazard" : "")
                    }
                }
            }
            Panel("Latest forecasts", trailing: AnyView(NavigationLink("View all \u{2192}", value: Route.collection(.forecastList, query: nil)).font(.caption))) {
                if forecasts.isEmpty { Text("No open forecasts right now.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(forecasts) { e in
                    tableRow(e, [("Starts", Format.fmtWhen(e.first("targetStart", "updated")?.jsString, nil, nil, tz: tz)),
                                 ("Location", Format.placeOf(e, "Global")), ("Hazard", e.type)])
                }
            }
            Panel("Latest events", trailing: AnyView(NavigationLink("View all \u{2192}", value: Route.collection(.events, query: nil)).font(.caption))) {
                ForEach(events) { e in
                    tableRow(e, [("Time", Format.fmtDate(e.updated, tz: tz)), ("Location", Format.placeOf(e, "Global")),
                                 ("Event", Format.titleOf(e)), ("Source", Format.shortSource(e.source))])
                }
            }
            Panel("Official Warnings", trailing: AnyView(NavigationLink("View all \u{2192}", value: Route.collection(.officialWarnings, query: nil)).font(.caption))) {
                if warnings.isEmpty { Text("No red or orange official warning right now.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(warnings) { e in
                    let ends = e.first("expiresAt", "expectedEnd")?.jsString
                    tableRow(e, [("Agency", Format.shortSource(e.source)), ("Location", Format.placeOf(e, "Global")),
                                 ("Warning", Format.titleOf(e)), ("Ends", ends.map { Format.fmtDate($0, tz: tz) } ?? "Not stated")])
                }
            }
        }
    }

    func tableRow(_ e: Record, _ cells: [(String, String)]) -> some View {
        NavigationLink(value: Route.detail(for: e)) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                    HStack(alignment: .firstTextBaseline) {
                        Text(c.0.uppercased()).font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 80, alignment: .leading)
                        Text(c.1).font(.footnote).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                }
                HStack { Text("RISK").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 80, alignment: .leading); RecordRiskBadge(record: e) }
            }
            .padding(8)
            .background(Color(hex: "#08211A"), in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    var trackTeaser: some View {
        Panel("Track record", trailing: AnyView(NavigationLink("View all \u{2192}", value: Route.trackRecord).font(.caption))) {
            NavigationLink(value: Route.forecast("ND-001")) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(Copy.nd001Title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                    Text(Copy.nd001Teaser).font(.caption).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                    VerdictPill(text: "PARTLY CORRECT", css: "partial")
                }
            }
            .buttonStyle(.plain)
            Text("What we check").font(.caption.bold()).foregroundStyle(Theme.label)
            Text(Copy.whatWeCheck).font(.footnote).foregroundStyle(Theme.text)
            Text("How we check forecasts").font(.caption.bold()).foregroundStyle(Theme.label)
            Text(Copy.howWeCheck).font(.footnote).foregroundStyle(Theme.text)
            NavigationLink("See details \u{2192}", value: Route.verification).font(.footnote)
        }
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
        let a = PlaceRisk.assess(place, model.live, generatedAt: model.feed?.generatedAt)
        let acts = PlaceRisk.actionsFor(a)
        let lead = a.lead?.event
        let tz = model.zoneID
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "Current risk")
            HStack(alignment: .center, spacing: 8) {
                if let l = a.level { RiskBadge(level: l) } else { NothingNearbyChip() }
                Text(place.name).font(.headline).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityIdentifier("placeResultHeader")
            block("What\u{2019}s happening") {
                if let e = lead {
                    Text(Format.titleOf(e)).font(.subheadline.bold()).foregroundStyle(Color(hex: "#DCECE4"))
                    Text(e.type + " \u{00B7} " + Format.placeOf(e, "Place not given") + " \u{00B7} reported " + Format.age(e.updated))
                        .font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
                } else {
                    Text("None of our sources reports anything at this place right now.").font(.subheadline).foregroundStyle(Color(hex: "#DCECE4"))
                }
            }
            block("Why we\u{2019}re showing this") { Text(a.why).font(.subheadline).foregroundStyle(Color(hex: "#DCECE4")).accessibilityIdentifier("placeWhy") }
            block("What should I do?") {
                ForEach(acts.steps, id: \.self) { s in
                    HStack(alignment: .top, spacing: 6) { Text("\u{2022}"); Text(s) }.font(.subheadline).foregroundStyle(Color(hex: "#DCECE4"))
                }
                Text(acts.authority).font(.subheadline).foregroundStyle(Theme.authority)
            }
            block("Source") {
                if let e = lead {
                    Text(Format.provenance(e) + " \u{00B7} " + e.source).font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
                    if let u = e.sourceURL { Link("Open the original report \u{2192}", destination: u).font(.footnote).foregroundStyle(Theme.link) }
                } else {
                    Text("No report was used for this answer.").font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
                }
            }
            block("Last checked") {
                Text(model.feed?.generatedAt.map { Format.fmtDate($0, tz: tz) + " \u{00B7} " + Format.age($0) } ?? "not yet: the data is still loading")
                    .font(.footnote).foregroundStyle(Color(hex: "#DCECE4"))
            }
            FlowRow(spacing: 8) {
                Button("Save place") { save() }.buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("savePlace")
                Button("Alert me if this changes") { alertMe() }.buttonStyle(SecondaryButtonStyle())
                if let e = lead {
                    NavigationLink("See details", value: Route.detail(for: e)).buttonStyle(SecondaryButtonStyle())
                } else {
                    NavigationLink("See details", value: Route.myPlaces).buttonStyle(SecondaryButtonStyle())
                }
            }
            if let n = saveNote { Text(n).font(.footnote).foregroundStyle(Theme.greenText).accessibilityIdentifier("saveNote") }
        }
        .padding(14)
        .background(Theme.panelTop, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.panelBorder, lineWidth: 1))
        .accessibilityIdentifier("placeResult")
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
