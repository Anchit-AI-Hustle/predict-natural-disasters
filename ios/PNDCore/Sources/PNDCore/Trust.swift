import Foundation

/// The trust note and footer agencies (`trust.js`, features.md section 15).
public enum Trust {
    public struct Agency: Sendable, Hashable {
        public let name: String
        public let full: String
        public let url: String
        public var domain: String { URL(string: url)?.host ?? url }
    }

    public struct RegionAgencies: Sendable, Hashable {
        public let region: String
        public let agencies: [Agency]
        /// "in India", "in the US", "worldwide".
        public var phrase: String { region == "Worldwide" ? "worldwide" : "in " + (region == "United States" ? "the US" : region) }
    }

    public static let official: [RegionAgencies] = [
        RegionAgencies(region: "India", agencies: [
            Agency(name: "IMD", full: "India Meteorological Department", url: "https://mausam.imd.gov.in/"),
            Agency(name: "NDMA", full: "National Disaster Management Authority", url: "https://ndma.gov.in/")]),
        RegionAgencies(region: "United States", agencies: [
            Agency(name: "NWS", full: "NOAA National Weather Service", url: "https://www.weather.gov/"),
            Agency(name: "USGS", full: "U.S. Geological Survey (earthquakes)", url: "https://earthquake.usgs.gov/")]),
        RegionAgencies(region: "Worldwide", agencies: [
            Agency(name: "GDACS", full: "Global Disaster Alert and Coordination System", url: "https://www.gdacs.org/")])
    ]

    /// Elsewhere: a directory, never named as a data source.
    public static let wmo = Agency(name: "find your country's national weather service",
                                   full: "national weather services listed by the WMO",
                                   url: "https://wmo.int/about/governance/wmo-members")

    public static let headline = "Experimental model, not an official warning."
    public static let lead = "For real alerts, follow your national agency:"

    /// The full sentence as one plain string (for accessibility and tests).
    public static var noteText: String {
        headline + " " + lead + " " + official.map { r in
            r.agencies.map { $0.name }.joined(separator: " and ") + " " + r.phrase
        }.joined(separator: ", ") + "."
    }

    public static let footerHeadline = "This is an experimental model, not an official warning service."
    public static let footerLead = "For real alerts and what to do in an emergency, follow your national meteorological or disaster agency:"

    public struct Source: Sendable, Hashable {
        public let key: String?
        public let name: String
        public let short: String
        public let url: String
        public let adds: String
        public let model: Bool
    }

    public enum Group: String, CaseIterable, Sendable { case feed, models, place, ledger }

    public static let sources: [Group: [Source]] = [
        .feed: [
            Source(key: "gdacs", name: "GDACS", short: "GDACS", url: "https://www.gdacs.org/",
                   adds: "Alerts for earthquakes, tropical cyclones, floods, droughts, wildfires and volcanoes worldwide, with impact figures.", model: false),
            Source(key: "usgs", name: "USGS Earthquake Hazards Program", short: "USGS", url: "https://earthquake.usgs.gov/",
                   adds: "Every earthquake of magnitude 2.5 or more in the past 7 days, and the shocks the 7-day aftershock outlooks follow.", model: false),
            Source(key: "emsc", name: "EMSC", short: "EMSC", url: "https://www.emsc-csem.org/",
                   adds: "An independent check on earthquakes of magnitude 4.5 or more.", model: false),
            Source(key: "eonet", name: "NASA EONET", short: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/",
                   adds: "Wildfires, storms, volcanoes and other events seen from satellites.", model: false),
            Source(key: "nhc", name: "NOAA National Hurricane Center", short: "NOAA NHC", url: "https://www.nhc.noaa.gov/",
                   adds: "Active tropical cyclones in the Atlantic and eastern and central Pacific only.", model: false),
            Source(key: "nws", name: "NOAA National Weather Service", short: "NOAA NWS", url: "https://www.weather.gov/",
                   adds: "Severe and extreme weather warnings in the United States.", model: false),
            Source(key: "reliefweb", name: "ReliefWeb (UN OCHA)", short: "ReliefWeb", url: "https://reliefweb.int/",
                   adds: "Humanitarian disaster declarations, by country.", model: false),
            Source(key: "usgs_volcano", name: "USGS Volcano Hazards Program", short: "USGS Volcanoes", url: "https://volcanoes.usgs.gov/",
                   adds: "US-monitored volcanoes at a raised alert level.", model: false),
            Source(key: nil, name: "Open-Meteo Geocoding", short: "Open-Meteo", url: "https://open-meteo.com/en/docs/geocoding-api",
                   adds: "Places ReliefWeb\u{2019}s country-level records, which carry no coordinates, at their country.", model: false)
        ],
        .models: [
            Source(key: nil, name: "Open-Meteo Forecast API", short: "Open-Meteo", url: "https://open-meteo.com/",
                   adds: "The coming week\u{2019}s temperature, rain, dew point and wind that the heat, rain and fire-weather forecasts start from.", model: true),
            Source(key: nil, name: "NASA POWER", short: "NASA POWER", url: "https://power.larc.nasa.gov/",
                   adds: "Each place\u{2019}s 30-year record (1996 to 2025) a forecast is judged against, and the measured days it is graded on.", model: true)
        ],
        .place: [
            Source(key: nil, name: "OpenStreetMap Nominatim", short: "OpenStreetMap", url: "https://nominatim.openstreetmap.org/",
                   adds: "Finds the place you type, so nearby reports can be measured from it.", model: false)
        ],
        .ledger: [
            Source(key: nil, name: "The live feed, as recorded", short: "Recorded live feed", url: "/resources",
                   adds: "What GDACS, USGS, EMSC, NASA EONET, NOAA and ReliefWeb reported, kept with each run so every forecast can be checked against what happened.", model: false),
            Source(key: nil, name: "NASA POWER", short: "NASA POWER", url: "https://power.larc.nasa.gov/",
                   adds: "The measured weather each weather forecast is graded against.", model: false),
            Source(key: nil, name: "Open-Meteo Previous Runs API", short: "Open-Meteo", url: "https://open-meteo.com/en/docs/previous-runs-api",
                   adds: "Forecasts really issued 3 and 5 days ahead, used to test the method on the past.", model: false)
        ]
    ]

