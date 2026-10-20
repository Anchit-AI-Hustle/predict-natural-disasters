import SwiftUI
import PNDCore

/// Map tab (features.md section 2).
struct MapScreen: View {
    @EnvironmentObject var model: AppModel
    @State var query = ""
    @State var sort = SortPicker.initial("live-map_sortBy", Sorts.eventSorts)

    var body: some View {
        let list = Sorts.apply(model.live.filter { Search.matches($0, query) }, sort)
        ScreenScroll(title: "Map") {
            ScreenHeader(title: "Live disaster map", subtitle: "Events reported by official agencies, shown on a map. This page refreshes every minute.")
            TrustNote()
            FeedBanner()
            SearchField(prompt: "Search place or hazard", text: $query)
            HStack { SortPicker(screen: "live-map_sortBy", keys: Sorts.eventSorts, selection: $sort); Spacer() }
            RefreshRow(status: model.status == .failed ? Copy.loadError : model.statusLine())
            MapCard(records: Array(list.prefix(220)), height: 420) { model.push(Route.detail(for: $0)) }
            Panel("Latest events", trailing: AnyView(RouteLink("See all \u{2192}", value: Route.collection(.recentEvents, query: nil)).font(.caption))) {
                if list.isEmpty && model.feed != nil { EmptyStateView(empty: Search.empty(query: query, all: model.live, noun: "events")) { q in model.push(.collection(.events, query: q)) } }
                LazyVStack(spacing: 8) { ForEach(list.prefix(30)) { EventCard(record: $0) } }
            }
        }
    }
}

/// Alerts tab root (features.md section 3.1).
struct AlertsView: View {
    @EnvironmentObject var model: AppModel
    @State var query = ""
    @State var level = ""
    @State var sort = SortPicker.initial("alerts_sortBy", Sorts.eventSorts)

    var body: some View {
        let official = model.live.filter { $0.isOfficial }
        let list = Sorts.apply(official.filter { Search.matches($0, query) && RiskScale.matches($0, level) }, sort)
        let tz = model.zoneID
        ScreenScroll(title: "Alerts & events") {
            ScreenHeader(eyebrow: "Official alerts and reported events", title: "Alerts",
                         subtitle: "Current reports from official agencies. Open any alert to see its details and its source.")
            TrustNote()
            FeedBanner()
            StatGrid(items: [("Official reports", model.fig(list.count)),
                             ("Red or orange alert", model.fig(list.filter { $0.isRedOrOrange }.count)),
                             ("Countries and areas", model.fig(Format.countryCount(list))),
                             ("Sources working", model.figText(Format.sourcesRatio(model.meta))),
                             ("Updated", Format.age(model.feed?.generatedAt))])
            SearchField(prompt: "Search by alert, place, hazard or agency", text: $query)
            HStack { RiskFilterPicker(selection: $level); SortPicker(screen: "alerts_sortBy", keys: Sorts.eventSorts, selection: $sort) }
            RefreshRow(status: model.statusLine())
            HStack(spacing: 8) {
                RouteLink("Live events", value: Route.collection(.events, query: nil)).buttonStyle(SecondaryButtonStyle())
                RouteLink("Disasters now and past", value: Route.calamities).buttonStyle(SecondaryButtonStyle())
            }
            MapCard(records: Array(list.prefix(250)), height: 260) { model.push(Route.detail(for: $0)) }
            Panel("Current official alerts", trailing: AnyView(RouteLink("See all official warnings \u{2192}", value: Route.collection(.officialWarnings, query: nil)).font(.caption))) {
                if list.isEmpty && model.feed != nil {
                    EmptyStateView(empty: Search.empty(query: query, all: model.live, noun: "official alerts")) { q in model.push(.collection(.events, query: q)) }
                }
                LazyVStack(spacing: 8) {
                    ForEach(list.prefix(40)) { e in AlertCard(record: e) }
                }
            }
            Panel("Source status", trailing: AnyView(RouteLink("About our sources \u{2192}", value: Route.collection(.resources, query: nil)).font(.caption))) {
                ForEach(Screens.sourceRows(model.meta, tz: tz), id: \.name) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.name).font(.footnote.bold()).foregroundStyle(Theme.text)
                        Text((r.ok ? "Working" : "Not answering") + " \u{00B7} checked " + r.checked).font(.caption)
                            .foregroundStyle(r.ok ? Theme.ok : Theme.warn)
                    }
                }
            }
            Panel("How to read these alerts") {
                ForEach(Copy.howToReadAlerts, id: \.self) { Text($0).font(.footnote).foregroundStyle(Theme.textSoft) }
            }
        }
    }
}

