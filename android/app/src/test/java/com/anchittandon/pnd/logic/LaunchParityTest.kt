package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.jsonObjectOf
import com.anchittandon.pnd.ui.CollectionView
import com.anchittandon.pnd.ui.screens.HISTORY_SEVERITY
import com.anchittandon.pnd.ui.screens.areasText
import com.anchittandon.pnd.ui.screens.legacySlug
import com.anchittandon.pnd.ui.screens.slug
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** One test per row of the launch audit (features.md changelog C28 to C47) that the app ports. */
class LaunchParityTest {
    @Before fun fix() { AppClock.now = { VectorsTest.NOW }; AppClock.zone = "Asia/Kolkata" }
    @After fun reset() { AppClock.zone = "Asia/Kolkata" }

    private fun o(vararg p: Pair<String, Any?>): JsonObject = jsonObjectOf(*p)

    /* C28: the bundled grading code is the website's verify-1.4.0. */
    @Test fun c28RestatedAlertsAreGradedOnNewImpact() {
        val ver = java.io.File("src/main/assets/js/verification-model.js").readText()
        assertTrue(ver.contains("var VERIFICATION_VERSION = 'verify-1.4.0'"))
        assertTrue(ver.contains("'continuation-outlook': 'new-impact'") && ver.contains("'warning-derived': 'new-impact'"))
        assertTrue(ver.contains("RESTATED_CLASSES"))
    }

    /* C31: one level function for badges, filters, markers and the calendar. */
    @Test fun c31OneLevelEverywhere() {
        val typhoon = o("type" to "Tropical Cyclone", "title" to "Super Typhoon X", "alert" to "Green", "source" to "GDACS")
        assertEquals(Level.EXTREME, RiskScale.markerLevel(typhoon))
        assertTrue(RiskScale.matchesRiskLevel(typhoon, "EXTREME"))
        assertEquals(listOf("EXTREME"), RiskScale.filterOptions(listOf(typhoon)).map { it.first })
        assertEquals(listOf("EXTREME", "LOW"), RiskScale.filterOptions(listOf(typhoon), "LOW").map { it.first })
        assertEquals("Low (no USGS PAGER impact alert issued)", RiskScale.riskWords(o("type" to "Earthquake", "source" to "USGS", "severity" to "Informational", "magnitude" to 4.6)))
        assertEquals("Severe", Hazards.severityOf(o("forecastKind" to "model-advance", "alert" to "High")))
    }

    /* C32: model forecasts are named for what they measure. */
    @Test fun c32ModelHazardNames() {
        assertEquals("Unusually hot days forecast - Delhi", Format.titleOf(o("title" to "Extreme heat forecast - Delhi", "forecastKind" to "model-advance")))
        assertEquals("Extreme Heat", Hazards.hazardOf("Unusually hot days").key)
        assertEquals("Flood", Hazards.hazardOf("Unusually heavy rain").key)
        assertEquals("Wildfire", Hazards.hazardOf("High fire-weather index").key)
    }

    /* C33: open forecasts only, and what each is. */
    @Test fun c33OpenForecastListsSayWhatEachIs() {
        val list = listOf(o("forecast" to true, "forecastKind" to "model-advance"), o("forecast" to true, "forecastOf" to "x"), o("forecast" to true, "forecastKind" to "model-advance"))
        assertEquals("Of these: 2 made in advance by our weather models, 1 restating an agency alert.", Portal.forecastKinds(list) { it })
        assertFalse(Collections.keep("forecast-list", o("forecast" to true, "windowClosed" to true)))
        assertTrue(Collections.keep("forecast-calendar", o("forecast" to true)))
        assertEquals("1 open forecast", Collections.countText(listOf(o("forecast" to true)), "forecast-calendar", "forecasts") { it })
    }

    /* C35: plain hyphens in titles. */
    @Test fun c35TitlesReadPlainHyphens() {
        assertEquals("Storm - Luzon", Format.titleOf(o("title" to "Storm " + Char(0x2014) + " Luzon")))
        assertEquals("Aftershock risk north of Honshu - 7-day forecast", Format.titleOf(o("title" to "Aftershock-sequence outlook - north of Honshu")))
    }

