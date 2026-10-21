package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * One answer per quantity (portal.js, logic.md §6.10, §6.11 and §6.13). Every screen that states
 * one of these numbers or words takes it from here, so two screens never disagree about it.
 */
object Portal {
    /** What "official warnings" counts, said wherever the number is. */
    const val WARNING_MEANING = "Warnings and watches issued by agencies and in force now. Reports of disasters that already happened are not counted."

    /** `PND.unavailableHtml()`: the card a list shows when nothing has loaded. */
    const val UNAVAILABLE_TITLE = "Live data unavailable."
    const val UNAVAILABLE_BODY = "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically."
    /** What a figure reads when nothing has loaded (`PND.feedDown`). */
    const val UNAVAILABLE = "Unavailable"

    private fun live(e: JsonObject?) = e != null && e.bool("live") != false

    /** Reports: live and not our forecast. */
    fun <T> observed(list: List<T>, json: (T) -> JsonObject): List<T> = list.filter { val e = json(it); live(e) && !e.truthy("forecast") }

    /** Our forecasts whose window has not ended. */
    fun <T> openForecasts(list: List<T>, json: (T) -> JsonObject): List<T> =
        list.filter { val e = json(it); live(e) && e.truthy("forecast") && !e.truthy("windowClosed") }

    /** A report an agency rated Red, Orange or High (exact case). Never one of our forecasts. */
    fun isHighAlert(e: JsonObject?): Boolean = e != null && !e.truthy("forecast") && e.str("alert") in setOf("Red", "Orange", "High")

    /** A warning an agency issued and that is in force (`evidenceState`, else official with an `expiresAt`). */
    fun isOfficialWarning(e: JsonObject?): Boolean {
        if (e == null || e.truthy("forecast")) return false
        if (e.truthy("evidenceState")) return e.text("evidenceState") == "official-warning"
        return e.str("sourceType") == "official" && e.truthy("expiresAt")
    }

    fun <T> officialWarnings(list: List<T>, json: (T) -> JsonObject): List<T> = list.filter { val e = json(it); live(e) && isOfficialWarning(e) }

    /** How many named sources a list comes from. */
    fun <T> sourcesReporting(list: List<T>, json: (T) -> JsonObject): Int = list.mapNotNull { json(it).let { e -> if (e.truthy("source")) e.text("source") else null } }.toSet().size

    /** The data-status word for a record (`PND.liveWord`). */
    fun liveWord(e: JsonObject?): String = when {
        e == null -> "-"
        e.truthy("cached") -> "Saved copy"
        e.truthy("forecast") -> "Our forecast"
        e.bool("live") == false -> "Not updated recently"
        else -> "Live"
    }

    /** The hazard a type names, matched whole: the HAZARDS key `hazardOf` resolves to, or the trimmed type itself. */
    fun hazardKey(t: String?): String {
        val s = (t ?: "").trim()
        val h = Hazards.hazardOf(s)
        if (h !== Hazards.DEFAULT) Hazards.HAZARDS.entries.firstOrNull { it.value === h }?.let { return it.key }
        return s
    }

    fun sameHazard(a: String?, b: String?): Boolean = hazardKey(a).lowercase(Locale.ROOT) == hazardKey(b).lowercase(Locale.ROOT)

    /** A place box: a continent is the countries on it; anything else matches the place fields or `countries[]`. */
    fun inPlace(e: JsonObject?, q: String?): Boolean {
        if (Continents.continentNamed(q).isNotEmpty()) return Continents.onContinent(e, q)
        val t = (q ?: "").lowercase(Locale.ROOT).trim()
        return Search.matchesPlace(e, t) || (e.arr("countries")?.any { c -> (if (c is JsonPrimitive) c.content else c.toString()).lowercase(Locale.ROOT).contains(t) } == true)
    }

    /** `PND.timezone`: the stored zone, else the device zone, else Asia/Kolkata (logic.md §6.13). */
    fun timezone(stored: String?, device: () -> String?): String {
        if (!stored.isNullOrEmpty()) return stored
        val d = try { device() } catch (e: Exception) { null }
        return if (!d.isNullOrEmpty()) d else "Asia/Kolkata"
    }
}
