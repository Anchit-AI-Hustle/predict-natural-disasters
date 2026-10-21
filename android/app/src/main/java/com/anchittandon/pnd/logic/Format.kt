package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsNumText
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.jsRound
import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URLDecoder
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

/**
 * The clock and time zone every formatter reads. The app sets the zone from settings, tests fix
 * both. Data times always come from the response; "now" is only used for ages and liveness.
 */
object AppClock {
    @Volatile var now: () -> Long = { System.currentTimeMillis() }
    @Volatile var zone: String = "Asia/Kolkata"
    /** The device's own zone, the default when none is chosen (`PND.timezone`, changelog C9). Tests fix it. */
    @Volatile var deviceZone: () -> String? = { java.time.ZoneId.systemDefault().id }
}

/** Port of the text helpers in portal.js (logic.md §6). */
object Format {
    /** Built from its code so no source file carries the character (test/no-dashes.test.js). */
    private val EM_DASH = Char(0x2014).toString()

    /* ------------------------------------------------------------------ places */

    private val NAMES_ONLY = Regex("^(flood|drought|wildfire|forest fires?|earthquake|volcano|tropical cyclone)\\b.*\\bin\\b", RegexOption.IGNORE_CASE)
    private val TC_NAME = Regex("^tropical cyclone\\s", RegexOption.IGNORE_CASE)

    private fun tidy(v: String?): String = (v ?: "").replace(Regex("[\\s,;]+$"), "").trim()

    fun placeOf(e: JsonObject?, fallback: String = ""): String {
        if (e == null) return fallback
        tidy(e.text("place")).let { if (it.isNotEmpty()) return it }
        val t = tidy(e.text("title")).lowercase(Locale.ROOT)
        val c = tidy(e.text("country"))
        var r = tidy(e.text("region"))
        if (r.isNotEmpty() && (r.lowercase(Locale.ROOT) == t || NAMES_ONLY.containsMatchIn(r) || TC_NAME.containsMatchIn(r))) r = ""
        if (r.isNotEmpty() && c.isNotEmpty() && !r.lowercase(Locale.ROOT).contains(c.lowercase(Locale.ROOT))) return "$r, $c"
        return r.ifEmpty { c.ifEmpty { fallback } }
    }

    private val OUTLOOK = Regex("^(\\d+)-(day|hour) (.+?) risk outlook - (.+)$")
    private val AFTERSHOCK = Regex("^Aftershock-sequence outlook - (.+)$")

    fun titleOf(e: JsonObject?): String {
        val t = e.text("title")
        OUTLOOK.matchEntire(t)?.let { m -> val g = m.groupValues; return "${g[3]} risk in ${g[4]} - ${g[1]}-${g[2]} forecast" }
        AFTERSHOCK.matchEntire(t)?.let { m ->
            val p = m.groupValues[1]
            return "Aftershock risk " + (if (p.firstOrNull()?.isDigit() == true) "" else "near ") + p + " - 7-day forecast"
        }
        return t
    }

    /* ----------------------------------------------------------------- sources */

    private val SOURCE_ABBR = mapOf(
        "NOAA / National Weather Service" to "NOAA/NWS",
        "NOAA National Weather Service" to "NOAA/NWS",
        "NOAA National Hurricane Center" to "NOAA/NHC",
        "National Weather Service" to "NWS",
        "National Hurricane Center" to "NHC",
        "USGS Volcano Hazards Program" to "USGS Volcano",
        "USGS verified recent snapshot" to "USGS (verified)",
        "GDACS verified snapshot" to "GDACS (verified)",
        "ReliefWeb (UN OCHA)" to "ReliefWeb",
        "Predict Natural Disasters" to "This site",
    )
    private val DERIVED = Regex("^(.*?)\\s*[\u00b7|]\\s*derived from\\s+(.*)$", RegexOption.IGNORE_CASE)
    private val PAREN = Regex("\\(([A-Z][A-Za-z0-9/&. -]{1,24})\\)\\s*$")

