@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.data.FeedState
import com.anchittandon.pnd.logic.DetailWords
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Portal
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Level
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.logic.Search
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.strings
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.DetailKind
import com.anchittandon.pnd.ui.DeepLinks
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd

/** Per-hazard "who may need help" (event-detail.html responseContext). */
fun responseContext(type: String): List<Pair<String, String>> {
    val t = type.lowercase()
    return when {
        Regex("earthquake").containsMatchIn(t) -> listOf("Who may need help first" to "People in damaged buildings; injured people and those who cannot move easily; people who have lost their homes",
            "Immediate needs" to "Search and rescue; treatment for injuries; temporary shelter; checks that buildings are safe",
            "Other dangers to watch for" to "Aftershocks; damaged roads, bridges and power lines; landslides, or a tsunami where one can happen")
        Regex("flood").containsMatchIn(t) -> listOf("Who may need help first" to "People in low-lying areas and near rivers; households cut off by water; children, older people and people with disabilities",
            "Immediate needs" to "Evacuation; clean water; food; medicines; toilets and washing; access for rescuers",
            "Other dangers to watch for" to "Dirty water; roads and bridges washed away; landslides; people unable to go home for a long time")
        Regex("cyclone|storm|typhoon|hurricane").containsMatchIn(t) -> listOf("Who may need help first" to "People on the coast and in low-lying areas; people in weak housing; people who work at sea; people with medical needs",
            "Immediate needs" to "Shelter; food and water; medical help; getting power and phones working again",
            "Other dangers to watch for" to "Storm surge (sea water pushed inland); flooding; wind damage; debris and blocked roads")
        Regex("wildfire|fire").containsMatchIn(t) -> listOf("Who may need help first" to "People near the fire; people with breathing problems; older people; households that have been evacuated",
            "Immediate needs" to "Evacuation; shelter; protection from smoke; medical help; help for pets and livestock",
            "Other dangers to watch for" to "Smoke; road closures; loss of power and water; landslides on burned slopes")
        Regex("volcan").containsMatchIn(t) -> listOf("Who may need help first" to "People near the danger zone; people exposed to ash; farmers and livestock owners",
            "Immediate needs" to "Evacuation; masks against ash; clean water; clearing ash",
            "Other dangers to watch for" to "Falling ash; mudflows of ash and water (lahars); flight disruption; crop losses")
        else -> listOf("Who may need help first" to "People in the affected area; households that have lost their homes or are cut off",
            "Immediate needs" to "Shelter; food; clean water; medical help; working phones",
            "Other dangers to watch for" to "Blocked roads, and knock-on damage to power, water and phone services")
    }
}

/** Share and the not-found / error states every detail screen shares. */
@Composable
fun DetailTop(eyebrow: String, title: String, subtitle: String?, sharePath: String?) {
    val env = LocalApp.current
    Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Eyebrow(eyebrow)
        Heading(title, Modifier.testTag("detailTitle"))
        if (!subtitle.isNullOrEmpty()) Body(subtitle, Pnd.textSoft)
        if (sharePath != null) OutlinePillButton("Share", Modifier.testTag("share")) { env.container.platform.share(title, DeepLinks.webUrl(sharePath)) }
    }
}

/**
 * A detail screen whose record is not in the feed (changelog C20): its heading, one sentence and a link to the
 * matching list, with the body hidden. [eyebrow] is the screen's own.
 */
fun LazyListScope.notFound(eyebrow: String, title: String, line: GoneLine, onNav: (String) -> Unit) {
    item(key = "nf") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow(eyebrow)
            Heading(title, Modifier.testTag("notFound"))
            GoneText(line, onNav)
        }
    }
}

/** A sentence with a link inside it, as the web writes it: "{before}[{link}]{after}". */
data class GoneLine(val before: String, val link: String? = null, val path: String? = null, val after: String = "") {
    val text: String get() = before + (link ?: "") + after
}

@Composable
fun GoneText(line: GoneLine, onNav: (String) -> Unit) {
    val t = androidx.compose.ui.text.buildAnnotatedString {
        append(line.before)
        if (line.link != null && line.path != null) {
            withLink(androidx.compose.ui.text.LinkAnnotation.Clickable(line.link, androidx.compose.ui.text.TextLinkStyles(androidx.compose.ui.text.SpanStyle(color = Pnd.link, fontWeight = FontWeight.SemiBold))) { onNav(line.path) }) { append(line.link) }
        }
        append(line.after)
    }
    Text(t, color = Pnd.textSoft, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("goneText"))
}

