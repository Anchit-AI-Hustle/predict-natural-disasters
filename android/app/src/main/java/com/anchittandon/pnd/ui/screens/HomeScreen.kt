@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.PlaceSearchRepository
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.HomeModel
import com.anchittandon.pnd.logic.MapSearch
import com.anchittandon.pnd.logic.Portal
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Level
import com.anchittandon.pnd.logic.Place
import com.anchittandon.pnd.logic.PlaceRisk
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.TrustGroup
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.coroutines.launch

/** The Official warnings tile's subline; its accessibility hint is `Portal.WARNING_MEANING`. */
const val HOME_WARNINGS_NOTE = "Issued by agencies, in force now"
/** The heading of the home card that lists reports (was "Most serious live events"). */
const val HOME_LIVE_EVENTS = "Live events"

/** Home / Check a place (features.md §1). */
@Composable
fun HomeScreen() {
    val env = LocalApp.current
    val c = env.container
    val feed by c.feed.state.collectAsState()
    val settingsValues by c.settings.values.collectAsState()
    val saved = remember(settingsValues) { c.settings.places }
    var query by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var choices by remember { mutableStateOf<List<Place>>(emptyList()) }
    var checked by remember { mutableStateOf<Place?>(null) }
    var hazard by rememberSaveable { mutableStateOf("") }
    var sort by remember { mutableStateOf(c.settings.sort("home_sortBy", HomeModel.SORT_KEYS)) }
    var mapQuery by rememberSaveable { mutableStateOf("") }
    val selection = remember { MapSelection() }
    val scope = rememberCoroutineScope()

    // Auto answer on arrival: the current location if kept, otherwise the first saved place.
    LaunchedEffect(saved.isNotEmpty()) {
        if (checked == null && saved.isNotEmpty()) {
            val own = saved.firstOrNull { it.id == "loc-current" } ?: saved.first()
            checked = own
            note = "Showing " + (if (own.id == "loc-current") "your current location" else "your saved place “${own.name}”") + ". Search above to check anywhere else."
        }
    }

    fun submit() {
        val q = query.trim()
        if (q.isEmpty()) { note = "Type a city, area or address first."; return }
        busy = true; note = "Finding the place…"; choices = emptyList()
        scope.launch {
            when (val r = c.placeSearch.search(q)) {
                is PlaceSearchRepository.Result.Failed -> note = "Place search is not working right now, so we cannot check this place. Your saved places on the My places page still work."
                is PlaceSearchRepository.Result.Ok -> when (r.places.size) {
                    0 -> note = "We could not find that place. Check the spelling, or add the city or country, for example “Andheri, Mumbai”."
                    1 -> { note = ""; checked = r.places[0] }
                    else -> { note = "We found ${r.places.size} places with that name. Choose one."; choices = r.places }
                }
            }
            busy = false
        }
    }

    val r = remember(feed, hazard, sort) { HomeModel.render(feed.events.map { it.json }, hazard, sort) }
    val byJson = remember(feed) { feed.events.associateBy { it.json } }
    fun ev(j: kotlinx.serialization.json.JsonObject) = byJson[j] ?: Event(j)
    val list = remember(r) { r.list.map { ev(it) } }
    val loaded = feed.feed != null
    // A failed load is not an empty world: with nothing loaded, the tiles keep "-" and say why (index.html down()).
    val down = feed.failed && !loaded
    val downText = "Live data unavailable. Trying again automatically."
    fun mapSearch() {
        when (val m = MapSearch.search(feed.events.map { it.json }, mapQuery)) {
            null -> {}
            is MapSearch.Found -> selection.select(feed.events[m.index], fly = true)
            is MapSearch.NoMatch -> { selection.nudge = MapNudge.NoMatch(m.title); selection.flyTo = null }
        }
    }

    PndScreen(trust = setOf(TrustGroup.FEED, TrustGroup.MODELS, TrustGroup.PLACE), trustAfterHeader = true, header = {
        item(key = "hero") {
            Column(Modifier.padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Heading("Is a place you care about at risk?")
                Body("Search for any city, town or neighbourhood to see what official agencies are reporting near it right now, and why it matters.", Pnd.textSoft)
                SearchField(query, "Search city, area or address", tag = "placeQuery", imeSearch = { submit() }) { query = it }
                PrimaryButton("Check risk", Modifier.fillMaxWidth().testTag("checkRisk"), enabled = !busy) { submit() }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinePillButton("Use my location", Modifier.testTag("useLocation")) {
                        note = "Asking for your location…"
                        scope.launch {
                            val pos = c.platform.currentLocation(prompt = true)
                            if (pos == null) { note = "Location was not shared, so nothing was checked."; return@launch }
                            val country = c.countries.countryAt(pos.first, pos.second)
                            checked = Place(kind = "My location", name = "Your current location", lat = pos.first, lon = pos.second, country = country ?: "", countryCode = "")
                            note = if (country != null) "Checked at your current position, in $country. Save it to see it here each time you come back."
                            else "Checked at your current position. We could not tell which country it is in, so forecasts that cover a whole country are not included. Search for the place by name to include them."
                        }
                    }
                    saved.take(4).forEach { p -> OutlinePillButton("${p.kind} · ${p.name}") { checked = p; note = "" } }
                }
            }
        }
    }) {
        item(key = "note") {
            if (note.isNotEmpty()) Text(note, color = Pnd.textSoft, style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(bottom = 8.dp).testTag("checkNote").semantics { liveRegion = LiveRegionMode.Polite })
        }
        if (choices.isNotEmpty()) item(key = "choices") { PlaceChooser(choices) { choices = emptyList(); note = ""; checked = it } }
        checked?.let { p -> item(key = "answer") { PlaceAnswerCard(p, feed.events, feed.feed?.generatedAt, onNote = { note = it }) } }

        item(key = "kpis") {
            Panel("Around the world now", subtitle = "What our sources are reporting right now.") {
                val pending = feed.loading && !loaded && !feed.failed
                fun sub(t: String) = if (down) "Live data unavailable" else t
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kpi(if (loaded) r.kEvents else "-", "Live events", sub(if (loaded) r.kEventsNote else "From all our sources"), pending) { env.navigate("/events") }
                    Kpi(if (loaded) r.kWarnings else "-", "Official warnings", sub(HOME_WARNINGS_NOTE), pending, hint = Portal.WARNING_MEANING) { env.navigate("/official-warnings") }
                    Kpi(if (loaded) r.kForecasts else "-", "Open forecasts", sub(if (loaded) r.kForecastsNote else "Our own estimates"), pending) { env.navigate("/forecast-list") }
                    Kpi(if (loaded) r.kCountries else "-", "Countries", sub("Named in live reports"), pending) { env.navigate("/regions") }
                    Column(Modifier.widthIn(min = 150.dp).weight(1f).clip(RoundedCornerShape(10.dp)).background(Pnd.kpi).border(1.dp, Pnd.kpiBorder, RoundedCornerShape(10.dp)).padding(12.dp)) {
                        Text("“Prepared communities save lives.”", color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text("Data for a safer, more resilient world.", color = Color(0xFF87AA9B), fontSize = 12.sp)
                    }
                }
            }
        }
        item(key = "utility") {
            Panel("Keep watch over the places that matter to you", subtitle = "Save your places, see dangers near them, follow official advice and see how our forecasts turned out.") {
                UtilityButton("⌖ My places", "Save your home, office, family or travel places and see the dangers near them.") { env.navigate("/personal-risk") }
                UtilityButton("! What should I do now?", "Open a live event to see how serious it is, what is known and where to get help.") { env.navigate("/events") }
                UtilityButton("◉ Forecasts", "See what may happen next, and tell official warnings apart from our own estimates.") { env.navigate("/forecasts") }
                UtilityButton("✓ Track record", "See how our past forecasts turned out.") { env.navigate("/accuracy") }
            }
        }
        item(key = "explore") {
            Panel("Explore") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinePillButton("◎ Whole world") { env.navigate("/regions/World") }
                    listOf("Asia", "Africa", "North America", "South America", "Europe", "Oceania").forEach { r -> OutlinePillButton("◆ $r") { env.navigate("/regions/" + Format.enc(r)) } }
                }
                Label("Tools")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("My places" to "/personal-risk", "Risk map" to "/live-map", "Alerts and notifications" to "/alerts-notifications", "Forecast calendar" to "/forecast-calendar",
                        "Past events" to "/historical-events", "Compare places" to "/compare-locations", "Safety guides" to "/resources").forEach { (l, u) -> OutlinePillButton(l) { env.navigate(u) } }
                }
            }
        }
        item(key = "map") {
            Panel("Live map") {
                Toolbar {
                    SearchField(mapQuery, "Search location", Modifier.widthIn(min = 200.dp), tag = "mapSearch", imeSearch = { mapSearch() }) { mapQuery = it }
                    // Filled from the live records, with counts; matched by hazardKey (changelog C2, C8).
                    Select("Filter the map by hazard type", HomeModel.hazardOptions(feed.events.map { it.json }, hazard), hazard, tag = "homeHazard") { hazard = it }
                }
                RiskMap(list, height = 260.dp, selection = selection) { env.navigate(Format.eventUrl(it.json)) }
            }
        }
        item(key = "top5") {
            Panel(HOME_LIVE_EVENTS, trailing = { LinkButton("View All →") { env.navigate("/events") } }) {
                // This card's own sort orders it; it lists reports only (changelog C7).
                Select("Sort results", HomeModel.SORT_KEYS.map { it to Sorts.label(it) }, sort, tag = "sort:home") { sort = it; c.settings.setSort("home_sortBy", it) }
                val top = r.liveEvents.map { ev(it) }
                if (down) UnavailableCard()
                else if (top.isEmpty()) EmptyText(if (!loaded) "Loading the latest data…" else "No live events match.")
                top.forEachIndexed { i, e ->
                    CardBox(Modifier.onFocusChanged { if (it.isFocused) selection.select(e, fly = true) }.testTag("live:${e.id}"), onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "Open ${e.displayTitle}",
                        accent = if ((selection.nudge as? MapNudge.Selected)?.e?.id == e.id) Pnd.green else null) {
                        Row(verticalAlignment = Alignment.Top) {
                            Text("${i + 1}", color = Pnd.greenText, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 10.dp))
                            Column {
                                Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Muted("${e.type} · ${Format.placeOf(e.json, "Global")}")
                                Muted("Updated ${Format.fmtDate(e.updated)}")
                            }
                        }
                    }
                }
            }
        }
        item(key = "strip") {
            Panel("Live events by type", trailing = { LinkButton("View All →") { env.navigate("/hazard-types") } }) {
                if (down) Muted(downText)
                // Reports only, grouped by hazardKey, every reported hazard shown (changelog C13).
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    r.hazardStrip.forEach { chip ->
                        CardBox(Modifier.widthIn(min = 150.dp, max = 220.dp).testTag("hazChip:${chip.hazard}"), onClick = { env.navigate(chip.link) },
                            label = "Open ${chip.hazard}" + if (chip.observedOnly) ". Observed only - no agency forecasts the onset of this hazard" else "") {
                            Text("${chip.icon} ${chip.hazard}", color = Pnd.text, fontWeight = FontWeight.Bold)
                            Muted(chip.text)
                        }
                    }
                }
            }
        }
        item(key = "fcTable") {
            Panel("Latest forecasts", trailing = { LinkButton("View All →") { env.navigate("/forecast-list") } }) {
                if (down) EmptyText(downText)
                else if (r.latestForecasts.isEmpty()) EmptyText(if (loaded) HomeModel.NO_FORECASTS else "Loading forecasts…")
                r.latestForecasts.forEach { j ->
                    val row = HomeModel.forecastRow(j)
                    TableRow(listOf("Starts" to row[0], "Location" to row[1], "Hazard" to row[2]), ev(j)) { env.navigate(Format.eventUrl(j)) }
                }
            }
        }
        item(key = "latest") {
            Panel("Latest events", trailing = { LinkButton("View All →") { env.navigate("/recent-events") } }) {
                if (down) EmptyText(downText)
                // The 5 newest reports, whatever the card's sort (changelog C7).
                r.latestEvents.forEach { j ->
                    val row = HomeModel.latestEventRow(j)
                    TableRow(listOf("Time" to row[0], "Location" to row[1], "Event" to row[2], "Source" to row[3]), null) { env.navigate(Format.eventUrl(j)) }
                }
            }
        }
        item(key = "warnings") {
            Panel("Official Warnings", trailing = { LinkButton("View All →") { env.navigate("/official-warnings") } }) {
                // Warnings in force (PND.officialWarnings), most serious first (changelog C3).
                if (down) EmptyText(downText)
                else if (r.officialWarnings.isEmpty() && loaded) EmptyText(HomeModel.NO_WARNINGS)
                r.officialWarnings.forEach { j ->
                    val row = HomeModel.warningRow(j)
                    TableRow(listOf("Agency" to row[0], "Location" to row[1], "Warning" to ev(j).displayTitle, "Ends" to row[3]), null) { env.navigate(Format.eventUrl(j)) }
                }
            }
        }
        item(key = "teaser") {
            Panel("Track record", trailing = { LinkButton("View All →") { env.navigate("/accuracy") } }) {
                CardBox(onClick = { env.navigate("/forecasts/ND-001") }) {
                    Text("ND-001 · Central Vietnam: flash floods and landslides", color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted("Covered 13 to 16 Sep 2026. Written after that period began, so it is a test case, not an advance forecast.")
                    Pill("Partly correct", Pnd.warnBorder, Pnd.warnText)
                }
                CardBox(onClick = { env.navigate("/accuracy") }) { Text("What we check", color = Pnd.text, fontWeight = FontWeight.Bold); Muted("Timing · Place · Cause · Severity · Official reports") }
                CardBox(onClick = { env.navigate("/forecasts/ND-001") }) {
                    Text("How we check forecasts", color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted("A forecast counts as correct only if real damage or impacts matched what it said, in the place and period it named.")
                    Text("See details →", color = Pnd.link)
                }
            }
        }
        item(key = "foot") { Muted("Our forecasts help you stay aware and prepared. They do not replace official government warnings.", Modifier.padding(vertical = 8.dp)) }
    }
}

