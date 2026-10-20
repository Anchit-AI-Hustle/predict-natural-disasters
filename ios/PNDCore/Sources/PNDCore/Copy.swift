import Foundation

/// Fixed copy from the site's pages, bundled verbatim (features.md says to
/// bundle the static prose).
public enum Copy {
    public struct Item: Hashable, Sendable { public let title: String; public let body: String
        public init(_ t: String, _ b: String) { title = t; body = b } }

    // MARK: global

    public static let loadError = "Live data unavailable. Trying again automatically."
    public static let loading = "Loading the latest data\u{2026}"
    public static let notFound = "That event or forecast is no longer listed. We searched the latest data by its ID and by its title, and found no match."
    public static let footerLine = "Up-to-date information from public sources. This is not an official warning service. In an emergency, follow your local authorities."
    public static let notRatedTitle = "No alert level was published for this record and no severity has been assessed for it."
    public static let nothingNearbyChip = "Nothing reported nearby"

    // MARK: home

    public static let heroTitle = "Is a place you care about at risk?"
    public static let heroSub = "Search for any city, town or neighbourhood to see what official agencies are reporting near it right now, and why it matters."
    public static let quoteTitle = "\u{201C}Prepared communities save lives.\u{201D}"
    public static let quoteSub = "Data for a safer, more resilient world."
    public static let utilities: [Item] = [
        Item("My places", "Save your home, office, family or travel places and see the dangers near them."),
        Item("What should I do now?", "Open a live event to see how serious it is, what is known and where to get help."),
        Item("Forecasts", "See what may happen next, and tell official warnings apart from our own estimates."),
        Item("Track record", "See how our past forecasts turned out.")
    ]
    public static let homeFooter = "Our forecasts help you stay aware and prepared. They do not replace official government warnings."
    public static let nd001Title = "ND-001 \u{00B7} Central Vietnam: flash floods and landslides"
    public static let nd001Teaser = "Covered 13 to 16 Sep 2026. Written after that period began, so it is a test case, not an advance forecast."
    public static let whatWeCheck = "Timing \u{00B7} Place \u{00B7} Cause \u{00B7} Severity \u{00B7} Official reports"
    public static let howWeCheck = "A forecast counts as correct only if real damage or impacts matched what it said, in the place and period it named."
    public static let regionsExplore = ["World", "Asia", "Africa", "North America", "South America", "Europe", "Oceania"]
    public static let homeHazards = ["Earthquake", "Wildfire", "Flood", "Drought", "Tropical Cyclone", "Severe Storm", "Volcano", "Landslide", "Tornado", "Extreme Cold"]

    // MARK: alerts

    public static let howToReadAlerts = [
        "Red and orange are the two highest alert levels. We treat them as the most serious.",
        "USGS earthquakes are earthquakes that have already happened. They may not have a colour alert level like GDACS alerts do.",
        "Open any alert to see where it is, its reported impact, when the source last updated it, and a link to the original report."
    ]

    // MARK: forecasts

