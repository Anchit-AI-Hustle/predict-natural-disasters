package com.anchittandon.pnd.data

import com.anchittandon.pnd.FakeHttp
import com.anchittandon.pnd.Fixtures
import com.anchittandon.pnd.logic.AlertRules
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.model.Feed
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.DeepLinks
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class DecodingTest {
    @Test fun decodesTheRealFeedTolerantly() {
        val f = Feed.parse(Fixtures.events)
        assertEquals("2026-10-20T11:24:19.566Z", f.generatedAt)
        assertEquals(63, f.events.size)
        assertEquals(62, f.live.size) // the quiet USGS quake is live:false
        assertEquals(1, f.notLive.size)
        assertTrue(f.meta.live)
        assertEquals(8, f.meta.sources.size)
        assertTrue(f.meta.scanProviders.isNotEmpty())
        // Unknown fields survive (api.md §8: keep them).
        val nd = f.events.first { it.id == "ND-001" }
        assertTrue(nd.json.containsKey("verificationRule"))
        assertTrue(nd.windowClosed)
        // Every record has the fields the app relies on, or reads them as absent.
        f.events.forEach { e -> assertTrue(e.id.isNotEmpty()); assertNotNull(e.lat); assertNotNull(e.lon) }
        // Absent is never zero.
        val noDeaths = f.events.first { it.json["deaths"] == null }
        assertEquals("Not reported", Format.figure(noDeaths.json, "deaths"))
    }

    @Test fun malformedFieldsDoNotBreakDecoding() {
        val f = Feed.parse("""{"generatedAt":"x","meta":{"live":true,"sources":"oops"},"events":[{"id":"a","lat":"12.5","lon":null,"deaths":"","extra":{"x":1}},5,null]}""")
        assertEquals(1, f.events.size)
        assertEquals(12.5, f.events[0].lat!!, 0.0)
        assertNull(f.events[0].lon)
        assertEquals("Not reported", Format.figure(f.events[0].json, "deaths"))
        assertTrue(f.meta.sources.isEmpty())
    }

    @Test fun decodesTheEnrichmentSample() {
        val d = Fixtures.enrichment["response"]!!.jsonObject
        assertTrue(d.arr("news").objects().isNotEmpty() || d.arr("news") != null)
        assertNotNull(d.obj("where"))
        assertNotNull(d.obj("helplines"))
        assertTrue(d.str("donationPolicy")!!.isNotEmpty())
    }

    @Test fun enrichmentUrlMatchesTheWebsiteRequestExactly() {
        val e = Feed.parse(Fixtures.events).events.first { it.id == "gdacs-FL-1104999" }.json
        val url = com.anchittandon.pnd.ui.screens.enrichmentUrl(e)
        assertEquals(Api.BASE + Fixtures.enrichment["request"]!!.toString().trim('"'), url)
    }
}

class RepositoryTest {
    @Test fun aFailedLoadIsNotAnEmptyWorldAndTheSavedCopyIsLabelled() = runBlocking {
        AppClock.now = { Fixtures.NOW }
        val dir = Files.createTempDirectory("pnd").toFile()
        val http = FakeHttp()
        val repo = FeedRepository(http, dir, CoroutineScope(Dispatchers.Unconfined))
        repo.refresh()
        assertFalse(repo.state.value.failed)
        assertEquals(62, repo.state.value.events.size)
        // A second start with the network down shows the disk copy, labelled as saved, never as empty.
        http.failEvents = true
        val cold = FeedRepository(http, dir, CoroutineScope(Dispatchers.Unconfined))
        assertTrue(cold.state.value.savedCopy)
        cold.refresh()
        assertTrue(cold.state.value.failed)
        assertTrue(cold.state.value.savedCopy)
        assertEquals("2026-10-20T11:24:19.566Z", cold.state.value.feed!!.generatedAt)
        // And with no copy at all: failed, and no feed (so screens say so instead of listing nothing).
        val none = FeedRepository(http, null, CoroutineScope(Dispatchers.Unconfined))
        none.refresh()
        assertTrue(none.state.value.failed)
        assertNull(none.state.value.feed)
    }

    @Test fun refreshNowBypassesTheEdgeCopyAndTimersDoNot() = runBlocking {
        AppClock.now = { Fixtures.NOW }
        val http = FakeHttp()
        val repo = FeedRepository(http, null, CoroutineScope(Dispatchers.Unconfined))
        repo.refresh(fresh = false); repo.refresh(fresh = true)
        assertEquals(Api.BASE + "/api/events", http.requests[0])
        assertEquals(Api.BASE + "/api/events?ts=${Fixtures.NOW}", http.requests[1])
    }

