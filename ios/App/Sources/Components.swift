import SwiftUI
import PNDCore

/// Which tab's stack a view sits in, so links push onto the stack the person sees.
private struct StackTabKey: EnvironmentKey { static let defaultValue: AppTab = .home }
extension EnvironmentValues {
    var stackTab: AppTab {
        get { self[StackTabKey.self] }
        set { self[StackTabKey.self] = newValue }
    }
}

/// A link to an in-app route. It appends the route to the path of the stack it
/// sits in, the same way deep links open screens. SwiftUI value links did not
/// push inside the iPad split view's detail column, so every route link in the
/// app goes through this one path on iPhone and iPad alike.
struct RouteLink<Label: View>: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.stackTab) var stackTab
    let route: Route
    let label: Label

    init(value: Route, @ViewBuilder label: () -> Label) {
        self.route = value
        self.label = label()
    }

    var body: some View {
        Button {
            // A tab's own screen opens its tab ("Risk map" selects Map), not
            // a copy of it inside the current stack.
            if let tab = AppTab.allCases.first(where: { $0.rootRoute == route }) {
                model.showTab(tab)
            } else {
                model.paths[stackTab, default: []].append(route)
            }
        } label: { label }
    }
}

extension RouteLink where Label == Text {
    init(_ title: String, value: Route) {
        self.init(value: value) { Text(title) }
    }
}

/// The shared record card (features.md section 0.4).
struct EventCard: View {
    @EnvironmentObject var model: AppModel
    let record: Record
    var showImpactLine = false
    var showSavedCopy = false

    var body: some View {
        RouteLink(value: Route.detail(for: record)) {
            CardBox {
                FlowRow {
                    RecordRiskBadge(record: record)
                    SourcePill(source: record.source)
                    if let fp = Format.forecastPill(record) { Pill(text: fp) }
                    if record.windowClosed { Pill(text: "Forecast period ended") }
                    if showSavedCopy && record.cached { Pill(text: "Saved copy") }
                }
                Text(Format.titleOf(record)).font(.headline).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(record.type + " \u{00B7} " + Format.placeOf(record, "Place not given"))
                    .font(.footnote).foregroundStyle(Theme.textSoft)
                let line = Format.cardLine(record)
                if !line.text.isEmpty {
                    Text(line.text).font(line.isFacts ? .footnote.bold() : .footnote).foregroundStyle(Color(hex: "#ABC7BB"))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(footer).font(.caption).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plainArea)
        .accessibilityIdentifier("eventCard")
    }

    var footer: String {
        let tz = model.zoneID
        let w = record.forecast && record.truthy("targetEnd") ? Format.windowText(record, tz: tz) + " \u{00B7} " : ""
        return w + "Source updated " + Format.fmtDate(record.updated, tz: tz) + " \u{00B7} " + Format.age(record.updated)
    }
}

/// A wrapping row of pills.
struct FlowRow: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, maxW), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
        }
    }
}

/// "↻ Refresh now" plus the status line.
struct RefreshRow: View {
    @EnvironmentObject var model: AppModel
    var label = "\u{21BB} Refresh now"
    var status: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await model.load(fresh: true) }
            } label: {
                HStack(spacing: 6) {
                    if model.refreshing { ProgressView().tint(Theme.text) }
                    Text(label)
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("refreshButton")
            Text(status).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("statusLine")
        }
    }
}

/// A scrolling screen with the shared background, pull to refresh (`?ts=`) and spacing.
struct ScreenScroll<Content: View>: View {
    @EnvironmentObject var model: AppModel
    var title: String
    var refreshable = true
    var onRefresh: (() async -> Void)? = nil
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { content }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: 980, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .refreshable {
            if let r = onRefresh { await r() } else if refreshable { await model.load(fresh: true) }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A compact row for a related record ("{km} km away · {type}").
struct RelatedRow: View {
    @EnvironmentObject var model: AppModel
    let record: Record
    var line: String
    var body: some View {
        RouteLink(value: Route.detail(for: record)) {
            CardBox {
                FlowRow { RecordRiskBadge(record: record); SourcePill(source: record.source) }
                Text(record.title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                Text(line).font(.footnote).foregroundStyle(Theme.muted)
                Text(Format.fmtDate(record.updated, tz: model.zoneID)).font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .buttonStyle(.plainArea)
    }
}

/// Shows the first `limit` items and a "Show more" button.
struct LimitedList<Item, Row: View>: View {
    let items: [Item]
    var page = 25
    @ViewBuilder let row: (Item) -> Row
    @State var shown: Int = 0

    var body: some View {
        let n = shown == 0 ? page : shown
        LazyVStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.prefix(n).enumerated()), id: \.offset) { _, it in row(it) }
        }
        if items.count > n {
            HStack {
                Text("Showing \(n) of \(items.count).").font(.footnote).foregroundStyle(Theme.muted)
                Spacer()
                Button("Show \(page) more") { shown = n + page }.buttonStyle(SecondaryButtonStyle())
                Button("Show all") { shown = items.count }.buttonStyle(SecondaryButtonStyle())
            }
        } else if !items.isEmpty {
            Text("Showing all \(items.count).").font(.footnote).foregroundStyle(Theme.muted)
        }
    }
}

/// Share sheet item for a detail screen.
struct ShareButton: View {
    let route: Route
    let title: String
    var body: some View {
        ShareLink(item: route.webURL, subject: Text(title), message: Text(title)) {
            Image(systemName: "square.and.arrow.up")
        }
        .accessibilityLabel("Share")
        .accessibilityIdentifier("shareButton")
    }
}

/// The quiet note under a detail title.
struct QuietNote: View {
    let text: String
    var body: some View {
        if !text.isEmpty { Notice(text: text, stale: true).accessibilityIdentifier("quietNote") }
    }
}

/// `PND.unavailableHtml()`: the card a list shows when nothing has loaded
/// (changelog C19). A failed load is not an empty world.
struct UnavailableCard: View {
    var body: some View {
        MessageCard(title: Format.unavailableTitle, detail: Format.unavailableBody)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("unavailableCard")
    }
}
