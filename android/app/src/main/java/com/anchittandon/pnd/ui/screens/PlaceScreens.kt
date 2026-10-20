@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.PlaceSearchRepository
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Continents
import com.anchittandon.pnd.logic.HazardPage
import com.anchittandon.pnd.logic.Portal
import com.anchittandon.pnd.logic.RegionMatch
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Place
import com.anchittandon.pnd.logic.PlaceRisk
import com.anchittandon.pnd.logic.Search
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.jsonObjectOf
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

val POPULAR = listOf("Nepal" to "Floods, landslides and earthquakes", "Indonesia" to "Earthquakes, volcanoes and floods", "India" to "Floods, storms, heat and earthquakes",
    "Vietnam" to "Floods, cyclones and our test forecast", "Philippines" to "Cyclones, floods and earthquakes", "Japan" to "Earthquakes, volcanoes and typhoons",
    "United States" to "Wildfires, floods and earthquakes", "World" to "All current events")

fun locationPath(p: Place): String = "/locations/" + Format.enc(p.name) + "?lat=" + com.anchittandon.pnd.model.jsNumText(p.lat) + "&lon=" + com.anchittandon.pnd.model.jsNumText(p.lon) +
    "&level=" + Format.enc(p.level) + "&country=" + Format.enc(p.country) + "&cc=" + Format.enc(p.countryCode)

