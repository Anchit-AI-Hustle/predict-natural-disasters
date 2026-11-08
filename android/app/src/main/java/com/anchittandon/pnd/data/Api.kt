package com.anchittandon.pnd.data

import com.anchittandon.pnd.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/** One HTTP answer; a non-200 or a network error is never read as an empty result. */
data class HttpResult(val code: Int, val body: String?) {
    val ok: Boolean get() = code in 200..299 && body != null
}

/** The only way the app talks to the network, so tests can answer from fixtures. */
fun interface Http {
    suspend fun get(url: String, headers: Map<String, String>): HttpResult
}

object Api {
    const val BASE = "https://predict-natural-disasters.anchit-tandon.com"

    /** Identifies the app to this site and to Nominatim (its usage policy asks for a real User-Agent). No personal data. */
    val USER_AGENT = "PredictNaturalDisasters-Android/${BuildConfig.VERSION_NAME} (+$BASE/about)"

    /**
     * The feed is one shared copy at the edge, rebuilt once it is 60 s old (api/events.js, vercel.json); `?cron=` is the only
     * fresh path and is not the app's to use. A new address per refresh (`?ts=`) sent every click to every provider, so an
     * explicit refresh asks with `Cache-Control: no-cache` on the same address instead, as the website does.
     */
    fun events(): String = "$BASE/api/events"

    /** The request headers for a feed read: an explicit user refresh revalidates (`cache: 'no-cache'`); timers send none. */
    fun eventsHeaders(fresh: Boolean): Map<String, String> = if (fresh) mapOf("Cache-Control" to "no-cache") else emptyMap()
    fun summary(): String = "$BASE/api/events?summary=1"
    fun alerts(): String = "$BASE/api/alerts"
    /** Static data files are served `max-age=0, must-revalidate`; reads revalidate with no-cache and carry no `?ts=` (changelog C25). */
    fun data(file: String): String = "$BASE/data/$file"

    /** Same parameter order and values as the web, so the edge cache is shared (api.md §3.1). */
    fun enrichment(title: String, country: String, region: String, type: String, updated: String, forecast: Boolean, lat: Double?, lon: Double?): String {
        // URLSearchParams encoding (spaces as +), as the web sends it, so the edge cache is shared.
        val e = { v: String -> java.net.URLEncoder.encode(v, "UTF-8") }
        val sb = StringBuilder("$BASE/api/event-enrichment?title=").append(e(title))
            .append("&country=").append(e(country)).append("&region=").append(e(region))
            .append("&type=").append(e(type)).append("&updated=").append(e(updated))
            .append("&forecast=").append(if (forecast) "true" else "false")
        if (lat != null && lon != null && lat.isFinite() && lon.isFinite()) sb.append("&lat=").append(com.anchittandon.pnd.model.jsNumText(lat)).append("&lon=").append(com.anchittandon.pnd.model.jsNumText(lon))
        return sb.toString()
    }

    /** Resolves a relative sourceUrl (ND-001's "/verification") against the site. */
    fun absolute(url: String): String = if (url.startsWith("/")) BASE + url else url
}

/** OkHttp, with a 25 s timeout because a feed rebuild can take 3 to 6 s per provider (api.md §1.2). No HTTP cache. */
class OkHttpHttp(private val client: OkHttpClient = defaultClient()) : Http {
    override suspend fun get(url: String, headers: Map<String, String>): HttpResult = withContext(Dispatchers.IO) {
        try {
            val rb = Request.Builder().url(url).header("User-Agent", Api.USER_AGENT).header("Accept", "application/json")
            headers.forEach { (k, v) -> rb.header(k, v) }
            client.newCall(rb.build()).execute().use { r -> HttpResult(r.code, r.body?.string()) }
        } catch (e: IOException) {
            HttpResult(0, null)
        } catch (e: IllegalArgumentException) {
            HttpResult(0, null)
        }
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).callTimeout(40, TimeUnit.SECONDS)
            .build()
    }
}
