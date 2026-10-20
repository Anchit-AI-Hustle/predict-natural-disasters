package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.has
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.jsRound
import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.num
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.toFixed
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Normalizer
import java.util.Locale

/** One entry of hazard-model.js HAZARDS (copy verbatim). */
data class Hazard(
    val key: String,
    val name: String,
    val definition: String,
    val onset: String,
    val forecastable: Boolean,
    val horizonH: Int,
    val duration: String,
    val severityBasis: String,
    val leadTime: String,
)

data class KeyFact(val key: String, val label: String, val reported: Boolean, val value: String?, val note: String? = null)

data class RiskRow(
    val band: String,
    val distanceKm: Double?,
    val claimDistance: Boolean,
    val containment: Boolean?,
    val applicability: String,
    val reason: String,
)

data class Classification(val forecastClass: String, val classificationReason: String)

data class ForecastClassDef(val label: String, val definition: String, val headline: Boolean)

data class RiskBand(val key: String, val title: String, val blurb: String, val empty: String, val dataAvailable: Boolean = true)

/** Port of hazard-model.js (logic.md §3 and §5). */
object Hazards {
    val HAZARDS: Map<String, Hazard> = listOf(
        Hazard("Earthquake", "Earthquake",
            "Ground shaking from a sudden release of stress on a fault. Measured by magnitude; damage depends on depth, local geology and building stock, not magnitude alone.",
            "sudden", false, 0,
            "Seconds to minutes of shaking; the aftershock sequence runs days to months.",
            "USGS PAGER impact alert, which estimates expected fatalities and economic loss. Magnitude on its own is not a severity.",
            "None. No agency can forecast when a particular earthquake will strike, and neither can we."),
        Hazard("Earthquake aftershock sequence", "Aftershock sequence",
            "The decaying series of smaller earthquakes that follows a mainshock in the same rupture area. The largest aftershock is typically about one magnitude below the mainshock.",
            "rapid", true, 168,
            "Days to months, decaying roughly with the reciprocal of elapsed time.",
            "Mainshock magnitude and the state of already-damaged structures in the affected area.",
            "Hours to days. Aftershocks can be forecast once the main earthquake has happened; the main earthquake cannot."),
        Hazard("Tropical Cyclone", "Tropical cyclone",
            "A rotating storm system over warm ocean with organised convection and a closed low-level circulation. Named at tropical-storm strength; hurricane or typhoon strength begins at 64 knots of sustained wind.",
            "rapid", true, 120,
            "Days at sea; landfall impacts run roughly 12 to 72 hours at a given place.",
            "Saffir-Simpson category from sustained wind, plus expected storm surge and rainfall over populated coast.",
            "Three to five days. Storms can be forecast further ahead than most hazards, which is why official storm tracks cover five days."),
        Hazard("Flood", "Flood",
            "Water covering ground that is normally dry, from river overflow, intense rainfall, storm surge or dam failure. Flash floods develop within hours; riverine floods build over days.",
            "rapid", true, 72,
            "Hours for flash flooding; days to weeks for large river basins.",
            "People displaced and affected, depth and extent over inhabited land, and the issuing agency’s own alert level.",
            "Hours to days. River flooding downstream of heavy rain that has already fallen is the easiest to forecast."),
        Hazard("Flood / Landslide", "Flood and landslide",
            "Intense or prolonged rainfall producing both inundation and slope failure in the same area. The two hazards share a driver and usually arrive together in steep terrain.",
            "rapid", true, 96,
            "Days, with slope failures often continuing after the rain stops.",
            "Combined displacement and casualties, and whether failures reach settlements or transport routes.",
            "One to four days, based on rainfall forecasts and how wet the ground already is."),
        Hazard("Landslide", "Landslide",
            "Downslope movement of rock, soil or debris, usually triggered by rainfall, earthquake shaking or undercutting. Includes debris flows and rockfalls.",
            "rapid", true, 72,
            "Minutes for a single failure; the period of elevated susceptibility lasts days after saturation.",
            "Whether the runout reaches settlements or routes, and observed casualties.",
            "Hours to days, and only for an area at risk. Never a particular slope at a particular time."),
        Hazard("Wildfire", "Wildfire",
            "Uncontrolled fire in vegetation. Behaviour is driven by fuel dryness, wind and terrain; most large-fire growth happens on a small number of extreme fire-weather days.",
            "rapid", true, 72,
            "Days to months for a large incident; most detections stay open until containment is reported.",
            "Area burned, proximity to settlements, evacuation orders and smoke exposure downwind.",
            "One to three days for dangerous fire weather. When and where a fire starts cannot be forecast."),
        Hazard("Drought", "Drought",
            "A prolonged deficit of water relative to normal for a place and season. Meteorological drought is a rainfall deficit; agricultural and hydrological drought follow later as soil moisture and storage fall.",
            "slow", true, 720,
            "Months to years. Drought does not have a three-day window and must never be published with one.",
            "Extent and duration of the deficit, and the population dependent on rain-fed agriculture or affected water supply.",
            "Weeks to months. Drought builds slowly, so long-range forecasts give real warning."),
        Hazard("Volcano", "Volcanic activity",
            "Eruptive activity or unrest at a volcano: ash emission, lava, pyroclastic density currents, lahars or gas. Aviation and ground alerts are issued on separate colour-coded scales.",
            "rapid", true, 168,
            "Days to years. Unrest episodes commonly persist for weeks.",
            "The observatory’s own alert level, exclusion-zone population, and ash dispersal over air routes and settlements.",
            "A volcano is usually restless for days to weeks before an eruption, but the exact start is still uncertain."),
        Hazard("Extreme Heat", "Extreme heat",
            "A period of temperature and humidity high enough to threaten health, defined against local norms rather than a single global threshold. Overnight minima matter as much as daytime peaks.",
            "rapid", true, 120,
            "Days to a few weeks.",
            "Duration, night-time minima, and the size of the exposed population without cooling.",
            "Three to seven days. These are among the most reliable forecasts for any hazard."),
        Hazard("Extreme Cold", "Extreme cold",
            "A period of temperature, wind chill or frost severe enough to threaten health, livestock or crops, defined against local norms.",
            "rapid", true, 120,
            "Hours to days.",
            "Wind chill, duration, and exposure of people without heating or of vulnerable crops.",
            "Three to seven days."),
        Hazard("Severe Storm", "Severe storm",
            "Convective weather producing damaging wind, large hail or torrential rain. Distinct from a tropical cyclone: shorter-lived, smaller and driven by local instability.",
            "rapid", true, 48,
            "Hours at any one place; a squall line or outbreak can affect a region for most of a day.",
            "Wind gust, hail size, rainfall rate and the population under the storm track.",
            "Hours to two days. Forecasts become much less reliable after the first day."),
        Hazard("Tornado", "Tornado",
            "A violently rotating column of air in contact with both a convective cloud and the ground. Rated after the fact on the Enhanced Fujita scale from observed damage.",
            "sudden", true, 24,
            "Minutes for an individual tornado; an outbreak lasts hours.",
            "Observed damage rating and whether the track crosses built-up areas.",
            "Minutes for a warning about a particular tornado, and up to a day for the area at risk. Never an exact place and time in advance."),
        Hazard("Tsunami", "Tsunami",
            "Long-wavelength ocean waves generated by seafloor displacement, usually from an earthquake. Travels at jet speed across open ocean and builds height in shallow water.",
            "sudden", true, 24,
            "Hours of wave trains; the first wave is often not the largest.",
            "Expected run-up height against coastal population and evacuation time available.",
            "Minutes to hours, depending on how far the wave has to travel. It is not forecast by any model."),
    ).associateBy { it.key }