    /* C36: one name per country, places matched exactly. */
    @Test fun c36CountryNamesAndExactPlaces() {
        assertEquals("Mexico", CountryNames.canonical("México"))
        assertEquals("Mexico", CountryNames.canonical("MX"))
        assertEquals(listOf("Japan"), CountryNames.place(listOf("Japan region")).countries)
        assertEquals("Reykjanes Ridge", CountryNames.place(listOf("Reykjanes Ridge")).sea)
        assertEquals(1, Format.countryCount(listOf(o("country" to "Mexico"), o("country" to "México"), o("country" to "MX"), o("country" to "Reykjanes Ridge"))))
        assertFalse(Portal.inPlace(o("country" to "Nigeria"), "Niger"))
        assertTrue(Portal.inPlace(o("country" to "Niger"), "Niger"))
        assertFalse(Portal.inPlace(o("title" to "Flood in Brazil", "country" to "Brazil"), "braz"))
        assertTrue(Portal.inPlace(o("country" to "United States", "region" to "Alaska"), "Alaska"))
        assertTrue(Search.matches(o("title" to "Earthquake", "country" to "Türkiye"), "turkey"))
        assertEquals("Asia/Kolkata", Portal.timezone("Asia/Calcutta") { null })
    }

    /* C37: the place answer names both the report and the forecast. */
    @Test fun c37PlaceAnswerNamesBoth() {
        val e = VectorsTest.events
        val a = PlaceRisk.assess(VectorsTest.places["home"]!!.jsonObject, listOf(e["fcCountryNP"]!!.jsonObject, e["quakeNear"]!!.jsonObject), null)
        assertNotNull(a.observed); assertNotNull(a.forecast)
        assertTrue(a.why.endsWith(" One of our forecasts also covers your place."))
        assertTrue(PlaceRisk.summarise(a), PlaceRisk.summarise(a).endsWith(" · our forecast also covers it"))
    }

    /* C38: the Live events subline adds up. */
    @Test fun c38HomeNumbersAddUp() {
        val r = HomeModel.render(listOf(o("severity" to "Extreme"), o("severity" to "Moderate"), o("alert" to "Green"), o("id" to "x")), "", "newest")
        assertEquals("1 extreme · 1 moderate · 1 low · 1 not rated", r.kEventsNote)
        val opts = HomeModel.hazardOptions(listOf(o("type" to "Flood"), o("type" to "Earthquake aftershock sequence", "forecast" to true)), null)
        assertEquals(listOf("" to "All hazards", "Flood" to "Flood (1)", "Earthquake aftershock sequence" to "Earthquake aftershock sequence (forecasts only)"), opts)
    }

    /* C39: official labels follow the evidence. */
    @Test fun c39OfficialWordsAndEyebrows() {
        val watch = o("evidenceState" to "official-warning", "officialProduct" to "watch", "source" to "NWS")
        assertEquals("Official watch", Format.officialWord(watch))
        assertEquals("OFFICIAL WATCH", Format.provenance(watch))
        assertEquals("OFFICIAL WATCH", DetailWords.eventEyebrow(watch))
        assertEquals("REPORTED EVENT", DetailWords.eventEyebrow(o("source" to "USGS")))
        assertEquals("REPORT FROM AN OFFICIAL AGENCY", DetailWords.alertEyebrow(o("source" to "USGS")))
        assertEquals("Minor", Hazards.severityOf(o("alert" to "Yellow")))
    }

    /* C40: help and needs only where grave. */
    @Test fun c40LifeSafety() {
        assertTrue(Portal.lifeSafety(o("evidenceState" to "official-warning")))
        assertFalse(Portal.lifeSafety(o("evidenceState" to "official-warning", "officialProduct" to "advisory")))
        assertTrue(Portal.lifeSafety(o("alert" to "Red")))
        assertTrue(Portal.lifeSafety(o("alert" to "Green", "deaths" to 2)))
        assertFalse(Portal.lifeSafety(o("alert" to "Green", "magnitude" to 4.5)))
        assertFalse(Portal.lifeSafety(o("forecast" to true, "alert" to "Red")))
    }

    /* C41: live by hours; the quiet time is said. */
    @Test fun c41QuietWords() {
        assertEquals("Not updated for 30 hours", Portal.liveWord(o("live" to false, "quietHours" to 30, "quietDays" to 1)))
        assertEquals("Not updated for 3 days", Portal.liveWord(o("live" to false, "quietDays" to 3)))
        assertEquals("Not updated for some time", Portal.liveWord(o("live" to false)))
        assertEquals("Not updated by NHC for 1 hour. It may have ended; check the source for its current status.",
            Format.quietNote(o("live" to false, "quietHours" to 1, "quietDays" to 0, "source" to "NHC")))
    }

    /* C42: a link to a merged-away id opens the record it is now part of. */
    @Test fun c42FindEventFollowsMergedFrom() {
        val merged = o("id" to "usgs-1", "mergedFrom" to listOf(mapOf("id" to "emsc-9"), mapOf("id" to "gdacs-EQ-3")))
        assertEquals("usgs-1", Format.findEvent(listOf(o("id" to "other"), merged), "emsc-9") { it }?.get("id")?.toString()?.trim('"'))
        assertNull(Format.findEvent(listOf(merged), "---") { it })
    }

