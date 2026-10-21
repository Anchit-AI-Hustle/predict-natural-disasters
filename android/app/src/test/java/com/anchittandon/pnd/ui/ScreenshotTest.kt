package com.anchittandon.pnd.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToIndex
import com.anchittandon.pnd.FakeHttp
import com.anchittandon.pnd.SAVED_PLACES
import com.anchittandon.pnd.testContainer
import com.anchittandon.pnd.ui.components.LocalLiveMap
import com.github.takahirom.roborazzi.RoborazziOptions
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every main screen and each detail kind, from the sample fixtures, at three sizes. Record with
 * `./gradlew recordRoborazziDebug`, check with `verifyRoborazziDebug`. The PNGs live in
 * app/src/test/snapshots.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
abstract class ScreenshotBase(private val device: String) {
    @get:Rule val rule = createComposeRule()

    protected open fun fontScale() = 1f

    @Before fun scale() { RuntimeEnvironment.setFontScale(fontScale()) }

    private fun shot(name: String, route: String, failFeed: Boolean = false, settings: Map<String, String> = mapOf("pnd_saved_locations" to SAVED_PLACES), waitFor: String? = null, scrollTo: Int = 4) {
        val http = FakeHttp(failEvents = failFeed)
        val c = testContainer(http, settings)
        runBlocking { c.feed.refresh() }
        rule.setContent { CompositionLocalProvider(LocalLiveMap provides false) { PndApp(c, startRoute = route, poll = false) } }
        rule.waitForIdle()
        if (waitFor != null) { rule.waitUntil(90_000) { c.trackRecord.state.value is com.anchittandon.pnd.data.TrackRecordRepository.State.Ready }; rule.waitForIdle() }
        val opts = RoborazziOptions(compareOptions = RoborazziOptions.CompareOptions(changeThreshold = 0.01f))
        rule.onRoot().captureRoboImage("src/test/snapshots/${device}_$name.png", roborazziOptions = opts)
        // And further down, where the lists and detail panels are.
        if (scrollTo > 0) {
            rule.onNodeWithTag("screen").performScrollToIndex(scrollTo)
            rule.waitForIdle()
            rule.onRoot().captureRoboImage("src/test/snapshots/${device}_${name}_more.png", roborazziOptions = opts)
        }
    }

    @Test fun home() = shot("home", "home")
    @Test fun homeNoPlaces() = shot("home_first_visit", "home", settings = emptyMap(), scrollTo = 0)
    @Test fun map() = shot("map", "live-map")
    @Test fun alerts() = shot("alerts", "alerts")
    @Test fun forecasts() = shot("forecasts", "forecasts")
    @Test fun myPlaces() = shot("my_places", "personal-risk")
    @Test fun trackRecord() = shot("track_record", "accuracy", waitFor = "answer")
    @Test fun events() = shot("events", "events")
    @Test fun officialWarnings() = shot("official_warnings", "official-warnings")
    @Test fun forecastList() = shot("forecast_list", "forecast-list")
    @Test fun forecastCalendar() = shot("forecast_calendar", "forecast-calendar")
    @Test fun calamities() = shot("calamities", "calamities")
    @Test fun regions() = shot("regions", "regions")
    @Test fun sources() = shot("sources", "resources")
    @Test fun insights() = shot("insights", "insights")
    @Test fun methodology() = shot("methodology", "methodology")
    @Test fun about() = shot("about", "about")
    @Test fun verification() = shot("verification", "verification")
    @Test fun more() = shot("more", "more", scrollTo = 0)
    @Test fun settings() = shot("settings", "settings", scrollTo = 0)
    @Test fun feedError() = shot("error_feed_failed", "events", failFeed = true, scrollTo = 3)
    @Test fun eventDetail() = shot("detail_event", "disasters/emsc-20260913_0000123")
    @Test fun alertDetail() = shot("detail_alert", "alerts/gdacs-FL-1104999")
    @Test fun calamityDetail() = shot("detail_calamity", "calamities/gdacs-DR-1105003")
    @Test fun forecastDetail() = shot("detail_forecast", "forecasts/ND-001")
    @Test fun forecastDetailAftershock() = shot("detail_forecast_aftershock", "forecasts/OUT-aftershock-usgs-us7000abcd")
    @Test fun regionDetail() = shot("detail_region", "regions/Nepal")
    @Test fun locationDetail() = shot("detail_location", "locations/Kathmandu?lat=27.7172&lon=85.324&level=City%20or%20town&country=Nepal&cc=NP")
    @Test fun hazardDetail() = shot("detail_hazard", "hazards/Earthquake")
    @Test fun historyDetail() = shot("detail_history", "history/mount-vesuvius-eruption")
    @Test fun sourceDetail() = shot("detail_source", "sources/GDACS")
    @Test fun verificationDetail() = shot("detail_nd001_check", "verification-detail")
    @Test fun notFound() = shot("detail_not_found", "disasters/no-such-record", scrollTo = 0)
    // Screens added for the audit fixes (features.md changelog).
    @Test fun regionContinent() = shot("detail_region_asia", "regions/Asia")
    @Test fun eventsScoped() = shot("events_region_asia", "events?region=Asia", scrollTo = 0)
    @Test fun hazardUnknown() = shot("detail_hazard_unknown", "hazards/Ice")
    @Test fun sourceNotFound() = shot("detail_source_not_found", "sources/Nowhere", scrollTo = 0)
    @Test fun forecastNotFound() = shot("detail_forecast_not_found", "forecasts/OUT-not-a-forecast", scrollTo = 0)
    @Test fun homeFeedFailed() = shot("home_feed_failed", "home", failFeed = true)
}

@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class PhoneScreenshotTest : ScreenshotBase("phone")

@Config(sdk = [34], qualifiers = "w820dp-h1180dp-xhdpi")
class TabletScreenshotTest : ScreenshotBase("tablet")

@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class LargeFontScreenshotTest : ScreenshotBase("large_font2x") {
    override fun fontScale() = 2f
}
