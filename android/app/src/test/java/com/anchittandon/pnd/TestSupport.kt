package com.anchittandon.pnd

import com.anchittandon.pnd.data.AppContainer
import com.anchittandon.pnd.data.Http
import com.anchittandon.pnd.data.HttpResult
import com.anchittandon.pnd.data.MemoryBackend
import com.anchittandon.pnd.data.Platform
import com.anchittandon.pnd.data.SettingsStore
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.PndJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

/** Fixtures from docs/native-parity, copied into the test resources. Nothing here calls the network. */
object Fixtures {
    fun text(name: String): String = Fixtures::class.java.getResource("/$name")!!.readText()
    val events: String by lazy { text("sample-events.json") }
    val enrichment: JsonObject by lazy { PndJson.parseToJsonElement(text("sample-enrichment.json")).jsonObject }
    val ledgers: JsonObject by lazy { PndJson.parseToJsonElement(text("ledgers-fixture.json")).jsonObject }
    val NOW: Long = JsDate.parse("2026-10-20T12:00:00Z")!!

    /** A Nominatim answer, shaped like the real one (two Springfields). */
    const val NOMINATIM = """[
      {"lat":"27.7172","lon":"85.3240","name":"Kathmandu","display_name":"Kathmandu, Bagmati Province, Nepal","addresstype":"city",
       "address":{"city":"Kathmandu","state":"Bagmati Province","country":"Nepal","country_code":"np"}},
      {"lat":"27.70","lon":"85.30","name":"Kathmandu","display_name":"Kathmandu District, Bagmati Province, Nepal","addresstype":"county",
       "address":{"county":"Kathmandu","state":"Bagmati Province","country":"Nepal","country_code":"np"}}
    ]"""
}

/** Answers from fixtures by URL; [failEvents] makes the feed fail as a network error does. */
class FakeHttp(var failEvents: Boolean = false, var failEnrichment: Boolean = false, var eventsBody: String? = null, var failData: Boolean = false) : Http {
    val requests = mutableListOf<String>()
    val headers = mutableListOf<Map<String, String>>()
    override suspend fun get(url: String, headers: Map<String, String>): HttpResult {
        requests += url
        this.headers += headers
        val path = url.substringAfter("anchit-tandon.com").substringBefore('?')
        return when {
            url.startsWith("https://nominatim.openstreetmap.org/") -> HttpResult(200, Fixtures.NOMINATIM)
            path == "/api/events" -> if (failEvents) HttpResult(0, null) else HttpResult(200, eventsBody ?: Fixtures.events)
            path == "/api/event-enrichment" -> if (failEnrichment) HttpResult(503, "{}") else HttpResult(200, Fixtures.enrichment["response"].toString())
            failData && path.startsWith("/data/") -> HttpResult(503, null)
            path == "/api/alerts" -> HttpResult(200, """{"available":false,"reason":"Background alerts are not switched on for this site yet.","schedule":null,"keeps":"For each place: its kind and its position rounded to about 1 km.","rules":{"nearKm":30,"severeNearKm":100,"recentHours":72},"publicKey":null,"lastRun":null}""")
            path == "/data/outlook-ledger.json" -> HttpResult(200, Fixtures.ledgers["outlook"].toString())
            path == "/data/verification-ledger.json" -> HttpResult(200, Fixtures.ledgers["verification"].toString())
            path == "/data/observed-disasters.json" -> HttpResult(200, Fixtures.ledgers["observed"].toString())
            path == "/data/scan-ledger.json" -> HttpResult(200, Fixtures.ledgers["scan"].toString())
            path == "/data/model-backtest.json" -> HttpResult(200, Fixtures.ledgers["backtest"].toString())
            path == "/data/model-verdicts.json" -> HttpResult(200, Fixtures.ledgers["modelVerdicts"].toString())
            else -> HttpResult(404, null)
        }
    }
}

class FakePlatform : Platform {
    val opened = mutableListOf<String>()
    val shared = mutableListOf<Pair<String, String>>()
    var location: Pair<Double, Double>? = 27.7 to 85.32
    var notifications = true
    var scheduled: Boolean? = null
    override fun openUrl(url: String) { opened += url }
    override fun share(title: String, url: String) { shared += title to url }
    override suspend fun currentLocation(prompt: Boolean): Pair<Double, Double>? = location
    override fun hasLocationPermission(): Boolean = location != null
    override fun notificationsAllowed(): Boolean = notifications
    override suspend fun requestNotifications(): Boolean = notifications
    override fun scheduleBackgroundChecks(on: Boolean) { scheduled = on }
}

fun testContainer(http: Http = FakeHttp(), settings: Map<String, String> = emptyMap(), platform: Platform = FakePlatform()): AppContainer {
    AppClock.now = { Fixtures.NOW }
    // The device zone is the default (changelog C9); the tests fix it so screenshots do not follow the machine.
    AppClock.deviceZone = { "Asia/Kolkata" }
    AppClock.zone = settings["pnd_timezone"] ?: "Asia/Kolkata"
    val assets = File("src/main/assets")
    return AppContainer(http, SettingsStore(MemoryBackend(settings)), null, { File(assets, it).readText() },
        CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), platform)
}

/** Two saved places near fixture records: Kathmandu (Nepal flood) and Phoenix (US heat warning). */
val SAVED_PLACES = """[{"id":"loc-1","kind":"Home","name":"Kathmandu","lat":27.7,"lon":85.32,"country":"Nepal","countryCode":"NP"},
 {"id":"loc-2","kind":"Family","name":"Phoenix","lat":33.45,"lon":-112.07,"country":"United States","countryCode":"US"}]"""
