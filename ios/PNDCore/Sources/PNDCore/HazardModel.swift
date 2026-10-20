import Foundation

/// One hazard entry from `hazard-model.js HAZARDS` (verbatim strings).
public struct HazardInfo: Equatable, Sendable {
    public let key: String
    public let name: String
    public let definition: String
    public let onset: String
    public let forecastable: Bool
    public let horizonH: Int
    public let duration: String
    public let severityBasis: String
    public let leadTime: String

    /// "How it starts" on the hazard definition box.
    public var onsetText: String {
        switch onset {
        case "sudden": return "Suddenly, with little or no warning"
        case "slow": return "Slowly, over weeks to months"
        default: return "Quickly, over hours to days"
        }
    }
}

public enum Hazards {
    public static let table: [String: HazardInfo] = {
        var t: [String: HazardInfo] = [:]
        for h in list { t[h.key] = h }
        return t
    }()

    public static let list: [HazardInfo] = [
        HazardInfo(key: "Earthquake", name: "Earthquake",
            definition: "Ground shaking from a sudden release of stress on a fault. Measured by magnitude; damage depends on depth, local geology and building stock, not magnitude alone.",
            onset: "sudden", forecastable: false, horizonH: 0,
            duration: "Seconds to minutes of shaking; the aftershock sequence runs days to months.",
            severityBasis: "USGS PAGER impact alert, which estimates expected fatalities and economic loss. Magnitude on its own is not a severity.",
            leadTime: "None. No agency can forecast when a particular earthquake will strike, and neither can we."),
        HazardInfo(key: "Earthquake aftershock sequence", name: "Aftershock sequence",
            definition: "The decaying series of smaller earthquakes that follows a mainshock in the same rupture area. The largest aftershock is typically about one magnitude below the mainshock.",
            onset: "rapid", forecastable: true, horizonH: 168,
            duration: "Days to months, decaying roughly with the reciprocal of elapsed time.",
            severityBasis: "Mainshock magnitude and the state of already-damaged structures in the affected area.",
            leadTime: "Hours to days. Aftershocks can be forecast once the main earthquake has happened; the main earthquake cannot."),
        HazardInfo(key: "Tropical Cyclone", name: "Tropical cyclone",
            definition: "A rotating storm system over warm ocean with organised convection and a closed low-level circulation. Named at tropical-storm strength; hurricane or typhoon strength begins at 64 knots of sustained wind.",
            onset: "rapid", forecastable: true, horizonH: 120,
            duration: "Days at sea; landfall impacts run roughly 12 to 72 hours at a given place.",
            severityBasis: "Saffir-Simpson category from sustained wind, plus expected storm surge and rainfall over populated coast.",
            leadTime: "Three to five days. Storms can be forecast further ahead than most hazards, which is why official storm tracks cover five days."),
        HazardInfo(key: "Flood", name: "Flood",
            definition: "Water covering ground that is normally dry, from river overflow, intense rainfall, storm surge or dam failure. Flash floods develop within hours; riverine floods build over days.",
            onset: "rapid", forecastable: true, horizonH: 72,
            duration: "Hours for flash flooding; days to weeks for large river basins.",
            severityBasis: "People displaced and affected, depth and extent over inhabited land, and the issuing agency\u{2019}s own alert level.",
            leadTime: "Hours to days. River flooding downstream of heavy rain that has already fallen is the easiest to forecast."),
        HazardInfo(key: "Flood / Landslide", name: "Flood and landslide",
            definition: "Intense or prolonged rainfall producing both inundation and slope failure in the same area. The two hazards share a driver and usually arrive together in steep terrain.",
            onset: "rapid", forecastable: true, horizonH: 96,
            duration: "Days, with slope failures often continuing after the rain stops.",
            severityBasis: "Combined displacement and casualties, and whether failures reach settlements or transport routes.",
            leadTime: "One to four days, based on rainfall forecasts and how wet the ground already is."),
        HazardInfo(key: "Landslide", name: "Landslide",
            definition: "Downslope movement of rock, soil or debris, usually triggered by rainfall, earthquake shaking or undercutting. Includes debris flows and rockfalls.",
            onset: "rapid", forecastable: true, horizonH: 72,
            duration: "Minutes for a single failure; the period of elevated susceptibility lasts days after saturation.",
            severityBasis: "Whether the runout reaches settlements or routes, and observed casualties.",
            leadTime: "Hours to days, and only for an area at risk. Never a particular slope at a particular time."),
        HazardInfo(key: "Wildfire", name: "Wildfire",
            definition: "Uncontrolled fire in vegetation. Behaviour is driven by fuel dryness, wind and terrain; most large-fire growth happens on a small number of extreme fire-weather days.",
            onset: "rapid", forecastable: true, horizonH: 72,
            duration: "Days to months for a large incident; most detections stay open until containment is reported.",
            severityBasis: "Area burned, proximity to settlements, evacuation orders and smoke exposure downwind.",
            leadTime: "One to three days for dangerous fire weather. When and where a fire starts cannot be forecast."),
        HazardInfo(key: "Drought", name: "Drought",
            definition: "A prolonged deficit of water relative to normal for a place and season. Meteorological drought is a rainfall deficit; agricultural and hydrological drought follow later as soil moisture and storage fall.",
            onset: "slow", forecastable: true, horizonH: 720,
            duration: "Months to years. Drought does not have a three-day window and must never be published with one.",
            severityBasis: "Extent and duration of the deficit, and the population dependent on rain-fed agriculture or affected water supply.",
            leadTime: "Weeks to months. Drought builds slowly, so long-range forecasts give real warning."),
        HazardInfo(key: "Volcano", name: "Volcanic activity",
            definition: "Eruptive activity or unrest at a volcano: ash emission, lava, pyroclastic density currents, lahars or gas. Aviation and ground alerts are issued on separate colour-coded scales.",
            onset: "rapid", forecastable: true, horizonH: 168,
            duration: "Days to years. Unrest episodes commonly persist for weeks.",
            severityBasis: "The observatory\u{2019}s own alert level, exclusion-zone population, and ash dispersal over air routes and settlements.",
            leadTime: "A volcano is usually restless for days to weeks before an eruption, but the exact start is still uncertain."),
        HazardInfo(key: "Extreme Heat", name: "Extreme heat",
            definition: "A period of temperature and humidity high enough to threaten health, defined against local norms rather than a single global threshold. Overnight minima matter as much as daytime peaks.",
            onset: "rapid", forecastable: true, horizonH: 120,
            duration: "Days to a few weeks.",
            severityBasis: "Duration, night-time minima, and the size of the exposed population without cooling.",
            leadTime: "Three to seven days. These are among the most reliable forecasts for any hazard."),
        HazardInfo(key: "Extreme Cold", name: "Extreme cold",
            definition: "A period of temperature, wind chill or frost severe enough to threaten health, livestock or crops, defined against local norms.",
            onset: "rapid", forecastable: true, horizonH: 120,
            duration: "Hours to days.",
            severityBasis: "Wind chill, duration, and exposure of people without heating or of vulnerable crops.",
            leadTime: "Three to seven days."),
        HazardInfo(key: "Severe Storm", name: "Severe storm",
            definition: "Convective weather producing damaging wind, large hail or torrential rain. Distinct from a tropical cyclone: shorter-lived, smaller and driven by local instability.",
            onset: "rapid", forecastable: true, horizonH: 48,
            duration: "Hours at any one place; a squall line or outbreak can affect a region for most of a day.",
            severityBasis: "Wind gust, hail size, rainfall rate and the population under the storm track.",
            leadTime: "Hours to two days. Forecasts become much less reliable after the first day."),
        HazardInfo(key: "Tornado", name: "Tornado",
            definition: "A violently rotating column of air in contact with both a convective cloud and the ground. Rated after the fact on the Enhanced Fujita scale from observed damage.",
            onset: "sudden", forecastable: true, horizonH: 24,
            duration: "Minutes for an individual tornado; an outbreak lasts hours.",
            severityBasis: "Observed damage rating and whether the track crosses built-up areas.",
            leadTime: "Minutes for a warning about a particular tornado, and up to a day for the area at risk. Never an exact place and time in advance."),
        HazardInfo(key: "Tsunami", name: "Tsunami",
            definition: "Long-wavelength ocean waves generated by seafloor displacement, usually from an earthquake. Travels at jet speed across open ocean and builds height in shallow water.",
            onset: "sudden", forecastable: true, horizonH: 24,
            duration: "Hours of wave trains; the first wave is often not the largest.",
            severityBasis: "Expected run-up height against coastal population and evacuation time available.",
            leadTime: "Minutes to hours, depending on how far the wave has to travel. It is not forecast by any model.")
    ]