/** Waiting for the feed, or it failed before anything loaded ("Live data unavailable", body hidden). True when the caller should stop. */
fun LazyListScope.waiting(feed: FeedState, failed: GoneLine, onNav: (String) -> Unit): Boolean {
    if (feed.feed != null) return false
    item(key = "wait") {
        if (feed.failed) Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("detailError")) {
            Heading("Live data unavailable")
            GoneText(failed, onNav)
        } else Body("Loading the latest data…")
    }
    return true
}

/** "{n} km away · {type}" related records within 1,200 km (event and forecast detail). */
fun nearby(e: Event, all: List<Event>, km: Double, filter: (Event) -> Boolean): List<Event> {
    val la = e.lat ?: return emptyList(); val lo = e.lon ?: return emptyList()
    return all.filter { it.id != e.id && filter(it) && it.lat != null && it.lon != null }
        .map { x -> Event(x.json).also { it.distance = Hazards.distanceKm(la, lo, x.lat!!, x.lon!!) } }
        .filter { it.distance < km }
}

fun withDistance(list: List<Event>) = list.map { Event(com.anchittandon.pnd.model.jsonObjectOf().let { _ -> kotlinx.serialization.json.JsonObject(LinkedHashMap(it.json).apply { put("_d", kotlinx.serialization.json.JsonPrimitive(it.distance)) }) }).also { n -> n.distance = it.distance } }

@Composable
fun Figure(label: String, value: String) {
    Column(Modifier.widthIn(min = scaledMin(140.dp)).clip(RoundedCornerShape(10.dp)).background(Pnd.metric).border(1.dp, Pnd.metricBorder, RoundedCornerShape(10.dp)).padding(10.dp).semantics(mergeDescendants = true) {}) {
        Label(label)
        Text(value, color = if (value == "Not reported" || value == "Not reported by the source") Pnd.muted else Pnd.text, fontSize = if (value.startsWith("Not reported")) 14.sp else 20.sp, fontWeight = FontWeight.Bold)
    }
}

/** Event, alert and calamity detail (features.md §7.1 to §7.3). */
@Composable
fun RecordDetailScreen(kind: DetailKind, id: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val all = feed.all
    val e = Format.findEvent(all, id) { it.json }
    val (sort, setSort) = rememberSort(when (kind) { DetailKind.EVENT -> "event_sortBy"; DetailKind.ALERT -> "alert_sortBy"; DetailKind.CALAMITY -> "calamity_sortBy" },
        if (kind == DetailKind.EVENT) Sorts.NEARBY else Sorts.EVENT_SORTS)
    val path = when (kind) { DetailKind.EVENT -> "/disasters/"; DetailKind.ALERT -> "/alerts/"; DetailKind.CALAMITY -> "/calamities/" } + Format.enc(e?.id ?: id)
    PndScreen(feedBanner = false) {
        val failed = when (kind) {
            DetailKind.EVENT -> GoneLine("We could not load this event just now. Trying again automatically. ", "See all events", "/events", ".")
            DetailKind.ALERT -> GoneLine("We could not load this alert just now. Trying again automatically.")
            DetailKind.CALAMITY -> GoneLine("We could not load this disaster just now. Trying again automatically.")
        }
        if (waiting(feed, failed, env.navigate)) return@PndScreen
        if (feed.failed) item(key = "stale") { StaleBox(when (kind) { DetailKind.EVENT -> "We could not update this event just now."; DetailKind.ALERT -> "We could not update this alert just now."; DetailKind.CALAMITY -> "We could not update this disaster just now." }, tag = "detailError") }
        if (e == null) {
            when (kind) {
                DetailKind.EVENT -> notFound("EVENT", "Event not found", GoneLine("The source may no longer list this event. ", "See all events", "/events", " to find the latest ones."), env.navigate)
                DetailKind.ALERT -> notFound("OFFICIAL ALERT", "Alert not found", GoneLine("The source may no longer list this alert. ", "See all official warnings", "/official-warnings", "."), env.navigate)
                DetailKind.CALAMITY -> notFound("CURRENT DISASTER", "Disaster not found", GoneLine("The source may no longer list this event. It may have ended. ", "See current disasters", "/calamities", "."), env.navigate)
            }
            return@PndScreen
        }
        val j = e.json
        val eyebrow = when (kind) { DetailKind.EVENT -> DetailWords.eventEyebrow(j); DetailKind.ALERT -> "OFFICIAL ALERT"; DetailKind.CALAMITY -> "CURRENT DISASTER" }
        item(key = "top") { DetailTop(eyebrow, e.displayTitle, "${e.type} · ${Format.placeOf(j, "Place not given")}", path) }
        Format.quietNote(j).takeIf { it.isNotEmpty() }?.let { q -> item(key = "quiet") { StaleBox(q, tag = "quietNote") } }
        item(key = "status") { Muted(Format.statusText(feed.feed!!.meta.json) + " · checked " + Format.fmtDate(feed.feed!!.generatedAt)) }
        when (kind) {
            DetailKind.EVENT -> eventBody(e, all, feed, sort, setSort)
            DetailKind.ALERT -> alertBody(e, all, sort, setSort)
            DetailKind.CALAMITY -> calamityBody(e, all, feed, sort, setSort)
        }
        enrichmentBlock(j)
    }
}

