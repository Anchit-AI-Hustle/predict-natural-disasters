package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.objects
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Every rule in logic.md, checked against test-vectors.json: input and output pairs produced by
 * running the website's own JavaScript with Date.now fixed to meta.now.
 */
class VectorsTest {
    companion object {
        val V: JsonObject by lazy {
            PndJson.parseToJsonElement(VectorsTest::class.java.getResource("/test-vectors.json")!!.readText()).jsonObject
        }
        val NOW: Long by lazy { JsDate.parse(V["meta"]!!.jsonObject["now"]!!.jsonPrimitive.content)!! }
        fun group(k: String): List<JsonObject> = V[k]!!.jsonArray.objects()
        val places: JsonObject get() = V["fixtures.places"]!!.jsonObject
        val events: JsonObject get() = V["fixtures.events"]!!.jsonObject
    }

    @Before fun fix() { AppClock.now = { NOW }; AppClock.zone = "Asia/Kolkata" }
    @After fun reset() { AppClock.zone = "Asia/Kolkata" }

    private fun s(e: JsonElement?): String? = when (e) { null, is JsonNull -> null; is JsonPrimitive -> e.content; else -> e.toString() }
    private fun o(e: JsonElement?): JsonObject? = e as? JsonObject
    private fun inArr(c: JsonObject) = c["in"]!!.jsonArray
    private fun dbl(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()
    private fun tz(c: JsonObject, block: () -> Unit) { AppClock.zone = s(c["tz"]) ?: "Asia/Kolkata"; try { block() } finally { AppClock.zone = "Asia/Kolkata" } }

    @Test fun riskLevelOf() = group("risk.levelOf").forEach { c -> assertEquals(c.toString(), s(c["out"]), RiskScale.levelOf(s(c["in"])).name) }

    @Test fun riskMarkerIcon() = group("risk.markerIcon").forEach { c ->
        val out = c["out"]!!.jsonObject
        val lv = RiskScale.levelOf(s(c["in"]))
        assertEquals(s(out["level"]), lv.name)
        assertEquals(out["iconSize"]!!.jsonArray[0].jsonPrimitive.content.toInt(), lv.markerSize)
        assertEquals(s(out["label"]), RiskScale.markerLabel(s(c["in"]), "Flood in X"))
        val colour = s(out["colour"])
        assertEquals(colour, lv.colour?.let { "#%06X".format(it and 0xFFFFFF) })
    }

    @Test fun riskLabelAndFilter() {
        group("portal.riskLabel").forEach { c -> assertEquals(s(c["out"]), RiskScale.riskLabel(o(c["in"]))) }
        group("portal.matchesRiskLevel").forEach { c -> assertEquals(c.toString(), c["out"]!!.jsonPrimitive.booleanOrNull, RiskScale.matchesRiskLevel(o(inArr(c)[0]), s(inArr(c)[1]))) }
        group("portal.riskTagHtml").forEach { c ->
            val html = s(c["out"])!!
            val title = Regex("title=\"([^\"]*)\"").find(html)!!.groupValues[1]
            val text = Regex("</i>([^<]*)</span>").find(html)!!.groupValues[1]
            assertEquals(title, RiskScale.tagTitle(o(c["in"])))
            assertEquals(text, RiskScale.riskLabel(o(c["in"])))
        }
        val opts = group("portal.riskLevelOptions")[0]["out"]!!.jsonArray.objects().map { s(it["value"])!! to s(it["label"])!! }
        assertEquals(opts, RiskScale.filterOptions)
    }

    @Test fun hazardOfAndHorizon() {
        group("hazards.hazardOf.name").forEach { c -> assertEquals(c.toString(), s(c["out"]), Hazards.hazardOf(s(c["in"])).name) }
        group("hazards.horizonHours").forEach { c -> assertEquals(c.toString(), dbl(c["out"])!!.toInt(), Hazards.horizonHours(s(c["in"]))) }
    }

    @Test fun severityOf() = group("hazards.severityOf").forEach { c ->
        val out = c["out"]!!.jsonObject; val e = c["in"]!!.jsonObject
        assertEquals(c.toString(), s(out["severity"]), Hazards.severityOf(e))
        assertEquals(c.toString(), dbl(out["impactRank"])!!.toInt(), Hazards.impactRank(e))
        assertEquals(c.toString(), dbl(out["alertRank"])!!.toInt(), Hazards.alertRank(e))
    }

    @Test fun cycloneCategory() = group("hazards.cycloneCategory").forEach { c -> assertEquals(c.toString(), s(c["out"]), Hazards.cycloneCategory(jsNumber(c["in"]))) }

    @Test fun keyFacts() {
        group("hazards.keyFacts").forEach { c ->
            val exp = c["out"]!!.jsonArray.objects()
            val got = Hazards.keyFacts(c["in"]!!.jsonObject)
            assertEquals(c.toString(), exp.size, got.size)
            exp.zip(got).forEach { (x, g) ->
                assertEquals(c.toString(), s(x["key"]), g.key); assertEquals(s(x["label"]), g.label)
                assertEquals(c.toString(), x["reported"]!!.jsonPrimitive.booleanOrNull, g.reported)
                assertEquals(c.toString(), s(x["value"]), g.value); assertEquals(c.toString(), s(x["note"]), g.note)
            }
        }
        group("portal.keyFactsLine").forEach { c -> assertEquals(s(c["out"]), Format.keyFactsLine(o(inArr(c)[0]), dbl(inArr(c)[1])!!.toInt())) }
    }

    @Test fun leadTime() = group("hazards.leadTimeText").forEach { c ->
        val out = c["out"]!!.jsonObject
        assertEquals(c.toString(), dbl(out["hours"]), Hazards.leadTimeHours(o(c["in"])))
        assertEquals(c.toString(), s(out["text"]), Hazards.leadTimeText(o(c["in"])))
    }

    @Test fun classifyForecast() = group("hazards.classifyForecast").forEach { c ->
        val a = inArr(c)
        val got = Hazards.classifyForecast(o(a[0]), o(a.getOrNull(1)))
        val out = o(c["out"])
        assertEquals(c.toString(), s(out?.get("forecastClass")), got?.forecastClass)
        assertEquals(c.toString(), s(out?.get("classificationReason")), got?.classificationReason)
    }

    @Test fun distanceAndGeometry() {
        group("hazards.distanceKm").forEach { c ->
            val a = inArr(c).map { jsNumber(it) }
            assertEquals(dbl(c["out"])!!, Hazards.distanceKm(a[0], a[1], a[2], a[3]), 0.001)
        }
        group("hazards.geometryContains").forEach { c ->
            val a = inArr(c)
            assertEquals(c.toString(), (c["out"] as? JsonPrimitive)?.booleanOrNull, Hazards.geometryContains(a[0], jsNumber(a[1]), jsNumber(a[2])))
        }
    }

    @Test fun riskRow() = group("hazards.riskRow").forEach { c ->
        val a = inArr(c)
        val r = Hazards.riskRow(events[s(a[0])]!!.jsonObject, places[s(a[1])]!!.jsonObject)
        val out = o(c["out"])
        if (out == null) { assertNull(c.toString(), r); return@forEach }
        assertEquals(c.toString(), s(out["band"]), r!!.band)
        assertEquals(c.toString(), dbl(out["distanceKm"])!!, Math.round(r.distanceKm!! * 10) / 10.0, 0.05)
        assertEquals(c.toString(), out["claimDistance"]!!.jsonPrimitive.booleanOrNull, r.claimDistance)
        assertEquals(c.toString(), (out["containment"] as? JsonPrimitive)?.booleanOrNull, r.containment)
        assertEquals(c.toString(), s(out["applicability"]), r.applicability)
    }

    @Test fun placeRiskAssess() = group("placeRisk.assess").forEach { c ->
        val a = inArr(c)
        val evs = a[1].jsonArray.map { events[s(it)]!!.jsonObject }
        val got = PlaceRisk.assess(places[s(a[0])]!!.jsonObject, evs, null)
        val out = c["out"]!!.jsonObject
        assertEquals(c.toString(), s(out["level"]), got.level?.name)
        assertEquals(c.toString(), s(out["headline"]), got.headline)
        assertEquals(c.toString(), s(out["why"]), got.why)
        assertEquals(c.toString(), s(out["leadId"]), got.lead?.e?.get("id")?.jsonPrimitive?.content)
        assertEquals(c.toString(), s(out["leadBand"]), got.lead?.r?.band)
        val act = out["actions"]!!.jsonObject
        val ga = PlaceRisk.actionsFor(got)
        assertEquals(c.toString(), act["steps"]!!.jsonArray.map { s(it) }, ga.steps)
        assertEquals(s(act["authority"]), ga.authority)
        assertEquals(act["official"]!!.jsonPrimitive.booleanOrNull, ga.official)
    }

    @Test fun nearLevelTable() = group("placeRisk.nearLevel(table)").forEach { c ->
        val a = inArr(c)
        val e = JsonObject(mapOf("severity" to a[0]))
        assertEquals(c.toString(), s(c["out"]!!.jsonObject["level"]), PlaceRisk.nearLevel(e, jsNumber(a[1])).name)
    }

    private fun alertJson(a: Alert?): Map<String, Any?>? = a?.let { mapOf("key" to it.key, "eventId" to it.eventId, "title" to it.title, "body" to it.body, "url" to it.url, "tag" to it.tag) }
    private fun expAlert(x: JsonObject?): Map<String, Any?>? = x?.let { mapOf("key" to s(it["key"]), "eventId" to s(it["eventId"]), "title" to s(it["title"]), "body" to s(it["body"]), "url" to s(it["url"]), "tag" to s(it["tag"])) }

    @Test fun alertRules() {
        group("alertRules.alertFor").forEach { c ->
            val a = inArr(c)
            var e = events[s(a[0])]!!.jsonObject
            o(a.getOrNull(2))?.let { e = JsonObject(LinkedHashMap(e).apply { putAll(it) }) }
            val got = AlertRules.alertFor(e, places[s(a[1])]!!.jsonObject, NOW)
            assertEquals(c.toString(), expAlert(o(c["out"])), alertJson(got))
            o(c["out"])?.let { assertEquals(dbl(it["rank"])!!, got!!.rank, 1e-9) }
        }
        val all = AlertRules.alertsFor(events.values.map { it.jsonObject }, places.values.map { it.jsonObject }.take(1) + places["phx"]!!.jsonObject, NOW)
        val exp = group("alertRules.alertsFor")[0]["out"]!!.jsonArray.objects().map { expAlert(it) }
        assertEquals(exp, all.map { alertJson(it) })
        group("alertRules.roundCoord").forEach { c -> assertEquals(c.toString(), dbl(c["out"]), AlertRules.roundCoord(c["in"])) }
        group("alertRules.urlFor").forEach { c -> assertEquals(s(c["out"]), AlertRules.urlFor(o(c["in"]))) }
    }

    @Test fun majorEventRule() {
        val base = mapOf("id" to JsonPrimitive("q1"), "type" to JsonPrimitive("Earthquake"), "title" to JsonPrimitive("M 6.8 - Japan"),
            "magnitude" to JsonPrimitive(6.8), "alert" to JsonPrimitive("Red"), "sourceType" to JsonPrimitive("official"),
            "country" to JsonPrimitive("Japan"), "source" to JsonPrimitive("USGS"), "updated" to JsonPrimitive("2026-10-20T10:00:00Z"))
        val a = AlertRules.majorAlert(JsonObject(base), NOW)!!
        assertEquals("Major Earthquake M6.8 (Japan)", a.title)
        assertEquals("M 6.8 - Japan · Red alert · USGS", a.body)
        assertEquals("major-q1|red", a.key); assertEquals("pnd-major-q1", a.tag); assertEquals("/alerts/q1", a.url)
        val red = AlertRules.majorAlert(JsonObject(base + ("magnitude" to JsonPrimitive(5.0)) + ("type" to JsonPrimitive("Flood"))), NOW)!!
        assertEquals("Red Alert: Flood (Japan)", red.title)
        val storm = AlertRules.majorAlert(JsonObject(base + ("type" to JsonPrimitive("Tropical Cyclone")) + ("title" to JsonPrimitive("Hurricane X Category 4")) + ("alert" to JsonPrimitive("Orange"))), NOW)!!
        assertEquals("Severe Storm Alert: Hurricane X Category 4", storm.title)
        assertNull(AlertRules.majorAlert(JsonObject(base + ("updated" to JsonPrimitive("2026-10-10T00:00:00Z"))), NOW))
        assertNull(AlertRules.majorAlert(JsonObject(base + ("forecast" to JsonPrimitive(true))), NOW))
        // 6-hour de-duplication.
        val seen = HashMap<String, Long>()
        assertEquals(1, AlertRules.toNotify(listOf(JsonObject(base)), emptyList(), seen, NOW).size)
        assertEquals(0, AlertRules.toNotify(listOf(JsonObject(base)), emptyList(), seen, NOW + 3_600_000).size)
        assertEquals(1, AlertRules.toNotify(listOf(JsonObject(base)), emptyList(), seen, NOW + 21_600_001).size)
    }

    @Test fun titlesPlacesSources() {
        group("portal.titleOf").forEach { c -> assertEquals(s(c["out"]), Format.titleOf(o(c["in"]))) }
        group("portal.placeOf").forEach { c -> val a = inArr(c); assertEquals(c.toString(), s(c["out"]), Format.placeOf(o(a[0]), s(a.getOrNull(1)) ?: "")) }
        group("portal.shortSource").forEach { c -> assertEquals(c.toString(), s(c["out"]), Format.shortSource(s(c["in"]))) }
        group("portal.provenance").forEach { c -> assertEquals(s(c["out"]), Format.provenance(o(c["in"]))) }
        group("portal.eventUrl").forEach { c -> assertEquals(s(c["out"]), Format.eventUrl(o(c["in"]))) }
    }

    @Test fun datesAndDurations() {
        group("portal.duration").forEach { c -> val a = inArr(c); assertEquals(c.toString(), s(c["out"]), Format.duration(s(a[0]), s(a[1]))) }
        group("portal.fmtDate").forEach { c -> tz(c) { assertEquals(c.toString(), s(c["out"]), Format.fmtDate(s(c["in"]))) } }
        group("portal.fmtTime").forEach { c -> tz(c) { assertEquals(c.toString(), s(c["out"]), Format.fmtTime(s(c["in"]))) } }
        group("portal.fmtWhen").forEach { c -> tz(c) { val a = inArr(c); assertEquals(c.toString(), s(c["out"]), Format.fmtWhen(s(a[0]), s(a.getOrNull(1)), s(a.getOrNull(2)))) } }
        group("portal.windowText").forEach { c -> tz(c) { assertEquals(c.toString(), s(c["out"]), Format.windowText(o(c["in"]))) } }
        group("portal.horizonText").forEach { c -> tz(c) { assertEquals(c.toString(), s(c["out"]), Format.horizonText(o(c["in"]))) } }
        group("portal.age").forEach { c -> assertEquals(c.toString(), s(c["out"]), Format.age(s(c["in"]))) }
    }

    @Test fun statusCountsSummaries() {
        group("portal.countryCount").forEach { c -> assertEquals(dbl(c["out"])!!.toInt(), Format.countryCount(inArr(c)[0].jsonArray.map { it.jsonObject })) }
        group("portal.impactText").forEach { c -> assertEquals(s(c["out"]), Format.impactText(o(c["in"]))) }
        group("portal.summary").forEach { c -> val a = inArr(c); assertEquals(c.toString(), s(c["out"]), Format.summary(s(a[0]), dbl(a.getOrNull(1))?.toInt() ?: 160)) }
        group("portal.quietNote").forEach { c -> assertEquals(s(c["out"]), Format.quietNote(o(c["in"]))) }
        group("portal.statusText").forEach { c -> assertEquals(s(c["out"]), Format.statusText(o(c["in"]))) }
        group("portal.sourcesRatio").forEach { c -> assertEquals(s(c["out"]), Format.sourcesRatio(o(c["in"]))) }
        group("portal.findEvent").forEach { c ->
            val a = inArr(c)
            assertEquals(c.toString(), s(c["out"]), Format.findEvent(a[0].jsonArray.map { it.jsonObject }, s(a[1])) { it }?.get("id")?.jsonPrimitive?.content)
        }
        group("portal.hazardOptions").forEach { c ->
            val a = inArr(c)
            val sel = s(a[1])
            val html = Format.hazardOptions(a[0].jsonArray.map { it.jsonObject }, sel).joinToString("") { (v, l) ->
                "<option value=\"$v\"" + (if (!sel.isNullOrEmpty() && v == sel) " selected" else "") + ">$l</option>"
            }
            assertEquals(s(c["out"]), html)
        }
    }

    @Test fun sorting() {
        val labels = V["portal.SORT_DEFS.labels"]!!.jsonObject
        labels.forEach { (k, v) -> assertEquals(k, s(v), Sorts.label(k)) }
        assertEquals(V["portal.EVENT_SORTS"]!!.jsonArray.map { s(it) }, Sorts.EVENT_SORTS)
        val fx = V["sort.fixture"]!!.jsonArray.map { it.jsonObject }
        V["sort.results"]!!.jsonObject.forEach { (k, v) ->
            assertEquals(k, v.jsonArray.map { s(it) }, Sorts.sort(fx, k) { it }.map { s(it["id"]) })
        }
        group("sort.rankOf").forEach { c ->
            val id = s(c["id"])!!
            val e = fx.firstOrNull { s(it["id"]) == id } ?: when (id) {
                "alertOnly-High" -> JsonObject(mapOf("alert" to JsonPrimitive("High")))
                "alertOnly-Severe" -> JsonObject(mapOf("alert" to JsonPrimitive("Severe")))
                else -> JsonObject(mapOf("severityRank" to JsonPrimitive(0), "alert" to JsonPrimitive("Orange")))
            }
            assertEquals(id, dbl(c["rank"])!!.toInt(), Sorts.rankOf(e))
        }
        group("sort.timeOf").forEach { c -> assertEquals(dbl(c["t"])!!.toLong(), Sorts.timeOf(fx.first { s(it["id"]) == s(c["id"]) })) }
    }

    @Test fun searchAndGlossary() {
        group("search.matches").forEach { c -> val a = inArr(c); assertEquals(c.toString(), c["out"]!!.jsonPrimitive.booleanOrNull, Search.matches(o(a[0]), s(a[1]))) }
        group("search.matchesPlace").forEach { c -> val a = inArr(c); assertEquals(c.toString(), c["out"]!!.jsonPrimitive.booleanOrNull, Search.matchesPlace(o(a[0]), s(a[1]))) }
        group("search.emptyHtml").forEach { c ->
            val a = inArr(c)
            val st = Search.emptyState(s(a[0]), a[1].jsonArray.map { it.jsonObject }, a[2].jsonArray.map { it.jsonObject }, s(a[3])!!)
            assertEquals(s(c["out"]), st.toHtml())
        }
        group("glossary.expandAlways").forEach { c -> assertEquals(s(c["out"]), Glossary.expandAlways(s(c["in"])!!)) }
    }

    @Test fun placeSearch() {
        group("placeSearch.levelOf").forEach { c -> assertEquals(c.toString(), s(c["out"]), PlaceSearch.levelOf(o(c["in"]))) }
        group("placeSearch.labelOf").forEach { c -> assertEquals(s(c["out"]), PlaceSearch.labelOf(o(c["in"]))) }
        group("placeSearch.candidates").forEach { c ->
            val got = PlaceSearch.candidates(inArr(c)[0].jsonArray.map { it.jsonObject })
            val exp = c["out"]!!.jsonArray.objects()
            assertEquals(exp.size, got.size)
            exp.zip(got).forEach { (x, g) ->
                assertEquals(s(x["name"]), g.name); assertEquals(s(x["full"]), g.full); assertEquals(s(x["level"]), g.level)
                assertEquals(dbl(x["lat"])!!, g.lat, 1e-9); assertEquals(dbl(x["lon"])!!, g.lon, 1e-9)
                assertEquals(s(x["country"]), g.country); assertEquals(s(x["countryCode"]), g.countryCode); assertEquals("Searched", g.kind)
            }
        }
    }

    @Test fun verdicts() {
        group("verdicts.normalise").forEach { c -> assertEquals(c.toString(), s(c["out"]), Verdicts.normalise(s(c["in"]))) }
        group("verdicts.stateOf").forEach { c -> assertEquals(c.toString(), s(c["out"]), Verdicts.stateOf(o(c["in"]), NOW)) }
        group("verdicts.engineState").forEach { c -> assertEquals(c.toString(), s(c["out"]), Verdicts.engineState(o(c["in"]))) }
        group("verdicts.rate").forEach { c ->
            val a = inArr(c); val r = Verdicts.rate(dbl(a[0])!!.toInt(), dbl(a[1])!!.toInt())
            val out = c["out"]!!.jsonObject
            assertEquals(s(out["text"]), r.text); assertEquals(dbl(out["pct"])?.toInt(), r.pct)
        }
        group("verdicts.tally").forEach { c ->
            val t = Verdicts.tally(inArr(c)[0].jsonArray.map { it.jsonObject }, NOW)
            val out = c["out"]!!.jsonObject
            val got = mapOf("total" to t.total, "open" to t.open, "awaiting" to t.awaiting, "verified" to t.verified, "partial" to t.partial,
                "falseAlarm" to t.falseAlarm, "missed" to t.missed, "coverageFailure" to t.coverageFailure, "ungradeable" to t.ungradeable,
                "notPrediction" to t.notPrediction, "unknown" to t.unknown, "matured" to t.matured, "graded" to t.graded)
            got.forEach { (k, v) -> assertEquals(k, dbl(out[k])!!.toInt(), v) }
            assertEquals(s(out["precision"]!!.jsonObject["text"]), t.precision.text)
            assertEquals(s(out["recall"]!!.jsonObject["text"]), t.recall.text)
        }
        group("verdicts.joinVerdicts").forEach { c ->
            val a = inArr(c)
            val j = Verdicts.joinVerdicts(a[0].jsonArray.map { it.jsonObject }, a[1].jsonArray.map { it.jsonObject })
            val out = c["out"]!!.jsonObject
            out["records"]!!.jsonArray.objects().zip(j.records).forEach { (x, g) ->
                x.forEach { (k, v) -> assertEquals("$k in $g", s(v), s(g[k])) }
            }
            assertEquals(out["unattached"]!!.jsonArray.map { s(it) }, j.unattached.map { s(it["id"]) })
        }
    }

    @Test fun everyVectorGroupIsCovered() {
        val covered = setOf("meta", "risk.levelOf", "risk.markerIcon", "portal.riskLabel", "portal.matchesRiskLevel", "portal.riskTagHtml",
            "portal.riskLevelOptions", "hazards.hazardOf.name", "hazards.horizonHours", "hazards.severityOf", "hazards.cycloneCategory",
            "hazards.keyFacts", "portal.keyFactsLine", "hazards.leadTimeText", "hazards.classifyForecast", "hazards.distanceKm",
            "hazards.geometryContains", "hazards.riskRow", "fixtures.places", "fixtures.events", "placeRisk.assess", "placeRisk.nearLevel(table)",
            "alertRules.alertFor", "alertRules.alertsFor", "alertRules.roundCoord", "alertRules.urlFor", "portal.titleOf", "portal.placeOf",
            "portal.shortSource", "portal.provenance", "portal.eventUrl", "portal.duration", "portal.fmtDate", "portal.fmtTime", "portal.fmtWhen",
            "portal.windowText", "portal.horizonText", "portal.age", "portal.countryCount", "portal.impactText", "portal.summary", "portal.quietNote",
            "portal.statusText", "portal.sourcesRatio", "portal.findEvent", "portal.hazardOptions", "portal.SORT_DEFS.labels", "portal.EVENT_SORTS",
            "sort.fixture", "sort.results", "sort.rankOf", "sort.timeOf", "search.matches", "search.matchesPlace", "search.emptyHtml",
            "glossary.expandAlways", "placeSearch.levelOf", "placeSearch.labelOf", "placeSearch.candidates", "verdicts.normalise", "verdicts.stateOf",
            "verdicts.engineState", "verdicts.rate", "verdicts.tally", "verdicts.joinVerdicts", "verification.score", "verification.predictingSince")
        assertTrue("uncovered: " + (V.keys - covered), (V.keys - covered).isEmpty())
    }

    @Suppress("unused") private fun arr(e: JsonElement?) = e as? JsonArray
}