struct AlertCard: View {
    @EnvironmentObject var model: AppModel
    let record: Record
    var body: some View {
        RouteLink(value: Route.detail(for: record)) {
            CardBox {
                FlowRow { RecordRiskBadge(record: record); SourcePill(source: record.source) }
                Text(Format.titleOf(record)).font(.headline).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                Text(record.type + " \u{00B7} " + Format.placeOf(record, "Place not given")).font(.footnote).foregroundStyle(Theme.textSoft)
                let impact = Format.impactText(record)
                if !impact.isEmpty { Text(impact).font(.footnote.bold()).foregroundStyle(Theme.text) }
                Text("Source updated " + Format.fmtDate(record.updated, tz: model.zoneID) + " \u{00B7} " + Format.age(record.updated))
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .buttonStyle(.plainArea)
        .accessibilityIdentifier("alertCard")
    }
}

/// The shared collection engine (features.md section 3.2).
struct CollectionScreen: View {
    @EnvironmentObject var model: AppModel
    let view: CollectionView
    @State var query: String
    @State var hazard = ""
    @State var level = ""
    @State var sort: String

    init(view: CollectionView, initialQuery: String) {
        self.view = view
        _query = State(initialValue: initialQuery)
        _sort = State(initialValue: SortPicker.initial(view.rawValue + "_sortBy", view.sortKeys))
    }

    var pool: [Record] { view.includesNotLive ? model.all : model.live }

    var body: some View {
        let kept = pool.filter { view.keep($0) }
        let list = Sorts.apply(kept.filter { e in
            Search.matches(e, query) &&
            (hazard.isEmpty || (view.isForecastView ? e.type.lowercased() == hazard.lowercased() : CollectionView.fixedHazardMatches(e, hazard))) &&
            RiskScale.matches(e, level)
        }, sort)
        ScreenScroll(title: view.title) {
            ScreenHeader(title: view.title, subtitle: view.subtitle)
            TrustNote()
            FeedBanner()
            SearchField(prompt: "Search", text: $query).accessibilityIdentifier("collectionSearch")
            FlowRow(spacing: 8) {
                MenuPicker(label: "Filter by hazard", selection: $hazard, options: hazardOptions(kept))
                RiskFilterPicker(selection: $level)
                SortPicker(screen: view.rawValue + "_sortBy", keys: view.sortKeys, selection: $sort)
            }
            RefreshRow(status: statusText(kept))
            if view.isForecastView { Text(Format.horizonText(model.meta, tz: model.zoneID) + " " + Copy.forecastNote).font(.footnote).foregroundStyle(Theme.muted) }
            if view == .compareLocations {
                Text("Search for a place to see its current events. Then search for another place to compare.").font(.footnote).foregroundStyle(Theme.muted)
            }
            if list.isEmpty && model.feed != nil {
                EmptyStateView(empty: Search.empty(query: query, all: model.all, noun: view.noun)) { q in model.push(.collection(.events, query: q)) }
            }
            if view == .forecastList {
                ForecastTable(records: list, full: true)
            } else {
                LimitedList(items: list, page: 40) { EventCard(record: $0) }
            }
        }
    }

    func statusText(_ kept: [Record]) -> String {
        if model.status == .failed { return Copy.loadError }
        if model.feed == nil { return Copy.loading }
        let parts: [String] = [Format.statusText(model.meta), view.countText(shown: kept.count, kept: kept), "updated " + Format.age(model.feed?.generatedAt)]
        return parts.joined(separator: " \u{00B7} ")
    }

    func hazardOptions(_ kept: [Record]) -> [(String, String)] {
        if view.isForecastView { return Format.hazardOptions(kept, selected: hazard).map { ($0.value, $0.label) } }
        return [("", "All hazards")] + CollectionView.fixedHazards.map { ($0, $0) }
    }
}

/// The forecast table's phone fold, or the full ten columns (logic.md section 7).
struct ForecastTable: View {
    @EnvironmentObject var model: AppModel
    let records: [Record]
    var full = false

    var body: some View {
        LimitedList(items: records, page: 30) { e in
            RouteLink(value: Route.detail(for: e)) { row(e) }.buttonStyle(.plainArea)
        }
    }

    func row(_ e: Record) -> some View {
        let tz = model.zoneID
        let geo = [e.region, e.country].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        let cls = e.s("forecastClass")
        let clsLabel = Hazards.forecastClasses[cls]?.label ?? (cls.isEmpty ? "Not recorded" : cls)
        let status = !e.forecast ? "Reported event" : (e.windowClosed ? "Ended" : "Active")
        var cells: [(String, String)] = [("Forecast", Format.titleOf(e)), ("Place", geo.isEmpty ? "Global" : geo), ("Hazard", e.type.isEmpty ? "-" : e.type),
                                         ("Kind of forecast", clsLabel)]
        if full {
            cells += [("Starts", e.truthy("targetStart") ? Format.fmtWhen(e.s("targetStart"), e.s("targetEnd"), nil, tz: tz) : "-"),
                      ("Ends", e.truthy("targetEnd") ? Format.fmtWhen(e.s("targetEnd"), e.s("targetStart"), "end", tz: tz) : "-"),
                      ("What it is", whatItIs(e)),
                      ("Source", sourceText(e.source)), ("Updated", Format.age(e.updated))]
        }
        cells += [("Dates", Format.datesCell(e, tz: tz)), ("Status", status)]
        return VStack(alignment: .leading, spacing: 4) {
            HStack { Text("RISK").font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 96, alignment: .leading); RecordRiskBadge(record: e); Spacer() }
            ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                HStack(alignment: .firstTextBaseline) {
                    Text(c.0.uppercased()).font(.caption2.weight(.heavy)).foregroundStyle(Theme.label).frame(width: 96, alignment: .leading)
                    Text(c.1).font(i == 0 ? .subheadline.bold() : .footnote).foregroundStyle(i == 0 ? Theme.link : Theme.text)
                        .lineLimit(c.0 == "Place" ? 3 : nil).multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .accessibilityHint(c.0 == "Kind of forecast" ? (Hazards.forecastClasses[cls]?.definition ?? "We did not record what kind of forecast this is.") : "")
            }
        }
        .padding(.vertical, 8).padding(.horizontal, 11)
        .background(Color(hex: "#08211A"), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.divider, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("forecastRow")
    }

    func whatItIs(_ e: Record) -> String {
        if !e.forecast { return "Official report" }
        if e.s("forecastKind") == "frozen-benchmark" { return "Test case" }
        return e.truthy("forecastOf") ? "Our estimate" : "Our own estimate"
    }

    func sourceText(_ full: String) -> String {
        if let m = JSRegex(#"^Predict Natural Disasters\s*·\s*derived from\s+(.+)$"#, caseInsensitive: true).exec(full), let x = m[1] { return "From " + x }
        return full.isEmpty ? "-" : full
    }
}

/// Forecasts tab (features.md section 4).
struct ForecastsView: View {
    @EnvironmentObject var model: AppModel
    @State var query = ""
    @State var hazard = ""
    @State var level = ""
    @State var sort = SortPicker.initial("forecasts_sortBy", Sorts.forecastTabSorts)

    var body: some View {
        let tz = model.zoneID
        let fcAll = model.live.filter { $0.forecast }
        let highAll = model.live.filter { !$0.forecast && ["Red", "Orange", "High"].contains($0.alert) }
        let matchQ: (Record) -> Bool = { Search.matches($0, query) && RiskScale.matches($0, level) }
        let fc = Sorts.apply(fcAll.filter { matchQ($0) && (hazard.isEmpty || $0.type == hazard) }, sort)
        let high = Sorts.apply(highAll.filter { matchQ($0) && (hazard.isEmpty || $0.type == hazard) }, sort)
        let tiles = Screens.typeCounts(fcAll.filter(matchQ))
        let changes = Format.changes(model.meta, tz: tz)
        ScreenScroll(title: "Forecasts") {
            ScreenHeader(eyebrow: "Our own estimates", title: "Natural disaster forecasts",
                         subtitle: "These are our forecasts of what may happen next, and where. We make them from reports by official agencies. They are not official warnings.")
            TrustNote()
            FeedBanner()
            StatGrid(items: [("Forecasts", model.fig(fcAll.count)), ("Events on high alert", model.fig(highAll.count)),
                             ("Kinds of hazard", model.fig(Set(fcAll.map { $0.type }).count)),
                             ("Sources working", model.figText(Format.sourcesRatio(model.meta))), ("Updated", Format.age(model.feed?.generatedAt)),
                             ("Forecasts reach as far as", Format.horizonStat(model.meta, tz: tz))])
            Text(Format.horizonText(model.meta, tz: tz)).font(.footnote).foregroundStyle(Theme.textSoft)
            SearchField(prompt: "Search by forecast, country, city, sea or hazard", text: $query)
            FlowRow(spacing: 8) {
                MenuPicker(label: "Filter by hazard", selection: $hazard, options: Format.hazardOptions(fcAll + highAll, selected: hazard).map { ($0.value, $0.label) })
                RiskFilterPicker(selection: $level)
                SortPicker(screen: "forecasts_sortBy", keys: Sorts.forecastTabSorts, selection: $sort)
            }
            RefreshRow(label: "\u{21BB} Refresh live data", status: model.statusLine())
            HStack(spacing: 8) {
                RouteLink("Forecast calendar", value: Route.collection(.forecastCalendar, query: nil)).buttonStyle(SecondaryButtonStyle())
                RouteLink("Full table", value: Route.collection(.forecastList, query: nil)).buttonStyle(SecondaryButtonStyle())
            }
            MapCard(records: Array((fc + high).prefix(300)), height: 260) { model.push(Route.detail(for: $0)) }
            Panel("Forecasts by hazard") {
                Text("Select a hazard to see only its forecasts. Select it again to see them all.").font(.footnote).foregroundStyle(Theme.muted)
                if tiles.isEmpty { Text("No forecast matches these filters.").font(.footnote).foregroundStyle(Theme.muted) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                    ForEach(tiles, id: \.type) { t in
                        Button { hazard = hazard == t.type ? "" : t.type } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.type).font(.subheadline.bold())
                                Text("\(t.count)").font(.title3.bold().monospacedDigit())
                            }
                            .foregroundStyle(hazard == t.type ? Theme.ink : Theme.text)
                            .padding(8).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .background(hazard == t.type ? Theme.green : Theme.cardAlt, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plainArea)
                        .accessibilityAddTraits(hazard == t.type ? .isSelected : [])
                    }
                }
            }
            Panel("Forecasts \u{00B7} \(fc.count) (of \(fcAll.count))", trailing: AnyView(RouteLink("Full table \u{2192}", value: Route.collection(.forecastList, query: nil)).font(.caption))) {
                if fc.isEmpty && model.feed != nil {
                    EmptyStateView(empty: Search.empty(query: query, all: model.live, noun: "forecasts")) { q in model.push(.collection(.events, query: q)) }
                }
                ForecastTable(records: fc)
            }
            Panel("Events on high alert \u{00B7} \(high.count) (of \(highAll.count))", trailing: AnyView(RouteLink("All official warnings \u{2192}", value: Route.collection(.officialWarnings, query: nil)).font(.caption))) {
                Text(Copy.highAlertNote).font(.footnote).foregroundStyle(Theme.muted)
                if high.isEmpty { Text("No event on high alert matches these filters.").font(.footnote).foregroundStyle(Theme.muted) }
                LimitedList(items: high, page: 20) { e in
                    let place = [e.type, e.region, e.country].filter { !$0.isEmpty }
                    RelatedRow(record: e, line: (place.count > 1 ? place.joined(separator: " \u{00B7} ") : e.type + " \u{00B7} Location not stated by the source") +
                               "\n" + e.source + " \u{00B7} updated " + Format.age(e.updated))
                }
            }
            Panel("What changed since our last check") {
                Text(changes.headline).font(.footnote).foregroundStyle(Theme.textSoft)
                ForEach(changes.sections, id: \.title) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(s.title) (\(s.count))").font(.footnote.bold()).foregroundStyle(Theme.text)
                        ForEach(s.rows, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.muted) }
                        if s.more > 0 { Text("\u{2026}and \(s.more) more").font(.caption).foregroundStyle(Theme.muted) }
                    }
                }
            }
            Panel("How we make forecasts", trailing: AnyView(RouteLink("Methodology \u{2192}", value: Route.methodology).font(.caption))) {
                ForEach(Copy.howWeMakeForecasts, id: \.title) { i in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(i.title).font(.subheadline.bold()).foregroundStyle(Theme.text)
                        Text(i.body).font(.footnote).foregroundStyle(Theme.textSoft)
                    }
                }
            }
            Panel("Checking our forecasts", trailing: AnyView(RouteLink("How we check forecasts \u{2192}", value: Route.verification).font(.caption))) {
                Text("ND-001 \u{00B7} Central Vietnam flash-flood + landslide forecast").font(.subheadline.bold()).foregroundStyle(Theme.text)
                Text(Copy.nd001Blurb).font(.footnote).foregroundStyle(Theme.textSoft)
                RouteLink("See the ND-001 forecast \u{2192}", value: Route.forecast("ND-001")).font(.footnote)
            }
        }
    }
}

