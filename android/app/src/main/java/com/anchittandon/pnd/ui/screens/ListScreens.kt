@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.FeedState
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.Search
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.CollectionView
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import java.time.Instant
import java.time.ZoneId

/* ------------------------------------------------------------- shared bits */

/** A sort select whose choice is remembered per screen (`pnd_sort_{screen}`). */
@Composable
fun rememberSort(screen: String, keys: List<String>): Pair<String, (String) -> Unit> {
    val env = LocalApp.current
    var v by remember { mutableStateOf(env.container.settings.sort(screen, keys)) }
    return v to { k: String -> v = k; env.container.settings.setSort(screen, k) }
}

@Composable
fun SortSelect(screen: String, keys: List<String>, value: String, onChange: (String) -> Unit) =
    Select("Sort results", keys.map { it to Sorts.label(it) }, value, tag = "sort:$screen", onSelect = onChange)

@Composable
fun RiskFilter(value: String, onChange: (String) -> Unit) =
    Select("Filter by risk level", listOf("" to "All risk levels") + RiskScale.filterOptions, value, tag = "riskFilter", onSelect = onChange)

val FIXED_HAZARDS = listOf("Flood", "Earthquake", "Wildfire", "Volcano", "Tropical Cyclone", "Drought")

/** Fixed-list hazard filter match: `type.toLowerCase().includes(option.toLowerCase().replace('s',''))`. */
fun fixedHazardMatch(type: String, option: String): Boolean = option.isEmpty() || type.lowercase().contains(option.lowercase().replaceFirst("s", ""))

fun statusLine(feed: FeedState, extra: String? = null): String {
    val f = feed.feed
    if (f == null) return if (feed.failed) "Live data unavailable. Trying again automatically." else "Loading the latest data…"
    return Format.statusText(f.meta.json) + (extra?.let { " · $it" } ?: "") + " · updated " + Format.age(f.generatedAt)
}

@Composable
fun ScreenHeader(eyebrow: String?, title: String, subtitle: String?) {
    Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (eyebrow != null) Eyebrow(eyebrow)
        Heading(title)
        if (subtitle != null) Body(subtitle, Pnd.textSoft)
    }
}

@Composable
fun RefreshRow(feed: FeedState, extra: String? = null, label: String = "↻ Refresh now") {
    val env = LocalApp.current
    Toolbar {
        SecondaryButton(label, Modifier.testTag("refresh")) { env.container.feed.refreshAsync(fresh = true) }
        Muted(statusLine(feed, extra), Modifier.padding(top = 14.dp).testTag("statusLine"))
    }
}

fun LazyListScope.eventCards(list: List<Event>, keyPrefix: String, onOpen: (Event) -> Unit, savedCopy: Boolean = false, extra: ((Event) -> String?)? = null) {
    items(list, key = { keyPrefix + it.id + it.hashCode() }) { e -> Box(Modifier.padding(bottom = 10.dp)) { EventCard(e, { onOpen(e) }, extra = extra?.invoke(e), showSavedCopy = savedCopy) } }
}

/** Shown in place of a list when the feed has not loaded: a failed load is not an empty list. */
fun LazyListScope.notLoaded(feed: FeedState): Boolean {
    if (feed.feed != null) return false
    item(key = "notLoaded") {
        if (feed.failed) StaleBox("Live data unavailable. Trying again automatically.", tag = "listError") else EmptyText("Loading…")
    }
    return true
}

/* ------------------------------------------------------------------- Map */

