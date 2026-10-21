import Foundation

/// Geometry and country matching (`hazard-model.js`, logic.md section 3.1 and 3.2).
public enum Geo {
    /// `coordOf(v)`: nil for null, undefined or "", else the finite number.
    public static func coord(_ v: JSONValue?) -> Double? {
        guard let v = v, v.has else { return nil }
        let n = v.jsNumber
        return n.isFinite ? n : nil
    }

    /// Haversine with R = 6371 km.
    public static func distanceKm(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        let r = Double.pi / 180, R = 6371.0
        let x = (bLat - aLat) * r, y = (bLon - aLon) * r
        let z = sin(x / 2) * sin(x / 2) + cos(aLat * r) * cos(bLat * r) * sin(y / 2) * sin(y / 2)
        return 2 * R * asin(z.squareRoot())
    }

    private static func ringWraps(_ ring: [JSONValue]) -> Bool {
        guard ring.count > 1 else { return false }
        for i in 1..<ring.count {
            let a = ring[i][0]?.jsNumber ?? .nan, b = ring[i - 1][0]?.jsNumber ?? .nan
            if abs(a - b) > 180 { return true }
        }
        return false
    }

    private static func inRing(_ lon: Double, _ lat: Double, _ ring: [JSONValue]) -> Bool {
        var inside = false
        var j = ring.count - 1
        for i in 0..<ring.count {
            let xi = ring[i][0]?.jsNumber ?? .nan, yi = ring[i][1]?.jsNumber ?? .nan
            let xj = ring[j][0]?.jsNumber ?? .nan, yj = ring[j][1]?.jsNumber ?? .nan
            if !xi.isFinite || !yi.isFinite || !xj.isFinite || !yj.isFinite { return false }
            if (yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi { inside.toggle() }
            j = i
        }
        return inside
    }

    private static func okRing(_ r: JSONValue?) -> [JSONValue]? {
        guard let a = r?.arrayValue, a.count > 2, a[0].arrayValue != nil else { return nil }
        return a
    }

    private static func inPolygon(_ lon: Double, _ lat: Double, _ rings: JSONValue?) -> Bool? {
        guard let rs = rings?.arrayValue, okRing(rs.first) != nil else { return nil }
        var parsed: [[JSONValue]] = []
        for r in rs {
            guard let ring = okRing(r) else { return nil }
            if ringWraps(ring) { return nil }
            parsed.append(ring)
        }
        if !inRing(lon, lat, parsed[0]) { return false }
        for h in parsed.dropFirst() where inRing(lon, lat, h) { return false }
        return true
    }

    /// true or false when decidable, nil when the geometry is absent,
    /// unsupported or wraps the antimeridian. Nil is never read as outside.
    public static func geometryContains(_ g: JSONValue?, _ lat: Double, _ lon: Double) -> Bool? {
        guard let g = g, g.isTruthy, lat.isFinite, lon.isFinite else { return nil }
        let type = g["type"]?.stringValue
        if type == "Polygon" { return inPolygon(lon, lat, g["coordinates"]) }
        if type == "MultiPolygon" {
            guard let parts = g["coordinates"]?.arrayValue else { return nil }
            var undecidable = false
            for p in parts {
                let r = inPolygon(lon, lat, p)
                if r == true { return true }
                if r == nil { undecidable = true }
            }
            return undecidable ? nil : false
        }
        if type == "GeometryCollection", let gs = g["geometries"]?.arrayValue {
            var unknown = false
            for sub in gs {
                let c = geometryContains(sub, lat, lon)
                if c == true { return true }
                if c == nil { unknown = true }
            }
            return unknown ? nil : false
        }
        return nil
    }

    // MARK: countries

    /// Lower-case, strip combining marks, keep only a-z.
    public static func countryKey(_ name: String?) -> String {
        let s = (name ?? "").lowercased().decomposedStringWithCanonicalMapping
        return String(String.UnicodeScalarView(s.unicodeScalars.filter { sc in
            !(0x300...0x36F).contains(sc.value) && (0x61...0x7A).contains(sc.value)
        }))
    }

    /// English region name for a two-letter code, nil when it is not one.
    public static func countryFromCode(_ code: String?) -> String? {
        let c = (code ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        guard c.count == 2, c.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        guard let n = englishRegionName(c), n != c, n != "Unknown Region" else { return nil }
        return n
    }

    /// ICU's English names, adjusted to the forms `Intl.DisplayNames` gives in
    /// browsers where Foundation's data differs.
    public static func englishRegionName(_ code: String) -> String? {
        let overrides: [String: String] = ["MM": "Myanmar (Burma)"]
        if let o = overrides[code] { return o }
        return Locale(identifier: "en").localizedString(forRegionCode: code)
    }

    nonisolated(unsafe) private static var englishKeysCache: Set<String>?
    private static let cacheLock = NSLock()

    /// Every English region name, keyed with `countryKey`.
    public static func englishCountryKeys() -> Set<String> {
        cacheLock.lock(); defer { cacheLock.unlock() }
        if let c = englishKeysCache { return c }
        var out = Set<String>()
        let letters = (65...90).compactMap { UnicodeScalar($0).map { String(Character($0)) } }
        for a in letters { for b in letters {
            if let n = countryFromCode(a + b) { out.insert(countryKey(n)) }
        } }
        englishKeysCache = out
        return out
    }

    /// Every English region name (for the Calamities country filter),
    /// excluding the pseudo-regions `PND.countryOptions` drops.
    public static func countryOptions() -> [String] {
        let drop = JSRegex(#"Unknown Region|Pseudo|European Union|Eurozone|United Nations|Outlying Oceania|^world$"#, caseInsensitive: true)
        var names = Set<String>()
        let letters = (65...90).compactMap { UnicodeScalar($0).map { String(Character($0)) } }
        for a in letters { for b in letters {
            if let n = countryFromCode(a + b), !drop.test(n) { names.insert(n) }
        } }
        return names.sorted { JS.localeCompare($0, $1) < 0 }
    }

    public static func placeCountryKeys(country: String?, countryCode: String?) -> [String] {
        var keys: [String] = []
        if let n = countryFromCode(countryCode) { keys.append(countryKey(n)) }
        let named = countryKey(country)
        if !named.isEmpty, !keys.contains(named) { keys.append(named) }
        return keys
    }

    public static func countryMatches(country: String?, countryCode: String?, name: String?) -> Bool {
        let want = countryKey(name)
        return !want.isEmpty && placeCountryKeys(country: country, countryCode: countryCode).contains(want)
    }

    public static func countryComparable(country: String?, countryCode: String?) -> Bool {
        if countryFromCode(countryCode) != nil { return true }
        let k = countryKey(country)
        if k.isEmpty { return false }
        let names = englishCountryKeys()
        if names.isEmpty { return true }
        return names.contains(k)
    }
}
