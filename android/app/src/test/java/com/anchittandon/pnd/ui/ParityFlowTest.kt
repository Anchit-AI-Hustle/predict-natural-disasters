package com.anchittandon.pnd.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import com.anchittandon.pnd.FakeHttp
import com.anchittandon.pnd.FakePlatform
import com.anchittandon.pnd.Fixtures
import com.anchittandon.pnd.data.AppContainer
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Collections
import com.anchittandon.pnd.logic.HomeModel
import com.anchittandon.pnd.logic.Portal
import com.anchittandon.pnd.model.Feed
import com.anchittandon.pnd.model.PndJson
import com.anchittandon.pnd.testContainer
import com.anchittandon.pnd.ui.components.LocalLiveMap
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The screens behind each row of the features.md changelog (C1 to C25) and the two Android-only
 * fixes, driven with fixture data. The rules themselves are checked against the vectors in
 * logic/VectorsTest and logic/ParityLogicTest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class ParityFlowTest {
    @get:Rule val rule = createComposeRule()

    private fun start(route: String, http: FakeHttp = FakeHttp(), settings: Map<String, String> = emptyMap(), platform: FakePlatform = FakePlatform(), before: (() -> Unit)? = null, load: Boolean = true): AppContainer {
        val c = testContainer(http, settings, platform)
        before?.invoke()
        if (load) runBlocking { c.feed.refresh() }
        rule.setContent { CompositionLocalProvider(LocalLiveMap provides false) { PndApp(c, startRoute = route, poll = false) } }
        rule.waitForIdle()
        return c
    }

    private fun scrollTo(tag: String) = rule.onNodeWithTag("screen").performScrollToNode(hasTestTag(tag))
    private fun scrollToText(text: String) = rule.onNodeWithTag("screen").performScrollToNode(hasText(text, substring = true))
    private fun none(tagPrefix: String) = rule.onAllNodes(SemanticsMatcher("tag starts $tagPrefix") { it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith(tagPrefix) == true }, useUnmergedTree = true)
    private val feed by lazy { Feed.parse(Fixtures.events) }

    /* ---------------------------------------------------------------- Android-only fixes */

    @Test fun tabRootsHaveNoBackArrow() {
        start("alerts")
        assertTrue(rule.onAllNodesWithContentDescriptionBack().isEmpty())
        rule.onNodeWithTag("tab:forecasts").performClick(); rule.waitForIdle()
        assertTrue(rule.onAllNodesWithContentDescriptionBack().isEmpty())
        rule.onNodeWithTag("tab:accuracy").performClick(); rule.waitForIdle()
        assertTrue(rule.onAllNodesWithContentDescriptionBack().isEmpty())
    }

    @Test fun aSecondaryScreenStillHasItsBackArrow() {
        start("events")
        rule.onNodeWithContentDescription("Back").assertExists()
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithContentDescriptionBack() =
        onAllNodes(SemanticsMatcher("Back") { it.config.getOrNull(SemanticsProperties.ContentDescription)?.contains("Back") == true }).fetchSemanticsNodes()

    @Test fun trustIconIsNotClippedAt200Percent() {
        RuntimeEnvironment.setFontScale(2f)
        try {
            start("forecasts/ND-001")
            scrollTo("trustNote")
            val b = rule.onNodeWithTag("trustIcon", useUnmergedTree = true).getUnclippedBoundsInRoot()
            // 18 dp at 1x, 36 dp at 2x: the 12 sp "i" (24 dp at 2x) fits inside.
            assertTrue("icon ${b.height}", b.height >= 35.dp && b.width >= 35.dp)
        } finally { RuntimeEnvironment.setFontScale(1f) }
    }

    /* --------------------------------------------------------------------------- C1 */

    @Test fun c1ContinentPagesListTheirReports() {
        start("regions/asia")
        rule.onNodeWithTag("detailTitle").assertTextContains("Disasters in Asia")
        assertTrue(rule.onAllNodesWithText("No current events here.").fetchSemanticsNodes().isEmpty())
        scrollTo("card:gdacs-FL-1104999")
        scrollToText("Asia is counted from the countries each report names.")
    }

    /* ------------------------------------------------------------------ C2, C3, C7, C13 */

    @Test fun homeTilesTablesAndStripFollowTheSite() {
        val r = HomeModel.render(feed.events.map { it.json }, "", "newest")
        start("home")
        scrollTo("kpi:Official warnings")
        rule.onNodeWithTag("kpi:Official warnings").assertTextContains(r.kWarnings)
        rule.onNodeWithTag("kpiNote:Official warnings", useUnmergedTree = true).assertTextContains("Issued by agencies, in force now")
        scrollTo("sort:home")
        // Reports only: no forecast is listed among live events.
        val live = none("live:").fetchSemanticsNodes().map { it.config[SemanticsProperties.TestTag].removePrefix("live:") }
        assertEquals(r.liveEvents.map { it["id"].toString().trim('"') }, live)
        assertTrue(live.none { id -> feed.events.first { it.id == id }.forecast })
        scrollTo("hazChip:Earthquake")
        rule.onNodeWithTag("hazChip:Earthquake").assertTextContains("reported · observed only", substring = true)
        rule.onNodeWithText("No official warning is in force in our sources right now.").assertDoesNotExist()
    }

    @Test fun officialWarningsListMatchesTheHomeTile() {
        start("official-warnings")
        val n = Portal.officialWarnings(feed.events) { it.json }.size
        scrollTo("statusLine")
        rule.onNodeWithTag("statusLine").assertTextContains("$n official warning", substring = true)
        rule.onNodeWithText("Warnings and watches that official agencies have issued and that are in force now.", substring = true).assertExists()
        // A USGS earthquake that already happened is not a warning in force.
        assertTrue(rule.onAllNodesWithTag("card:usgs-us7000abcd").fetchSemanticsNodes().isEmpty())
    }

    /* --------------------------------------------------------------------------- C4 */

    @Test fun c4AGradedForecastShowsItsGrade() {
        start("forecasts/ND-001")
        rule.waitUntil(10_000) { rule.onAllNodesWithText("Checked: Partly correct", substring = true).fetchSemanticsNodes().isNotEmpty() }
        scrollToText("has been checked. Result: Partly correct.")
    }

    /* --------------------------------------------------------------------------- C5 */

    @Test fun c5AQuietRecordIsNotCalledLive() {
        start("disasters/usgs-us7000ijkl")
        rule.onNodeWithText("EVENT NO LONGER UPDATED").assertExists()
        scrollToText("Not updated recently")
        assertTrue(rule.onAllNodesWithText("LIVE EVENT").fetchSemanticsNodes().isEmpty())
    }

    /* --------------------------------------------------------------------------- C6 */

    private fun manyOfficial(n: Int): String {
        val root = PndJson.parseToJsonElement(Fixtures.events).jsonObject
        val base = feed.events.first { it.id == "gdacs-FL-1104999" }.json
        val evs = (1..n).map { i -> JsonObject(LinkedHashMap(base).apply { put("id", JsonPrimitive("al-$i")); put("title", JsonPrimitive("Flood number $i")); put("updated", JsonPrimitive("2026-10-20T%02d:00:00Z".format(i % 24))) }) }
        return JsonObject(LinkedHashMap(root).apply { put("events", JsonArray(evs)) }).toString()
    }

    @Test fun c6AlertsShowFortyAtATimeAndSaySo() {
        start("alerts", http = FakeHttp(eventsBody = manyOfficial(45)))
        scrollTo("pager")
        rule.onNodeWithTag("pagerNote", useUnmergedTree = true).assertTextContains("Showing 40 of 45.")
        rule.onNodeWithText("Show 5 more").performClick()
        rule.waitForIdle()
        scrollTo("pager")
        rule.onNodeWithTag("pagerNote", useUnmergedTree = true).assertTextContains("Showing all 45.")
        assertTrue(rule.onAllNodesWithTag("showMore").fetchSemanticsNodes().isEmpty())
    }

    @Test fun c6ShowMoreMovesFocusToTheFirstNewCard() {
        val c = start("alerts", http = FakeHttp(eventsBody = manyOfficial(45)))
        scrollTo("showMore")
        rule.onNodeWithTag("showMore").performClick()
        rule.waitForIdle()
        val first = com.anchittandon.pnd.logic.Sorts.sort(c.feed.state.value.events.filter { it.official }, "newest") { it.json }[40]
        rule.onNodeWithTag("card:${first.id}").assertIsFocused()
    }

    /* --------------------------------------------------------------------------- C8 */

    @Test fun c8HazardFiltersAreBuiltFromTheData() {
        start("events")
        scrollTo("hazardFilter")
        rule.onNodeWithTag("hazardFilter").performClick()
        val n = feed.live.count { it.type == "Extreme Heat" }
        rule.onNodeWithTag("hazardFilter:Extreme Heat").assertTextContains("Extreme Heat ($n)", substring = true)
        rule.onNodeWithTag("hazardFilter:").assertTextContains("All hazards (${feed.live.size})", substring = true)
    }

    @Test fun c8HomeMapFilterIsFilledFromTheLiveRecords() {
        start("home")
        scrollTo("homeHazard")
        rule.onNodeWithTag("homeHazard").performClick()
        rule.onNodeWithTag("homeHazard:Earthquake aftershock sequence").assertExists()
        rule.onNodeWithTag("homeHazard:Extreme Heat").performClick()
        rule.waitForIdle()
        scrollToText("Live events by type")
        assertTrue(rule.onAllNodesWithTag("hazChip:Earthquake").fetchSemanticsNodes().isEmpty())
    }

    /* --------------------------------------------------------------------------- C9 */

    @Test fun c9TheDeviceZoneIsTheDefault() {
        val c = start("settings", before = { AppClock.deviceZone = { "Europe/London" } })
        assertEquals("Europe/London", c.settings.timezone)
        rule.onNodeWithText("Times are shown as, for example, 20 Oct 2026, 12:24 PM UK.").assertExists()
        AppClock.deviceZone = { "Asia/Kolkata" }
    }

    @Test fun c9CalamitiesSayTheDeviceZone() {
        start("calamities")
        scrollToText("Times are shown in your device's time zone.")
    }

    /* -------------------------------------------------------------------------- C10 */

    @Test fun c10TrustNoteCopy() {
        start("events")
        scrollTo("trustNote")
        rule.onNodeWithText("For real alerts, follow your national agency:").assertExists()
        rule.onNodeWithText("▸ Data sources: GDACS, USGS, EMSC, NASA EONET, NOAA NHC, NOAA NWS, ReliefWeb, USGS Volcanoes, Open-Meteo, NASA POWER").assertExists()
        rule.onNodeWithTag("trustWhen").assertTextContains("Live data from the agencies 20 Oct 2026, 4:54 PM IST", substring = true)
        assertTrue(rule.onAllNodesWithText("Data sources (", substring = true).fetchSemanticsNodes().isEmpty())
    }

    /* -------------------------------------------------------------------------- C11 */

    @Test fun c11TheNd001CheckHasAllEightRows() {
        start("verification-detail")
        // LABELS[VERDICTS[status]] from the verification ledger: ND-001 is partly correct.
        rule.waitUntil(10_000) { rule.onAllNodesWithText("Partly correct", substring = true).fetchSemanticsNodes().isNotEmpty() }
        listOf("Area", "Start date", "Start time", "Duration", "How widespread", "Strength or severity", "Lives lost", "Missing people").forEach { m -> scrollTo("cmp:$m") }
    }

    /* -------------------------------------------------------------------------- C12 */

    @Test fun c12HomeMapSearchSelectsOrSaysNothingMatches() {
        start("home")
        scrollTo("mapSearch")
        rule.onNodeWithTag("mapSearch").performTextInput("Atlantis")
        rule.onNodeWithTag("mapSearch").performImeAction()
        rule.waitForIdle()
        scrollTo("mapNudge")
        rule.onNodeWithText("SEARCH").assertExists()
        rule.onNodeWithText("No live event matches “Atlantis”").assertExists()
        rule.onNodeWithText("Try a country, a city or a type of hazard.").assertExists()
        assertTrue(rule.onAllNodesWithTag("nudgeDetail").fetchSemanticsNodes().isEmpty())
        rule.onNodeWithTag("mapSearch").performTextReplacement("Nepal")
        rule.onNodeWithTag("mapSearch").performImeAction()
        rule.waitForIdle()
        scrollTo("mapNudge")
        rule.onNodeWithText("SELECTED EVENT ON MAP").assertExists()
        rule.onNodeWithTag("nudgeDetail").assertExists()
    }

    /* -------------------------------------------------------------------------- C14 */

    @Test fun c14OneCountPerQuantity() {
        start("forecasts")
        val open = Portal.openForecasts(feed.events) { it.json }.size
        rule.onNodeWithText("$open open forecasts", substring = true).assertExists()
    }

    @Test fun c14RegionCountsSourcesReportingHere() {
        start("regions/Nepal")
        scrollToText("sources reporting here")
    }

    /* -------------------------------------------------------------------------- C15 */

    @Test fun c15NothingMatchesCountsReports() {
        start("events")
        scrollTo("search")
        rule.onNodeWithTag("search").performTextInput("zzqx")
        rule.waitForIdle()
        val reports = Portal.observed(feed.events) { it.json }
        scrollTo("empty")
        rule.onNodeWithText("Right now we have ${reports.size} events from ${com.anchittandon.pnd.logic.Format.countryCount(reports.map { it.json })} countries", substring = true).assertExists()
    }

    /* -------------------------------------------------------------------------- C17 */

    @Test fun c17EventsAreScopedToARegion() {
        start("events?region=Asia")
        scrollTo("scopeNote")
        rule.onNodeWithText("Showing only Asia.").assertExists()
        val n = Collections.scoped(feed.live, "events", "Asia") { it.json }
        scrollTo("statusLine")
        rule.onNodeWithTag("statusLine").assertTextContains(Collections.countText(n, "events", "events") { it.json }, substring = true)
        rule.onNodeWithText("Show everywhere →").performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithTag("scopeNote").fetchSemanticsNodes().isEmpty())
    }

    /* -------------------------------------------------------------------------- C18 */

    @Test fun c18TheLiveMapSaysWhatASearchFound() {
        start("live-map")
        rule.onNodeWithTag("search").performTextInput("Nepal")
        rule.waitForIdle()
        val n = feed.live.count { com.anchittandon.pnd.logic.Search.matches(it.json, "Nepal") }
        rule.onNodeWithTag("mapNote").assertTextContains("$n events match “Nepal”. The map shows them.")
    }

    /* -------------------------------------------------------------------------- C19 */

    @Test fun c19AFailedFeedIsNotAnEmptyWorld() {
        start("home", http = FakeHttp(failEvents = true))
        scrollTo("kpi:Official warnings")
        rule.onAllNodesWithText("Live data unavailable", useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.size >= 4) }
        scrollTo("unavailable")
        rule.onNodeWithText("Live data unavailable.").assertExists()
    }

    @Test fun c19AlertsFiguresSayUnavailable() {
        start("alerts", http = FakeHttp(failEvents = true))
        rule.onNodeWithText("Unavailable official reports").assertExists()
        scrollTo("listError")
    }

    /* -------------------------------------------------------------------------- C20 */

    @Test fun c20NotFoundSaysSoWithALink() {
        start("alerts/no-such-alert")
        rule.onNodeWithText("Alert not found").assertExists()
        rule.onNodeWithTag("goneText").assertTextContains("The source may no longer list this alert. See all official warnings.")
    }

    @Test fun c20AFirstLoadThatFailsSaysUnavailable() {
        start("disasters/gdacs-FL-1104999", http = FakeHttp(failEvents = true))
        rule.onNodeWithText("Live data unavailable").assertExists()
        rule.onNodeWithTag("goneText").assertTextContains("We could not load this event just now. Trying again automatically. See all events.")
    }

    @Test fun c20AnUnknownForecastIsNotFound() {
        start("forecasts/OUT-not-a-forecast")
        rule.waitUntil(10_000) { rule.onAllNodesWithText("Forecast not found").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("goneText").assertTextContains("Check the link, or see all our forecasts.", substring = true)
    }

    /* -------------------------------------------------------------------------- C21 */

    @Test fun c21AnUnknownHazardIsItselfNotFlood() {
        start("hazards/Ice")
        rule.onNodeWithTag("detailTitle").assertTextContains("Ice events")
        scrollTo("hazardEmpty")
        rule.onNodeWithText("Our sources have no current report of this hazard. This does not mean there is no danger.").assertExists()
    }

    @Test fun c21HazardDetailListsReportsAndCountsForecasts() {
        start("hazards/Extreme%20Heat")
        val sel = com.anchittandon.pnd.logic.HazardPage.select(feed.events, "Extreme Heat", "") { it.json }
        scrollTo("hazardForecastNote")
        rule.onNodeWithText("We also have ${sel.openForecasts.size} open forecasts of extreme heat. They are our own estimates, not events.").assertExists()
        assertTrue(sel.events.none { it.forecast })
    }

    /* -------------------------------------------------------------------------- C22 */

    @Test fun c22AnUnknownSourceIsNotFound() {
        start("sources/Nowhere%20Agency")
        rule.onNodeWithTag("detailTitle").assertTextContains("Source not found")
        rule.onNodeWithText("None of our current reports names a source called “Nowhere Agency”.").assertExists()
    }

    /* -------------------------------------------------------------------------- C23 */

    @Test fun c23MyPlacesKeepsTheCountryUntilTheReaderEdits() {
        start("personal-risk")
        scrollTo("placeName")
        rule.onNodeWithTag("placeName").performTextInput("Kathmandu")
        rule.onNodeWithTag("findPlace").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("placeChooser").fetchSemanticsNodes().isNotEmpty() }
        scrollTo("choice:Kathmandu, Bagmati Province, Nepal|City or town")
        rule.onNodeWithTag("choice:Kathmandu, Bagmati Province, Nepal|City or town").performClick()
        rule.waitForIdle()
        // The values the search filled, written again (as Enter does): the country stays.
        scrollTo("lat")
        rule.onNodeWithTag("lat").performTextReplacement("27.717200")
        scrollTo("placeResultNote")
        rule.onNodeWithTag("placeResultNote").assertTextContains("Chosen:", substring = true)
        // The reader's own edit clears it.
        scrollTo("lat")
        rule.onNodeWithTag("lat").performTextReplacement("27.7")
        scrollTo("placeResultNote")
        rule.onNodeWithTag("placeResultNote").assertTextContains("You changed the place", substring = true)
    }

    /* ------------------------------------------------------------- C26: no false all-clear */

    private fun feedWith(edit: (JsonObject) -> JsonObject?): String {
        val root = PndJson.parseToJsonElement(Fixtures.events).jsonObject
        val evs = (root["events"] as JsonArray).mapNotNull { edit(it.jsonObject) }
        return JsonObject(LinkedHashMap(root).apply { put("events", JsonArray(evs)) }).toString()
    }

    @Test fun c26HomeSaysCheckingThenAnswersWhenTheDataArrives() {
        val c = start("home", settings = mapOf("pnd_saved_locations" to com.anchittandon.pnd.SAVED_PLACES), load = false)
        scrollTo("placeResult")
        rule.onNodeWithText("Checking…", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag("placeHappening").assertTextContains("Checking the latest reports for this place.")
        rule.onNodeWithTag("placeLastChecked").assertTextContains("not yet: the data is still loading")
        rule.onNodeWithText("Nothing reported nearby").assertDoesNotExist()
        assertTrue(rule.onAllNodesWithTag("placeWhy").fetchSemanticsNodes().isEmpty())
        // The data arrives: the place is answered again, by itself.
        runBlocking { c.feed.refresh() }
        rule.waitForIdle()
        scrollTo("placeWhy")
        rule.onNodeWithText("Checking…", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun c26AFailedFirstLoadIsUnavailableNotNothingNearby() {
        start("home", http = FakeHttp(failEvents = true), settings = mapOf("pnd_saved_locations" to com.anchittandon.pnd.SAVED_PLACES))
        scrollTo("placeResult")
        rule.onNodeWithTag("placeBadge", useUnmergedTree = true).assertExists()
        rule.onAllNodesWithText("Live data unavailable", useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.isNotEmpty()) }
        scrollTo("placeLastChecked")
        rule.onNodeWithTag("placeLastChecked").assertTextContains("not yet: the latest data could not be loaded")
        rule.onNodeWithText("Nothing reported nearby").assertDoesNotExist()
        rule.onNodeWithText("No report was used for this answer.").assertDoesNotExist()
    }

    @Test fun c26ALaterFailedRefreshKeepsTheLastAnswer() {
        val http = FakeHttp()
        val c = start("home", http = http, settings = mapOf("pnd_saved_locations" to com.anchittandon.pnd.SAVED_PLACES))
        scrollTo("placeWhy")
        http.failEvents = true
        runBlocking { c.feed.refresh() }
        rule.waitForIdle()
        scrollTo("placeWhy")
        rule.onNodeWithText("Checking…", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun c26MyPlacesChipsBeforeTheFeed() {
        start("personal-risk", settings = mapOf("pnd_saved_locations" to com.anchittandon.pnd.SAVED_PLACES), load = false)
        scrollTo("summary:Kathmandu")
        rule.onNodeWithTag("summary:Kathmandu").assertTextContains("CHECKING…", substring = true)
    }

    @Test fun c26MyPlacesFailedShowsTheUnavailableCard() {
        start("personal-risk", http = FakeHttp(failEvents = true), settings = mapOf("pnd_saved_locations" to com.anchittandon.pnd.SAVED_PLACES))
        scrollTo("summary:Kathmandu")
        rule.onNodeWithTag("summary:Kathmandu").assertTextContains("LIVE DATA UNAVAILABLE", substring = true)
        scrollTo("unavailable")
        rule.onNodeWithText("Do not rely on this page in an emergency. Check with your local authorities.").assertExists()
        assertTrue(rule.onAllNodesWithTag("band:A").fetchSemanticsNodes().isEmpty())
    }

    @Test fun c26ThePlacePageSaysCheckingThenUnavailable() {
        start("locations/Kathmandu?lat=27.7172&lon=85.324&level=City%20or%20town&country=Nepal&cc=NP", http = FakeHttp(failEvents = true))
        scrollTo("placeAnswer")
        rule.onNodeWithTag("placeAnswer").assertTextContains("We could not load the latest reports", substring = true)
        rule.onNodeWithTag("placeAnswer").assert(androidx.compose.ui.test.hasContentDescription("Live data unavailable", substring = true))
        rule.onNodeWithText("Nothing reported nearby").assertDoesNotExist()
    }

    /* ------------------------------------------------------------------- C27: zone labels */

    @Test fun c27TheTopBarNeverShowsAnIanaId() {
        start("events", before = { AppClock.deviceZone = { "America/Argentina/Buenos_Aires" } })
        rule.onNodeWithTag("tzButton").assertTextContains("GMT-3")
        rule.onNodeWithContentDescription("Display time zone: GMT-3 · Buenos Aires. Change it").assertExists()
        assertTrue(rule.onAllNodesWithText("America/Argentina/Buenos_Aires", substring = true).fetchSemanticsNodes().isEmpty())
        AppClock.deviceZone = { "Asia/Kolkata" }
    }

    /* --------------------------------------------------------------------- review defects */

    @Test fun aRecordWithALatitudeButNoLongitudeOpens() {
        val body = feedWith { e -> if (e["id"]?.toString()?.trim('"') in setOf("gdacs-FL-1104999", "eonet-EONET_7003", "gdacs-DR-1105003", "ND-001")) JsonObject(LinkedHashMap(e).apply { remove("lon") }) else e }
        listOf("alerts/gdacs-FL-1104999" to "Flood in Bagmati Province, Nepal").forEach { (route, _) ->
            start(route, http = FakeHttp(eventsBody = body))
            rule.onNodeWithTag("detailTitle").assertExists()
            scrollToText("Map of the affected area")
        }
    }

    @Test fun anEventWithALatitudeButNoLongitudeOpens() {
        val body = feedWith { e -> if (e["id"]?.toString()?.trim('"') == "eonet-EONET_7003") JsonObject(LinkedHashMap(e).apply { remove("lon") }) else e }
        start("disasters/eonet-EONET_7003", http = FakeHttp(eventsBody = body))
        rule.onNodeWithTag("detailTitle").assertExists()
        scrollToText("Open the live map →")
    }

    @Test fun aForecastAndACalamityWithALatitudeButNoLongitudeOpen() {
        val body = feedWith { e -> if (e["id"]?.toString()?.trim('"') in setOf("gdacs-DR-1105003", "ND-001")) JsonObject(LinkedHashMap(e).apply { remove("lon") }) else e }
        start("forecasts/ND-001", http = FakeHttp(eventsBody = body))
        scrollToText("Forecast area map")
    }

    @Test fun aCalamityWithALatitudeButNoLongitudeOpens() {
        val body = feedWith { e -> if (e["id"]?.toString()?.trim('"') == "gdacs-DR-1105003") JsonObject(LinkedHashMap(e).apply { remove("lon") }) else e }
        start("calamities/gdacs-DR-1105003", http = FakeHttp(eventsBody = body))
        scrollToText("Open the live map →")
    }

    @Test fun anOpenRecordStaysWhenARefreshDropsIt() {
        val http = FakeHttp()
        val c = start("disasters/emsc-20260913_0000123", http = http)
        rule.onNodeWithTag("detailTitle").assertExists()
        http.eventsBody = feedWith { e -> if (e["id"]?.toString()?.trim('"') == "emsc-20260913_0000123") null else e }
        runBlocking { c.feed.refresh() }
        rule.waitForIdle()
        rule.onNodeWithText("Event not found").assertDoesNotExist()
        rule.onNodeWithTag("detailTitle").assertExists()
    }

    @Test fun theLiveMapDoesNotSayItShowsMatchesWithoutCoordinates() {
        val body = feedWith { e -> JsonObject(LinkedHashMap(e).apply { remove("lat"); remove("lon") }) }
        start("live-map", http = FakeHttp(eventsBody = body))
        rule.onNodeWithTag("search").performTextInput("Nepal")
        rule.waitForIdle()
        rule.onNodeWithTag("mapNote").assertTextContains("No event matches “Nepal”.")
    }

    @Test fun changingTheTimeZoneKeepsTheScreen() {
        val c = start("events")
        rule.onNodeWithText("Events happening now").assertExists()
        c.settings.setTimezone("UTC")
        rule.waitForIdle()
        rule.onNodeWithText("Events happening now").assertExists()
        rule.onNodeWithTag("tzButton").assertTextContains("UTC")
        rule.onNodeWithText("Is a place you care about at risk?").assertDoesNotExist()
    }

    @Test fun aFailedLedgerReadIsUnavailableNotNotFound() {
        start("forecasts/OUT-not-a-forecast", http = FakeHttp(failData = true))
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("detailError").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Live data unavailable").assertExists()
        rule.onNodeWithText("Forecast not found").assertDoesNotExist()
    }
}
