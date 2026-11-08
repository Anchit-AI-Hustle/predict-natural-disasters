package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import java.util.Locale

/** The shape that goes with each level, so a level is never shown by colour alone. */
enum class RiskShape { CIRCLE, RING, TRIANGLE, DIAMOND, HEXAGON, STAR, HOLLOW }

/** risk.js LEVELS plus UNKNOWN, which is the absence of a level, not a seventh one. */
enum class Level(val label: String, val colour: Long?, val ink: Long?, val rank: Int, val shape: RiskShape, val shapeName: String) {
    LOW("Low", 0xFF22C55E, 0xFF000000, 1, RiskShape.CIRCLE, "filled circle"),
    WATCH("Watch", 0xFFFACC15, 0xFF000000, 2, RiskShape.RING, "ring"),
    MODERATE("Moderate", 0xFFF97316, 0xFF000000, 3, RiskShape.TRIANGLE, "triangle"),
    HIGH("High", 0xFFEF4444, 0xFF000000, 4, RiskShape.DIAMOND, "diamond"),
    SEVERE("Severe", 0xFFB91C1C, 0xFFFFFFFF, 5, RiskShape.HEXAGON, "hexagon"),
    EXTREME("Extreme", 0xFF7C3AED, 0xFFFFFFFF, 6, RiskShape.STAR, "star"),
    UNKNOWN("Not rated", null, null, 0, RiskShape.HOLLOW, "hollow circle");

    val markerSize: Int get() = 9 + rank * 3
    /** The square a marker can be tapped in: at least 24, centred on the mark, which keeps its own size (map-setup.js riskMarker). */
    val tapSize: Int get() = maxOf(24, markerSize)
    val key: String get() = name
}

object RiskScale {
    /** Strongest first; whole words only (logic.md §2.2). */
    private val VOCABULARY = listOf(
        Level.EXTREME to Regex("\\b(?:extreme|catastrophic|very\\s*high|purple)\\b", RegexOption.IGNORE_CASE),
        Level.SEVERE to Regex("\\b(?:severe|critical)\\b", RegexOption.IGNORE_CASE),
        Level.HIGH to Regex("\\b(?:high|red|significant)\\b", RegexOption.IGNORE_CASE),
        Level.MODERATE to Regex("\\b(?:moderate|orange)\\b", RegexOption.IGNORE_CASE),
        Level.WATCH to Regex("\\b(?:watch|advisory|minor|yellow|amber|elevated)\\b", RegexOption.IGNORE_CASE),
        Level.LOW to Regex("\\b(?:low|green|informational|routine|normal)\\b", RegexOption.IGNORE_CASE),
    )

    /** The six levels, highest first, then Not rated (`riskLevelOptions`). */
    val filterOptions: List<Pair<String, String>> =
        listOf(Level.EXTREME, Level.SEVERE, Level.HIGH, Level.MODERATE, Level.WATCH, Level.LOW).map { it.name to it.label } +
            ("UNKNOWN" to "Not rated")

    fun levelOf(value: String?): Level {
        val s = value ?: ""
        if (s.isBlank()) return Level.UNKNOWN
        for ((k, re) in VOCABULARY) if (re.containsMatchIn(s)) return k
        return Level.UNKNOWN
    }

    fun byKey(key: String?): Level = Level.entries.firstOrNull { it.name == key } ?: Level.UNKNOWN

    /**
     * The one level a record resolves to (risk.js `keyFor`, changelog C31), for the badge, the filter, the calendar bar and
     * the map marker alike: a weather model's forecast is its own alert (High, Moderate); anything else its severity,
     * else its alert; a named storm is floored at its category; an M6+ earthquake with no PAGER and no alert is Not rated.
     */
    fun keyFor(e: JsonObject?): Level {
        if (e == null) return Level.UNKNOWN
        var key = if (e.str("forecastKind") == "model-advance" && levelOf(e.str("alert")) != Level.UNKNOWN) levelOf(e.str("alert"))
        else { val sv = levelOf(e.str("severity")); if (sv != Level.UNKNOWN) sv else levelOf(e.str("alert")) }
        val mag = e.jsNum("magnitude")
        if (!e.truthy("forecast") && key == Level.LOW && mag.isFinite() && mag >= 6 && !e.truthy("pagerAlert") &&
            levelOf(e.str("alert")) == Level.UNKNOWN) return Level.UNKNOWN
        val floor = SEVERITY_KEY[Hazards.cycloneCategoryRank(e)]
        if (floor != null && (key == Level.UNKNOWN || floor.rank > key.rank)) key = floor
        return key
    }

    /** risk.js `SEVERITY_KEY`: the severity scale's ranks on the six levels. */
    val SEVERITY_KEY = mapOf(1 to Level.LOW, 2 to Level.WATCH, 3 to Level.MODERATE, 4 to Level.SEVERE, 5 to Level.EXTREME)