    public static let forecastNote = "Each forecast is our own estimate, based on a current official report. It may be wrong. It is not an official warning and does not replace one."
    public static let highAlertNote = "Official agencies have given these events a high alert level. These reports show what is happening now. They are not forecasts. We make our forecasts above from official reports like these."
    public static let howWeMakeForecasts: [Item] = [
        Item("1. Spot", "We look for unusual weather, water or ground conditions."),
        Item("2. Where and when", "We mark the area that may be hit and the dates the forecast covers."),
        Item("3. Keep them apart", "We never show an official report as our forecast, or our forecast as an official report."),
        Item("4. Check", "Later, we check each forecast against what really happened. We lock the rules for that check when we make the forecast: the dates, the area, the cause and what counts as damage.")
    ]
    public static let nd001Blurb = "This forecast is separate from official warnings. A warning or heavy rain alone does not make it correct. It only counts as correct if serious damage or harm is reported inside the area and dates that were locked when it was made."
    public static let calendarNote = "Each bar runs from the start of a forecast to its expected end. The line marks now. Forecasts are our own estimates, not official warnings."
    public static let calendarEmptyTitle = "No forecasts to show for these dates."
    public static let calendarEmptyBody = "Try removing a filter, or refresh the page."
    public static let verificationNotice = "Important: These are our own estimates, not official warnings. We do not predict exactly when an earthquake will strike. We check each forecast only against real harm or damage, reported by an independent source after the forecast was made."
    public static let verificationRules: [Item] = [
        Item("Timing", "The harm or damage must happen during the forecast period."),
        Item("Place", "It must happen in the area we named when we recorded the forecast."),
        Item("Cause", "The hazard must happen in the way we forecast."),
        Item("Real harm", "A warning or report that already existed does not count as a correct forecast on its own. The harm or damage must be reported by an independent source, and it must be serious enough to matter."),
        Item("Result", "We mark each forecast correct, partly correct, wrong or cannot be checked. We keep the evidence from our sources.")
    ]

    // MARK: event detail

    /// `responseContext(type)`: who may need help, needs, other dangers.
    public static func responseContext(_ type: String) -> [Item] {
        let t = type.lowercased()
        if t.contains("earthquake") { return [
            Item("Who may need help first", "People in damaged buildings; injured people and those who cannot move easily; people who have lost their homes"),
            Item("Immediate needs", "Search and rescue; treatment for injuries; temporary shelter; checks that buildings are safe"),
            Item("Other dangers to watch for", "Aftershocks; damaged roads, bridges and power lines; landslides, or a tsunami where one can happen")] }
        if t.contains("flood") { return [
            Item("Who may need help first", "People in low-lying areas and near rivers; households cut off by water; children, older people and people with disabilities"),
            Item("Immediate needs", "Evacuation; clean water; food; medicines; toilets and washing; access for rescuers"),
            Item("Other dangers to watch for", "Dirty water; roads and bridges washed away; landslides; people unable to go home for a long time")] }
        if JSRegex("cyclone|storm|typhoon|hurricane").test(t) { return [
            Item("Who may need help first", "People on the coast and in low-lying areas; people in weak housing; people who work at sea; people with medical needs"),
            Item("Immediate needs", "Shelter; food and water; medical help; getting power and phones working again"),
            Item("Other dangers to watch for", "Storm surge (sea water pushed inland); flooding; wind damage; debris and blocked roads")] }
        if t.contains("fire") { return [
            Item("Who may need help first", "People near the fire; people with breathing problems; older people; households that have been evacuated"),
            Item("Immediate needs", "Evacuation; shelter; protection from smoke; medical help; help for pets and livestock"),
            Item("Other dangers to watch for", "Smoke; road closures; loss of power and water; landslides on burned slopes")] }
        if t.contains("volcan") { return [
            Item("Who may need help first", "People near the danger zone; people exposed to ash; farmers and livestock owners"),
            Item("Immediate needs", "Evacuation; masks against ash; clean water; clearing ash"),
            Item("Other dangers to watch for", "Falling ash; mudflows of ash and water (lahars); flight disruption; crop losses")] }
        return [
            Item("Who may need help first", "People in the affected area; households that have lost their homes or are cut off"),
            Item("Immediate needs", "Shelter; food; clean water; medical help; working phones"),
            Item("Other dangers to watch for", "Blocked roads, and knock-on damage to power, water and phone services")]
    }