/// Forecast calendar (features.md section 4.2).
struct CalendarScreen: View {
    @EnvironmentObject var model: AppModel
    @State var query: String
    @State var hazard = ""
    @State var level = ""
    @State var sort = SortPicker.initial("forecast-calendar_sortBy", Sorts.forecastListSorts)

    var body: some View {
        let tz = model.zoneID
        let kept = model.live.filter { $0.forecast }
        let list = Sorts.apply(kept.filter { Search.matches($0, query) && (hazard.isEmpty || $0.type.lowercased() == hazard.lowercased()) && RiskScale.matches($0, level) }, sort)
        let cal = Screens.calendar(list, now: Format.now(), tz: tz)
        ScreenScroll(title: "Forecast calendar") {
            ScreenHeader(title: "Forecast calendar", subtitle: "Each current forecast, shown across the days it covers.")
            TrustNote()
            FeedBanner()
            SearchField(prompt: "Search", text: $query)
            FlowRow(spacing: 8) {
                MenuPicker(label: "Filter by hazard", selection: $hazard, options: Format.hazardOptions(kept, selected: hazard).map { ($0.value, $0.label) })
                RiskFilterPicker(selection: $level)
                SortPicker(screen: "forecast-calendar_sortBy", keys: Sorts.forecastListSorts, selection: $sort)
            }
            RefreshRow(status: model.statusLine())
            Text(Format.horizonText(model.meta, tz: tz) + " " + Copy.forecastNote).font(.footnote).foregroundStyle(Theme.muted)
            if list.isEmpty {
                MessageCard(title: Copy.calendarEmptyTitle, detail: Copy.calendarEmptyBody)
            } else {
                CalendarGrid(cal: cal)
            }
            Text(Copy.calendarNote).font(.footnote).foregroundStyle(Theme.muted)
        }
    }
}

