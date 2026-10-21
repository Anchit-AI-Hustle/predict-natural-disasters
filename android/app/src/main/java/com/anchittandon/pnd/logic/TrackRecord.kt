package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsNumText
import com.anchittandon.pnd.model.jsRound
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.strings
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.mozilla.javascript.Context
import org.mozilla.javascript.Function
import org.mozilla.javascript.Scriptable
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * Runs the website's own grading scripts (hazard-model.js, observed-model.js, verification-model.js,
 * bundled unchanged) in Mozilla Rhino, interpreted, so it behaves the same on a phone and in JVM tests.
 */
class GradingEngine(private val loadScript: (String) -> String) {
    private val scripts = listOf("hazard-model.js", "observed-model.js", "verification-model.js", "trackrecord-driver.js")

    /** Grades the ledgers; returns the driver's JSON. Runs on its own thread with a large stack. */
    fun grade(inputJson: String): JsonObject {
        val result = AtomicReference<Any?>()
        val t = Thread(null, {
            val cx = Context.enter()
            try {
                @Suppress("DEPRECATION")
                cx.optimizationLevel = -1
                cx.languageVersion = Context.VERSION_ES6
                val scope = cx.initStandardObjects()
                cx.evaluateString(scope, "var window = this; var globalThis = this;", "prelude", 1, null)
                for (s in scripts) cx.evaluateString(scope, loadScript(s), s, 1, null)
                val tr = scope.get("PNDTrackRecord", scope) as Scriptable
                val run = tr.get("run", tr) as Function
                result.set(Context.toString(run.call(cx, scope, tr, arrayOf(inputJson))))
            } catch (e: Throwable) {
                result.set(e)
            } finally {
                Context.exit()
            }
        }, "pnd-grading", 64L * 1024 * 1024)
        t.start()
        t.join()
        when (val r = result.get()) {
            is String -> return PndJson.parseToJsonElement(r).jsonObject
            is Throwable -> throw r
            else -> error("Grading returned nothing")
        }
    }

    /** Runs any one exported function of the loaded scripts with JSON arguments (used by parity tests). */
    fun call(global: String, fn: String, argsJson: String): String {
        val result = AtomicReference<Any?>()
        val t = Thread(null, {
            val cx = Context.enter()
            try {
                @Suppress("DEPRECATION")
                cx.optimizationLevel = -1
                cx.languageVersion = Context.VERSION_ES6
                val scope = cx.initStandardObjects()
                cx.evaluateString(scope, "var window = this; var globalThis = this;", "prelude", 1, null)
                for (s in scripts) cx.evaluateString(scope, loadScript(s), s, 1, null)
                val out = cx.evaluateString(scope, "JSON.stringify($global.$fn.apply(null, $argsJson))", "call", 1, null)
                result.set(Context.toString(out))
            } catch (e: Throwable) { result.set(e) } finally { Context.exit() }
        }, "pnd-grading-call", 64L * 1024 * 1024)
        t.start(); t.join()
        return when (val r = result.get()) { is String -> r; is Throwable -> throw r; else -> error("no result") }
    }
}

/** The ledgers the Track record reads; a null is a file that could not be read (never an empty one). */
data class Ledgers(
    val outlook: JsonArray?,
    val verification: JsonObject?,
    val observed: JsonObject?,
    val scan: JsonObject?,
    val backtest: JsonObject? = null,
    val modelVerdicts: JsonObject? = null,
)

/** Everything the Track record screen prints, built from accuracy.html load(). */
data class TrackRecordScreen(
    val error: String?,
    val answerLead: String,
    val answerPoints: List<String>,
    val keyFigures: List<Pair<String, String>>,
    val honesty: String,
    val fullFigures: List<Pair<String, String>>,
    val advance: List<Pair<String, String>>,
    val advanceNote: String,
    val other: List<Pair<String, String>>,
    val otherNote: String,
    val observedFigures: List<Pair<String, String>>,
    val observedNote: String,
    val methodNote: String,
    val classBreak: String,
    val came: List<RecordCard>,
    val missed: List<RecordCard>,
    val cameEmpty: String,
    val missedEmpty: String,
    val disasters: List<DisasterRow>,
    val disastersEmpty: String,
    val records: List<LedgerRow>,
    val gradingAvailable: Boolean,
    val recordUpdated: String,
    val comparisons: List<Comparison>,
    val comparisonsEmpty: String,
)

data class RecordCard(val severity: String?, val state: String, val title: String, val sub: String)
data class DisasterRow(val id: String, val reason: String, val type: String, val where: String, val started: String,
    val deaths: String, val displaced: String, val evidence: String, val forecastInAdvance: String, val good: Boolean, val why: String)