    public static let defaultHazard = HazardInfo(key: "", name: "Natural hazard",
        definition: "A natural process with the potential to cause loss of life, injury or damage.",
        onset: "rapid", forecastable: true, horizonH: 72,
        duration: "Varies by hazard.",
        severityBasis: "The issuing agency\u{2019}s alert level and any observed human impact.",
        leadTime: "Varies by hazard.")

    private static let rx = (
        aftershock: JSRegex("aftershock"), quake: JSRegex("earthquake|seismic"),
        cyclone: JSRegex("cyclone|hurricane|typhoon"), tsunami: JSRegex("tsunami"), tornado: JSRegex("tornado"),
        flood: JSRegex("flood"), slide: JSRegex("landslide|mudslide"), fire: JSRegex("wildfire|bushfire|forest fire"),
        drought: JSRegex("drought"), volcano: JSRegex("volcan"), heat: JSRegex("heat"),
        cold: JSRegex("cold|freeze|frost|winter"), storm: JSRegex("storm|thunder|hail|wind")
    )

    /// `hazardOf(type)`: exact key first, then the ordered patterns.
    public static func hazardOf(_ type: String?) -> HazardInfo {
        let t = type ?? ""
        if let h = table[t] { return h }
        let k = t.lowercased()
        if rx.aftershock.test(k) { return table["Earthquake aftershock sequence"]! }
        if rx.quake.test(k) { return table["Earthquake"]! }
        if rx.cyclone.test(k) { return table["Tropical Cyclone"]! }
        if rx.tsunami.test(k) { return table["Tsunami"]! }
        if rx.tornado.test(k) { return table["Tornado"]! }
        if rx.flood.test(k) && rx.slide.test(k) { return table["Flood / Landslide"]! }
        if rx.flood.test(k) { return table["Flood"]! }
        if rx.slide.test(k) { return table["Landslide"]! }
        if rx.fire.test(k) { return table["Wildfire"]! }
        if rx.drought.test(k) { return table["Drought"]! }
        if rx.volcano.test(k) { return table["Volcano"]! }
        if rx.heat.test(k) { return table["Extreme Heat"]! }
        if rx.cold.test(k) { return table["Extreme Cold"]! }
        if rx.storm.test(k) { return table["Severe Storm"]! }
        return defaultHazard
    }

