package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** verdicts.js (logic.md §10.1 to §10.3). */
object Verdicts {
    val VERDICTS = mapOf(
        "VERIFIED" to "VERIFIED", "PARTIAL_VERIFICATION" to "PARTIAL", "PARTIAL" to "PARTIAL",
        "FALSE_ALARM" to "FALSE_ALARM", "MISS_FALSE_POSITIVE" to "FALSE_ALARM",
        "MISSED_EVENT" to "MISSED", "FALSE_NEGATIVE_UNPREDICTED_EVENT" to "MISSED",
        "COVERAGE_FAILURE" to "COVERAGE_FAILURE", "PENDING" to "PENDING",
    )
    val OCCURRED = mapOf(
        "VERIFIED" to "Yes", "PARTIAL" to "Partly", "FALSE_ALARM" to "No",
        "MISSED" to "Yes, but we did not forecast it", "COVERAGE_FAILURE" to "Yes, but we were not checking that place",
        "OPEN" to "Too early to say", "AWAITING" to "Not checked yet", "UNGRADEABLE" to "We cannot tell",
        "NOT_A_PREDICTION" to "Not counted", "UNKNOWN" to "Unrecognised result",
    )
    val LABELS = mapOf(
        "VERIFIED" to "Correct", "PARTIAL" to "Partly correct", "FALSE_ALARM" to "Wrong (false alarm)",
        "MISSED" to "Missed event", "COVERAGE_FAILURE" to "Missed: not checking there", "OPEN" to "Still running",
        "AWAITING" to "Not checked yet", "UNGRADEABLE" to "Cannot be checked", "NOT_A_PREDICTION" to "No proof it was made in time",
        "UNKNOWN" to "Unrecognised result",
    )
    val CSS = mapOf(
        "VERIFIED" to "verified", "PARTIAL" to "partial", "FALSE_ALARM" to "alarm", "MISSED" to "missed",
        "COVERAGE_FAILURE" to "coverage", "OPEN" to "open", "AWAITING" to "awaiting",
        "UNGRADEABLE" to "ungradeable", "NOT_A_PREDICTION" to "notprediction", "UNKNOWN" to "unknown",
    )
    private val ENGINE_STATES = mapOf("HIT" to "VERIFIED", "PARTIAL_HIT" to "PARTIAL", "MISS_FALSE_POSITIVE" to "FALSE_ALARM", "INVALID_POST_EVENT" to "NOT_A_PREDICTION")

    fun engineState(v: JsonObject?): String? {
        val c = v.text("classification").trim().uppercase(Locale.ROOT)
        if (c.isEmpty()) return null
        if (c == "PENDING") return if (v.str("ungradeableReason") == "WINDOW_STILL_OPEN") "OPEN" else "UNGRADEABLE"
        return ENGINE_STATES[c] ?: "UNKNOWN"
    }

    fun normalise(status: String?): String {
        val s = (status ?: "").trim().uppercase(Locale.ROOT)
        if (s.isEmpty()) return ""
        return VERDICTS[s] ?: "UNKNOWN"
    }

    fun stateOf(r: JsonObject?, now: Long): String {
        val graded = normalise(if (r.truthy("status")) r.text("status") else r.text("outcome"))
        if (graded.isNotEmpty() && graded != "PENDING") return graded
        val end = JsDate.parse(r.text("targetEnd")) ?: return "AWAITING"
        return if (end > now) "OPEN" else "AWAITING"
    }

    data class Rate(val text: String, val hit: Int, val total: Int, val pct: Int?)

    fun rate(hit: Int, total: Int): Rate {
        if (total == 0) return Rate("Not enough checked forecasts", hit, total, null)
        val pct = Math.floor(hit.toDouble() / total * 100 + 0.5).toInt()
        return Rate("$pct% ($hit of $total)", hit, total, pct)
    }

    data class Tally(
        val total: Int, val open: Int, val awaiting: Int, val verified: Int, val partial: Int, val falseAlarm: Int,
        val missed: Int, val coverageFailure: Int, val ungradeable: Int, val notPrediction: Int, val unknown: Int,
        val matured: Int, val graded: Int, val precision: Rate, val recall: Rate,
    )

