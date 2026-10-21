import SwiftUI
import CoreLocation
import PNDCore

/// Regions list (features.md section 8.1).
struct RegionsView: View {
    @EnvironmentObject var model: AppModel
    @State var query = ""
    @State var sort = SortPicker.initial("regions_sortBy", Sorts.regionSorts)
    @State var note: String?
    @State var candidates: [Place] = []

    var body: some View {
        let groups = Sorts.apply(Screens.regionGroups(model.live), sort)
        let mapList = model.live.filter { Search.matchesPlace($0, query) }
        let current = Format.observed(model.live)
        ScreenScroll(title: "Regions") {
            ScreenHeader(eyebrow: "By place", title: "Regions", subtitle: "Start with the whole world. Then choose a country, a city or a neighbourhood, and then an event.")
            TrustNote(groups: [.feed, .models, .place])
            FeedBanner()
            // COUNTRIES AND AREAS is the same count as every other screen (changelog C14).
            StatGrid(items: [("Current events", model.fig(current.count)), ("Countries and areas", model.fig(Format.countryCount(current))),
                             ("High alert", model.fig(current.filter { Format.isHighAlert($0) }.count)),
                             ("Sources working", model.figText(Format.sourcesRatio(model.meta))),
                             ("Updated", model.feedDown ? Format.unavailable : Format.age(model.feed?.generatedAt))])
            SearchField(prompt: "Search a country, region or city", text: $query)
            FlowRow(spacing: 8) {
                RouteLink("Open this place", value: Route.region(query.trimmingCharacters(in: .whitespaces).ifEmpty("World"))).buttonStyle(SecondaryButtonStyle())
                Button("Find a city or area", action: find).buttonStyle(SecondaryButtonStyle())
            }
            if let n = note { Text(n).font(.footnote).foregroundStyle(Theme.textSoft) }
            if !candidates.isEmpty {
                PlaceChooser(candidates: candidates) { c in
                    candidates = []
                    if c.level == "Country" { model.push(.region(c.country.ifEmpty(c.name))) }
                    else { model.push(.location(name: c.name, lat: c.lat, lon: c.lon, level: c.level, country: c.country, cc: c.countryCode)) }
                }
            }
            MapCard(records: Array(mapList.prefix(250)), height: 260) { model.push(Route.detail(for: $0)) }
            Panel("Places with current events", trailing: AnyView(SortPicker(screen: "regions_sortBy", keys: Sorts.regionSorts, selection: $sort))) {
                Text("Select a place to see its own page").font(.footnote).foregroundStyle(Theme.muted)
                if groups.isEmpty && model.feed != nil { Text("No current events here. Our sources have no current report for this place. This does not mean there is no danger.").font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(groups.prefix(40)) { g in
                    let lines = Screens.regionGroupLines(g)
                    RouteLink(value: Route.region(g.s("name"))) {
                        CardBox {
                            Text(g.s("name")).font(.headline).foregroundStyle(Theme.text)
                            Text(lines.0).font(.footnote).foregroundStyle(Theme.textSoft)
                            Text(lines.1).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                    .buttonStyle(.plainArea)
                }
            }
            Panel("Popular places") {
                ForEach(Copy.popularPlaces, id: \.title) { p in
                    RouteLink(value: Route.region(p.title)) {
                        HStack { Text(p.title).font(.subheadline.bold()).foregroundStyle(Theme.text); Spacer(); Text(p.body).font(.caption).foregroundStyle(Theme.muted) }
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plainArea)
                }
            }
            Panel("What we show") { ForEach(Copy.regionsWhatWeShow, id: \.self) { Text($0).font(.footnote).foregroundStyle(Theme.textSoft) } }
        }
    }

    func find() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { note = PlaceSearch.emptyQuery; return }
        note = PlaceSearch.finding
        Task {
            do {
                let found = try await model.client.searchPlaces(q)
                if found.isEmpty { note = PlaceSearch.notFound } else { note = PlaceSearch.foundMany(found.count); candidates = found }
            } catch { note = PlaceSearch.failedPlaces }
        }
    }
}

/// Region detail (features.md section 8.2). A continent is the countries on
/// it (changelog C1); the list holds reports only (changelog C14).
struct RegionDetailView: View {
    @EnvironmentObject var model: AppModel
    let region: String
    @State var sort = SortPicker.initial("region_sortBy", Sorts.eventSorts)

    var body: some View {
        let matcher = Screens.regionMatcher(region.isEmpty ? "World" : region)
        let name = matcher.region
        let world = name == "World"
        let continent = Continents.continentNamed(name)
        let current = Sorts.apply(Format.observed(model.live).filter(matcher.matches), sort)
        let down = model.feedDown
        let first = current.first
        ScreenScroll(title: name) {
            ScreenHeader(eyebrow: "Region", title: world ? "Disasters around the world" : "Disasters in \(name)",
                         subtitle: "Current events and alerts for " + (world ? "the whole world" : name) + ".")
            TrustNote()
            FeedBanner()
            StatGrid(items: [("Current events", model.fig(current.count)),
                             ("High alert", model.fig(current.filter { Format.isHighAlert($0) }.count)),
                             ("Types of hazard", model.fig(Set(current.map { $0.type }).count)),
                             ("Sources reporting here", model.fig(Format.sourcesReporting(current))),
                             ("Last checked", down ? Format.unavailable : Format.age(model.feed?.generatedAt))])
            RefreshRow(status: model.statusLine())
            MapCard(records: Array(current.prefix(250)), height: 260, fitToRecords: !world) { model.push(Route.detail(for: $0)) }
            Panel("Current events here", trailing: AnyView(SortPicker(screen: "region_sortBy", keys: Sorts.eventSorts, selection: $sort))) {
                if down {
                    UnavailableCard()
                } else if current.isEmpty && model.feed != nil {
                    Text("No current events here. Our sources have no current report for this place. This does not mean there is no danger.").font(.footnote).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("regionEmpty")
                }
                LimitedList(items: current, page: 20) { EventCard(record: $0) }
                RouteLink("See all events \u{2192}", value: Route.scopedCollection(.events, query: nil, region: name)).font(.footnote)
                    .accessibilityIdentifier("allEventsLink")
            }
            Panel("Types of hazard") {
                ForEach(down ? [] : Screens.typeCounts(current), id: \.type) { t in
                    RouteLink(value: Route.hazard(type: t.type, region: world ? nil : name)) {
                        HStack { Text(t.type).foregroundStyle(Theme.text); Spacer(); Text("\(t.count)").foregroundStyle(Theme.muted) }.font(.subheadline).frame(minHeight: 44)
                    }
                    .buttonStyle(.plainArea)
                }
            }
            Panel("What we cover") {
                Text(down ? "Live data unavailable, so we cannot say what is reported here right now."
                     : Screens.regionCoverage(region: name, continent: continent, sourcesRatio: Format.sourcesRatio(model.meta), here: current.count, atSea: Screens.atSea(model.live)))
                    .font(.footnote).foregroundStyle(Theme.textSoft).accessibilityIdentifier("coverageText")
                Text("What we show depends on what our global and national sources report. If a place has no current report, we show no events for it. That does not mean it is free of risk.").font(.footnote).foregroundStyle(Theme.muted)
            }
            Panel("Popular places") {
                FlowRow(spacing: 8) { ForEach(Copy.popularPlaces.dropLast(), id: \.title) { RouteLink($0.title, value: Route.region($0.title)).buttonStyle(OutlinePillButtonStyle()) } }
            }
            Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
            EnrichmentSection(record: Screens.syntheticRecord(title: world ? "global natural disaster response" : "\(name) natural disaster",
                                                              country: world ? "" : name, region: world ? "" : name, type: first?.type ?? "Natural Hazard",
                                                              updated: model.feed?.generatedAt ?? "", lat: first?.lat, lon: first?.lon,
                                                              source: "Combined from the official sources we read"))
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { ShareButton(route: .region(name), title: name) } }
    }
}

/// Location detail (features.md section 8.3).
struct LocationDetailView: View {
    @EnvironmentObject var model: AppModel
    let name: String
    let lat: Double?
    let lon: Double?
    let level: String?
    let country: String?
    let cc: String?
    @State var radius: Int = 0
    @State var sort = SortPicker.initial("location_sortBy", Sorts.locationSorts)

    var body: some View {
        let hasCoords = lat != nil && lon != nil
        let r = radius == 0 ? storedRadius : radius
        let within: [Record] = hasCoords
            ? Screens.nearby(model.live, lat: lat!, lon: lon!, withinKm: Double(r) + 0.0001) { _ in true }
            : model.live.filter { Search.matchesPlace($0, name) }
        let list = Sorts.apply(within, sort)
        let place = Place(kind: "Searched", name: name, lat: lat, lon: lon, country: country ?? "", countryCode: cc ?? "")
        let a = hasCoords ? PlaceRisk.assess(place, model.live, generatedAt: model.feed?.generatedAt) : nil
        ScreenScroll(title: name) {
            ScreenHeader(eyebrow: "Place", title: hasCoords ? "Disasters near \(name)" : "Disasters in \(name)", subtitle: "Current events and alerts for this place.")
            TrustNote(groups: [.feed, .models, .place])
            FeedBanner()
            if hasCoords, let pend = PlaceRisk.pending(model.placeFeedState) {
                // "Checking…" then "Live data unavailable" before the feed loads (changelog C26).
                HStack(alignment: .top, spacing: 8) {
                    PendingChip(text: pend.headline)
                    Text(pend.text).font(.footnote).foregroundStyle(Theme.textSoft)
                }
                .accessibilityElement(children: .contain)
                .accessibilityAddTraits(model.placeFeedState == .loading ? .updatesFrequently : [])
            } else if let a = a {
                HStack(alignment: .top, spacing: 8) {
                    if let l = a.level { RiskBadge(level: l) } else { NothingNearbyChip() }
                    Text(a.why).font(.footnote).foregroundStyle(Theme.textSoft)
                }
            }
            if hasCoords {
                MenuPicker(label: "Show events within", selection: Binding(get: { String(r) }, set: { v in
                    radius = Int(v) ?? 100
                    UserDefaults.standard.set(radius, forKey: "pnd_radius_" + (level ?? "Place"))
                }), options: PlaceSearch.radiusOptions.map { (String($0), "\($0) km") })
            }
            StatGrid(items: [("Current events", "\(list.filter { !$0.forecast }.count)"),
                             ("High alert", "\(list.filter { ["Red", "Orange", "High"].contains($0.alert) }.count)"),
                             ("Types of hazard", "\(Set(list.map { $0.type }).count)"), ("Sources", "\(Set(list.map { $0.source }).count)"),
                             ("Last checked", Format.age(model.feed?.generatedAt))])
            MapCard(records: list, height: 260, center: hasCoords ? CLLocationCoordinate2D(latitude: lat!, longitude: lon!) : nil,
                    spanDegrees: Double(r) / 111 * 2.6, circleKm: hasCoords ? Double(r) : nil, showCentreDot: hasCoords) { model.push(Route.detail(for: $0)) }
            Panel("Natural disasters and alerts", trailing: AnyView(SortPicker(screen: "location_sortBy", keys: Sorts.locationSorts, selection: $sort))) {
                if list.isEmpty { Text("If a place has no current report, that does not mean it is free of risk. In an emergency, follow your local authorities.").font(.footnote).foregroundStyle(Theme.muted) }
                LimitedList(items: list, page: 20) { e in
                    if let d = e.num("_d") { RelatedRow(record: e, line: JS.group(d) + " km away") } else { EventCard(record: e) }
                }
            }
            Panel("Types of hazard") {
                ForEach(Screens.typeCounts(list), id: \.type) { t in
                    HStack { Text(t.type).foregroundStyle(Theme.text); Spacer(); Text("\(t.count)").foregroundStyle(Theme.muted) }.font(.subheadline)
                }
            }
            Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
            EnrichmentSection(record: Screens.syntheticRecord(title: "\(name) natural disaster", country: country ?? name, region: name,
                                                              type: list.first(where: { !$0.forecast })?.type ?? "", updated: model.feed?.generatedAt ?? "",
                                                              lat: lat, lon: lon, source: "Combined from the official sources we read"))
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            ShareButton(route: .location(name: name, lat: lat, lon: lon, level: level, country: country, cc: cc), title: name) } }
    }

    var storedRadius: Int {
        let v = UserDefaults.standard.integer(forKey: "pnd_radius_" + (level ?? "Place"))
        return PlaceSearch.radiusOptions.contains(v) ? v : PlaceSearch.defaultRadius(level: level)
    }
}

/// Hazard detail (features.md section 9.2, changelog C2 and C21): hazards
/// matched whole, reports only, with open forecasts counted apart.
struct HazardDetailView: View {
    @EnvironmentObject var model: AppModel
    let requested: String
    @State var hazard: String
    @State var regionText: String
    @State var applied: (String, String)
    @State var sort = SortPicker.initial("hazard_sortBy", Sorts.eventSorts)

