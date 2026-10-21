import Foundation

/// A place answer before the feed loads is not an all-clear (changelog C26,
/// `place-risk.js feedState`, `index.html answer()/pendingAnswer()`).
extension PlaceRisk {
    public enum FeedState: String, Sendable { case loading, failed, loaded }

    /// `feedState(loaded, failed)`: `loaded` means a feed has loaded at least
    /// once; `failed` that the last attempt failed.
    public static func feedState(loaded: Bool, failed: Bool) -> FeedState {
        loaded ? .loaded : (failed ? .failed : .loading)
    }

    public struct Pending: Equatable, Sendable {
        public let headline: String
        public let text: String
        public let lastChecked: String
    }

    public static let pendingLoading = Pending(headline: "Checking\u{2026}", text: "Checking the latest reports for this place.",
                                               lastChecked: "not yet: the data is still loading")
    public static let pendingFailed = Pending(headline: "Live data unavailable",
                                              text: "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.",
                                              lastChecked: "not yet: the latest data could not be loaded")

    /// `PENDING[state]` (nil once the feed has loaded).
    public static func pending(_ state: FeedState) -> Pending? {
        switch state {
        case .loading: return pendingLoading
        case .failed: return pendingFailed
        case .loaded: return nil
        }
    }

    /// The one step that holds with no data: who to ask.
    public static let pendingStep = "For official information about this place, check your national or local disaster agency."

    /// My places summary chip, before and after the feed loads.
    public static func summaryChip(_ place: Place, _ events: [Record], state: FeedState) -> String {
        if let p = pending(state) { return p.headline.uppercased() }
        return summaryChip(assess(place, events))
    }

    /// The Home place card, as the page draws it.
    public struct AnswerCard: Sendable {
        public let state: FeedState
        public let eyebrow: String
        /// The badge text: a level label, "Nothing reported nearby", or the pending headline.
        public let badge: String
        public let level: RiskLevel?
        public let heading: String
        /// What's happening: the lead's (glossary-expanded) title and its line.
        public let leadTitle: String?
        public let leadLine: String?
        /// What's happening when there is no lead, or the pending text.
        public let happeningText: String?
        /// The failed state shows the C19 unavailable card instead.
        public let unavailableCard: Bool
        public let why: String?
        public let steps: [String]
        public let authority: String
        public let lead: Record?
        public let lastChecked: String
        /// `aria-busy`: only while loading.
        public let busy: Bool

        /// What's happening as text read aloud.
        public var happening: String {
            if unavailableCard { return Format.unavailableTitle + " " + Format.unavailableBody }
            if let t = leadTitle, let l = leadLine { return t + " " + l }
            return happeningText ?? ""
        }
    }

    public static func answerCard(_ place: Place, events: [Record], state: FeedState, generatedAt: String?, tz: String? = nil) -> AnswerCard {
        if let p = pending(state) {
            return AnswerCard(state: state, eyebrow: "Current risk", badge: p.headline, level: nil, heading: place.name, leadTitle: nil, leadLine: nil,
                              happeningText: state == .failed ? nil : p.text, unavailableCard: state == .failed, why: nil, steps: [pendingStep],
                              authority: authorityLine, lead: nil, lastChecked: p.lastChecked, busy: state == .loading)
        }
        let a = assess(place, events, generatedAt: generatedAt)
        let acts = actionsFor(a)
        let lead = a.lead?.event
        var line: String? = nil
        if let e = lead {
            let where_ = Format.placeOf(e)
            line = (e.type.isEmpty ? "Hazard" : e.type) + (where_.isEmpty ? "" : " \u{00B7} " + where_) + " \u{00B7} reported " + Format.age(e.updated)
        }
        let last = generatedAt.map { Format.fmtDate($0, tz: tz) + " \u{00B7} " + Format.age($0) } ?? pendingLoading.lastChecked
        return AnswerCard(state: state, eyebrow: "Current risk", badge: a.level?.label ?? Copy.nothingNearbyChip, level: a.level, heading: place.name,
                          leadTitle: lead.map { Glossary.expandAlways($0.title) }, leadLine: line,
                          happeningText: lead == nil ? "None of our sources reports anything at this place right now." : nil,
                          unavailableCard: false, why: a.why, steps: acts.steps, authority: acts.authority, lead: lead, lastChecked: last, busy: false)
    }

    /// The place page's answer line before the feed loads ("Checking… {text}").
    public static func pendingLine(_ state: FeedState) -> (badge: String, text: String)? {
        pending(state).map { ($0.headline, $0.text) }
    }
}
