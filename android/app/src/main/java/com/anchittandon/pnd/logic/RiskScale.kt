package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.str
import kotlinx.serialization.json.JsonObject

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

    /** Severity wins; the alert only where there is no severity (logic.md §2.3). */
    fun resolve(e: JsonObject?): Level {
        val sv = levelOf(e.str("severity"))
        if (sv != Level.UNKNOWN) return sv
        return levelOf(e.str("alert"))
    }

    fun riskLabel(e: JsonObject?): String = resolve(e).label

    fun matchesRiskLevel(e: JsonObject?, key: String?): Boolean {
        if (key.isNullOrEmpty()) return true
        return resolve(e).name == key
    }

    /** The badge's accessible title (`PND.riskTag` title attribute). */
    fun tagTitle(e: JsonObject?): String {
        val rawAlert = e.str("alert")
        val rawSev = e.str("severity")
        val a = levelOf(rawAlert)
        val sv = levelOf(rawSev)
        if (a == Level.UNKNOWN && sv == Level.UNKNOWN) {
            return "No alert level was published for this record and no severity has been assessed for it."
        }
        val top = if (sv != Level.UNKNOWN) sv else a
        val from = mutableListOf<String>()
        val alertBy = e.str("alertSource").takeUnless { it.isNullOrEmpty() } ?: e.str("source")
        if (a != Level.UNKNOWN) from += "the alert level “$rawAlert”" +
            (if (!alertBy.isNullOrEmpty()) " published by " + Format.shortSource(alertBy) else "")
        if (sv != Level.UNKNOWN) from += "an assessed severity of “$rawSev”"
        return top.label + " on this site’s six-level risk scale, from " + from.joinToString(" and ") +
            (if (a != Level.UNKNOWN && sv != Level.UNKNOWN && a != sv) ". Where these differ the higher decides." else ".")
    }

    /** Map markers use the alert only (`markerIcon(e.alert, e.title)`). */
    fun markerLevel(e: JsonObject?): Level = levelOf(e.str("alert"))

    /** A marker's accessible name. */
    fun markerLabel(value: String?, label: String?): String {
        val lv = levelOf(value)
        return (if (!label.isNullOrEmpty()) "$label - " else "") + lv.label + " risk"
    }
}