    /** [states] is each record's `_state` where the screen already resolved one. */
    fun tally(records: List<JsonObject>, now: Long, states: List<String?>? = null): Tally {
        var open = 0; var awaiting = 0; var verified = 0; var partial = 0; var falseAlarm = 0; var missed = 0
        var coverage = 0; var ungradeable = 0; var notPrediction = 0; var unknown = 0; var matured = 0
        records.forEachIndexed { i, r ->
            val s = states?.getOrNull(i)?.takeIf { it.isNotEmpty() } ?: r.str("_state")?.takeIf { it.isNotEmpty() } ?: stateOf(r, now)
            val end = JsDate.parse(r.text("targetEnd"))
            if (end != null && end <= now) matured++
            when (s) {
                "OPEN" -> open++; "AWAITING" -> awaiting++; "VERIFIED" -> verified++; "PARTIAL" -> partial++
                "FALSE_ALARM" -> falseAlarm++; "MISSED" -> missed++; "COVERAGE_FAILURE" -> coverage++
                "UNGRADEABLE" -> ungradeable++; "NOT_A_PREDICTION" -> notPrediction++; else -> unknown++
            }
        }
        val graded = verified + partial + falseAlarm
        return Tally(records.size, open, awaiting, verified, partial, falseAlarm, missed, coverage, ungradeable, notPrediction, unknown,
            matured, graded, rate(verified + partial, graded), rate(verified + partial, verified + partial + missed + coverage))
    }

    val CLAIM_FIELDS = listOf("id", "type", "title", "country", "admin1", "region",
        "lat", "lon", "alert", "severity", "severityRank", "issuedAt", "sourceIssuedAt",
        "targetStart", "targetEnd", "forecastKind", "forecastClass",
        "classificationReason", "effectiveForecastStart", "freezeTimestamp",
        "freezeBasis", "forecastOf", "source", "sourceUrl",
        "confidence", "evidence", "verificationRule")

    private fun idKey(r: JsonObject?): String = when (val v = r?.get("id")) {
        null -> "undefined"
        is JsonPrimitive -> v.content
        else -> v.toString()
    }

    fun windowKey(r: JsonObject?): String {
        val a = JsDate.parse(r.text("targetStart"))
        val b = JsDate.parse(r.text("targetEnd"))
        return idKey(r) + "@" + (a?.toString() ?: "") + ".." + (b?.toString() ?: "")
    }

    data class Joined(val records: List<JsonObject>, val unattached: List<JsonObject>)

    fun joinVerdicts(rows: List<JsonObject>, verifications: List<JsonObject>): Joined {
        val byWindow = HashMap<String, JsonObject>()
        val countsById = HashMap<String, Int>()
        for (r in rows) { byWindow[windowKey(r)] = r; countsById[idKey(r)] = (countsById[idKey(r)] ?: 0) + 1 }
        val attached = HashMap<String, JsonObject>()
        val unattached = mutableListOf<JsonObject>()
        for (v in verifications) {
            val exact = byWindow[windowKey(v)]
            if (exact != null) { attached[windowKey(exact)] = v; continue }
            if (countsById[idKey(v)] == 1) {
                val only = rows.firstOrNull { idKey(it) == idKey(v) }
                if (only != null) { attached[windowKey(only)] = v; continue }
            }
            unattached += v
        }
        val merged = rows.map { r ->
            val v = attached[windowKey(r)] ?: return@map r
            val out = LinkedHashMap<String, JsonElement>(r)
            out.putAll(v)
            for (f in CLAIM_FIELDS) { if (r.containsKey(f)) out[f] = r.getValue(f) else out.remove(f) }
            JsonObject(out)
        }
        return Joined(merged, unattached)
    }

    fun forecastClassOf(r: JsonObject?): String? {
        if (r.truthy("forecastClass")) return r.str("forecastClass")
        val x = LinkedHashMap<String, JsonElement>()
        x["forecast"] = JsonPrimitive(true)
        r?.let { x.putAll(it) }
        return Hazards.classifyForecast(JsonObject(x))?.forecastClass
    }

    fun headlineEligible(r: JsonObject?): Boolean {
        val k = forecastClassOf(r) ?: return false
        return Hazards.FORECAST_CLASSES[k]?.headline == true
    }

    fun isForecastRow(r: JsonObject?): Boolean = r.truthy("targetStart") || r.truthy("targetEnd") || r.truthy("forecastKind") || r.truthy("forecastClass")

    data class Partition(val headline: List<JsonObject>, val conditional: List<JsonObject>, val unclassified: List<JsonObject>, val byClass: Map<String, List<JsonObject>>)

    fun partitionByClass(records: List<JsonObject>): Partition {
        val headline = mutableListOf<JsonObject>(); val conditional = mutableListOf<JsonObject>(); val unclassified = mutableListOf<JsonObject>()
        val byClass = LinkedHashMap<String, MutableList<JsonObject>>()
        for (r in records) {
            val isRow = isForecastRow(r)
            val k = if (isRow) forecastClassOf(r) else null
            if (k != null) byClass.getOrPut(k) { mutableListOf() } += r
            if (!isRow) { headline += r; conditional += r; continue }
            if (k == null) unclassified += r
            else if (headlineEligible(r)) headline += r
            else conditional += r
        }
        return Partition(headline, conditional, unclassified, byClass)
    }
}