    public static let lifeSafety = "Follow instructions from the issuing authority and local emergency services."
    public static let noSourceLink = "The source gave no link for this report. Check with your local emergency service before you act."
    public static let notAnInstruction = "This is up-to-date information from the report named above. It is not an instruction issued by any authority."
    public static let impactNote = "If the source gives no figure, we show \u{201C}Not reported\u{201D}. We never assume it is zero."
    public static let alertImpactNote = "We show impact figures only when the source gives them. A missing figure does not mean there was no impact."
    public static let alertSafety = "This page sums up a report from an official agency or source. It is not a new government warning."
    public static let alertSafety2 = "For evacuation, shelter, travel limits and what to do in an emergency, use the original source and your local authorities\u{2019} instructions."
    public static let calamitySafety = "We show events as official sources report them. If we show a saved copy of an event, we label it and do not present it as live."
    public static let calamitySafety2 = "In an emergency, follow your local government, civil protection agency and weather service."

    public static let voice: [String: String] = ["observed": "reporting an event that has happened", "official-warning": "issuing an official warning",
                                                 "forecast": "a forecast made by this site", "unknown": "type of report not known"]

    // MARK: forecast detail

    public struct Mechanism: Sendable { public let trigger: String; public let transmission: String; public let exposure: String }

    public static func mechanism(_ type: String) -> Mechanism {
        let table: [String: Mechanism] = [
            "Flood": Mechanism(trigger: "rain falling faster than the ground and drains can take it",
                transmission: "Water collects in channels and low ground. Rivers can keep rising downstream long after the rain stops. That is why floods often reach places the storm itself never crossed.",
                exposure: "Low-lying towns and villages, river and canal banks, roads built across flood plains, and drains that back up once the channels are full."),
            "Flood / Landslide": Mechanism(trigger: "long, steady rain on slopes that are already soaked",
                transmission: "Water fills the soil until the slope can no longer hold its own weight. So floods in the valleys and landslides on the slopes above often come together, within hours of each other.",
                exposure: "Homes on hillsides and the roads below them, valley floors, and the roads in and out that a single landslide can block."),
            "Landslide": Mechanism(trigger: "soaked ground on unstable slopes",
                transmission: "Once the soil can no longer hold its weight, the slope gives way. This usually happens at its steepest and wettest point. The debris often travels further than the scar on the slope suggests.",
                exposure: "Anything below the slope: homes, roads, and the single roads that many mountain communities rely on."),
            "Earthquake": Mechanism(trigger: "a break along a fault that has already moved",
                transmission: "Shaking spreads outward and is felt far from where the earthquake started. Soft ground and weakly built buildings make it worse.",
                exposure: "Older brick and stone buildings, buildings without steel reinforcement, and slopes loosened by the main earthquake."),
            "Earthquake aftershock sequence": Mechanism(trigger: "the main earthquake already recorded at this location",
                transmission: "Aftershocks become less frequent over days to weeks. The largest is usually about 1 magnitude smaller than the main earthquake. They are not new, separate earthquakes. This describes a series of aftershocks that has already started.",
                exposure: "Buildings the main earthquake already weakened. They can collapse under much milder shaking than the shaking that first damaged them."),
            "Tropical Cyclone": Mechanism(trigger: "a cyclone that the agency is already tracking",
                transmission: "Wind, storm surge and rain arrive at different times and reach different distances. Storm surge follows the coast. Rain can flood rivers far inland.",
                exposure: "Coastal towns and the low ground behind them, ports and boats, and inland river areas that flood after the wind has passed."),
            "Severe Storm": Mechanism(trigger: "stormy weather that the agency has already flagged",
                transmission: "It brings strong wind, hail and heavy rain over a short time. Streets can flood where drains cannot keep up.",
                exposure: "Exposed buildings, power lines, transport, and low ground that floods quickly."),
            "Tornado": Mechanism(trigger: "conditions the agency judged could produce a tornado",
                transmission: "A tornado is a narrow, fast-moving path of extreme wind. A tornado watch means conditions are right for one. It does not mean anyone has seen one.",
                exposure: "Anything in its path. But the path is narrow, and no one can say in advance where it will be."),
            "Wildfire": Mechanism(trigger: "a fire already spotted by satellite",
                transmission: "How a fire spreads depends on what can burn, the wind and the slope. Fire moves fastest uphill and with the wind behind it.",
                exposure: "Homes at the edge of forest and grassland, places with only one road in or out, and the air far downwind of the fire."),
            "Volcano": Mechanism(trigger: "activity at the volcano already reported by its observatory",
                transmission: "Ash travels with the wind, while flows of lava, rock and mud follow the valleys. So one eruption can threaten quite different areas.",
                exposure: "Communities in the valleys below the volcano, flight routes, and water supplies under the ash cloud."),
            "Drought": Mechanism(trigger: "a lack of rain that has built up over past seasons",
                transmission: "Drought builds and eases slowly. Its effects on water supply, crops and livestock can come months after the rain failed.",
                exposure: "Farms that rely on rain, herders, and communities whose water sources are shallow or already low."),
            "Special Marine Warning": Mechanism(trigger: "a short-lived danger at sea that the weather service has already warned about",
                transmission: "It brings sudden strong winds, waterspouts or squalls over water. These usually last less than 2 hours and move quickly.",
                exposure: "Small boats, anyone on open water, and exposed harbours and moorings."),
            "Extreme Heat": Mechanism(trigger: "a spell of heat already forecast by the weather agency",
                transmission: "The risk grows over several hot days in a row, and when nights stay warm. Warm nights stop the body recovering between hot days.",
                exposure: "Outdoor workers, older people, anyone without a way to keep cool, and built-up areas that stay hot overnight.")
        ]
        return table[type] ?? Mechanism(trigger: "a hazard already reported by an official source",
            transmission: "How this develops depends on the hazard and the ground it crosses. This forecast follows the agency\u{2019}s report. We do not model the hazard ourselves.",
            exposure: "People, transport, and services such as power and water inside the stated area.")
    }

