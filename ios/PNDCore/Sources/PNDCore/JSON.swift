import Foundation

/// A JSON value that keeps every field the API sends, including ones this app
/// does not know about yet (api.md section 8: "Keep unknown fields").
///
/// The website reads these records with JavaScript semantics (`||`, truthiness,
/// `Number(v)`, `String(v)`), and several rules depend on them exactly (logic.md
/// section 1). The helpers below reproduce those semantics so the ports can be
/// written the way the site's code reads.
public enum JSONValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let d): try c.encode(d)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

public extension JSONValue {
    /// Parses JSON bytes. Uses JSONSerialization, which is lenient and fast on
    /// both Apple platforms and Linux.
    static func parse(_ data: Data) throws -> JSONValue {
        let any = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return JSONValue(any: any)
    }

    init(any: Any?) {
        guard let any = any else { self = .null; return }
        if any is NSNull { self = .null; return }
        if let s = any as? String { self = .string(s); return }
        if let n = any as? NSNumber {
            // CFBoolean is an NSNumber; tell the two apart.
            #if canImport(ObjectiveC)
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue); return }
            #else
            if String(describing: type(of: any)).contains("Boolean") || String(cString: n.objCType) == "c" { self = .bool(n.boolValue); return }
            #endif
            self = .number(n.doubleValue); return
        }
        if let b = any as? Bool { self = .bool(b); return }
        if let i = any as? Int { self = .number(Double(i)); return }
        if let d = any as? Double { self = .number(d); return }
        if let a = any as? [Any] { self = .array(a.map { JSONValue(any: $0) }); return }
        if let o = any as? [String: Any] {
            var out: [String: JSONValue] = [:]
            for (k, v) in o { out[k] = JSONValue(any: v) }
            self = .object(out); return
        }
        self = .null
    }

    /// Foundation object for JSONSerialization.
    var foundationObject: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let d): return d
        case .string(let s): return s
        case .array(let a): return a.map { $0.foundationObject }
        case .object(let o): return o.mapValues { $0.foundationObject }
        }
    }

    func data() -> Data {
        (try? JSONSerialization.data(withJSONObject: foundationObject, options: [.fragmentsAllowed, .sortedKeys])) ?? Data()
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    subscript(index: Int) -> JSONValue? {
        if case .array(let a) = self, index >= 0, index < a.count { return a[index] }
        return nil
    }

    var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    var numberValue: Double? { if case .number(let d) = self { return d }; return nil }
    var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    var isNull: Bool { if case .null = self { return true }; return false }

    /// JavaScript truthiness.
    var isTruthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let d): return d != 0 && !d.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// JavaScript `String(v)`.
    var jsString: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let d): return JS.numberString(d)
        case .string(let s): return s
        case .array(let a): return a.map { $0.isNull ? "" : $0.jsString }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    /// JavaScript `Number(v)`.
    var jsNumber: Double {
        switch self {
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .number(let d): return d
        case .string(let s): return JS.number(s)
        case .array(let a):
            if a.isEmpty { return 0 }
            if a.count == 1 { return a[0].isNull ? 0 : JS.number(a[0].jsString) }
            return .nan
        case .object: return .nan
        }
    }

    /// Not undefined, null or the empty string (logic.md section 1 "published").
    var has: Bool {
        switch self {
        case .null: return false
        case .string(let s): return !s.isEmpty
        default: return true
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        var o: [String: JSONValue] = [:]
        for (k, v) in elements { o[k] = v }
        self = .object(o)
    }
}