/** Regions list (features.md §8.1). */
@Composable
fun RegionsScreen() {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var choices by remember { mutableStateOf<List<Place>>(emptyList()) }
    val (sort, setSort) = rememberSort("regions_sortBy", Sorts.REGIONS)
    val all = feed.events
    val es = all.filter { q.isEmpty() || Search.matchesPlace(it.json, q) }
    val reports = all.filter { !it.forecast }
    data class G(var count: Int = 0, var high: Int = 0, val types: MutableSet<String> = HashSet(), var latest: Long = 0)
    val groups = remember(feed) {
        val m = LinkedHashMap<String, G>()
        reports.forEach { e ->
            val cs = e.json.arr("countries").strings()
            val names = (if (cs.isNotEmpty()) cs else if (e.json.truthy("sea")) listOf(e.json.text("sea")) else listOf(e.country.trim())).filter { it.isNotEmpty() }
            names.forEach { n -> val g = m.getOrPut(n) { G() }; g.count++; if (e.alert in setOf("Red", "Orange", "High")) g.high++; g.types += e.type; g.latest = maxOf(g.latest, JsDate.parse(e.updated) ?: 0L) }
        }
        m
    }
    val sorted = groups.entries.sortedWith { a, b ->
        when (sort) {
            "priority" -> (b.value.high - a.value.high).takeIf { it != 0 } ?: (b.value.count - a.value.count)
            "countDesc" -> b.value.count - a.value.count
            "countAsc" -> a.value.count - b.value.count
            "newest" -> b.value.latest.compareTo(a.value.latest)
            else -> Sorts.collator.compare(a.key, b.key)
        }
    }.take(40)
    fun openPlace(c: Place) { if (c.level == "Country") env.navigate("/regions/" + Format.enc(c.country.ifEmpty { c.name })) else env.navigate(locationPath(c)) }
    PndScreen(trust = setOf(TrustGroup.FEED, TrustGroup.MODELS, TrustGroup.PLACE),
        header = { item { ScreenHeader("By place", "Regions", "Start with the whole world. Then choose a country, a city or a neighbourhood, and then an event.") } }) {
        item(key = "stats") {
            val f = feed.feed
            StatLine(listOf("current events" to (if (f != null) reports.size.toString() else "-"), "countries and areas" to (if (f != null) Format.countryCount(reports.map { it.json }).toString() else "-"),
                "high alert" to (if (f != null) reports.count { Portal.isHighAlert(it.json) }.toString() else "-"),
                "sources working" to (f?.let { Format.sourcesRatio(it.meta.json) } ?: "-"), "updated" to (f?.let { Format.age(it.generatedAt) } ?: "-")))
        }
        item(key = "tools") {
            Column {
                SearchField(q, "Search a country, region or area", tag = "search") { q = it }
                Toolbar {
                    SecondaryButton("Open this place") { env.navigate("/regions/" + Format.enc(q.trim().ifEmpty { "World" })) }
                    SecondaryButton("Find a city or area", Modifier.testTag("findArea")) {
                        val s = q.trim()
                        if (s.isEmpty()) note = "Type a neighbourhood, city or district first." else {
                            note = "Finding the place…"; choices = emptyList()
                            scope.launch {
                                when (val r = env.container.placeSearch.search(s)) {
                                    is PlaceSearchRepository.Result.Failed -> note = "Place search is not working right now."
                                    is PlaceSearchRepository.Result.Ok -> when (r.places.size) {
                                        0 -> note = "We could not find that place. Check the spelling, or add the city or country."
                                        1 -> { note = ""; openPlace(r.places[0]) }
                                        else -> { note = "We found ${r.places.size} places with that name. Choose one."; choices = r.places }
                                    }
                                }
                            }
                        }
                    }
                }
                if (note.isNotEmpty()) Muted(note)
                if (choices.isNotEmpty()) PlaceChooser(choices) { choices = emptyList(); openPlace(it) }
                RefreshRow(feed)
            }
        }
        item(key = "map") { Column { SubHeading("World map"); RiskMap(es.take(250)) { env.navigate(Format.eventUrl(it.json)) } } }
        item(key = "groupsHead") { Column { SubHeading("Places with current events"); Muted("Select a place to see its own page"); Toolbar { SortSelect("regions", Sorts.REGIONS, sort, setSort) } } }
        if (!notLoaded(feed)) {
            if (sorted.isEmpty()) item { EmptyText("No places with current events.") }
            items(sorted, key = { "g" + it.key }) { (name, g) ->
                Box(Modifier.padding(bottom = 8.dp)) {
                    CardBox(onClick = { env.navigate("/regions/" + Format.enc(name)) }, label = "Open $name") {
                        Text(name, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Muted("${g.count} current event" + (if (g.count == 1) "" else "s") + " · ${g.high} high alert")
                        Muted("${g.types.size} type" + (if (g.types.size == 1) "" else "s") + " of hazard · latest ${Format.age(if (g.latest > 0) JsDate.iso(g.latest) else null)}")
                    }
                }
            }
        }
        item(key = "popular") { PopularPlaces(withSummary = true) }
        item(key = "what") {
            Panel("What we show") {
                Body("You can search any place. We only show events that our sources have reported. We never make up an event to fill an empty place.")
                Body("If a place shows nothing, our sources have no current report for it. It does not mean the place has no risk.")
            }
        }
    }
}

@Composable
fun PopularPlaces(withSummary: Boolean) {
    val env = LocalApp.current
    Panel("Popular places") {
        if (withSummary) POPULAR.forEach { (n, s) -> CardBox(onClick = { env.navigate("/regions/" + Format.enc(n)) }, label = "Open $n") { Text(n, color = Pnd.text, fontWeight = FontWeight.Bold); Muted(s) } }
        else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            POPULAR.dropLast(1).forEach { (n, _) -> OutlinePillButton(n) { env.navigate("/regions/" + Format.enc(n)) } }
        }
    }
}

