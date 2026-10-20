import Foundation

/// A place a reader saved or checked (logic.md section 3.6).
public struct Place: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: String
    public var name: String
    public var lat: Double?
    public var lon: Double?
    public var country: String
    public var countryCode: String
    public var updatedAt: String?
    /// Search-only: the place-chooser level ("City or town") and full address.
    public var level: String?
    public var full: String?

    public init(id: String = "", kind: String = "Place", name: String, lat: Double?, lon: Double?,
                country: String = "", countryCode: String = "", updatedAt: String? = nil, level: String? = nil, full: String? = nil) {
        self.id = id; self.kind = kind; self.name = name; self.lat = lat; self.lon = lon
        self.country = country; self.countryCode = countryCode; self.updatedAt = updatedAt
        self.level = level; self.full = full
    }

    /// From a JSON object (test fixtures, the web's saved-places format).
    public init(json: JSONValue) {
        let r = Record(json.objectValue ?? [:])
        self.init(id: r.s("id"), kind: r.s("kind").isEmpty ? "Place" : r.s("kind"), name: r.s("name"),
                  lat: Geo.coord(r["lat"]), lon: Geo.coord(r["lon"]), country: r.s("country"),
                  countryCode: r.s("countryCode"), updatedAt: r.opt("updatedAt"))
    }

    enum CodingKeys: String, CodingKey { case id, kind, name, lat, lon, country, countryCode, updatedAt, level, full }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "Place"
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        lat = Place.lenientDouble(c, .lat)
        lon = Place.lenientDouble(c, .lon)
        country = (try? c.decode(String.self, forKey: .country)) ?? ""
        countryCode = (try? c.decode(String.self, forKey: .countryCode)) ?? ""
        updatedAt = try? c.decode(String.self, forKey: .updatedAt)
        level = try? c.decode(String.self, forKey: .level)
        full = try? c.decode(String.self, forKey: .full)
    }

    static func lenientDouble(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Double? {
        if let d = try? c.decode(Double.self, forKey: k), d.isFinite { return d }
        if let s = try? c.decode(String.self, forKey: k) {
            let n = JS.number(s)
            return s.trimmingCharacters(in: CharacterSet.whitespaces).isEmpty || !n.isFinite ? nil : n
        }
        return nil
    }

    public static let kinds = ["Home", "Office", "Family", "Travel"]
    public static let currentID = "loc-current"

    /// `{kind} · {name}`, just `{kind}` when kind equals name.
    public var displayName: String { kind == name ? kind : kind + " \u{00B7} " + name }
}

/// `hazard-model.js riskRow` and `place-risk.js` (logic.md sections 3.2 to 3.4).
public enum PlaceRisk {
    public static let radiusKm = 500.0
    public static let nearKm = 50.0
    public static let moderateKm = 150.0

    public enum Band: String, CaseIterable, Sendable { case A, B, C, D, E
        var order: Int { ["A": 0, "B": 1, "C": 2, "D": 3, "E": 4][rawValue]! }
    }

    public struct BandInfo: Sendable {
        public let band: Band
        public let title: String
        public let blurb: String
        public let empty: String
        public let dataAvailable: Bool
    }

    public static let bands: [BandInfo] = [
        BandInfo(band: .A, title: "Confirmed events nearby",
                 blurb: "Events an official agency has reported at an exact spot within 500 km of one of your places.",
                 empty: "No reported event within 500 km of your places.", dataAvailable: true),
        BandInfo(band: .B, title: "Official warnings for your places",
                 blurb: "Warnings in force now. Where the agency published the area a warning covers, we checked whether your place is inside it.",
                 empty: "No official warning covers your places right now.", dataAvailable: true),
        BandInfo(band: .C, title: "Forecasts",
                 blurb: "Our own estimates of what may happen next. They are not reports that something has happened, and they are not official warnings.",
                 empty: "No forecast covers your places right now.", dataAvailable: true),
        BandInfo(band: .D, title: "Wider-area reports",
                 blurb: "Reports that give only the centre of a large area, not an exact spot. They are listed because that centre is within range; your place may or may not be inside the affected area.",
                 empty: "No wider-area report near your places right now.", dataAvailable: true),
        BandInfo(band: .E, title: "Past disasters", blurb: "What has happened at a place before.",
                 empty: "We do not publish a history of past events for each place, so nothing can be shown here. Your national or regional disaster agency keeps the official record.",
                 dataAvailable: false)
    ]

    public enum Applicability {
        public static let insideIncident = "Your place is inside the reported affected area."
        public static let insideWarning = "Your place is inside the official warning area."
        public static let outsideWarning = "Your place is outside the official warning area."
        public static let undetermined = "This is a regional warning. We could not tell whether it covers your exact place."
        public static let forecast = "This is a forecast of what may happen, not a report that something has happened."
        public static let outsideForecast = "Your place is outside the forecast area."
        public static let countryForecast = "This forecast covers the whole country your place is in, not one specific spot."
        public static let countryUnknownPlace = "This forecast covers a whole country, but your saved place has no country recorded. Search for the place by name instead of entering coordinates, and we can check."
        public static let countryUnrecognisedPlace = "This forecast covers a whole country, but we could not recognise the country of your saved place. This can happen if you searched in another language. Search for the place by name again to fix it."
        public static let areaLevel = "This report gives only the centre of an area, not an exact spot. We could not tell whether your place is inside the affected area."
    }

