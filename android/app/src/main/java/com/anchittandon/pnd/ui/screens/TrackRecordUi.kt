@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.TrackRecordRepository
import com.anchittandon.pnd.logic.Backtest
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Level
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.Sorts
import com.anchittandon.pnd.logic.TrackRecord
import com.anchittandon.pnd.logic.Verdicts
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.PndScreen
import com.anchittandon.pnd.ui.TrustGroup
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd

@Composable
fun VerdictPill(state: String, text: String = Verdicts.LABELS[state] ?: state) {
    val (b, t) = verdictColors(state)
    Pill(text, b, t, upper = false)
}

/** A severity word as a badge on the one risk scale; nothing recorded stays unrated. */
@Composable
fun SeverityBadge(v: String?, blank: String) {
    if (v.isNullOrEmpty()) RiskBadge(Level.UNKNOWN, blank) else {
        val s = v.substring(0, 1).uppercase() + v.substring(1).lowercase()
        RiskBadge(RiskScale.levelOf(v), s)
    }
}

@Composable
fun Disclosure(title: String, tag: String? = null, content: @Composable () -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(false) }
    Panel(null) {
        Text((if (open) "▾ " else "▸ ") + title, color = Pnd.greenText, fontWeight = FontWeight.Bold, fontSize = 15.sp,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { open = !open }.padding(vertical = 12.dp)
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }.let { if (tag != null) it.testTag(tag) else it })
        if (open) content()
    }
}

