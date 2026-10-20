import Foundation

/// The `/api/event-enrichment` response (api.md section 3.3), read leniently.
public struct Enrichment: Sendable {
    public let json: JSONValue
    public init(json: JSONValue) { self.json = json }

    public var generatedAt: String? { json["generatedAt"]?.stringValue }
    func strings(_ k: String) -> [String] { json[k]?.arrayValue?.compactMap { $0.stringValue } ?? [] }
    func objects(_ k: String) -> [Record] { json[k]?.arrayValue?.compactMap { Record(json: $0) } ?? [] }
}

public struct Link: Hashable, Sendable {
    public let label: String
    public let url: String
    public init(_ label: String, _ url: String) { self.label = label; self.url = url }
}

public struct EnrichmentCard: Hashable, Sendable, Identifiable {
    public var id: String { title + "|" + (url ?? "") + "|" + (phone ?? "") + body.joined() }
    public var title: String
    public var tags: [String] = []
    public var verifiedTags: Set<String> = []
    public var body: [String] = []
    public var list: [String]? = nil
    public var phone: String? = nil
    public var phoneSmall = false
    public var email: String? = nil
    public var imageURL: String? = nil
    public var url: String? = nil
    public var small: String? = nil
    public var cta: String? = nil
    public var links: [Link] = []
}

public struct KeyValue: Hashable, Sendable, Identifiable {
    public var id: String { key }
    public let key: String
    public let value: String
    public var note: String? = nil
    public var links: [Link] = []
}

public struct EnrichmentPanel: Sendable, Identifiable {
    public let id: String
    public let title: String
    public var meta: String
    public var rows: [KeyValue] = []
    public var cards: [EnrichmentCard] = []
}

/// `event-enrichment.js`: the ten panels, in order, with the site's wording.
public enum EnrichmentPanels {
    public static let panels: [(id: String, title: String, note: String)] = [
        ("whenWhere", "When and where it happened", "Where it started, the nearest place and the areas affected"),
        ("distress", "Who may need help, and how to stay safe", "General guidance for this type of disaster, not confirmed reports about people"),
        ("news", "News reports", ""),
        ("reports", "Official situation reports", "From ReliefWeb (UN OCHA)"),
        ("videos", "Videos", ""),
        ("helplines", "Emergency phone numbers", "Only numbers published by national authorities"),
        ("authorities", "Official agencies and contacts", ""),
        ("support", "Local and national support groups", ""),
        ("relief", "Relief organisations and donations", "Links to official organisation websites only"),
        ("directories", "Directories, and where this information comes from", "")
    ]

    public static func loading() -> [EnrichmentPanel] {
        panels.map { EnrichmentPanel(id: $0.id, title: $0.title, meta: $0.note.isEmpty ? "Loading\u{2026}" : $0.note,
                                     cards: [EnrichmentCard(title: "", body: ["Loading\u{2026}"])]) }
    }

    public static func failure() -> [EnrichmentPanel] {
        panels.map { EnrichmentPanel(id: $0.id, title: $0.title, meta: "Trying again", cards: [EnrichmentCard(
            title: "This information is not available right now",
            body: ["Our help-information service did not respond. The rest of this page is still live. This section will try again by itself."])]) }
    }

    static func tel(_ p: String) -> String { "tel:" + p.filter { $0 == "+" || ($0.isASCII && $0.isNumber) } }

    static func s(_ v: JSONValue?) -> String { (v?.isTruthy ?? false) ? v!.jsString : "" }

    static func list(_ items: [String]) -> [String]? { items.isEmpty ? nil : items }

