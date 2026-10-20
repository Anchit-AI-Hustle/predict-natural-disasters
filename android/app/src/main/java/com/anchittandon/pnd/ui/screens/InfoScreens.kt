@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxWidth as fmw
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.logic.Verdicts
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.strings
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.TrustGroup
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.time.ZoneId

/** observed-model.js familiesOf(h, '')[0]: the hazard family a provider's hazard word belongs to. */
private val FAMILIES = listOf(
    "earthquake" to Regex("\\b(?:earthquakes?|seismic|quakes?)\\b", RegexOption.IGNORE_CASE),
    "tropical-cyclone" to Regex("\\b(?:cyclones?|hurricanes?|typhoons?|tropical storms?)\\b", RegexOption.IGNORE_CASE),
    "flood" to Regex("\\b(?:floods?|flooding|inundation|flash.?floods?)\\b", RegexOption.IGNORE_CASE),
    "landslide" to Regex("\\b(?:landslides?|mudslides?|slope failure)\\b", RegexOption.IGNORE_CASE),
    "wildfire" to Regex("\\b(?:wildfires?|bushfires?|forest fires?|fires?)\\b", RegexOption.IGNORE_CASE),
    "volcano" to Regex("\\b(?:volcano|volcanoes|volcanic|volcan\\w*)\\b", RegexOption.IGNORE_CASE),
    "drought" to Regex("\\b(?:droughts?)\\b", RegexOption.IGNORE_CASE),
    "extreme-heat" to Regex("\\b(?:heat|heatwaves?|extreme heat)\\b", RegexOption.IGNORE_CASE),
    "severe-weather" to Regex("\\b(?:storms?|tornado(?:es)?|winds?|hail|winter)\\b", RegexOption.IGNORE_CASE),
)
fun hazardFamily(h: String): String = FAMILIES.firstOrNull { it.second.containsMatchIn(h) }?.first ?: "other"

