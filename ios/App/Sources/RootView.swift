import SwiftUI
import PNDCore

@main
struct PNDApp: App {
    @StateObject var model = AppModel()
    @Environment(\.scenePhase) var phase

    init() {
        NotificationService.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .tint(Theme.green)
                .onOpenURL { model.handle(url: $0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { a in
                    if let u = a.webpageURL { model.handle(url: u) }
                }
                .onAppear {
                    NotificationService.shared.onOpen = { url in model.handle(url: url) }
                }
        }
        .onChange(of: phase) { _, p in
            if p == .active { model.start() } else if p == .background {
                model.stop()
                NotificationService.shared.scheduleBackgroundRefresh(enabled: model.alertsEnabled && !model.places.isEmpty)
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.horizontalSizeClass) var hsize

    var body: some View {
        Group {
            if hsize == .regular {
                SplitRoot()
            } else {
                TabRoot()
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { model.start() }
    }
}

/// iPhone: a tab bar. iOS keeps four tabs and moves the rest under "More".
struct TabRoot: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        TabView(selection: $model.selectedTab) {
            ForEach(Tab.allCases) { tab in
                TabStack(tab: tab)
                    .tabItem { Label(tab.title, systemImage: tab.icon) }
                    .tag(tab)
                    .accessibilityIdentifier("tab-" + tab.rawValue)
            }
        }
    }
}

struct TabStack: View {
    @EnvironmentObject var model: AppModel
    let tab: Tab
    var body: some View {
        NavigationStack(path: model.path(tab)) {
            RouteView(route: tab.rootRoute)
                .navigationDestination(for: Route.self) { RouteView(route: $0) }
        }
    }
}

enum SidebarItem: Hashable { case tab(Tab), more }

/// iPad: a sidebar with every section.
struct SplitRoot: View {
    @EnvironmentObject var model: AppModel
    @State var selection: SidebarItem? = .tab(.home)

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    ForEach(Tab.allCases) { t in
                        NavigationLink(value: SidebarItem.tab(t)) { Label(t.title, systemImage: t.icon) }
                            .accessibilityIdentifier("sidebar-" + t.rawValue)
                    }
                    NavigationLink(value: SidebarItem.more) { Label("More pages", systemImage: "ellipsis.circle") }
                        .accessibilityIdentifier("sidebar-more")
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Predict Natural Disasters").font(.headline).foregroundStyle(Theme.text)
                        Text("Check a place \u{00B7} live hazards \u{00B7} forecasts").font(.caption2).foregroundStyle(Theme.muted)
                    }
                    .textCase(nil)
                    .padding(.bottom, 6)
                }
            }
            .navigationTitle("Sections")
            .scrollContentBackground(.hidden)
            .background(Theme.panel)
        } detail: {
            switch selection {
            case .more?:
                NavigationStack(path: model.path(.home)) {
                    MoreView().navigationDestination(for: Route.self) { RouteView(route: $0) }
                }
            case .tab(let t)?:
                TabStack(tab: t).id(t)
            case nil:
                TabStack(tab: .home)
            }
        }
        .onChange(of: model.selectedTab) { _, t in selection = .tab(t) }
        .onChange(of: selection) { _, s in if case .tab(let t)? = s, model.selectedTab != t { model.selectedTab = t } }
    }
}

/// Every screen, by route.
struct RouteView: View {
    let route: Route
    var body: some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: Route.more) {
                        Image(systemName: "ellipsis.circle").accessibilityLabel("More pages and settings")
                    }
                    .accessibilityIdentifier("moreButton")
                }
            }
            .toolbarBackground(Color(hex: "#02110D").opacity(0.97), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }

    @ViewBuilder var content: some View {
        switch route {
        case .home: HomeView()
        case .map: MapScreen()
        case .alerts: AlertsView()
        case .forecasts: ForecastsView()
        case .myPlaces: MyPlacesView()
        case .trackRecord: TrackRecordView()
        case .event(let id): RecordDetailView(id: id, kind: .event)
        case .alert(let id): RecordDetailView(id: id, kind: .alert)
        case .calamity(let id): RecordDetailView(id: id, kind: .calamity)
        case .forecast(let id): ForecastDetailView(id: id)
        case .region(let name): RegionDetailView(region: name)
        case .location(let name, let lat, let lon, let level, let country, let cc):
            LocationDetailView(name: name, lat: lat, lon: lon, level: level, country: country, cc: cc)
        case .hazard(let type, let region): HazardDetailView(initialHazard: type, initialRegion: region ?? "")
        case .history(let slug): HistoryDetailView(slug: slug)
        case .source(let name): SourceDetailView(name: name)
        case .collection(let v, let q):
            if v == .resources { SourcesView() } else if v == .forecastCalendar { CalendarScreen(query: q ?? "") } else { CollectionScreen(view: v, initialQuery: q ?? "") }
        case .calamities: CalamitiesView()
        case .regions: RegionsView()
        case .insights: InsightsView()
        case .methodology: MethodologyView()
        case .about: AboutView()
        case .settings: SettingsView()
        case .verification: VerificationListView()
        case .verificationDetail: VerificationDetailView()
        case .more: MoreView()
        }
    }
}

/// The site's footer links, settings and agencies (features.md section 0.1).
struct MoreView: View {
    var body: some View {
        List {
            Section("Pages") {
                link("Check a place", .home, "magnifyingglass")
                link("Live events", .collection(.events, query: nil), "dot.radiowaves.left.and.right")
                link("Official warnings", .collection(.officialWarnings, query: nil), "exclamationmark.octagon")
                link("Disasters now and in the past", .calamities, "clock.arrow.circlepath")
                link("Regions", .regions, "globe")
                link("Forecast calendar", .collection(.forecastCalendar, query: nil), "calendar")
                link("How it works", .methodology, "gearshape.2")
                link("Our sources", .collection(.resources, query: nil), "list.bullet.rectangle")
                link("Insights", .insights, "chart.bar")
                link("About", .about, "info.circle")
            }
            Section("More lists") {
                link("Recent events", .collection(.recentEvents, query: nil), "clock")
                link("Current alerts", .collection(.alertsNotifications, query: nil), "bell")
                link("Events by type", .collection(.hazardTypes, query: nil), "square.grid.2x2")
                link("Past and recent events", .collection(.historicalEvents, query: nil), "archivebox")
                link("Compare places", .collection(.compareLocations, query: nil), "rectangle.split.2x1")
                link("Our forecasts (full table)", .collection(.forecastList, query: nil), "tablecells")
                link("How we check forecasts", .verification, "checklist")
                link("Hazard types", .hazard(type: "Flood", region: nil), "drop")
            }
            Section("Settings") {
                link("Settings and time zone", .settings, "slider.horizontal.3")
            }
            Section { FooterAgencies().listRowInsets(EdgeInsets()) }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("More")
        .accessibilityIdentifier("moreScreen")
    }

    func link(_ t: String, _ r: Route, _ icon: String) -> some View {
        NavigationLink(value: r) { Label(t, systemImage: icon).foregroundStyle(Theme.text) }
            .listRowBackground(Theme.card)
            .frame(minHeight: 44)
    }
}