struct CalendarGrid: View {
    let cal: Screens.Calendar
    @ScaledMetric var labelWidth: CGFloat = 118

    var trackWidth: CGFloat { max(520, CGFloat(cal.days.count) * 64) }

    var body: some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 6) {
                CalendarHeader(days: cal.days, labelWidth: labelWidth, trackWidth: trackWidth)
                ForEach(cal.groups, id: \.type) { g in
                    CalendarGroupView(type: g.type, bars: g.bars, nowPct: cal.nowPct, labelWidth: labelWidth, trackWidth: trackWidth)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("forecastCalendar")
    }
}

struct CalendarHeader: View {
    @EnvironmentObject var model: AppModel
    let days: [Double]
    let labelWidth: CGFloat
    let trackWidth: CGFloat

    var body: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: labelWidth)
            ForEach(Array(days.enumerated()), id: \.offset) { item in
                dayCell(index: item.offset, day: item.element)
            }
        }
    }

    func dayCell(index: Int, day: Double) -> some View {
        let l = Screens.dayLabel(day, tz: model.zoneID)
        let isToday = index == 0
        let numberColor: Color = isToday ? Color(hex: "#7EF0C0") : Theme.text
        let bg: Color = isToday ? Color(hex: "#0C3527") : Color.clear
        let width: CGFloat = trackWidth / CGFloat(max(1, days.count))
        return VStack(spacing: 0) {
            Text(l.dow).font(.caption2)
            Text(String(l.day)).font(.footnote.bold()).foregroundStyle(numberColor)
            Text(l.mon).font(.caption2)
        }
        .foregroundStyle(Color(hex: "#9EC7B6"))
        .frame(width: width)
        .background(bg)
    }
}

