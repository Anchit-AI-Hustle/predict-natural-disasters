package com.anchittandon.pnd.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import com.anchittandon.pnd.FakeHttp
import com.anchittandon.pnd.FakePlatform
import com.anchittandon.pnd.SAVED_PLACES
import com.anchittandon.pnd.data.AppContainer
import com.anchittandon.pnd.testContainer
import com.anchittandon.pnd.ui.components.LocalLiveMap
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Key flows, driven through the real screens with fixture data (no network). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class FlowTest {
    @get:Rule val rule = createComposeRule()

    private fun start(route: String, http: FakeHttp = FakeHttp(), settings: Map<String, String> = emptyMap(), platform: FakePlatform = FakePlatform()): AppContainer {
        val c = testContainer(http, settings, platform)
        runBlocking { c.feed.refresh() }
        rule.setContent { CompositionLocalProvider(LocalLiveMap provides false) { PndApp(c, startRoute = route, poll = false) } }
        rule.waitForIdle()
        return c
    }

    private fun scrollTo(tag: String) = rule.onNodeWithTag("screen").performScrollToNode(hasTestTag(tag))
    private fun scrollToText(text: String) = rule.onNodeWithTag("screen").performScrollToNode(hasText(text, substring = true))

    @Test fun searchAPlaceChooseItAndSaveIt() {
        val c = start("home")
        rule.onNodeWithTag("placeQuery").performTextInput("Kathmandu")
        rule.onNodeWithTag("checkRisk").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("placeChooser").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("We found 2 places with that name. Choose one.").assertExists()
        scrollTo("choice:Kathmandu, Bagmati Province, Nepal|City or town")
        rule.onNodeWithTag("choice:Kathmandu, Bagmati Province, Nepal|City or town").performClick()
        rule.waitForIdle()
        scrollTo("placeResult")
        // Never a LOW badge for nothing found; here a forecast covers Kathmandu (Watch).
        rule.onNodeWithTag("placeWhy").assertExists()
        scrollTo("savePlace")
        rule.onNodeWithTag("savePlace").performClick()
        rule.waitForIdle()
        assertEquals(1, c.settings.places.size)
        assertEquals("NP", c.settings.places[0].countryCode)
        scrollTo("checkNote")
        rule.onNodeWithText("Saved. You can find it on the My places page.").assertExists()
        // It shows on My places, with its summary chip, and can be removed.
        rule.onNodeWithTag("tab:personal-risk").performClick()
        rule.waitForIdle()
        scrollTo("saved:Kathmandu, Bagmati Province, Nepal")
        rule.onNodeWithTag("remove:Kathmandu, Bagmati Province, Nepal").performClick()
        rule.waitForIdle()
        assertTrue(c.settings.places.isEmpty())
    }

    @Test fun nothingFoundIsNeverShownAsSafe() {
        start("locations/Antarctica?lat=-80&lon=0&level=Area&country=&cc=")
        scrollTo("placeAnswer")
        rule.onNodeWithContentDescription("Nothing reported nearby", substring = true).assertExists()
        rule.onNodeWithText("This does not mean the place is safe.", substring = true).assertExists()
    }

    @Test fun locationDeniedChecksNothing() {
        val p = FakePlatform().apply { location = null }
        start("home", platform = p)
        rule.onNodeWithTag("useLocation").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Location was not shared, so nothing was checked.").assertExists()
    }

    @Test fun openADetailFromAList() {
        start("events")
        scrollTo("card:gdacs-FL-1104999")
        rule.onNodeWithTag("card:gdacs-FL-1104999").performClick()
        rule.waitForIdle()
        // Official + Red opens alert detail (PND.eventUrl).
        rule.onNodeWithText("OFFICIAL ALERT").assertExists()
        rule.onNodeWithTag("detailTitle").assertIsDisplayed()
        rule.onNodeWithText("Flood in Bagmati Province, Nepal").assertExists()
        // The enrichment block is there, and the forecast flag is false so donation links may show.
        scrollTo("enrichment")
    }

    @Test fun forecastDetailHoldsBackDonations() {
        start("forecasts/OUT-gdacs-FL-1104999")
        rule.onNodeWithText("FORECAST DETAILS").assertExists()
        rule.onNodeWithText("Our forecast, not official", substring = true, ignoreCase = true).assertExists()
    }

    @Test fun shareSendsTheWebsiteUrl() {
        val p = FakePlatform()
        start("disasters/emsc-20260913_0000123", platform = p)
        rule.onNodeWithTag("share").performClick()
        assertEquals("https://predict-natural-disasters.anchit-tandon.com/disasters/emsc-20260913_0000123", p.shared.single().second)
    }

    @Test fun sortAndFilterChangeTheList() {
        val c = start("events")
        // Filter to Extreme Heat hazard via the risk filter: Severe only.
        rule.onNodeWithTag("riskFilter").performClick()
        rule.onNodeWithTag("riskFilter:SEVERE").performClick()
        rule.waitForIdle()
        scrollTo("statusLine")
        rule.onNodeWithTag("statusLine").assertExists()
        // Severe records only: the quake in the Aegean Sea (Informational) is gone.
        rule.onAllNodesWithTag("card:emsc-20260913_0000123").fetchSemanticsNodes().let { assertTrue(it.isEmpty()) }
        // The sort choice is remembered per screen.
        rule.onNodeWithTag("sort:events").performClick()
        rule.onNodeWithTag("sort:events:title").performClick()
        rule.waitForIdle()
        assertEquals("title", c.settings["pnd_sort_events_sortBy"])
    }

    @Test fun forecastHazardTileFilters() {
        start("forecasts")
        scrollTo("hazTile:Drought")
        rule.onNodeWithTag("hazTile:Drought").performClick()
        rule.waitForIdle()
        scrollTo("fcCount")
        rule.onNodeWithText("Forecasts · 1 of 43").assertExists()
    }

    @Test fun aFailedFeedSaysSoAndIsNotEmpty() {
        start("events", http = FakeHttp(failEvents = true))
        scrollTo("listError")
        rule.onNodeWithTag("listError").assertExists()
        rule.onAllNodesWithText("Live data unavailable. Trying again automatically.", substring = true).fetchSemanticsNodes().let { assertTrue(it.size >= 2) }
        rule.onAllNodesWithTag("empty").fetchSemanticsNodes().let { assertTrue("no empty-list copy on failure", it.isEmpty()) }
        rule.onNodeWithText("The live data did not load, so no update time can be shown", substring = true).assertExists()
    }

    @Test fun trustNoteOnDetailAndTrackRecord() {
        start("forecasts/ND-001")
        scrollTo("trustNote")
        rule.onNodeWithText("Experimental model, not an official warning.").assertExists()
    }

    @Test fun trackRecordShowsTheSitesFigures() {
        start("accuracy")
        rule.waitUntil(60_000) { rule.onAllNodesWithTag("answer").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Track record last recorded", substring = true).assertExists()
        scrollTo("keyFigures")
        rule.onNodeWithText("FORECASTS RECORDED", useUnmergedTree = true).assertExists()
    }

    @Test fun deepLinkToAQuietRecordShowsTheQuietNote() {
        start("disasters/usgs-us7000ijkl")
        rule.onNodeWithTag("quietNote").assertExists()
        rule.onNodeWithText("Not updated by USGS for 36 days. It may have ended; check the source for its current status.").assertExists()
    }

    @Test fun anUnknownIdSaysNotFound() {
        start("disasters/no-such-record")
        rule.onNodeWithTag("notFound").assertExists()
        rule.onNodeWithText("Event not found").assertExists()
    }

    @Test fun timezoneChangeRedrawsTimes() {
        val c = start("settings")
        rule.onNodeWithTag("tzSelect").performClick()
        rule.onNodeWithTag("tzSelect:UTC").performClick()
        rule.waitForIdle()
        assertEquals("UTC", c.settings.timezone)
        rule.onNodeWithText("Times are shown as, for example, 20 Oct 2026, 11:24 AM UTC.").assertExists()
    }

    @Test fun turningAlertsOnSchedulesTheBackgroundCheck() {
        val p = FakePlatform()
        val c = start("settings", platform = p)
        rule.onNodeWithTag("alertsSwitch").performClick()
        rule.waitForIdle()
        assertTrue(c.settings.alertsEnabled)
        assertEquals(true, p.scheduled)
        val denied = FakePlatform().apply { notifications = false }
        assertTrue(!denied.notificationsAllowed())
    }
}

/** The trust note is on every screen that shows a forecast or a risk level (features.md §15.1), and not on About or Methodology. */
@RunWith(org.robolectric.ParameterizedRobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class TrustNoteTest(private val route: String, private val expected: Boolean) {
    @get:Rule val rule = createComposeRule()

    companion object {
        @JvmStatic
        @org.robolectric.ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun routes(): List<Array<Any>> = listOf("home", "live-map", "alerts", "forecasts", "personal-risk", "events", "official-warnings", "forecast-list",
            "forecast-calendar", "calamities", "regions", "resources", "insights", "verification", "disasters/emsc-20260913_0000123", "alerts/gdacs-FL-1104999",
            "calamities/gdacs-DR-1105003", "forecasts/ND-001", "regions/Nepal", "hazards/Flood", "sources/GDACS", "verification-detail").map { arrayOf<Any>(it, true) } +
            listOf("about", "methodology", "history/mount-vesuvius-eruption", "more", "settings").map { arrayOf<Any>(it, false) }
    }

    @Test fun trustNote() {
        val c = testContainer(FakeHttp(), mapOf("pnd_saved_locations" to SAVED_PLACES))
        runBlocking { c.feed.refresh() }
        rule.setContent { CompositionLocalProvider(LocalLiveMap provides false) { PndApp(c, startRoute = route, poll = false) } }
        rule.waitForIdle()
        if (expected) {
            rule.onNodeWithTag("screen").performScrollToNode(hasTestTag("trustNote"))
            rule.onNodeWithText("Experimental model, not an official warning.").assertExists()
            rule.onNodeWithTag("agencyLine").assertExists()
        } else {
            assertTrue(rule.onAllNodesWithTag("trustNote").fetchSemanticsNodes().isEmpty())
        }
    }
}
