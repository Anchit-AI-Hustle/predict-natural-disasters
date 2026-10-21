package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.objects
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Track record runs the website's own grading scripts in Rhino. These tests run the same
 * bundled files on the JVM and check them against the site's vectors and against Node's output.
 */
class GradingEngineTest {
    private val assets = File("src/main/assets/js")
    private val engine = GradingEngine { name -> File(assets, name).readText() }
    private fun res(n: String) = GradingEngineTest::class.java.getResource("/$n")!!.readText()

    @Test fun scoreMatchesVectors() {
        VectorsTest.group("verification.score").forEach { c ->
            val got = PndJson.parseToJsonElement(engine.call("PNDVerification", "score", c["in"].toString())).jsonObject
            val out = c["out"]!!.jsonObject
            for (k in listOf("hit", "partial", "miss", "pending", "invalid", "hitsOutsideCoverage", "ungradeable", "eligibleMaturedPredictions",
                    "significantObservedEvents", "falseNegatives")) {
                assertEquals(k, out[k].toString(), got[k].toString())
            }
            for (k in listOf("precision", "recall", "f1")) {
                val e = (out[k] as? JsonPrimitive)?.content?.toDoubleOrNull(); val g = (got[k] as? JsonPrimitive)?.content?.toDoubleOrNull()
                if (e == null) assertNull(k, g) else assertEquals(k, e, g!!, 1e-6)
            }
        }
    }

    @Test fun predictingSinceMatchesVectors() = VectorsTest.group("verification.predictingSince").forEach { c ->
        val got = engine.call("PNDVerification", "predictingSince", c["in"].toString())
        assertEquals(c["out"].toString(), got)
    }

    @Test fun gradingMatchesNodeOnRealLedgers() {
        val fx = PndJson.parseToJsonElement(res("ledgers-fixture.json")).jsonObject
        val golden = PndJson.parseToJsonElement(res("ledgers-golden.json")).jsonObject
        val now = golden["now"]!!.jsonPrimitive.content.toLong()
        val l = Ledgers(fx["outlook"] as JsonArray, fx["verification"] as JsonObject, fx["observed"] as JsonObject, fx["scan"] as JsonObject)
        val g = engine.grade(TrackRecord.driverInput(l, now))
        for (k in listOf("sH", "sR", "sC")) assertEquals(k, norm(golden[k]), norm(g[k]))
        for (k in listOf("invalid", "headlineCount", "condCount", "since", "recallCount")) assertEquals(k, golden[k].toString(), g[k].toString())
        val verdicts = g["verdicts"]!!.jsonArray.objects()
        assertEquals(golden["classifications"]!!.jsonArray.map { it.toString() }, verdicts.map { (it["classification"] ?: JsonNull).toString() })
        assertEquals(golden["reasons"]!!.jsonArray.map { it.toString() }, verdicts.map { (it["ungradeableReason"] ?: JsonNull).toString() })
        assertEquals(golden["observed"].toString(), JsonArray(verdicts.map { it["observedEventIds"]!! }).toString())
        assertEquals(norm(golden["assess"]), norm(g["assessments"]))

        // And the screen built from it says what the page would, and never invents a rate.
        val screen = TrackRecord.build(l, g, now)
        assertNull(screen.error)
        assertTrue(screen.gradingAvailable)
        assertEquals("Forecasts recorded", screen.keyFigures[0].first)
        assertEquals((fx["outlook"] as JsonArray).size.toString(), screen.keyFigures[0].second)
        assertTrue(screen.answerLead.isNotEmpty())
        assertTrue(screen.records.size >= (fx["outlook"] as JsonArray).size)
    }

    @Test fun aLedgerThatFailsGradesNothing() {
        val fx = PndJson.parseToJsonElement(res("ledgers-fixture.json")).jsonObject
        val l = Ledgers(fx["outlook"] as JsonArray, fx["verification"] as JsonObject, null, fx["scan"] as JsonObject)
        val s = TrackRecord.build(l, null, JsDate.parse("2026-10-20T12:00:00Z")!!)
        assertNotNull(s.error)
        assertTrue(s.error!!.startsWith("Some track record data could not be loaded: our record of disasters."))
        assertTrue(s.keyFigures.drop(1).all { it.second == "Unavailable" })
        assertTrue(s.advance.all { it.second == "Unavailable" })
        assertTrue(s.records.all { it.occurred == "Unavailable" })
    }

    /** Numbers compared as numbers, so 0.5 and 0.50 agree. */
    private fun norm(e: JsonElement?): String = when (e) {
        null, is JsonNull -> "null"
        is JsonPrimitive -> if (e.isString) e.toString() else e.content.toDoubleOrNull()?.let { if (it == Math.rint(it)) it.toLong().toString() else "%.9f".format(it) } ?: e.content
        is JsonArray -> e.joinToString(",", "[", "]") { norm(it) }
        is JsonObject -> e.entries.sortedBy { it.key }.joinToString(",", "{", "}") { it.key + ":" + norm(it.value) }
    }
}
