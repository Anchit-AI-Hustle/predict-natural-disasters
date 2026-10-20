package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import java.text.Collator
import java.util.Locale

/** `PND.SORT_DEFS` and the per-screen extras (logic.md §8). */
object Sorts {
    /** `localeCompare` with the default (ICU root) collation. */
    val collator: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.TERTIARY }

    private val RISK_RANK = mapOf("red" to 5, "critical" to 5, "orange" to 4, "high" to 4, "veryhigh" to 4, "moderate" to 3, "watch" to 2, "green" to 1, "low" to 1)

    fun rankOf(e: JsonObject?): Int {
        val r = e.jsNum("severityRank")
        if (r.isFinite() && r > 0) return r.toInt()
        return RISK_RANK[e.text("alert").lowercase(Locale.ROOT)] ?: 0
    }

    fun rankOfD(e: JsonObject?): Double {
        val r = e.jsNum("severityRank")
        if (r.isFinite() && r > 0) return r
        return (RISK_RANK[e.text("alert").lowercase(Locale.ROOT)] ?: 0).toDouble()
    }

    fun timeOf(e: JsonObject?): Long {
        val v = when { e.truthy("updated") -> e.str("updated"); e.truthy("targetStart") -> e.str("targetStart"); e.truthy("startedAt") -> e.str("startedAt"); else -> "" }
        return JsDate.parse(v) ?: 0L
    }

    private fun numOf(e: JsonObject?, k: String): Double = e.jsNum(k).let { if (it.isFinite()) it else 0.0 }

    const val MISSING = "￿"

    fun textOf(e: JsonObject?, vararg keys: String): String {
        for (k in keys) if (e.truthy(k)) return Glossary.expandAlways(e.str(k) ?: "").lowercase(Locale.ROOT)
        return MISSING
    }

    private fun sign(x: Double): Int = if (x.isNaN()) 0 else if (x < 0) -1 else if (x > 0) 1 else 0
    private fun cmpL(a: Long, b: Long): Int = a.compareTo(b)
    private fun locale(a: String, b: String): Int = collator.compare(a, b)

    data class SortDef(val label: String, val cmp: Comparator<JsonObject>)

    private infix fun Int.or(next: () -> Int): Int = if (this != 0) this else next()

    val SORT_DEFS: Map<String, SortDef> = linkedMapOf(
        "severity" to SortDef("Most serious first", Comparator { a, b -> sign(rankOfD(b) - rankOfD(a)) or { cmpL(timeOf(b), timeOf(a)) } }),
        "newest" to SortDef("Newest first", Comparator { a, b -> cmpL(timeOf(b), timeOf(a)) }),
        "oldest" to SortDef("Oldest first", Comparator { a, b -> cmpL(timeOf(a), timeOf(b)) }),
        "deaths" to SortDef("Most deaths first", Comparator { a, b -> sign(numOf(b, "deaths") - numOf(a, "deaths")) or { cmpL(timeOf(b), timeOf(a)) } }),
        "affected" to SortDef("Most people affected first", Comparator { a, b ->
            sign(numOf(b, "affected") - numOf(a, "affected")) or { sign(numOf(b, "displaced") - numOf(a, "displaced")) } or { cmpL(timeOf(b), timeOf(a)) }
        }),
        "country" to SortDef("Place (A to Z)", Comparator { a, b -> locale(textOf(a, "place", "country", "region"), textOf(b, "place", "country", "region")) or { cmpL(timeOf(b), timeOf(a)) } }),
        "type" to SortDef("Type of hazard (A to Z)", Comparator { a, b -> locale(textOf(a, "type"), textOf(b, "type")) or { sign(rankOfD(b) - rankOfD(a)) } }),
        "source" to SortDef("Source (A to Z)", Comparator { a, b -> locale(textOf(a, "source"), textOf(b, "source")) or { cmpL(timeOf(b), timeOf(a)) } }),
        "title" to SortDef("Name (A to Z)", Comparator { a, b -> locale(textOf(a, "title", "name"), textOf(b, "title", "name")) }),
        "distance" to SortDef("Nearest first", Comparator { a, b -> sign(dist(a) - dist(b)) }),
        // Open windows first, soonest end first; ended ones (end <= now, or windowClosed) after, most recent first.
        "windowEnd" to SortDef("Ending soonest first", Comparator { a, b ->
            val now = AppClock.now().toDouble()
            val x = (JsDate.parse(a.text("targetEnd"))?.takeIf { it != 0L }?.toDouble()) ?: Double.POSITIVE_INFINITY
            val y = (JsDate.parse(b.text("targetEnd"))?.takeIf { it != 0L }?.toDouble()) ?: Double.POSITIVE_INFINITY
            val xa = x <= now || a.truthy("windowClosed"); val ya = y <= now || b.truthy("windowClosed")
            if (xa != ya) (if (xa) 1 else -1) else if (xa) sign(y - x) else sign(x - y)
        }),
        "yearNew" to SortDef("Most recent first", Comparator { a, b -> sign(numOf(b, "sort") - numOf(a, "sort")) }),
        "yearOld" to SortDef("Earliest first", Comparator { a, b -> sign(numOf(a, "sort") - numOf(b, "sort")) }),
        "name" to SortDef("Name (A to Z)", Comparator { a, b -> locale(textOf(a, "name", "title"), textOf(b, "name", "title")) }),
        "countDesc" to SortDef("Most events first", Comparator { a, b -> sign(numOf(b, "count") - numOf(a, "count")) }),
        "countAsc" to SortDef("Fewest events first", Comparator { a, b -> sign(numOf(a, "count") - numOf(b, "count")) }),
        // Screen-specific definitions.
        "nearby" to SortDef("Distance: nearest first", Comparator { _, _ -> 0 }),
        "priority" to SortDef("Most high alerts first", Comparator { a, b -> sign(numOf(b, "high") - numOf(a, "high")) or { sign(numOf(b, "count") - numOf(a, "count")) } }),
        "curated" to SortDef("Suggested order", Comparator { _, _ -> 0 }),
        "nameDesc" to SortDef("Name - Z to A", Comparator { a, b -> locale(textOf(b, "name", "title"), textOf(a, "name", "title")) }),
        "recorded" to SortDef("Date recorded - newest first", Comparator { a, b -> cmpL(recordedOf(b), recordedOf(a)) }),
        "hazard" to SortDef("Hazard type - A to Z", Comparator { a, b ->
            locale(a.firstTextOr("hazard", "type").lowercase(Locale.ROOT), b.firstTextOr("hazard", "type").lowercase(Locale.ROOT))
        }),
        "observed" to SortDef("Actual severity - highest first", Comparator { a, b -> (observedRank(b) - observedRank(a)) or { cmpL(recordedOf(b), recordedOf(a)) } }),
    )

    private fun JsonObject.firstTextOr(vararg keys: String): String {
        for (k in keys) if (truthy(k)) return str(k) ?: ""
        return MISSING
    }

    private val OBSERVED_RANK = mapOf("CATASTROPHIC" to 6, "EXTREME" to 5, "SEVERE" to 4, "SIGNIFICANT" to 3, "MODERATE" to 2, "MINOR" to 1)
    fun observedRank(r: JsonObject?): Int = OBSERVED_RANK[r.text("observedSeverity").uppercase(Locale.ROOT)] ?: 0
    private fun recordedOf(r: JsonObject): Long = JsDate.parse(if (r.truthy("recordedAt")) r.text("recordedAt") else r.text("observedAt")) ?: 0L

    /** Distances are attached as `_d` on the JSON by callers that sort by distance. */
    private fun dist(e: JsonObject): Double = e.jsNum("_d").let { if (it.isFinite()) it else Double.POSITIVE_INFINITY }

    val EVENT_SORTS = listOf("newest", "severity", "oldest", "deaths", "affected", "country", "type", "source", "title")
    val FORECASTS_TAB = listOf("severity", "windowEnd", "newest", "oldest", "country", "type", "title")
    val FORECAST_LIST = listOf("newest", "severity", "windowEnd", "oldest", "country", "type", "title")
    val HISTORICAL = listOf("newest", "oldest", "severity", "country", "type", "title")
    val NEARBY = listOf("newest", "distance", "severity", "oldest", "type", "title")
    val LOCATION = listOf("distance") + EVENT_SORTS
    val MY_PLACES = listOf("nearby", "severity", "newest", "type", "country")
    val REGIONS = listOf("newest", "priority", "countDesc", "countAsc", "name")
    val SOURCES = listOf("curated", "name", "nameDesc")
    val LEDGER = listOf("recorded", "windowEnd", "observed", "hazard", "country", "title")
    val HISTORY_RELATED = listOf("yearNew", "yearOld", "name", "type")

    fun label(key: String): String = SORT_DEFS[key]?.label ?: key

    /** A sorted copy (stable); an unknown key leaves the order. */
    fun <T> sort(list: List<T>, key: String?, json: (T) -> JsonObject): List<T> {
        val def = SORT_DEFS[key] ?: return list.toList()
        return list.sortedWith { a, b -> def.cmp.compare(json(a), json(b)) }
    }

    /** Regions groups compare by `latest` for newest. */
    val REGION_NEWEST: Comparator<JsonObject> = Comparator { a, b -> sign(numOf(b, "latest") - numOf(a, "latest")) }
}
