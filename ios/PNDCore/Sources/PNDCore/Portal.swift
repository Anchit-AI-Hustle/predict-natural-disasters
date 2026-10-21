import Foundation

/// The site's one answer for each quantity (`portal.js`, logic.md sections
/// 6.10 to 6.13). Every screen counts with these, never on its own.
extension Format {
    // MARK: hazard identity (6.10, changelog C2)

    /// `PND.hazardKey(t)`: the `HAZARDS` key the type resolves to, or the
    /// trimmed type itself when the hazard model does not know it.
    public static func hazardKey(_ t: String?) -> String {
        let s = JS.trim(t ?? "")
        let h = Hazards.hazardOf(s)
        return h.key.isEmpty ? s : h.key
    }

    /// `PND.sameHazard(a, b)`: whole-name match, so Extreme Cold is not Extreme Heat.
    public static func sameHazard(_ a: String?, _ b: String?) -> Bool {
        hazardKey(a).lowercased() == hazardKey(b).lowercased()
    }

    // MARK: one count per quantity (6.11, changelog C3 and C14)

    /// Reports: live and not our forecast.
    public static func observed(_ list: [Record]) -> [Record] { list.filter { $0.isLive && !$0.forecast } }

    /// Our forecasts whose window has not ended.
    public static func openForecasts(_ list: [Record]) -> [Record] { list.filter { $0.isLive && $0.forecast && !$0.windowClosed } }

    /// A report an agency rated Red, Orange or High (exact words). Never a forecast.
    public static func isHighAlert(_ e: Record?) -> Bool {
        guard let e = e, !e.forecast else { return false }
        return ["Red", "Orange", "High"].contains(e.alert)
    }

    /// A warning in force: the feed's `evidenceState`, or with none an
    /// official record that has an end time.
    public static func isOfficialWarning(_ e: Record?) -> Bool {
        guard let e = e, !e.forecast else { return false }
        let s = e.evidenceState
        if !s.isEmpty { return s == "official-warning" }
        return e.sourceType == "official" && e.truthy("expiresAt")
    }

    public static func officialWarnings(_ list: [Record]) -> [Record] { list.filter { $0.isLive && isOfficialWarning($0) } }

    /// What "official warnings" counts, said wherever the number is.
    public static let warningMeaning = "Warnings and watches issued by agencies and in force now. Reports of disasters that already happened are not counted."

    /// How many named sources a list comes from.
    public static func sourcesReporting(_ list: [Record]) -> Int { Set(list.map { $0.source }.filter { !$0.isEmpty }).count }

    /// `PND.liveWord(e)`: the DATA STATUS word (changelog C5).
    public static func liveWord(_ e: Record?) -> String {
        guard let e = e else { return "-" }
        if e.cached { return "Saved copy" }
        if e.forecast { return "Our forecast" }
        if !e.isLive { return "Not updated recently" }
        return "Live"
    }

    /// Event detail eyebrow (`event-detail.html`).
    public static func eventEyebrow(_ e: Record) -> String {
        e.forecast ? "OUR FORECAST, NOT OFFICIAL" : (!e.isLive ? "EVENT NO LONGER UPDATED" : "LIVE EVENT")
    }

    /// Event detail "Status" row.
    public static func eventRecordState(_ e: Record) -> String {
        if e.cached { return "Saved copy, not live" }
        if e.forecast { return "Forecast in progress" }
        if !e.isLive { return quietNote(e) }
        return "Live, as the source last reported it"
    }

    /// Calamity detail status.
    public static func calamityStatus(_ e: Record) -> String {
        if e.cached { return "A saved copy, shown because the source did not list it this time" }
        if !e.isLive { return quietNote(e) }
        return "Live, as the source last reported it"
    }

    // MARK: place membership (6.12, changelog C1)

    /// `PND.inPlace(e, q)`: a continent is the countries on it; anything else
    /// matches the place fields or a substring of `countries[]`.
    public static func inPlace(_ e: Record, _ q: String?) -> Bool {
        if !Continents.continentNamed(q).isEmpty { return Continents.onContinent(e, q) }
        let t = JS.trim((q ?? "").lowercased())
        if Search.matchesPlace(e, t) { return true }
        guard let a = e["countries"]?.arrayValue else { return false }
        return a.contains { t.isEmpty || $0.jsString.lowercased().contains(t) }
    }

    // MARK: time zone (6.13, changelog C9)

    /// `PND.timezone`: the stored choice, else the device's zone, else India time.
    public static func timezoneDefault(stored: String?, device: String?) -> String {
        if let s = stored, !s.isEmpty { return s }
        if let d = device, !d.isEmpty { return d }
        return defaultZoneID
    }

    // MARK: feed down (changelog C19)

    public static let unavailable = "Unavailable"
    public static let unavailableTitle = "Live data unavailable."
    public static let unavailableBody = "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically."
}