private fun LazyListScope.eventBody(e: Event, all: List<Event>, feed: FeedState, sort: String, setSort: (String) -> Unit) {
    val j = e.json
    item(key = "kpis") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Column(Modifier.widthIn(min = scaledMin(140.dp)).clip(RoundedCornerShape(10.dp)).background(Pnd.metric).border(1.dp, Pnd.metricBorder, RoundedCornerShape(10.dp)).padding(10.dp)) { Label("Risk level"); RecordBadge(j) }
            Figure("Type", e.type.ifEmpty { "-" }); Figure("Source", e.source.ifEmpty { "-" }); Figure("Source last updated", Format.age(e.updated))
            Figure("Data status", Portal.liveWord(j))
        }
    }
    item(key = "action") { ActionPanel(e) }
    item(key = "overview") {
        val env = LocalApp.current
        Panel("Overview") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(j); SourcePill(e); if (e.forecast) Pill("Our forecast, not official") }
            KeyFactsGrid(j)
            val corroborated = j.arr("corroboratedBy").strings()
            val alertNote = if (j.truthy("alertSource") && j.text("alertSource") != e.source && e.alert.isNotEmpty()) " The “${e.alert}” alert level shown is from ${j.text("alertSource")}." else ""
            KvList(listOf(
                "When it started" to (if (j.truthy("startedAt")) "${Format.fmtDate(j.str("startedAt"))} (${Format.age(j.str("startedAt"))})" else if (e.forecast && j.truthy("targetStart")) "Forecast period starts ${Format.fmtWhen(j.str("targetStart"))}" else "The source did not give a start time"),
                "Last updated" to Format.fmtDate(e.updated),
                "Where it started" to Format.placeOf(j, "Not given by the source"),
                "Areas affected" to (listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Not given by the source" }),
                "Coordinates" to Format.coords(e.lat, e.lon),
                "Description" to e.details.ifEmpty { "The source gave no further details." },
                "Also reported by" to ((if (corroborated.isNotEmpty()) corroborated.joinToString(" · ") else "No other agency we read has reported this event separately") + alertNote),
                "Report ID" to e.id.ifEmpty { "-" },
            ))
            if (alertNote.isNotEmpty() && j.truthy("alertSourceUrl")) LinkButton("Open their report ↗") { env.container.platform.openUrl(j.text("alertSourceUrl")) }
            if (e.sourceUrl.isNotEmpty()) SecondaryButton("Open the original report ↗") { env.container.platform.openUrl(Api.absolute(e.sourceUrl)) }
        }
    }
    item(key = "impact") { ImpactPanel(j, "If the source gives no figure, we show “Not reported”. We never assume it is zero.") }
    item(key = "reliable") {
        Panel("How up to date and reliable") {
            KvList(listOf("Last update" to "The source last updated this ${Format.age(e.updated)} (${Format.fmtDate(e.updated)}).",
                "Type of source" to (if (e.official) "Official source" else if (e.forecast) "Our own forecast, not official" else "Collected from other sources"),
                "Status" to DetailWords.eventRecordState(j)))
        }
    }
    item(key = "context") {
        Panel("Who may need help, and what they need", subtitle = "General guidance for this type of disaster. Not every group listed is confirmed to be affected.") {
            responseContext(e.type).forEach { (k, v) -> CardBox { Text(k, color = Pnd.text, fontWeight = FontWeight.Bold); Muted(v) } }
        }
    }
    item(key = "timeline") {
        Panel("Timeline", subtitle = "When the source and this page were last updated") {
            CardBox { Text("Source report", color = Pnd.text, fontWeight = FontWeight.Bold); Muted(Format.fmtDate(e.updated)); Body(e.details.ifEmpty { "The latest report from the source." }) }
            CardBox { Text("This page updated", color = Pnd.text, fontWeight = FontWeight.Bold); Muted(Format.fmtDate(feed.feed?.generatedAt)); Body("We checked our sources again and found this event.") }
        }
    }
    item(key = "map") {
        val env = LocalApp.current
        Panel("Map", trailing = { LinkButton("Open the live map →") { env.navigate("/live-map") } }) {
            RiskMap(listOf(e), height = 240.dp, center = e.lat?.let { it to e.lon!! }, zoom = if (Regex("earthquake", RegexOption.IGNORE_CASE).containsMatchIn(e.type)) 7.0 else 6.0) { }
        }
    }
    item(key = "safety") {
        Panel("Safety") {
            Body("This page brings together the official report and related help information.")
            Muted("The issuing authority and local emergency services decide on evacuations, shelters and road closures. Their word is the one that counts. The source for this page is linked above.")
        }
    }
    item(key = "nearby") {
        val env = LocalApp.current
        val near = Sorts.sort(withDistance(nearby(e, all, 1200.0) { !it.forecast }), sort) { it.json }.take(6)
        Panel("Other events nearby", trailing = { LinkButton("See all events →") { env.navigate("/events") } }) {
            SortSelect("event", Sorts.NEARBY, sort, setSort)
            if (near.isEmpty()) CardBox { Text("No other current events nearby.", fontWeight = FontWeight.Bold, color = Pnd.text) }
            near.forEach { x ->
                CardBox(onClick = { env.navigate(Format.eventUrl(x.json)) }, label = "Open ${x.displayTitle}") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(x.json); SourcePill(x) }
                    Text(x.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted("${Hazards.group(x.distance)} km away · ${x.type}")
                    Muted(Format.fmtDate(x.updated))
                }
            }
        }
    }
    item(key = "source") {
        Panel("Source") { Muted("${e.source.ifEmpty { "The source" }} report ${j.text("rawId").ifEmpty { e.id }}. " + if (e.sourceUrl.isNotEmpty()) "A link to the original report is in the overview above." else "The source gave no link to the original report.") }
    }
}