    public static let forecastKinds = ["frozen-benchmark": "Test case, locked but not made in advance",
                                       "signal-derived-outlook": "Short-term forecast based on an official report",
                                       "aftershock-sequence": "Aftershock forecast"]
    public static let seriousHarmWhy = "We never predict deaths, injuries or damage, so we do not assume any. We fill this in only from what others report."
    public static let inEmergency = "In an emergency, follow your national and local authorities."
    public static let claimFrozen = "This forecast is a claim about what will happen. It was locked when it was made. We check it afterwards against the damage or harm that is reported."
    public static let claimDerived = "This forecast follows an official report that was already out when we made it. It says the danger in that report will keep causing harm during the forecast period. It does not claim to have predicted the event before it started."

    // MARK: sources

    public struct SourceProfile: Sendable { public let name, cls, coverage, use, fresh, limits, url: String }

    public static let sourceProfiles: [SourceProfile] = [
        SourceProfile(name: "GDACS", cls: "Official source of disaster alerts worldwide", coverage: "Floods, tropical cyclones, earthquakes, volcanoes, droughts and wildfires around the world.",
                      use: "To find events of every type, with their alert level and likely impact.", fresh: "We check it every time the page loads. Times shown are the times GDACS gives.",
                      limits: "How complete its events and impact figures are depends on the type of hazard and when it last reported.", url: "https://www.gdacs.org/"),
        SourceProfile(name: "USGS", cls: "Official source for earthquakes (a US science agency)", coverage: "Earthquakes around the world.",
                      use: "To show where each earthquake happened, its magnitude and depth, and a link to the USGS report.", fresh: "We check it every time the page loads.",
                      limits: "We use USGS reports of earthquakes that have already happened. We do not use them to claim we can predict the exact time and place of future earthquakes.", url: "https://earthquake.usgs.gov/"),
        SourceProfile(name: "NASA EONET", cls: "Official source of natural events seen by satellite", coverage: "Natural events that are still going on, including wildfires, severe storms and volcanoes.",
                      use: "To find events that satellites can see, and follow them while they last.", fresh: "We check it every time the page loads.",
                      limits: "EONET lists events but gives no safety advice. Follow your local emergency authorities.", url: "https://eonet.gsfc.nasa.gov/"),
        SourceProfile(name: "WMO", cls: "Reference only (an international weather organisation this site does not read)", coverage: "Weather and climate around the world.",
                      use: "Background only. This site does not read data from the WMO.", fresh: "Not checked, because this site does not read its data.",
                      limits: "Most official weather warnings come from each country\u{2019}s own weather service.", url: "https://wmo.int/")
    ]