/** Map tab (features.md §2). */
@Composable
fun MapScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var q by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("live-map_sortBy", Sorts.EVENT_SORTS)
    val list = remember(feed, q, sort) { Sorts.sort(feed.events.filter { Search.matches(it.json, q, it.searchText) }, sort) { it.json } }
    PndScreen(header = { item { ScreenHeader(null, "Live disaster map", "Events reported by official agencies, shown on a map. This page refreshes every minute.") } }) {
        item(key = "tools") {
            Column {
                SearchField(q, "Search place or hazard", tag = "search") { q = it }
                Toolbar { SortSelect("live-map", Sorts.EVENT_SORTS, sort, setSort) }
                RefreshRow(feed)
            }
        }
        item(key = "map") { RiskMap(list.take(220), height = 420.dp) { env.navigate(Format.eventUrl(it.json)) } }
        item(key = "latestHead") { Row(verticalAlignment = Alignment.CenterVertically) { SubHeading("Latest events"); LinkButton("See all →") { env.navigate("/recent-events") } } }
        if (!notLoaded(feed)) {
            if (list.isEmpty()) item { EmptyCard(Search.emptyState(q, feed.events.map { it.json }, feed.events.map { it.json }, "events")) { env.navigate("/events?q=" + Format.enc(it)) } }
            eventCards(list.take(30), "m", { env.navigate(Format.eventUrl(it.json)) })
        }
    }
}

/* ---------------------------------------------------------------- Alerts */

/** Alerts & events tab root (features.md §3.1). */
@Composable
fun AlertsScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var q by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("alerts_sortBy", Sorts.EVENT_SORTS)
    val all = feed.events
    val es = remember(feed, q, level, sort) { Sorts.sort(all.filter { it.official && Search.matches(it.json, q, it.searchText) && RiskScale.matchesRiskLevel(it.json, level) }, sort) { it.json } }
    PndScreen(header = { item { ScreenHeader("Official alerts and reported events", "Alerts", "Current reports from official agencies. Open any alert to see its details and its source.") } }) {
        item(key = "stats") {
            val f = feed.feed
            StatLine(listOf("official reports" to (if (f != null) es.size.toString() else "-"),
                "red or orange alert" to (if (f != null) es.count { it.alert == "Red" || it.alert == "Orange" }.toString() else "-"),
                "countries and areas" to (if (f != null) Format.countryCount(es.map { it.json }).toString() else "-"),
                "sources working" to (f?.let { Format.sourcesRatio(it.meta.json) } ?: "-"),
                "updated" to (f?.let { Format.age(it.generatedAt) } ?: "-")))
        }
        item(key = "nav") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Live events" to "/events", "Official warnings" to "/official-warnings", "Recent events" to "/recent-events", "Current alerts" to "/alerts-notifications",
                    "Events by type" to "/hazard-types", "Disasters now and in the past" to "/calamities", "Past and recent events" to "/historical-events").forEach { (l, u) -> OutlinePillButton(l) { env.navigate(u) } }
            }
        }
        item(key = "tools") {
            Column {
                SearchField(q, "Search by alert, place, hazard or agency", tag = "search") { q = it }
                Toolbar { RiskFilter(level) { level = it }; SortSelect("alerts", Sorts.EVENT_SORTS, sort, setSort) }
                RefreshRow(feed)
            }
        }
        item(key = "map") { Column { SubHeading("Map of official alerts"); RiskMap(es.take(250)) { env.navigate(Format.eventUrl(it.json)) } } }
        item(key = "head") { Row(verticalAlignment = Alignment.CenterVertically) { SubHeading("Current official alerts"); LinkButton("See all official warnings →") { env.navigate("/official-warnings") } } }
        if (!notLoaded(feed)) {
            if (es.isEmpty()) item { EmptyCard(Search.emptyState(q, all.map { it.json }, all.map { it.json }, "official alerts")) { env.navigate("/events?q=" + Format.enc(it)) } }
            eventCards(es.take(40), "a", { env.navigate(Format.eventUrl(it.json)) })
        }
        item(key = "sources") {
            Panel("Source status", trailing = { LinkButton("About our sources →") { env.navigate("/resources") } }) {
                feed.feed?.meta?.sources?.forEach { (k, v) ->
                    Column(Modifier.semantics(mergeDescendants = true) {}) {
                        Text(k.uppercase().replace("_", " "), color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Muted((if (v.truthy("ok")) "Working" else "Not answering") + " · checked " + Format.fmtDate(v.str("checkedAt")))
                    }
                } ?: Muted(if (feed.failed) "Live data unavailable. Trying again automatically." else "Loading…")
            }
        }
        item(key = "howto") {
            Panel("How to read these alerts") {
                Body("Red and orange are the two highest alert levels. We treat them as the most serious.")
                Body("USGS earthquakes are earthquakes that have already happened. They may not have a colour alert level like GDACS alerts do.")
                Body("Open any alert to see where it is, its reported impact, when the source last updated it, and a link to the original report.")
            }
        }
    }
}