/** "What should I do now?" (event detail action panel). */
@Composable
private fun ActionPanel(e: Event) {
    val env = LocalApp.current
    val j = e.json
    val voice = mapOf("observed" to "reporting an event that has happened", "official-warning" to "issuing an official warning", "forecast" to "a forecast made by this site", "unknown" to "type of report not known")
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.panel).border(1.dp, Pnd.panelBorder, RoundedCornerShape(10.dp)).testTag("actionPanel")) {
        Box(Modifier.width(4.dp).background(Pnd.actionAccent).padding(vertical = 40.dp))
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { ProvenancePill(Format.provenance(j)); Muted("Updated " + Format.age(e.updated)) }
            SubHeading("What should I do now?")
            KvList(listOf("WHAT" to e.type.ifEmpty { "Natural hazard" }, "WHERE" to listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "See the map" },
                "HOW SERIOUS" to RiskScale.riskLabel(j), "HOW RELIABLE" to (if (e.official) "OFFICIAL SOURCE" else if (e.forecast) "OUR OWN ESTIMATE" else "NOT YET CONFIRMED"),
                "WHO SAYS THIS" to e.source.ifEmpty { "Source not stated" } + " · " + (voice[e.evidenceState] ?: voice.getValue("unknown"))))
            val lifeSafety = e.evidenceState == "official-warning" || RiskScale.levelOf(j.firstNonEmpty("severity", "alert")).rank >= Level.HIGH.rank
            if (lifeSafety) StaleBox("Follow instructions from the issuing authority and local emergency services.", tag = "lifeSafety")
            Text("What matters most now", color = Pnd.text, fontWeight = FontWeight.Bold)
            responseContext(e.type).forEach { (k, v) -> Body("• $k: $v") }
            if (e.sourceUrl.isNotEmpty()) PrimaryButton("OPEN THE ORIGINAL SOURCE ↗") { env.container.platform.openUrl(Api.absolute(e.sourceUrl)) }
            else StaleBox("The source gave no link for this report. Check with your local emergency service before you act.")
            Muted("This is up-to-date information from the report named above. It is not an instruction issued by any authority.")
        }
    }
}

