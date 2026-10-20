package com.anchittandon.pnd.data

import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.GradingEngine
import com.anchittandon.pnd.logic.Ledgers
import com.anchittandon.pnd.logic.Place
import com.anchittandon.pnd.logic.PlaceSearch
import com.anchittandon.pnd.logic.TrackRecord
import com.anchittandon.pnd.logic.TrackRecordScreen
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.Feed
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File

/**
 * What the feed screens draw. A failed load is not an empty world: [failed] is set and the last
 * good copy, if any, stays on screen. A copy read from disk says so ([savedCopy]) and carries its own time.
 */
data class FeedState(
    val feed: Feed? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
    val savedCopy: Boolean = false,
) {
    val events: List<Event> get() = feed?.live ?: emptyList()
    val all: List<Event> get() = feed?.events ?: emptyList()
}

class FeedRepository(private val http: Http, private val cacheDir: File?, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(FeedState())
    val state: StateFlow<FeedState> = _state
    private val mutex = Mutex()

    init {
        // The last good copy from disk, shown at once and labelled as a saved copy until the network answers.
        readDisk()?.let { _state.value = FeedState(it, loading = true, failed = false, savedCopy = true) }
    }

    private fun cacheFile() = cacheDir?.let { File(it, "last-feed.json") }

    private fun readDisk(): Feed? = try { cacheFile()?.takeIf { it.exists() }?.readText()?.let { Feed.parse(it) } } catch (e: Exception) { null }

    /** `fresh` is an explicit user refresh: `?ts=` bypasses the 30 s edge copy. Timers never send it. */
    suspend fun refresh(fresh: Boolean = false) = mutex.withLock {
        _state.value = _state.value.copy(loading = true)
        val r = http.get(Api.events(fresh, AppClock.now()), if (fresh) mapOf("Cache-Control" to "no-cache") else emptyMap())
        val feed = if (r.ok) try { Feed.parse(r.body!!) } catch (e: Exception) { null } else null
        if (feed != null) {
            _state.value = FeedState(feed, loading = false, failed = false, savedCopy = false)
            withContext(Dispatchers.IO) { try { cacheFile()?.writeText(r.body!!) } catch (e: Exception) { /* a full disk is not an error to show */ } }
        } else {
            val cur = _state.value
            val keep = cur.feed ?: readDisk()
            _state.value = FeedState(keep, loading = false, failed = true, savedCopy = cur.savedCopy || (cur.feed == null && keep != null))
        }
    }

    fun refreshAsync(fresh: Boolean = false) { scope.launch { refresh(fresh) } }
}

/** `/api/event-enrichment`, cached per exact URL for 5 minutes (the edge does the same). */
class EnrichmentRepository(private val http: Http) {
    private val cache = HashMap<String, Pair<Long, JsonObject>>()

    sealed interface Result { data object Loading : Result; data object Failed : Result; data class Ok(val data: JsonObject) : Result }

    suspend fun load(url: String, force: Boolean = false): Result {
        val now = AppClock.now()
        cache[url]?.let { (at, d) -> if (!force && now - at < 300_000) return Result.Ok(d) }
        val r = http.get(url, emptyMap())
        val d = if (r.ok) try { PndJson.parseToJsonElement(r.body!!).jsonObject } catch (e: Exception) { null } else null
        if (d == null) return cache[url]?.let { Result.Ok(it.second) } ?: Result.Failed
        cache[url] = now to d
        return Result.Ok(d)
    }
}

/** Static JSON from the site, revalidated on each read (`cache: 'no-cache'`, no `?ts=`), the way the web reads ledgers. */
class DataRepository(private val http: Http) {
    suspend fun json(file: String): kotlinx.serialization.json.JsonElement? {
        val r = http.get(Api.data(file), mapOf("Cache-Control" to "no-cache"))
        return if (r.ok) try { PndJson.parseToJsonElement(r.body!!) } catch (e: Exception) { null } else null
    }

    suspend fun summary(): JsonObject? {
        val r = http.get(Api.summary(), emptyMap())
        return if (r.ok) try { PndJson.parseToJsonElement(r.body!!).jsonObject } catch (e: Exception) { null } else null
    }

    suspend fun alertsInfo(): JsonObject? {
        val r = http.get(Api.alerts(), emptyMap())
        return if (r.ok) try { PndJson.parseToJsonElement(r.body!!).jsonObject } catch (e: Exception) { null } else null
    }

    /** The last ledger row for a forecast id that has left the feed (features.md §7.4). Never a different forecast. */
    suspend fun ledgerRow(id: String): JsonObject? = ledgerLookup(id).row

    /** The ledger row, and whether the ledger could not be read at all (then the screen says the data is unavailable, not "not found"). */
    data class LedgerLookup(val row: JsonObject?, val failed: Boolean)

    suspend fun ledgerLookup(id: String): LedgerLookup {
        val l = json("outlook-ledger.json") as? JsonArray ?: return LedgerLookup(null, true)
        return LedgerLookup(l.objects().lastOrNull { it.str("id") == id }, false)
    }
}

/** Track record: fetch the ledgers, grade them with the site's scripts, build the screen. */
class TrackRecordRepository(private val data: DataRepository, private val engine: GradingEngine) {
    sealed interface State { data object Loading : State; data class Ready(val screen: TrackRecordScreen, val ledgers: Ledgers) : State }
    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state
    private var started = false

    suspend fun load(force: Boolean = false) = coroutineScopeLoad(force)

    private suspend fun coroutineScopeLoad(force: Boolean) {
        if (started && !force) return
        started = true
        _state.value = State.Loading
        val l = kotlinx.coroutines.coroutineScope {
            val o = async { data.json("outlook-ledger.json") as? JsonArray }
            val v = async { data.json("verification-ledger.json") as? JsonObject }
            val ob = async { data.json("observed-disasters.json") as? JsonObject }
            val s = async { data.json("scan-ledger.json") as? JsonObject }
            val b = async { data.json("model-backtest.json") as? JsonObject }
            val m = async { data.json("model-verdicts.json") as? JsonObject }
            Ledgers(o.await(), v.await(), ob.await(), s.await(), b.await(), m.await())
        }
        val now = AppClock.now()
        val canGrade = l.outlook != null && l.verification != null && l.observed != null && l.scan != null
        val graded = if (canGrade) withContext(Dispatchers.Default) {
            try { engine.grade(TrackRecord.driverInput(l, now)) } catch (e: Throwable) { null }
        } else null
        _state.value = State.Ready(withContext(Dispatchers.Default) { TrackRecord.build(l, graded, now) }, l)
    }
}

/** OpenStreetMap Nominatim, only on an explicit submit, at most one request a second. */
class PlaceSearchRepository(private val http: Http) {
    private var last = 0L
    sealed interface Result { data class Ok(val places: List<Place>) : Result; data object Failed : Result }

    suspend fun search(q: String): Result {
        val wait = 1000 - (System.currentTimeMillis() - last)
        if (wait > 0) kotlinx.coroutines.delay(wait)
        last = System.currentTimeMillis()
        val r = http.get(PlaceSearch.url(q), mapOf("Accept" to "application/json"))
        if (!r.ok) return Result.Failed
        return try { Result.Ok(PlaceSearch.candidates(PndJson.parseToJsonElement(r.body!!).jsonArray.objects())) } catch (e: Exception) { Result.Failed }
    }
}

@Suppress("unused") private fun JsonObject.t(k: String) = text(k)