@Composable
private fun Kpi(value: String, label: String, delta: String, pending: Boolean, hint: String? = null, onClick: () -> Unit) {
    Column(
        Modifier.widthIn(min = 150.dp).heightIn(min = 78.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.kpi).border(1.dp, Pnd.kpiBorder, RoundedCornerShape(10.dp))
            .clickable(role = Role.Button, onClickLabel = "Open $label") { onClick() }.padding(horizontal = 13.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { if (hint != null) stateDescription = hint }.testTag("kpi:$label"),
    ) {
        Text(if (pending) "…" else value, color = Pnd.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Pnd.text, fontSize = 12.sp)
        Text(delta, color = Color(0xFF87AA9B), fontSize = 12.sp, modifier = Modifier.testTag("kpiNote:$label"))
    }
}

@Composable
private fun UtilityButton(title: String, text: String, onClick: () -> Unit) = CardBox(onClick = onClick, label = title) {
    Text(title, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp); Muted(text)
}

/** A table row folded into a card on a phone: LABEL on the left, value beside it. */
@Composable
fun TableRow(cells: List<Pair<String, String>>, badge: Event?, onClick: (() -> Unit)?) {
    CardBox(onClick = onClick) {
        cells.forEach { (k, v) -> LabelValue(k) { Text(v, color = Pnd.body, style = MaterialTheme.typography.bodySmall) } }
        if (badge != null) LabelValue("Risk") { RecordBadge(badge.json) }
    }
}

/** "Which place do you mean?" (`.placechoices`). */
@Composable
fun PlaceChooser(list: List<Place>, onPick: (Place) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).testTag("placeChooser"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Which place do you mean?", color = Color(0xFFD9EFE6), fontWeight = FontWeight.Bold, fontSize = 14.sp)
        list.forEach { p ->
            Column(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.panelTop).border(1.dp, Pnd.panelBorder, RoundedCornerShape(10.dp))
                    .clickable(role = Role.Button, onClickLabel = "Choose ${p.name}") { onPick(p) }.padding(horizontal = 12.dp, vertical = 9.dp).testTag("choice:${p.name}|${p.level}"),
            ) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(p.name, color = Color(0xFFEAFFF6), fontWeight = FontWeight.Bold)
                    Pill(p.level, Pnd.levelChip, Pnd.levelChipText, upper = false)
                }
                if (p.full.isNotEmpty() && p.full != p.name) Text(p.full, color = Color(0xFF9DB9AD), fontSize = 12.sp)
            }
        }
    }
}