    fun shortSource(name: String?): String {
        val s = (name ?: "").trim()
        if (s.isEmpty()) return "Source not stated"
        SOURCE_ABBR[s]?.let { return it }
        DERIVED.matchEntire(s)?.let { return clipSource("Derived \u00b7 " + shortSource(it.groupValues[2])) }
        PAREN.find(s)?.let { return it.groupValues[1] }
        val slash = s.split(Regex("\\s*/\\s*"))
        if (slash.size > 1 && slash[0].length <= 12) return slash[0]
        return clipSource(s)
    }

    fun clipSource(s: String): String =
        if (s.length <= 28) s else s.substring(0, 27).replace(Regex("[\\s,;:.\u00b7-]+$"), "") + "\u2026"

    /* ------------------------------------------------------------- provenance */

    fun provenance(e: JsonObject?): String {
        val s = e.text("evidenceState")
        if (s == "forecast" || (s.isEmpty() && e.truthy("forecast"))) {
            return if (e.str("forecastKind") == "frozen-benchmark") "TEST FORECAST" else "OUR FORECAST"
        }
        if (s == "official-warning") return "OFFICIAL WARNING"
        return "REPORTED EVENT"
    }

    /* ------------------------------------------------------------------- urls */

    /** `encodeURIComponent`: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is percent-encoded. */
    fun enc(v: String): String {
        val sb = StringBuilder()
        for (b in v.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF)
            val ch = c.toChar()
            if (c < 128 && (ch.isLetterOrDigit() || ch in "-_.!~*'()")) sb.append(ch)
            else sb.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
        }
        return sb.toString()
    }

    fun dec(v: String): String = try { URLDecoder.decode(v.replace("+", "%2B"), "UTF-8") } catch (e: Exception) { v }

    /** `PND.eventUrl`: which detail screen a record opens (logic.md §6.6). */
    fun eventUrl(e: JsonObject?): String {
        val id = enc(e.str("id") ?: "")
        if (e.truthy("forecast")) return "/forecasts/$id"
        if (e.str("sourceType") == "official" && (e.str("alert") == "Red" || e.str("alert") == "Orange")) return "/alerts/$id"
        return "/disasters/$id"
    }

    private fun norm(v: String?): String = (v ?: "").lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "")

    fun <T> findEvent(events: List<T>, id: String?, json: (T) -> JsonObject): T? {
        if (id.isNullOrEmpty()) return null
        val raw = id
        val dec = try { URLDecoder.decode(raw.replace("+", "%2B"), "UTF-8") } catch (e: Exception) { raw }
        for (w in listOf(raw, dec)) events.firstOrNull { (json(it).str("id") ?: "undefined") == w }?.let { return it }
        val n = norm(dec)
        events.firstOrNull { norm(json(it).str("id") ?: "undefined") == n }?.let { return it }
        events.firstOrNull { norm(json(it).str("title") ?: "undefined") == n }?.let { return it }
        return events.firstOrNull { val x = norm(json(it).str("id") ?: "undefined"); x.endsWith(n) || n.endsWith(x) }
    }

    /* ------------------------------------------------------------------ dates */

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")

    val TZ_ALIASES = mapOf(
        "Asia/Kolkata" to "IST", "UTC" to "UTC", "America/New_York" to "ET", "America/Los_Angeles" to "PT",
        "Europe/London" to "UK", "Asia/Dubai" to "GST", "Asia/Singapore" to "SGT", "Asia/Tokyo" to "JST",
        "Australia/Sydney" to "Sydney",
    )

    /**
     * The zone's name beside a time (changelog C27): the nine aliases, else the en-US short name for that moment
     * (`Intl.DateTimeFormat('en-US', {timeZoneName: 'short'})`). en-US has short names only for the North American
     * zones (EST/EDT, CST/CDT, MST/MDT, PST/PDT, AKST/AKDT, HST/HDT, AST/ADT); every other zone is its offset
     * ("GMT-3", "GMT+5:45", "GMT"). Never the raw IANA id; "local time" if the zone is unknown.
     */
    fun tzLabel(tz: String = AppClock.zone, at: Long = AppClock.now()): String {
        TZ_ALIASES[tz]?.let { return it }
        val zid = try { ZoneId.of(tz) } catch (e: Exception) { return "local time" }
        val inst = Instant.ofEpochMilli(at)
        val dst = zid.rules.isDaylightSavings(inst)
        val long = java.util.TimeZone.getTimeZone(zid).getDisplayName(dst, java.util.TimeZone.LONG, Locale.US)
        US_SHORT[long]?.let { return it }
        val secs = zid.rules.getOffset(inst).totalSeconds
        if (secs == 0) return "GMT"
        val a = Math.abs(secs) / 60
        return "GMT" + (if (secs < 0) "-" else "+") + (a / 60) + (if (a % 60 != 0) ":" + (a % 60).toString().padStart(2, '0') else "")
    }

    private val US_SHORT = mapOf(
        "Eastern Standard Time" to "EST", "Eastern Daylight Time" to "EDT", "Central Standard Time" to "CST", "Central Daylight Time" to "CDT",
        "Mountain Standard Time" to "MST", "Mountain Daylight Time" to "MDT", "Pacific Standard Time" to "PST", "Pacific Daylight Time" to "PDT",
        "Alaska Standard Time" to "AKST", "Alaska Daylight Time" to "AKDT", "Hawaii-Aleutian Standard Time" to "HST", "Hawaii-Aleutian Daylight Time" to "HDT",
        "Hawaii Standard Time" to "HST", "Hawaii Daylight Time" to "HDT", "Atlantic Standard Time" to "AST", "Atlantic Daylight Time" to "ADT",
    )

    /** The time zone menu's words for a zone (`tzMenuLabel`): "IST · India", else "{label} · {city}", or the label alone. */
    fun tzMenuLabel(tz: String, at: Long = AppClock.now()): String {
        if (tz == "Asia/Kolkata") return "IST \u00b7 India"
        val l = tzLabel(tz, at)
        val city = if (Regex("^(Etc|SystemV)/").containsMatchIn(tz)) "" else tz.split('/').last().replace('_', ' ')
        return if (city.isNotEmpty() && city != l) "$l \u00b7 $city" else l
    }

    private fun zoneId(tz: String): ZoneId = try { if (tz == "UTC") ZoneOffset.UTC else ZoneId.of(tz) } catch (e: Exception) { ZoneId.of("Asia/Kolkata") }

    private fun clock12(h: Int, m: Int): String {
        val hh = if (h % 12 == 0) 12 else h % 12
        return "$hh:" + m.toString().padStart(2, '0') + (if (h < 12) " AM" else " PM")
    }

    /** `dd MMM yyyy, h:mm AM|PM {tzLabel}` in the chosen zone; the input itself when it is not a date. */
    fun fmtDate(v: String?, tz: String = AppClock.zone): String {
        if (v.isNullOrEmpty()) return "-"
        val t = JsDate.parse(v) ?: return v
        val z = Instant.ofEpochMilli(t).atZone(zoneId(tz))
        return z.dayOfMonth.toString().padStart(2, '0') + " " + MONTHS[z.monthValue - 1] + " " + z.year + ", " +
            clock12(z.hour, z.minute) + " " + tzLabel(tz, t)
    }

    fun fmtDateMs(ms: Long, tz: String = AppClock.zone): String = fmtDate(JsDate.iso(ms), tz)

    fun fmtTime(v: String?, tz: String = AppClock.zone): String {
        if (v.isNullOrEmpty()) return "-"
        val t = JsDate.parse(v) ?: return v
        val z = Instant.ofEpochMilli(t).atZone(zoneId(tz))
        return clock12(z.hour, z.minute) + " " + tzLabel(tz, t)
    }

    private val EDGE = Regex("^(\\d{4})-(\\d\\d)-(\\d\\d)T(00:00:00|23:59:59)(\\.0+|\\.9+)?Z$")

    private data class Edge(val t: Long, val last: Boolean)

    private fun edge(x: String?): Edge? {
        val m = EDGE.matchEntire(x ?: "") ?: return null
        val g = m.groupValues
        val t = java.time.LocalDate.of(g[1].toInt(), g[2].toInt(), g[3].toInt()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        return Edge(t, g[4] == "23:59:59")
    }

    /** "dd MMM yyyy" of a UTC day (no time, no zone). */
    fun utcDay(ms: Long): String {
        val z = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC)
        return z.dayOfMonth.toString().padStart(2, '0') + " " + MONTHS[z.monthValue - 1] + " " + z.year
    }

    fun fmtWhen(v: String?, other: String? = null, role: String? = null, tz: String = AppClock.zone): String {
        if (v.isNullOrEmpty()) return "-"
        val m = edge(v)
        if (m == null || (!other.isNullOrEmpty() && edge(other) == null)) return fmtDate(v, tz)
        val day = if (m.last || role != "end") m.t else m.t - 86_400_000L
        return utcDay(day)
    }

    fun zoneDisplayName(tz: String): String = try { zoneId(tz).getDisplayName(TextStyle.FULL, Locale.ENGLISH) } catch (e: Exception) { tz }

    fun age(v: String?, now: Long = AppClock.now()): String {
        if (v.isNullOrEmpty()) return "unknown"
        val t = JsDate.parse(v) ?: return "unknown"
        val m = maxOf(0L, jsRoundL((now - t) / 60000.0))
        return when {
            m < 1 -> "just now"
            m < 60 -> "$m min ago"
            m < 1440 -> "${jsRoundL(m / 60.0)} hr ago"
            else -> "${jsRoundL(m / 1440.0)} d ago"
        }
    }

    fun duration(from: String?, to: String?): String {
        val a = JsDate.parse(from) ?: return ""
        val b = JsDate.parse(to) ?: return ""
        if (b <= a) return ""
        val hours = (b - a) / 3_600_000.0
        if (hours < 1) return "under an hour"
        val h = jsRoundL(hours)
        if (h < 48) return "$h" + if (h == 1L) " hour" else " hours"
        val d = jsRoundL(h / 24.0)
        return "$d" + if (d == 1L) " day" else " days"
    }

    fun windowText(e: JsonObject?, tz: String = AppClock.zone): String {
        val start = e.firstOf("targetStart", "startedAt", "updated")
        if (start.isEmpty()) return "The source gives no start time"
        val dur = duration(start, e.text("targetEnd"))
        return "Starts " + fmtWhen(start, e.text("targetEnd").ifEmpty { null }, null, tz) + (if (dur.isNotEmpty()) " \u00b7 lasts $dur" else " \u00b7 length not stated")
    }

    private fun JsonObject?.firstOf(vararg keys: String): String {
        for (k in keys) if (truthy(k)) return str(k) ?: ""
        return ""
    }

    /* ------------------------------------------------------- status and counts */

    fun statusText(meta: JsonObject?): String {
        if (meta == null) return "Refreshing"
        val all = meta.obj("sources")?.values?.toList() ?: emptyList()
        val n = all.count { (it as? JsonObject)?.truthy("ok") == true }
        return if (meta.truthy("live")) "Live \u00b7 $n of ${if (all.isNotEmpty()) all.size else n} sources working"
        else "Our data sources are not answering \u00b7 showing saved copies only"
    }

    fun sourcesRatio(meta: JsonObject?): String {
        val all = meta.obj("sources")?.values?.toList() ?: emptyList()
        val n = all.count { (it as? JsonObject)?.truthy("ok") == true }
        return "$n/${if (all.isNotEmpty()) all.size else n}"
    }

    fun countryCount(list: List<JsonObject>): Int {
        val s = HashSet<String>()
        list.forEach { e -> e.text("country").split(",").forEach { c -> val t = c.trim(); if (t.isNotEmpty()) s += t.lowercase(Locale.ROOT) } }
        return s.size
    }

    /** en-US grouping of a reported count (`Number.toLocaleString()` on an en-US viewer). */
    fun grouped(v: Double): String {
        if (v == Math.rint(v)) return Hazards.group(v)
        val whole = Hazards.group(Math.floor(Math.abs(v)) * Math.signum(v))
        val frac = jsNumText(Math.abs(v)).substringAfter('.', "").take(3)
        return if (frac.isEmpty()) whole else "$whole.$frac"
    }

    fun impactText(e: JsonObject?): String {
        val p = mutableListOf<String>()
        if (e.truthy("deaths")) p += "${grouped(e.jsNum("deaths"))} deaths"
        if (e.truthy("displaced")) p += "${grouped(e.jsNum("displaced"))} displaced"
        if (e.truthy("affected")) p += "${grouped(e.jsNum("affected"))} affected"
        return p.joinToString(" \u00b7 ")
    }

    /** A reported count, grouped; "Not reported" when no source gave one. A reported 0 is "0". */
    fun figure(e: JsonObject?, key: String, missing: String = "Not reported"): String {
        val v = e.el(key) ?: return missing
        if (v is JsonPrimitive && v.isString && v.content.isEmpty()) return missing
        val n = jsNumber(v)
        return if (n.isFinite()) grouped(n) else (e.str(key) ?: missing)
    }

    private val BOILER = Regex("\\s*(This is not a deterministic prediction and must not replace official warnings|This is our own estimate, not an official warning)\\.?\\s*$")
    private val FIRST = Regex("^.{20,}?[.!?](?=\\s+[A-Z(]|$)")

    fun summary(text: String?, max: Int = 160): String {
        var t = (text ?: "").replace(BOILER, "").replace(Regex("\\s+"), " ").trim()
        FIRST.find(t)?.let { t = it.value }
        if (t.length <= max) return t
        val cut = t.substring(0, max)
        return cut.substring(0, maxOf(cut.lastIndexOf(' '), (max * 0.6).toInt())).replace(Regex("[\\s,;:\u00b7" + EM_DASH + "-]+$"), "") + "\u2026"
    }

    fun quietNote(e: JsonObject?): String {
        if (e == null || e.bool("live") != false) return ""
        val d = e.jsNum("quietDays")
        val src = e.text("source").ifEmpty { "its source" }
        val span = if (d.isFinite()) jsNumText(d) + " day" + (if (d == 1.0) "" else "s") else "some time"
        return "Not updated by $src for $span. It may have ended; check the source for its current status."
    }

    fun horizonText(meta: JsonObject?, tz: String = AppClock.zone): String {
        val h = meta.obj("forecastHorizon")
        if (h == null || !h.truthy("furthestWindowEnds")) return "There are no open forecasts right now."
        val d = h.jsNum("daysAhead")
        val ahead = if (d >= 1) jsRoundL(d).let { "$it day" + (if (it == 1L) "" else "s") } else "less than a day"
        val lens = h.arr("windowLengthDays")?.map { jsNumText(jsNumber(it)) } ?: emptyList()
        val lenText = if (lens.isEmpty()) "" else
            (if (lens.size > 1) lens.dropLast(1).joinToString(", ") + " or " + lens.last() else lens[0]) +
                " day" + (if (lens.size == 1 && lens[0] == "1") "" else "s")
        return "Our forecasts reach as far as " + fmtWhen(h.str("furthestWindowEnds"), null, "end", tz) +
            " ($ahead from now)" + (if (lenText.isNotEmpty()) ". Each one covers $lenText" else "") +
            ". We do not forecast further ahead than that. It does not mean nothing will happen after that date."
    }

    /** `hazardOptions`: (value, label) pairs, "All hazards (N)" first. */
    fun hazardOptions(records: List<JsonObject>, selected: String?): List<Pair<String, String>> {
        val counts = LinkedHashMap<String, Int>()
        records.forEach { e -> val t = e.text("type"); if (t.isNotEmpty()) counts[t] = (counts[t] ?: 0) + 1 }
        if (!selected.isNullOrEmpty() && selected !in counts) counts[selected] = 0
        return listOf("" to "All hazards (${records.size})") +
            counts.entries.sortedWith { a, b -> (b.value - a.value).takeIf { it != 0 } ?: Sorts.collator.compare(a.key, b.key) }
                .map { it.key to "${it.key} (${it.value})" }
    }

    /** `keyFactsLine(e, max)`: reported facts only, joined with " · ". */
    fun keyFactsLine(e: JsonObject?, max: Int = 3): String =
        Hazards.keyFacts(e).filter { it.reported }.take(max).joinToString(" \u00b7 ") { x ->
            val v = x.value ?: ""
            val named = x.key == "category" || v.lowercase(Locale.ROOT).startsWith(x.label.lowercase(Locale.ROOT))
            if (named) v else "${x.label} $v"
        }

    /** "N events · M forecasts", with singulars (collection.js countText). */
    fun countText(list: List<JsonObject>): String {
        val fc = list.count { it.truthy("forecast") }
        val ev = list.size - fc
        val evText = "$ev event" + (if (ev == 1) "" else "s")
        val fcText = "$fc forecast" + (if (fc == 1) "" else "s")
        return when {
            fc > 0 && ev > 0 -> "$evText \u00b7 $fcText"
            fc > 0 -> fcText
            else -> evText
        }
    }

    /* ----------------------------------------------------------- forecast changes */

    data class ChangeSection(val label: String, val rows: List<String>, val more: Int)
    data class Changes(val headline: String, val sections: List<ChangeSection>)

    fun changes(meta: JsonObject?, tz: String = AppClock.zone, now: Long = AppClock.now()): Changes {
        val c = meta.obj("forecastChanges") ?: return Changes("No changes have been recorded yet.", emptyList())
        val whenText = fmtDate(c.str("at"), tz) + " \u00b7 " + age(c.str("at"), now)
        val active = c.str("activeOutlooks") ?: "undefined"
        if (c.truthy("baseline")) return Changes("First check, $whenText. $active forecasts are open. There is nothing earlier to compare them with yet.", emptyList())
        val sh = c.el("sinceHours")
        val shN = if (sh is JsonPrimitive && !sh.isString) jsNumber(sh) else Double.NaN
        val gap = if (shN.isFinite() && shN > 0) " (" + (if (shN < 1) "${jsRoundL(shN * 60)} minutes" else jsNumText(shN) + (if (shN == 1.0) " hour" else " hours")) + " after the check before)" else ""
        val un = c.jsNum("unavailable").let { if (it.isFinite()) it.toLong() else 0L }
        val total = c.jsNum("total").let { if (it.isFinite()) it.toLong() else 0L }
        if (total == 0L && un == 0L) return Changes("Checked $whenText$gap. None of the $active open forecasts changed their risk level, dates or status.", emptyList())
        val r = c.obj("records")
        fun sec(label: String, key: String, fmt: (JsonObject) -> String): ChangeSection? {
            val list = r.arr(key).objects()
            if (list.isEmpty()) return null
            return ChangeSection("$label (${list.size})", list.take(8).map(fmt), maxOf(0, list.size - 8))
        }
        val headline = if (total != 0L) "$total change" + (if (total == 1L) "" else "s") + " across $active open forecasts" else "no changes across $active open forecasts"
        val caveat = if (un != 0L) ", and $un that could not be checked" else ""
        return Changes("Checked $whenText$gap \u00b7 $headline$caveat.", listOfNotNull(
            sec("New", "added") { "${titleOf(it)} - ${it.str("alert")}" },
            sec("Raised", "raised") { "${titleOf(it)} - ${it.str("from")} \u2192 ${it.str("to")}" },
            sec("Lowered", "lowered") { "${titleOf(it)} - ${it.str("from")} \u2192 ${it.str("to")}" },
            sec("Dates changed", "windowMoved") { "${titleOf(it)} - now ends ${fmtWhen(it.str("toEnd"), null, "end", tz)}" },
            sec("Stopped", "gone") { "${titleOf(it)} - the event it followed is no longer reported" },
            sec("Ended on schedule", "expired") { "${titleOf(it)} - its forecast period ended" },
            sec("Could not be checked", "unavailable") { "${titleOf(it)} - we could not reach its source this time, so it is unchanged, not withdrawn" },
        ))
    }

    /** "1 thing" / "2 things". */
    fun plural(n: Int, one: String, many: String) = "$n " + if (n == 1) one else many

    /** Coordinates to 4 decimals, as the detail pages print them. */
    fun coords(lat: Double?, lon: Double?): String =
        if (lat == null || lon == null) "Not given" else "${com.anchittandon.pnd.model.toFixed(lat, 4)}, ${com.anchittandon.pnd.model.toFixed(lon, 4)}"

    /** Kilometres rounded for "{km} km away". */
    fun km(d: Double): String = jsRoundL(d).toString()

    @Suppress("unused") private fun r1(x: Double) = jsRound(x * 10) / 10
}