    /* C43: cyclones are classed by their basin. */
    @Test fun c43CycloneClassByBasin() {
        assertEquals(Hazards.CycloneClass("IMD class", "Extremely Severe Cyclonic Storm"), Hazards.cycloneClass(100.0, 15.0, 88.0))
        assertEquals("Super typhoon", Hazards.cycloneClass(140.0, 15.0, 135.0)?.value)
        assertEquals("Category 3", Hazards.cycloneClass(100.0, 25.0, -60.0)?.value)
        assertEquals("Tropical cyclone", Hazards.cycloneClass(40.0, -15.0, 60.0)?.value)
        assertEquals("Category", Hazards.cycloneClass(100.0, null, null)?.scale)
        assertEquals("IMD", Hazards.cycloneAuthority(o("lat" to 15, "lon" to 88))?.short)
        val fact = Hazards.keyFacts(o("type" to "Tropical Cyclone", "windKt" to 70, "lat" to 20, "lon" to 130)).first { it.key == "category" }
        assertEquals("JMA class (JTWC above 130 kt)", fact.label); assertEquals("Typhoon", fact.value)
    }

    /* C44: reader-facing places, dates and ages. */
    @Test fun c44AreasDatesAndAges() {
        assertEquals("05 Sep 2026", Format.fmtOf(o("updated" to "2026-09-05T00:00:00Z", "datePrecision" to "day")))
        assertEquals("05 Sep 2026, 11:30 AM IST", Format.fmtDate("2026-09-05T06:00:00Z"))
        val now = JsDate.parse("2026-10-20T00:00:00Z")!!
        assertEquals("5 months ago", Format.age("2026-06-01T00:00:00Z", now))
        assertEquals("3 years ago", Format.age("2023-01-01T00:00:00Z", now))
        assertEquals("Western Pacific Ocean (may affect Marshall Islands)", areasText(o("areas" to listOf("Western Pacific Ocean (may affect Marshall Islands)"), "region" to "x"), "-"))
        assertEquals("Hilo, United States", areasText(o("region" to "Hilo", "country" to "United States"), "-"))
    }

    /* C45: one address per record; sorts that need a figure; lists that page. */
    @Test fun c45OneAddressAndFigureSorts() {
        assertEquals("/disasters/g-1", Format.eventUrl(o("id" to "g-1", "sourceType" to "official", "alert" to "Red")))
        val a = o("countries" to listOf("Philippines"), "place" to "10 km WSW of Esperanza")
        val b = o("countries" to listOf("Philippines"), "place" to "1 km WSW of Butulan")
        assertEquals(listOf(b, a), Sorts.sort(listOf(a, b), "country") { it })
        assertEquals(listOf("newest", "severity", "oldest", "country", "type", "source", "title"), Sorts.offered(Sorts.EVENT_SORTS, listOf(a, b)))
        assertTrue("deaths" in Sorts.offered(Sorts.EVENT_SORTS, listOf(o("deaths" to 3))))
        assertFalse(Collections.keep("events", o("forecast" to true, "forecastKind" to "frozen-benchmark")))
        assertTrue(Collections.keep(CollectionView.HISTORICAL.route, o("live" to false)))
        assertFalse(Collections.keep(CollectionView.HISTORICAL.route, o("live" to true)))
        assertEquals("Recently ended events", CollectionView.HISTORICAL.title)
    }

    /* C46: history slugs fold accents; the old slug still opens. */
    @Test fun c46HistorySlugs() {
        assertEquals("tohoku-earthquake-and-tsunami", slug("Tōhoku earthquake and tsunami"))
        assertEquals("t-hoku-earthquake-and-tsunami", legacySlug("Tōhoku earthquake and tsunami"))
        assertEquals(setOf("Catastrophic", "Major"), HISTORY_SEVERITY.keys)
        val names = kotlinx.serialization.json.Json.parseToJsonElement(java.io.File("src/main/assets/history.json").readText()) as kotlinx.serialization.json.JsonArray
        assertEquals(36, names.size)
    }

    /* C47: India's zone label. */
    @Test fun c47IndiaZoneLabel() {
        assertEquals("India (IST)", Format.tzMenuLabel("Asia/Kolkata"))
        assertEquals("India (IST)", Format.tzMenuLabel("Asia/Calcutta"))
        assertEquals("IST", Format.tzLabel("Asia/Calcutta"))
        assertEquals("Asia/Kathmandu", Format.zoneName("Asia/Katmandu"))
    }
}