    init(initialHazard: String, initialRegion: String) {
        let t = initialHazard.isEmpty ? "Flood" : initialHazard
        let k = Format.hazardKey(t)
        requested = t
        _hazard = State(initialValue: k)
        _regionText = State(initialValue: initialRegion)
        _applied = State(initialValue: (k, initialRegion))
    }

    var body: some View {
        let choices = Screens.hazardChoices(requested: requested, present: model.live.map { $0.type }, current: hazard)
        let h = applied.0, rr = JS.trim(applied.1)
        let here: (Record) -> Bool = { Screens.hazardMatches($0, hazard: h, region: rr) }
        let list = Sorts.apply(Format.observed(model.live).filter(here), sort)
        let fcHere = Format.openForecasts(model.live).filter(here)
        let down = model.feedDown
        let hz = Hazards.hazardOf(h)
        let top = list.first
        ScreenScroll(title: h + " events") {
            ScreenHeader(title: String(h.prefix(1)) + h.dropFirst().lowercased() + " events",
                         subtitle: "Current \(h.lowercased()) events" + (rr.isEmpty ? " around the world" : " in " + rr) + ". Open any event to see its details and its source.")
            TrustNote()
            FeedBanner()
            HStack {
                MenuPicker(label: "Hazard", selection: $hazard, options: choices.options.map { ($0, $0) })
                TextField("Region (optional)", text: $regionText).fieldStyle()
                Button("Show") { applied = (hazard, regionText) }.buttonStyle(PrimaryButtonStyle())
            }
            HazardDefinition(hazard: hz)
            StatGrid(items: [("Current events", model.fig(list.count)), ("High alert", model.fig(list.filter { Format.isHighAlert($0) }.count)),
                             ("Countries and areas", model.fig(Format.countryCount(list))), ("Sources", model.fig(Format.sourcesReporting(list)))])
            RefreshRow(status: model.statusLine())
            MapCard(records: Array(list.prefix(250)), height: 240, fitToRecords: true) { model.push(Route.detail(for: $0)) }
            Panel("Current \(h.lowercased()) events" + (rr.isEmpty ? "" : " \u{00B7} " + rr), trailing: AnyView(SortPicker(screen: "hazard_sortBy", keys: Sorts.eventSorts, selection: $sort))) {
                if down {
                    UnavailableCard()
                } else if list.isEmpty && model.feed != nil {
                    MessageCard(title: "No current events of this type match.", detail: Screens.hazardEmptyDetail(here: !rr.isEmpty))
                        .accessibilityElement(children: .contain).accessibilityIdentifier("hazardEmpty")
                }
                LimitedList(items: list, page: 20) { e in RelatedRow(record: e, line: Format.placeOf(e, "Place not given") + " \u{00B7} " + e.details) }
                if !down, let note = Screens.hazardForecastNote(count: fcHere.count, hazard: h, here: !rr.isEmpty) {
                    Text(note).font(.footnote).foregroundStyle(Theme.textSoft).accessibilityIdentifier("forecastNote")
                    RouteLink("See our forecasts \u{2192}", value: Route.collection(.forecastList, query: nil)).font(.footnote)
                }
            }
            Panel("How to read this page") {
                Text("These are current reports from official agencies about this type of hazard. A hazard that is not listed may still be happening where no source reports it.").font(.footnote).foregroundStyle(Theme.textSoft)
            }
            Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
            EnrichmentSection(record: synthetic(h, rr, top))
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { ShareButton(route: .hazard(type: h, region: rr.isEmpty ? nil : rr), title: h) } }
    }
}

/// "What counts as {hazard}": the hazard model's definition.
struct HazardDefinition: View {
    let hazard: HazardInfo
    var body: some View {
        Panel("What counts as " + hazard.name.lowercased()) {
            Text(hazard.definition).font(.footnote).foregroundStyle(Theme.textSoft)
            KeyValueRow(key: "How it starts", value: hazard.onset == "sudden" ? "Suddenly, with little or no warning" : (hazard.onset == "slow" ? "Slowly, over weeks or months" : "Quickly, over hours or days"))
            KeyValueRow(key: "How long it lasts", value: hazard.duration)
            KeyValueRow(key: "How much warning there is", value: hazard.leadTime)
            KeyValueRow(key: "How severity is measured", value: hazard.severityBasis)
        }
    }
}

extension HazardDetailView {
    func synthetic(_ h: String, _ rr: String, _ top: Record?) -> Record {
        let title: String = rr.isEmpty ? h : h + " " + rr
        let country: String = rr.isEmpty ? (top?.country ?? "") : rr
        let region: String = rr.isEmpty ? (top?.region ?? "") : rr
        return Screens.syntheticRecord(title: title, country: country, region: region, type: h, updated: model.feed?.generatedAt ?? "",
                                       lat: top?.lat, lon: top?.lon, source: "Combined from the official sources we read")
    }
}

/// Calamities: happening now and past disasters (features.md section 3.3).
struct CalamitiesView: View {
    @EnvironmentObject var model: AppModel
    @State var tab = 0
    @State var q = ""
    @State var country = ""
    @State var hazard = ""
    @State var level = ""
    @State var sort = SortPicker.initial("calamities_sortBy", Sorts.eventSorts)
    @State var hq = ""
    @State var hh = ""
    @State var hsort = "asc"

