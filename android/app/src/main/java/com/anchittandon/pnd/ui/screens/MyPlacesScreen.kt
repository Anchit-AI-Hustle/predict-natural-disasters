@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.PlaceSearchRepository
import com.anchittandon.pnd.logic.AlertRules
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.PlaceForm
import com.anchittandon.pnd.logic.PlaceAnswer
import com.anchittandon.pnd.logic.Place
import com.anchittandon.pnd.logic.PlaceRisk
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.TrustGroup
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** The background-alert status and the switch (features.md §5.1, §16; native WorkManager checks). */
object AlertCopy {
    const val KEEPS = "Your places stay on this phone. They are never sent to us or to anyone else: the phone downloads the public feed and checks it against your places itself."
    fun rules(near: Int, severe: Int) = "You get an alert when a saved place is inside an official warning area or a reported affected area, or when a danger is reported within $near km of it ($severe km if it is severe). We never send alerts for our own forecasts."
    fun status(on: Boolean, allowed: Boolean, places: Int, lastCheck: String?): String = when {
        on && allowed -> "Alerts are on for $places place" + (if (places == 1) "" else "s") + " on this device. This phone checks about once an hour, even when the app is closed, whenever it has a network connection and enough battery. " +
            (if (lastCheck == null) "Alerts have not been checked yet." else "Last checked ${Format.age(lastCheck)}" + (if ((JsDate.parse(lastCheck) ?: 0L) < AppClock.now() - 4 * 3_600_000L) ". That is later than planned, so an alert may be late." else "."))
        on && !allowed -> "Notifications are turned off for this app in your phone’s settings, so no alert can be shown. Turn them on in Settings to get alerts."
        else -> "Get an alert on this device when a danger is reported at or near your saved places. This phone checks about once an hour, even when the app is closed. For warnings that reach you anywhere, also sign up with your national or regional disaster agency."
    }
}