struct CalendarGroupView: View {
    let type: String
    let bars: [Screens.CalendarBar]
    let nowPct: Double
    let labelWidth: CGFloat
    let trackWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(type.uppercased()).font(.caption2.weight(.heavy)).tracking(1.2).foregroundStyle(Color(hex: "#7FD8B4"))
            ForEach(bars) { b in
                RouteLink(value: Route.detail(for: b.record)) {
                    CalendarBarRow(bar: b, nowPct: nowPct, labelWidth: labelWidth, trackWidth: trackWidth)
                }
                .buttonStyle(.plainArea)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label(b))
            }
        }
    }

    func label(_ b: Screens.CalendarBar) -> String {
        let live = b.live ? ", running now" : ""
        return Format.titleOf(b.record) + ", " + RiskScale.label(of: b.record) + ", " + b.label + live
    }
}

struct CalendarBarRow: View {
    let bar: Screens.CalendarBar
    let nowPct: Double
    let labelWidth: CGFloat
    let trackWidth: CGFloat

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                RecordRiskBadge(record: bar.record)
                Text(Format.placeOf(bar.record, "Place not given")).font(.caption).foregroundStyle(Theme.text).lineLimit(2)
            }
            .frame(width: labelWidth, alignment: .leading)
            track
        }
    }

    var track: some View {
        let lv = RiskScale.levelOf(bar.record.alert)
        let ink: Color = lv == .unknown ? Theme.ink : lv.inkColor
        let fill: Color = lv.fill ?? Color(hex: "#5FD3A6")
        let ring: Color = bar.live ? Color(hex: "#7EF0C0") : Color.clear
        let barWidth: CGFloat = max(24, trackWidth * CGFloat(bar.width) / 100)
        let barX: CGFloat = trackWidth * CGFloat(bar.left) / 100
        let nowX: CGFloat = trackWidth * CGFloat(nowPct) / 100
        return ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: "#082A20")).frame(width: trackWidth, height: 26)
            Text(bar.label).font(.caption2.weight(.semibold)).lineLimit(1)
                .foregroundStyle(ink)
                .padding(.horizontal, 4)
                .frame(width: barWidth, height: 20, alignment: .leading)
                .background(fill, in: RoundedRectangle(cornerRadius: 5))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(ring, lineWidth: 2))
                .offset(x: barX)
            Rectangle().fill(Color(hex: "#7EF0C0")).frame(width: 2, height: 26).offset(x: nowX)
        }
        .frame(width: trackWidth, alignment: .leading)
    }
}