/** Region detail (features.md §8.2). */
@Composable
fun RegionDetailScreen(region0: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    // A continent is the countries on it (continents.js); its canonical name is used from here on (changelog C1).
    val region = RegionMatch.canonical(region0)
    val continent = Continents.continentNamed(region)
    var input by rememberSaveable { mutableStateOf(if (region == "World") "" else region) }
    val (sort, setSort) = rememberSort("region_sortBy", Sorts.EVENT_SORTS)
    // Reports only, the same records and counts as every other screen (changelog C14).
    val es = remember(feed, region, sort) { Sorts.sort(Portal.observed(feed.events) { it.json }.filter { RegionMatch.matches(it.json, region) }, sort) { it.json } }
    val counts = es.groupingBy { it.type }.eachCount().entries.sortedByDescending { it.value }
    PndScreen(trust = setOf(TrustGroup.FEED, TrustGroup.MODELS, TrustGroup.PLACE), header = {
        item { DetailTop("REGION", if (region == "World") "Disasters around the world" else "Disasters in $region", "Current events and alerts for ${if (region == "World") "the whole world" else region}.", "/regions/" + Format.enc(region)) }
    }) {
        item(key = "open") {
            Toolbar {
                SearchField(input, "Open region", Modifier.widthIn(min = 200.dp), imeSearch = { env.navigate("/regions/" + Format.enc(input.trim().ifEmpty { "World" })) }) { input = it }
                SecondaryButton("Open region") { env.navigate("/regions/" + Format.enc(input.trim().ifEmpty { "World" })) }
            }
        }
        if (feed.feed == null && feed.failed) {
            item(key = "stats") { StatLine(listOf("current events", "high alert", "types of hazard", "sources reporting here", "last checked").map { it to Portal.UNAVAILABLE }) }
            item(key = "coverDown") { Muted("Live data unavailable, so we cannot say what is reported here right now.") }
        }
        if (notLoaded(feed)) return@PndScreen
        item(key = "stats") {
            StatLine(listOf("current events" to es.size.toString(), "high alert" to es.count { Portal.isHighAlert(it.json) }.toString(),
                "types of hazard" to counts.size.toString(), "sources reporting here" to Portal.sourcesReporting(es) { it.json }.toString(), "last checked" to Format.age(feed.feed!!.generatedAt)))
        }
        item(key = "status") { RefreshRow(feed) }
        item(key = "map") {
            // The map fits the markers (max zoom 6).
            val pts = es.take(250).filter { it.lat != null && it.lon != null }.map { it.lat!! to it.lon!! }
            Panel("Live map", trailing = { LinkButton("Full map →") { env.navigate("/live-map") } }) {
                RiskMap(es.take(250), fit = if (pts.isNotEmpty()) MapFit(region, pts) else null) { env.navigate(Format.eventUrl(it.json)) }
            }
        }
        item(key = "evHead") { Column { androidx.compose.foundation.layout.Row { SubHeading("Current events here"); LinkButton("See all events →") { env.navigate("/events?region=" + Format.enc(region)) } }; Toolbar { SortSelect("region", Sorts.EVENT_SORTS, sort, setSort) } } }
        if (es.isEmpty()) item { CardBox { Text("No current events here.", fontWeight = FontWeight.Bold, color = Pnd.text); Muted("Our sources have no current report for this place. This does not mean there is no danger.") } }
        eventCards(es, "r", { env.navigate(Format.eventUrl(it.json)) })
        item(key = "types") {
            Panel("Types of hazard") {
                if (counts.isEmpty()) EmptyText("No types of hazard to show.")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    counts.forEach { (h, c) -> CardBox(Modifier.widthIn(min = 140.dp, max = 220.dp), onClick = { env.navigate("/hazards/" + Format.enc(h) + if (region != "World") "?region=" + Format.enc(region) else "") }) { Text(h, color = Pnd.text, fontWeight = FontWeight.Bold); Muted("$c current events") } }
                }
            }
        }
        item(key = "cover") {
            Panel("What we cover") {
                Body(RegionMatch.coverage(Format.sourcesRatio(feed.feed!!.meta.json), es.size, continent, if (continent.isEmpty()) 0 else RegionMatch.atSea(feed.events) { it.json }))
                Muted("What we show depends on what our global and national sources report. If a place has no current report, we show no events for it. That does not mean it is free of risk.")
            }
        }
        item(key = "popular") { PopularPlaces(withSummary = false) }
        val top = es.firstOrNull { !it.forecast } ?: es.firstOrNull()
        enrichmentBlock(jsonObjectOf("title" to (if (region == "World") "global natural disaster response" else "$region natural disaster"),
            "country" to (if (region == "World") "" else region), "region" to (if (region == "World") "" else region), "type" to (top?.type ?: "Natural Hazard"),
            "updated" to feed.feed!!.generatedAt, "lat" to top?.lat, "lon" to top?.lon, "source" to "Combined from the official sources we read", "forecast" to false))
    }
}