/** Track record (features.md §6): the site's own grading, run on device. */
@Composable
fun TrackRecordUi() {
    val env = LocalApp.current
    val repo = env.container.trackRecord
    val st by repo.state.collectAsState()
    LaunchedEffect(Unit) { repo.load() }
    var q by rememberSaveable { mutableStateOf("") }
    var outcome by rememberSaveable { mutableStateOf("") }
    var severity by rememberSaveable { mutableStateOf("") }
    val (sort, setSort) = rememberSort("accuracy_sortBy", Sorts.LEDGER)
    var shown by rememberSaveable { mutableStateOf(25) }
    val ready = st as? TrackRecordRepository.State.Ready
    val s = ready?.screen
    PndScreen(trust = setOf(TrustGroup.LEDGER), trustAfterHeader = true, feedBanner = false,
        ledgerTime = ready?.let { TrackRecord.lastRecorded(it.ledgers) }, ledgerFailed = ready != null && TrackRecord.lastRecorded(ready.ledgers) == null,
        onRefresh = { repo.load(force = true) },
        header = { item { ScreenHeader(null, "Track record", "How the forecasts we have recorded turned out. This includes the ones we got wrong, the ones we could not check and the disasters we missed.") } }) {
        if (s == null) {
            item(key = "loading") { Panel { Text("Loading the track record…", color = Pnd.text, fontWeight = FontWeight.Bold); Muted("Reading our records and checking every forecast with the same checker the website runs. This can take a little while.") } }
            return@PndScreen
        }
        s.error?.let { item(key = "err") { StaleBox(it, tag = "ledgerError") } }
        item(key = "answer") {
            Panel(null, Modifier.testTag("answer")) {
                Text(s.answerLead, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                s.answerPoints.forEach { Body("• $it") }
            }
        }
        item(key = "keys") { Column(Modifier.padding(bottom = 10.dp).testTag("keyFigures")) { MetricTiles(s.keyFigures, 140.dp) } }
        item(key = "honesty") { Disclosure("What these figures mean") { Body(s.honesty) } }
        item(key = "backtest") { BacktestSection(ready.ledgers.backtest, ready.ledgers.modelVerdicts) }
        item(key = "came") {
            Panel("✓ Forecasts that came true") {
                if (!s.gradingAvailable) Muted(s.cameEmpty) else if (s.came.isEmpty()) EmptyText(s.cameEmpty)
                s.came.forEach { RecordCardView(it) }
            }
        }
        item(key = "missed") {
            Panel("⚠ Significant events we missed") {
                if (!s.gradingAvailable) Muted(s.missedEmpty) else if (s.missed.isEmpty()) EmptyText(s.missedEmpty)
                s.missed.forEach { RecordCardView(it) }
            }
        }
        item(key = "disasters") {
            Panel("Significant disasters on record", subtitle = "Every significant disaster in our record, including the ones we did not forecast. If we have no record of checking that place at the time, we cannot say why a disaster was missed. The table says so, rather than blaming our checks or our forecasts.") {
                if (s.disasters.isEmpty()) Muted(s.disastersEmpty)
                s.disasters.forEach { d ->
                    CardBox {
                        Text(d.id, color = Pnd.text, fontWeight = FontWeight.Bold)
                        if (d.reason.isNotEmpty()) Muted(d.reason)
                        KvList(listOf("Type" to d.type, "Where" to d.where, "Started" to d.started, "Deaths" to d.deaths, "Displaced" to d.displaced, "Evidence" to d.evidence))
                        Pill(d.forecastInAdvance, if (d.good) Pnd.okBorder else Pnd.badBorder, if (d.good) Pnd.okText else Pnd.badText, upper = false)
                        if (d.why.isNotEmpty()) Muted(d.why)
                    }
                }
            }
        }
        val list = TrackRecord.filter(s.records, q, outcome, severity, sort)
        item(key = "ledgerHead") {
            Panel("All recorded forecasts", subtitle = "Newest first. You can search, filter or sort. We show 25 at a time.") {
                SearchField(q, "Search by ID, country, region or hazard", tag = "ledgerSearch") { q = it; shown = 25 }
                Toolbar {
                    Select("Filter by result", listOf("" to "All results", "VERIFIED" to "Correct", "PARTIAL" to "Partly correct", "FALSE_ALARM" to "Wrong (false alarm)", "MISSED" to "Missed event",
                        "COVERAGE_FAILURE" to "Missed: not checking there", "AWAITING" to "Not checked yet", "UNGRADEABLE" to "Cannot be checked", "NOT_A_PREDICTION" to "No proof it was made in time", "OPEN" to "Still running"), outcome) { outcome = it; shown = 25 }
                    SortSelect("accuracy", Sorts.LEDGER, sort) { setSort(it); shown = 25 }
                    Select("Filter by actual severity", listOf("" to "All severities") + listOf("CATASTROPHIC", "EXTREME", "SEVERE", "SIGNIFICANT", "MODERATE", "MINOR").map { it to it.lowercase().replaceFirstChar { c -> c.uppercase() } }, severity) { severity = it; shown = 25 }
                }
                Muted(if (list.size > shown) "Showing $shown of ${list.size}." else if (list.isNotEmpty()) "Showing all ${list.size}." else "", Modifier.testTag("pagerNote"))
                if (list.isEmpty()) EmptyText("No forecasts match these filters.")
            }
        }
        items(list.take(shown), key = { "r" + it.id + it.json.hashCode() }) { r ->
            Box(Modifier.padding(bottom = 8.dp)) {
                CardBox(accent = if (r.serious) Pnd.serious else null) {
                    Text(r.id, color = Pnd.text, fontWeight = FontWeight.Bold)
                    if (r.title.isNotEmpty()) Muted(r.title)
                    Text("Did it happen? " + r.occurred, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    if (s.gradingAvailable) VerdictPill(r.state, r.label) else {
                        Pill("Unavailable", Pnd.mutedBorder, Pnd.mutedText, upper = false)
                        Muted("We could not load the record needed to check this forecast, so no result is shown.")
                    }
                    r.ledgerNote?.let { Muted(it) }; r.unreproducedNote?.let { Muted(it) }; r.reasonNote?.let { Muted(it) }
                    SeverityBadge(r.severity, "Not recorded")
                    KvList(listOf("Type of forecast" to r.kind, "Hazard and place" to (r.hazard + if (r.place.isNotEmpty()) " · " + r.place else ""), "Locked on" to r.lockedOn,
                        "Forecast period" to r.period, "What counted as a match" to r.threshold, "Matching event" to r.matched, "Evidence" to r.evidence))
                }
            }
        }
        if (list.size > shown) item(key = "pager") {
            Toolbar { SecondaryButton("Show 25 more", Modifier.testTag("showMore")) { shown += 25 }; SecondaryButton("Show all") { shown = Int.MAX_VALUE } }
        }
        item(key = "cmp") {
            Disclosure("What we forecast compared with what happened") {
                Muted("Each checked forecast, with what we forecast next to what we found.")
                if (!s.gradingAvailable) Muted(s.comparisonsEmpty) else if (s.comparisons.isEmpty()) EmptyText(s.comparisonsEmpty)
                s.comparisons.forEach { cmp ->
                    CardBox {
                        Text(cmp.title, color = Pnd.text, fontWeight = FontWeight.Bold)
                        Text("Did it happen? ${cmp.occurred}", color = Pnd.text)
                        Label("What we forecast"); KvList(cmp.forecast)
                        Label("What actually happened"); KvList(cmp.actual)
                    }
                }
            }
        }
        item(key = "full") {
            Disclosure("Full details: advance forecasts, other forecasts and missed disasters", tag = "fullDetails") {
                Body("A forecast counts as made in advance only if we recorded it before the danger it names was known. Other forecasts are made later: about a flood that is already happening, about aftershocks after an earthquake, or as a test case written after its period began. These are real forecasts, but they do not foresee something nobody knew about. We report the two kinds separately and never add them together.")
                MetricTiles(s.fullFigures, 140.dp)
                SubHeading("How our advance forecasts did"); MetricTiles(s.advance, 140.dp); Muted(s.advanceNote)
                SubHeading("How our other forecasts did")
                Muted("These forecasts are about a danger already reported, or about what follows an event that already happened, such as aftershocks. We check them too, but never count them as advance forecasts.")
                MetricTiles(s.other, 140.dp); Muted(s.otherNote)
                SubHeading("Disasters and what we missed"); MetricTiles(s.observedFigures, 140.dp); Muted(s.observedNote)
                SubHeading("How we work out these numbers"); Muted(s.methodNote); Muted(s.classBreak)
                SubHeading("How we label results")
                Muted("For each forecast or event, we keep 4 separate labels: how severe the event was, how the forecast turned out, whether we were checking that place, and how strong the evidence is.")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    RiskBadge(Level.EXTREME, "Extreme event"); RiskBadge(Level.SEVERE, "Severe event"); RiskBadge(Level.HIGH, "Significant event")
                    listOf("VERIFIED", "PARTIAL", "FALSE_ALARM", "MISSED", "COVERAGE_FAILURE", "UNGRADEABLE", "NOT_A_PREDICTION").forEach { VerdictPill(it) }
                }
                Muted("Precision answers this question: when we forecast an event, how often did it happen? Recall answers this one: of the significant disasters that really happened, how many had a forecast that counts, made in advance? Forecasts that are still running are left out until their period ends. A forecast based on an official warning gets no credit just because the warning already existed.")
            }
        }
    }
}

@Composable
private fun RecordCardView(c: com.anchittandon.pnd.logic.RecordCard) {
    CardBox {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { SeverityBadge(c.severity, "Severity not recorded"); VerdictPill(c.state) }
        Text(c.title, color = Pnd.text, fontWeight = FontWeight.Bold)
        Muted(c.sub)
    }
}

@Composable
private fun BacktestSection(doc: kotlinx.serialization.json.JsonObject?, verdicts: kotlinx.serialization.json.JsonObject?) {
    Panel("Experimental forecast models: tested on past weather") {
        Muted("Our experimental models forecast extreme heat, heavy rain and wildfire weather a few days ahead. Their forecasts are on the forecasts page, marked as made in advance. Each one is recorded when it is published and graded below once its days have been measured, misses included. The models are also tested on weather forecasts that were really issued 3 and 5 days in advance; those results are in the first table.")
        val rows = Backtest.rows(doc)
        if (rows == null) Muted("Not yet available. The test results could not be read, or the last test scored nothing, so no figures are shown.")
        else {
            val places = Hazards.group(doc!!.str("places")?.toDoubleOrNull() ?: 0.0)
            val w = doc["window"] as? kotlinx.serialization.json.JsonObject
            val skipped = (doc["skipped"] as? kotlinx.serialization.json.JsonArray)?.size ?: 0
            Muted("Tested in $places cities" + (if (skipped > 0) " ($skipped more could not be tested)" else "") + ", on days from ${Backtest.day(w?.str("from"))} to ${Backtest.day(w?.str("to"))}, against weather measured by NASA POWER, with each place’s ${doc.str("climatologyPeriod") ?: "30-year"} record as its normal. \"By chance\" is what a forecaster with no skill would score, warning on the same number of days picked at random.")
            rows.forEach { r ->
                CardBox {
                    Text("${r.label} · ${r.lead} days ahead", color = Pnd.text, fontWeight = FontWeight.Bold)
                    KvList(listOf("Days tested" to Hazards.group(r.days.toDouble()), "Days it happened" to "${Hazards.group(r.happened.toDouble())} (${Backtest.pct(r.rightByChance)})",
                        "Caught by the model" to Backtest.pct(r.caught), "Caught by chance" to Backtest.pct(r.caughtByChance),
                        "Right when the model warned" to Backtest.pct(r.rightWhenWarned), "Right by chance" to Backtest.pct(r.rightByChance)))
                }
            }
            val heat = rows.first { it.hazard == "heat" && it.lead == 3 }
            Label("Limits")
            listOf(
                "These are weather forecasts, not disasters. A hit means a day crossed a local weather line, such as ${rows[0].threshold}. It does not mean a disaster happened, and a miss does not mean one was missed.",
                "One season only: about three months, in $places cities. The models may do better or worse in other seasons and places.",
                heatLimit(doc, heat),
                "Measured weather comes from NASA POWER, a grid with cells about 50 to 70 km across, not from weather stations, so a city’s own readings can differ.",
                "Wildfire weather is tested with the index built from measured weather up to the day before, so only the last day is forecast. The live models forecast every day, and should be expected to do worse than this.",
                "Each day is scored on its own here. A published heat or fire forecast needs two days in a row, and is graded in the table below once its days have been measured.",
            ).forEach { Muted("• $it") }
        }
        SubHeading("Published model forecasts")
        val (status, table) = TrackRecord.modelGrades(verdicts)
        Muted(status)
        table?.forEach { row ->
            CardBox { Text(row[0], color = Pnd.text, fontWeight = FontWeight.Bold); KvList(listOf("Published" to row[1], "Came true" to row[2], "False alarms" to row[3], "Missed days" to row[4], "Waiting to be measured" to row[5])) }
        }
    }
}

private fun heatLimit(doc: kotlinx.serialization.json.JsonObject, heat: Backtest.Row): String {
    if (doc.str("heatLine") != "trend") return "Days crossed the heat line on ${Backtest.pct(heat.rightByChance)} of the days tested, though the line is meant to be crossed on about 5%. Recent measurements run warmer than the 30-year record, so heat is easier to score well on than intended."
    val results = (doc["results"] as? kotlinx.serialization.json.JsonObject)
    val plainDoc = kotlinx.serialization.json.JsonObject(LinkedHashMap(doc).apply {
        put("results", kotlinx.serialization.json.JsonObject(LinkedHashMap(results ?: emptyMap()).apply { results?.get("heatUnshifted@3")?.let { put("heat@3", it) } }))
    })
    val p0 = Backtest.rows(plainDoc)?.firstOrNull { it.hazard == "heat" && it.lead == 3 }
    return "The heat line is each city’s 95th percentile for the date over 1996 to 2025, moved by that city’s own temperature trend over those years to the year it is used in: up where it has warmed and down where it has cooled. " +
        (if (heat.rightByChance <= 0.065) "Days crossed it on ${Backtest.pct(heat.rightByChance)} of the days tested, about the 5% the name suggests" + (if (p0 != null) " (the line without the trend: ${Backtest.pct(p0.rightByChance)})." else ".")
        else "Even so, days crossed it on ${Backtest.pct(heat.rightByChance)} of the days tested" + (if (p0 != null) ", against ${Backtest.pct(p0.rightByChance)} for the line without the trend" else "") + ", not the 5% the name suggests: these months ran hotter than the trend predicts.") +
        " A heat warning here means hotter than 19 in 20 days of that trend, not of today’s climate."
}