    var body: some View {
        let current = model.live.filter { $0.isOfficial && !$0.forecast }
        let list = Sorts.apply(current.filter { Screens.calamityMatches($0, text: q, country: country, hazard: hazard, level: level) }, sort)
        ScreenScroll(title: "Disasters now and in the past") {
            ScreenHeader(title: "Current disasters and disaster history", subtitle: "Disasters happening now around the world, plus a timeline of major disasters from the past.")
            TrustNote()
            FeedBanner()
            StatGrid(items: [("Happening now", model.fig(list.count)),
                             ("High alert", model.fig(list.filter { ["Red", "Orange", "High"].contains($0.alert) }.count)),
                             ("Countries and territories", model.fig(Format.countryCount(list))),
                             ("Sources working", model.figText(Format.sourcesRatio(model.meta))), ("Past disasters listed", "\(model.history.count)")])
            Picker("View", selection: $tab) { Text("Happening now").tag(0); Text("Past disasters").tag(1) }.pickerStyle(.segmented)
            if tab == 0 { now(list) } else { past }
            Text("Times are shown in your device\u{2019}s time zone. To see them in another time zone, use the time zone setting.").font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder func now(_ list: [Record]) -> some View {
        SearchField(prompt: "Search by country, city, province, disaster or source", text: $q)
        FlowRow(spacing: 8) {
            MenuPicker(label: "Filter by country", selection: $country, options: [("", "All countries and territories")] + Geo.countryOptions().map { ($0, $0) })
            MenuPicker(label: "Filter by hazard type", selection: $hazard, options: [("", "All hazards")] + ["Flood", "Earthquake", "Wildfire", "Volcano", "Storm", "Drought"].map { ($0, $0) })
            RiskFilterPicker(selection: $level)
            SortPicker(screen: "calamities_sortBy", keys: Sorts.eventSorts, selection: $sort)
        }
        RefreshRow(status: model.status == .failed ? Copy.loadError : Format.statusText(model.meta) + " \u{00B7} " + Format.fmtDate(model.feed?.generatedAt, tz: model.zoneID))
        Panel("Jump to a country") {
            Text("You can pick any country. We only show events that official agencies have reported.").font(.footnote).foregroundStyle(Theme.muted)
            FlowRow(spacing: 8) { ForEach(Copy.jumpCountries, id: \.self) { c in Button(c) { country = c == "World" ? "" : c }.buttonStyle(OutlinePillButtonStyle()) } }
        }
        Panel("Ongoing and recent disasters") {
            if list.isEmpty && model.feed != nil {
                MessageCard(title: "No matching disasters reported right now.", detail: "Our sources have no current report that matches. This does not mean the place is safe.")
            }
            LimitedList(items: list, page: 30) { e in
                RouteLink(value: Route.calamity(e.id)) {
                    CardBox {
                        FlowRow { RecordRiskBadge(record: e); SourcePill(source: e.source); if e.cached { Pill(text: "Saved copy") } }
                        Text(e.title).font(.headline).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                        Text(e.type + " \u{00B7} " + Format.placeOf(e, "Place not given")).font(.footnote).foregroundStyle(Theme.textSoft)
                        if !Format.impactText(e).isEmpty { Text(Format.impactText(e)).font(.footnote.bold()).foregroundStyle(Theme.text) }
                        Text("Updated " + Format.fmtDate(e.updated, tz: model.zoneID) + " \u{00B7} " + Format.age(e.updated)).font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                .buttonStyle(.plainArea)
            }
        }
        Panel("Source status", trailing: AnyView(RouteLink("Sources \u{2192}", value: Route.collection(.resources, query: nil)).font(.caption))) {
            ForEach(Screens.sourceRows(model.meta, tz: model.zoneID), id: \.name) { r in
                KeyValueRow(key: r.name, value: r.detail + "\nChecked " + r.checked)
            }
            Text("You can choose any country or territory that your device knows. We cover Earth only. If a source is down, we may show a saved copy of an event instead, and we label it as a saved copy.").font(.caption).foregroundStyle(Theme.muted)
        }
    }

    var past: some View {
        let arr = model.history.filter { e in (hq.isEmpty || Search.matches(e.record, hq)) && (hh.isEmpty || e.type.lowercased().contains(hh.lowercased())) }
            .sorted { hsort == "asc" ? $0.sort < $1.sort : $0.sort > $1.sort }
        return VStack(alignment: .leading, spacing: 10) {
            SearchField(prompt: "Search past disasters by name, place or hazard", text: $hq)
            FlowRow(spacing: 8) {
                MenuPicker(label: "Filter by hazard type", selection: $hh, options: [("", "All hazards")] + History.filters.map { ($0, $0) })
                MenuPicker(label: "Sort results", selection: $hsort, options: [("asc", "Oldest first"), ("desc", "Newest first")])
                RouteLink("See past and recent events", value: Route.collection(.historicalEvents, query: nil)).buttonStyle(SecondaryButtonStyle())
            }
            Notice(text: History.notice)
            ForEach(arr) { e in
                RouteLink(value: Route.history(e.slug)) {
                    CardBox {
                        HStack(alignment: .top) {
                            Text(e.year).font(.footnote.bold()).foregroundStyle(Theme.text).frame(width: 80, alignment: .leading)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(e.name).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                                Text(e.location + " \u{00B7} " + e.type).font(.caption).foregroundStyle(Theme.muted)
                                Text(e.summary).font(.footnote).foregroundStyle(Theme.textSoft).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 4)
                            RiskBadge(level: e.badgeLevel, text: e.severity)
                        }
                    }
                }
                .buttonStyle(.plainArea)
            }
        }
    }
}

/// Historical event detail (features.md section 11.2).
struct HistoryDetailView: View {
    @EnvironmentObject var model: AppModel
    let slug: String
    @State var sort = SortPicker.initial("history_sortBy", Sorts.historySorts)

    var body: some View {
        let e = History.find(model.history, slug)
        ScreenScroll(title: e?.name ?? "Past disaster", refreshable: false) {
            if let e = e {
                ScreenHeader(title: e.name, subtitle: e.year + " \u{00B7} " + e.location)
                StatGrid(items: [("When", e.year), ("Hazard", e.type), ("Severity", e.severity), ("Where", e.location)])
                Panel("About this disaster") {
                    KeyValueRow(key: "Name", value: e.name)
                    KeyValueRow(key: "When", value: e.year)
                    KeyValueRow(key: "Hazard type", value: e.type)
                    KeyValueRow(key: "Where", value: e.location)
                    KeyValueRow(key: "Severity", value: e.severity)
                    KeyValueRow(key: "Summary", value: e.summary)
                }
                Panel("How sure is this?") { Text(History.evidence).font(.footnote).foregroundStyle(Theme.textSoft) }
                let rel = Sorts.apply(History.related(model.history, to: e).map { $0.record }, sort)
                Panel("Similar past disasters", trailing: AnyView(SortPicker(screen: "history_sortBy", keys: Sorts.historySorts, selection: $sort))) {
                    if rel.isEmpty { Text("No similar past disasters in our list.").font(.footnote).foregroundStyle(Theme.muted) }
                    ForEach(rel.prefix(8)) { x in
                        RouteLink(value: Route.history(x.s("id"))) {
                            CardBox {
                                RiskBadge(level: x.s("severity") == "Catastrophic" ? .severe : .high, text: x.s("severity"))
                                Text(x.s("name")).font(.subheadline.bold()).foregroundStyle(Theme.text)
                                Text(x.s("year") + " \u{00B7} " + x.s("location") + " \u{00B7} " + x.s("type")).font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                        .buttonStyle(.plainArea)
                    }
                }
                FlowRow(spacing: 8) {
                    RouteLink("This hazard", value: Route.hazard(type: e.type.components(separatedBy: "/")[0].trimmingCharacters(in: .whitespaces), region: nil)).buttonStyle(SecondaryButtonStyle())
                    RouteLink("This region", value: Route.region(e.location.components(separatedBy: ",")[0].components(separatedBy: "/")[0].trimmingCharacters(in: .whitespaces))).buttonStyle(SecondaryButtonStyle())
                    RouteLink("Current calamities", value: Route.calamities).buttonStyle(SecondaryButtonStyle())
                }
                Text("Help and context").font(.title3.bold()).foregroundStyle(Theme.text)
                EnrichmentSection(record: Screens.syntheticRecord(title: e.name, country: (e.location.components(separatedBy: ",").last ?? "").trimmingCharacters(in: .whitespaces),
                                                                  region: e.location, type: e.type, updated: "", lat: nil, lon: nil, source: "Historical disaster archive"))
            } else {
                ScreenHeader(title: "Past disaster not found", subtitle: "Go back to the list and choose a disaster.").accessibilityElement(children: .contain).accessibilityIdentifier("notFound")
            }
        }
        .toolbar { if let e = e { ToolbarItem(placement: .topBarTrailing) { ShareButton(route: .history(e.slug), title: e.name) } } }
    }
}