data class LedgerRow(
    val json: JsonObject, val state: String, val id: String, val title: String, val occurred: String, val label: String,
    val ledgerNote: String?, val unreproducedNote: String?, val reasonNote: String?, val kind: String, val severity: String?,
    val hazard: String, val place: String, val lockedOn: String, val period: String, val threshold: String, val matched: String,
    val evidence: String, val serious: Boolean,
)
data class Comparison(val title: String, val state: String, val occurred: String, val forecast: List<Pair<String, String>>, val actual: List<Pair<String, String>>)

object TrackRecord {
    private fun pl(x: Int, one: String, many: String) = "$x " + if (x == 1) one else many
    private fun sentence(v: String?): String { val t = v ?: ""; return if (t.isEmpty()) "" else t.substring(0, 1).uppercase(Locale.ROOT) + t.substring(1).lowercase(Locale.ROOT) }
    private val COVERED = mapOf("SCANNED" to "Yes", "UNVERIFIABLE_NO_SCAN_LEDGER" to "We cannot tell: no record of checks")
    private val DATE_IN_TEXT = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})")
    fun niceDates(t: String?): String = DATE_IN_TEXT.replace(t ?: "") { Format.fmtDate(it.value) }
    private fun listText(a: List<String>, conj: String) = if (a.size < 2) a.joinToString("") else a.dropLast(1).joinToString(", ") + " " + conj + " " + a.last()

    private val WHY_NOT = mapOf(
        "ABSENCE_NOT_ESTABLISHABLE" to (" is for a hazard and place that none of our sources fully covers, so a lack of reports there proves nothing" to " are for a hazard and place that none of our sources fully covers, so a lack of reports there proves nothing"),
        "OBSERVED_RECORD_EMPTY" to (" had no check of our sources on record to compare with" to " had no check of our sources on record to compare with"),
        "OBSERVED_RECORD_STARTS_LATER" to (" started before we first checked its hazard and place" to " started before we first checked their hazard and place"),
        "OBSERVED_RECORD_NOT_YET_UPDATED" to (" ended after our latest check of its hazard and place" to " ended after our latest check of their hazard and place"),
        "OBSERVED_RECORD_HAS_A_GAP" to (" fell in a gap of more than 6 hours between our checks" to " fell in a gap of more than 6 hours between our checks"),
        "SEQUENCE_ATTRIBUTION_AMBIGUOUS" to (" matched activity that fits a forecast about a different disaster just as well" to " matched activity that fits a forecast about a different disaster just as well"),
        "CONTINUATION_EVIDENCE_UNAVAILABLE" to (" followed a disaster with no report dated inside the forecast period" to " followed disasters with no report dated inside the forecast period"),
    )
    private val FORECAST_IN_ADVANCE = mapOf("NOT_FORECASTABLE" to "No: cannot be forecast", "DATA_UNAVAILABLE" to "No: reason unknown",
        "COVERAGE_FAILURE" to "No: not checking there", "FORECAST_FAILURE" to "No: missed by our forecasts", "NO_PROSPECTIVE_INPUT" to "No: no advance source")
    private val SERIOUS = setOf("CATASTROPHIC", "EXTREME", "SEVERE")

    private fun int(o: JsonObject?, k: String): Int = o.jsNum(k).let { if (it.isFinite()) it.toInt() else 0 }
    private fun dbl(o: JsonObject?, k: String): Double? = (o?.get(k) as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()
    private fun pct(x: Double?, n: String, unit: String) = if (x == null) "Cannot be calculated" else jsNumText(jsRound(x * 1000) / 10) + "% ($n $unit)"

    private fun whyNot(s: JsonObject?): String {
        val b = s.obj("ungradeableBy") ?: return ""
        val keys = b.keys.toList().sortedWith { x, y -> int(b, y) - int(b, x) }
        return keys.joinToString("; ") { k -> val n = int(b, k); "$n" + (WHY_NOT[k]?.let { if (n == 1) it.first else it.second } ?: " cannot be checked ($k)") }
    }

    /** The JSON input for the grading driver. */
    fun driverInput(l: Ledgers, now: Long): String = buildString {
        append("{\"now\":").append(now)
        append(",\"outlook\":").append(l.outlook?.toString() ?: "[]")
        append(",\"verification\":").append(l.verification?.toString() ?: "{\"verifications\":[]}")
        append(",\"observed\":").append(l.observed?.toString() ?: "{\"events\":[]}")
        append(",\"scan\":").append(l.scan?.toString() ?: "{\"scans\":[]}")
        append("}")
    }

    fun recordUpdated(l: Ledgers): String {
        val times = listOfNotNull(l.verification, l.observed, l.scan).mapNotNull { JsDate.parse(it.text("updatedAt")) } +
            l.outlook.objects().mapNotNull { JsDate.parse(it.text("recordedAt")) }
        return if (times.isEmpty()) "Unavailable" else Format.fmtDateMs(times.max())
    }

    /** The newest updatedAt among the loaded ledgers, for the trust note ("Track record last recorded"). */
    fun lastRecorded(l: Ledgers): String? = listOfNotNull(l.verification, l.observed, l.scan, l.backtest, l.modelVerdicts)
        .mapNotNull { it.text("updatedAt").ifEmpty { it.text("generatedAt") }.ifEmpty { null } }
        .maxByOrNull { JsDate.parse(it) ?: 0L }

    fun build(l: Ledgers, graded: JsonObject?, now: Long): TrackRecordScreen {
        val unavailable = listOfNotNull(
            if (l.outlook == null) "our record of forecasts" else null,
            if (l.verification == null) "our record of hand-checked results" else null,
            if (l.observed == null) "our record of disasters" else null,
            if (l.scan == null) "our record of which places we checked" else null,
        )
        val rows = l.outlook.objects()
        val verifications = l.verification.arr("verifications").objects()
        val joined = Verdicts.joinVerdicts(rows, verifications)
        val canGrade = unavailable.isEmpty() && graded != null
        val verdictByKey = HashMap<String, JsonObject>()
        graded.arr("verdicts").objects().forEach { verdictByKey[it.text("key")] = it }
        val observed = l.verification.arr("observedEvents").objects().map { x ->
            if (x.truthy("status")) x else JsonObject(LinkedHashMap(x).apply { put("status", JsonPrimitive("MISSED_EVENT")) })
        }
        val ENGINE_DECIDED = setOf("VERIFIED", "PARTIAL", "FALSE_ALARM", "NOT_A_PREDICTION")
        val LEDGER_GRADED = setOf("VERIFIED", "PARTIAL", "FALSE_ALARM", "MISSED", "COVERAGE_FAILURE")
        data class R(val r: JsonObject, val state: String, val ledgerState: String?, val unrepro: Boolean, val v: JsonObject?)
        val records = (joined.records + observed).map { r ->
            val led = Verdicts.stateOf(r, now)
            val v = verdictByKey[Hazards.claimKey(r)]
            val eng = if (canGrade) Verdicts.engineState(v) else null
            val decided = eng != null && eng in ENGINE_DECIDED
            val ledGraded = led in LEDGER_GRADED
            R(r, if (decided) eng!! else if (ledGraded) led else (eng ?: led),
                if (decided && eng != led && ledGraded) led else null,
                !decided && ledGraded && eng == "UNGRADEABLE", if (canGrade) v else null)
        }.sortedWith { a, b -> (recordedAt(b.r)).compareTo(recordedAt(a.r)) }

        val distinct = rows.map { it.str("id") }.toSet().size
        val recordedText = pl(rows.size, "forecast has", "forecasts have") + " been recorded. We record a forecast again each time we update it, so " +
            (if (rows.size == 1) "it comes" else "these come") + " from " + pl(distinct, "different forecast", "different forecasts") + ". "
        val recordUpdated = recordUpdated(l)

        fun ledgerRows(gradingAvailable: Boolean) = records.map { x ->
            val r = x.r; val v2 = x.v
            val tol = v2.obj("tolerance")
            val tolText = tol?.let { t ->
                val by = t.obj("byHazard"); val ks = by?.keys?.toList() ?: emptyList()
                if (ks.size > 1) ks.joinToString(", ") { k -> by.str(k) + " km for " + k.replace("-", " ") } else (t.str("km") ?: "undefined") + " km"
            }
            val thrCountry = v2.str("country")
            val thr = if (tol != null) "A significant event within $tolText" + (if (!thrCountry.isNullOrEmpty()) " ($thrCountry)" else "") else "-"
            val ids = v2.arr("observedEventIds").strings()
            val matched = if (ids.isNotEmpty()) ids.joinToString(", ") else if (v2 != null) (if (v2.bool("gradeable") == true) "None found" else if (v2.str("ungradeableReason") == "WINDOW_STILL_OPEN") "Too early to say" else "Cannot be checked") else "-"
            val sev = r.str("observedSeverity")?.takeIf { it.isNotEmpty() }
            LedgerRow(r, x.state, r.firstOf("id", "eventId").ifEmpty { "Observed" }, Format.titleOf(r),
                if (gradingAvailable) Verdicts.OCCURRED[x.state] ?: "Unknown" else "Unavailable",
                if (gradingAvailable) Verdicts.LABELS[x.state] ?: x.state else "Unavailable",
                x.ledgerState?.let { "Checked by hand as “${Verdicts.LABELS[it] ?: it}”. The automatic result is the one we count." },
                if (x.unrepro) "Checked by hand. Our automatic checker cannot repeat this check from our record of disasters, so no rate on this page uses it." else null,
                if (v2 != null && v2.bool("gradeable") != true && v2.truthy("classificationReason")) niceDates(v2.str("classificationReason")) else null,
                if (Verdicts.isForecastRow(r)) (classLabel(v2.str("forecastClass") ?: Verdicts.forecastClassOf(r)).ifEmpty { "-" }) else "-",
                sev,
                r.firstOf("hazard", "type").ifEmpty { "-" },
                listOf(r.text("region"), r.text("country")).filter { it.isNotEmpty() }.joinToString(" · "),
                if (r.truthy("freezeTimestamp")) Format.fmtDate(r.str("freezeTimestamp")) else "-",
                if (r.truthy("targetStart")) Format.windowText(r) else "An event, not a forecast",
                thr, matched,
                if (r.truthy("evidenceConfidence")) sentence(r.str("evidenceConfidence")) else "Not checked yet",
                sev?.let { it in SERIOUS } == true)
        }

        if (!canGrade) {
            val cannot = "We could not load " + listText(unavailable.ifEmpty { listOf("the grading scripts") }, "or") +
                ". So nothing here has been checked, and no figure below tells you what happened. Reload the page or try again later."
            val u = "Unavailable"
            val os = rows.mapNotNull { JsDate.parse(it.text("targetStart")) }
            val oe = rows.mapNotNull { JsDate.parse(it.text("targetEnd")) }
            return TrackRecordScreen(
                error = "Some track record data could not be loaded: " + listText(unavailable.ifEmpty { listOf("the grading scripts") }, "and") +
                    ". So no figure on this page tells you what happened. This is not the same as nothing having been recorded.",
                answerLead = "The track record could not be loaded.", answerPoints = listOf(cannot),
                keyFigures = listOf("Forecasts recorded" to (if (l.outlook != null) rows.size.toString() else u)) +
                    listOf("Still running", "Ended, not checked yet", "Ended, cannot be checked", "Checked so far", "Correct", "Partly correct",
                        "Wrong (false alarm)", "Missed events", "No proof made in time").map { it to u },
                honesty = (if (l.outlook != null) recordedText else "") + cannot,
                fullFigures = listOf(
                    "Forecasts recorded" to (if (l.outlook != null) pl(rows.size, "forecast", "forecasts") else u),
                    "Forecast periods covered" to (if (l.outlook == null) u else if (os.isNotEmpty() && oe.isNotEmpty()) "From " + Format.fmtDateMs(os.min()) + " to " + Format.fmtDateMs(oe.max()) else "No forecasts recorded"),
                    "First advance forecast" to u, "Last updated" to recordUpdated),
                advance = ADVANCE_LABELS.map { it to u }, advanceNote = cannot,
                other = OTHER_LABELS.map { it to u }, otherNote = cannot,
                observedFigures = OBSERVED_LABELS.map { it to u }, observedNote = cannot,
                methodNote = "Nothing was checked. $cannot", classBreak = "",
                came = emptyList(), missed = emptyList(), cameEmpty = cannot, missedEmpty = cannot,
                disasters = emptyList(), disastersEmpty = cannot,
                records = ledgerRows(false), gradingAvailable = false, recordUpdated = recordUpdated,
                comparisons = emptyList(), comparisonsEmpty = cannot,
            )
        }
        val g = graded!!
        val states = records.map { it.state }
        val t = Verdicts.tally(records.map { it.r }, now, states)
        val disagree = records.count { it.ledgerState != null }
        val unreproduced = records.count { it.unrepro }
        val honesty = recordedText +
            pl(t.graded, "of them has", "of them have") + " been checked. " + pl(t.graded - unreproduced, "was", "were") + " checked automatically" +
            (if (unreproduced > 0) ", and " + pl(unreproduced, "was checked by hand", "were checked by hand") + ". Our automatic checker cannot repeat the hand checks from our own record of disasters, so they are not used in any rate on this page" else "") + ". " +
            (if (t.ungradeable > 0) pl(t.ungradeable, "forecast has", "forecasts have") + " ended but cannot be checked either way. Our record of disasters does not fully cover the hazard, place and time " + (if (t.ungradeable == 1) "it names" else "they name") + ". So a lack of reports there does not show that nothing happened. " else "") +
            (if (t.notPrediction > 0) pl(t.notPrediction, "forecast does", "forecasts do") + " not count as made in advance at all, because nothing shows " + (if (t.notPrediction == 1) "it was" else "they were") + " made before the period " + (if (t.notPrediction == 1) "it covers" else "they cover") + ". " else "") +
            (if (t.awaiting > 0) pl(t.awaiting, "forecast", "forecasts") + " ended without being checked, so " + (if (t.awaiting == 1) "it counts" else "they count") + " neither for nor against us. " else "") +
            "Every rate on this page shows how many forecasts it is based on. None of them is based on enough forecasts to be a real track record yet. " +
            "The rates are under “Full details” below, where advance forecasts and other forecasts are kept apart." +
            (if (disagree > 0) " " + pl(disagree, "forecast got", "forecasts got") + " a different result when checked by hand. We show and count the automatic result, and show the hand result beside it." else "") +
            (if (joined.unattached.isNotEmpty()) " " + pl(joined.unattached.size, "hand-checked result", "hand-checked results") + " could not be matched to a recorded forecast, so " + (if (joined.unattached.size == 1) "it is" else "they are") + " not counted." else "") +
            (if (t.unknown > 0) " " + pl(t.unknown, "forecast has", "forecasts have") + " a result this page does not recognise. " + (if (t.unknown == 1) "It is" else "They are") + " counted as not checked." else "")

        val sH = g.obj("sH"); val sR = g.obj("sR"); val sC = g.obj("sC")
        val headlineCount = int(g, "headlineCount"); val condCount = int(g, "condCount")
        val obsEvents = g.arr("obsEvents").objects()
        val assessments = g.arr("assessments").objects()
        val since = dbl(g, "since")
        val outsideRecall = obsEvents.size - int(g, "recallCount")
        val predClasses = g.arr("predClasses")?.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()

        val onsets = rows.mapNotNull { JsDate.parse(it.text("targetStart")) }
        val ends = rows.mapNotNull { JsDate.parse(it.text("targetEnd")) }
        val firstProspective = rows.indices.filter { predClasses.getOrNull(it) == "independent-prospective" }
            .mapNotNull { i -> JsDate.parse(rows[i].firstOf("freezeTimestamp", "recordedAt")) }
        val fullFigures = listOf(
            "Forecasts recorded" to pl(rows.size, "forecast", "forecasts"),
            "Forecast periods covered" to (if (onsets.isNotEmpty()) "From " + Format.fmtWhen(JsDate.iso(onsets.min())) + " to " + Format.fmtWhen(if (ends.isEmpty()) null else JsDate.iso(ends.max()), null, "end") else "No forecasts recorded"),
            "First advance forecast" to (if (firstProspective.isNotEmpty()) Format.fmtDateMs(firstProspective.min()) else "None yet"),
            "Last updated" to recordUpdated,
        )
        val eligH = int(sH, "eligibleMaturedPredictions")
        val advance = listOf(
            "Advance forecasts" to headlineCount.toString(), "Checked" to eligH.toString(), "Correct" to int(sH, "hit").toString(),
            "Partly correct" to int(sH, "partial").toString(), "Wrong (false alarm)" to int(sH, "miss").toString(),
            "Still running or cannot be checked" to int(sH, "pending").toString(), "No proof made in time" to int(g, "invalid").toString(),
            "Precision: how often right" to pct(dbl(sH, "precision"), eligH.toString(), "checked"),
            "Recall: share of disasters forecast" to pct(dbl(sR, "recall"), int(sR, "significantObservedEvents").toString(), "disasters"),
            "F1 score: the two combined" to pct(dbl(sR, "f1"), "${int(sR, "eligibleMaturedPredictions")} checked, ${int(sR, "significantObservedEvents")}", "disasters"),
        )
        fun otherNote(s: JsonObject?) = if (int(s, "ungradeable") > 0) " Of " + pl(int(s, "ungradeable"), "other ended forecast", "other ended forecasts") + ": " + whyNot(s) + "." else ""
        fun outsideNote(s: JsonObject?): String {
            val h = int(s, "hitsOutsideCoverage"); if (h == 0) return ""
            return " " + pl(h, "forecast came", "forecasts came") + " true but " + (if (h == 1) "is" else "are") + " left out of this rate. For " + (if (h == 1) "its" else "their") +
                " hazard and place, we could never have found out if " + (if (h == 1) "it" else "they") + " had been wrong. Including them would count the successes but not the failures."
        }
        val recallNote = if (outsideRecall > 0) " " + pl(outsideRecall, "disaster on record", "disasters on record") + " " + (if (since == null)
            (if (outsideRecall == 1) "is" else "are") + " listed as not forecast in the table of significant disasters. " + (if (outsideRecall == 1) "It is" else "They are") +
                " not used for recall (the share of real disasters we forecast in advance), because we were not making advance forecasts when " + (if (outsideRecall == 1) "it" else "they") + " happened."
        else "happened before our first advance forecast was recorded (" + Format.fmtDateMs(since.toLong()) + "), or " + (if (outsideRecall == 1) "has" else "have") +
            " no recorded start time. " + (if (outsideRecall == 1) "It is" else "They are") + " listed as not forecast in the table of significant disasters, and " +
            (if (outsideRecall == 1) "is" else "are") + " not used for recall (the share of real disasters we forecast in advance).") else ""
        val advanceNote = (if (headlineCount == 0)
            "We have never recorded a disaster forecast made in advance. So we have no hit rate for advance disaster forecasts, and we do not show one. Every disaster forecast here was about a danger already reported, followed an event that had already happened, or was a test case written after its period began. The experimental weather models do forecast in advance; they are graded separately, under \"Experimental forecast models\" below."
        else if (eligH == 0) "None of our advance forecasts can be checked yet. Of " + pl(int(sH, "ungradeable"), "ended forecast", "ended forecasts") + ": " + whyNot(sH) + "." + outsideNote(sH)
        else "Based on " + pl(eligH, "checked advance forecast", "checked advance forecasts") + ". With so few, one result can change the rate a lot." + otherNote(sH) + outsideNote(sH)) + recallNote

        val eligC = int(sC, "eligibleMaturedPredictions")
        val other = listOf(
            "Other forecasts" to condCount.toString(), "Checked" to eligC.toString(), "Correct" to int(sC, "hit").toString(),
            "Partly correct" to int(sC, "partial").toString(), "Wrong (false alarm)" to int(sC, "miss").toString(),
            "Still running or cannot be checked" to int(sC, "pending").toString(),
            "Precision: how often right" to pct(dbl(sC, "precision"), eligC.toString(), "checked"),
        )
        val anyScan = l.scan.arr("scans")?.size ?: 0
        val otherNoteText = if (eligC == 0) "None of these can be checked yet. Of " + pl(int(sC, "ungradeable"), "ended forecast", "ended forecasts") + ": " + whyNot(sC) + ". " +
            (if (anyScan > 0) "We track the places we check separately for each hazard. A check made while the sources for that hazard were down does not count." else "We have not recorded any check of our sources yet, so there is nothing to compare these forecasts with.") + outsideNote(sC)
        else "Based on " + pl(eligC, "checked forecast", "checked forecasts") + ". This is not a rate for advance forecasts." + otherNote(sC) + outsideNote(sC)

        val cov = sH.obj("coverage")
        val observedFigures = listOf(
            "Significant disasters" to obsEvents.size.toString(), "Not forecast in advance" to int(sH, "falseNegatives").toString(),
            "Missed: not checking there" to int(cov, "COVERAGE_FAILURE").toString(), "Missed by our forecasts" to int(cov, "FORECAST_FAILURE").toString(),
            "Reason unknown" to int(cov, "DATA_UNAVAILABLE").toString(), "Cannot be forecast" to int(cov, "NOT_FORECASTABLE").toString(),
            "No advance source" to int(cov, "NO_PROSPECTIVE_INPUT").toString(),
        )
        val observedNote = if (obsEvents.isEmpty()) "No significant disaster has been recorded yet. Our hourly update adds them from our live sources. Until it has run, recall cannot be worked out, so it is not shown. An empty record is not a claim that nothing happened."
        else "A disaster counts as “not forecast in advance” when no forecast made in advance covered it. If we have no record of checking that hazard and place at the time, we cannot tell why it was missed. We say so, rather than blame our checks or our forecasts."

        val answerLead = if (headlineCount == 0) "We do not have a track record of advance forecasts yet. Every forecast we have recorded was made after the danger was already known."
        else if (eligH == 0) "We have made some forecasts in advance, but none of them can be checked yet."
        else "Of the " + pl(eligH, "advance forecast", "advance forecasts") + " we could check, " + jsNumText(jsRound((dbl(sH, "precision") ?: 0.0) * 1000) / 10) + "% came true. A partly correct forecast counts as half."
        val pts = mutableListOf<String>()
        pts += pl(rows.size, "forecast has", "forecasts have") + " been recorded. We record a forecast again each time we update it, so " + (if (rows.size == 1) "it comes" else "these come") + " from " + pl(distinct, "different forecast", "different forecasts") + "." +
            (if (headlineCount > 0) " " + pl(headlineCount, "was", "were") + " made in advance. We count the rest separately." else "")
        pts += pl(t.graded, "forecast has", "forecasts have") + " been checked: ${t.verified} correct, ${t.partial} partly correct and ${t.falseAlarm} wrong." +
            (if (unreproduced > 0) " $unreproduced of these " + (if (unreproduced == 1) "was" else "were") + " checked by hand." else "") +
            (if (t.ungradeable > 0) " Another " + pl(t.ungradeable, "has", "have") + " ended but cannot be checked either way. No record of events covers that place and time well enough." else "")
        val why = mutableListOf<String>()
        fun was(x: Int) = if (x == 1) "was" else "were"
        int(cov, "NOT_FORECASTABLE").let { if (it > 0) why += "$it ${was(it)} of a kind nobody can forecast." }
        int(cov, "DATA_UNAVAILABLE").let { if (it > 0) why += "For $it, we cannot tell whether we were checking that place at the time." }
        int(cov, "NO_PROSPECTIVE_INPUT").let { if (it > 0) why += "$it could not have been foreseen from any source we read." }
        int(cov, "COVERAGE_FAILURE").let { if (it > 0) why += "$it ${was(it)} missed because we were not checking that place." }
        int(cov, "FORECAST_FAILURE").let { if (it > 0) why += "$it ${was(it)} missed by our forecasts." }
        val predicted = obsEvents.size - int(sH, "falseNegatives")
        pts += if (obsEvents.isNotEmpty()) pl(obsEvents.size, "significant disaster has", "significant disasters have") + " been recorded. " +
            (if (predicted > 0) "We forecast $predicted of them in advance." else "We forecast none of them in advance.") + (if (why.isNotEmpty()) " " + why.joinToString(" ") else "")
        else "No significant disaster has been recorded yet. This does not mean nothing happened."
        if (t.missed > 0) pts += pl(t.missed, "more missed event was", "more missed events were") + " recorded by hand."

        val m = sH.obj("methodology")
        val methodNote = m.text("precision") + " " + m.text("recall") + " " + m.text("f1") + " " + m.text("partialHitWeight") + " Checker version: " + g.text("version") + "."
        val parts = Verdicts.partitionByClass(records.map { it.r })
        val classCounts = parts.byClass.keys.sorted().map { k -> (Hazards.FORECAST_CLASSES[k]?.label ?: k) + ": " + parts.byClass.getValue(k).size }
        val classBreak = "Forecasts recorded, by type. " + (classCounts.joinToString(" · ").ifEmpty { "None recorded" }) + "." +
            (if (parts.unclassified.isNotEmpty()) " " + pl(parts.unclassified.size, "forecast", "forecasts") + " could not be given a type, so " + (if (parts.unclassified.size == 1) "it is" else "they are") + " not used in any rate." else "")

        val fig = { e: JsonObject, k: String -> val v = e.el(k); if (v == null) "Not reported" else Format.figure(e, k) }
        val disasters = obsEvents.mapIndexed { i, e ->
            val a = assessments.getOrNull(i)
            val fn = a?.bool("falseNegative") == true
            DisasterRow(e.text("canonicalEventId"), e.text("significanceReason"), e.firstOf("hazardLabel", "hazard").ifEmpty { "-" },
                listOf(e.text("region"), e.text("country")).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "-" },
                if (e.truthy("onset")) Format.fmtDate(e.str("onset")) else "-", fig(e, "deaths"), fig(e, "displaced"),
                if (e.truthy("evidenceConfidence")) sentence(e.str("evidenceConfidence")) else "-",
                if (fn) FORECAST_IN_ADVANCE[a.str("status")] ?: "No" else "Yes", !fn, niceDates(a.str("reason")))
        }
        fun card(x: R) = RecordCard(x.r.str("observedSeverity")?.takeIf { it.isNotEmpty() }, x.state,
            x.r.firstOf("id", "eventId").ifEmpty { "Observed event" } + " · " + Format.placeOf(x.r, "Global"),
            x.r.firstOf("hazard", "type").ifEmpty { "Natural hazard" } + " · " + (if (x.r.truthy("evidenceConfidence")) "Evidence: " + sentence(x.r.str("evidenceConfidence")) else "Evidence not rated yet"))
        val came = records.filter { it.state in setOf("VERIFIED", "PARTIAL") }.map(::card)
        val missed = records.filter { it.state in setOf("MISSED", "COVERAGE_FAILURE") }.map(::card)
        val comparisons = records.filter { it.state in setOf("VERIFIED", "PARTIAL", "FALSE_ALARM") }.map { x ->
            val r = x.r
            val crit = r.obj("criteria")
            Comparison(r.text("id") + " · " + Format.placeOf(r, ""), Verdicts.LABELS[x.state] ?: x.state, Verdicts.OCCURRED[x.state] ?: "Unknown",
                listOf("Hazard" to r.firstOf("type", "hazard").ifEmpty { "-" }, "Area" to Format.placeOf(r, "-"), "Forecast period" to Format.windowText(r),
                    "Level forecast" to r.firstOf("severity", "alert").ifEmpty { "-" }, "Confidence" to r.text("confidence").ifEmpty { "-" },
                    "Based on" to r.text("evidence").ifEmpty { "-" }, "How it is checked" to r.text("verificationRule").ifEmpty { "-" }),
                listOf("Actual severity" to (if (r.truthy("observedSeverity")) sentence(r.str("observedSeverity")) else "Not recorded"),
                    "Evidence strength" to (if (r.truthy("evidenceConfidence")) sentence(r.str("evidenceConfidence")) else "-"),
                    "Was the place checked?" to (COVERED[r.text("coverageStatus")] ?: if (r.truthy("coverageStatus")) sentence(r.text("coverageStatus").replace("_", " ")) else "-"),
                    "What we found" to r.text("summary").ifEmpty { "-" }) +
                    (crit?.keys?.map { k -> k.replace(Regex("([A-Z])"), " $1").lowercase(Locale.ROOT) to (if (crit.truthy(k)) "met" else "not met") } ?: emptyList()))
        }
        return TrackRecordScreen(
            error = null, answerLead = answerLead, answerPoints = pts,
            keyFigures = listOf("Forecasts recorded" to rows.size.toString(), "Still running" to t.open.toString(), "Ended, not checked yet" to t.awaiting.toString(),
                "Ended, cannot be checked" to t.ungradeable.toString(), "Checked so far" to t.graded.toString(), "Correct" to t.verified.toString(),
                "Partly correct" to t.partial.toString(), "Wrong (false alarm)" to t.falseAlarm.toString(), "Missed events" to t.missed.toString(),
                "No proof made in time" to t.notPrediction.toString()),
            honesty = honesty, fullFigures = fullFigures, advance = advance, advanceNote = advanceNote, other = other, otherNote = otherNoteText,
            observedFigures = observedFigures, observedNote = observedNote, methodNote = methodNote, classBreak = classBreak,
            came = came, missed = missed, cameEmpty = "No forecast has come true yet.", missedEmpty = "No significant missed events have been recorded by hand yet.",
            disasters = disasters,
            disastersEmpty = "No significant disaster has been recorded yet. Our hourly update adds them from our live sources. An empty record is not a claim that nothing happened.",
            records = ledgerRows(true), gradingAvailable = true, recordUpdated = recordUpdated,
            comparisons = comparisons, comparisonsEmpty = "No forecast has been checked yet.",
        )
    }

    private val ADVANCE_LABELS = listOf("Advance forecasts", "Checked", "Correct", "Partly correct", "Wrong (false alarm)", "Still running or cannot be checked",
        "No proof made in time", "Precision: how often right", "Recall: share of disasters forecast", "F1 score: the two combined")
    private val OTHER_LABELS = listOf("Other forecasts", "Checked", "Correct", "Partly correct", "Wrong (false alarm)", "Still running or cannot be checked", "Precision: how often right")
    private val OBSERVED_LABELS = listOf("Significant disasters", "Not forecast in advance", "Missed: not checking there", "Missed by our forecasts", "Reason unknown", "Cannot be forecast", "No advance source")

    private fun classLabel(k: String?): String = if (k.isNullOrEmpty()) "" else Hazards.FORECAST_CLASSES[k]?.label ?: k
    private fun recordedAt(r: JsonObject): Long = JsDate.parse(r.firstOf("recordedAt", "observedAt")) ?: 0L
    private fun JsonObject?.firstOf(vararg keys: String): String {
        for (k in keys) if (truthy(k)) return str(k) ?: ""
        return ""
    }

    /** Filter for the ledger table: search, result and actual severity, then sort. */
    fun filter(rows: List<LedgerRow>, q: String, outcome: String, severity: String, sort: String): List<LedgerRow> {
        val f = rows.filter { Search.matches(it.json, q) && (outcome.isEmpty() || it.state == outcome) && (severity.isEmpty() || it.json.str("observedSeverity") == severity) }
        return Sorts.sort(f, sort) { it.json }
    }

    /** The published model forecasts table (accuracy.html grades()). Null when there are no grades yet; the status text either way. */
    fun modelGrades(v: JsonObject?): Pair<String, List<List<String>>?> {
        val c = v.obj("counts")
        val num = { k: String -> Hazards.group(c.jsNum(k).let { if (it.isFinite()) it else 0.0 }) }
        if (c == null || !(c.jsNum("correct") + c.jsNum("falseAlarms") > 0)) {
            return (if (c != null && c.jsNum("issued") > 0) "Not yet graded. " + num("issued") + " published so far, each waiting for its days to be measured by NASA POWER, which runs about three days behind."
            else "Not yet graded. The grades appear here once the daily model run has measured the days of a published forecast.") to null
        }
        val list = v.arr("outlooks").objects(); val miss = v.arr("misses").objects()
        val rows = listOf("heat" to "Extreme heat", "rain" to "Heavy rain", "fire" to "Wildfire weather").map { (k, label) ->
            val of = list.filter { it.str("hazard") == k }
            fun n(w: String) = of.count { it.str("verdict") == w }
            listOf(label, of.size.toString(), n("correct").toString(), n("false alarm").toString(), miss.count { it.str("hazard") == k }.toString(), n("pending").toString())
        }
        val md = c.jsNum("missedDays")
        return ("Graded " + Backtest.day(v.str("generatedAt")) + ". Of " + num("issued") + " published, " + num("correct") + " came true and " + num("falseAlarms") +
            " were false alarms; " + num("pending") + " are waiting for their days to be measured. " + num("missedDays") + " day" + (if (md == 1.0) "" else "s") +
            " crossed a line at a place the models were watching without a forecast for it.") to rows
    }
}