/** Our sources (features.md §10.1), from meta.scan.providers. */
@Composable
fun ResourcesScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val (sort, setSort) = rememberSort("resources_sortBy", Sorts.SOURCES)
    val ps = feed.feed?.meta?.scanProviders ?: emptyList()
    val name = { p: JsonObject -> p.text("label").ifEmpty { p.text("provider") } }
    val rs = when (sort) { "name" -> ps.sortedWith { a, b -> Sorts.collator.compare(name(a), name(b)) }; "nameDesc" -> ps.sortedWith { a, b -> Sorts.collator.compare(name(b), name(a)) }; else -> ps }
    PndScreen(header = { item { ScreenHeader(null, "Our sources", "Every source we read, whether it answered this time, and what it means when a source reports nothing.") } }) {
        item(key = "tools") {
            Column {
                Toolbar { SortSelect("resources", Sorts.SOURCES, sort, setSort) }
                val scanAt = feed.feed?.meta?.scan?.str("scanTimestamp")
                Muted(feed.feed?.let { Format.statusText(it.meta.json) + " · sources checked " + Format.fmtDate(scanAt) + " · updated " + Format.age(it.generatedAt) }
                    ?: if (feed.failed) "Live data unavailable. Trying again automatically." else "Loading…")
            }
        }
        if (notLoaded(feed)) return@PndScreen
        if (ps.isEmpty()) { item { EmptyText("We could not get the list of sources read this time, so this page cannot show them. This does not mean no sources were read.") }; return@PndScreen }
        item(key = "summary") {
            val hazards = LinkedHashMap<String, Boolean>()
            ps.forEach { p -> p.arr("hazards").strings().forEach { h -> val f = hazardFamily(h); if (f != "other") { hazards.putIfAbsent(f, false); if (p.str("completeness") == "exhaustive" && p.str("recordsObservations") != "false") hazards[f] = true } } }
            val blind = hazards.filterValues { !it }.keys.sorted().map { it.replace("-", " ") }
            val blindText = if (blind.size > 1) blind.dropLast(1).joinToString(", ") + " and " + blind.last() else blind.joinToString("")
            val answered = ps.count { it.str("status") == "SCANNED" }; val partial = ps.count { it.str("status") == "INCOMPLETE_SCAN" }
            Panel {
                Text("$answered of ${ps.size} sources answered in full this time" + (if (partial > 0) ", and $partial in part" else "") + ".", color = Pnd.text, fontWeight = FontWeight.Bold)
                Body(if (blind.isNotEmpty()) "For $blindText, none of our sources gives a complete list of disasters that have happened. So we cannot say that no such disaster happened, only that none was reported."
                else "For every hazard listed here, at least one source gives a complete list of disasters that have happened. So if that source reports nothing, that is real evidence.")
            }
        }
        items(rs, key = { "p" + it.text("provider") }) { p ->
            val st = mapOf("SCANNED" to Triple(Pnd.okBorder, Pnd.okText, "Answered this time"), "INCOMPLETE_SCAN" to Triple(Pnd.warnBorder, Pnd.warnText, "Answered in part"),
                "DATA_UNAVAILABLE" to Triple(Pnd.badBorder, Pnd.badText, "Did not answer"), "NOT_ATTEMPTED" to Triple(Pnd.mutedBorder, Pnd.mutedText, "Not checked this time"))[p.text("status")]
                ?: Triple(Pnd.mutedBorder, Pnd.mutedText, p.text("status").ifEmpty { "Status not recorded" })
            val reach = p.text("geographicCoverage").ifEmpty { if (p.obj("scope")?.str("kind") == "global") "Global" else "" }
            val absence = if (p.str("recordsObservations") == "false") "It lists warnings or published statuses, not observations of what happened. So if it lists nothing, that does not mean no disaster happened."
            else if (p.str("completeness") == "exhaustive") "It lists every event within its stated limits. So if it reports nothing, that is real evidence that nothing happened within those limits. " + p.text("completenessBasis")
            else "It does not list every event. So if it reports nothing, that is not evidence that nothing happened. " + p.text("completenessBasis")
            val input = when (p.str("inputKind")) {
                "forecast" -> "It says what is expected, so a forecast can be made from it. " + p.text("inputBasis")
                "observation" -> "It reports only what has already happened, so no forecast can be made from it. " + p.text("inputBasis")
                else -> "Not recorded, so we cannot say whether a forecast could be made from it."
            }
            val counted = listOfNotNull(p.jsNum("recordsEvaluated").takeIf { it.isFinite() && p["recordsEvaluated"] != null }?.let { "${com.anchittandon.pnd.model.jsNumText(it)} reports read" },
                p.jsNum("recordsServed").takeIf { it.isFinite() && p["recordsServed"] != null }?.let { "${com.anchittandon.pnd.model.jsNumText(it)} shown on this site" }).joinToString(" · ")
            Box(Modifier.padding(bottom = 8.dp)) {
                CardBox(Modifier.testTag("provider:${p.text("provider")}")) {
                    Pill(st.third, st.first, st.second, upper = false)
                    Text(name(p), color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    KvList(listOf("Hazards" to p.arr("hazards").strings().joinToString(", ").ifEmpty { "Not stated" }, "Reach" to reach.ifEmpty { "Not stated" },
                        "What it lists" to p.text("coverageResolution").ifEmpty { "Not stated" }, "If it reports nothing" to absence.trim(), "Can a forecast be made from it?" to input.trim()))
                    Muted(counted.ifEmpty { "No count recorded this time" } + (if (p.truthy("failureReason")) " · " + p.text("failureReason") else "") + (if (p.truthy("dataFreshness")) " · latest data from " + Format.fmtDate(p.text("dataFreshness")) else ""))
                    if (p.truthy("endpoint")) LinkButton(p.text("endpoint")) { env.container.platform.openUrl(p.text("endpoint")) }
                }
            }
        }
    }
}

