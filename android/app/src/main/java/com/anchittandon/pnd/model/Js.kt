package com.anchittandon.pnd.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Tolerant JSON access with the website's JavaScript semantics.
 *
 * The API adds fields often and leaves many of them absent, null or "". Records are kept as
 * [JsonObject] so unknown fields survive, and every read here treats absent, null and "" the
 * same way: as "not published". Nothing here ever turns a missing number into 0 (logic.md §1).
 */
val PndJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
}

fun JsonElement?.isNullish(): Boolean = this == null || this is JsonNull

/** The element at [key], or null when absent or JSON null. */
fun JsonObject?.el(key: String): JsonElement? = this?.get(key)?.takeUnless { it is JsonNull }

/** `String(v)` for a primitive; null when absent or null. Objects and arrays give null. */
fun JsonObject?.str(key: String): String? = when (val v = el(key)) {
    is JsonPrimitive -> v.content
    else -> null
}

/** `String(v || '')`: the text, "" for anything falsy. */
fun JsonObject?.text(key: String): String = if (truthy(key)) str(key) ?: "" else ""

/** Published: not undefined, not null and not "". */
fun JsonObject?.has(key: String): Boolean {
    val v = el(key) ?: return false
    return !(v is JsonPrimitive && v.isString && v.content.isEmpty())
}

/** JavaScript `Number(v)` for one element: NaN for anything that is not a number. */
fun jsNumber(v: JsonElement?): Double {
    if (v == null || v is JsonNull) return 0.0
    if (v !is JsonPrimitive) return Double.NaN
    if (v.isString) return jsNumber(v.content)
    v.booleanOrNull?.let { return if (it) 1.0 else 0.0 }
    return v.content.toDoubleOrNull() ?: Double.NaN
}

/** JavaScript `Number(s)` for a string: "" and whitespace give 0, junk gives NaN. */
fun jsNumber(s: String): Double {
    val t = s.trim()
    if (t.isEmpty()) return 0.0
    if (t == "Infinity" || t == "+Infinity") return Double.POSITIVE_INFINITY
    if (t == "-Infinity") return Double.NEGATIVE_INFINITY
    if (t.startsWith("0x") || t.startsWith("0X")) return t.substring(2).toLongOrNull(16)?.toDouble() ?: Double.NaN
    if (!Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$").matches(t)) return Double.NaN
    return t.toDoubleOrNull() ?: Double.NaN
}

/** A published, finite number, or null. Lenient for numeric strings; " " is not published. */
fun JsonObject?.num(key: String): Double? {
    val v = el(key) ?: return null
    if (v is JsonPrimitive && v.isString && v.content.isBlank()) return null
    val n = jsNumber(v)
    return if (n.isFinite()) n else null
}

/** `Number(v)` where absent counts as NaN rather than 0 (for `isFinite(Number(e.x))` style reads). */
fun JsonObject?.jsNum(key: String): Double {
    val v = this?.get(key) ?: return Double.NaN
    return jsNumber(v)
}

/** JavaScript truthiness of the value at [key]. */
fun JsonObject?.truthy(key: String): Boolean = truthy(el(key))

fun truthy(v: JsonElement?): Boolean {
    if (v == null || v is JsonNull) return false
    if (v !is JsonPrimitive) return true
    if (v.isString) return v.content.isNotEmpty()
    v.booleanOrNull?.let { return it }
    val n = v.content.toDoubleOrNull() ?: return true
    return n != 0.0 && !n.isNaN()
}

fun JsonObject?.bool(key: String): Boolean? = (el(key) as? JsonPrimitive)?.booleanOrNull

fun JsonObject?.obj(key: String): JsonObject? = el(key) as? JsonObject
fun JsonObject?.arr(key: String): JsonArray? = el(key) as? JsonArray

fun JsonArray?.objects(): List<JsonObject> = this?.mapNotNull { it as? JsonObject } ?: emptyList()
fun JsonArray?.strings(): List<String> = this?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()

/** First truthy value among [keys], as text (JavaScript `a || b || c`). */
fun JsonObject?.firstText(vararg keys: String): String {
    for (k in keys) if (truthy(k)) return str(k) ?: ""
    return ""
}

/** `Object.assign({}, a, b)`: a copy with b's fields laid over a's. */
fun JsonObject.with(other: Map<String, JsonElement>): JsonObject = JsonObject(LinkedHashMap(this).apply { putAll(other) })

fun JsonObject.with(vararg pairs: Pair<String, Any?>): JsonObject = with(pairs.associate { (k, v) -> k to toJson(v) })

fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to toJson(x) })
    is List<*> -> JsonArray(v.map { toJson(it) })
    else -> JsonPrimitive(v.toString())
}