    @Test fun userAgentNamesTheAppAndNothingPersonal() {
        assertTrue(Api.USER_AGENT.startsWith("PredictNaturalDisasters-Android/1.0.0 (+https://predict-natural-disasters.anchit-tandon.com/about)"))
        assertFalse(Api.USER_AGENT.contains("@"))
    }

    @Test fun placeSearchUsesFixturesAndTheSitesParameters() = runBlocking {
        val http = FakeHttp()
        val r = PlaceSearchRepository(http).search("Kathmandu") as PlaceSearchRepository.Result.Ok
        assertEquals(2, r.places.size)
        assertEquals("City or town", r.places[0].level)
        assertEquals("NP", r.places[0].countryCode)
        assertEquals("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=8&q=Kathmandu", http.requests.single())
    }

    @Test fun settingsKeepPlacesAndCurrentLocationRules() {
        val s = SettingsStore(MemoryBackend())
        s.addPlace(com.anchittandon.pnd.logic.Place(kind = "Home", name = "A", lat = 1.0, lon = 2.0), 100)
        s.setCurrentLocation(27.71234, 85.31987, "Nepal", "", "2026-10-20T12:00:00.000Z")
        s.setCurrentLocation(27.71634, 85.32987, "Nepal", "", "2026-10-20T12:00:00.000Z")
        val p = s.places
        assertEquals(2, p.size)
        assertEquals("loc-current", p[0].id)
        assertEquals(27.72, p[0].lat, 0.0); assertEquals(85.33, p[0].lon, 0.0)
        assertEquals("loc-100", p[1].id)
        assertEquals(1, s.removePlace("loc-100").size)
        // No zone chosen: the device's, else Asia/Kolkata (changelog C9).
        val device = AppClock.deviceZone
        try {
            AppClock.deviceZone = { "Europe/London" }; assertEquals("Europe/London", s.timezone)
            AppClock.deviceZone = { null }; assertEquals("Asia/Kolkata", s.timezone)
            AppClock.deviceZone = { throw SecurityException("no zone") }; assertEquals("Asia/Kolkata", s.timezone)
            s.setTimezone("UTC"); assertEquals("UTC", s.timezone)
        } finally { AppClock.deviceZone = device }
        assertEquals("newest", s.sort("x", listOf("newest", "severity")))
        s.setSort("x", "severity"); assertEquals("severity", s.sort("x", listOf("newest", "severity")))
        // Background payload: kind plus coordinates rounded to 2 decimals, at most 10.
        assertEquals(Triple("Current location", 27.72, 85.33), AlertRules.cleanPlaces(s.places)[0])
    }

    @Test fun notificationMemoryRoundTrips() {
        val s = SettingsStore(MemoryBackend())
        val m = s.notified(); m["a|A|red"] = 5L; s.saveNotified(m, 10L)
        assertEquals(5L, s.notified()["a|A|red"])
        assertEquals(PndJson.parseToJsonElement("{\"a|A|red\":5}"), PndJson.parseToJsonElement(s["pnd_notified"]!!))
    }
}

class DeepLinkTest {
    @Test fun websitePathsOpenTheMatchingScreen() {
        val b = Api.BASE
        assertEquals("disasters/gdacs-FL-1104999", DeepLinks.route("$b/disasters/gdacs-FL-1104999"))
        assertEquals("alerts/usgs-2", DeepLinks.route("$b/alerts/usgs-2"))
        assertEquals("calamities/x", DeepLinks.route("$b/calamities/x"))
        assertEquals("forecasts/ND-001", DeepLinks.route("$b/forecasts/ND-001"))
        assertEquals("regions/North%20America", DeepLinks.route("$b/regions/North%20America"))
        assertEquals("locations/Pune?lat=18.5&lon=73.8&level=City%20or%20town", DeepLinks.route("$b/locations/Pune?lat=18.5&lon=73.8&level=City+or+town"))
        assertEquals("hazards/Flood?region=Nepal", DeepLinks.route("$b/hazards/Flood?region=Nepal"))
        assertEquals("history/thera-santorini-eruption", DeepLinks.route("$b/history/thera-santorini-eruption"))
        assertEquals("sources/GDACS", DeepLinks.route("$b/sources/GDACS"))
        // Query forms (PND.canonicalDetailUrl) and pages.
        assertEquals("disasters/a%20b", DeepLinks.route("$b/event-detail?id=a%20b"))
        assertEquals("regions/World", DeepLinks.route("$b/region-detail"))
        assertEquals("events?q=nepal", DeepLinks.route("/events?q=nepal"))
        assertEquals("events?q=nepal", DeepLinks.route("/events?search=nepal"))
        assertEquals("home", DeepLinks.route("/"))
        assertEquals("live-map", DeepLinks.route("/live-map"))
        assertNull(DeepLinks.route("https://example.com/disasters/x"))
        assertEquals(b + "/forecasts/ND-001", DeepLinks.webUrl("/forecasts/ND-001"))
    }
}