/** Insights (features.md §12). */
@Composable
fun InsightsScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val ev = feed.events
    val live = ev.filter { !it.forecast }
    data class Row(val type: String, val count: Int, val places: Int)
    val rows = live.groupBy { it.type.ifEmpty { "Other" } }.map { (t, l) -> Row(t, l.size, l.map { it.country }.filter { it.isNotEmpty() }.toSet().size) }
        .sortedWith { a, b -> (b.count - a.count).takeIf { it != 0 } ?: Sorts.collator.compare(a.type, b.type) }
    fun label(n: Int, w: String, p: String = w + "s") = "$n " + if (n == 1) w else p
    val failed = feed.feed == null && feed.failed
    PndScreen(header = { item { ScreenHeader("Figures", "Insights", "See which hazards are being reported most, and where. These are simple counts and background notes. They are not warnings, and they do not promise what will happen.") } }) {
        item(key = "tiles") {
            MetricTiles(listOf(
                "Events and forecasts" to (if (failed) "Unavailable" else if (feed.feed == null) "-" else ev.size.toString()),
                "Most reported hazard" to (if (failed) "Unavailable" else if (feed.feed == null) "-" else rows.firstOrNull()?.type ?: "None reported"),
                "Our forecasts" to (if (failed) "Unavailable" else if (feed.feed == null) "-" else ev.count { it.forecast }.toString()),
            ))
            Muted(if (failed) "Our data could not be reached" else rows.firstOrNull()?.let { label(it.count, "event") + " in the current data" } ?: "No events in the current data", Modifier.padding(vertical = 6.dp))
        }
        item(key = "dist") {
            Panel("Hazards reported now") {
                when {
                    failed -> Muted("Our data could not be reached, so we cannot show which hazards are being reported. We do not fill this panel with estimates.")
                    feed.feed == null -> Muted("Loading the latest data…")
                    rows.isEmpty() -> Muted("Our sources are not reporting any hazards right now.")
                    else -> {
                        val top = rows.take(5); val max = top.first().count
                        top.forEach { r ->
                            val pct = maxOf(4, Math.round(r.count.toDouble() / max * 100).toInt())
                            Column(Modifier.semantics(mergeDescendants = true) {}) {
                                Text(r.type, color = Pnd.text, fontWeight = FontWeight.Bold)
                                Muted(label(r.count, "event") + " · " + (if (r.places > 0) label(r.places, "country", "countries") else "place not given"))
                                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Pnd.line2)) {
                                    Box(Modifier.fillMaxWidth(pct / 100f).height(8.dp).background(Pnd.green))
                                }
                            }
                        }
                    }
                }
            }
        }
        item(key = "cards") {
            Panel("Background") {
                Step("Floods and landslides often come together", "Long or very heavy rain can cause several problems at once. Rivers rise, drains overflow, hillsides become soaked and slide, and roads can close. We treat these as linked, but we check each one separately.")
                Step("Where matters most", "How much a hazard matters depends on where you are. A big event far away may not affect your city at all. That is why we give more weight to events near the place you choose.")
                Step("How we judge forecasts", "We judge a forecast only by checking it afterwards. A warning or heavy rain on its own does not count as success. The forecast is correct only if what it said, when it was locked, really happened.")
            }
        }
        item(key = "read") {
            Panel("How to read this") {
                Step("A pattern is not a prediction", "Past and current patterns can tell you something about risk. They cannot tell you exactly what will happen.")
                Step("Risk changes over time", "New reports and official warnings can quickly change which events matter most, and where.")
                Step("Hazards can come together", "Floods, landslides, storms and damage to roads or power supplies can follow one another. Think about them together.")
            }
        }
        item(key = "notes") {
            Panel("Background notes") {
                listOf(Triple("Very heavy rain", "Central Vietnam", "Floods and landslides need closer watching during the forecast period"),
                    Triple("Monsoon rivers", "Northern India", "Local river and drain levels matter more than how an event ranks worldwide"),
                    Triple("Long-lasting wildfires", "Western North America", "Dry weather, wind and dry plants can keep the local risk high"),
                    Triple("Earthquakes", "Pacific Rim", "We can report earthquakes after they happen. No one can predict exactly when and where the next one will strike.")).forEach { (t, r, m) ->
                    CardBox { KvList(listOf("Topic" to t, "Region" to r, "What it means" to m)) }
                }
            }
        }
    }
}