    /// Whether a name has one of the static profiles (case-insensitive).
    public static func hasSourceProfile(_ raw: String) -> Bool {
        sourceProfiles.contains { $0.name.lowercased() == raw.lowercased() }
    }

    /// Current reports from a source: `source` contains the profile name
    /// (with "nasa " dropped), or equals the raw name.
    public static func sourceReports(_ raw: String, in list: [Record]) -> [Record] {
        let p = sourceProfile(raw)
        let needle = p.name.lowercased().replacingOccurrences(of: "nasa ", with: "")
        return list.filter { $0.source.lowercased().contains(needle) || $0.source.lowercased() == raw.lowercased() }
    }

    /// Source detail STATUS (changelog C22).
    public static func sourceStatus(_ raw: String, meta: JSONValue?, reports: Int) -> String {
        let p = sourceProfile(raw)
        let key = p.name == "NASA EONET" ? "eonet" : p.name.lowercased()
        if let sm = meta?["sources"]?[key] { return (sm["ok"]?.isTruthy ?? false) ? "Working" : "Not answering" }
        return reports > 0 ? "Named in current reports" : "Not read live"
    }

    /// A name with no profile and no current report is not a source.
    public static func sourceNotFound(_ raw: String, reports: Int) -> Bool { !hasSourceProfile(raw) && reports == 0 }

    public static func sourceNotFoundText(_ raw: String) -> String {
        "None of our current reports names a source called \u{201C}" + raw + "\u{201D}."
    }

    public static func sourceProfile(_ raw: String) -> SourceProfile {
        sourceProfiles.first { $0.name.lowercased() == raw.lowercased() } ??
            SourceProfile(name: raw, cls: "Source named in our current reports", coverage: "Depends on the source.", use: "Used where it has reports.",
                          fresh: "Varies by source.", limits: "Check the source itself for what it covers and its limits.", url: "")
    }

    // MARK: regions

    public static let popularPlaces: [Item] = [
        Item("Nepal", "Floods, landslides and earthquakes"), Item("Indonesia", "Earthquakes, volcanoes and floods"),
        Item("India", "Floods, storms, heat and earthquakes"), Item("Vietnam", "Floods, cyclones and our test forecast"),
        Item("Philippines", "Cyclones, floods and earthquakes"), Item("Japan", "Earthquakes, volcanoes and typhoons"),
        Item("United States", "Wildfires, floods and earthquakes"), Item("World", "All current events")
    ]
    public static let regionsWhatWeShow = [
        "You can search any place. We only show events that our sources have reported. We never make up an event to fill an empty place.",
        "If a place shows nothing, our sources have no current report for it. It does not mean the place has no risk."
    ]
    public static let jumpCountries = ["Nepal", "Indonesia", "India", "Vietnam", "Japan", "United States", "Philippines", "World"]

    // MARK: methodology and about

