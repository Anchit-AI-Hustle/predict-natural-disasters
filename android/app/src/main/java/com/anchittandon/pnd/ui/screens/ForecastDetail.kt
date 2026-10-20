@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private data class Mechanism(val t: String, val d: String, val x: String)

/** forecast-detail.html HAZARD: how each hazard develops. */
private val HAZARD = mapOf(
    "Flood" to Mechanism("rain falling faster than the ground and drains can take it", "Water collects in channels and low ground. Rivers can keep rising downstream long after the rain stops. That is why floods often reach places the storm itself never crossed.", "Low-lying towns and villages, river and canal banks, roads built across flood plains, and drains that back up once the channels are full."),
    "Flood / Landslide" to Mechanism("long, steady rain on slopes that are already soaked", "Water fills the soil until the slope can no longer hold its own weight. So floods in the valleys and landslides on the slopes above often come together, within hours of each other.", "Homes on hillsides and the roads below them, valley floors, and the roads in and out that a single landslide can block."),
    "Landslide" to Mechanism("soaked ground on unstable slopes", "Once the soil can no longer hold its weight, the slope gives way. This usually happens at its steepest and wettest point. The debris often travels further than the scar on the slope suggests.", "Anything below the slope: homes, roads, and the single roads that many mountain communities rely on."),
    "Earthquake" to Mechanism("a break along a fault that has already moved", "Shaking spreads outward and is felt far from where the earthquake started. Soft ground and weakly built buildings make it worse.", "Older brick and stone buildings, buildings without steel reinforcement, and slopes loosened by the main earthquake."),
    "Earthquake aftershock sequence" to Mechanism("the main earthquake already recorded at this location", "Aftershocks become less frequent over days to weeks. The largest is usually about 1 magnitude smaller than the main earthquake. They are not new, separate earthquakes. This describes a series of aftershocks that has already started.", "Buildings the main earthquake already weakened. They can collapse under much milder shaking than the shaking that first damaged them."),
    "Tropical Cyclone" to Mechanism("a cyclone that the agency is already tracking", "Wind, storm surge and rain arrive at different times and reach different distances. Storm surge follows the coast. Rain can flood rivers far inland.", "Coastal towns and the low ground behind them, ports and boats, and inland river areas that flood after the wind has passed."),
    "Severe Storm" to Mechanism("stormy weather that the agency has already flagged", "It brings strong wind, hail and heavy rain over a short time. Streets can flood where drains cannot keep up.", "Exposed buildings, power lines, transport, and low ground that floods quickly."),
    "Tornado" to Mechanism("conditions the agency judged could produce a tornado", "A tornado is a narrow, fast-moving path of extreme wind. A tornado watch means conditions are right for one. It does not mean anyone has seen one.", "Anything in its path. But the path is narrow, and no one can say in advance where it will be."),
    "Wildfire" to Mechanism("a fire already spotted by satellite", "How a fire spreads depends on what can burn, the wind and the slope. Fire moves fastest uphill and with the wind behind it.", "Homes at the edge of forest and grassland, places with only one road in or out, and the air far downwind of the fire."),
    "Volcano" to Mechanism("activity at the volcano already reported by its observatory", "Ash travels with the wind, while flows of lava, rock and mud follow the valleys. So one eruption can threaten quite different areas.", "Communities in the valleys below the volcano, flight routes, and water supplies under the ash cloud."),
    "Drought" to Mechanism("a lack of rain that has built up over past seasons", "Drought builds and eases slowly. Its effects on water supply, crops and livestock can come months after the rain failed.", "Farms that rely on rain, herders, and communities whose water sources are shallow or already low."),
    "Special Marine Warning" to Mechanism("a short-lived danger at sea that the weather service has already warned about", "It brings sudden strong winds, waterspouts or squalls over water. These usually last less than 2 hours and move quickly.", "Small boats, anyone on open water, and exposed harbours and moorings."),
    "Extreme Heat" to Mechanism("a spell of heat already forecast by the weather agency", "The risk grows over several hot days in a row, and when nights stay warm. Warm nights stop the body recovering between hot days.", "Outdoor workers, older people, anyone without a way to keep cool, and built-up areas that stay hot overnight."),
)
private val DEFAULT_MECH = Mechanism("a hazard already reported by an official source", "How this develops depends on the hazard and the ground it crosses. This forecast follows the agency’s report. We do not model the hazard ourselves.", "People, transport, and services such as power and water inside the stated area.")

