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
        if !e.isLive { return "Not updated for " + quietFor(e) }
        return "Live"
    }

    /// `PND.quietFor(e)` (changelog C41): hours under two days, else days, else its age.
    public static func quietFor(_ e: Record) -> String {
        let h = e.jsNumber("quietHours"), d = e.jsNumber("quietDays")
        if h.isFinite && h < 48 { return JS.numberString(h) + " hour" + (h == 1 ? "" : "s") }
        if d.isFinite {
            if d > 60 {
                let a = age(e.opt("updated"))
                return a.hasSuffix(" ago") ? String(a.dropLast(4)) : a
            }
            return JS.numberString(d) + " day" + (d == 1 ? "" : "s")
        }
        return "some time"
    }

    /// Event detail eyebrow (`event-detail.html`, changelog C39): only an
    /// agency's warning in force is an official one.
    public static func eventEyebrow(_ e: Record) -> String {
        if e.forecast { return "OUR FORECAST, NOT OFFICIAL" }
        if !e.isLive { return "EVENT NO LONGER UPDATED" }
        if isOfficialWarning(e) { return officialWord(e).uppercased() }
        return "REPORTED EVENT"
    }

    /// Alert detail eyebrow: the same, else "REPORT FROM AN OFFICIAL AGENCY".
    public static func alertEyebrow(_ e: Record) -> String {
        let w = eventEyebrow(e)
        return w == "REPORTED EVENT" ? "REPORT FROM AN OFFICIAL AGENCY" : w
    }

    /// `PND.provenanceOf(e)` (changelog C33): what a forecast is.
    public static func provenanceOf(_ e: Record?) -> String {
        guard let e = e, e.forecast else { return "Official report" }
        switch e.s("forecastKind") {
        case "model-advance": return "Made in advance by our model"
        case "frozen-benchmark": return "Test case, not made in advance"
        case "aftershock-sequence": return "Aftershock forecast, after an earthquake"
        default: break
        }
        if e.truthy("restatesAlert") || e.s("forecastKind") == "signal-derived-outlook" || e.truthy("forecastOf") { return "Restates an agency alert" }
        return "Our own estimate"
    }

    /// `PND.forecastKinds(list).text`: the "Of these: ..." line under a count of forecasts.
    public static func forecastKinds(_ list: [Record]) -> String {
        var model = 0, restated = 0, after = 0, test = 0, other = 0
        for e in list {
            let p = provenanceOf(e)
            if p.hasPrefix("Made in advance") { model += 1 } else if p.hasPrefix("Restates") { restated += 1 }
            else if p.hasPrefix("Aftershock") { after += 1 } else if p.hasPrefix("Test case") { test += 1 } else { other += 1 }
        }
        var parts: [String] = []
        if model > 0 { parts.append("\(model) made in advance by our weather models") }
        if restated > 0 { parts.append("\(restated) restating an agency alert") }
        if after > 0 { parts.append("\(after) aftershock forecast" + (after == 1 ? "" : "s")) }
        if test > 0 { parts.append("\(test) test case" + (test == 1 ? "" : "s")) }
        if other > 0 { parts.append("\(other) other") }
        return parts.isEmpty ? "" : "Of these: " + parts.joined(separator: ", ") + "."
    }

    /// `PND.lifeSafety(e)` (changelog C40): an agency's own warning, a rating
    /// of High or above, or reported deaths or displacement.
    public static func lifeSafety(_ e: Record) -> Bool {
        if e.forecast { return false }
        if e.evidenceState == "official-warning" && (!e.truthy("officialProduct") || e.s("officialProduct") == "warning") { return true }
        if RiskScale.keyFor(e).rank >= RiskLevel.high.rank { return true }
        return e.jsNumber("deaths") > 0 || e.jsNumber("displaced") > 0
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

    /// `PND.inPlace(e, q)`: a continent is the countries on it; a country
    /// exactly; anything else a whole word in the place fields (changelog C36).
    public static func inPlace(_ e: Record, _ q: String?) -> Bool {
        if !Continents.continentNamed(q).isEmpty { return Continents.onContinent(e, q) }
        return CountryNames.inPlace(e, q)
    }

    // MARK: time zone (6.13, changelog C9)

    /// `PND.timezone`: the stored choice, else the device's zone, else India time.
    public static func timezoneDefault(stored: String?, device: String?) -> String {
        if let s = stored, !s.isEmpty { return zoneName(s) }
        if let d = device, !d.isEmpty { return zoneName(d) }
        return defaultZoneID
    }

    // MARK: feed down (changelog C19)

    public static let unavailable = "Unavailable"
    public static let unavailableTitle = "Live data unavailable."
    public static let unavailableBody = "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically."
}