/** How it works (features.md §13). Static copy, bundled verbatim. */
@Composable
fun MethodologyScreen() {
    PndScreen(trust = null, feedBanner = false, header = { item { ScreenHeader("Methodology", "How this site works", "We collect reports from official agencies. We use some of them to make our own short forecasts. Later, we check each forecast against what really happened. We never claim to be certain. You can see how our forecasts turned out on the Track record page.") } }) {
        item(key = "steps") {
            Panel {
                Step("1 · We collect reports", "We read current events and warnings from public sources. These include the GDACS, the USGS, the EMSC, NASA EONET, ReliefWeb and US weather and hurricane services. Each source covers only some hazards and places. If no source reports on a place, we cannot see what is happening there. A place with no reports is not necessarily safe.")
                Step("2 · We tidy them", "We give every event the same basic details: the hazard, the time, the place and the source. When two agencies report the same event, we show it once.")
                Step("3 · We sort them", "You can sort events by date, risk level, place or type. When you check a place, we show which events are close enough to reach it.")
                Step("4 · We make forecasts", "Each forecast starts from an official report. If a hazard such as a flood, storm or fire is still going on, we forecast whether it may carry on. The period depends on the hazard. It is usually a few days, and longer for a drought. After an earthquake of magnitude 5.5 or more, we forecast its aftershocks for 7 days. Every forecast names the hazard, the place and the period it covers.")
                Step("5 · We lock them", "We save each forecast in a public record when we first make it. We only ever add to that record. So the place, the dates and the test for success cannot be changed once the outcome is known.")
                Step("6 · We check them", "When the forecast period ends, we compare the forecast with the disasters that agencies reported. We mark it correct, partly correct or wrong only after looking at that evidence.")
            }
        }
        item(key = "mark") {
            Panel("How we mark a forecast") {
                listOf("Correct" to "The hazard happened in the place and period the forecast named.", "Partly correct" to "The hazard happened in that period, but only in part of the place.",
                    "Wrong" to "Agencies reported no such hazard in that place and period.", "Missed" to "A disaster happened that none of our forecasts named.",
                    "Cannot be checked" to "No source we read covers that hazard in that place well enough to say.", "Test case" to "The forecast was written after the event had started, so it does not count as made in advance.").forEach { (r, m) -> Step(r, m) }
                Muted("Each hazard has a fixed distance limit, for example 250 km for an earthquake and 300 km for a flood. The same limit applies to every forecast. We do not change it to fit a result.")
            }
        }
        item(key = "claim") {
            Panel("What we do not claim") {
                Step("No made-up percentages", "You will not see a figure like “92% chance” here. We have no tested way to turn our forecasts into percentages, so we do not show any.")
                Step("Risk levels instead", "We show a risk level: Low, Watch, Moderate, High, Severe or Extreme. It comes from the agency’s own alert level or from what was measured, such as wind speed. If we have no level, we say “Not rated”.")
                Step("Earthquakes cannot be predicted", "No one can predict exactly when and where an earthquake will strike. We report earthquakes after they happen, and we forecast only the aftershocks that follow a strong one.")
            }
        }
        item(key = "types") {
            Panel("Types of information") {
                listOf(Triple("Event", "Something that has happened, reported or measured by an agency", "From an agency"), Triple("Official warning", "Issued by a government or scientific agency", "From an agency"),
                    Triple("Forecast", "Our own estimate of what may happen next, checked afterwards", "Not an official warning"), Triple("Past disaster", "Used for background and comparison", "Background only")).forEach { (a, b, c) ->
                    CardBox { Text(a, color = Pnd.text, fontWeight = FontWeight.Bold); Body(b); Pill(c, upper = false) }
                }
                Muted("Our forecasts and risk levels are for information only. They do not replace official emergency advice. For safety decisions, follow your local authorities.")
            }
        }
    }
}

