package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsNumText
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.jsRound
import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.time
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** One notification, as alert-rules.js and the major-event rule build it. */
data class Alert(val key: String, val eventId: String, val rank: Double, val title: String, val body: String, val url: String, val tag: String)

/** alert-rules.js plus the major-event rule from portal.js (logic.md §4, features.md §16.2). */
object AlertRules {
    const val NEAR_KM = 30.0
    const val SEVERE_NEAR_KM = 100.0
    const val RECENT_HOURS = 72
    const val DEDUP_MS = 21_600_000L
    private val SEVERE = Regex("red|orange|severe|extreme|catastrophic", RegexOption.IGNORE_CASE)

    private val KIND_LABEL = mapOf("Home" to "home", "Office" to "office", "Family" to "family place", "Travel" to "travel place", "Current location" to "current location")

    fun urlFor(e: JsonObject?): String = Format.eventUrl(e)

    fun roundCoord(v: JsonElement?): Double? {
        if (v == null || v is JsonNull) return null
        if (v is JsonPrimitive && v.isString && v.content.isBlank()) return null
        val n = jsNumber(v)
        return if (n.isFinite()) jsRound(n * 100) / 100 else null
    }

    fun placeLabel(place: JsonObject?): String = "your " + (KIND_LABEL[place.str("kind")] ?: "saved place")

    fun live(e: JsonObject?, now: Long): Boolean {
        if (e == null || e.truthy("forecast") || e.truthy("isForecast")) return false
        if (e.truthy("cached")) return false
        if (e.bool("live") == false) return false
        if (e.str("evidenceState") == "official-warning") {
            val exp = e.time("expiresAt")
            return exp == null || exp > now
        }
        val latest = maxOf(e.time("updated") ?: 0L, e.time("startedAt") ?: 0L, e.time("issuedAt") ?: 0L)
        return latest > 0 && now - latest <= RECENT_HOURS * 3_600_000L
    }

    fun alertFor(e: JsonObject?, place: JsonObject?, now: Long): Alert? {
        if (!live(e, now)) return null
        val r = Hazards.riskRow(e, place) ?: return null
        val level = e.firstText("alert", "severity")
        val what = e.text("type").ifEmpty { "Hazard" }
        var title: String? = null
        var rank = 0.0
        val d = r.distanceKm
        if (r.band == "B" && r.containment == true) {
            title = "$what warning covers ${placeLabel(place)}"; rank = 3.0
        } else if (r.band == "A" && r.containment == true) {
            title = "$what reported where ${placeLabel(place)} is"; rank = 3.0
        } else if (r.band == "A" && r.claimDistance && d != null && d <= SEVERE_NEAR_KM && (SEVERE.containsMatchIn(level) || d <= NEAR_KM)) {
            title = "$what ${maxOf(1L, jsRoundL(d))} km from ${placeLabel(place)}"; rank = 2 - d / 1000
        }
        if (title == null) return null
        val id = idText(e)
        val source = if (e.truthy("source")) " · " + e.str("source") else ""
        return Alert("$id|${r.band}|${level.lowercase(Locale.ROOT)}", id, rank, title,
            e.text("title").ifEmpty { what } + (if (level.isNotEmpty()) " · $level" else "") + source,
            urlFor(e), "pnd-$id")
    }

    private fun idText(e: JsonObject?): String = when (val v = e.el("id")) {
        null -> "undefined"
        is JsonPrimitive -> if (v.isString) v.content else jsNumText(jsNumber(v)).let { if (v.content == "true" || v.content == "false") v.content else it }
        else -> v.toString()
    }

    private fun JsonObject?.firstText(vararg keys: String): String {
        for (k in keys) if (truthy(k)) return str(k) ?: ""
        return ""
    }

    fun alertsFor(events: List<JsonObject>, places: List<JsonObject>, now: Long): List<Alert> {
        val best = LinkedHashMap<String, Alert>()
        for (p in places) for (e in events) {
            val a = alertFor(e, p, now) ?: continue
            val cur = best[a.eventId]
            if (cur == null || a.rank > cur.rank) best[a.eventId] = a
        }
        return best.values.sortedWith { a, b -> b.rank.compareTo(a.rank) }
    }

    /** The major global event rule (portal.js), with its title precedence: M6.5, tsunami, cyclone, red. */
    fun majorAlert(e: JsonObject?, now: Long): Alert? {
        if (e == null || e.truthy("forecast") || e.truthy("isForecast") || e.bool("live") == false || e.truthy("cached")) return null
        val t = JsDate.parse(e.firstText("updated", "startedAt", "issuedAt")) ?: return null
        if (now - t > 72 * 3_600_000L) return null
        val type = e.text("type"); val title = e.text("title")
        val isRed = e.str("alert") == "Red" && e.str("sourceType") == "official"
        val isM65 = type == "Earthquake" && e.jsNum("magnitude") >= 6.5
        val isTsunami = Regex("tsunami", RegexOption.IGNORE_CASE).containsMatchIn(type.ifEmpty { title })
        val isSevereCyclone = Regex("cyclone|typhoon|hurricane", RegexOption.IGNORE_CASE).containsMatchIn(type) &&
            (Regex("cat(egory)?\\s*[345]|severe|super", RegexOption.IGNORE_CASE).containsMatchIn(e.firstText("severity", "title")) || e.str("alert") == "Red")
        if (!isRed && !isM65 && !isTsunami && !isSevereCyclone) return null
        val id = idText(e)
        val key = "major-$id|" + e.text("alert").lowercase(Locale.ROOT)
        val country = e.text("country")
        val c = if (country.isNotEmpty()) " ($country)" else ""
        val mTitle = when {
            isM65 -> "Major Earthquake M" + jsNumText(e.jsNum("magnitude")) + c
            isTsunami -> "Tsunami Alert$c"
            isSevereCyclone -> "Severe Storm Alert: " + title.ifEmpty { type }
            isRed -> "Red Alert: " + type.ifEmpty { "Disaster" } + c
            else -> "Major Alert: " + type.ifEmpty { "Disaster" }
        }
        val body = title.ifEmpty { type } + " · " + (if (e.truthy("alert")) e.str("alert") + " alert · " else "") + e.text("source").ifEmpty { "Official agency" }
        return Alert(key, id, 0.0, mTitle, body, Format.eventUrl(e), "pnd-major-$id")
    }

    /** Everything to notify now, after the 6-hour de-duplication; updates [seen]. */
    fun toNotify(events: List<JsonObject>, places: List<JsonObject>, seen: MutableMap<String, Long>, now: Long): List<Alert> {
        val out = mutableListOf<Alert>()
        for (a in alertsFor(events, places, now)) {
            val s = seen[a.key]
            if (s == null || now - s > DEDUP_MS) { out += a; seen[a.key] = now }
        }
        for (e in events) {
            val a = majorAlert(e, now) ?: continue
            val s = seen[a.key]
            if (s != null && now - s <= DEDUP_MS) continue
            out += a; seen[a.key] = now
        }
        return out
    }

    /** The background payload per place: kind plus coordinates rounded to 2 decimals, first 10 valid. */
    fun cleanPlaces(places: List<Place>): List<Triple<String, Double, Double>> =
        places.mapNotNull { p -> val la = roundCoord(JsonPrimitive(p.lat)); val lo = roundCoord(JsonPrimitive(p.lon)); if (la != null && lo != null) Triple(p.kind, la, lo) else null }.take(10)
}