@Composable
fun MyPlacesScreen() {
    val env = LocalApp.current
    val c = env.container
    val feed by c.feed.state.collectAsState()
    val values by c.settings.values.collectAsState()
    val places = remember(values) { c.settings.places }
    val scope = rememberCoroutineScope()
    var kind by rememberSaveable { mutableStateOf("Home") }
    var name by rememberSaveable { mutableStateOf("") }
    var lat by rememberSaveable { mutableStateOf("") }
    var lon by rememberSaveable { mutableStateOf("") }
    var foundCountry by rememberSaveable { mutableStateOf("") }
    var foundCode by rememberSaveable { mutableStateOf("") }
    // What the search itself filled ("name|lat|lon"), so only the reader's own edit clears the country (changelog C23).
    var chosenAs by rememberSaveable { mutableStateOf("") }
    var result by rememberSaveable { mutableStateOf("Search for the place by name, then choose the right match. You can also type the latitude and longitude yourself.") }
    var choices by remember { mutableStateOf<List<Place>>(emptyList()) }
    var locStatus by rememberSaveable { mutableStateOf("") }
    var rules by remember { mutableStateOf(30 to 100) }
    val (sort, setSort) = rememberSort("personal-risk_sortBy", Sorts.MY_PLACES)
    val alertsOn = values["pnd_alerts_on"] == "1"
    val allowed = c.platform.notificationsAllowed()

    LaunchedEffect(Unit) {
        c.data.alertsInfo()?.obj("rules")?.let { r -> rules = r.jsNum("nearKm").toInt() to r.jsNum("severeNearKm").toInt() }
    }

    fun edited() {
        if (!PlaceForm.clearsCountry(foundCountry.isNotEmpty() || foundCode.isNotEmpty(), chosenAs, name, lat, lon)) return
        foundCountry = ""; foundCode = ""
        result = "You changed the place, so we no longer know its country. Search for it by name again to record the country."
    }
    fun use(p: Place) {
        lat = com.anchittandon.pnd.model.toFixed(p.lat, 6); lon = com.anchittandon.pnd.model.toFixed(p.lon, 6); name = p.name
        foundCountry = p.country; foundCode = p.countryCode
        chosenAs = PlaceForm.chosenAs(name, lat, lon)
        result = "Chosen: ${p.name} (${p.level.lowercase()}). Choose the kind of place and press Save."
    }

    val events = feed.events
    val rows = remember(places, feed, sort) {
        val r = places.flatMap { p -> events.mapNotNull { e -> Hazards.riskRow(e.json, p.json())?.let { Triple(p, e, it) } } }
        val def = Sorts.SORT_DEFS[sort]
        r.sortedWith { a, b ->
            val da = a.third.distanceKm ?: Double.POSITIVE_INFINITY; val db = b.third.distanceKm ?: Double.POSITIVE_INFINITY
            val first = if (sort == "nearby" || def == null) 0 else def.cmp.compare(a.second.json, b.second.json)
            if (first != 0) first else {
                val fa = if (da.isInfinite()) 1 else 0; val fb = if (db.isInfinite()) 1 else 0
                if (fa != fb) fa - fb else if (fa == 1) 0 else da.compareTo(db)
            }
        }
    }

    PndScreen(trust = setOf(TrustGroup.FEED, TrustGroup.MODELS, TrustGroup.PLACE), feedBanner = false,
        header = { item { ScreenHeader(null, "My places", "Your saved places, and the dangers reported near them.") } }) {
        item(key = "alerts") {
            Panel("Alerts") {
                Body(AlertCopy.status(alertsOn, allowed, places.size, values["pnd_alerts_last"]), modifier = Modifier.testTag("alertsStatus"))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!(alertsOn && !allowed)) SecondaryButton(if (alertsOn) "Turn off alerts" else "Turn on alerts", Modifier.testTag("alertsToggle")) {
                        scope.launch {
                            if (alertsOn) { c.settings.alertsEnabled = false; c.platform.scheduleBackgroundChecks(false) }
                            else {
                                val ok = c.platform.requestNotifications()
                                if (ok) { c.settings.alertsEnabled = true; c.platform.scheduleBackgroundChecks(true) }
                                else locStatus = "Notifications were not allowed, so nothing will be sent."
                            }
                        }
                    }
                    SecondaryButton("Use my current location", Modifier.testTag("useCurrent")) {
                        locStatus = "Finding where this device is…"
                        scope.launch {
                            val pos = c.platform.currentLocation(prompt = true)
                            if (pos == null) { locStatus = "Location was not shared, so nothing was saved."; return@launch }
                            val country = c.countries.countryAt(pos.first, pos.second) ?: ""
                            c.settings.setCurrentLocation(pos.first, pos.second, country, "", JsDate.iso(AppClock.now()))
                            locStatus = "Saved as “Current location”, to the nearest kilometre" + (if (country.isNotEmpty()) " ($country)" else "") + ". It is updated each time you open this app."
                        }
                    }
                }
                if (locStatus.isNotEmpty()) Muted(locStatus, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Label("What we send and what we keep")
                Body(AlertCopy.KEEPS)
                Body(AlertCopy.rules(rules.first, rules.second))
            }
        }
        item(key = "form") {
            Panel("Saved places") {
                Select("Kind of place", listOf("Home", "Office", "Family", "Travel").map { it to it }, kind, tag = "kind") { kind = it }
                SearchField(name, "Place name", tag = "placeName", imeSearch = { scope.launch { find(name, c.placeSearch, { result = it }, { choices = it }, ::use) } }) { name = it; edited() }
                SecondaryButton("Find place", Modifier.testTag("findPlace")) { scope.launch { find(name, c.placeSearch, { result = it }, { choices = it }, ::use) } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { NumberField(lat, "Latitude", "lat") { lat = it; edited() } }
                    Box(Modifier.weight(1f)) { NumberField(lon, "Longitude", "lon") { lon = it; edited() } }
                }
                PrimaryButton("Save", Modifier.testTag("savePlaceForm")) {
                    val la = lat.toDoubleOrNull(); val lo = lon.toDoubleOrNull()
                    if (name.isBlank() || la == null || lo == null || la !in -90.0..90.0 || lo !in -180.0..180.0) {
                        result = "Type a name, a latitude between -90 and 90 and a longitude between -180 and 180, or search for the place."
                    } else {
                        c.settings.addPlace(Place(kind = kind, name = name.trim(), lat = la, lon = lo, country = foundCountry, countryCode = foundCode), AppClock.now())
                        foundCountry = ""; foundCode = ""; name = ""; lat = ""; lon = ""; choices = emptyList()
                        result = "Saved."
                    }
                }
                Muted(result, Modifier.testTag("placeResultNote").semantics { liveRegion = LiveRegionMode.Polite })
                if (choices.isNotEmpty()) PlaceChooser(choices) { choices = emptyList(); use(it) }
            }
        }
        if (places.isEmpty()) item(key = "noPlaces") { EmptyText("No saved places yet. Search for a place above and save it.") }
        items(places, key = { "p" + it.id }) { p ->
            val a = remember(p, feed) { PlaceRisk.assess(p.json(), events.map { it.json }, feed.feed?.generatedAt) }
            Box(Modifier.padding(bottom = 8.dp)) {
                CardBox(Modifier.testTag("saved:${p.name}")) {
                    Text(if (p.kind == p.name) p.kind else "${p.kind} · ${p.name}", color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Muted("${com.anchittandon.pnd.model.jsNumText(p.lat)}, ${com.anchittandon.pnd.model.jsNumText(p.lon)}" + (if (p.country.isNotEmpty()) " · ${p.country}" else " · country unknown") + (p.updatedAt?.let { " · updated ${Format.age(it)}" } ?: ""))
                    // Before the feed loads a saved place is still being checked, or the data is unavailable (C26).
                    val st = PlaceAnswer.feedState(feed.feed != null, feed.failed)
                    Box(Modifier.semantics(mergeDescendants = true) {}.testTag("summary:${p.name}")) { ProvenancePill(if (st == PlaceAnswer.State.LOADED) PlaceRisk.summarise(a) else PlaceAnswer.PENDING.getValue(st).headline.uppercase()) }
                    SecondaryButton("Remove", Modifier.testTag("remove:${p.name}")) { c.settings.removePlace(p.id) }
                }
            }
        }
        item(key = "dangersHead") {
            Column(Modifier.padding(top = 10.dp)) {
                SubHeading("Dangers near your places")
                Muted("Grouped by how sure we can be that each one affects your place. We show a distance only when the report gives the exact spot.")
                Toolbar {
                    SortSelect("personal-risk", Sorts.MY_PLACES, sort, setSort)
                    Muted(feed.feed?.let { "Updated " + Format.age(it.generatedAt) } ?: if (feed.failed) "Live data unavailable" else "Loading…", Modifier.padding(top = 14.dp))
                }
            }
        }
        if (feed.feed == null) {
            // No feed: not a set of empty bands. Loading shows nothing yet; a failed load shows the C19 card.
            // The app's 60 s poll tries again until it loads (personal-risk.html loadFeed).
            if (feed.failed) item(key = "riskErr") {
                Column {
                    UnavailableCard()
                    StaleBox("Do not rely on this page in an emergency. Check with your local authorities.", tag = "placesError")
                }
            }
        } else {
            val wide = events.count { it.isForecastAny && it.json.str("forecastScope") == "country" && it.country.isNotEmpty() }
            val placeless = places.count { it.country.isEmpty() }
            if (wide > 0 && placeless > 0) item(key = "scope") {
                Notice((if (placeless == 1) "1 of your saved places has" else "$placeless of your saved places have") + " no country recorded, so we cannot tell whether " +
                    (if (wide == 1) "1 forecast that covers a whole country applies" else "$wide forecasts that cover a whole country apply") + " to " + (if (placeless == 1) "it" else "them") +
                    ". Search for the place by name instead of typing coordinates, and we can check.")
            }
            Hazards.RISK_BANDS.forEach { b ->
                item(key = "band" + b.key) {
                    Panel(b.title, subtitle = b.blurb, modifier = Modifier.testTag("band:${b.key}")) {
                        val bandRows = rows.filter { it.third.band == b.key }.take(30)
                        if (bandRows.isEmpty()) EmptyText(b.empty)
                        bandRows.forEach { (p, e, r) ->
                            CardBox(onClick = { env.navigate(Format.eventUrl(e.json)) }, label = "Open ${e.displayTitle}") {
                                ProvenancePill(Format.provenance(e.json))
                                Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Muted((if (r.claimDistance && r.distanceKm != null) "${Format.km(r.distanceKm)} km from ${p.name}" else p.name) + " · ${e.type}")
                                if (r.applicability.isNotEmpty()) Muted(r.applicability)
                            }
                        }
                    }
                }
            }
        }
    }
}