private fun kotlinx.serialization.json.JsonObject.firstNonEmpty(vararg keys: String): String { for (k in keys) if (truthy(k)) return text(k); return "" }

@Composable
fun ImpactPanel(j: kotlinx.serialization.json.JsonObject, note: String, extra: Pair<String, String>? = null, missing: String = "Not reported") {
    Panel("Reported impact") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Figure("Lives lost", Format.figure(j, "deaths", missing)); Figure("People displaced", Format.figure(j, "displaced", missing)); Figure("People affected", Format.figure(j, "affected", missing))
            extra?.let { Figure(it.first, it.second) }
        }
        Muted(note)
    }
}

private fun LazyListScope.alertBody(e: Event, all: List<Event>, sort: String, setSort: (String) -> Unit) {
    val j = e.json
    item(key = "kpis") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Column(Modifier.widthIn(min = scaledMin(140.dp)).clip(RoundedCornerShape(10.dp)).background(Pnd.metric).border(1.dp, Pnd.metricBorder, RoundedCornerShape(10.dp)).padding(10.dp)) { Label("Alert level"); RecordBadge(j) }
            Figure("Agency or source", e.source.ifEmpty { "-" }); Figure("Updated", Format.age(e.updated)); Figure("Status", Portal.liveWord(j))
        }
    }
    item(key = "summary") {
        val env = LocalApp.current
        Panel("Alert summary") {
            KeyFactsGrid(j)
            KvList(listOf("Hazard" to e.type.ifEmpty { "-" }, "Place" to Format.placeOf(j, "-"), "Areas affected" to listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "-" },
                "When it started" to (if (j.truthy("startedAt")) "${Format.fmtDate(j.str("startedAt"))} (${Format.age(j.str("startedAt"))})" else "The source did not give a start time"),
                "Issued or last updated" to Format.fmtDate(e.updated),
                "Warning ends" to (if (j.truthy("expiresAt")) Format.fmtDate(j.str("expiresAt")) else "The source did not give an end time"),
                "What the alert says" to e.details.ifEmpty { "The source gave no further details." },
                "Source report ID" to j.text("rawId").ifEmpty { e.id }))
            if (e.sourceUrl.isNotEmpty()) SecondaryButton("Open the original report ↗") { env.container.platform.openUrl(Api.absolute(e.sourceUrl)) }
        }
    }
    item(key = "impact") { ImpactPanel(j, "We show impact figures only when the source gives them. A missing figure does not mean there was no impact.", "Data status" to Portal.liveWord(j)) }
    item(key = "checks") {
        Panel("Source checks") {
            KvList(listOf("Official source named?" to "Yes", "Source’s update time shown?" to "Yes", "Is this a saved copy?" to (if (e.cached) "Yes, and it is labelled" else "No"),
                "Link to the original report?" to (if (e.sourceUrl.isNotEmpty()) "Yes" else "No, the source gave none")))
        }
    }
    item(key = "map") {
        val env = LocalApp.current
        Panel("Map of the affected area", trailing = { LinkButton("Open the live map →") { env.navigate("/live-map") } }) { RiskMap(listOf(e), height = 240.dp, center = e.lat?.let { it to e.lon!! }, zoom = 6.0) { } }
    }
    item(key = "safety") {
        Panel("Safety") {
            Body("This page sums up a report from an official agency or source. It is not a new government warning.")
            Muted("For evacuation, shelter, travel limits and what to do in an emergency, use the original source and your local authorities’ instructions.")
        }
    }
    item(key = "related") {
        val env = LocalApp.current
        val key = e.country.ifEmpty { e.region }.lowercase()
        val rel = Sorts.sort(all.filter { it.id != e.id && !it.forecast && key.isNotEmpty() && Search.matchesPlace(it.json, key) && it.isLive }, sort) { it.json }.take(9)
        Panel("Other events in the same country or area", trailing = { LinkButton("See all warnings →") { env.navigate("/official-warnings") } }) {
            SortSelect("alert", Sorts.EVENT_SORTS, sort, setSort)
            if (rel.isEmpty()) EmptyText("No other current events in this area.")
            rel.forEach { x ->
                CardBox(onClick = { env.navigate(Format.eventUrl(x.json)) }, label = "Open ${x.displayTitle}") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(x.json); SourcePill(x) }
                    Text(x.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold); Muted("${x.type} · ${Format.fmtDate(x.updated)}")
                }
            }
        }
    }
}