    val DEFAULT = Hazard("", "Natural hazard",
        "A natural process with the potential to cause loss of life, injury or damage.",
        "rapid", true, 72, "Varies by hazard.",
        "The issuing agency’s alert level and any observed human impact.", "Varies by hazard.")

    fun hazardOf(type: String?): Hazard {
        val t = type ?: ""
        HAZARDS[t]?.let { return it }
        val k = t.lowercase(Locale.ROOT)
        fun has(re: String) = Regex(re).containsMatchIn(k)
        return when {
            has("aftershock") -> HAZARDS.getValue("Earthquake aftershock sequence")
            has("earthquake|seismic") -> HAZARDS.getValue("Earthquake")
            has("cyclone|hurricane|typhoon") -> HAZARDS.getValue("Tropical Cyclone")
            has("tsunami") -> HAZARDS.getValue("Tsunami")
            has("tornado") -> HAZARDS.getValue("Tornado")
            has("flood") && has("landslide|mudslide") -> HAZARDS.getValue("Flood / Landslide")
            has("flood") -> HAZARDS.getValue("Flood")
            has("landslide|mudslide") -> HAZARDS.getValue("Landslide")
            has("wildfire|bushfire|forest fire") -> HAZARDS.getValue("Wildfire")
            has("drought") -> HAZARDS.getValue("Drought")
            has("volcan") -> HAZARDS.getValue("Volcano")
            has("heat") -> HAZARDS.getValue("Extreme Heat")
            has("cold|freeze|frost|winter") -> HAZARDS.getValue("Extreme Cold")
            has("storm|thunder|hail|wind") -> HAZARDS.getValue("Severe Storm")
            else -> DEFAULT
        }
    }