/** Location detail (features.md §8.3). */
@Composable
fun LocationDetailScreen(name: String, lat: Double?, lon: Double?, level: String, country: String, cc: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val at = if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) lat to lon else null
    val default = mapOf("Area" to 50, "City or town" to 100, "District" to 150, "State or region" to 300)[level] ?: 100
    var radius by remember { mutableStateOf(env.container.settings.radius(level)?.takeIf { it in listOf(25, 50, 100, 150, 300, 500) } ?: default) }
    val keys = if (at != null) Sorts.LOCATION else Sorts.EVENT_SORTS
    val (sort, setSort) = rememberSort(if (at != null) "location_coords_sortBy" else "location_sortBy", keys)
    val es = remember(feed, radius, sort) {
        val base = feed.events.mapNotNull { e ->
            if (at != null) {
                if (e.lat == null || e.lon == null) return@mapNotNull null
                val d = Hazards.distanceKm(at.first, at.second, e.lat!!, e.lon!!)
                if (d <= radius) Event(kotlinx.serialization.json.JsonObject(LinkedHashMap(e.json).apply { put("_d", kotlinx.serialization.json.JsonPrimitive(d)) })).also { it.distance = d } else null
            } else if (name == "World" || Search.matchesPlace(e.json, name)) e else null
        }
        Sorts.sort(base, sort) { it.json }
    }
    val counts = es.groupingBy { it.type }.eachCount().entries.sortedByDescending { it.value }
    val path = "/locations/" + Format.enc(name) + if (at != null) "?lat=${com.anchittandon.pnd.model.jsNumText(at.first)}&lon=${com.anchittandon.pnd.model.jsNumText(at.second)}&level=${Format.enc(level)}&country=${Format.enc(country)}&cc=${Format.enc(cc)}" else ""
    PndScreen(trust = setOf(TrustGroup.FEED, TrustGroup.MODELS, TrustGroup.PLACE), header = {
        item {
            DetailTop("PLACE", if (name == "World") "Disasters around the world" else (if (at != null) "Disasters near " else "Disasters in ") + name,
                if (at != null) "Current natural disasters and alerts within the distance you choose" + (if (level.isNotEmpty()) " (${level.lowercase()})" else "") + "."
                else "Current natural disasters and alerts for ${if (name == "World") "the whole world" else name}.", path)
        }
    }) {
        if (at != null) item(key = "radius") {
            Select("Show events within", listOf(25, 50, 100, 150, 300, 500).map { it.toString() to "Show events within $it km" }, radius.toString(), tag = "radius") {
                radius = it.toInt(); env.container.settings.setRadius(level, radius)
            }
        }
        if (notLoaded(feed)) return@PndScreen
        if (at != null) item(key = "answer") {
            val a = PlaceRisk.assess(jsonObjectOf("name" to name, "lat" to at.first, "lon" to at.second, "country" to country, "countryCode" to cc), feed.events.map { it.json }, feed.feed?.generatedAt)
            CardBox(Modifier.padding(vertical = 8.dp).testTag("placeAnswer")) {
                if (a.level != null) RiskBadge(a.level, a.level.label) else NothingNearbyChip()
                Body(a.why)
            }
        }
        item(key = "stats") {
            StatLine(listOf("current events" to es.size.toString(), "high alert" to es.count { it.alert in setOf("Red", "Orange", "High") }.toString(),
                "types of hazard" to counts.size.toString(), "sources" to es.map { it.source }.toSet().size.toString(), "last checked" to Format.age(feed.feed!!.generatedAt)))
        }
        item(key = "map") {
            Panel("Live map", trailing = { LinkButton("Full map →") { env.navigate("/live-map") } }) {
                RiskMap(es, center = at, zoom = if (at != null) (when { radius <= 50 -> 8.0; radius <= 150 -> 7.0; radius <= 300 -> 6.0; else -> 5.0 }) else 1.6,
                    circle = at?.let { MapCircle(it.first, it.second, radius.toDouble(), Pnd.green, 0.06f) }) { env.navigate(Format.eventUrl(it.json)) }
            }
        }
        item(key = "head") { Column { SubHeading("Natural disasters and alerts"); Toolbar { SortSelect(if (at != null) "location_coords" else "location", keys, sort, setSort) } } }
        if (es.isEmpty()) item { EmptyText("No current events here right now.") }
        eventCards(es, "l", { env.navigate(Format.eventUrl(it.json)) }, extra = if (at != null) { e -> "${Format.km(e.distance)} km away" } else null)
        item(key = "types") {
            Panel("Types of hazard") {
                if (counts.isEmpty()) EmptyText("No types of hazard to show.")
                counts.forEach { (h, c) -> Muted("$h · $c events") }
            }
        }
        item(key = "cover") {
            Panel("What we cover") {
                val n = es.map { it.source }.toSet().size
                Body("${es.size} current event" + (if (es.size == 1) "" else "s") + " from $n source" + (if (n == 1) "" else "s") + ". Checked ${Format.fmtDate(feed.feed!!.generatedAt)}.")
                Muted("If a place has no current report, that does not mean it is free of risk. In an emergency, follow your local authorities.")
            }
        }
        val top = es.firstOrNull { !it.forecast } ?: es.firstOrNull()
        enrichmentBlock(jsonObjectOf("title" to "$name natural disaster", "country" to (if (at != null) country else if (name == "World") "" else name),
            "region" to (if (name == "World") "" else name), "type" to (top?.type ?: "Natural Hazard"), "updated" to feed.feed!!.generatedAt,
            "lat" to (at?.first ?: top?.lat), "lon" to (at?.second ?: top?.lon), "source" to "Combined from the official sources we read", "forecast" to false))
    }
}