    public static func build(_ d: Enrichment, event e: Record, tz: String? = nil, now: Double? = nil) -> [EnrichmentPanel] {
        let j = d.json
        var out: [EnrichmentPanel] = []
        let fmt: (String?) -> String = { v in (v ?? "").isEmpty ? "-" : Format.fmtDate(v, tz: tz) }

        // 1. When and where
        var rows: [KeyValue] = []
        let w = j["where"] ?? .object([:]), when = j["when"] ?? .object([:])
        let place = w["resolvedPlace"].flatMap { $0.isTruthy ? $0 : nil }
        let reported = s(when["reportedAt"]).isEmpty ? e.updated : s(when["reportedAt"])
        let ageText = reported.isEmpty ? "" : Format.age(reported, now: now)
        rows.append(KeyValue(key: "When it was reported", value: fmt(reported) + (ageText.isEmpty ? "" : " \u{00B7} " + ageText)))
        if e.truthy("startedAt") { rows.append(KeyValue(key: "When it started", value: fmt(e.s("startedAt")))) }
        if e.forecast && e.truthy("targetStart") { rows.append(KeyValue(key: "Forecast period", value: Format.windowText(e, tz: tz))) }
        if e.truthy("expiresAt") { rows.append(KeyValue(key: "Official warning ends", value: fmt(e.s("expiresAt")))) }
        let origin = [s(w["originArea"]), e.region, e.country].first { !$0.isEmpty } ?? "Not given by the source"
        rows.append(KeyValue(key: "Where it started", value: origin))
        if let p = place {
            let parts = [s(p["locality"]), s(p["city"]), s(p["state"]), s(p["country"])].filter { !$0.isEmpty }
            rows.append(KeyValue(key: "Nearest place", value: parts.isEmpty ? "-" : parts.joined(separator: " \u{00B7} "),
                                 note: "Worked out from the map position the source gave \u{00B7} " + (s(p["resolvedBy"]).isEmpty ? "map lookup" : s(p["resolvedBy"]))))
            if !s(p["continent"]).isEmpty { rows.append(KeyValue(key: "Continent", value: s(p["continent"]))) }
        }
        rows.append(KeyValue(key: "Areas affected", value: s(w["affectedAreaText"]).isEmpty ? "-" : s(w["affectedAreaText"])))
        if let c = w["coordinates"], c.isTruthy {
            let m = w["mapLinks"] ?? .object([:])
            var links: [Link] = []
            if !s(m["openStreetMap"]).isEmpty { links.append(Link("OpenStreetMap \u{2197}", s(m["openStreetMap"]))) }
            if !s(m["googleMaps"]).isEmpty { links.append(Link("Google Maps \u{2197}", s(m["googleMaps"]))) }
            if !s(m["windy"]).isEmpty { links.append(Link("Weather map \u{2197}", s(m["windy"]))) }
            let lat = c["lat"]?.jsNumber ?? .nan, lon = c["lon"]?.jsNumber ?? .nan
            rows.append(KeyValue(key: "Coordinates", value: JS.toFixed(lat, 4) + ", " + JS.toFixed(lon, 4), links: links))
        }
        rows.append(KeyValue(key: "Type", value: e.type.isEmpty ? "-" : e.type))
        rows.append(KeyValue(key: "Source", value: e.source.isEmpty ? "-" : e.source,
                             links: e.sourceURL.map { [Link("Open the original report \u{2197}", $0.absoluteString)] } ?? []))
        rows.append(KeyValue(key: "About these times", value: s(when["note"])))
        out.append(EnrichmentPanel(id: "whenWhere", title: panels[0].title, meta: "Updated " + fmt(d.generatedAt), rows: rows))

        // 2. Who may need help
        let groups = d.strings("distressGroups"), needs = d.strings("immediateNeeds")
        out.append(EnrichmentPanel(id: "distress", title: panels[1].title, meta: "\(groups.count) groups \u{00B7} \(needs.count) needs", cards: [
            EnrichmentCard(title: "Who may need help first", body: groups.isEmpty ? ["Not available for this event."] : [], list: list(groups)),
            EnrichmentCard(title: "Immediate needs", body: needs.isEmpty ? ["Not available for this event."] : [], list: list(needs)),
            EnrichmentCard(title: "Other dangers to watch for", body: d.strings("secondaryRisks").isEmpty ? ["Not available for this event."] : [], list: list(d.strings("secondaryRisks"))),
            EnrichmentCard(title: "How to stay safe", body: d.strings("safetyActions").isEmpty ? ["Not available for this event."] : [], list: list(d.strings("safetyActions")))
        ]))

        let searches = j["searches"] ?? .object([:])
        func newsCard(_ x: Record) -> EnrichmentCard {
            let established = x.truthy("established")
            let outlet = x.s("outlet").isEmpty ? "Source" : x.s("outlet")
            var tags = [outlet]
            var verified = Set<String>()
            if established { tags.append("Established newsroom"); verified = Set(tags) }
            let pub = x.s("publishedAt")
            let small = (pub.isEmpty || JSDate.ms(pub) == nil ? "Publication time not given" : Format.fmtDate(pub, tz: tz)) +
                (x.s("via").isEmpty ? "" : " \u{00B7} via " + x.s("via"))
            let summary = Format.utf16Prefix(x.s("summary"), 200)
            return EnrichmentCard(title: x.title, tags: tags, verifiedTags: verified, body: summary.isEmpty ? [] : [summary],
                                  url: x.s("link"), small: small, cta: "Read more \u{2197}")
        }

        // 3. News
        let news = d.objects("news")
        out.append(EnrichmentPanel(id: "news", title: panels[2].title,
            meta: "\(news.count) report" + (news.count == 1 ? "" : "s") + " \u{00B7} only from established newsrooms and official agencies",
            cards: news.isEmpty ? [EnrichmentCard(title: "No news reports found yet",
                body: ["News searches can be slow to pick up a new event. Try the directories below. This section refreshes by itself."],
                links: s(searches["googleNews"]).isEmpty ? [] : [Link("Search news \u{2197}", s(searches["googleNews"]))])] : news.map(newsCard)))

        // 4. Situation reports
        let reports = d.objects("situationReports")
        out.append(EnrichmentPanel(id: "reports", title: panels[3].title,
            meta: "\(reports.count) official report" + (reports.count == 1 ? "" : "s"),
            cards: reports.isEmpty ? [EnrichmentCard(title: "No matching ReliefWeb report yet",
                body: ["Situation reports come out once aid groups organise a response, so there may be none in the first hours of an event."],
                links: s(searches["reliefweb"]).isEmpty ? [] : [Link("Search ReliefWeb \u{2197}", s(searches["reliefweb"]))])] : reports.map(newsCard)))

        // 5. Videos
        let videos = d.objects("videos")
        out.append(EnrichmentPanel(id: "videos", title: panels[4].title, meta: "\(videos.count) video" + (videos.count == 1 ? "" : "s"),
            cards: videos.isEmpty ? [EnrichmentCard(title: "No videos found", body: ["Video search may be down, or it has not picked up this event yet."],
                links: s(searches["youtube"]).isEmpty ? [] : [Link("Search for videos \u{2197}", s(searches["youtube"]))])]
                : videos.map { EnrichmentCard(title: $0.title, imageURL: $0.s("thumbnail"), url: $0.s("url"), cta: "Watch \u{2197}") }))

        // 6. Emergency phone numbers
        let h = j["helplines"] ?? .object([:])
        let nums = (h["emergency"]?.arrayValue ?? []).compactMap { Record(json: $0) }
        var helpCards = nums.map { x in
            EnrichmentCard(title: x.s("label").isEmpty ? "Emergency contact" : x.s("label"),
                           body: [x.s("note"), s(h["country"])].filter { !$0.isEmpty }, phone: x.s("phone"))
        }
        if helpCards.isEmpty {
            helpCards = [EnrichmentCard(title: "We have no verified national emergency number for this place",
                body: ["We never guess a number. Use the official agency links in the next section, or call your local emergency service."])]
        }
        var emails: [EnrichmentCard] = []
        for a in d.objects("authorities") where a.truthy("email") {
            emails.append(EnrichmentCard(title: a.s("name") + " (email)", email: a.s("email"),
                links: a.truthy("contactUrl") ? [Link("Official contact page \u{2197}", a.s("contactUrl"))] : []))
        }
        for r in d.objects("reliefGroups") where r.truthy("email") {
            emails.append(EnrichmentCard(title: r.s("name") + " (email and phone)", phone: r.truthy("phone") ? r.s("phone") : nil, phoneSmall: true,
                email: r.s("email"), links: r.truthy("contactUrl") ? [Link("Official contact page \u{2197}", r.s("contactUrl"))] : []))
        }
        let helpMeta = (s(h["country"]).isEmpty ? "" : s(h["country"]) + " \u{00B7} ") + "\(nums.count) verified number" + (nums.count == 1 ? "" : "s") +
            " \u{00B7} \(emails.count) published email contact" + (emails.count == 1 ? "" : "s")
        out.append(EnrichmentPanel(id: "helplines", title: panels[5].title, meta: helpMeta,
            cards: helpCards + emails + [EnrichmentCard(title: "Where these contacts come from", body: [s(h["note"])])]))

        // 7. Official agencies
        let auth = d.objects("authorities")
        out.append(EnrichmentPanel(id: "authorities", title: panels[6].title, meta: "\(auth.count) agenc" + (auth.count == 1 ? "y" : "ies"),
            cards: auth.isEmpty ? [EnrichmentCard(title: "We do not have a national agency listed for this country yet",
                body: ["Use the directories below to find the right national agency."])]
                : auth.map { x in EnrichmentCard(title: x.s("name"), body: ["Official national agency for warnings, advice and emergency response."],
                    links: [Link("Open the official website \u{2197}", x.s("url"))] + (x.truthy("contactUrl") ? [Link("Contact \u{2197}", x.s("contactUrl"))] : [])) }))

        // 8. Support groups
        let support = d.objects("supportGroups")
        out.append(EnrichmentPanel(id: "support", title: panels[7].title, meta: "\(support.count) support group" + (support.count == 1 ? "" : "s"),
            cards: support.isEmpty ? [EnrichmentCard(title: "We do not have a national support group listed yet",
                body: ["The IFRC directory below lists the Red Cross or Red Crescent society for every country."],
                links: [Link("Find your national Red Cross or Red Crescent \u{2197}", "https://www.ifrc.org/national-societies-directory")])]
                : support.map { x in EnrichmentCard(title: x.s("name"), body: ["National relief and support organisation."],
                    links: (x.truthy("donate") ? [Link("Donate \u{2197}", x.s("donate"))] : []) + [Link("Website \u{2197}", x.s("url"))]) }))

        // 9. Relief and donations (always empty for forecasts)
        let relief = d.objects("reliefGroups")
        let policy = s(j["donationPolicy"])
        out.append(EnrichmentPanel(id: "relief", title: panels[8].title, meta: "\(relief.count) organisation" + (relief.count == 1 ? "" : "s") + " with donation pages",
            cards: relief.isEmpty ? [EnrichmentCard(title: "Donation links held back", body: [policy])]
                : relief.map { x in EnrichmentCard(title: x.s("name"), body: [x.s("kind").isEmpty ? "Humanitarian support" : x.s("kind")],
                    links: [Link("Official donation page \u{2197}", x.truthy("donate") ? x.s("donate") : x.s("url")), Link("Emergency page \u{2197}", x.s("url"))]) }
                  + [EnrichmentCard(title: "About donations", body: [policy])]))

        // 10. Directories and provenance
        let dirs = d.objects("directories").map { x in
            EnrichmentCard(title: x.s("name"), body: [x.s("kind")].filter { !$0.isEmpty }, links: [Link("Open \u{2197}", x.s("url"))])
        }
        let prov = d.objects("sources").map { src -> String in
            let n = src.numOf("items")
            return src.s("name") + ": " + src.s("role") + " \u{00B7} " + JS.numberString(n) + " item" + (n == 1 ? "" : "s")
        }
        let refresh = s(j["coverage"]?["refreshTarget"])
        out.append(EnrichmentPanel(id: "directories", title: panels[9].title,
            meta: "How often this updates: " + (refresh.isEmpty ? "each time the page loads" : refresh),
            cards: dirs + [EnrichmentCard(title: "Where this information comes from", body: [s(j["disclaimer"])].filter { !$0.isEmpty }, list: prov)]))
        return out
    }
}
