package com.anchittandon.pnd.data

import com.anchittandon.pnd.logic.GradingEngine
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

/** Things only the device can do. The app implements them; tests fake them. */
interface Platform {
    fun openUrl(url: String)
    fun share(title: String, url: String)
    fun dial(number: String) = openUrl("tel:$number")
    /** Current position, or null when location was not shared (denied, off or timed out). */
    suspend fun currentLocation(prompt: Boolean): Pair<Double, Double>?
    fun hasLocationPermission(): Boolean
    /** Notification permission state: true granted, false not granted. */
    fun notificationsAllowed(): Boolean
    suspend fun requestNotifications(): Boolean
    fun scheduleBackgroundChecks(on: Boolean)
}

/** Country outlines from the site's /world-countries.json, bundled; also the on-device "which country am I in". */
class Countries(private val text: () -> String) {
    val features: List<JsonObject> by lazy {
        try { PndJson.parseToJsonElement(text()).jsonObject.arr("features").objects() } catch (e: Exception) { emptyList() }
    }

    /** Point in polygon on the device: the position is never sent anywhere to be named. */
    fun countryAt(lat: Double, lon: Double): String? =
        features.firstOrNull { Hazards.geometryContains(it.obj("geometry"), lat, lon) == true }?.obj("properties")?.str("n")
}

class AppContainer(
    val http: Http,
    val settings: SettingsStore,
    cacheDir: File?,
    val assetText: (String) -> String,
    val scope: CoroutineScope,
    val platform: Platform,
) {
    val feed = FeedRepository(http, cacheDir, scope)
    val enrichment = EnrichmentRepository(http)
    val data = DataRepository(http)
    val engine = GradingEngine { assetText("js/$it") }
    val trackRecord = TrackRecordRepository(data, engine)
    val placeSearch = PlaceSearchRepository(http)
    val countries = Countries { assetText("world-countries.json") }
    val history: List<JsonObject> by lazy {
        try { PndJson.parseToJsonElement(assetText("history.json")).let { (it as kotlinx.serialization.json.JsonArray).objects() } } catch (e: Exception) { emptyList() }
    }
}