/** Hazard detail (features.md §9.2). */
@Composable
fun HazardDetailScreen(type0: String, region0: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    // Every hazard the model knows, every hazard present and the one asked for, A to Z; an unknown type is itself, never Flood (changelog C21).
    val fill = remember(feed, type0) { HazardPage.fillHazards(type0.ifBlank { "Flood" }, feed.events.map { it.type }) }
    val type = fill.selected
    var sel by rememberSaveable { mutableStateOf(type) }
    var reg by rememberSaveable { mutableStateOf(region0) }
    val (sort, setSort) = rememberSort("hazard_sortBy", Sorts.EVENT_SORTS)
    val rr = region0.trim().lowercase()
    // Reports only, matched whole (sameHazard) and placed with inPlace; open forecasts are counted apart.
    val pick = remember(feed, type, rr) { HazardPage.select(feed.events, type, rr) { it.json } }
    val es = remember(pick, sort) { Sorts.sort(pick.events, sort) { it.json } }
    val hz = Hazards.hazardOf(type)
    PndScreen(header = {
        item { DetailTop("HAZARD TYPE", "${type.first()}${type.drop(1).lowercase()} events", "Current ${type.lowercase()} events" + (if (rr.isNotEmpty()) " in ${region0.trim()}" else " around the world") + ". Open any event to see its details and its source.", "/hazards/" + Format.enc(type) + if (rr.isNotEmpty()) "?region=" + Format.enc(region0.trim()) else "") }
    }) {
        item(key = "pick") {
            Toolbar {
                Select("Hazard", fill.options.map { it to it }, sel, tag = "hazardSelect") { sel = it }
                SearchField(reg, "Region (optional)", Modifier.widthIn(min = 200.dp)) { reg = it }
                SecondaryButton("Show") { env.navigate("/hazards/" + Format.enc(sel) + if (reg.isNotBlank()) "?region=" + Format.enc(reg.trim()) else "") }
            }
        }
        item(key = "def") {
            Panel("What counts as " + hz.name.lowercase()) {
                Body(hz.definition)
                KvList(listOf("How it starts" to (when (hz.onset) { "sudden" -> "Suddenly, with little or no warning"; "slow" -> "Slowly, over weeks or months"; else -> "Quickly, over hours or days" }),
                    "How long it lasts" to hz.duration, "How much warning there is" to hz.leadTime, "How severity is measured" to hz.severityBasis))
            }
        }
        if (feed.feed == null && feed.failed) item(key = "stats") { StatLine(listOf("current events", "high alert", "countries and areas", "sources").map { it to Portal.UNAVAILABLE }) }
        if (notLoaded(feed)) return@PndScreen
        item(key = "stats") {
            StatLine(listOf("current events" to es.size.toString(), "high alert" to es.count { Portal.isHighAlert(it.json) }.toString(),
                "countries and areas" to Format.countryCount(es.map { it.json }).toString(), "sources" to Portal.sourcesReporting(es) { it.json }.toString()))
        }
        item(key = "status") { RefreshRow(feed) }
        item(key = "map") { Panel("Map of current events", trailing = { LinkButton("Full map →") { env.navigate("/live-map") } }) { RiskMap(es.take(250)) { env.navigate(Format.eventUrl(it.json)) } } }
        item(key = "how") {
            Panel("How to read this page") {
                KvList(listOf("Current events" to "We count only events that our sources list right now.",
                    "High alert" to "An event counts as high alert if its source or our forecast rates it red, orange or high.",
                    "Countries and areas" to "Counts use the country each source gives. They may miss events from sources that give a map position but no country.",
                    "Safety" to "This page gives up-to-date information. It does not replace the agency that issues warnings."))
            }
        }
        item(key = "head") { Column { SubHeading("Current ${type.lowercase()} events" + if (rr.isNotEmpty()) " · ${region0.trim()}" else ""); Toolbar { SortSelect("hazard", Sorts.EVENT_SORTS, sort, setSort) } } }
        if (es.isEmpty()) item { CardBox(Modifier.testTag("hazardEmpty")) { Text("No current events of this type match.", fontWeight = FontWeight.Bold, color = Pnd.text); Muted(HazardPage.emptyBody(rr.isNotEmpty())) } }
        items(es, key = { "hz" + it.id + it.hashCode() }) { e ->
            Box(Modifier.padding(bottom = 8.dp)) {
                CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "Open ${e.displayTitle}") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(e.json); SourcePill(e) }
                    Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted(Format.placeOf(e.json, "Place not given") + (if (e.details.isNotEmpty()) " · " + Format.summary(e.details) else ""))
                    Muted(Format.fmtDate(e.updated))
                }
            }
        }
        if (pick.openForecasts.isNotEmpty()) item(key = "fcNote") {
            FlowRow(Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("hazardForecastNote")) {
                Muted(HazardPage.forecastNote(pick.openForecasts.size, type, rr.isNotEmpty()), Modifier.padding(top = 14.dp, end = 6.dp))
                LinkButton("See our forecasts →") { env.navigate("/forecast-list") }
            }
        }
        val top = es.firstOrNull()
        enrichmentBlock(jsonObjectOf("title" to type + (if (rr.isNotEmpty()) " " + region0.trim() else ""), "country" to (if (rr.isNotEmpty()) region0.trim() else top?.country ?: ""),
            "region" to (if (rr.isNotEmpty()) region0.trim() else top?.region ?: ""), "type" to type, "updated" to feed.feed!!.generatedAt,
            "lat" to top?.lat, "lon" to top?.lon, "source" to "Combined from the official sources we read", "forecast" to false))
    }
}