    fun horizonHours(type: String?): Int = hazardOf(type).horizonH.takeIf { it != 0 } ?: DEFAULT.horizonH

    /* ------------------------------------------------------------------ severity */

    data class SeverityDef(val key: String, val rank: Int, val meaning: String)

    val SEVERITY = listOf(
        SeverityDef("Informational", 1, "A detection or observation with no impact assessment attached. Most of the feed by volume."),
        SeverityDef("Minor", 2, "Impact expected to stay limited and local."),
        SeverityDef("Moderate", 3, "Localised damage, disruption or displacement; casualties possible."),
        SeverityDef("Severe", 4, "Significant casualties, damage or displacement across a region."),
        SeverityDef("Extreme", 5, "Mass casualties or national-scale impact expected or already observed."),
    )

    private fun numOr0(e: JsonObject, k: String): Double = e.jsNum(k).let { if (it.isFinite()) it else 0.0 }.let {
        // num(): Number(v) with non-finite -> 0; absent (undefined) gives NaN -> 0.
        if (e.el(k) == null) 0.0 else it
    }

    fun impactRank(e: JsonObject): Int {
        val d = numOr0(e, "deaths"); val a = numOr0(e, "affected"); val p = numOr0(e, "displaced")
        if (d >= 100 || a >= 1_000_000 || p >= 100_000) return 5
        if (d >= 10 || a >= 100_000 || p >= 10_000) return 4
        if (d >= 1 || a >= 10_000 || p >= 1_000) return 3
        if (a > 0 || p > 0) return 2
        return 0
    }

    fun alertRank(e: JsonObject): Int {
        val pager = e.text("pagerAlert").lowercase(Locale.ROOT)
        val assessed = when (pager) { "red" -> 5; "orange" -> 4; "yellow" -> 3; else -> 0 }
        val mag = e.jsNum("magnitude")
        val kt = e.jsNum("windKt")
        var wind = 0
        if (kt.isFinite() && kt > 0) wind = if (kt >= 113) 5 else if (kt >= 96) 4 else if (kt >= 64) 3 else 2
        val issued = when (e.str("alert") ?: "") { "Red" -> 4; "Orange" -> 3; "High" -> 3; "Moderate" -> 2; "Watch" -> 1; else -> 0 }
        if (assessed != 0 || wind != 0 || issued != 0) return maxOf(assessed, wind, issued)
        if (mag.isFinite() && mag > 0) return 1
        return 0
    }

    fun severityOf(e: JsonObject?): String {
        val x = e ?: JsonObject(emptyMap())
        val r = maxOf(impactRank(x), alertRank(x), 1)
        return SEVERITY.first { it.rank == r }.key
    }

    fun severityMeaning(key: String?): String? = SEVERITY.firstOrNull { it.key == key }?.meaning

    /* ----------------------------------------------------------------- lead time */

    fun leadTimeHours(e: JsonObject?): Double? {
        if (e == null || !e.truthy("forecast")) return null
        val issued = JsDate.parse(if (e.truthy("issuedAt")) e.text("issuedAt") else e.text("updated")) ?: return null
        val start = JsDate.parse(e.text("targetStart")) ?: return null
        return jsRound((start - issued) / 3_600_000.0 * 10) / 10
    }

    fun leadTimeText(e: JsonObject?): String {
        val h = leadTimeHours(e) ?: return ""
        fun n(x0: Double, unit: String): String { val x = jsRoundL(x0); return "$x $unit" + (if (x == 1L) "" else "s") }
        if (h < 0) return "Made " + n(Math.abs(h), "hour") + " after the forecast period began, so it gave no advance warning."
        if (h == 0.0) return "No advance warning. This forecast began when it was made, so it describes something already under way."
        if (h < 48) return "Made " + n(h, "hour") + " before the forecast period begins."
        return "Made " + n(h / 24, "day") + " before the forecast period begins."
    }