    public static let methodologyIntro = "We collect reports from official agencies. We use some of them to make our own short forecasts. Later, we check each forecast against what really happened. We never claim to be certain. You can see how our forecasts turned out on the Track record page."
    public static let methodologySteps: [Item] = [
        Item("1 \u{00B7} We collect reports", "We read current events and warnings from public sources. These include the GDACS, the USGS, the EMSC, NASA EONET, ReliefWeb and US weather and hurricane services. Each source covers only some hazards and places. If no source reports on a place, we cannot see what is happening there. A place with no reports is not necessarily safe."),
        Item("2 \u{00B7} We tidy them", "We give every event the same basic details: the hazard, the time, the place and the source. When two agencies report the same event, we show it once."),
        Item("3 \u{00B7} We sort them", "You can sort events by date, risk level, place or type. When you check a place, we show which events are close enough to reach it."),
        Item("4 \u{00B7} We make forecasts", "Each forecast starts from an official report. If a hazard such as a flood, storm or fire is still going on, we forecast whether it may carry on. The period depends on the hazard. It is usually a few days, and longer for a drought. After an earthquake of magnitude 5.5 or more, we forecast its aftershocks for 7 days. Every forecast names the hazard, the place and the period it covers."),
        Item("5 \u{00B7} We lock them", "We save each forecast in a public record when we first make it. We only ever add to that record. So the place, the dates and the test for success cannot be changed once the outcome is known."),
        Item("6 \u{00B7} We check them", "When the forecast period ends, we compare the forecast with the disasters that agencies reported. We mark it correct, partly correct or wrong only after looking at that evidence.")
    ]
    public static let markTable: [Item] = [
        Item("Correct", "The hazard happened in the place and period the forecast named."),
        Item("Partly correct", "The hazard happened in that period, but only in part of the place."),
        Item("Wrong", "Agencies reported no such hazard in that place and period."),
        Item("Missed", "A disaster happened that none of our forecasts named."),
        Item("Cannot be checked", "No source we read covers that hazard in that place well enough to say."),
        Item("Test case", "The forecast was written after the event had started, so it does not count as made in advance.")
    ]
    public static let distanceLimit = "Each hazard has a fixed distance limit, for example 250 km for an earthquake and 300 km for a flood. The same limit applies to every forecast. We do not change it to fit a result."
    public static let doNotClaim: [Item] = [
        Item("No made-up percentages", "You will not see a figure like \u{201C}92% chance\u{201D} here. We have no tested way to turn our forecasts into percentages, so we do not show any."),
        Item("Risk levels instead", "We show a risk level: Low, Watch, Moderate, High, Severe or Extreme. It comes from the agency\u{2019}s own alert level or from what was measured, such as wind speed. If we have no level, we say \u{201C}Not rated\u{201D}."),
        Item("Earthquakes cannot be predicted", "No one can predict exactly when and where an earthquake will strike. We report earthquakes after they happen, and we forecast only the aftershocks that follow a strong one.")
    ]
    public static let infoTypes: [(String, String, String)] = [
        ("Event", "Something that has happened, reported or measured by an agency", "From an agency"),
        ("Official warning", "Issued by a government or scientific agency", "From an agency"),
        ("Forecast", "Our own estimate of what may happen next, checked afterwards", "Not an official warning"),
        ("Past disaster", "Used for background and comparison", "Background only")
    ]
    public static let methodologyClosing = "Our forecasts and risk levels are for information only. They do not replace official emergency advice. For safety decisions, follow your local authorities."

    public static let aboutIntro = "This site gathers reports of natural disasters from official agencies around the world. It shows what is happening now and where. It also gives our own forecasts of what may happen next, and it checks those forecasts afterwards."
    public static let aboutAim = "We do not claim to be certain. We want to make disaster information easier to find, compare and check. We always keep three things apart: events that have happened, official warnings and our own forecasts."
    public static let aboutValues: [Item] = [
        Item("Useful, not alarming", "Information should help you understand the danger without making it sound more certain than it is."),
        Item("Clear sources", "Every event and warning should show where it came from and how recent it is."),
        Item("Forecasts we can be held to", "We lock each forecast before the outcome is known. Afterwards, we check it against clear rules that were set in advance.")
    ]
    public static let aboutSections: [Item] = [
        Item("Map", "A world map of current events. You can search for a place and choose which hazards to show."),
        Item("Forecasts", "Our own forecasts of what may happen next. Each one says which hazard, where and when."),
        Item("Official warnings", "Warnings from government and scientific agencies. We keep them apart from our own forecasts."),
        Item("Regions", "Pages for regions, countries and cities. Each one shows the hazards that matter to the place you chose."),
        Item("Track record", "When a forecast period ends, we check the forecast against what really happened."),
        Item("Insights", "Simple counts and background notes on what is being reported. They are not predictions.")
    ]
    public static let aboutDisclaimer = "This site gives information to help you stay aware and prepared. It does not replace official emergency warnings, evacuation orders or instructions from your local authorities."