private suspend fun find(q0: String, repo: PlaceSearchRepository, say: (String) -> Unit, choose: (List<Place>) -> Unit, use: (Place) -> Unit) {
    val q = q0.trim()
    if (q.isEmpty()) { say("Type a place first."); return }
    say("Finding the place…"); choose(emptyList())
    when (val r = repo.search(q)) {
        is PlaceSearchRepository.Result.Failed -> say("Place search is not working right now. You can type the latitude and longitude instead.")
        is PlaceSearchRepository.Result.Ok -> when (r.places.size) {
            0 -> say("We could not find that place. Check the spelling, or add the city or country, for example “Andheri, Mumbai”.")
            1 -> use(r.places[0])
            else -> { say("We found ${r.places.size} places with that name. Choose one."); choose(r.places) }
        }
    }
}

@Composable
private fun NumberField(value: String, label: String, tag: String, onChange: (String) -> Unit) {
    androidx.compose.material3.OutlinedTextField(value, onChange, Modifier.fillMaxWidth().testTag(tag), label = { Text(label) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(focusedBorderColor = Pnd.green, unfocusedBorderColor = Pnd.inputBorder, focusedContainerColor = Pnd.input, unfocusedContainerColor = Pnd.input,
            focusedTextColor = Pnd.text, unfocusedTextColor = Pnd.text, focusedLabelColor = Pnd.greenText, unfocusedLabelColor = Pnd.muted))
}

@Suppress("unused") private fun unused(o: JsonObject) = o.truthy("x") || AlertRules.NEAR_KM > 0 || Event(o).id.isEmpty()