    /* ----------------------------------------------------------------- key facts */

    private val IMPACT = listOf("deaths", "injuries", "missing", "displaced", "evacuated", "affected")
    private fun metrics(vararg own: String) = own.toList() + IMPACT
    private val METRICS = mapOf(
        "Earthquake" to metrics("magnitude", "depthKm", "pagerAlert", "tsunamiFlag"),
        "Earthquake aftershock sequence" to metrics("mainshockMagnitude"),
        "Tropical Cyclone" to metrics("windKt", "category", "pressureMb", "movement"),
        "Flood" to metrics(), "Flood / Landslide" to metrics(), "Landslide" to metrics(),
        "Wildfire" to metrics("areaHa"), "Drought" to metrics(),
        "Volcano" to metrics("alertLevel", "aviationColour"),
        "Extreme Heat" to metrics(), "Extreme Cold" to metrics(), "Severe Storm" to metrics(),
        "Tornado" to metrics(), "Tsunami" to metrics(),
    )
    val LABELS = mapOf(
        "magnitude" to "Magnitude", "mainshockMagnitude" to "Mainshock magnitude",
        "depthKm" to "Depth", "pagerAlert" to "USGS impact alert",
        "tsunamiFlag" to "Tsunami flag", "windKt" to "Maximum sustained wind", "category" to "Category",
        "pressureMb" to "Minimum central pressure", "movement" to "Moving",
        "areaHa" to "Area burned", "alertLevel" to "Observatory alert level",
        "aviationColour" to "Aviation colour code",
        "deaths" to "Lives lost", "injuries" to "Injured", "missing" to "Missing or unaccounted for",
        "displaced" to "People displaced", "evacuated" to "People evacuated",
        "affected" to "People affected",
    )
    private val COMPASS = listOf("north", "north-north-east", "north-east", "east-north-east",
        "east", "east-south-east", "south-east", "south-south-east",
        "south", "south-south-west", "south-west", "west-south-west",
        "west", "west-north-west", "north-west", "north-north-west")

    private fun published(e: JsonObject, k: String): Boolean = e.has(k) && e.jsNum(k).isFinite()

    fun compassOf(e: JsonObject, k: String): String? {
        if (!published(e, k)) return null
        val d = e.jsNum(k)
        return COMPASS[(jsRound((((d % 360) + 360) % 360) / 22.5).toInt()) % 16]
    }

    /** Round, then group with commas in threes. */
    fun group(n: Double): String {
        val x = jsRoundL(n)
        val s = Math.abs(x).toString().reversed().chunked(3).joinToString(",").reversed()
        return if (x < 0) "-$s" else s
    }

    fun cycloneCategory(kt: Double?): String? {
        val k = kt ?: return null
        if (!k.isFinite() || k <= 0) return null
        return when {
            k >= 137 -> "Category 5"; k >= 113 -> "Category 4"; k >= 96 -> "Category 3"
            k >= 83 -> "Category 2"; k >= 64 -> "Category 1"; k >= 34 -> "Tropical storm"
            else -> "Tropical depression"
        }
    }

