package com.anchittandon.pnd.ui

import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.logic.Format

/** The collection views of collection.js (features.md §3.2). */
enum class CollectionView(val route: String, val title: String, val subtitle: String, val noun: String) {
    EVENTS("events", "Events happening now", "Disasters reported by official agencies, and our own forecasts of what may happen next.", "events"),
    RECENT("recent-events", "Recent events", "The latest disasters reported by official agencies.", "recent events"),
    OFFICIAL("official-warnings", "Official warnings", "Warnings and watches that official agencies have issued and that are in force now. Reports of disasters that already happened are on Alerts & events.", "official warnings"),
    ALERTS_NOTIFICATIONS("alerts-notifications", "Current alerts", "Warnings and watches that official agencies have issued and that are in force now, with a link to each source. Reports of disasters that already happened are on Alerts & events.", "alerts"),
    HAZARD_TYPES("hazard-types", "Events by type", "Browse current events by type: flood, earthquake, wildfire, volcano, storm and drought.", "events"),
    HISTORICAL("historical-events", "Past and recent events", "Recent past events from GDACS, plus the events happening now.", "events"),
    COMPARE("compare-locations", "Compare places", "Search for a place to see its current events. Then search for another place to compare.", "events"),
    FORECAST_LIST("forecast-list", "Our forecasts", "All our current forecasts of what may happen next, including test cases that were not made in advance.", "forecasts"),
}

enum class DetailKind { EVENT, ALERT, CALAMITY }

/** Web paths and app links to screen routes (features.md §0.1 deep links, `PND.canonicalDetailUrl`). */
object DeepLinks {
    private val SIMPLE = setOf("live-map", "alerts", "forecasts", "personal-risk", "accuracy", "forecast-calendar", "calamities", "regions",
        "resources", "insights", "methodology", "about", "verification", "more", "settings") + CollectionView.entries.map { it.route }
    private val DETAIL = setOf("disasters", "alerts", "calamities", "forecasts", "regions", "locations", "hazards", "history", "sources")

    /** A screen route for a path or a full site URL; null when the app has no such screen. */
    fun route(raw: String): String? {
        var s = raw.trim()
        if (s.startsWith(Api.BASE)) s = s.removePrefix(Api.BASE)
        else if (s.startsWith("http://predict-natural-disasters.anchit-tandon.com")) s = s.removePrefix("http://predict-natural-disasters.anchit-tandon.com")
        else if (s.startsWith("http")) return null
        s = s.substringBefore('#')
        val path = s.substringBefore('?').trimEnd('/').removeSuffix(".html")
        val query = s.substringAfter('?', "")
        val params = query.split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to (try { java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") } catch (e: Exception) { it.substringAfter('=') }) }
        val p = path.trimStart('/')
        if (p.isEmpty() || p == "index" || p.startsWith("home") || p == "dashboard" || p == "directory") return "home"
        when (p) {
            "event-detail" -> return "disasters/" + Format.enc(params["id"] ?: "")
            "calamity-detail" -> return "calamities/" + Format.enc(params["id"] ?: "")
            "alert-detail" -> return "alerts/" + Format.enc(params["id"] ?: "")
            "forecast-detail" -> return "forecasts/" + Format.enc(params["id"] ?: "ND-001")
            "region-detail" -> return "regions/" + Format.enc(params["region"] ?: params["country"] ?: "World")
            "location-detail" -> return "locations/" + Format.enc(params["location"] ?: "World") + locQuery(params)
            "hazard-detail" -> return "hazards/" + Format.enc(params["type"] ?: "Flood") + (params["region"]?.let { "?region=" + Format.enc(it) } ?: "")
            "historical-event-detail" -> return "history/" + Format.enc(params["id"] ?: params["name"] ?: "")
            "source-detail" -> return "sources/" + Format.enc(params["source"] ?: "GDACS")
            "verification-detail" -> return "verification-detail"
            "live" -> return "live-map"
        }
        if (p in SIMPLE) {
            val q = params["q"] ?: params["search"]
            val region = params["region"]
            return p + when {
                q != null && CollectionView.entries.any { it.route == p } -> "?q=" + Format.enc(q)
                region != null && (p == "forecast-calendar" || CollectionView.entries.any { it.route == p }) -> "?region=" + Format.enc(region)
                else -> ""
            }
        }
        val head = p.substringBefore('/')
        val rest = p.substringAfter('/', "")
        if (head in DETAIL && rest.isNotEmpty()) {
            return when (head) {
                "locations" -> "locations/$rest" + locQuery(params)
                "hazards" -> "hazards/$rest" + (params["region"]?.let { "?region=" + Format.enc(it) } ?: "")
                else -> "$head/$rest"
            }
        }
        return null
    }

    private fun locQuery(p: Map<String, String>): String {
        val keys = listOf("lat", "lon", "level", "country", "cc").filter { p[it] != null }
        return if (keys.isEmpty()) "" else "?" + keys.joinToString("&") { "$it=" + Format.enc(p.getValue(it)) }
    }

    /** The website URL of a route, for Share. */
    fun webUrl(path: String): String = Api.BASE + (if (path.startsWith("/")) path else "/$path")
}
