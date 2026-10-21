package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.has
import com.anchittandon.pnd.model.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** glossary.js `expandAlways` (logic.md §9.2): stateless, applied to titles, search and sort. */
object Glossary {
    private val BEARINGS = linkedMapOf(
        "N" to "north", "S" to "south", "E" to "east", "W" to "west",
        "NE" to "north-east", "NW" to "north-west", "SE" to "south-east", "SW" to "south-west",
        "NNE" to "north-north-east", "ENE" to "east-north-east", "ESE" to "east-south-east",
        "SSE" to "south-south-east", "SSW" to "south-south-west", "WSW" to "west-south-west",
        "WNW" to "west-north-west", "NNW" to "north-north-west",
    )
    private val MAGNITUDES = linkedMapOf("mw" to "moment magnitude", "mb" to "body-wave magnitude",
        "ml" to "local magnitude", "ms" to "surface-wave magnitude")
    private val STATES = linkedMapOf(
        "AK" to "Alaska", "CT" to "Connecticut", "DC" to "District of Columbia", "FL" to "Florida",
        "HI" to "Hawaii", "IA" to "Iowa", "KS" to "Kansas", "MI" to "Michigan", "NH" to "New Hampshire",
        "NJ" to "New Jersey", "NM" to "New Mexico", "NV" to "Nevada", "NY" to "New York", "OH" to "Ohio",
        "OK" to "Oklahoma", "OR" to "Oregon", "RI" to "Rhode Island", "TX" to "Texas", "UT" to "Utah",
        "VT" to "Vermont", "WA" to "Washington", "WI" to "Wisconsin", "WV" to "West Virginia",
        "WY" to "Wyoming",
    )
    /** First-use expansions for prose (never for badges, pills, headings or cards). */
    val ONCE = listOf(
        "NASA EONET" to "National Aeronautics and Space Administration Earth Observatory Natural Event Tracker",
        "UN OCHA" to "United Nations Office for the Coordination of Humanitarian Affairs",
        "GDACS" to "Global Disaster Alert and Coordination System",
        "USGS" to "United States Geological Survey",
        "NOAA" to "National Oceanic and Atmospheric Administration",
        "EONET" to "Earth Observatory Natural Event Tracker",
        "NASA" to "National Aeronautics and Space Administration",
        "EMSC" to "European-Mediterranean Seismological Centre",
        "NDMA" to "National Disaster Management Authority",
        "IMD" to "India Meteorological Department",
        "NWS" to "National Weather Service",
        "NHC" to "National Hurricane Center",
        "WMO" to "World Meteorological Organization",
        "IFRC" to "International Federation of Red Cross and Red Crescent Societies",
        "IST" to "India Standard Time",
        "UTC" to "Coordinated Universal Time",
    )

    private val bearingRe = Regex("\\b(" + BEARINGS.keys.joinToString("|") + ")\\s+of\\b")
    private val magPrefixRe = Regex("\\bM\\s+(\\d(?:\\.\\d+)?)")
    private val magNamedRe = Regex("\\bMagnitude\\s+(\\d(?:\\.\\d+)?)\\s+(" + MAGNITUDES.keys.joinToString("|") + ")\\b")
    private val stateRe = Regex(",\\s(" + STATES.keys.joinToString("|") + ")\\b")

    fun expandAlways(text: String): String = text
        .replace(bearingRe) { BEARINGS.getValue(it.groupValues[1]) + " of" }
        .replace(magPrefixRe) { "Magnitude " + it.groupValues[1] }
        .replace(magNamedRe) { MAGNITUDES.getValue(it.groupValues[2]).replaceFirstChar { c -> c.uppercase() } + " " + it.groupValues[1] }
        .replace(stateRe) { ", " + STATES.getValue(it.groupValues[1]) }

    /** Prose: expand each acronym the first time it appears in this text. */
    fun prose(text: String): String {
        var out = expandAlways(text)
        if (Regex("[A-Z]").containsMatchIn(out) && !Regex("[a-z]").containsMatchIn(out)) return out
        val spelled = HashSet<String>()
        val re = Regex("\\b(" + ONCE.joinToString("|") { Regex.escape(it.first).replace("\\Q", "").replace("\\E", "") } + ")\\b")
        val full = ONCE.toMap()
        out = re.replace(out) { m ->
            val term = m.groupValues[1]
            if (term in spelled) return@replace m.value
            spelled += term
            val f = full.getValue(term)
            if (text.lowercase(Locale.ROOT).contains(f.lowercase(Locale.ROOT))) return@replace m.value
            val s = m.range.first; val e = m.range.last + 1
            val bracketed = s > 0 && out.getOrNull(s - 1) == '(' && out.getOrNull(e) == ')'
            if (bracketed) f else "$f ($term)"
        }
        return out
    }
}

