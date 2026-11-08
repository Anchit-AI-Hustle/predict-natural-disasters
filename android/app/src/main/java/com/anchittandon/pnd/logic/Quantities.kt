package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.jsNumText
import com.anchittandon.pnd.model.jsNumber
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
        e.bool("live") == false -> "Not updated for " + quietFor(e)
        else -> "Live"
    }

    /** How long a record has been quiet (`PND.quietFor`, changelog C41): hours under two days, else days, else its age. */
    fun quietFor(e: JsonObject?): String {
        val h = e?.el("quietHours")?.let { jsNumber(it) } ?: Double.NaN
        val d = e?.el("quietDays")?.let { jsNumber(it) } ?: Double.NaN
        if (h.isFinite() && h < 48) return jsNumText(h) + " hour" + (if (h == 1.0) "" else "s")
        if (d.isFinite()) return if (d > 60) Format.age(e.str("updated")).removeSuffix(" ago") else jsNumText(d) + " day" + (if (d == 1.0) "" else "s")
        return "some time"
    }

    /** What a forecast is, said the same way everywhere (`PND.provenanceOf`, changelog C33). */
    fun provenanceOf(e: JsonObject?): String = when {
        e == null || !e.truthy("forecast") -> "Official report"
        e.str("forecastKind") == "model-advance" -> "Made in advance by our model"
        e.str("forecastKind") == "frozen-benchmark" -> "Test case, not made in advance"
        e.str("forecastKind") == "aftershock-sequence" -> "Aftershock forecast, after an earthquake"
        e.truthy("restatesAlert") || e.str("forecastKind") == "signal-derived-outlook" || e.truthy("forecastOf") -> "Restates an agency alert"
        else -> "Our own estimate"
    }

    /** "Of these: ..." under a count of forecasts (`PND.forecastKinds(list).text`). */
    fun <T> forecastKinds(list: List<T>, json: (T) -> JsonObject): String {
        var model = 0; var restated = 0; var after = 0; var test = 0; var other = 0
        list.forEach { val p = provenanceOf(json(it))
            when { p.startsWith("Made in advance") -> model++; p.startsWith("Restates") -> restated++; p.startsWith("Aftershock") -> after++; p.startsWith("Test case") -> test++; else -> other++ } }
        val parts = mutableListOf<String>()
        if (model > 0) parts += "$model made in advance by our weather models"
        if (restated > 0) parts += "$restated restating an agency alert"
        if (after > 0) parts += "$after aftershock forecast" + (if (after == 1) "" else "s")
        if (test > 0) parts += "$test test case" + (if (test == 1) "" else "s")
        if (other > 0) parts += "$other other"
        return if (parts.isEmpty()) "" else "Of these: " + parts.joinToString(", ") + "."
    }

    /**
     * Whether a record is grave enough for the help and needs sections (`PND.lifeSafety`, changelog C40): an agency's own
     * warning, a rating of High or above, or reported deaths or displacement.
     */
    fun lifeSafety(e: JsonObject?): Boolean {
        if (e == null || e.truthy("forecast")) return false
        if (e.str("evidenceState") == "official-warning" && (!e.truthy("officialProduct") || e.str("officialProduct") == "warning")) return true
        if (RiskScale.keyFor(e).rank >= Level.HIGH.rank) return true
        val deaths = e.el("deaths")?.let { jsNumber(it) } ?: Double.NaN
        val displaced = e.el("displaced")?.let { jsNumber(it) } ?: Double.NaN
        return deaths > 0 || displaced > 0
    }

    /** The hazard a type names, matched whole: the HAZARDS key `hazardOf` resolves to, or the trimmed type itself. */
    fun hazardKey(t: String?): String {
        val s = (t ?: "").trim()
        val h = Hazards.hazardOf(s)
        if (h !== Hazards.DEFAULT) Hazards.HAZARDS.entries.firstOrNull { it.value === h }?.let { return it.key }
        return s
    }

    fun sameHazard(a: String?, b: String?): Boolean = hazardKey(a).lowercase(Locale.ROOT) == hazardKey(b).lowercase(Locale.ROOT)

    /** A place box: a continent is the countries on it; a country exactly; anything else a whole word in the place fields (changelog C36). */
    fun inPlace(e: JsonObject?, q: String?): Boolean {
        if (Continents.continentNamed(q).isNotEmpty()) return Continents.onContinent(e, q)
        return CountryNames.inPlace(e, q)
    }

    /** `PND.timezone`: the stored zone, else the device zone, else Asia/Kolkata (logic.md §6.13). */
    fun timezone(stored: String?, device: () -> String?): String {
        if (!stored.isNullOrEmpty()) return Format.zoneName(stored)
        val d = try { device() } catch (e: Exception) { null }
        return if (!d.isNullOrEmpty()) Format.zoneName(d) else "Asia/Kolkata"
    }
}