/* ------------------------------------------------------------ collections */

/** The collection views (features.md §3.2). */
@Composable
fun CollectionScreen(view: CollectionView, initialQuery: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var q by rememberSaveable { mutableStateOf(initialQuery) }
    var hazard by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf("") }
    val forecastMode = view == CollectionView.FORECAST_LIST
    val keys = when (view) { CollectionView.FORECAST_LIST -> Sorts.FORECAST_LIST; CollectionView.HISTORICAL -> Sorts.HISTORICAL; else -> Sorts.EVENT_SORTS }
    val (sort, setSort) = rememberSort(view.route + "_sortBy", keys)
    val all = if (view == CollectionView.HISTORICAL) feed.all else feed.events
    fun keep(e: Event) = when (view) {
        CollectionView.OFFICIAL, CollectionView.ALERTS_NOTIFICATIONS -> e.official && (e.alert == "Red" || e.alert == "Orange" || e.source == "USGS")
        CollectionView.FORECAST_LIST -> e.json.str("forecast") == "true"
        CollectionView.RECENT -> e.official
        else -> true
    }
    val pool = all.filter(::keep)
    val es = remember(feed, q, hazard, level, sort) {
        Sorts.sort(pool.filter { e ->
            Search.matches(e.json, q, e.searchText) &&
                (hazard.isEmpty() || if (forecastMode) e.type.lowercase() == hazard.lowercase() else fixedHazardMatch(e.type, hazard)) &&
                RiskScale.matchesRiskLevel(e.json, level)
        }, sort) { it.json }
    }
    PndScreen(header = { item { ScreenHeader(null, view.title, view.subtitle) } }) {
        item(key = "tools") {
            Column {
                SearchField(q, if (view == CollectionView.COMPARE) "Search for a place" else "Search events, places or hazards", tag = "search") { q = it }
                Toolbar {
                    val opts = if (forecastMode) Format.hazardOptions(pool.map { it.json }, hazard) else listOf("" to "All hazards") + FIXED_HAZARDS.map { it to it }
                    Select("Filter by hazard", opts, hazard, tag = "hazardFilter") { hazard = it }
                    RiskFilter(level) { level = it }
                    SortSelect(view.route, keys, sort, setSort)
                }
                RefreshRow(feed, Format.countText(es.map { it.json }))
            }
        }
        if (forecastMode) item(key = "note") { Notice(Format.horizonText(feed.feed?.meta?.json) + " Each forecast is our own estimate, based on a current official report. It may be wrong. It is not an official warning and does not replace one.") }
        if (!notLoaded(feed)) {
            if (es.isEmpty()) item(key = "empty") { EmptyCard(Search.emptyState(q, pool.map { it.json }, all.map { it.json }, view.noun)) { env.navigate("/events?q=" + Format.enc(it)) } }
            if (forecastMode) items(es, key = { "f" + it.id + it.hashCode() }) { e -> ForecastRowCard(e, full = true) }
            else eventCards(es, "c", { env.navigate(Format.eventUrl(it.json)) })
        }
    }
}