/** Historical event detail (features.md §11.2). */
@Composable
fun HistoryDetailScreen(key: String) {
    val env = LocalApp.current
    val all = env.container.history
    val dec = Format.dec(key)
    val e = all.firstOrNull { slug(it.text("name")) == dec || it.text("name") == dec }
        ?: dec.toIntOrNull()?.let { all.getOrNull(it) }
        ?: all.firstOrNull { it.text("name").lowercase().contains(dec.lowercase()) }
    val (sort, setSort) = rememberSort("history_sortBy", Sorts.HISTORY_RELATED)
    PndScreen(trust = null, feedBanner = false) {
        if (e == null) {
            item { Column { Heading("Past disaster not found", Modifier.testTag("notFound")); Body("Go back to the list and choose a disaster."); OutlinePillButton("See current calamities") { env.navigate("/calamities") } } }
            return@PndScreen
        }
        val name = e.text("name"); val type = e.text("type"); val loc = e.text("location")
        item(key = "top") { DetailTop("PAST DISASTER", name, "${e.text("year")} · $loc", "/history/" + Format.enc(slug(name))) }
        item(key = "stats") { FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) { Figure("When", e.text("year")); Figure("Hazard", type); Figure("Severity", e.text("severity")); Figure("Where", loc) } }
        item(key = "about") {
            Panel("About this disaster", trailing = { LinkButton("Past and recent events →") { env.navigate("/historical-events") } }) {
                KvList(listOf("Name" to name, "When" to e.text("year"), "Hazard type" to type, "Where" to loc, "Severity" to e.text("severity"), "Summary" to e.text("summary")))
            }
        }
        item(key = "sure") {
            Panel("How sure is this?") {
                Body("We keep this entry for background and comparison. It is not a current event. How sure we can be about it depends on the evidence that survives: old writings, rocks and soil, ruins or instrument readings.")
                Muted("Records of past disasters are not all equally exact. For very old events, we may rely on ruins, rocks and soil, old writings or later reconstructions. Death tolls for disasters before modern times can differ a lot between sources.")
            }
        }
        item(key = "similar") {
            val first = type.split("/")[0].trim(); val place = loc.split(",")[0]
            val rel = Sorts.sort(all.filter { it != e && (it.text("type").contains(first) || it.text("location").split(",")[0] == place) }, sort) { it }.take(8)
            Panel("Similar past disasters") {
                SortSelect("history", Sorts.HISTORY_RELATED, sort, setSort)
                if (rel.isEmpty()) EmptyText("No similar past disasters in our list.")
                rel.forEach { x -> CardBox(onClick = { env.navigate("/history/" + Format.enc(slug(x.text("name")))) }) { Pill(x.text("severity"), upper = false); Text(x.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold); Muted("${x.text("year")} · ${x.text("location")} · ${x.text("type")}") } }
            }
        }
        item(key = "links") {
            Toolbar {
                OutlinePillButton("More about this hazard") { env.navigate("/hazards/" + Format.enc(type.split("/")[0].trim())) }
                OutlinePillButton("More about this region") { env.navigate("/regions/" + Format.enc(loc.split(",")[0].split("/")[0].trim())) }
                OutlinePillButton("See current calamities") { env.navigate("/calamities") }
            }
        }
        enrichmentBlock(jsonObjectOf("title" to name, "country" to loc.split(",").last().trim(), "region" to loc, "type" to type, "updated" to "", "source" to "Historical disaster archive", "forecast" to false))
    }
}