/** About (features.md §13). */
@Composable
fun AboutScreen() {
    val env = LocalApp.current
    var counts by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(Unit) {
        val d = env.container.data.summary()
        val m = d?.obj("meta")
        counts = if (d == null) "Unavailable" to "Unavailable"
        else (m?.get("countryCount")?.let { com.anchittandon.pnd.model.jsNumText(m.jsNum("countryCount")) } ?: "Unavailable") to (m?.get("hazardTypeCount")?.let { com.anchittandon.pnd.model.jsNumText(m.jsNum("hazardTypeCount")) } ?: "Unavailable")
    }
    PndScreen(trust = null, feedBanner = false, header = { item { ScreenHeader("About this site", "Predict Natural Disasters", "This site gathers reports of natural disasters from official agencies around the world. It shows what is happening now and where. It also gives our own forecasts of what may happen next, and it checks those forecasts afterwards.") } }) {
        item(key = "aim") { Panel("What we are trying to do") { Body("We do not claim to be certain. We want to make disaster information easier to find, compare and check. We always keep three things apart: events that have happened, official warnings and our own forecasts.") } }
        item(key = "figs") {
            MetricTiles(listOf("Countries in the current data" to (counts?.first ?: "-"), "Types of hazard in the current data" to (counts?.second ?: "-"),
                "World to city" to "Browse by region, country or city", "Correct, partly correct or wrong" to "How each forecast turned out"))
        }
        item(key = "care") {
            Panel("What we care about") {
                Step("Useful, not alarming", "Information should help you understand the danger without making it sound more certain than it is.")
                Step("Clear sources", "Every event and warning should show where it came from and how recent it is.")
                Step("Forecasts we can be held to", "We lock each forecast before the outcome is known. Afterwards, we check it against clear rules that were set in advance.")
            }
        }
        item(key = "sections") {
            Panel("What is in this app") {
                listOf("Map" to "A world map of current events. You can search for a place and choose which hazards to show.", "Forecasts" to "Our own forecasts of what may happen next. Each one says which hazard, where and when.",
                    "Official warnings" to "Warnings from government and scientific agencies. We keep them apart from our own forecasts.", "Regions" to "Pages for regions, countries and cities. Each one shows the hazards that matter to the place you chose.",
                    "Track record" to "When a forecast period ends, we check the forecast against what really happened.", "Insights" to "Simple counts and background notes on what is being reported. They are not predictions.").forEach { (a, b) -> Step(a, b) }
                Muted("This site gives information to help you stay aware and prepared. It does not replace official emergency warnings, evacuation orders or instructions from your local authorities.")
            }
        }
    }
}