/** forecast-table.js, folded to a card on a phone (design.md §4.11); [full] adds the desktop-only columns. */
@Composable
fun ForecastRowCard(e: Event, full: Boolean = false) {
    val env = LocalApp.current
    val j = e.json
    CardBox(Modifier.padding(bottom = 8.dp).testTag("fc:${e.id}"), onClick = { env.navigate(Format.eventUrl(j)) }, label = "Open ${e.displayTitle}") {
        FcCell("Risk") { RecordBadge(j) }
        FcCell("Forecast") { Text(e.displayTitle, color = Pnd.link, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
        FcCell("Place") { Text(com.anchittandon.pnd.logic.ForecastTable.place(j), color = Pnd.body, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        FcCell("Hazard") { Text(com.anchittandon.pnd.logic.ForecastTable.hazard(j), color = Pnd.body, fontSize = 13.sp) }
        FcCell("Kind of forecast") {
            Text(com.anchittandon.pnd.logic.ForecastTable.classLabel(j), color = Pnd.body, fontSize = 13.sp,
                modifier = Modifier.semantics { contentDescription = com.anchittandon.pnd.logic.ForecastTable.classLabel(j) + ". " + com.anchittandon.pnd.logic.ForecastTable.classDefinition(j) })
        }
        FcCell("Dates") { Text(com.anchittandon.pnd.logic.ForecastTable.window(j), color = Pnd.body, fontSize = 13.sp) }
        FcCell("Status") { Text(com.anchittandon.pnd.logic.ForecastTable.status(j), color = Pnd.body, fontSize = 13.sp) }
        if (full) {
            FcCell("Starts") { Text(com.anchittandon.pnd.logic.ForecastTable.starts(j), color = Pnd.body, fontSize = 13.sp) }
            FcCell("Ends") { Text(com.anchittandon.pnd.logic.ForecastTable.ends(j), color = Pnd.body, fontSize = 13.sp) }
            FcCell("What it is") { Pill(com.anchittandon.pnd.logic.ForecastTable.provenance(j), upper = false) }
            FcCell("Source") { Text(com.anchittandon.pnd.logic.ForecastTable.source(j), color = Pnd.body, fontSize = 13.sp) }
            FcCell("Updated") { Text(Format.age(e.updated), color = Pnd.body, fontSize = 13.sp, modifier = Modifier.semantics { contentDescription = "Updated " + Format.fmtDate(e.updated) }) }
        }
    }
}

@Composable
private fun FcCell(label: String, value: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Text(label.uppercase(), color = Pnd.label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(96.dp).padding(top = 3.dp))
        Box(Modifier.weight(1f)) { value() }
    }
}

/* -------------------------------------------------------------- calendar */

/** Forecast calendar (features.md §4.2). */
@Composable
fun ForecastCalendarScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var q by rememberSaveable { mutableStateOf("") }
    var hazard by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("forecast-calendar_sortBy", Sorts.FORECAST_LIST)
    val pool = feed.events.filter { it.json.str("forecast") == "true" }
    val es = Sorts.sort(pool.filter { Search.matches(it.json, q, it.searchText) && (hazard.isEmpty() || it.type.lowercase() == hazard.lowercase()) && RiskScale.matchesRiskLevel(it.json, level) }, sort) { it.json }
    PndScreen(header = { item { ScreenHeader(null, "Forecast calendar", "Each current forecast, shown across the days it covers.") } }) {
        item(key = "tools") {
            Column {
                SearchField(q, "Search events, places or hazards", tag = "search") { q = it }
                Toolbar {
                    Select("Filter by hazard", Format.hazardOptions(pool.map { it.json }, hazard), hazard) { hazard = it }
                    RiskFilter(level) { level = it }
                    SortSelect("forecast-calendar", Sorts.FORECAST_LIST, sort, setSort)
                }
                RefreshRow(feed, Format.countText(es.map { it.json }))
            }
        }
        item(key = "note") { Notice(Format.horizonText(feed.feed?.meta?.json) + " Each forecast is our own estimate, based on a current official report. It may be wrong. It is not an official warning and does not replace one.") }
        if (!notLoaded(feed)) item(key = "cal") { Calendar(es) }
    }
}

@Composable
private fun Calendar(list: List<Event>) {
    val env = LocalApp.current
    if (list.isEmpty()) {
        CardBox { Text("No forecasts to show for these dates.", fontWeight = FontWeight.Bold, color = Pnd.text); Muted("Try removing a filter, or refresh the page.") }
        return
    }
    val day = 86_400_000L
    val now = AppClock.now()
    val zone = try { ZoneId.of(AppClock.zone) } catch (e: Exception) { ZoneId.of("UTC") }
    val from = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
    val ends = list.mapNotNull { JsDate.parse(it.json.text("targetEnd")) }
    val last = ends.maxOrNull() ?: (from + 3 * day)
    val to = minOf(from + 15 * day, maxOf(from + 4 * day, last + day))
    val span = (to - from).toDouble()
    val days = generateSequence(from) { it + day }.takeWhile { it < to }.toList()
    val dayW = 56.dp; val labelW = 118.dp
    val trackW = dayW * days.size
    fun pct(t: Long) = ((t - from) / span).coerceIn(0.0, 1.0)
    val dows = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    val mons = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
    Column(Modifier.fillMaxWidth().testTag("calendar")) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            Column {
                Row {
                    Box(Modifier.width(labelW))
                    days.forEach { t ->
                        val d = Instant.ofEpochMilli(t).atZone(zone)
                        Column(Modifier.width(dayW).background(if (t == from) Color(0xFF0C3527) else Color.Transparent).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(dows[d.dayOfWeek.value - 1], color = Color(0xFF9EC7B6), fontSize = 11.sp)
                            Text("${d.dayOfMonth}", color = if (t == from) Color(0xFF7EF0C0) else Pnd.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            Text(mons[d.monthValue - 1], color = Color(0xFF9EC7B6), fontSize = 11.sp)
                        }
                    }
                }
                list.groupBy { it.type.ifEmpty { "Other" } }.toSortedMap().forEach { (type, items) ->
                    Text(type.uppercase(), color = Color(0xFF7FD8B4), fontSize = 12.sp, letterSpacing = 1.5.sp, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                    items.sortedBy { JsDate.parse(it.json.text("targetStart").ifEmpty { it.json.text("startedAt") }) ?: 0L }.forEach { e ->
                        val s = JsDate.parse(e.json.text("targetStart").ifEmpty { e.json.text("startedAt") })?.takeIf { it != 0L } ?: from
                        val en = JsDate.parse(e.json.text("targetEnd"))?.takeIf { it != 0L } ?: (s + day)
                        val left = pct(s); val right = pct(en); val width = maxOf(0.014, right - left)
                        val liveNow = now in s..en
                        val lv = RiskScale.levelOf(e.alert)
                        val fill = lv.fill() ?: Color(0xFF5FD3A6)
                        val label = "${e.displayTitle}. ${Format.windowText(e.json)}"
                        Row(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Open forecast") { env.navigate(Format.eventUrl(e.json)) }
                            .semantics(mergeDescendants = true) { contentDescription = label }, verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.width(labelW).padding(end = 6.dp)) {
                                RecordBadge(e.json)
                                Text(Format.placeOf(e.json, "Place not given"), color = Pnd.body, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            Box(Modifier.width(trackW).height(30.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF082A20))) {
                                Box(Modifier.offset(x = trackW * left.toFloat()).width(trackW * width.toFloat()).height(30.dp).padding(3.dp)
                                    .clip(RoundedCornerShape(5.dp)).background(fill).let { if (liveNow) it.border(2.dp, Color(0xFF7EF0C0), RoundedCornerShape(5.dp)) else it }) {
                                    Text(dayRange(s, en, zone), color = lv.ink?.let { Color(it) } ?: Color.Black, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp))
                                }
                                Box(Modifier.offset(x = trackW * pct(now).toFloat()).width(2.dp).height(30.dp).background(Color(0xFF7EF0C0)))
                            }
                        }
                    }
                }
            }
        }
        Muted("Each bar runs from the start of a forecast to its expected end. The line marks now. Forecasts are our own estimates, not official warnings.", Modifier.padding(top = 8.dp))
    }
}

private fun dayRange(a: Long, b: Long, zone: ZoneId): String {
    val mons = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
    fun f(t: Long) = Instant.ofEpochMilli(t).atZone(zone).let { "${it.dayOfMonth} ${mons[it.monthValue - 1]}" }
    val x = f(a); val y = f(b)
    return if (x == y) x else "$x - $y"
}

/* ------------------------------------------------------------- calamities */

/** Disasters now and in the past (features.md §3.3). */
@Composable
fun CalamitiesScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var tab by rememberSaveable { mutableStateOf(0) }
    var q by rememberSaveable { mutableStateOf("") }
    var geo by rememberSaveable { mutableStateOf("") }
    var haz by rememberSaveable { mutableStateOf("") }
    var risk by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("calamities_sortBy", Sorts.EVENT_SORTS)
    var hq by rememberSaveable { mutableStateOf("") }
    var hh by rememberSaveable { mutableStateOf("") }
    var hs by rememberSaveable { mutableStateOf("asc") }
    val all = feed.events.filter { it.official && !it.forecast }
    val es = remember(feed, q, geo, haz, risk, sort) {
        Sorts.sort(all.filter { e ->
            val blob = listOf(e.title, e.country, e.region, e.type, e.source).joinToString(" ").lowercase()
            (q.isEmpty() || blob.contains(q.lowercase())) && (geo.isEmpty() || blob.contains(geo.lowercase())) &&
                (haz.isEmpty() || e.type.lowercase().contains(haz.lowercase())) && RiskScale.matchesRiskLevel(e.json, risk)
        }, sort) { it.json }
    }
    val history = env.container.history
    PndScreen(header = { item { ScreenHeader(null, "Current disasters and disaster history", "Disasters happening now around the world, plus a timeline of major disasters from the past.") } }) {
        item(key = "stats") {
            val f = feed.feed
            StatLine(listOf("happening now" to (if (f != null) es.size.toString() else "-"),
                "high alert" to (if (f != null) es.count { it.alert in setOf("Red", "Orange", "High") }.toString() else "-"),
                "countries and territories" to (if (f != null) Format.countryCount(es.map { it.json }).toString() else "-"),
                "sources working" to (f?.let { Format.sourcesRatio(it.meta.json) } ?: "-"), "past disasters listed" to history.size.toString()))
        }
        item(key = "tabs") {
            TabRow(tab, containerColor = Pnd.bg, contentColor = Pnd.greenText) {
                Tab(tab == 0, { tab = 0 }, Modifier.heightIn(min = 48.dp), text = { Text("Happening now") })
                Tab(tab == 1, { tab = 1 }, Modifier.heightIn(min = 48.dp), text = { Text("Past disasters") })
            }
        }
        if (tab == 0) {
            item(key = "tools") {
                Column {
                    SearchField(q, "Search disasters", tag = "search") { q = it }
                    Toolbar {
                        Select("Country or territory", listOf("" to "All countries and territories") + Hazards.englishCountryNames.map { it to it }, geo) { geo = it }
                        Select("Hazard", listOf("" to "All hazards") + listOf("Flood", "Earthquake", "Wildfire", "Volcano", "Storm", "Drought").map { it to it }, haz) { haz = it }
                        RiskFilter(risk) { risk = it }
                        SortSelect("calamities", Sorts.EVENT_SORTS, sort, setSort)
                    }
                    RefreshRow(feed)
                    Label("Jump to a country")
                    Muted("You can pick any country. We only show events that official agencies have reported.")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Nepal", "Indonesia", "India", "Vietnam", "Japan", "United States", "Philippines", "World").forEach { c -> OutlinePillButton(c) { geo = if (c == "World") "" else c } }
                    }
                }
            }
            item(key = "head") { SubHeading("Ongoing and recent disasters") }
            if (!notLoaded(feed)) {
                if (es.isEmpty()) item { CardBox { Text("No matching disasters reported right now.", fontWeight = FontWeight.Bold, color = Pnd.text); Muted("Our sources have no current report that matches. This does not mean the place is safe.") } }
                eventCards(es, "cal", { env.navigate("/calamities/" + Format.enc(it.id)) }, savedCopy = true)
            }
            item(key = "health") {
                Panel("Source status", trailing = { LinkButton("Sources →") { env.navigate("/resources") } }) {
                    val src = feed.feed?.meta?.sources
                    if (src.isNullOrEmpty()) Muted("Source status is not available.")
                    src?.forEach { (k, v) ->
                        Column(Modifier.semantics(mergeDescendants = true) {}) {
                            Text(k.uppercase().replace("_", " "), color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Muted((if (v.truthy("ok")) "Working" else "Not answering") + (v.str("window")?.let { " · $it" } ?: "") + (v.str("error")?.let { " · $it" } ?: ""))
                            Muted("Checked " + (v.str("checkedAt")?.let { Format.fmtDate(it) } ?: "-"))
                        }
                    }
                    Muted("You can choose any country or territory that your browser knows. We cover Earth only. If a source is down, we may show a saved copy of an event instead, and we label it as a saved copy.")
                }
            }
        } else {
            item(key = "htools") {
                Column {
                    SearchField(hq, "Search past disasters", tag = "hsearch") { hq = it }
                    Toolbar {
                        Select("Hazard", listOf("" to "All hazards") + listOf("Earthquake", "Flood", "Volcanic", "Cyclone", "Wildfire", "Tsunami").map { it to it }, hh) { hh = it }
                        Select("Order", listOf("asc" to "Oldest first", "desc" to "Newest first"), hs) { hs = it }
                    }
                    LinkButton("See past and recent events") { env.navigate("/historical-events") }
                    SubHeading("Timeline of past disasters")
                    Muted("From the earliest recorded disasters to today")
                    Notice("No complete list of every natural disaster in Earth’s history exists. This timeline starts with early disasters that have good archaeological, geological or written evidence. It becomes more complete from the time modern instruments began recording. Its first entry is not “the first natural disaster ever”.")
                }
            }
            val arr = history.filter { (hq.isEmpty() || Search.matches(it, hq)) && (hh.isEmpty() || it.text("type").lowercase().contains(hh.lowercase())) }
                .sortedBy { (it.str("sort")?.toDoubleOrNull() ?: 0.0) * if (hs == "asc") 1 else -1 }
            items(arr, key = { "h" + it.text("name") }) { h ->
                Box(Modifier.padding(bottom = 8.dp)) {
                    CardBox(onClick = { env.navigate("/history/" + Format.enc(slug(h.text("name")))) }, label = "Open ${h.text("name")}") {
                        Text(h.text("year"), color = Pnd.greenText, fontWeight = FontWeight.Bold)
                        Text(h.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Muted("${h.text("location")} · ${h.text("type")}")
                        Body(h.text("summary"))
                        val sev = h.text("severity")
                        RiskBadge(if (sev == "Catastrophic") com.anchittandon.pnd.logic.Level.SEVERE else com.anchittandon.pnd.logic.Level.HIGH, sev, "Severity: $sev")
                    }
                }
            }
        }
        item(key = "tzfoot") { Muted("Times are shown in ${Format.tzLabel()} by default. To see them in another time zone, use the time zone menu at the top of the screen.", Modifier.padding(vertical = 8.dp)) }
    }
}

fun slug(v: String): String = v.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
