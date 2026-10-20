import Foundation

/// The site's one six-level risk scale plus "Not rated" (`risk.js`, logic.md section 2).
/// Every rendering carries colour AND text AND a shape.
public enum RiskLevel: String, CaseIterable, Sendable, Codable {
    case low = "LOW", watch = "WATCH", moderate = "MODERATE", high = "HIGH", severe = "SEVERE", extreme = "EXTREME"
    case unknown = "UNKNOWN"

    public enum Shape: String, Sendable { case circle, ring, triangle, diamond, hexagon, star, hollow }

    public var key: String { rawValue }

    public var label: String {
        switch self {
        case .low: return "Low"
        case .watch: return "Watch"
        case .moderate: return "Moderate"
        case .high: return "High"
        case .severe: return "Severe"
        case .extreme: return "Extreme"
        case .unknown: return "Not rated"
        }
    }

    /// Fill colour (hex). Nil for Not rated, which takes no colour from the scale.
    public var colourHex: String? {
        switch self {
        case .low: return "#22C55E"
        case .watch: return "#FACC15"
        case .moderate: return "#F97316"
        case .high: return "#EF4444"
        case .severe: return "#B91C1C"
        case .extreme: return "#7C3AED"
        case .unknown: return nil
        }
    }

    /// Text colour on the swatch, chosen to clear 4.5:1.
    public var inkHex: String? {
        switch self {
        case .low, .watch, .moderate, .high: return "#000000"
        case .severe, .extreme: return "#FFFFFF"
        case .unknown: return nil
        }
    }

    public var rank: Int {
        switch self {
        case .unknown: return 0
        case .low: return 1
        case .watch: return 2
        case .moderate: return 3
        case .high: return 4
        case .severe: return 5
        case .extreme: return 6
        }
    }

    public var shape: Shape {
        switch self {
        case .low: return .circle
        case .watch: return .ring
        case .moderate: return .triangle
        case .high: return .diamond
        case .severe: return .hexagon
        case .extreme: return .star
        case .unknown: return .hollow
        }
    }

    public var shapeName: String {
        switch self {
        case .low: return "filled circle"
        case .watch: return "ring"
        case .moderate: return "triangle"
        case .high: return "diamond"
        case .severe: return "hexagon"
        case .extreme: return "star"
        case .unknown: return "hollow circle"
        }
    }

    /// Map marker size in points: `9 + rank*3`.
    public var markerSize: Double { Double(9 + rank * 3) }
    /// Map z-order: higher levels draw on top.
    public var zIndex: Int { rank * 1000 }

    /// The six levels, lowest first (`LEVELS`).
    public static let scale: [RiskLevel] = [.low, .watch, .moderate, .high, .severe, .extreme]

    /// Filter options, in order (`riskLevelOptions`).
    public static let filterOptions: [RiskLevel] = [.extreme, .severe, .high, .moderate, .watch, .low, .unknown]

    public init(key: String?) {
        self = RiskLevel(rawValue: key ?? "") ?? .unknown
    }
}

public enum RiskScale {
    public static let vocabulary: [(RiskLevel, JSRegex)] = [
        (.extreme, JSRegex(#"\b(?:extreme|catastrophic|very\s*high|purple)\b"#, caseInsensitive: true)),
        (.severe, JSRegex(#"\b(?:severe|critical)\b"#, caseInsensitive: true)),
        (.high, JSRegex(#"\b(?:high|red|significant)\b"#, caseInsensitive: true)),
        (.moderate, JSRegex(#"\b(?:moderate|orange)\b"#, caseInsensitive: true)),
        (.watch, JSRegex(#"\b(?:watch|advisory|minor|yellow|amber|elevated)\b"#, caseInsensitive: true)),
        (.low, JSRegex(#"\b(?:low|green|informational|routine|normal)\b"#, caseInsensitive: true))
    ]

    /// `levelOf(value)`: the level a provider's word means, or UNKNOWN.
    public static func levelOf(_ value: String?) -> RiskLevel {
        let s = value ?? ""
        if s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .unknown }
        for (level, re) in vocabulary where re.test(s) { return level }
        return .unknown
    }

    public static func levelOf(_ value: JSONValue?) -> RiskLevel {
        guard let v = value, !v.isNull else { return .unknown }
        return levelOf(v.jsString)
    }

    public static func rankOf(_ value: String?) -> Int { levelOf(value).rank }

    /// The record's one resolved level: severity wins, the alert only where
    /// there is no severity (`PND.riskTag`, `riskLabel`, `matchesRiskLevel`).
    public static func level(of e: Record) -> RiskLevel {
        let sv = levelOf(e["severity"])
        if sv != .unknown { return sv }
        return levelOf(e["alert"])
    }

    /// `riskLabel(e)`.
    public static func label(of e: Record) -> String { level(of: e).label }

    /// `matchesRiskLevel(e, key)`; an empty key matches everything.
    public static func matches(_ e: Record, _ key: String?) -> Bool {
        guard let key = key, !key.isEmpty else { return true }
        return level(of: e).rawValue == key
    }

    /// The badge's accessibility label / tooltip (`riskTag` title).
    public static func badgeTitle(of e: Record) -> String {
        let rawAlert = e["alert"], rawSev = e["severity"]
        let a = levelOf(rawAlert), sv = levelOf(rawSev)
        let top: RiskLevel = sv != .unknown ? sv : a
        if top == .unknown {
            return "No alert level was published for this record and no severity has been assessed for it."
        }
        var from: [String] = []
        let alertBy = e.first("alertSource", "source")?.jsString ?? ""
        if a != .unknown {
            from.append("the alert level \u{201C}" + (rawAlert?.jsString ?? "") + "\u{201D}" +
                (alertBy.isEmpty ? "" : " published by " + Format.shortSource(alertBy)))
        }
        if sv != .unknown { from.append("an assessed severity of \u{201C}" + (rawSev?.jsString ?? "") + "\u{201D}") }
        return top.label + " on this site\u{2019}s six-level risk scale, from " + from.joined(separator: " and ") +
            (a != .unknown && sv != .unknown && a != sv ? ". Where these differ the higher decides." : ".")
    }

    public struct Marker: Equatable, Sendable {
        public let level: RiskLevel
        public let colourHex: String?
        public let size: Double
        public let label: String
    }

    /// `markerIcon(alert, title)`: markers use the alert only.
    public static func marker(alert: String?, label: String?) -> Marker {
        let lv = levelOf(alert)
        let name = ((label ?? "").isEmpty ? "" : label! + " - ") + lv.label + " risk"
        return Marker(level: lv, colourHex: lv.colourHex, size: lv.markerSize, label: name)
    }

    public static func marker(for e: Record) -> Marker {
        marker(alert: e.alert, label: Format.titleOf(e))
    }
}