/** The place answer (`answer()` in index.html). */
@Composable
fun PlaceAnswerCard(place: Place, events: List<Event>, generatedAt: String?, onNote: (String) -> Unit) {
    val env = LocalApp.current
    val c = env.container
    val scope = rememberCoroutineScope()
    val a = remember(place, events) { PlaceRisk.assess(place.json(), events.map { it.json }, generatedAt) }
    val act = remember(a) { PlaceRisk.actionsFor(a) }
    val lead = a.lead?.e?.let { Event(it) }
    Column(
        Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(12.dp)).background(Pnd.panelTop).border(1.dp, Pnd.panelBorder, RoundedCornerShape(12.dp)).padding(14.dp).testTag("placeResult"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Eyebrow("Current risk", Pnd.label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (a.level != null) RiskBadge(a.level, a.level.label, "Current risk: ${a.level.label}") else NothingNearbyChip()
            Text(place.name, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
        Block("What's happening") {
            if (lead != null) {
                Text(lead.displayTitle, color = Pnd.body, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                val pl = Format.placeOf(lead.json)
                Text("${lead.type.ifEmpty { "Hazard" }}" + (if (pl.isNotEmpty()) " · $pl" else "") + " · reported ${Format.age(lead.updated)}", color = Pnd.body, fontSize = 14.sp)
            } else Text("None of our sources reports anything at this place right now.", color = Pnd.body, fontSize = 14.sp)
        }
        Block("Why we're showing this") { Text(a.why, color = Pnd.body, fontSize = 14.sp, modifier = Modifier.testTag("placeWhy")) }
        Block("What should I do?") {
            act.steps.forEach { Text("• $it", color = Pnd.body, fontSize = 14.sp) }
            Text(act.authority, color = Pnd.authority, fontSize = 14.sp)
        }
        Block("Source") {
            Text(if (lead != null) "${Format.provenance(lead.json)} · ${lead.source.ifEmpty { "Source not stated" }}" else "No report was used for this answer.", color = Pnd.body, fontSize = 14.sp)
            if (lead != null && lead.sourceUrl.isNotEmpty()) LinkButton("Open the original report →") { c.platform.openUrl(com.anchittandon.pnd.data.Api.absolute(lead.sourceUrl)) }
        }
        Block("Last checked") { Text(if (generatedAt != null) Format.fmtDate(generatedAt) + " · " + Format.age(generatedAt) else "not yet: the data is still loading", color = Pnd.body, fontSize = 14.sp) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton("Save place", Modifier.testTag("savePlace")) {
                c.settings.addPlace(place.copy(kind = place.kind.takeIf { it != "Searched" } ?: "Place", full = "", level = ""), AppClock.now())
                onNote("Saved. You can find it on the My places page.")
            }
            SecondaryButton("Alert me if this changes") {
                if (c.settings.places.none { it.lat == place.lat && it.lon == place.lon }) {
                    c.settings.addPlace(place.copy(kind = if (place.kind == "My location") "Current location" else place.kind.takeIf { it != "Searched" } ?: "Place", full = "", level = ""), AppClock.now())
                }
                scope.launch {
                    val ok = c.platform.requestNotifications()
                    if (ok) { c.settings.alertsEnabled = true; c.platform.scheduleBackgroundChecks(true) }
                    onNote(if (ok) "Saved, and alerts are on. This phone checks for dangers near your saved places about once an hour, even when the app is closed. You can manage alerts on the My places page."
                    else "Notifications were not allowed, so nothing will be sent.")
                }
            }
            SecondaryButton("See details") { env.navigate(lead?.let { Format.eventUrl(it.json) } ?: "/personal-risk") }
        }
    }
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title.uppercase(), color = Pnd.label, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
        content()
    }
}

@Suppress("unused") private fun unusedDate() = JsDate
