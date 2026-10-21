package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject

/** forecast-table.js cells (logic.md §7). */
object ForecastTable {
    fun place(e: JsonObject): String = listOf(e.text("region"), e.text("country")).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Global" }
    fun hazard(e: JsonObject): String = e.text("type").ifEmpty { "-" }
    fun starts(e: JsonObject): String = if (e.truthy("targetStart")) Format.fmtWhen(e.str("targetStart"), e.text("targetEnd").ifEmpty { null }) else "-"
    fun ends(e: JsonObject): String = if (e.truthy("targetEnd")) Format.fmtWhen(e.str("targetEnd"), e.text("targetStart").ifEmpty { null }, "end") else "-"
    fun classLabel(e: JsonObject): String {
        val k = e.text("forecastClass")
        if (k.isEmpty()) return "Not recorded"
        return Hazards.FORECAST_CLASSES[k]?.label ?: k
    }
    fun classDefinition(e: JsonObject): String =
        Hazards.FORECAST_CLASSES[e.text("forecastClass")]?.definition ?: "We did not record what kind of forecast this is."
    fun provenance(e: JsonObject): String = when {
        !e.truthy("forecast") -> "Official report"
        e.str("forecastKind") == "frozen-benchmark" -> "Test case"
        e.truthy("forecastOf") -> "Our estimate"
        else -> "Our own estimate"
    }
    fun source(e: JsonObject): String {
        val s = e.text("source")
        val m = Regex("^Predict Natural Disasters · derived from (.+)$").matchEntire(s)
        return if (m != null) "From " + m.groupValues[1] else s
    }
    fun window(e: JsonObject): String = if (e.truthy("targetStart") || e.truthy("targetEnd")) Format.windowText(e) else "No dates recorded"
    fun status(e: JsonObject): String = when {
        !e.truthy("forecast") -> "Reported event"
        e.truthy("windowClosed") -> "Ended"
        else -> "Active"
    }
}

/** backtest-view.js (logic.md §10.8). */
object Backtest {
    data class Row(
        val hazard: String, val label: String, val threshold: String, val lead: Int, val days: Long,
        val happened: Long, val warned: Long, val hits: Long,
        val caught: Double?, val caughtByChance: Double, val rightWhenWarned: Double?, val rightByChance: Double,
    )

    val HAZARDS = listOf(
        Triple("heat", "Extreme heat", "a daily high at or above the place’s 95th percentile for the date"),
        Triple("rain", "Heavy rain", "rain at or above the place’s 99th percentile for the month, and at least 10 mm"),
        Triple("fire", "Wildfire weather", "a Fire Weather Index in the “very high” class and at or above the place’s 95th percentile"),
    )
    val LEADS = listOf(3, 5)

    private fun count(o: JsonObject?, k: String): Long? {
        val p = o?.get(k) as? kotlinx.serialization.json.JsonPrimitive ?: return null
        if (p.isString) return null
        val v = p.content.toDoubleOrNull() ?: return null
        return if (v.isFinite() && v >= 0) v.toLong() else null
    }

    fun rows(doc: JsonObject?): List<Row>? {
        if (doc == null) return null
        val results = doc.obj("results") ?: return null
        if (!(doc.jsNum("places") > 0)) return null
        val out = mutableListOf<Row>()
        for ((hazard, label, threshold) in HAZARDS) for (lead in LEADS) {
            val t = results.obj("$hazard@$lead") ?: return null
            val h = count(t, "hits") ?: return null; val m = count(t, "misses") ?: return null
            val f = count(t, "falseAlarms") ?: return null; val c = count(t, "correctNegatives") ?: return null
            val days = h + m + f + c
            if (days == 0L) return null
            out += Row(hazard, label, threshold, lead, days, h + m, h + f, h,
                if (h + m > 0) h.toDouble() / (h + m) else null, (h + f).toDouble() / days,
                if (h + f > 0) h.toDouble() / (h + f) else null, (h + m).toDouble() / days)
        }
        return out
    }

    fun pct(v: Double?): String = if (v == null) "Cannot be calculated" else "${jsRoundL(v * 100)}%"

    /** `toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'})` of a whole day. */
    fun day(t: String?): String {
        val ms = JsDate.parse((t ?: "").take(10) + "T00:00:00Z") ?: return t ?: ""
        val z = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC)
        val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
        return "${z.dayOfMonth} ${months[z.monthValue - 1]} ${z.year}"
    }
}
