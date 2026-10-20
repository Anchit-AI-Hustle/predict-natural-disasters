import SwiftUI
import PNDCore

/// Dark theme tokens from design.md section 1 (the site has no light theme).
enum Theme {
    static let bg = Color(hex: "#02110D")
    static let panel = Color(hex: "#06261D")
    static let panelTop = Color(hex: "#07251B")
    static let panelBottom = Color(hex: "#051B14")
    static let card = Color(hex: "#09231B")
    static let cardAlt = Color(hex: "#08251C")
    static let line = Color(hex: "#156047")
    static let panelBorder = Color(hex: "#1D654C")
    static let cardBorder = Color(hex: "#285C49")
    static let inputBorder = Color(hex: "#285F4B")
    static let divider = Color(hex: "#1B5745")
    static let text = Color(hex: "#F5FBF8")
    static let textSoft = Color(hex: "#CFE3DA")
    static let muted = Color(hex: "#91B4A6")
    static let label = Color(hex: "#8EAA9E")
    static let green = Color(hex: "#25E29C")
    static let greenText = Color(hex: "#8FF0CA")
    static let link = Color(hex: "#6FE3FF")
    static let amber = Color(hex: "#FFBF2F")
    static let ink = Color(hex: "#04120E")
    static let provBorder = Color(hex: "#2B624E")
    static let sourceText = Color(hex: "#9FD0BB")
    static let noticeBorder = Color(hex: "#735C1C")
    static let noticeFill = Color(hex: "#211C0B")
    static let noticeText = Color(hex: "#D7CDA5")
    static let staleBorder = Color(hex: "#A96E28")
    static let staleFill = Color(hex: "#2A1B09")
    static let trustFill = Color(hex: "#071F18")
    static let trustWhen = Color(hex: "#9FBCB0")
    static let authority = Color(hex: "#FFD9A8")
    static let actionAccent = Color(hex: "#FFB15E")
    static let ok = Color(hex: "#8FF0CB"), okBorder = Color(hex: "#25E29C")
    static let warn = Color(hex: "#F2D894"), warnBorder = Color(hex: "#E9B949")
    static let bad = Color(hex: "#FFA7B0"), badBorder = Color(hex: "#EF5261")
    static let mutedPill = Color(hex: "#C2CFCA"), mutedPillBorder = Color(hex: "#9AA7A2")
    static let seriousRow = Color(hex: "#EF2639")

    static func verdictColours(_ css: String) -> (Color, Color) {
        switch css {
        case "verified": return (ok, okBorder)
        case "partial": return (warn, warnBorder)
        case "alarm", "unknown": return (bad, badBorder)
        case "missed", "notprediction": return (Color(hex: "#DCB6FF"), Color(hex: "#C168FF"))
        case "open": return (text, Color(hex: "#3A9DF7"))
        case "awaiting": return (text, Color(hex: "#8FA8A0"))
        case "ungradeable": return (text, Color(hex: "#6F8B82"))
        default: return (mutedPill, mutedPillBorder)
        }
    }
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = UInt64(s, radix: 16) ?? 0
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: 1)
    }
}

extension RiskLevel {
    var fill: Color? { colourHex.map { Color(hex: $0) } }
    var inkColor: Color { inkHex.map { Color(hex: $0) } ?? Theme.muted }
}

// MARK: - Shapes (design.md section 3.2)

struct RiskShape: Shape {
    let level: RiskLevel

    func path(in r: CGRect) -> Path {
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: r.minX + x * r.width, y: r.minY + y * r.height) }
        func poly(_ ps: [(CGFloat, CGFloat)]) -> Path {
            var p = Path()
            p.addLines(ps.map { pt($0.0, $0.1) })
            p.closeSubpath()
            return p
        }
        switch level.shape {
        case .circle: return Path(ellipseIn: r)
        case .ring:
            var p = Path(ellipseIn: r)
            let c = CGPoint(x: r.midX, y: r.midY), rad = min(r.width, r.height) / 2
            p.addEllipse(in: CGRect(x: c.x - rad * 0.58, y: c.y - rad * 0.58, width: rad * 1.16, height: rad * 1.16))
            p.addEllipse(in: CGRect(x: c.x - rad * 0.28, y: c.y - rad * 0.28, width: rad * 0.56, height: rad * 0.56))
            return p
        case .triangle: return poly([(0.5, 0), (1, 1), (0, 1)])
        case .diamond: return poly([(0.5, 0), (1, 0.5), (0.5, 1), (0, 0.5)])
        case .hexagon: return poly([(0.25, 0), (0.75, 0), (1, 0.5), (0.75, 1), (0.25, 1), (0, 0.5)])
        case .star: return poly([(0.5, 0), (0.61, 0.39), (1, 0.5), (0.61, 0.61), (0.5, 1), (0.39, 0.61), (0, 0.5), (0.39, 0.39)])
        case .hollow: return Path(ellipseIn: r.insetBy(dx: 0.5, dy: 0.5))
        }
    }
}