    private fun factOf(e: JsonObject, key: String): KeyFact {
        val label = LABELS[key] ?: key
        val has = e.has(key)
        val v = e.el(key)
        return when (key) {
            "mainshockMagnitude", "magnitude" -> KeyFact(key, label, has, if (has) toFixed(jsNumber(v), 1) else null)
            "depthKm" -> KeyFact(key, label, has, if (has) "${jsRoundL(jsNumber(v))} km" else null)
            "pagerAlert" -> KeyFact(key, label, has, if (has) e.str(key)!!.lowercase(Locale.ROOT) else null,
                if (has) null else "USGS issued no impact assessment for this earthquake")
            "tsunamiFlag" -> KeyFact(key, label, has, if (has) (if (e.truthy(key)) "Raised" else "Not raised") else null,
                if (has) null else "Only the United States Geological Survey publishes a tsunami flag")
            "windKt" -> {
                val k = jsNumber(v)
                val kt = if (!has) null else if (k == Math.rint(k) && k.isFinite()) k.toLong().toString() else com.anchittandon.pnd.model.jsNumText(jsRound(k * 10) / 10)
                KeyFact(key, label, has, if (has) "$kt kt" else null)
            }
            "category" -> { val c = cycloneCategory(e.jsNum("windKt")); KeyFact(key, label, c != null, c) }
            "pressureMb" -> {
                val mb = jsNumber(v)
                val ok = has && mb.isFinite() && mb > 0
                KeyFact(key, label, ok, if (ok) group(mb) + " mb" else null, if (ok) null else "This source publishes no central pressure for this system")
            }
            "movement" -> {
                val where = compassOf(e, "movementDirDeg")
                val fast = if (published(e, "movementKt") && e.jsNum("movementKt") >= 0) "${jsRoundL(e.jsNum("movementKt"))} kt" else null
                val moving = where?.let { it + (if (fast != null) " at $fast" else "") }
                KeyFact(key, label, moving != null, moving, if (moving != null) null else "This source publishes no track for this system")
            }
            "areaHa" -> {
                val ha = e.jsNum("areaHa")
                val ok = ha.isFinite() && ha > 0
                val km = ha / 100
                val area = if (ha < 100) group(ha) + " ha" else if (km < 100) com.anchittandon.pnd.model.jsNumText(jsRound(km * 10) / 10) + " km²" else group(km) + " km²"
                KeyFact(key, label, ok, if (ok) area else null)
            }
            "aviationColour" -> KeyFact(key, label, has, if (has) e.str(key) else null,
                if (has) null else "This source publishes no aviation colour code for this volcano")
            "alertLevel" -> {
                val al = e.truthy("alertLevel")
                KeyFact(key, label, al, if (al) e.str("alertLevel") else null, if (al) null else "This source publishes no observatory alert level for this volcano")
            }
            else -> {
                val n = jsNumber(v)
                val reported = has && n.isFinite()
                KeyFact(key, label, reported, if (reported) group(n) else null)
            }
        }
    }

    fun keyFacts(e: JsonObject?): List<KeyFact> {
        val x = e ?: JsonObject(emptyMap())
        val h = hazardOf(x.str("type"))
        val keys = METRICS[h.key] ?: IMPACT
        return keys.map { factOf(x, it) }
    }

    /* ------------------------------------------------------------- applicability */

    const val RISK_RADIUS_KM = 500.0

    private fun ringWraps(ring: List<List<Double>>): Boolean {
        for (i in 1 until ring.size) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true
        return false
    }