    /** Whose impact estimate a level is, where an agency set it ("USGS PAGER green", "GDACS orange"), else null. */
    fun basisFor(e: JsonObject?, key: Level): String? {
        if (e == null || e.truthy("forecast")) return null
        val pager = e.text("pagerAlert").lowercase(Locale.ROOT)
        if (pager.isNotEmpty() && levelOf(pager) == key) return "USGS PAGER $pager"
        val alert = e.str("alert") ?: ""
        val colour = if (Regex("^(green|yellow|orange|red)$", RegexOption.IGNORE_CASE).matches(alert)) alert.lowercase(Locale.ROOT) else ""
        val src = e.str("alertSource")?.takeIf { e.truthy("alertSource") } ?: (e.str("source") ?: "")
        if (colour.isNotEmpty() && Regex("gdacs", RegexOption.IGNORE_CASE).containsMatchIn(src) && levelOf(colour) == key &&
            e.str("alertBasis") != "derived-from-intensity") return "GDACS $colour"
        return null
    }

    data class Described(val key: Level, val basis: String?) {
        val label: String get() = key.label
        /** The badge text: "Low expected impact (USGS PAGER green)" where an agency set the level, else the label. */
        val text: String get() = if (basis != null) "${key.label} expected impact ($basis)" else key.label
    }

    /** risk.js `describe`. */
    fun describe(e: JsonObject?): Described {
        val k = keyFor(e)
        return Described(k, if (k == Level.UNKNOWN) null else basisFor(e, k))
    }

    /** The level a record resolves to (`PND.riskKey`, an alias of `keyFor`). */
    fun resolve(e: JsonObject?): Level = keyFor(e)

    fun riskLabel(e: JsonObject?): String = resolve(e).label

    /** `PND.riskWords`: the level in words that say where it came from, where an agency set it. */
    fun riskWords(e: JsonObject?): String {
        val d = describe(e)
        if (e == null) return d.label
        if (d.basis != null) return d.text
        val type = e.text("type")
        val quake = Regex("earthquake", RegexOption.IGNORE_CASE).containsMatchIn(type) && !Regex("aftershock", RegexOption.IGNORE_CASE).containsMatchIn(type)
        val src = e.str("alertSource")?.takeIf { e.truthy("alertSource") } ?: e.text("source")
        if (d.key == Level.LOW && quake && Regex("^USGS\\b").containsMatchIn(src) && !e.truthy("pagerAlert") && !e.truthy("forecast"))
            return "Low (no USGS PAGER impact alert issued)"
        return d.label
    }

    fun matchesRiskLevel(e: JsonObject?, key: String?): Boolean {
        if (key.isNullOrEmpty()) return true
        return resolve(e).name == key
    }

    /** The risk filter's options for these records (`riskLevelOptions(selected, records)`): only levels they hold, plus the chosen one. */
    fun filterOptions(records: List<JsonObject>?, selected: String? = null): List<Pair<String, String>> {
        if (records == null) return filterOptions
        val have = records.map { keyFor(it).name }.toSet()
        return filterOptions.filter { it.first in have || it.first == selected }
    }

    /** The badge's text (`PND.riskTag`): `describe(e).text`, "Not rated" for no level. */
    fun tagText(e: JsonObject?): String = describe(e).let { if (it.key == Level.UNKNOWN) "Not rated" else it.text }

    /** The badge's accessible title (`PND.riskTag` title attribute). */
    fun tagTitle(e: JsonObject?): String {
        val rawAlert = e.str("alert")
        val rawSev = e.str("severity")
        val a = levelOf(rawAlert)
        val sv = levelOf(rawSev)
        val top = keyFor(e)
        if (top == Level.UNKNOWN) {
            val mag = e?.jsNum("magnitude") ?: Double.NaN
            return if (mag.isFinite() && mag >= 6) "No impact assessment has been published for this earthquake yet, so it has no level. Its magnitude is a measurement, not a level."
            else "No alert level was published for this record and no severity has been assessed for it."
        }
        val from = mutableListOf<String>()
        val alertBy = e.str("alertSource").takeUnless { it.isNullOrEmpty() } ?: e.str("source")
        if (a != Level.UNKNOWN) from += "the alert level “$rawAlert”" +
            (if (!alertBy.isNullOrEmpty()) " published by " + Format.shortSource(alertBy) else "")
        if (sv != Level.UNKNOWN) from += "an assessed severity of “$rawSev”"
        if (SEVERITY_KEY[Hazards.cycloneCategoryRank(e)] == top && top != (if (sv != Level.UNKNOWN) sv else a)) from += "the storm’s category, which is a floor"
        if (e.str("forecastKind") == "model-advance") { from.clear(); from += "our weather model: High where the place’s 99th percentile is forecast to be crossed, Moderate for its 95th" }
        return top.label + " on this site’s six-level risk scale, from " + (from.joinToString(" and ").ifEmpty { "its record" }) + "."
    }

    /** Map markers take the record's one level (`riskMarker` given the record, changelog C31). */
    fun markerLevel(e: JsonObject?): Level = keyFor(e)

    /** A marker's accessible name. */
    fun markerLabel(value: String?, label: String?): String {
        val lv = levelOf(value)
        return (if (!label.isNullOrEmpty()) "$label - " else "") + lv.label + " risk"
    }
}