/// The shape glyph in a badge: filled (even-odd for the ring), or stroked when unknown.
struct RiskGlyph: View {
    let level: RiskLevel
    let color: Color
    var body: some View {
        if level == .unknown {
            RiskShape(level: level).stroke(color, lineWidth: 1)
        } else {
            RiskShape(level: level).fill(color, style: FillStyle(eoFill: true))
        }
    }
}

// MARK: - Badges and pills

/// The risk badge: colour, shape and the level's word, always together.
struct RiskBadge: View {
    let level: RiskLevel
    var text: String?
    var accessibilityText: String?
    @ScaledMetric(relativeTo: .caption2) var glyph: CGFloat = 8

    init(level: RiskLevel, text: String? = nil, accessibilityText: String? = nil) {
        self.level = level
        self.text = text
        self.accessibilityText = accessibilityText
    }

    var body: some View {
        HStack(spacing: glyph * 0.6) {
            RiskGlyph(level: level, color: level.inkColor)
                .frame(width: glyph, height: glyph)
                .accessibilityHidden(true)
            Text(text ?? level.label)
                .font(.caption2.weight(.heavy))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(level.inkColor)
        }
        .padding(.vertical, 3).padding(.horizontal, 7)
        .background(level.fill ?? Color.clear, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(level == .unknown ? Theme.provBorder : Color.clear, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText ?? ((text ?? level.label) + ", " + level.shapeName))
        .accessibilityIdentifier("riskBadge")
    }
}

/// The badge for a record (`PND.riskTag`).
struct RecordRiskBadge: View {
    let record: Record
    var body: some View {
        RiskBadge(level: RiskScale.level(of: record), accessibilityText: RiskScale.badgeTitle(of: record))
    }
}

/// "Nothing reported nearby": neutral, outlined, never a level.
struct NothingNearbyChip: View {
    var body: some View {
        RiskBadge(level: .unknown, text: Copy.nothingNearbyChip,
                  accessibilityText: "Nothing reported nearby. This does not mean the place is safe.")
    }
}

/// Neutral outlined pill (provenance, source): never a risk colour.
struct Pill: View {
    let text: String
    var color: Color = Theme.textSoft
    var border: Color = Theme.provBorder
    var uppercase = false
    var accessibility: String? = nil

    var body: some View {
        Text(uppercase ? text.uppercased() : text)
            .font(.caption2.weight(.heavy))
            .lineLimit(1)
            .foregroundStyle(color)
            .padding(.vertical, 2).padding(.horizontal, 7)
            .overlay(Capsule().stroke(border, lineWidth: 1))
            .accessibilityLabel(accessibility ?? text)
    }
}

struct SourcePill: View {
    let source: String
    var body: some View {
        Pill(text: Format.shortSource(source), color: Theme.sourceText, accessibility: "Source: " + (source.isEmpty ? "Source not stated" : source))
    }
}

struct VerdictPill: View {
    let text: String
    let css: String
    var body: some View {
        let c = Theme.verdictColours(css)
        Pill(text: text, color: c.0, border: c.1)
    }
}

// MARK: - Containers

struct Panel<Content: View>: View {
    let title: String?
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content

    init(_ title: String? = nil, trailing: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.trailing = trailing; self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let t = title {
                HStack(alignment: .firstTextBaseline) {
                    Text(t).font(.headline).foregroundStyle(Theme.text).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    if let tr = trailing { tr }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                Divider().overlay(Theme.divider)
            }
            VStack(alignment: .leading, spacing: 8) { content }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(LinearGradient(colors: [Theme.panelTop, Theme.panelBottom], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.panelBorder, lineWidth: 1))
    }
}

struct CardBox<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.cardBorder, lineWidth: 1))
    }
}

struct Notice: View {
    let text: String
    var stale = false
    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(stale ? Theme.text : Theme.noticeText)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(stale ? Theme.staleFill : Theme.noticeFill, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(stale ? Theme.staleBorder : Theme.noticeBorder, lineWidth: 1))
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.caption2.weight(.heavy)).tracking(1.2).foregroundStyle(Theme.label)
    }
}

struct ScreenHeader: View {
    var eyebrow: String? = nil
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let e = eyebrow { Eyebrow(text: e) }
            Text(title).font(.largeTitle.bold()).foregroundStyle(Theme.text).accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let s = subtitle { Text(s).font(.body).foregroundStyle(Theme.textSoft).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A stat line item: big number, small lower-case label.
struct Stat: View {
    let value: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.bold().monospacedDigit()).foregroundStyle(Theme.text)
            Text(label.lowercased()).font(.footnote).foregroundStyle(Theme.muted)
        }
        .accessibilityElement(children: .combine)
    }
}