/** Source detail (features.md §10.2). */
private data class Profile(val name: String, val cls: String, val coverage: String, val use: String, val fresh: String, val limits: String, val url: String)
private val PROFILES = listOf(
    Profile("GDACS", "Official source of disaster alerts worldwide", "Floods, tropical cyclones, earthquakes, volcanoes, droughts and wildfires around the world.", "To find events of every type, with their alert level and likely impact.", "We check it every time the page loads. Times shown are the times GDACS gives.", "How complete its events and impact figures are depends on the type of hazard and when it last reported.", "https://www.gdacs.org/"),
    Profile("USGS", "Official source for earthquakes (a US science agency)", "Earthquakes around the world.", "To show where each earthquake happened, its magnitude and depth, and a link to the USGS report.", "We check it every time the page loads.", "We use USGS reports of earthquakes that have already happened. We do not use them to claim we can predict the exact time and place of future earthquakes.", "https://earthquake.usgs.gov/"),
    Profile("NASA EONET", "Official source of natural events seen by satellite", "Natural events that are still going on, including wildfires, severe storms and volcanoes.", "To find events that satellites can see, and follow them while they last.", "We check it every time the page loads.", "EONET lists events but gives no safety advice. Follow your local emergency authorities.", "https://eonet.gsfc.nasa.gov/"),
    Profile("WMO", "Reference only (an international weather organisation this site does not read)", "Weather and climate around the world.", "Background only. This site does not read data from the WMO.", "Not checked, because this site does not read its data.", "Most official weather warnings come from each country’s own weather service.", "https://wmo.int/"),
)