    public struct Row: Equatable, Sendable {
        public let band: Band
        public let distanceKm: Double?
        public let claimDistance: Bool
        public let containment: Bool?
        public let applicability: String
        public let reason: String
    }

    /// `riskRow(e, place, radiusKm)`.
    public static func riskRow(_ e: Record, _ place: Place, radiusKm: Double = radiusKm) -> Row? {
        guard let pLat = place.lat, let pLon = place.lon, pLat.isFinite, pLon.isFinite else { return nil }
        let contains = Geo.geometryContains(e.geometry, pLat, pLon)
        var d: Double? = nil
        if let eLat = e.lat, let eLon = e.lon { d = Geo.distanceKm(pLat, pLon, eLat, eLon) }
        let near = d != nil && d! <= radiusKm
        func out(_ band: Band, _ note: String, _ claim: Bool) -> Row {
            Row(band: band, distanceKm: d, claimDistance: claim, containment: contains, applicability: note, reason: e.s("proximityReason"))
        }
        if e.isForecast || e.forecast {
            if contains == true { return out(.C, Applicability.forecast, false) }
            if contains == false { return near ? out(.D, Applicability.outsideForecast, false) : nil }
            if e.s("forecastScope") == "country" && !e.country.isEmpty {
                if Geo.countryMatches(country: place.country, countryCode: place.countryCode, name: e.country) {
                    return out(.C, Applicability.countryForecast, false)
                }
                if !Geo.placeCountryKeys(country: place.country, countryCode: place.countryCode).isEmpty {
                    if Geo.countryComparable(country: place.country, countryCode: place.countryCode) { return nil }
                    return near ? out(.C, Applicability.countryUnrecognisedPlace, false) : nil
                }
                return near ? out(.C, Applicability.countryUnknownPlace, false) : nil
            }
            return near ? out(.C, Applicability.forecast, e.truthy("proximityEligible")) : nil
        }
        if e.evidenceState == "official-warning" {
            if contains == true { return out(.B, Applicability.insideWarning, false) }
            if contains == false { return near ? out(.D, Applicability.outsideWarning, false) : nil }
            return near ? out(.B, Applicability.undetermined, false) : nil
        }
        if contains == true { return out(.A, Applicability.insideIncident, false) }
        if e.truthy("proximityEligible") && near { return out(.A, "", true) }
        if contains == false { return near ? out(.D, Applicability.outsideWarning, false) : nil }
        return near ? out(.D, Applicability.areaLevel, false) : nil
    }

    public struct Hit: Sendable {
        public let event: Record
        public let row: Row
        public var d: Double { row.distanceKm ?? .infinity }
    }

    /// `rowsFor(place, events)`: band order, then nearest.
    public static func rowsFor(_ place: Place, _ events: [Record]) -> [Hit] {
        let hits = events.compactMap { e in riskRow(e, place).map { Hit(event: e, row: $0) } }
        return Sorts.stableSort(hits) { p, q in
            let b = Double(p.row.band.order - q.row.band.order)
            return b != 0 ? b : Sorts.sub(p.d, q.d)
        }
    }

    /// The level a record itself carries, read the way its badge reads it.
    public static func ownLevel(_ e: Record) -> RiskLevel? {
        let l = RiskScale.level(of: e)
        return l == .unknown ? nil : l
    }

    static func rank(_ k: RiskLevel?) -> Int { k?.rank ?? 0 }

    /// `nearLevel(e, km)`.
    public static func nearLevel(_ e: Record, _ km: Double) -> RiskLevel? {
        let own = ownLevel(e), r = rank(own)
        if km <= nearKm { return r >= RiskLevel.moderate.rank ? own : .watch }
        if km <= moderateKm { return r >= RiskLevel.high.rank ? own : (r >= RiskLevel.moderate.rank ? .watch : .low) }
        return r >= RiskLevel.high.rank ? .watch : .low
    }

    static func atLeast(_ a: RiskLevel?, _ b: RiskLevel?) -> RiskLevel? {
        guard let a = a else { return b }
        guard let b = b else { return a }
        return a.rank >= b.rank ? a : b
    }

    public struct Assessment: Sendable {
        public let place: Place
        public let rows: [Hit]
        public let level: RiskLevel?
        public let lead: Hit?
        public let headline: String
        public let why: String
        public let checkedAt: String?
        public let searchedKm: Int
    }

