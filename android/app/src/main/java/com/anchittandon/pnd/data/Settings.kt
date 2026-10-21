package com.anchittandon.pnd.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.anchittandon.pnd.logic.Place
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.num
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** Where key/value settings live: DataStore in the app, memory in tests. */
interface KeyValueBackend {
    fun load(): Map<String, String>
    fun save(key: String, value: String?)
}

class MemoryBackend(initial: Map<String, String> = emptyMap()) : KeyValueBackend {
    private val m = HashMap(initial)
    override fun load(): Map<String, String> = HashMap(m)
    override fun save(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value }
}

private val Context.pndStore: DataStore<Preferences> by preferencesDataStore(name = "pnd_settings")

class DataStoreBackend(private val context: Context, private val scope: CoroutineScope) : KeyValueBackend {
    override fun load(): Map<String, String> = runBlocking {
        context.pndStore.data.first().asMap().entries.associate { (k, v) -> k.name to v.toString() }
    }
    override fun save(key: String, value: String?) {
        scope.launch { context.pndStore.edit { p -> val k = stringPreferencesKey(key); if (value == null) p.remove(k) else p[k] = value } }
    }
}

/**
 * Settings, saved places, sort choices and notification memory. The website keeps these in
 * localStorage under the same names (`pnd_timezone`, `pnd_saved_locations`, `pnd_sort_*`, `pnd_notified`).
 */
class SettingsStore(private val backend: KeyValueBackend) {
    private val _values = MutableStateFlow(backend.load())
    val values: StateFlow<Map<String, String>> = _values

    operator fun get(key: String): String? = _values.value[key]
    fun set(key: String, value: String?) {
        _values.value = _values.value.toMutableMap().apply { if (value == null) remove(key) else put(key, value) }
        backend.save(key, value)
    }

    /** IST by default, as the website does (features.md §17). */
    /** The chosen zone, else the device's, else Asia/Kolkata (logic.md §6.13). */
    val timezone: String get() = com.anchittandon.pnd.logic.Portal.timezone(this["pnd_timezone"], com.anchittandon.pnd.logic.AppClock.deviceZone)
    fun setTimezone(tz: String) = set("pnd_timezone", tz)

    fun sort(screen: String, keys: List<String>): String = this["pnd_sort_$screen"]?.takeIf { it in keys } ?: keys.first()
    fun setSort(screen: String, key: String) = set("pnd_sort_$screen", key)

    var alertsEnabled: Boolean
        get() = this["pnd_alerts_on"] == "1"
        set(v) = set("pnd_alerts_on", if (v) "1" else null)

    var mapLayer: String
        get() = this["pnd_map_layer"] ?: "map"
        set(v) = set("pnd_map_layer", v)

    fun radius(level: String): Int? = this["pnd_radius_$level"]?.toIntOrNull()
    fun setRadius(level: String, km: Int) = set("pnd_radius_$level", km.toString())

    /* --------------------------------------------------------------- places */

    val places: List<Place> get() = parsePlaces(this["pnd_saved_locations"])

    fun savePlaces(list: List<Place>) = set("pnd_saved_locations", JsonArray(list.map { it.json() }).toString())

    fun addPlace(p: Place, now: Long): List<Place> {
        val list = places + p.copy(id = "loc-$now")
        savePlaces(list); return list
    }

    fun removePlace(id: String): List<Place> { val list = places.filter { it.id != id }; savePlaces(list); return list }

    /** `loc-current` is unique: replaced and moved to the front, rounded to 2 decimals. */
    fun setCurrentLocation(lat: Double, lon: Double, country: String, countryCode: String, updatedAt: String): List<Place> {
        val cur = Place("loc-current", "Current location", "Current location", Math.round(lat * 100) / 100.0, Math.round(lon * 100) / 100.0, country, countryCode, updatedAt)
        val list = listOf(cur) + places.filter { it.id != "loc-current" }
        savePlaces(list); return list
    }

    /* ------------------------------------------------------ notification memory */

    fun notified(): MutableMap<String, Long> = try {
        PndJson.parseToJsonElement(this["pnd_notified"] ?: "{}").jsonObject.mapValues { (it.value as JsonPrimitive).content.toDouble().toLong() }.toMutableMap()
    } catch (e: Exception) { HashMap() }

    fun saveNotified(m: Map<String, Long>, now: Long) {
        // Keep two weeks of memory; the 6-hour rule only ever looks back 6 hours.
        val kept = m.filterValues { now - it < 14L * 86_400_000 }
        set("pnd_notified", JsonObject(kept.mapValues { JsonPrimitive(it.value) }).toString())
    }

    companion object {
        fun parsePlaces(raw: String?): List<Place> = try {
            PndJson.parseToJsonElement(raw ?: "[]").jsonArray.objects().mapNotNull { o ->
                val lat = o.num("lat"); val lon = o.num("lon")
                if (lat == null || lon == null) null
                else Place(o.text("id"), o.text("kind").ifEmpty { "Place" }, o.text("name"), lat, lon, o.text("country"), o.text("countryCode"), o.str("updatedAt"))
            }
        } catch (e: Exception) { emptyList() }
    }
}
