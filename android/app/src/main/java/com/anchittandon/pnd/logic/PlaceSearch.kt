package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import java.util.Locale

/** A place the user can check or save (logic.md §3.6). */
data class Place(
    val id: String = "",
    val kind: String = "Place",
    val name: String,
    val lat: Double,
    val lon: Double,
    val country: String = "",
    val countryCode: String = "",
    val updatedAt: String? = null,
    /** Search candidates only. */
    val full: String = "",
    val level: String = "",
) {
    fun json(): JsonObject = com.anchittandon.pnd.model.jsonObjectOf(
        "id" to id, "kind" to kind, "name" to name, "lat" to lat, "lon" to lon,
        "country" to country, "countryCode" to countryCode, "updatedAt" to updatedAt,
    )
}

/** place-search.js (logic.md §3.5). */
object PlaceSearch {
    const val ENDPOINT = "https://nominatim.openstreetmap.org/search"

    private val LEVELS = listOf(
        "Area" to Regex("^(neighbourhood|suburb|quarter|city_district|borough|locality|village|hamlet|isolated_dwelling|croft|allotments|city_block|residential|farm)$"),
        "City or town" to Regex("^(city|town|municipality)$"),
        "District" to Regex("^(county|district|state_district|subdistrict|district_council)$"),
        "State or region" to Regex("^(state|province|region|territory)$"),
        "Country" to Regex("^(country|nation)$"),
        "Address or landmark" to Regex("^(road|house|house_number|building|amenity|shop|tourism|leisure|office|highway|railway|aeroway|man_made|historic|natural|place_of_worship|school|university|hospital|postcode)$"),
    )

    fun levelOf(r: JsonObject?): String {
        val t = (if (r.truthy("addresstype")) r.text("addresstype") else r.text("type")).lowercase(Locale.ROOT)
        for ((name, re) in LEVELS) if (re.matches(t)) return name
        val rank = r.jsNum("place_rank")
        if (rank.isFinite()) {
            return when {
                rank <= 4 -> "Country"; rank <= 8 -> "State or region"; rank <= 12 -> "District"
                rank <= 16 -> "City or town"; rank <= 25 -> "Area"; else -> "Address or landmark"
            }
        }
        return "Place"
    }

    fun labelOf(r: JsonObject?): String {
        val a = r.obj("address")
        val name = if (r.truthy("name")) r.text("name") else r.text("display_name").split(",")[0].trim()
        val town = a.firstOf("city", "town", "village", "municipality", "county")
        val state = a.firstOf("state", "region", "province")
        val out = mutableListOf<String>()
        listOf(name, town, state, a.text("country")).forEach { p0 ->
            val p = p0.trim()
            if (p.isNotEmpty() && out.none { it.lowercase(Locale.ROOT) == p.lowercase(Locale.ROOT) }) out += p
        }
        return out.joinToString(", ").ifEmpty { r.text("display_name") }
    }

    private fun JsonObject?.firstOf(vararg keys: String): String {
        for (k in keys) if (truthy(k)) return str(k) ?: ""
        return ""
    }

    fun candidates(results: List<JsonObject>): List<Place> {
        val seen = HashSet<String>()
        val out = mutableListOf<Place>()
        for (r in results) {
            val lat = r.jsNum("lat"); val lon = r.jsNum("lon")
            if (!lat.isFinite() || !lon.isFinite() || r["lat"] == null || r["lon"] == null) continue
            val a = r.obj("address")
            val c = Place(kind = "Searched", name = labelOf(r), full = r.text("display_name"), level = levelOf(r), lat = lat, lon = lon,
                country = a.text("country"), countryCode = a.text("country_code").uppercase(Locale.ROOT))
            val k = c.name.lowercase(Locale.ROOT) + "|" + c.level
            if (!seen.add(k)) continue
            out += c
        }
        return out
    }

    fun url(q: String): String = "$ENDPOINT?format=jsonv2&addressdetails=1&accept-language=en&limit=8&q=" + Format.enc(q)
}