/// JavaScript helpers used across the ports.
public enum JS {
    /// `Number(string)`: trimmed, empty is 0, otherwise a decimal (or hex,
    /// Infinity) literal, else NaN.
    public static func number(_ s: String) -> Double {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return 0 }
        if t == "Infinity" || t == "+Infinity" { return .infinity }
        if t == "-Infinity" { return -.infinity }
        let lower = t.lowercased()
        if lower.hasPrefix("0x"), let v = UInt64(lower.dropFirst(2), radix: 16) { return Double(v) }
        // Only plain decimal syntax: Swift's Double(String) also accepts "nan",
        // "inf" and hex floats, which JavaScript does not.
        let allowed = Set("0123456789+-.eE")
        guard t.allSatisfy({ allowed.contains($0) }), let d = Double(t) else { return .nan }
        return d
    }

    /// `String(number)` for the values this app prints.
    public static func numberString(_ d: Double) -> String {
        if d.isNaN { return "NaN" }
        if d.isInfinite { return d > 0 ? "Infinity" : "-Infinity" }
        if d == d.rounded(), abs(d) < 1e21 {
            if d == 0 { return "0" }
            return String(format: "%.0f", d)
        }
        var s = "\(d)"
        // Swift prints 1e-07 style for small values; JavaScript uses 1e-7.
        if let r = s.range(of: "e-0") { s.replaceSubrange(r, with: "e-") }
        return s
    }

    /// `Math.round`: half rounds toward positive infinity.
    public static func round(_ x: Double) -> Double {
        if x.isNaN || x.isInfinite { return x }
        let f = x.rounded(.down)
        return (x - f) >= 0.5 ? f + 1 : f
    }

    /// `Number.prototype.toFixed(digits)` for finite values.
    public static func toFixed(_ x: Double, _ digits: Int) -> String {
        guard x.isFinite else { return numberString(x) }
        let scale = pow(10.0, Double(digits))
        let scaled = abs(x) * scale
        let floorV = scaled.rounded(.down)
        // An exact tie picks the larger magnitude, as the specification says.
        if scaled - floorV == 0.5 {
            let n = (floorV + 1) / scale * (x < 0 ? -1 : 1)
            return String(format: "%.\(digits)f", n)
        }
        return String(format: "%.\(digits)f", x)
    }

    /// `encodeURIComponent`.
    public static func encodeURIComponent(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"))
        allowed.insert(charactersIn: "-_.!~*'()")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// `decodeURIComponent`, returning nil where JavaScript would throw.
    public static func decodeURIComponent(_ s: String) -> String? {
        s.removingPercentEncoding
    }

    /// Groups an integer with commas in threes (`hazard-model.js group()`,
    /// and en-US `toLocaleString`).
    public static func group(_ n: Double) -> String {
        let x = round(n)
        guard x.isFinite else { return numberString(x) }
        let neg = x < 0
        var digits = String(format: "%.0f", abs(x))
        var out = ""
        while digits.count > 3 {
            out = "," + digits.suffix(3) + out
            digits = String(digits.dropLast(3))
        }
        return (neg ? "-" : "") + digits + out
    }

    /// en-US `toLocaleString()` of a number: grouped integer part, up to three
    /// fraction digits.
    public static func localeString(_ n: Double) -> String {
        if n == n.rounded() { return group(n) }
        let whole = n < 0 ? (-n).rounded(.down) * -1 : n.rounded(.down)
        var frac = String(format: "%.3f", abs(n - whole))
        frac = String(frac.dropFirst(1))
        while frac.hasSuffix("0") { frac.removeLast() }
        return group(whole) + (frac == "." ? "" : frac)
    }

    /// `localeCompare` with the default (root) collation, as logic.md section 1 asks.
    public static func localeCompare(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        let sentinel = "\u{FFFF}"
        if a == sentinel { return 1 }
        if b == sentinel { return -1 }
        switch a.compare(b, options: [], range: nil, locale: Locale(identifier: "en")) {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }
}

/// Regular expression helpers that behave like the site's JavaScript regexes.
public struct JSRegex: @unchecked Sendable {
    public let re: NSRegularExpression

    public init(_ pattern: String, caseInsensitive: Bool = false) {
        // Patterns are compile-time constants in this package; a bad one is a bug.
        re = try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    public func test(_ s: String) -> Bool {
        re.firstMatch(in: s, options: [], range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// Capture groups of the first match (index 0 is the whole match); nil
    /// entries for groups that did not take part.
    public func exec(_ s: String) -> [String?]? {
        guard let m = re.firstMatch(in: s, options: [], range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            guard r.location != NSNotFound, let rr = Range(r, in: s) else { return nil }
            return String(s[rr])
        }
    }

    /// Global replace with a closure over the capture groups.
    public func replace(_ s: String, _ f: ([String?]) -> String) -> String {
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let groups: [String?] = (0..<m.numberOfRanges).map { i in
                let r = m.range(at: i)
                return r.location == NSNotFound ? nil : ns.substring(with: r)
            }
            out += f(groups)
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return out
    }
}
