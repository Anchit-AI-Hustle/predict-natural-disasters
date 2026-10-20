@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.Search
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd

/** Forecasts tab (features.md §4). */
@Composable
fun ForecastsScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var q by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("") }
    var risk by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("forecasts_sortBy", Sorts.FORECASTS_TAB)
    val all = feed.events
    fun isHigh(e: Event) = !e.forecast && e.alert in setOf("Red", "Orange", "High")
    val pass = { e: Event -> Search.matches(e.json, q, e.searchText) && RiskScale.matchesRiskLevel(e.json, risk) }
    val fcAll = all.filter { it.forecast }; val obsAll = all.filter(::isHigh)
    val fc = remember(feed, q, type, risk, sort) { Sorts.sort(fcAll.filter { pass(it) && (type.isEmpty() || it.type == type) }, sort) { it.json } }
    val obs = remember(feed, q, type, risk, sort) { Sorts.sort(obsAll.filter { pass(it) && (type.isEmpty() || it.type == type) }, sort) { it.json } }
    val meta = feed.feed?.meta?.json
    PndScreen(header = { item { ScreenHeader("Our own estimates", "Natural disaster forecasts", "These are our forecasts of what may happen next, and where. We make them from reports by official agencies. They are not official warnings.") } }) {
        item(key = "stats") {
            val f = feed.feed
            val h = f?.meta?.forecastHorizon?.str("furthestWindowEnds")
            Column {
                StatLine(listOf("forecasts" to (if (f != null) fcAll.size.toString() else "-"), "events on high alert" to (if (f != null) obsAll.size.toString() else "-"),
                    "kinds of hazard" to (if (f != null) fcAll.map { it.type }.toSet().size.toString() else "-"), "sources working" to (f?.let { Format.sourcesRatio(it.meta.json) } ?: "-"),
                    "updated" to (f?.let { Format.age(it.generatedAt) } ?: "-"),
                    "forecasts reach as far as" to (if (!h.isNullOrEmpty()) Format.fmtWhen(h, null, "end").replace(Regex(",[^,]*$"), "") else "-")))
                if (f != null) Body(Format.horizonText(meta), Pnd.textSoft)
            }
        }
        item(key = "tools") {
            Column {
                SearchField(q, "Search by forecast, country, city, sea or hazard", tag = "search") { q = it }
                Toolbar {
                    Select("Filter by hazard", Format.hazardOptions((fcAll + obsAll).map { it.json }, type), type, tag = "hazardFilter") { type = it }
                    RiskFilter(risk) { risk = it }
                    SortSelect("forecasts", Sorts.FORECASTS_TAB, sort, setSort)
                }
                RefreshRow(feed, label = "↻ Refresh live data")
            }
        }
        item(key = "map") {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) { SubHeading("Map of forecasts and events on high alert"); LinkButton("Open full map →") { env.navigate("/live-map") } }
                RiskMap((fc + obs).take(300)) { env.navigate(Format.eventUrl(it.json)) }
            }
        }
        item(key = "byHazard") {
            Panel("Forecasts by hazard", subtitle = "Select a hazard to see only its forecasts. Select it again to see them all.") {
                val counts = fcAll.filter(pass).groupingBy { it.type }.eachCount().entries.sortedWith { a, b -> (b.value - a.value).takeIf { it != 0 } ?: Sorts.collator.compare(a.key, b.key) }
                if (counts.isEmpty()) EmptyText(if (feed.feed == null) "Loading…" else "No forecast matches these filters.")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    counts.forEach { (h, c) ->
                        val on = type == h
                        CardBox(Modifier.widthIn(min = 140.dp, max = 220.dp).semantics { selected = on }.testTag("hazTile:$h"), onClick = { type = if (on) "" else h },
                            label = (if (on) "Show all forecasts" else "Show only $h forecasts"), accent = if (on) Pnd.green else null) {
                            Text(h, color = Pnd.text, fontWeight = FontWeight.Bold)
                            Muted("$c forecast" + if (c == 1) "" else "s")
                        }
                    }
                }
            }
        }
        item(key = "fcHead") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SubHeading("Forecasts · ${fc.size}" + if (fc.size != fcAll.size) " of ${fcAll.size}" else "", Modifier.testTag("fcCount"))
                LinkButton("Full table →") { env.navigate("/forecast-list") }
            }
        }
        if (!notLoaded(feed)) {
            if (fc.isEmpty()) item { EmptyCard(Search.emptyState(q, fcAll.map { it.json }, all.map { it.json }, "forecasts")) { env.navigate("/events?q=" + Format.enc(it)) } }
            items(fc, key = { "fc" + it.id + it.hashCode() }) { ForecastRowCard(it) }
            item(key = "obsHead") {
                Column(Modifier.padding(top = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { SubHeading("Events on high alert · ${obs.size}" + if (obs.size != obsAll.size) " of ${obsAll.size}" else ""); LinkButton("All official warnings →") { env.navigate("/official-warnings") } }
                    Muted("Official agencies have given these events a high alert level. These reports show what is happening now. They are not forecasts. We make our forecasts above from official reports like these.")
                }
            }
            if (obs.isEmpty()) item { EmptyText("No event on high alert matches these filters.") }
            items(obs, key = { "obs" + it.id + it.hashCode() }) { e ->
                Box(Modifier.padding(bottom = 8.dp)) {
                    CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "Open ${e.displayTitle}") {
                        RecordBadge(e.json)
                        Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Muted("${e.type} · " + (listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Location not stated by the source" }))
                        Muted("${e.source} · updated ${Format.age(e.updated)}")
                    }
                }
            }
        }
        item(key = "changes") {
            Panel("What changed since our last check") {
                if (feed.feed == null) Muted("Loading…") else {
                    val ch = Format.changes(meta)
                    Body(ch.headline)
                    ch.sections.forEach { s ->
                        Text(s.label, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        s.rows.forEach { Muted(it) }
                        if (s.more > 0) Muted("…and ${s.more} more")
                    }
                }
            }
        }
        item(key = "how") {
            Panel("How we make forecasts", trailing = { LinkButton("Methodology →") { env.navigate("/methodology") } }) {
                Step("1. Spot", "We look for unusual weather, water or ground conditions.")
                Step("2. Where and when", "We mark the area that may be hit and the dates the forecast covers.")
                Step("3. Keep them apart", "We never show an official report as our forecast, or our forecast as an official report.")
                Step("4. Check", "Later, we check each forecast against what really happened. We lock the rules for that check when we make the forecast: the dates, the area, the cause and what counts as damage.")
            }
        }
        item(key = "check") {
            Panel("Checking our forecasts", trailing = { LinkButton("How we check forecasts →") { env.navigate("/verification") } }) {
                Text("ND-001 · Central Vietnam flash-flood + landslide forecast", color = Pnd.text, fontWeight = FontWeight.Bold)
                Body("This forecast is separate from official warnings. A warning or heavy rain alone does not make it correct. It only counts as correct if serious damage or harm is reported inside the area and dates that were locked when it was made.")
                LinkButton("See the ND-001 forecast →") { env.navigate("/forecasts/ND-001") }
            }
        }
    }
}

@Composable
fun Step(title: String, text: String) {
    Column(Modifier.semantics(mergeDescendants = true) {}) { Text(title, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp); Body(text) }
}

/** How we check forecasts: every forecast, including not-live ones (features.md §4.3). */
@Composable
fun VerificationListScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val (sort, setSort) = rememberSort("verification_sortBy", Sorts.FORECAST_LIST)
    val fs = remember(feed, sort) { Sorts.sort(feed.all.filter { it.forecast }, sort) { it.json } }
    PndScreen(header = { item { ScreenHeader(null, "How we check forecasts", "All our current forecasts, with the period each one covers and the report it is based on.") } }) {
        item(key = "imp") { Notice("Important: These are our own estimates, not official warnings. We do not predict exactly when an earthquake will strike. We check each forecast only against real harm or damage, reported by an independent source after the forecast was made.") }
        item(key = "tools") { Column { Toolbar { SortSelect("verification", Sorts.FORECAST_LIST, sort, setSort) }; RefreshRow(feed) } }
        item(key = "head") { SubHeading("Current forecasts") }
        if (!notLoaded(feed)) {
            if (fs.isEmpty()) item { EmptyText("No current forecasts are available right now.") }
            items(fs, key = { "v" + it.id + it.hashCode() }) { e ->
                Box(Modifier.padding(bottom = 8.dp)) {
                    CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "See forecast details") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(e.json); Pill(if (e.json.str("forecastKind") == "frozen-benchmark") "Test case" else "Based on a current report") }
                        Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        if (e.details.isNotEmpty()) Body(e.details)
                        KvList(listOf("Forecast period" to (if (e.json.str("targetStart").isNullOrEmpty()) (e.json.str("targetEnd")?.takeIf { it.isNotEmpty() }?.let { "Ends " + Format.fmtWhen(it, e.json.str("targetStart"), "end") } ?: "No start date recorded") else Format.windowText(e.json)),
                            "Area" to Format.placeOf(e.json, "-"), "Hazard" to e.type.ifEmpty { "-" }, "Based on" to e.source.ifEmpty { "-" }))
                        Text("See forecast details →", color = Pnd.link)
                    }
                }
            }
        }
        item(key = "rules") {
            Panel("How we check a forecast") {
                Step("Timing", "The harm or damage must happen during the forecast period.")
                Step("Place", "It must happen in the area we named when we recorded the forecast.")
                Step("Cause", "The hazard must happen in the way we forecast.")
                Step("Real harm", "A warning or report that already existed does not count as a correct forecast on its own. The harm or damage must be reported by an independent source, and it must be serious enough to matter.")
                Step("Result", "We mark each forecast correct, partly correct, wrong or cannot be checked. We keep the evidence from our sources.")
            }
        }
    }
}