struct StatGrid: View {
    let items: [(String, String)]
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .topLeading)], alignment: .leading, spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in Stat(value: it.1, label: it.0) }
        }
    }
}

struct KeyValueRow: View {
    let key: String
    let value: String
    var muted = false
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(key.uppercased()).font(.caption2.weight(.heavy)).foregroundStyle(Theme.label)
            Text(value).font(.subheadline).foregroundStyle(muted ? Theme.muted : Theme.text).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The key facts grid: a missing value says "Not reported", never 0.
struct KeyFactsGrid: View {
    let record: Record
    var body: some View {
        let facts = Hazards.keyFacts(record)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 6)], spacing: 6) {
            ForEach(facts, id: \.key) { f in
                VStack(alignment: .leading, spacing: 3) {
                    Text(f.label.uppercased()).font(.caption2.weight(.heavy)).foregroundStyle(Theme.label)
                    Text(f.reported ? (f.value ?? "") : "Not reported")
                        .font(f.reported ? .headline : .caption.weight(.semibold))
                        .foregroundStyle(f.reported ? Theme.text : Theme.muted)
                }
                .padding(8)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .topLeading)
                .background(Theme.cardAlt, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.divider, lineWidth: 1))
                .accessibilityElement(children: .combine)
                .accessibilityHint(f.note ?? "")
            }
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.heavy))
            .foregroundStyle(Theme.ink)
            .padding(.vertical, 12).padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(Theme.green.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 9))
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(Theme.text)
            .padding(.vertical, 10).padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Color(hex: "#0B3E2E").opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color(hex: "#2E6B55"), lineWidth: 1))
    }
}

struct OutlinePillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.bold))
            .foregroundStyle(Theme.greenText)
            .padding(.vertical, 6).padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .overlay(Capsule().stroke(Theme.provBorder, lineWidth: 1).padding(.vertical, 6))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A styled text field.
struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(minHeight: 44)
            .foregroundStyle(Theme.text)
            .background(Color(hex: "#09251D"), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.inputBorder, lineWidth: 1))
    }
}

extension View {
    func fieldStyle() -> some View { modifier(FieldStyle()) }

    /// The standard screen background and list spacing.
    func screenBackground() -> some View {
        self.background(Theme.bg.ignoresSafeArea())
    }
}

/// A picker styled as a compact menu with a label.
struct MenuPicker: View {
    let label: String
    @Binding var selection: String
    let options: [(String, String)]
    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                Button { selection = o.0 } label: {
                    if selection == o.0 { Label(o.1, systemImage: "checkmark") } else { Text(o.1) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(options.first { $0.0 == selection }?.1 ?? label).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 10).frame(minHeight: 44)
            .background(Color(hex: "#09251D"), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.inputBorder, lineWidth: 1))
        }
        .accessibilityLabel(label)
        .accessibilityValue(options.first { $0.0 == selection }?.1 ?? "")
    }
}

/// The per-screen sort control, remembered per screen.
struct SortPicker: View {
    let screen: String
    let keys: [String]
    @Binding var selection: String
    var body: some View {
        MenuPicker(label: "Sort results", selection: $selection, options: keys.map { ($0, Sorts.label($0)) })
            .onChange(of: selection) { _, v in UserDefaults.standard.set(v, forKey: "pnd_sort_" + screen) }
    }

    static func initial(_ screen: String, _ keys: [String]) -> String {
        let v = UserDefaults.standard.string(forKey: "pnd_sort_" + screen) ?? ""
        return keys.contains(v) ? v : keys[0]
    }
}

struct RiskFilterPicker: View {
    @Binding var selection: String
    var body: some View {
        MenuPicker(label: "Filter by risk level", selection: $selection,
                   options: [("", "All risk levels")] + RiskLevel.filterOptions.map { ($0.rawValue, $0.label) })
    }
}

struct SearchField: View {
    let prompt: String
    @Binding var text: String
    var onSubmit: (() -> Void)? = nil
    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted).accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.muted))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { onSubmit?() }
                .accessibilityLabel(prompt)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                    .accessibilityLabel("Clear search")
            }
        }
        .fieldStyle()
    }
}

/// Empty and failure states with the site's wording.
struct EmptyStateView: View {
    let empty: Search.Empty
    var onOpenEvents: ((String) -> Void)? = nil
    var body: some View {
        CardBox {
            Text(empty.title).font(.headline).foregroundStyle(Theme.text)
            if let d = empty.detail { Text(d).font(.subheadline).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
            if let b = empty.buttonText {
                Button(b) { onOpenEvents?(empty.query) }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .accessibilityIdentifier("emptyState")
    }
}

struct MessageCard: View {
    let title: String
    var detail: String? = nil
    var body: some View {
        CardBox {
            Text(title).font(.headline).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
            if let b = detail { Text(b).font(.subheadline).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
        }
    }
}
