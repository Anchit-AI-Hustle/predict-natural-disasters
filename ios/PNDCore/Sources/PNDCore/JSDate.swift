import Foundation

/// `Date.parse` as the website uses it: ISO-8601 with `Z`, with an offset, with
/// or without milliseconds, plus the RFC-822 dates RSS feeds carry. An
/// unparseable string gives nil, which every caller treats as "absent"
/// (logic.md section 1).
public enum JSDate {
    private static let isoRe = JSRegex(#"^([+-]\d{6}|\d{4})(?:-(\d\d)(?:-(\d\d))?)?(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?)?\s*(Z|z|[+-]\d\d:?\d\d)?$"#)

    /// Milliseconds since the epoch, or nil.
    public static func ms(_ s: String?) -> Double? {
        guard let raw = s?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if let g = isoRe.exec(raw) {
            guard let year = Int(g[1] ?? "") else { return nil }
            let month = Int(g[2] ?? "1") ?? 1
            let day = Int(g[3] ?? "1") ?? 1
            let hour = Int(g[4] ?? "0") ?? 0
            let minute = Int(g[5] ?? "0") ?? 0
            let second = Int(g[6] ?? "0") ?? 0
            guard (1...12).contains(month), (1...31).contains(day), hour <= 24, minute < 60, second < 60 else { return nil }
            var fracMs = 0.0
            if let f = g[7] {
                let digits = String(f.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
                fracMs = Double(digits) ?? 0
            }
            var offsetMin = 0
            if let z = g[8], z != "Z", z != "z" {
                let sign = z.hasPrefix("-") ? -1 : 1
                let digits = z.dropFirst().replacingOccurrences(of: ":", with: "")
                let hh = Int(digits.prefix(2)) ?? 0
                let mm = Int(digits.suffix(2)) ?? 0
                offsetMin = sign * (hh * 60 + mm)
            }
            // Days from civil (proleptic Gregorian), so no Calendar is needed.
            let days = daysFromCivil(year, month, day)
            // Reject impossible dates such as 31 February.
            let (cy, cm, cd) = civilFromDays(days)
            guard cy == year, cm == month, cd == day else { return nil }
            let secs = Double(days) * 86400 + Double(hour * 3600 + minute * 60 + second) - Double(offsetMin * 60)
            return secs * 1000 + fracMs
        }
        return rfc822(raw).map { $0.timeIntervalSince1970 * 1000 }
    }

    public static func date(_ s: String?) -> Date? {
        ms(s).map { Date(timeIntervalSince1970: $0 / 1000) }
    }

    public static func ms(_ v: JSONValue?) -> Double? {
        guard let v = v else { return nil }
        switch v {
        case .string(let s): return ms(s)
        case .number(let d): return d.isFinite ? d : nil
        default: return nil
        }
    }

    /// ISO-8601 with milliseconds and `Z`, as `Date.prototype.toISOString`.
    public static func iso(_ ms: Double) -> String {
        let total = Int64((ms).rounded(.down))
        var secs = total / 1000
        var milli = total % 1000
        if milli < 0 { milli += 1000; secs -= 1 }
        var days = secs / 86400
        var rem = secs % 86400
        if rem < 0 { rem += 86400; days -= 1 }
        let (y, m, d) = civilFromDays(Int(days))
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", y, m, d, Int(rem / 3600), Int(rem % 3600 / 60), Int(rem % 60), Int(milli))
    }

    static func daysFromCivil(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (m + 9) % 12
        let doy = (153 * mp + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    static func civilFromDays(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }

    private static let rfcFormatters: [DateFormatter] = {
        ["EEE, d MMM yyyy HH:mm:ss zzz", "EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss zzz",
         "EEE, d MMM yyyy HH:mm zzz", "EEE, d MMM yyyy", "d MMM yyyy", "MMM d, yyyy"].map { f in
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            df.timeZone = TimeZone(identifier: "UTC")
            df.dateFormat = f
            return df
        }
    }()
    private static let rfcLock = NSLock()

    static func rfc822(_ s: String) -> Date? {
        rfcLock.lock(); defer { rfcLock.unlock() }
        for f in rfcFormatters { if let d = f.date(from: s) { return d } }
        return nil
    }
}