    public static func horizonHours(_ type: String?) -> Int {
        let h = hazardOf(type).horizonH
        return h != 0 ? h : defaultHazard.horizonH
    }

    /// "Why this forecast period" text.
    public static func horizonText(_ type: String?) -> String {
        let h = horizonHours(type)
        return h >= 168 ? "\(h / 24) days" : "\(h) hours"
    }

    // MARK: severity

    public static let severityScale: [(key: String, rank: Int, meaning: String)] = [
        ("Informational", 1, "A detection or observation with no impact assessment attached. Most of the feed by volume."),
        ("Minor", 2, "Impact expected to stay limited and local."),
        ("Moderate", 3, "Localised damage, disruption or displacement; casualties possible."),
        ("Severe", 4, "Significant casualties, damage or displacement across a region."),
        ("Extreme", 5, "Mass casualties or national-scale impact expected or already observed.")
    ]

    public static func severityMeaning(_ key: String) -> String? {
        severityScale.first { $0.key == key }?.meaning
    }

    private static func n0(_ e: Record, _ k: String) -> Double {
        let n = e.jsNumber(k)
        return n.isFinite ? n : 0
    }

    public static func impactRank(_ e: Record) -> Int {
        let d = n0(e, "deaths"), a = n0(e, "affected"), p = n0(e, "displaced")
        if d >= 100 || a >= 1_000_000 || p >= 100_000 { return 5 }
        if d >= 10 || a >= 100_000 || p >= 10_000 { return 4 }
        if d >= 1 || a >= 10_000 || p >= 1_000 { return 3 }
        if a > 0 || p > 0 { return 2 }
        return 0
    }