private fun placeName(e: JsonObject) = if (e.truthy("country")) e.text("country") else if (e.truthy("region")) "the area covered by ${e.text("region")}" else "the forecast area"
private fun dayOf(iso: String?, other: String?, role: String?) = if (JsDate.parse(iso) == null) null else Format.fmtWhen(iso, other, role).replace(Regex(",[^,]*$"), "")
private fun rangeText(e: JsonObject): String {
    val a = dayOf(e.str("targetStart"), e.str("targetEnd"), null); val b = dayOf(e.str("targetEnd"), e.str("targetStart"), "end")
    if (a != null && b != null) return if (a == b) a else "$a and $b"
    return a ?: b ?: "the stated dates"
}
private fun spanText(e: JsonObject): String {
    val a = dayOf(e.str("targetStart"), e.str("targetEnd"), null); val b = dayOf(e.str("targetEnd"), e.str("targetStart"), "end")
    if (a == null || b == null) return "the stated dates"
    val days = maxOf(1L, jsRoundL(((JsDate.parse(e.str("targetEnd")) ?: 0L) - (JsDate.parse(e.str("targetStart")) ?: 0L)) / 86_400_000.0))
    return if (a == b) a else "$a to $b ($days day" + (if (days == 1L) "" else "s") + ")"
}