/** ND-001 verification detail (features.md §14). */
@Composable
fun VerificationDetailScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val id = "ND-001"
    var verdict by remember { mutableStateOf("-") }
    LaunchedEffect(Unit) {
        val l = env.container.data.json("verification-ledger.json") as? JsonObject
        verdict = if (l == null) "Not available" else l.arr("verifications").objects().firstOrNull { it.str("id") == id }
            ?.let { r -> Verdicts.normalise(r.text("status")).let { k -> Verdicts.LABELS[k] } } ?: "Not checked yet"
    }
    val (sort, setSort) = rememberSort("verification-detail_sortBy", Sorts.EVENT_SORTS)
    val re = Regex("[Vv]ietnam|[Đđ]à [Nn]ẵng|[Hh]uế|[Qq]uảng|[Qq]uang")
    val ev = feed.all.filter { re.containsMatchIn(listOf(it.title, it.country, it.region, it.details).joinToString(" ")) }
    val fc = Format.findEvent(feed.all, id) { it.json }
    PndScreen(header = { item { DetailTop("Forecast check", "ND-001 · Central Vietnam flood and landslide forecast", "What we forecast, what was reported and how we decide the result.", "/verification-detail?id=ND-001") } }) {
        val fcStart = fc?.json?.let { it.text("targetStart").ifEmpty { it.text("startedAt").ifEmpty { it.text("updated") } } } ?: ""
        val dateOf = { v: String -> if (JsDate.parse(v) != null) Format.fmtWhen(v).split(",")[0].trim() else "" }
        val dur = fc?.let { Format.duration(fcStart, it.json.text("targetEnd")) } ?: ""
        item(key = "k") { FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Figure("ID", id); Figure("Result", verdict); Figure("Starts", dateOf(fcStart).ifEmpty { "Not stated" }); Figure("Lasts", dur.ifEmpty { "Not stated" }); Figure("Matching reports", if (feed.feed == null) "-" else ev.size.toString())
        } }
        item(key = "rec") {
            Panel("The forecast, as recorded", trailing = { LinkButton("How we check forecasts →") { env.navigate("/verification") } }) {
                KvList(listOf("Forecast ID" to id, "Issued" to "13 Sept 2026", "Target date" to "14 Sept 2026", "Period we check" to "Starts 13 Sept 2026 · expected duration 4 days",
                    "Area (locked)" to "Main area: the corridor from Huế to Đà Nẵng. Wider area: from Hà Tĩnh to Quảng Ngãi.",
                    "Expected chain of events (locked)" to "Extreme rain, then fast-rising rivers and flooding in towns, then waterlogged slopes, then landslides.",
                    "Correct if" to "Floods or landslides cause real harm to communities in the main area during the forecast period. Heavy rain or a warning alone is not enough.",
                    "Partly correct if" to "There is heavy rain or flooding with real but smaller harm. Or there is serious harm in the wider area, but outside the main corridor.",
                    "Wrong if" to "There is no real harm that counts in the forecast area and period, or the harm comes from an unrelated event."))
            }
        }
        if (notLoaded(feed)) return@PndScreen
        item(key = "cmp") {
            val nr = "Not reported by any of our sources"; val nf = "Not included. This forecast does not predict casualties."
            val times = ev.mapNotNull { JsDate.parse(it.json.text("startedAt")) }.sorted()
            val first = times.firstOrNull()?.let { JsDate.iso(it) } ?: ""; val last = times.lastOrNull()?.let { JsDate.iso(it) } ?: ""
            val anyDeaths = ev.any { it.json.truthy("deaths") || it.json["deaths"]?.toString() == "0" }
            val deaths = if (anyDeaths) ev.sumOf { it.json.jsNum("deaths").let { d -> if (d.isFinite()) d.toLong() else 0L } } else null
            val places = ev.map { it.country.ifEmpty { it.region } }.filter { it.isNotEmpty() }.distinct()
            val mags = ev.mapNotNull { (Regex("\\bM\\s*(\\d+(?:\\.\\d+)?)\\b").find(it.title) ?: Regex("\\bmagnitude\\s+(\\d+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE).find(it.title))?.groupValues?.get(1)?.toDoubleOrNull() }
            val timeOf = { v: String -> if (JsDate.parse(v) != null) Format.fmtTime(v) else "" }
            Panel("Forecast compared with what happened") {
                listOf(
                    Triple("Area", fc?.json?.let { it.text("region").ifEmpty { it.text("country") } }?.ifEmpty { null } ?: "Not stated in the recorded forecast", places.joinToString(" · ").ifEmpty { nr }),
                    Triple("Start date", dateOf(fcStart).ifEmpty { "Not stated" }, dateOf(first).ifEmpty { nr }),
                    Triple("Start time", timeOf(fcStart).ifEmpty { "Not stated" }, timeOf(first).ifEmpty { nr }),
                    Triple("Duration", dur.ifEmpty { "Not stated" }, Format.duration(first, last).ifEmpty { if (times.isNotEmpty()) "Still developing" else nr }),
                    Triple("How widespread", fc?.details?.ifEmpty { null } ?: "Not measured in the recorded forecast", if (ev.isNotEmpty()) "${ev.size} matching report" + (if (ev.size == 1) "" else "s") + " from ${places.size} area" + (if (places.size == 1) "" else "s") else nr),
                    Triple("Strength or severity", fc?.alert?.ifEmpty { null } ?: "Not stated", if (mags.isNotEmpty()) "Highest magnitude reported: " + com.anchittandon.pnd.model.jsNumText(mags.max()) else ev.map { it.alert }.filter { it.isNotEmpty() }.distinct().joinToString(" · ").ifEmpty { nr }),
                    Triple("Lives lost", nf, deaths?.let { Format.grouped(it.toDouble()) } ?: nr),
                    Triple("Missing people", nf, nr),
                ).forEach { (m, f, a) -> CardBox { Text(m, color = Pnd.text, fontWeight = FontWeight.Bold); KvList(listOf("Forecast" to f, "Actual" to a)) } }
                Muted("Each row shows what we forecast next to what our sources have reported since. “Not reported” means none of our sources has reported that figure yet. That is not the same as a reported zero. If the same hazard happens again later in the same place, we check it as a separate event.")
            }
        }
        item(key = "ev") {
            Panel("Matching reports", trailing = { LinkButton("Forecast details →") { env.navigate("/forecasts/ND-001") } }) {
                SortSelect("verification-detail", Sorts.EVENT_SORTS, sort, setSort)
                val s = Sorts.sort(ev, sort) { it.json }
                if (s.isEmpty()) EmptyText("None of our sources has a matching report.")
                s.forEach { e -> CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }) { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(e.json); SourcePill(e) }; Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold); if (e.details.isNotEmpty()) Muted(e.details); Muted(Format.fmtDate(e.updated)) } }
            }
        }
        item(key = "rules") {
            Panel("Rules we follow") {
                Body("• The area, the forecast period and the rules for success are locked. We cannot widen them after we know the outcome.")
                Body("• A warning, heavy rain or a computer model result shows that conditions were right. It does not prove that the forecast disaster happened.")
                Body("• The final result must point to official reports of real harm or damage.")
            }
        }
    }
}