@Composable
fun SourceDetailScreen(raw0: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val raw = raw0.ifEmpty { "GDACS" }
    val known = PROFILES.firstOrNull { it.name.lowercase() == raw.lowercase() }
    val p = known ?: Profile(raw, "Source named in our current reports", "Depends on the source.", "Used where it has reports.", "Varies by source.", "Check the source itself for what it covers and its limits.", "")
    val (sort, setSort) = rememberSort("source_sortBy", Sorts.EVENT_SORTS)
    val es = Sorts.sort(feed.events.filter { it.source.lowercase().contains(p.name.lowercase().replace("nasa ", "")) || it.source.lowercase() == raw.lowercase() }, sort) { it.json }
    val metaKey = if (p.name == "NASA EONET") "eonet" else p.name.lowercase()
    val sm = feed.feed?.meta?.sources?.get(metaKey)
    // A name with no profile and no current report is not a source (changelog C22).
    if (known == null && feed.feed != null && es.isEmpty()) {
        PndScreen(header = { item { DetailTop("DATA SOURCE", "Source not found", null, null) } }) {
            item(key = "nf") {
                Column(Modifier.testTag("notFound")) {
                    Body("None of our current reports names a source called \u201c$raw\u201d.", Pnd.textSoft)
                    LinkButton("See every source we read →") { env.navigate("/resources") }
                }
            }
        }
        return
    }
    PndScreen(header = { item { DetailTop("DATA SOURCE", p.name, p.cls, "/sources/" + Format.enc(p.name)) } }) {
        item(key = "stats") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                Figure("Status", if (feed.feed == null) "-" else if (sm?.truthy("ok") == true) "Working" else if (sm != null) "Not answering" else if (es.isNotEmpty()) "Named in current reports" else "Not read live")
                Figure("Current reports", if (feed.feed == null) "-" else es.size.toString())
                Figure("Latest update", es.maxByOrNull { JsDate.parse(it.updated) ?: 0L }?.let { Format.age(it.updated) } ?: "-")
                Figure("Type", p.cls.split(" ").take(2).joinToString(" "))
            }
        }
        item(key = "about") {
            Panel("About this source") {
                KvList(listOf("Name" to p.name, "Type of source" to p.cls, "What it covers" to p.coverage, "How we use it" to p.use, "How often we check it" to p.fresh, "Limits" to p.limits))
                if (p.url.isNotEmpty()) SecondaryButton("Open the source’s website ↗") { env.container.platform.openUrl(p.url) }
            }
        }
        item(key = "head") { Column { androidx.compose.foundation.layout.Row { SubHeading("Current reports from this source"); LinkButton("See all events →") { env.navigate("/events") } }; Toolbar { SortSelect("source", Sorts.EVENT_SORTS, sort, setSort) }; RefreshRow(feed) } }
        if (!notLoaded(feed)) {
            if (es.isEmpty()) item { EmptyText("No current reports from this source.") }
            items(es.take(20), key = { "s" + it.id + it.hashCode() }) { e ->
                Box(Modifier.padding(bottom = 8.dp)) {
                    CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "Open ${e.displayTitle}") {
                        RecordBadge(e.json); Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold); Muted("${e.type} · ${Format.placeOf(e.json, "Place not given")}"); Muted(Format.fmtDate(e.updated))
                    }
                }
            }
        }
        item(key = "treat") {
            Panel("How we treat sources") {
                Body("We always name the source of each report or alert. We never present a forecast, or someone else’s summary, as an official warning. If a source is down and we show a saved copy of an event instead, we label it clearly and do not count it as live.")
            }
        }
        item(key = "others") {
            Panel("Other sources") { PROFILES.filter { it.name != p.name }.forEach { o -> LinkButton("${o.name} →") { env.navigate("/sources/" + Format.enc(o.name)) } } }
        }
    }
}

@Suppress("unused") private fun unusedClock() = AppClock.now()