    public static func list(_ groups: [Group]) -> [Source] { groups.flatMap { sources[$0] ?? [] } }

    /// "Data sources: GDACS, USGS, ..." (names only, no count; changelog C10).
    public static func summary(_ groups: [Group]) -> String {
        var short: [String] = []
        for s in list(groups) where !short.contains(s.short) { short.append(s.short) }
        return "Data sources: " + short.joined(separator: ", ")
    }

    /// `when(iso)`: the screen's own `fmtDate`, so the note and the rest of
    /// the screen write one moment in one zone (changelog C9). Never the
    /// platform's short zone name ("GMT+5:30").
    public static func when(_ iso: String?, tz: String? = nil) -> String {
        guard let ms = JSDate.ms(iso) else { return "" }
        return Format.fmtDate(ms: ms, tz: tz)
    }

    /// The tooltip / accessibility value of a `when()`: `yyyy-MM-dd HH:mm UTC`.
    public static func utc(_ iso: String?) -> String {
        guard let ms = JSDate.ms(iso) else { return "" }
        let s = JSDate.iso(ms)
        return String(s.prefix(16)).replacingOccurrences(of: "T", with: " ") + " UTC"
    }

    public enum Status: Equatable, Sendable { case answered, notAnswering, none }

    /// A source's live status row (`statusOf`).
    public static func status(_ s: Source, meta: JSONValue?, tz: String? = nil) -> (state: Status, text: String) {
        if let key = s.key, let m = meta {
            guard let src = m["sources"]?[key] else { return (.none, "") }
            let ok = src["ok"]?.isTruthy ?? false
            var bits = [ok ? "answered" : "not answering"]
            let scan = m["scan"]?["providers"]?.arrayValue?.first { $0["provider"]?.stringValue == key }
            if let f = scan?["dataFreshness"], f.isTruthy { bits.append("newest record " + when(f.jsString, tz: tz)) }
            return (ok ? .answered : .notAnswering, bits.joined(separator: " \u{00B7} "))
        }
        if s.model, let at = meta?["modelRun"]?["at"], at.isTruthy {
            return (.none, "used in the run of " + when(at.jsString, tz: tz))
        }
        return (.none, "")
    }

    public enum FeedState: Equatable, Sendable { case loading, failed, loaded(generatedAt: String?, meta: JSONValue?) }

    /// The "when" line (`updatedLine`). The time always comes from the data.
    public static func updatedLine(groups: [Group], feed: FeedState, ledgerTimes: [String]? = nil, ledgerFailed: Bool = false, tz: String? = nil) -> String {
        var bits: [String] = []
        var meta: JSONValue? = nil
        if case .loaded(_, let m) = feed { meta = m }
        if groups.contains(.feed) {
            switch feed {
            case .loaded(let at, let m):
                bits.append("Live data from the agencies " + when(at, tz: tz) +
                    (m?["live"] == .bool(false) ? " (they were not answering, so saved copies are shown)" : ""))
            case .failed: bits.append("The live data did not load, so no update time can be shown")
            case .loading: bits.append("Live data: loading\u{2026}")
            }
        }
        if groups.contains(.models), let mr = meta?["modelRun"], mr.isTruthy, let at = mr["at"], at.isTruthy {
            bits.append("weather models run " + when(at.jsString, tz: tz) +
                ((mr["served"]?.isTruthy ?? false) ? "" : " (over 36 hours ago, so their forecasts are not shown)"))
        }
        if groups.contains(.ledger) {
            let times = (ledgerTimes ?? []).filter { JSDate.ms($0) != nil }.sorted { JSDate.ms($0)! > JSDate.ms($1)! }
            if let t = times.first { bits.append("Track record last recorded " + when(t, tz: tz)) }
            else if ledgerFailed || ledgerTimes != nil { bits.append("The track record did not load, so no update time can be shown") }
            else { bits.append("Track record: loading\u{2026}") }
        }
        return bits.joined(separator: " \u{00B7} ")
    }
}