    public static func alertRank(_ e: Record) -> Int {
        let pager = e.s("pagerAlert").lowercased()
        let assessed = pager == "red" ? 5 : pager == "orange" ? 4 : pager == "yellow" ? 3 : 0
        let mag = e.jsNumber("magnitude")
        let kt = e.jsNumber("windKt")
        var wind = 0
        if kt.isFinite && kt > 0 { wind = kt >= 113 ? 5 : kt >= 96 ? 4 : kt >= 64 ? 3 : 2 }
        var issued = 0
        switch e.s("alert") {
        case "Red": issued = 4
        case "Orange": issued = 3
        case "High": issued = 3
        case "Moderate": issued = 2
        case "Watch": issued = 1
        default: issued = 0
        }
        if assessed != 0 || wind != 0 || issued != 0 { return max(assessed, wind, issued) }
        if mag.isFinite && mag > 0 { return 1 }
        return 0
    }

    public static func severityOf(_ e: Record) -> (severity: String, rank: Int) {
        let r = max(impactRank(e), alertRank(e), 1)
        return (severityScale[r - 1].key, r)
    }

    // MARK: key facts

    public struct KeyFact: Equatable, Sendable {
        public let key: String
        public let label: String
        public let reported: Bool
        public let value: String?
        public let note: String?
    }

    public static let impact = ["deaths", "injuries", "missing", "displaced", "evacuated", "affected"]

    public static let metrics: [String: [String]] = [
        "Earthquake": ["magnitude", "depthKm", "pagerAlert", "tsunamiFlag"] + impact,
        "Earthquake aftershock sequence": ["mainshockMagnitude"] + impact,
        "Tropical Cyclone": ["windKt", "category", "pressureMb", "movement"] + impact,
        "Flood": impact, "Flood / Landslide": impact, "Landslide": impact,
        "Wildfire": ["areaHa"] + impact, "Drought": impact,
        "Volcano": ["alertLevel", "aviationColour"] + impact,
        "Extreme Heat": impact, "Extreme Cold": impact, "Severe Storm": impact, "Tornado": impact, "Tsunami": impact
    ]

    public static let labels: [String: String] = [
        "magnitude": "Magnitude", "mainshockMagnitude": "Mainshock magnitude", "depthKm": "Depth",
        "pagerAlert": "USGS impact alert", "tsunamiFlag": "Tsunami flag", "windKt": "Maximum sustained wind",
        "category": "Category", "pressureMb": "Minimum central pressure", "movement": "Moving",
        "areaHa": "Area burned", "alertLevel": "Observatory alert level", "aviationColour": "Aviation colour code",
        "deaths": "Lives lost", "injuries": "Injured", "missing": "Missing or unaccounted for",
        "displaced": "People displaced", "evacuated": "People evacuated", "affected": "People affected"
    ]

    public static let compass = ["north", "north-north-east", "north-east", "east-north-east",
        "east", "east-south-east", "south-east", "south-south-east",
        "south", "south-south-west", "south-west", "west-south-west",
        "west", "west-north-west", "north-west", "north-north-west"]

    public static func published(_ v: JSONValue?) -> Bool {
        guard let v = v, v.has else { return false }
        return v.jsNumber.isFinite
    }

