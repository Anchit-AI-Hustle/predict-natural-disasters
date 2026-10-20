package com.anchittandon.pnd.model

import com.anchittandon.pnd.logic.Glossary
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * One feed record. The JSON is kept whole (api.md §8: keep unknown fields) and read through
 * typed accessors with the site's absent-is-absent rules.
 */
class Event(val json: JsonObject) {
    val id: String get() = json.str("id") ?: ""
    val title: String get() = json.text("title")
    val type: String get() = json.text("type")
    val source: String get() = json.text("source")
    val sourceType: String get() = json.text("sourceType")
    val evidenceState: String get() = json.text("evidenceState")
    val alert: String get() = json.text("alert")
    val severity: String get() = json.text("severity")
    val country: String get() = json.text("country")
    val region: String get() = json.text("region")
    val details: String get() = json.text("details")
    val updated: String get() = json.text("updated")
    val sourceUrl: String get() = json.text("sourceUrl")
    val lat: Double? get() = json.num("lat")
    val lon: Double? get() = json.num("lon")
    /** `e.forecast` (truthy). */
    val forecast: Boolean get() = json.truthy("forecast")
    val isForecastAny: Boolean get() = json.truthy("forecast") || json.truthy("isForecast")
    val cached: Boolean get() = json.truthy("cached")
    /** Absent means live. */
    val isLive: Boolean get() = json.bool("live") != false
    val official: Boolean get() = sourceType == "official"
    val windowClosed: Boolean get() = json.truthy("windowClosed")

    /** Search text, cached per record as search.js does. */
    val searchText: String by lazy { com.anchittandon.pnd.logic.Search.searchText(json) }

    /** Distance attached for distance sorts (`_d` on the web). NaN when not set. */
    var distance: Double = Double.NaN

    /** Display title with the glossary's always-expanded rules (logic.md §9.2). */
    val displayTitle: String by lazy { Glossary.expandAlways(com.anchittandon.pnd.logic.Format.titleOf(json)) }

    override fun equals(other: Any?): Boolean = other is Event && other.json == json
    override fun hashCode(): Int = json.hashCode()
    override fun toString(): String = "Event($id)"
}

/** The `meta` block of `/api/events`. */
class FeedMeta(val json: JsonObject) {
    val live: Boolean get() = json.bool("live") == true
    val sources: Map<String, JsonObject> get() = json.obj("sources")?.mapNotNull { (k, v) -> (v as? JsonObject)?.let { k to it } }?.toMap() ?: emptyMap()
    val scan: JsonObject? get() = json.obj("scan")
    val modelRun: JsonObject? get() = json.obj("modelRun")
    val forecastHorizon: JsonObject? get() = json.obj("forecastHorizon")
    val forecastChanges: JsonObject? get() = json.obj("forecastChanges")
    val scanProviders: List<JsonObject> get() = scan.arr("providers").objects()
}

/** A whole `/api/events` body. */
class Feed(val generatedAt: String, val meta: FeedMeta, val events: List<Event>) {
    /** Records whose provider has not gone quiet (`PND.getEvents()` default). */
    val live: List<Event> by lazy { events.filter { it.isLive } }
    val notLive: List<Event> by lazy { events.filter { !it.isLive } }

    companion object {
        fun parse(body: String): Feed {
            val root = PndJson.parseToJsonElement(body).jsonObject
            return from(root)
        }

        fun from(root: JsonObject): Feed {
            val events = (root.el("events") as? JsonArray).objects().map { Event(it) }
            return Feed(root.text("generatedAt"), FeedMeta(root.obj("meta") ?: JsonObject(emptyMap())), events)
        }
    }
}
