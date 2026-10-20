package com.anchittandon.pnd.logic

import com.anchittandon.pnd.FakeHttp
import com.anchittandon.pnd.Fixtures
import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.data.DataRepository
import com.anchittandon.pnd.model.Feed
import com.anchittandon.pnd.model.jsonObjectOf
import com.anchittandon.pnd.model.str
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Changelog rows whose behaviour has no vector group in test-vectors.json ("none (UI)" in features.md):
 * the rules behind them are checked here, and the screens in ui/ParityFlowTest.
 */
class ParityLogicTest {
    @Test fun c12MapSearchIgnoresAnEmptyBoxAndSaysWhenNothingMatches() {
        val evs = listOf(jsonObjectOf("id" to "a", "title" to "Flood in Nepal", "country" to "Nepal"), jsonObjectOf("id" to "b", "title" to "M 6.1 - Japan", "country" to "Japan"))
        assertNull(MapSearch.search(evs, "   "))
        assertEquals(MapSearch.Found(1), MapSearch.search(evs, "  JAPAN "))
        assertEquals(MapSearch.Found(1), MapSearch.search(evs, "magnitude"))
        assertEquals(MapSearch.NoMatch("No live event matches “Atlantis”"), MapSearch.search(evs, " Atlantis "))
        assertEquals("Try a country, a city or a type of hazard.", MapSearch.NO_MATCH_META)
    }

    @Test fun c18LiveMapSearchNote() {
        assertNull(MapSearch.liveMapNote("  ", 3))
        assertEquals("1 event match “nepal”. The map shows it.", MapSearch.liveMapNote(" nepal ", 1))
        assertEquals("4 events match “flood”. The map shows them.", MapSearch.liveMapNote("flood", 4))
        assertEquals("No event matches “mars”.", MapSearch.liveMapNote("mars", 0))
    }

    @Test fun c23OnlyTheReadersOwnEditClearsTheCountry() {
        val chosen = PlaceForm.chosenAs("Kathmandu", "27.717200", "85.324000")
        // The change event Enter fires after the search filled the boxes: same values, the country stays.
        assertFalse(PlaceForm.clearsCountry(true, chosen, "Kathmandu", "27.717200", "85.324000"))
        // An edit by the reader clears it.
        assertTrue(PlaceForm.clearsCountry(true, chosen, "Kathmandu city", "27.717200", "85.324000"))
        assertTrue(PlaceForm.clearsCountry(true, chosen, "Kathmandu", "27.7", "85.324000"))
        // Nothing to clear, or nothing chosen by a search.
        assertFalse(PlaceForm.clearsCountry(false, chosen, "x", "1", "2"))
        assertTrue(PlaceForm.clearsCountry(true, "", "Kathmandu", "27.717200", "85.324000"))
    }

    @Test fun c24MarkersKeepTheirSizeInsideA24dpTapArea() {
        Level.entries.forEach { lv ->
            assertEquals(lv.name, maxOf(24, 9 + lv.rank * 3), lv.tapSize)
            assertTrue(lv.name, lv.tapSize >= 24 && lv.tapSize >= lv.markerSize)
        }
        assertEquals(9, Level.UNKNOWN.markerSize); assertEquals(24, Level.UNKNOWN.tapSize)
        assertEquals(27, Level.EXTREME.markerSize); assertEquals(27, Level.EXTREME.tapSize)
    }

    @Test fun c25StaticDataRevalidatesWithoutTs() = runBlocking {
        AppClock.now = { Fixtures.NOW }
        val http = FakeHttp()
        DataRepository(http).json("verification-ledger.json")
        assertEquals(Api.BASE + "/data/verification-ledger.json", http.requests.single())
        assertEquals("no-cache", http.headers.single()["Cache-Control"])
        // The dead ReliefWeb candidate is gone from the scan providers.
        val providers = Feed.parse(Fixtures.events).meta.scanProviders
        assertEquals("https://reliefweb.int/disasters/rss.xml", providers.first { it.str("provider") == "reliefweb" }.str("endpoint"))
    }

    @Test fun c19UnavailableCopy() {
        assertEquals("Live data unavailable.", Portal.UNAVAILABLE_TITLE)
        assertEquals("We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.", Portal.UNAVAILABLE_BODY)
        assertEquals("Unavailable", Portal.UNAVAILABLE)
    }

    @Test fun c17ScopeNote() {
        assertNull(Collections.scopeNote(""))
        assertNull(Collections.scopeNote(" world "))
        assertEquals("Showing only Asia.", Collections.scopeNote("Asia"))
    }

    @Test fun c21HazardNotes() {
        assertEquals("We also have 2 open forecasts of extreme heat here. They are our own estimates, not events.", HazardPage.forecastNote(2, "Extreme Heat", true))
        assertEquals("We also have 1 open forecast of volcano. They are our own estimates, not events.", HazardPage.forecastNote(1, "Volcano", false))
        assertEquals("Our sources have no current report of this hazard here. This does not mean there is no danger.", HazardPage.emptyBody(true))
        assertEquals(HazardPage.Fill(HazardPage.fillHazards("Ice", emptyList()).options, "Ice"), HazardPage.fillHazards("Ice", emptyList()))
        assertTrue("Ice" in HazardPage.fillHazards("Ice", emptyList()).options)
    }

    @Test fun c1RegionCoverageLine() {
        assertEquals("Sources working now: 7/8. Current events here: 5. Asia is counted from the countries each report names. 2 reports are at sea or name no country, so they are on no continent's page.",
            RegionMatch.coverage("7/8", 5, "Asia", 2))
        assertEquals("Sources working now: 7/8. Current events here: 1. Europe is counted from the countries each report names. 1 report is at sea or name no country, so it is on no continent's page.",
            RegionMatch.coverage("7/8", 1, "Europe", 1))
        assertEquals("Sources working now: 7/8. Current events here: 3.", RegionMatch.coverage("7/8", 3, "", 0))
    }
}