private fun LazyListScope.calamityBody(e: Event, all: List<Event>, feed: FeedState, sort: String, setSort: (String) -> Unit) {
    val j = e.json
    // Rule 8 applies here too: a reported 0 is a figure (the web page shows "-"; see the README).
    item(key = "kpis") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Figure("Status", if (e.cached) "Saved copy" else "Reported"); Figure("Hazard", e.type.ifEmpty { "-" })
            Figure("Lives lost", Format.figure(j, "deaths", "-")); Figure("People displaced", Format.figure(j, "displaced", "-")); Figure("Updated", Format.age(e.updated))
        }
    }
    item(key = "about") {
        val env = LocalApp.current
        Panel("About this disaster") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(j); SourcePill(e); if (e.cached) Pill("Saved copy") }
            KvList(listOf("Event" to e.displayTitle, "Type" to e.type.ifEmpty { "-" }, "Country or area" to listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "-" },
                "Alert level" to RiskScale.riskLabel(j), "Official source" to e.source.ifEmpty { "-" },
                "When it started" to (if (j.truthy("startedAt")) "${Format.fmtDate(j.str("startedAt"))} (${Format.age(j.str("startedAt"))})" else "The source did not give a start time"),
                "Last updated by the source" to Format.fmtDate(e.updated), "Coordinates" to Format.coords(e.lat, e.lon),
                "Lives lost" to Format.figure(j, "deaths", "Not reported by the source"), "People displaced" to Format.figure(j, "displaced", "Not reported by the source"),
                "People affected" to Format.figure(j, "affected", "Not reported by the source"), "Latest details from the source" to e.details.ifEmpty { "The source gave no further details." }))
            if (e.sourceUrl.isNotEmpty()) SecondaryButton("Open the official source ↗") { env.container.platform.openUrl(Api.absolute(e.sourceUrl)) }
        }
    }
    item(key = "fresh") {
        Panel("How up to date this is") {
            KvList(listOf("Source last updated" to Format.fmtDate(e.updated), "We last checked" to Format.fmtDate(feed.feed?.generatedAt), "Age of the data" to Format.age(e.updated),
                "Status" to DetailWords.calamityStatus(j)))
        }
    }
    item(key = "map") {
        val env = LocalApp.current
        Panel("Map", trailing = { LinkButton("Open the live map →") { env.navigate("/live-map") } }) { RiskMap(listOf(e), height = 240.dp, center = e.lat?.let { it to e.lon!! }, zoom = 5.0) { } }
    }
    item(key = "related") {
        val env = LocalApp.current
        val rel = Sorts.sort(all.filter { it.id != e.id && it.isLive && ((it.country.isNotEmpty() && e.country.isNotEmpty() && it.country == e.country) || it.type == e.type) }, sort) { it.json }.take(6)
        Panel("Related events") {
            SortSelect("calamity", Sorts.EVENT_SORTS, sort, setSort)
            if (rel.isEmpty()) EmptyText("No related events right now.")
            rel.forEach { x ->
                CardBox(onClick = { env.navigate("/calamities/" + Format.enc(x.id)) }, label = "Open ${x.displayTitle}") {
                    RecordBadge(x.json); Text(x.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold); Muted("${x.type} · ${Format.placeOf(x.json, "Place not given")}")
                }
            }
        }
    }
    item(key = "safety") {
        Panel("Safety and sources") {
            Body("We show events as official sources report them. If we show a saved copy of an event, we label it and do not present it as live.")
            Body("In an emergency, follow your local government, civil protection agency and weather service.")
        }
    }
}

@Suppress("unused") private val unusedColor = Color.Unspecified