/** search.js (logic.md §9.1). */
object Search {
    val SEARCH_FIELDS = listOf("title", "name", "country", "affectedCountries", "region", "location", "type", "hazard",
        "source", "src", "details", "summary", "id", "eventId")
    private val PLACE_FIELDS = listOf("country", "affectedCountries", "region", "location")

    private fun jsString(v: JsonElement): String = when (v) {
        is JsonPrimitive -> v.content
        is JsonArray -> v.joinToString(",") { if (it is JsonPrimitive) it.content else jsString(it) }
        else -> "[object Object]"
    }

    fun searchText(e: JsonObject?): String {
        if (e == null) return ""
        var t = SEARCH_FIELDS.filter { e.has(it) }.mapNotNull { e.el(it) }.joinToString(" ") { jsString(it) }
        t += " " + Glossary.expandAlways(t)
        return t.lowercase(Locale.ROOT)
    }

    private fun terms(q: String?) = (q ?: "").lowercase(Locale.ROOT).split(Regex("\\s+")).filter { it.isNotEmpty() }

    fun matches(e: JsonObject?, q: String?, cached: String? = null): Boolean {
        val ts = terms(q)
        if (ts.isEmpty()) return true
        val t = cached ?: searchText(e)
        return ts.all { t.contains(it) }
    }

    fun matchesPlace(e: JsonObject?, q: String?): Boolean {
        val ts = terms(q)
        if (ts.isEmpty()) return true
        val t = PLACE_FIELDS.filter { e.has(it) }.mapNotNull { e.el(it) }.joinToString(" ") { jsString(it) }.lowercase(Locale.ROOT)
        return ts.all { t.contains(it) }
    }

    /** What an empty list says (search.js emptyHtml), as structured text. */
    data class EmptyState(val title: String, val body: String? = null, val buttonLabel: String? = null, val buttonQuery: String? = null) {
        /** The website's markup, for parity tests. */
        fun toHtml(): String {
            val sb = StringBuilder("<div class=\"card\"><b>").append(esc(title)).append("</b>")
            if (body != null) sb.append("<p class=\"muted\">").append(esc(body)).append("</p>")
            if (buttonLabel != null) sb.append("<p><a class=\"btn\" href=\"/events?q=").append(Format.enc(buttonQuery ?: "")).append("\">").append(buttonLabel).append("</a></p>")
            return sb.append("</div>").toString()
        }
        private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
    }

    /** `PNDSearch.countryCount`: the same rule as `PND.countryCount`. */
    fun countryCount(list: List<JsonObject>): Int = Format.countryCount(list)

    fun emptyState(query: String?, pool: List<JsonObject>, all: List<JsonObject>?, noun: String): EmptyState {
        val q = (query ?: "").trim()
        if (q.isEmpty()) return EmptyState("No $noun to show right now.")
        val whole = all ?: pool
        val elsewhere = whole.count { matches(it, q) }
        val title = "No $noun match “$q”."
        if (elsewhere > 0) {
            return EmptyState(title,
                "$elsewhere other event" + (if (elsewhere == 1) "" else "s") + " in our current data " + (if (elsewhere == 1) "matches" else "match") +
                    " this search. This page shows only $noun.",
                "See " + (if (elsewhere == 1) "it" else "all $elsewhere") + " on the events page →", q)
        }
        // Reports only, counted as every screen counts them (changelog C15).
        val reports = Portal.observed(whole) { it }
        val n = countryCount(reports)
        return EmptyState(title,
            "Nothing in our current data matches it. Right now we have ${reports.size} event" + (if (reports.size == 1) "" else "s") +
                " from $n" + (if (n == 1) " country or territory" else " countries and territories") + ". " +
                "We only show what official sources are reporting. If a place has no current official report, it is not listed here. " +
                "That does not mean nothing is happening there.")
    }
}
