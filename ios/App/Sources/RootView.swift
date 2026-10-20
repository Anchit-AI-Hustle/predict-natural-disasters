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
                NotificationService.shared.scheduleBackgroundRefresh(enabled: model.alertsEnabled)
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

/// iPhone: the site's five tabs in a bar of our own (features.md section
/// 0.1). A system TabView with six tabs hid Map and Track record under its
/// own "More" tab; Home opens from the logo button instead, as on the site.
struct TabRoot: View {
    @EnvironmentObject var model: AppModel
    /// Tabs are built when first opened, then kept, so each keeps its place.
    @State var opened: Set<AppTab> = []

    var body: some View {
        ZStack {
            ForEach(AppTab.allCases) { tab in
                if opened.contains(tab) || model.selectedTab == tab {
                    TabLayer(tab: tab, active: model.selectedTab == tab)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { PhoneTabBar() }
        .onAppear { opened.insert(model.selectedTab) }
        .onChange(of: model.selectedTab) { _, t in opened.insert(t) }
    }
}

/// One tab's stack, shown only while its tab is selected.
struct TabLayer: View {
    let tab: AppTab
    let active: Bool
    var body: some View {
        TabStack(tab: tab)
            .opacity(active ? 1 : 0)
            .allowsHitTesting(active)
            .accessibilityHidden(!active)
    }
}

/// The bottom bar: Map, Alerts & events, Forecasts, My places, Track record.
struct PhoneTabBar: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.barTabs) { t in
                PhoneTabButton(tab: t, selected: model.selectedTab == t) { model.selectTab(t) }
            }
        }
        .padding(.top, 4)
        .background(Color(hex: "#02110D").opacity(0.97).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.divider).frame(height: 0.5) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tabBar")
    }
}

struct PhoneTabButton: View {
    let tab: AppTab
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: tab.icon).font(.system(size: 18, weight: .semibold))
                Text(tab.title).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
            }
            .foregroundStyle(selected ? Theme.green : Theme.muted)
            .frame(maxWidth: .infinity, minHeight: 49)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : [.isButton])
        .accessibilityIdentifier("tab-" + tab.rawValue)
    }
}

struct TabStack: View {
    @EnvironmentObject var model: AppModel
    let tab: AppTab
    var body: some View {
        NavigationStack(path: model.path(tab)) {
            RouteView(route: tab.rootRoute)
                .navigationDestination(for: Route.self) { RouteView(route: $0) }
        }
        .environment(\.stackTab, tab)
    }
}

/// The logo: opens Home / Check a place from every tab, as the site's logo does.
struct LogoButton: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Button { model.goHome() } label: {
            HStack(spacing: 4) {
                Text("\u{25CE}").font(.headline).foregroundStyle(Theme.green)
                Text("Check a place").font(.footnote.weight(.bold)).foregroundStyle(Theme.text)
            }
        }
        .accessibilityLabel("Predict Natural Disasters: check a place")
        .accessibilityIdentifier("logoButton")
    }
}

extension Route {
    /// The root screen of a tab (or Home): it carries the logo button.
    var isTabRoot: Bool { AppTab.allCases.contains { $0.rootRoute == self } }
}

enum SidebarItem: Hashable { case tab(AppTab), more }

/// iPad: a sidebar with the logo (Home), the same five tabs and More pages.
struct SplitRoot: View {
    @EnvironmentObject var model: AppModel
    @State var selection: SidebarItem? = .tab(.home)

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    ForEach(AppTab.barTabs) { t in
                        // Tagged rows, not value links: a value link in the sidebar makes
                        // the split view claim every value link on the page as well.
                        Label(t.title, systemImage: t.icon)
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityIdentifier("sidebar-" + t.rawValue)
                            .tag(SidebarItem.tab(t))
                    }
                    Label("More pages", systemImage: "ellipsis.circle")
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("sidebar-more")
                        .tag(SidebarItem.more)
                } header: {
                    SidebarLogo { selection = .tab(.home) }
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
                .environment(\.stackTab, .home)
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

/// The sidebar's logo: Home / Check a place.
struct SidebarLogo: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Text("\u{25CE}").font(.title3).foregroundStyle(Theme.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Predict Natural Disasters").font(.headline).foregroundStyle(Theme.text)
                    Text("Check a place \u{00B7} live hazards \u{00B7} forecasts").font(.caption2).foregroundStyle(Theme.muted)
                }
            }
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .textCase(nil)
        .padding(.bottom, 6)
        .accessibilityLabel("Predict Natural Disasters: check a place")
        .accessibilityIdentifier("sidebar-home")
    }
}

/// Every screen, by route.
struct RouteView: View {
    let route: Route
    var body: some View {
        content
            .toolbar {
                if route.isTabRoot {
                    ToolbarItem(placement: .topBarLeading) { LogoButton() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    RouteLink(value: Route.more) {
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
        case .scopedCollection(let v, let q, let r):
            if v == .resources { SourcesView() } else if v == .forecastCalendar { CalendarScreen(query: q ?? "", region: r) } else { CollectionScreen(view: v, initialQuery: q ?? "", region: r) }
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
        RouteLink(value: r) {
            HStack {
                Label(t, systemImage: icon).foregroundStyle(Theme.text)
                Spacer()
                Image(systemName: "chevron.forward").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
            .listRowBackground(Theme.card)
            .frame(minHeight: 44)
    }
}