    private fun inRing(lon: Double, lat: Double, ring: List<List<Double>>): Boolean {
        var inside = false
        var j = ring.size - 1
        for (i in ring.indices) {
            val xi = ring[i].getOrElse(0) { Double.NaN }; val yi = ring[i].getOrElse(1) { Double.NaN }
            val xj = ring[j].getOrElse(0) { Double.NaN }; val yj = ring[j].getOrElse(1) { Double.NaN }
            if (!xi.isFinite() || !yi.isFinite() || !xj.isFinite() || !yj.isFinite()) return false
            if (((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside
            j = i
        }
        return inside
    }

    private fun ringOf(r: JsonElement?): List<List<Double>>? {
        if (r !is JsonArray || r.size <= 2 || r[0] !is JsonArray) return null
        return r.map { p -> (p as? JsonArray)?.map { jsNumber(it) } ?: listOf(jsNumber(p)) }
    }

    private fun inPolygon(lon: Double, lat: Double, rings: JsonElement?): Boolean? {
        if (rings !is JsonArray || ringOf(rings.getOrNull(0)) == null) return null
        val parsed = rings.map { ringOf(it) ?: return null }
        for (r in parsed) if (ringWraps(r)) return null
        if (!inRing(lon, lat, parsed[0])) return false
        for (h in 1 until parsed.size) if (inRing(lon, lat, parsed[h])) return false
        return true
    }

    fun geometryContains(g: JsonElement?, lat: Double?, lon: Double?): Boolean? {
        if (g !is JsonObject || lat == null || lon == null || !lat.isFinite() || !lon.isFinite()) return null
        when (g.str("type")) {
            "Polygon" -> return inPolygon(lon, lat, g.el("coordinates"))
            "MultiPolygon" -> {
                val cs = g.el("coordinates") as? JsonArray ?: return null
                var undecidable = false
                for (p in cs) {
                    val r = inPolygon(lon, lat, p)
                    if (r == true) return true
                    if (r == null) undecidable = true
                }
                return if (undecidable) null else false
            }
            "GeometryCollection" -> {
                val gs = g.arr("geometries") ?: return null
                var unknown = false
                for (x in gs) {
                    val c = geometryContains(x, lat, lon)
                    if (c == true) return true
                    if (c == null) unknown = true
                }
                return if (unknown) null else false
            }
        }
        return null
    }

    fun distanceKm(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
        val r = Math.PI / 180; val R = 6371.0
        val x = (bLat - aLat) * r; val y = (bLon - aLon) * r
        val z = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(y / 2) * Math.sin(y / 2)
        return 2 * R * Math.asin(Math.sqrt(z))
    }

    val RISK_BANDS = listOf(
        RiskBand("A", "Confirmed events nearby",
            "Events an official agency has reported at an exact spot within 500 km of one of your places.",
            "No reported event within 500 km of your places."),
        RiskBand("B", "Official warnings for your places",
            "Warnings in force now. Where the agency published the area a warning covers, we checked whether your place is inside it.",
            "No official warning covers your places right now."),
        RiskBand("C", "Forecasts",
            "Our own estimates of what may happen next. They are not reports that something has happened, and they are not official warnings.",
            "No forecast covers your places right now."),
        RiskBand("D", "Wider-area reports",
            "Reports that give only the centre of a large area, not an exact spot. They are listed because that centre is within range; your place may or may not be inside the affected area.",
            "No wider-area report near your places right now."),
        RiskBand("E", "Past disasters", "What has happened at a place before.",
            "We do not publish a history of past events for each place, so nothing can be shown here. Your national or regional disaster agency keeps the official record.",
            dataAvailable = false),
    )

    object Applicability {
        const val INSIDE_INCIDENT = "Your place is inside the reported affected area."
        const val INSIDE_WARNING = "Your place is inside the official warning area."
        const val OUTSIDE_WARNING = "Your place is outside the official warning area."
        const val UNDETERMINED = "This is a regional warning. We could not tell whether it covers your exact place."
        const val FORECAST = "This is a forecast of what may happen, not a report that something has happened."
        const val OUTSIDE_FORECAST = "Your place is outside the forecast area."
        const val COUNTRY_FORECAST = "This forecast covers the whole country your place is in, not one specific spot."
        const val COUNTRY_UNKNOWN_PLACE = "This forecast covers a whole country, but your saved place has no country recorded. Search for the place by name instead of entering coordinates, and we can check."
        const val COUNTRY_UNRECOGNISED_PLACE = "This forecast covers a whole country, but we could not recognise the country of your saved place. This can happen if you searched in another language. Search for the place by name again to fix it."
        const val AREA_LEVEL = "This report gives only the centre of an area, not an exact spot. We could not tell whether your place is inside the affected area."
    }

    fun coordOf(o: JsonObject?, k: String): Double? {
        val v = o.el(k) ?: return null
        if (v is JsonPrimitive && v.isString && v.content.isEmpty()) return null
        val n = jsNumber(v)
        return if (n.isFinite()) n else null
    }

    fun countryKey(name: String?): String {
        var s = (name ?: "").lowercase(Locale.ROOT)
        s = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("[̀-ͯ]"), "")
        return s.replace(Regex("[^a-z]"), "")
    }

    /** ICU English region names, with the few names Java's older data spells differently mapped to ICU's. */
    private val NAME_FIXES = mapOf(
        "US" to "United States", "GB" to "United Kingdom", "CD" to "Congo - Kinshasa", "CG" to "Congo - Brazzaville",
        "CI" to "Côte d’Ivoire", "MM" to "Myanmar (Burma)", "HK" to "Hong Kong SAR China", "MO" to "Macao SAR China",
        "PS" to "Palestinian Territories", "KR" to "South Korea", "KP" to "North Korea", "RU" to "Russia", "SY" to "Syria",
        "IR" to "Iran", "LA" to "Laos", "VN" to "Vietnam", "BO" to "Bolivia", "VE" to "Venezuela", "TZ" to "Tanzania",
        "MD" to "Moldova", "TW" to "Taiwan", "CZ" to "Czechia", "MK" to "North Macedonia", "TR" to "Türkiye",
        "SZ" to "Eswatini", "CV" to "Cape Verde", "FM" to "Micronesia", "VA" to "Vatican City", "BN" to "Brunei",
    )

    fun countryFromCode(code: String?): String? {
        val c = (code ?: "").trim().uppercase(Locale.ROOT)
        if (!Regex("^[A-Z]{2}$").matches(c)) return null
        NAME_FIXES[c]?.let { return it }
        val n = try { Locale("", c).getDisplayCountry(Locale.ENGLISH) } catch (e: Exception) { null }
        return if (n.isNullOrEmpty() || n == c) null else n
    }

    fun placeCountryKeys(place: JsonObject?): List<String> {
        val keys = mutableListOf<String>()
        countryFromCode(place.str("countryCode"))?.let { keys += countryKey(it) }
        val named = countryKey(place.str("country"))
        if (named.isNotEmpty() && named !in keys) keys += named
        return keys
    }

    fun countryMatches(place: JsonObject?, name: String?): Boolean {
        val want = countryKey(name)
        return want.isNotEmpty() && want in placeCountryKeys(place)
    }

    private val englishCountryKeys: Set<String> by lazy {
        val out = HashSet<String>()
        for (a in 'A'..'Z') for (b in 'A'..'Z') countryFromCode("$a$b")?.let { out += countryKey(it) }
        out
    }

    /** Every English country name the platform knows (for the Calamities country filter). */
    val englishCountryNames: List<String> by lazy {
        val out = LinkedHashSet<String>()
        val skip = Regex("Unknown Region|Pseudo|European Union|Eurozone|United Nations|Outlying Oceania|^world$", RegexOption.IGNORE_CASE)
        for (a in 'A'..'Z') for (b in 'A'..'Z') countryFromCode("$a$b")?.let { if (!skip.containsMatchIn(it)) out += it }
        out.sortedWith(Sorts.collator)
    }

    fun countryComparable(place: JsonObject?): Boolean {
        if (countryFromCode(place.str("countryCode")) != null) return true
        val k = countryKey(place.str("country"))
        if (k.isEmpty()) return false
        val names = englishCountryKeys
        if (names.isEmpty()) return true
        return k in names
    }

    fun riskRow(e: JsonObject?, place: JsonObject?, radiusKm: Double = RISK_RADIUS_KM): RiskRow? {
        val ev = e ?: JsonObject(emptyMap())
        val pLat = coordOf(place, "lat"); val pLon = coordOf(place, "lon")
        val eLat = coordOf(ev, "lat"); val eLon = coordOf(ev, "lon")
        if (pLat == null || pLon == null) return null
        val contains = geometryContains(ev.el("geometry"), pLat, pLon)
        val d = if (eLat != null && eLon != null) distanceKm(pLat, pLon, eLat, eLon) else null
        val near = d != null && d <= radiusKm
        fun out(band: String, note: String, claim: Boolean) = RiskRow(band, d, claim, contains, note, ev.text("proximityReason"))

        if (ev.truthy("isForecast") || ev.truthy("forecast")) {
            if (contains == true) return out("C", Applicability.FORECAST, false)
            if (contains == false) return if (near) out("D", Applicability.OUTSIDE_FORECAST, false) else null
            if (ev.str("forecastScope") == "country" && ev.truthy("country")) {
                if (countryMatches(place, ev.str("country"))) return out("C", Applicability.COUNTRY_FORECAST, false)
                if (placeCountryKeys(place).isNotEmpty()) {
                    if (countryComparable(place)) return null
                    return if (near) out("C", Applicability.COUNTRY_UNRECOGNISED_PLACE, false) else null
                }
                return if (near) out("C", Applicability.COUNTRY_UNKNOWN_PLACE, false) else null
            }
            return if (near) out("C", Applicability.FORECAST, ev.truthy("proximityEligible")) else null
        }
        if (ev.str("evidenceState") == "official-warning") {
            if (contains == true) return out("B", Applicability.INSIDE_WARNING, false)
            if (contains == false) return if (near) out("D", Applicability.OUTSIDE_WARNING, false) else null
            return if (near) out("B", Applicability.UNDETERMINED, false) else null
        }
        if (contains == true) return out("A", Applicability.INSIDE_INCIDENT, false)
        if (ev.truthy("proximityEligible") && near) return out("A", "", true)
        if (contains == false) return if (near) out("D", Applicability.OUTSIDE_WARNING, false) else null
        return if (near) out("D", Applicability.AREA_LEVEL, false) else null
    }

    /* ---------------------------------------------------- forecast classification */

    val FORECAST_CLASSES: Map<String, ForecastClassDef> = linkedMapOf(
        "independent-prospective" to ForecastClassDef("Made in advance", "Recorded before the event it forecasts had started.", true),
        "warning-derived" to ForecastClassDef("Based on an official warning", "Made from an official warning that had already been issued.", false),
        "continuation-outlook" to ForecastClassDef("Follows an ongoing event", "Made after the event had started. It forecasts that the event will continue or get worse.", false),
        "post-event-conditional" to ForecastClassDef("After an earthquake", "Made after an event that has already happened, such as aftershocks following a large earthquake.", false),
        "retrospective-benchmark" to ForecastClassDef("Test case, not made in advance", "A test of the method, written after the period it covers had started.", false),
        "invalid-post-event" to ForecastClassDef("Not valid: no proof it came first", "Presented as made in advance, but nothing shows it existed before the period it covers.", false),
    )

    private val WARNING_PROVIDERS = Regex("(?:National Weather Service|Volcano Hazards Program)", RegexOption.IGNORE_CASE)

    fun classifyForecast(f: JsonObject?, parent: JsonObject? = null): Classification? {
        val x = f ?: JsonObject(emptyMap())
        if (!(x.truthy("forecast") || x.truthy("isForecast"))) return null
        fun say(k: String, why: String) = Classification(k, why)
        val kind = x.str("forecastKind")
        if (kind == "frozen-benchmark") return say("retrospective-benchmark", "Recorded as a frozen benchmark rather than as a forecast issued ahead of its window.")
        if (kind == "aftershock-sequence") return say("post-event-conditional", "Conditional on an earthquake that had already been observed when this was written.")
        if (x.truthy("forecastOf")) {
            val parentState = parent.text("evidenceState").ifEmpty {
                if (WARNING_PROVIDERS.containsMatchIn(x.text("source"))) "official-warning" else ""
            }
            if (parentState == "official-warning") return say("warning-derived", "Derived from an official warning that the issuing agency had already published.")
            return say("continuation-outlook", "Derived from a hazard already present in the feed, forecasting that it continues.")
        }
        val freeze = JsDate.parse(x.text("freezeTimestamp"))
        val start = JsDate.parse(x.text("targetStart"))
        if (freeze == null || x.bool("freezeEvidenced") == false) {
            return say("invalid-post-event", "No immutable record establishes that this forecast existed before the window it claims, so it cannot be counted as a prediction.")
        }
        if (start == null) return say("invalid-post-event", "The forecast names no window, so nothing can establish that it preceded one.")
        if (freeze > start) return say("invalid-post-event", "The earliest record of this forecast is later than the start of the window it claims.")
        return say("independent-prospective", "Frozen at ${x.str("freezeTimestamp")}, before the window opening at ${x.str("targetStart")}.")
    }

    private val TYPE_NAMES_NO_HAZARD = Regex("^(?:|natural hazard|other|others|unknown|unspecified|unclassified|complex emergency)$", RegexOption.IGNORE_CASE)

    private fun coordToken(o: JsonObject, k: String): String {
        val n = o.jsNum(k)
        return if (n.isFinite()) toFixed(n, 3) else "-"
    }

    /** hazard-model.js claimKey (logic.md §10.6). */
    fun claimKey(f: JsonObject?): String {
        val x = f ?: JsonObject(emptyMap())
        val title: JsonElement? = if (TYPE_NAMES_NO_HAZARD.matches((x.str("type") ?: "").trim())) x["title"] else null
        val parts: List<Any?> = listOf(x["id"], x["type"], x["targetStart"], x["targetEnd"], x["country"], x["region"],
            coordToken(x, "lat"), coordToken(x, "lon"), x["forecastScope"], title)
        return parts.joinToString("|") { v ->
            when (v) {
                null, is JsonNull -> "-"
                is JsonPrimitive -> if (v.isString && v.content.isEmpty()) "-" else v.content.trim()
                is JsonElement -> v.toString().trim()
                else -> v.toString().ifEmpty { "-" }.trim()
            }
        }
    }

    /** Only the measurement for a family of hazard, for event-detail "same family" checks. */
    fun familyOf(type: String?): String {
        val t = (type ?: "").lowercase(Locale.ROOT)
        if (t.contains("aftershock") || t.contains("earthquake")) return "earthquake"
        return t.split("/")[0].trim()
    }

    @Suppress("unused")
    private fun objOrEmpty(o: JsonObject?, k: String): JsonObject = o.obj(k) ?: JsonObject(emptyMap())
    @Suppress("unused")
    private fun numOrNull(o: JsonObject?, k: String) = o.num(k)
}