/// "How we check forecasts" (features.md section 4.3).
struct VerificationListView: View {
    @EnvironmentObject var model: AppModel
    @State var sort = SortPicker.initial("verification_sortBy", Sorts.forecastListSorts)
    var body: some View {
        let list = Sorts.apply(model.all.filter { $0.forecast }, sort)
        ScreenScroll(title: "How we check forecasts") {
            ScreenHeader(title: "How we check forecasts", subtitle: "All our current forecasts, with the period each one covers and the report it is based on.")
            TrustNote()
            Notice(text: Copy.verificationNotice)
            SortPicker(screen: "verification_sortBy", keys: Sorts.forecastListSorts, selection: $sort)
            Panel("Current forecasts") {
                if list.isEmpty { Text(model.status == .failed ? Copy.loadError : Copy.loading).font(.footnote).foregroundStyle(Theme.muted) }
                LimitedList(items: list, page: 25) { e in
                    RouteLink(value: Route.forecast(e.id)) {
                        CardBox {
                            FlowRow { RecordRiskBadge(record: e); Pill(text: e.s("forecastKind") == "frozen-benchmark" ? "Test case" : "Based on a current report") }
                            Text(Format.titleOf(e)).font(.headline).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                            Text(Format.summary(e.details)).font(.footnote).foregroundStyle(Theme.textSoft)
                            KeyValueRow(key: "Forecast period", value: Format.windowText(e, tz: model.zoneID))
                            KeyValueRow(key: "Area", value: Format.placeOf(e, "-"))
                            KeyValueRow(key: "Hazard", value: e.type)
                            KeyValueRow(key: "Based on", value: e.s("evidence").isEmpty ? "-" : e.s("evidence"))
                            Text("See forecast details \u{2192}").font(.footnote.bold()).foregroundStyle(Theme.link)
                        }
                    }
                    .buttonStyle(.plainArea)
                }
            }
            Panel("How we check a forecast") {
                ForEach(Copy.verificationRules, id: \.title) { r in
                    KeyValueRow(key: r.title, value: r.body)
                }
            }
        }
    }
}