/** Forecast detail (features.md §7.4). */
@Composable
fun ForecastDetailScreen(id: String) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    val inFeed = Format.findEvent(feed.all, id) { it.json }
    var ledger by remember(id) { mutableStateOf<JsonObject?>(null) }
    var ledgerTried by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id, feed.feed != null, inFeed == null) {
        if (feed.feed != null && inFeed == null && !ledgerTried) { ledger = env.container.data.ledgerRow(id); ledgerTried = true }
    }
    val (sort, setSort) = rememberSort("forecast_sortBy", Sorts.NEARBY)
    PndScreen(feedBanner = false) {
        if (waiting(feed, "")) return@PndScreen
        if (feed.failed) item(key = "stale") { StaleBox("Live data unavailable. Trying again automatically.", tag = "detailError") }
        val e: Event = inFeed ?: ledger?.let { Event(JsonObject(LinkedHashMap<String, kotlinx.serialization.json.JsonElement>().apply { put("forecast", JsonPrimitive(true)); putAll(it) })) } ?: run {
            if (!ledgerTried) item(key = "ledgerWait") { Body("Looking for this forecast in our record of past forecasts…") }
            else item(key = "nf") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Heading("Forecast not found", Modifier.testTag("notFound"))
                    Body("We cannot find this forecast in our current data or in our record of past forecasts. Check the link, or go to the forecasts list.", Pnd.textSoft)
                    OutlinePillButton("Our forecasts") { env.navigate("/forecast-list") }
                }
            }
            return@PndScreen
        }
        val j = e.json
        val frozenAt = if (inFeed == null) j.text("recordedAt").ifEmpty { j.text("freezeTimestamp") } else ""
        val now = AppClock.now()
        val ended = (JsDate.parse(j.text("targetEnd")) ?: Long.MAX_VALUE) < now
        item(key = "top") { DetailTop("FORECAST DETAILS", Format.titleOf(j), "${e.type} · ${Format.placeOf(j, "Global")}", "/forecasts/" + Format.enc(e.id)) }
        val quiet = if (frozenAt.isNotEmpty()) "This forecast is no longer being published. It is shown exactly as it was recorded on ${Format.fmtDate(frozenAt)}." else Format.quietNote(j)
        if (quiet.isNotEmpty()) item(key = "quiet") { StaleBox(quiet, tag = "quietNote") }
        item(key = "provenance") { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 8.dp)) { ProvenancePill(Format.provenance(j)); Pill("Our forecast, not official") } }
        item(key = "factors") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                Column(Modifier.widthIn(min = 140.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.metric).border(1.dp, Pnd.metricBorder, RoundedCornerShape(10.dp)).padding(10.dp)) { Label("Risk"); RecordBadge(j) }
                Figure("Location", Format.placeOf(j, "-")); Figure("Last updated", Format.age(e.updated))
                Figure("Status", if (ended) "Ended, not yet checked" else "Active")
            }
        }
        val all = feed.all
        val src = j.str("forecastOf")?.let { fo -> Format.findEvent(all, fo) { it.json } }
        item(key = "forecast") {
            Panel("The forecast") {
                KeyFactsGrid(j)
                val leadH = Hazards.leadTimeHours(j)
                KvList(listOf(
                    "Hazard" to e.type.ifEmpty { "-" }, "Place" to listOf(e.region, e.country).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "-" },
                    "Description" to e.details.ifEmpty { "-" }, "Last updated" to Format.fmtDate(e.updated),
                    "Forecast period" to (if (j.truthy("targetStart")) Format.windowText(j) else "No start date recorded"),
                    "Kind of forecast" to (mapOf("frozen-benchmark" to "Test case, locked but not made in advance", "signal-derived-outlook" to "Short-term forecast based on an official report",
                        "aftershock-sequence" to "Aftershock forecast")[j.text("forecastKind")] ?: (if (e.forecast) "Our own estimate" else "Reported event")),
                    "Severity" to (if (j.truthy("severity")) j.text("severity") + (if (j.truthy("severityRank")) " (level ${com.anchittandon.pnd.model.jsNumText(j.jsNum("severityRank"))} of 5)" else "") else "Not assessed"),
                    "Advance notice" to (if (leadH == null) "-" else if (leadH <= 0) "None. The forecast period had already started when we made this." else if (leadH < 48) jsRoundL(leadH).let { "$it " + (if (it == 1L) "hour" else "hours") + " before the forecast period" } else "${jsRoundL(leadH / 24)} days before the forecast period"),
                    "Confidence" to j.text("confidence").ifEmpty { "Not stated for this forecast" },
                    "Evidence behind this forecast" to j.text("evidence").ifEmpty { "Made from the current official report named as its source." },
                    "How it will be checked" to j.text("verificationRule").ifEmpty { "Checked against damage or harm that others report inside the stated area and dates." },
                    "Forecast ID" to e.id,
                ))
            }
        }
        item(key = "hazdef") {
            val hz = Hazards.hazardOf(e.type)
            val hrs = Hazards.horizonHours(e.type)
            Panel("What counts as " + hz.name.lowercase()) {
                Body(hz.definition)
                KvList(listOf("How it starts" to (when (hz.onset) { "sudden" -> "Suddenly, with little or no warning"; "slow" -> "Slowly, over weeks to months"; else -> "Quickly, over hours to days" }),
                    "How long it lasts" to hz.duration, "How much warning there is" to hz.leadTime, "How severity is judged" to hz.severityBasis,
                    "Why this forecast period" to (if (hrs >= 168) "${jsRoundL(hrs / 24.0)} days" else "$hrs hours") + ". We set this from how this hazard develops. Each hazard has its own forecast period."))
            }
        }
        item(key = "how") {
            val m = HAZARD[e.type] ?: DEFAULT_MECH
            val place = placeName(j)
            val report = src?.let { s -> "the ${s.source} ${s.type.lowercase()} report for ${Format.placeOf(s.json, place)}" + (if (s.alert.isNotEmpty()) ", at alert level ${s.alert}" else "") + ", last updated ${Format.fmtDate(s.updated)}" }
            val agency = Regex("derived from\\s+(.+)$", RegexOption.IGNORE_CASE).find(e.source)?.groupValues?.get(1) ?: e.source.ifEmpty { "an official source" }
            val trigger = if (j.str("forecastKind") == "frozen-benchmark") "This is our test case. We locked it while the outcome was still unknown, so we can check it afterwards without the benefit of hindsight. But we wrote it after its forecast period had already started, so it did not predict the start. The cause it describes is ${m.t}."
            else if (report != null) "We did not make this forecast on our own. It follows $report. The cause behind it is ${m.t}. It is not a prediction made before that report. It says what may follow while the report stays current."
            else "This forecast follows a report from $agency that is no longer in our current data. The cause behind it is ${m.t}."
            val verification = if (j.str("forecastKind") == "model-advance" && j.truthy("verificationRule")) "${j.text("verificationRule")} The result is shown on the track record page."
            else "We will check it only against what others report in $place between ${rangeText(j)}. Rain, or a warning from another agency, does not make this forecast correct on its own. Damage or harm must be reported inside that area and during those dates."
            Panel("How this forecast works") {
                Step("1. What started this", trigger)
                Step("2. How it could develop", m.d)
                Step("3. Who and what is at risk", "In $place: " + m.x.replaceFirstChar { it.lowercase() })
                Step("4. How it will be checked", verification)
            }
        }
        val close = Sorts.sort(withDistance(nearby(e, all, 1000.0) { it.official }), sort) { it.json }.take(9)
        item(key = "matrix") {
            val fam = { t: String -> if (Regex("aftershock|earthquake", RegexOption.IGNORE_CASE).containsMatchIn(t)) "earthquake" else t.lowercase().split(Regex("\\s*/\\s*"))[0] }
            val from = JsDate.parse(j.text("targetStart")) ?: 0L
            val match = close.filter { !it.forecast && it.id != j.text("forecastOf") && fam(it.type) == fam(e.type) && ((JsDate.parse(it.json.text("startedAt").ifEmpty { it.updated }) ?: 0L) >= from) }
            Panel("What we will check", subtitle = "Each line is one thing we check this forecast against. Each stays open until the forecast period ends. None of them says that the event happened.",
                trailing = { LinkButton("How we check forecasts →") { env.navigate("/verification") } }) {
                Check("Inside the locked forecast period", if (ended) "Ended" else "Open",
                    if (ended) "The forecast period ran to ${dayOf(j.str("targetEnd"), j.str("targetStart"), "end") ?: "its end"} and has ended. It is now waiting to be checked." else "Runs ${spanText(j)}. It stays open until the end of that period, whatever happens before then.")
                Check("Inside the forecast area", if (ended) "Ended" else "Open", "Set to ${placeName(j)} when we made the forecast, and never widened. Damage just outside it does not count.")
                Check("Hazard reported", if (match.isNotEmpty()) "${match.size} reported" else "None yet",
                    if (match.isNotEmpty()) "${match.size} official ${e.type.lowercase()} report" + (if (match.size == 1) "" else "s") + " within 1,000 km of this forecast. This shows the hazard is there. It does not show that it caused damage."
                    else "No official ${e.type.lowercase()} report within 1,000 km yet. This will change as soon as one of our sources reports one.")
                Check("Serious harm to people or places", "Not assumed", "We never predict deaths, injuries or damage, so we do not assume any. We fill this in only from what others report.")
                Check("Official reports nearby", if (close.isNotEmpty()) "${close.size} nearby report" + (if (close.size == 1) "" else "s") else "None right now",
                    if (close.isNotEmpty()) "${close.size} official report" + (if (close.size == 1) "" else "s") + " from our sources near this area, for any kind of hazard." else "No official reports near this area right now.")
            }
        }
        item(key = "map") {
            Panel("Forecast area map", trailing = { LinkButton("Live map →") { env.navigate("/live-map") } }) {
                RiskMap(listOf(e), height = 240.dp, center = e.lat?.let { it to e.lon!! }, zoom = 5.0, circle = e.lat?.let { MapCircle(it, e.lon!!, 250.0, Pnd.amber, 0.08f) }) { }
            }
        }
        item(key = "means") {
            Panel("What this forecast means") {
                Body(if (j.str("forecastKind") == "frozen-benchmark") "This forecast is a claim about what will happen. It was locked when it was made. We check it afterwards against the damage or harm that is reported."
                else "This forecast follows an official report that was already out when we made it. It says the danger in that report will keep causing harm during the forecast period. It does not claim to have predicted the event before it started.")
                Hazards.leadTimeText(j).takeIf { it.isNotEmpty() }?.let { Body(it) }
                j.text("verificationRule").takeIf { it.isNotEmpty() }?.let { Body(it) }
                Body("In an emergency, follow your national and local authorities.")
            }
        }
        item(key = "nearbyReports") {
            Panel("Official reports near the forecast area", subtitle = "${close.size} official report" + (if (close.size == 1) "" else "s") + " nearby") {
                SortSelect("forecast", Sorts.NEARBY, sort, setSort)
                if (close.isEmpty()) EmptyText("No official reports near this area right now.")
                close.forEach { x ->
                    CardBox(onClick = { env.navigate(Format.eventUrl(x.json)) }, label = "Open ${x.displayTitle}") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RecordBadge(x.json); SourcePill(x) }
                        Text(x.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold)
                        Muted("${jsRoundL(x.distance)} km · ${x.type}"); Muted(Format.fmtDate(x.updated))
                    }
                }
            }
        }
        enrichmentBlock(j)
    }
}

@Composable
private fun Check(title: String, state: String, why: String) = CardBox {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text(title, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp); Pill(state, upper = false) }
    Muted(why)
}