fun jsonObjectOf(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject { pairs.forEach { (k, v) -> put(k, toJson(v)) } }

/** JavaScript `Math.round`: halves round toward +infinity. */
fun jsRound(x: Double): Double = if (x.isNaN() || x.isInfinite()) x else Math.floor(x + 0.5)
fun jsRoundL(x: Double): Long = jsRound(x).toLong()

/** A number printed as JavaScript prints it: 5 not 5.0, 5.24 as 5.24. */
fun jsNumText(x: Double): String {
    if (x.isNaN()) return "NaN"
    if (x.isInfinite()) return if (x > 0) "Infinity" else "-Infinity"
    if (x == Math.rint(x) && Math.abs(x) < 1e21) return x.toLong().toString()
    var s = x.toString()
    if (s.contains('E')) s = java.math.BigDecimal(x).stripTrailingZeros().toPlainString()
    return s
}

/** JavaScript `Number.prototype.toFixed`. */
fun toFixed(x: Double, digits: Int): String {
    if (!x.isFinite()) return jsNumText(x)
    // toFixed rounds the exact binary value, which BigDecimal(x) is, half away from zero.
    return java.math.BigDecimal(x).setScale(digits, java.math.RoundingMode.HALF_UP).toPlainString()
}

/**
 * `Date.parse`, for the forms the API and the ledgers use: ISO-8601 with Z, with an offset,
 * with or without seconds and milliseconds, a bare date (UTC midnight), and RFC 1123 dates
 * from news feeds. Returns epoch ms, or null where JavaScript gives NaN.
 */
object JsDate {
    private val isoFull = Regex("^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|z|[+-]\\d{2}:?\\d{2})?$")
    private val isoDate = Regex("^(\\d{4})-(\\d{2})(?:-(\\d{2}))?$")
    private val rfc = DateTimeFormatter.RFC_1123_DATE_TIME

    fun parse(s: String?): Long? {
        val t = s?.trim() ?: return null
        if (t.isEmpty()) return null
        isoFull.matchEntire(t)?.let { m ->
            return try {
                val g = m.groupValues
                val frac = g[7]
                val nanos = if (frac.isEmpty()) 0 else (frac + "000000000").substring(0, 9).toInt()
                val ldt = LocalDateTime.of(g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(),
                    g[6].ifEmpty { "0" }.toInt(), nanos)
                val off = g[8]
                val offset = when {
                    off.isEmpty() || off == "Z" || off == "z" -> ZoneOffset.UTC
                    else -> ZoneOffset.of(if (off.length == 5) off.substring(0, 3) + ":" + off.substring(3) else off)
                }
                ldt.toInstant(offset).toEpochMilli()
            } catch (e: Exception) { null }
        }
        isoDate.matchEntire(t)?.let { m ->
            return try {
                LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].ifEmpty { "1" }.toInt())
                    .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } catch (e: Exception) { null }
        }
        return try { ZonedDateTime.parse(t, rfc).toInstant().toEpochMilli() } catch (e: Exception) {
            try { OffsetDateTime.parse(t).toInstant().toEpochMilli() } catch (e2: Exception) {
                rfcLoose(t)
            }
        }
    }

    /** RSS dates like "Sun, 14 Sep 2026 03:00:00 GMT" with a named zone or none. */
    private fun rfcLoose(t: String): Long? {
        val m = Regex("^(?:[A-Za-z]{3},\\s*)?(\\d{1,2})\\s+([A-Za-z]{3})\\s+(\\d{4})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(GMT|UTC|UT|Z|[+-]\\d{4})?$").matchEntire(t)
            ?: return null
        val months = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
        val mo = months.indexOf(m.groupValues[2].lowercase(Locale.ROOT)) + 1
        if (mo == 0) return null
        return try {
            val ldt = LocalDateTime.of(m.groupValues[3].toInt(), mo, m.groupValues[1].toInt(), m.groupValues[4].toInt(),
                m.groupValues[5].toInt(), m.groupValues[6].ifEmpty { "0" }.toInt())
            val z = m.groupValues[7]
            val off = if (z.startsWith("+") || z.startsWith("-")) ZoneOffset.of(z.substring(0, 3) + ":" + z.substring(3)) else ZoneOffset.UTC
            ldt.toInstant(off).toEpochMilli()
        } catch (e: Exception) { null }
    }

    /** ISO string for an epoch ms (`new Date(t).toISOString()`). */
    fun iso(ms: Long): String = DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.ofEpochMilli(ms)).let {
        if (it.length == 20) it.dropLast(1) + ".000Z" else it
    }
}

/** `Date.parse(e[key] || '')` as epoch ms, or null. */
fun JsonObject?.time(key: String): Long? = JsDate.parse(text(key))