/** The footer destinations (`PND.FOOT`), then the trust footer. */
@Composable
fun MoreScreen() {
    val env = LocalApp.current
    PndScreen(trust = null, feedBanner = false, header = { item { ScreenHeader(null, "More", null) } }) {
        item(key = "links") {
            Panel {
                listOf("Check a place" to "/", "Live events" to "/events", "Official warnings" to "/official-warnings", "Disasters now and in the past" to "/calamities",
                    "Regions" to "/regions", "Forecast calendar" to "/forecast-calendar", "How it works" to "/methodology", "Our sources" to "/resources", "Insights" to "/insights", "About" to "/about",
                    "How we check forecasts" to "/verification", "Compare places" to "/compare-locations", "Past and recent events" to "/historical-events",
                    "Settings: time zone and alerts" to "/settings").forEach { (l, u) ->
                    LinkButton(l, Modifier.fmw().testTag("more:$u")) { env.navigate(u) }
                }
            }
        }
        item(key = "note") { Muted("Up-to-date information from public sources. This is not an official warning service. In an emergency, follow your local authorities.") }
    }
}

/** Settings: the time zone picker (features.md §17) and the alerts switch. */
@Composable
fun SettingsScreen() {
    val env = LocalApp.current
    val c = env.container
    val values by c.settings.values.collectAsState()
    val scope = rememberCoroutineScope()
    val tz = values["pnd_timezone"] ?: "Asia/Kolkata"
    val base = listOf("Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney")
    val zones = remember { (listOf(tz) + base + ZoneId.getAvailableZoneIds().filter { it.contains('/') && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted()).distinct() }
    var alertMsg by remember { mutableStateOf("") }
    val on = values["pnd_alerts_on"] == "1"
    PndScreen(trust = null, feedBanner = false, header = { item { ScreenHeader(null, "Settings", null) } }) {
        item(key = "tz") {
            Panel("Time zone", subtitle = "Every time in the app is shown in this zone, with the zone named. India Standard Time is the default, as on the website.") {
                Select("Display time zone", zones.map { it to if (it == "Asia/Kolkata") "IST · India" else it }, tz, tag = "tzSelect") { c.settings.setTimezone(it) }
                Muted("Times are shown as, for example, " + Format.fmtDate("2026-10-20T11:24:19Z", tz) + ".")
            }
        }
        item(key = "alerts") {
            Panel("Alerts on this device") {
                androidx.compose.foundation.layout.Row(Modifier.fmw()) {
                    Text("Check my saved places in the background", color = Pnd.text, modifier = Modifier.weight(1f).padding(top = 12.dp))
                    Switch(on, { want ->
                        scope.launch {
                            if (!want) { c.settings.alertsEnabled = false; c.platform.scheduleBackgroundChecks(false); alertMsg = "" }
                            else if (c.platform.requestNotifications()) { c.settings.alertsEnabled = true; c.platform.scheduleBackgroundChecks(true); alertMsg = "" }
                            else alertMsg = "Notifications were not allowed, so nothing will be sent."
                        }
                    }, Modifier.semantics { contentDescription = "Background alerts" }.testTag("alertsSwitch"),
                        colors = SwitchDefaults.colors(checkedTrackColor = Pnd.green, checkedThumbColor = Pnd.onGreen))
                }
                Body(AlertCopy.status(on, c.platform.notificationsAllowed(), c.settings.places.size, values["pnd_alerts_last"]))
                if (alertMsg.isNotEmpty()) Muted(alertMsg)
                Muted("Alerts follow the website’s rules: an official warning area or reported affected area that contains a saved place, or a danger reported within 30 km of it (100 km if it is severe), and major events anywhere. Each alert is repeated at most once every 6 hours. We never send alerts for our own forecasts. " + AlertCopy.KEEPS)
            }
        }
        item(key = "ver") { Muted("Predict Natural Disasters for Android, version ${com.anchittandon.pnd.BuildConfig.VERSION_NAME}.") }
    }
}
