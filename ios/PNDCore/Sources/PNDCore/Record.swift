import Foundation

/// One record from the feed (or a ledger row, a past disaster, a region group):
/// a JSON object read with the website's own semantics.
///
/// Every field except `id`, `lat`, `lon`, `type`, `title`, `source` and
/// `sourceType` is optional (api.md section 8), unknown fields are kept, and a
/// missing number is never coerced to zero (logic.md section 5).
public struct Record: Hashable, Sendable, Identifiable {
    public let raw: [String: JSONValue]
    /// `String(e.id)` (empty when absent).
    public let id: String
    /// `timeOf(e)`: `parse(updated || targetStart || startedAt)`, 0 when absent.
    public let time: Double
    /// Lower-cased search text (`search.js searchText`).
    public let searchText: String

    public init(_ raw: [String: JSONValue]) {
        self.raw = raw
        if let v = raw["id"], !v.isNull { id = v.jsString } else { id = "" }
        let t = Record.firstTruthy(raw, ["updated", "targetStart", "startedAt"])
        time = JSDate.ms(t?.jsString) ?? 0
        searchText = Search.buildSearchText(raw)
    }

    public init?(json: JSONValue) {
        guard let o = json.objectValue else { return nil }
        self.init(o)
    }

    public subscript(key: String) -> JSONValue? { raw[key] }

    /// A copy with fields replaced (nil removes the field).
    public func with(_ changes: [String: JSONValue?]) -> Record {
        var r = raw
        for (k, v) in changes {
            if let v = v { r[k] = v } else { r.removeValue(forKey: k) }
        }
        return Record(r)
    }

    public static func firstTruthy(_ raw: [String: JSONValue], _ keys: [String]) -> JSONValue? {
        for k in keys { if let v = raw[k], v.isTruthy { return v } }
        return nil
    }

    /// The first truthy value among the keys (JavaScript `a || b || c`).
    public func first(_ keys: String...) -> JSONValue? { Record.firstTruthy(raw, keys) }

    /// `String(e[key] || '')`.
    public func s(_ key: String) -> String {
        guard let v = raw[key], v.isTruthy else { return "" }
        return v.jsString
    }

    /// The string value, or nil when not published (absent, null or "").
    public func opt(_ key: String) -> String? {
        guard let v = raw[key], v.has else { return nil }
        return v.jsString
    }

    public func truthy(_ key: String) -> Bool { raw[key]?.isTruthy ?? false }

    /// Published (not absent, null or "") and finite, as a number.
    public func num(_ key: String) -> Double? {
        guard let v = raw[key], v.has else { return nil }
        let n = v.jsNumber
        return n.isFinite ? n : nil
    }

    /// `Number(e[key])` with JavaScript semantics (absent is NaN, null is 0).
    public func jsNumber(_ key: String) -> Double {
        guard let v = raw[key] else { return .nan }
        return v.jsNumber
    }

    /// `numOf`: the finite number, or 0.
    public func numOf(_ key: String) -> Double {
        let n = jsNumber(key)
        return n.isFinite ? n : 0
    }

    public func ms(_ key: String) -> Double? { JSDate.ms(raw[key]?.isTruthy == true ? raw[key]?.jsString : nil) }

    // MARK: common fields

    public var title: String { s("title") }
    public var type: String { s("type") }
    public var source: String { s("source") }
    public var sourceType: String { s("sourceType") }
    public var evidenceState: String { s("evidenceState") }
    public var alert: String { s("alert") }
    public var severity: String { s("severity") }
    public var country: String { s("country") }
    public var region: String { s("region") }
    public var details: String { s("details") }
    public var forecast: Bool { truthy("forecast") }
    public var isForecast: Bool { truthy("isForecast") }
    public var anyForecast: Bool { forecast || isForecast }
    public var cached: Bool { truthy("cached") }
    /// Absent means live (api.md 1.4); only an explicit `false` is quiet.
    public var isLive: Bool { raw["live"] != .bool(false) }
    public var windowClosed: Bool { truthy("windowClosed") }
    public var lat: Double? { Geo.coord(raw["lat"]) }
    public var lon: Double? { Geo.coord(raw["lon"]) }
    public var hasCoordinates: Bool { lat != nil && lon != nil }
    public var isOfficial: Bool { sourceType == "official" }
    public var isRedOrOrange: Bool { alert == "Red" || alert == "Orange" }
    public var updated: String { s("updated") }
    public var sourceURL: URL? {
        let u = s("sourceUrl")
        guard !u.isEmpty else { return nil }
        return URL(string: u, relativeTo: API.baseURL)?.absoluteURL
    }
    public var geometry: JSONValue? { raw["geometry"] }
    public var corroboratedBy: [String] { raw["corroboratedBy"]?.arrayValue?.compactMap { $0.stringValue } ?? [] }
    public var countries: [String] { raw["countries"]?.arrayValue?.compactMap { $0.stringValue } ?? [] }

    public static func == (a: Record, b: Record) -> Bool { a.raw == b.raw }
    public func hash(into h: inout Hasher) { h.combine(id); h.combine(time) }
}

public typealias Event = Record