    public static func compassOf(_ v: JSONValue?) -> String? {
        guard published(v), let d = v?.jsNumber else { return nil }
        let norm = (d.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        return compass[Int(JS.round(norm / 22.5)) % 16]
    }

    public static func cycloneCategory(_ kt: Double?) -> String? {
        guard let k = kt, k.isFinite, k > 0 else { return nil }
        if k >= 137 { return "Category 5" }
        if k >= 113 { return "Category 4" }
        if k >= 96 { return "Category 3" }
        if k >= 83 { return "Category 2" }
        if k >= 64 { return "Category 1" }
        if k >= 34 { return "Tropical storm" }
        return "Tropical depression"
    }

    public static func factOf(_ e: Record, _ key: String) -> KeyFact {
        let label = labels[key] ?? key
        let v = e[key]
        let has = v?.has ?? false
        func fact(_ reported: Bool, _ value: String?, _ note: String? = nil) -> KeyFact {
            KeyFact(key: key, label: label, reported: reported, value: value, note: note)
        }
        switch key {
        case "magnitude", "mainshockMagnitude":
            return fact(has, has ? JS.toFixed(v!.jsNumber, 1) : nil)
        case "depthKm":
            return fact(has, has ? JS.numberString(JS.round(v!.jsNumber)) + " km" : nil)
        case "pagerAlert":
            return fact(has, has ? v!.jsString.lowercased() : nil, has ? nil : "USGS issued no impact assessment for this earthquake")
        case "tsunamiFlag":
            return fact(has, has ? (v!.isTruthy ? "Raised" : "Not raised") : nil,
                        has ? nil : "Only the United States Geological Survey publishes a tsunami flag")
        case "windKt":
            guard has else { return fact(false, nil) }
            let k = v!.jsNumber
            let kt = k == k.rounded() ? JS.numberString(k) : JS.numberString(JS.round(k * 10) / 10)
            return fact(true, kt + " kt")
        case "category":
            let c = cycloneCategory(e["windKt"].map { $0.has ? $0.jsNumber : .nan })
            return fact(c != nil, c)
        case "pressureMb":
            let mb = v?.jsNumber ?? .nan
            let ok = has && mb.isFinite && mb > 0
            return fact(ok, ok ? JS.group(mb) + " mb" : nil, ok ? nil : "This source publishes no central pressure for this system")
        case "movement":
            let whereTo = compassOf(e["movementDirDeg"])
            var fast: String? = nil
            if published(e["movementKt"]), let k = e["movementKt"]?.jsNumber, k >= 0 { fast = JS.numberString(JS.round(k)) + " kt" }
            let moving = whereTo.map { $0 + (fast.map { " at " + $0 } ?? "") }
            return fact(moving != nil, moving, moving != nil ? nil : "This source publishes no track for this system")
        case "areaHa":
            let ha = e.jsNumber("areaHa")
            let ok = ha.isFinite && ha > 0
            let km = ha / 100
            let area = ha < 100 ? JS.group(ha) + " ha" : km < 100 ? JS.numberString(JS.round(km * 10) / 10) + " km\u{00B2}" : JS.group(km) + " km\u{00B2}"
            return fact(ok, ok ? area : nil)
        case "aviationColour":
            return fact(has, has ? v!.jsString : nil, has ? nil : "This source publishes no aviation colour code for this volcano")
        case "alertLevel":
            let t = e.truthy("alertLevel")
            return fact(t, t ? e.s("alertLevel") : nil, t ? nil : "This source publishes no observatory alert level for this volcano")
        default:
            let n = v?.jsNumber ?? .nan
            let reported = has && n.isFinite
            return fact(reported, reported ? JS.group(n) : nil)
        }
    }

    /// Every fact this hazard wants, reported or not.
    public static func keyFacts(_ e: Record) -> [KeyFact] {
        let h = hazardOf(e.type)
        let keys = metrics[h.key] ?? impact
        return keys.map { factOf(e, $0) }
    }

    /// `keyFactsLine(e, max)`: reported facts only, joined with " · ".
    public static func keyFactsLine(_ e: Record, max: Int = 3) -> String {
        keyFacts(e).filter { $0.reported }.prefix(max).map { f in
            let v = f.value ?? ""
            let named = f.key == "category" || v.lowercased().hasPrefix(f.label.lowercased())
            return named ? v : f.label + " " + v
        }.joined(separator: " \u{00B7} ")
    }

    // MARK: lead time

    public static func leadTimeHours(_ e: Record) -> Double? {
        guard e.forecast else { return nil }
        guard let issued = JSDate.ms(e.first("issuedAt", "updated")?.jsString), let start = e.ms("targetStart") else { return nil }
        return JS.round((start - issued) / 3_600_000 * 10) / 10
    }

    public static func leadTimeText(_ e: Record) -> String {
        guard let h = leadTimeHours(e) else { return "" }
        func n(_ x: Double, _ unit: String) -> String {
            let r = JS.round(x)
            return JS.numberString(r) + " " + unit + (r == 1 ? "" : "s")
        }
        if h < 0 { return "Made " + n(abs(h), "hour") + " after the forecast period began, so it gave no advance warning." }
        if h == 0 { return "No advance warning. This forecast began when it was made, so it describes something already under way." }
        if h < 48 { return "Made " + n(h, "hour") + " before the forecast period begins." }
        return "Made " + n(h / 24, "day") + " before the forecast period begins."
    }

    // MARK: forecast classes

    public struct ForecastClass: Sendable {
        public let key: String
        public let label: String
        public let definition: String
        public let headline: Bool
    }

    public static let forecastClasses: [String: ForecastClass] = [
        "independent-prospective": ForecastClass(key: "independent-prospective", label: "Made in advance",
            definition: "Recorded before the event it forecasts had started.", headline: true),
        "warning-derived": ForecastClass(key: "warning-derived", label: "Based on an official warning",
            definition: "Made from an official warning that had already been issued.", headline: false),
        "continuation-outlook": ForecastClass(key: "continuation-outlook", label: "Follows an ongoing event",
            definition: "Made after the event had started. It forecasts that the event will continue or get worse.", headline: false),
        "post-event-conditional": ForecastClass(key: "post-event-conditional", label: "After an earthquake",
            definition: "Made after an event that has already happened, such as aftershocks following a large earthquake.", headline: false),
        "retrospective-benchmark": ForecastClass(key: "retrospective-benchmark", label: "Test case, not made in advance",
            definition: "A test of the method, written after the period it covers had started.", headline: false),
        "invalid-post-event": ForecastClass(key: "invalid-post-event", label: "Not valid: no proof it came first",
            definition: "Presented as made in advance, but nothing shows it existed before the period it covers.", headline: false)
    ]

    public static let warningProviders = JSRegex("(?:National Weather Service|Volcano Hazards Program)", caseInsensitive: true)

    /// `classifyForecast(f, parent)` -> (class, reason), nil for a non-forecast.
    public static func classifyForecast(_ f: Record, parent: Record? = nil) -> (forecastClass: String, reason: String)? {
        guard f.forecast || f.isForecast else { return nil }
        let kind = f.s("forecastKind")
        if kind == "frozen-benchmark" {
            return ("retrospective-benchmark", "Recorded as a frozen benchmark rather than as a forecast issued ahead of its window.")
        }
        if kind == "aftershock-sequence" {
            return ("post-event-conditional", "Conditional on an earthquake that had already been observed when this was written.")
        }
        if f.truthy("forecastOf") {
            var parentState = parent?.evidenceState ?? ""
            if parentState.isEmpty { parentState = warningProviders.test(f.source) ? "official-warning" : "" }
            if parentState == "official-warning" {
                return ("warning-derived", "Derived from an official warning that the issuing agency had already published.")
            }
            return ("continuation-outlook", "Derived from a hazard already present in the feed, forecasting that it continues.")
        }
        let freeze = f.ms("freezeTimestamp"), start = f.ms("targetStart")
        if freeze == nil || f["freezeEvidenced"] == .bool(false) {
            return ("invalid-post-event", "No immutable record establishes that this forecast existed before the window it claims, so it cannot be counted as a prediction.")
        }
        guard let st = start else {
            return ("invalid-post-event", "The forecast names no window, so nothing can establish that it preceded one.")
        }
        if freeze! > st {
            return ("invalid-post-event", "The earliest record of this forecast is later than the start of the window it claims.")
        }
        return ("independent-prospective", "Frozen at " + (f["freezeTimestamp"]?.jsString ?? "") + ", before the window opening at " + (f["targetStart"]?.jsString ?? "") + ".")
    }

    public static let typeNamesNoHazard = JSRegex("^(?:|natural hazard|other|others|unknown|unspecified|unclassified|complex emergency)$", caseInsensitive: true)

    /// `claimKey(f)`.
    public static func claimKey(_ f: Record) -> String {
        func coordToken(_ v: JSONValue?) -> String {
            let n = v?.jsNumber ?? .nan
            return n.isFinite ? JS.toFixed(n, 3) : "-"
        }
        let typeText = (f["type"].map { $0.isNull ? "" : $0.jsString } ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title: JSONValue? = typeNamesNoHazard.test(typeText) ? f["title"] : nil
        let parts: [JSONValue?] = [f["id"], f["type"], f["targetStart"], f["targetEnd"], f["country"], f["region"],
                                   .string(coordToken(f["lat"])), .string(coordToken(f["lon"])), f["forecastScope"], title]
        return parts.map { v -> String in
            guard let v = v, v.has else { return "-" }
            return v.jsString.trimmingCharacters(in: .whitespacesAndNewlines)
        }.joined(separator: "|")
    }

    /// The hazard-family stem used on the hazard strip and hazard detail:
    /// the first word, with wildfire shortened to "wild" and volcano to "volcan".
    public static func stem(_ type: String) -> String {
        let first = type.lowercased().split(separator: " ").first.map(String.init) ?? type.lowercased()
        if first == "wildfire" { return "wild" }
        if first == "volcano" { return "volcan" }
        return first
    }
}