    // MARK: insights

    public static let insightsIntro = "See which hazards are being reported most, and where. These are simple counts and background notes. They are not warnings, and they do not promise what will happen."
    public static let insightCards: [Item] = [
        Item("Floods and landslides often come together", "Long or very heavy rain can cause several problems at once. Rivers rise, drains overflow, hillsides become soaked and slide, and roads can close. We treat these as linked, but we check each one separately."),
        Item("Where matters most", "How much a hazard matters depends on where you are. A big event far away may not affect your city at all. That is why we give more weight to events near the place you choose."),
        Item("How we judge forecasts", "We judge a forecast only by checking it afterwards. A warning or heavy rain on its own does not count as success. The forecast is correct only if what it said, when it was locked, really happened.")
    ]
    public static let howToRead: [Item] = [
        Item("A pattern is not a prediction", "Past and current patterns can tell you something about risk. They cannot tell you exactly what will happen."),
        Item("Risk changes over time", "New reports and official warnings can quickly change which events matter most, and where."),
        Item("Hazards can come together", "Floods, landslides, storms and damage to roads or power supplies can follow one another. Think about them together.")
    ]
    public static let backgroundNotes: [(String, String, String)] = [
        ("Very heavy rain", "Central Vietnam", "Floods and landslides need closer watching during the forecast period"),
        ("Monsoon rivers", "Northern India", "Local river and drain levels matter more than how an event ranks worldwide"),
        ("Long-lasting wildfires", "Western North America", "Dry weather, wind and dry plants can keep the local risk high"),
        ("Earthquakes", "Pacific Rim", "We can report earthquakes after they happen. No one can predict exactly when and where the next one will strike.")
    ]

    // MARK: ND-001 (verification detail)

    public static let nd001Terms: [(String, String)] = [
        ("Forecast ID", "ND-001"), ("Issued", "13 Sept 2026"), ("Target date", "14 Sept 2026"),
        ("Period we check", "Starts 13 Sept 2026 \u{00B7} expected duration 4 days"),
        ("Area (locked)", "Main area: the corridor from Hu\u{1EBF} to \u{0110}\u{00E0} N\u{1EB5}ng. Wider area: from H\u{00E0} T\u{0129}nh to Qu\u{1EA3}ng Ng\u{00E3}i."),
        ("Expected chain of events (locked)", "Extreme rain, then fast-rising rivers and flooding in towns, then waterlogged slopes, then landslides."),
        ("Correct if", "Floods or landslides cause real harm to communities in the main area during the forecast period. Heavy rain or a warning alone is not enough."),
        ("Partly correct if", "There is heavy rain or flooding with real but smaller harm. Or there is serious harm in the wider area, but outside the main corridor."),
        ("Wrong if", "There is no real harm that counts in the forecast area and period, or the harm comes from an unrelated event.")
    ]
    public static let nd001Rules = [
        "The area, the forecast period and the rules for success are locked. We cannot widen them after we know the outcome.",
        "A warning, heavy rain or a computer model result shows that conditions were right. It does not prove that the forecast disaster happened.",
        "The final result must point to official reports of real harm or damage."
    ]

    // MARK: notifications

    public static let notificationsHonesty = "iOS decides when background refresh runs. It can be hours between checks, and none happen if you force-quit the app or turn off Background App Refresh. So an alert can be late or missing. Do not rely on this app in an emergency: follow your official agency."
}