    /// `assess(place, events, meta)`: "nothing found" is never a safe level.
    public static func assess(_ place: Place, _ events: [Record], generatedAt: String? = nil) -> Assessment {
        let rows = rowsFor(place, events)
        let insideWarning = rows.first { $0.row.band == .B && $0.row.containment == true }
        let insideIncident = rows.first { $0.row.band == .A && $0.row.containment == true }
        let ranked = Sorts.stableSort(
            rows.filter { $0.row.band == .A && $0.row.claimDistance && $0.d.isFinite }.map { ($0, nearLevel($0.event, $0.d)) }
        ) { p, q in
            let r = Double(rank(q.1) - rank(p.1))
            return r != 0 ? r : Sorts.sub(p.0.d, q.0.d)
        }
        let top = ranked.first
        let nearest = top?.0
        let outlook = rows.first { $0.row.band == .C }
        var level: RiskLevel? = nil
        var lead: Hit? = nil
        var why = ""
        let searched = Int(radiusKm)
        if let w = insideWarning {
            lead = w; level = atLeast(.high, ownLevel(w.event))
            why = "Your place is inside the area covered by an official warning. We checked this against the warning area the agency published, not just the distance."
        } else if let i = insideIncident {
            lead = i; level = atLeast(.moderate, ownLevel(i.event))
            why = "Your place is inside the area reported as affected by this event."
        } else if let t = top, t.0.d <= moderateKm, rank(t.1) > RiskLevel.low.rank {
            lead = nearest; level = t.1
            why = "An event was reported " + JS.numberString(JS.round(t.0.d)) + " km from your place. That is the distance between two points. It does not mean the affected area reaches you."
        } else if let o = outlook {
            lead = o; level = .watch
            why = "One of our forecasts covers your place. It is our own estimate of what may happen. It is not a report that something has happened, and it is not an official warning."
        } else if let t = top {
            lead = nearest; level = t.1
            let d = JS.numberString(JS.round(t.0.d))
            why = t.0.d <= moderateKm ? "A minor event was reported \(d) km from your place."
                : "The most serious event near your place is \(d) km away. We look up to \(searched) km away, so it is shown, but it is far from this place."
        }
        var headline = "Nothing reported nearby"
        if let l = level { headline = l.label }
        if level == nil {
            let areaOnly = rows.filter { $0.row.band == .D }.count
            why = "Nothing we track shows a danger at this place right now. " +
                (areaOnly > 0
                    ? (areaOnly == 1 ? "1 report" : "\(areaOnly) reports") + " within \(searched) km give only the centre of a wider area, so we cannot tell whether this place is inside " + (areaOnly == 1 ? "it" : "them") + ". "
                    : "No event with an exact location has been reported within \(searched) km. ") +
                "This does not mean the place is safe. Your national and local disaster agencies have the official information."
        }
        return Assessment(place: place, rows: rows, level: level, lead: lead, headline: headline, why: why,
                          checkedAt: generatedAt, searchedKm: searched)
    }

    public static let authorityLine = "Follow instructions from the issuing authority and local emergency services. Nothing on this page replaces official instructions."

    public struct Actions: Equatable, Sendable {
        public let steps: [String]
        public let authority: String
        public let official: Bool
    }

    /// `actionsFor(assessment)`.
    public static func actionsFor(_ a: Assessment) -> Actions {
        guard let level = a.level else {
            return Actions(steps: ["You do not need to do anything because of this page right now.",
                                   "For official information about this place, check your national or local disaster agency.",
                                   "Save the place so it is checked again each time you open this site."],
                           authority: authorityLine, official: false)
        }
        let official = a.lead?.event.evidenceState == "official-warning"
        var steps: [String] = []
        if official {
            steps.append("An official warning covers this place. Read the warning (linked below) and follow it.")
        } else if level == .watch && a.lead?.row.band == .C {
            steps.append("Nothing has happened yet. This is only our forecast, so check your official weather or disaster service before you act.")
        } else {
            steps.append("Check whether your local authorities have given instructions for this place. This page shows what agencies publish. It does not receive local orders.")
        }
        if level == .high || level == .severe || level == .extreme {
            steps.append("Do not travel into the affected area. Follow any evacuation or shelter instructions given locally.")
            steps.append("Keep following the official agency\u{2019}s updates. Their instructions are the most current. This page is only as current as the last update shown.")
        } else {
            steps.append("Keep an eye on the source (linked below) and on your local agency, not only on this summary.")
        }
        return Actions(steps: steps, authority: authorityLine, official: official)
    }

    /// My places summary chip (`personal-risk.html summarise`).
    public static func summaryChip(_ a: Assessment) -> String {
        guard let _ = a.level else { return "NOTHING REPORTED NEARBY" }
        var s = a.headline.uppercased()
        if let lead = a.lead {
            if lead.row.band == .B { s += " \u{00B7} inside an official warning area" }
            else if lead.row.band == .A && lead.row.containment == true { s += " \u{00B7} inside a reported affected area" }
            else if lead.row.band == .C { s += " \u{00B7} a forecast covers it" }
            else if lead.d.isFinite { s += " \u{00B7} event " + JS.numberString(JS.round(lead.d)) + " km away" }
        }
        return s
    }
}
