@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.FeedState
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.theme.Pnd

/** trust.js: the data groups a screen is built from. */
enum class TrustGroup { FEED, MODELS, PLACE, LEDGER }

data class Agency(val name: String, val full: String, val url: String)
data class TrustSource(val key: String?, val name: String, val short: String, val url: String, val adds: String, val model: Boolean = false)

object TrustCopy {
    const val WARN = "Experimental model, not an official warning."
    val OFFICIAL = listOf(
        "India" to listOf(Agency("IMD", "India Meteorological Department", "https://mausam.imd.gov.in/"), Agency("NDMA", "National Disaster Management Authority", "https://ndma.gov.in/")),
        "United States" to listOf(Agency("NWS", "NOAA National Weather Service", "https://www.weather.gov/"), Agency("USGS", "U.S. Geological Survey (earthquakes)", "https://earthquake.usgs.gov/")),
        "Worldwide" to listOf(Agency("GDACS", "Global Disaster Alert and Coordination System", "https://www.gdacs.org/")),
    )
    const val WMO_URL = "https://wmo.int/about/governance/wmo-members"
    const val WMO_FULL = "national weather services listed by the WMO"

    val SOURCES = mapOf(
        TrustGroup.FEED to listOf(
            TrustSource("gdacs", "GDACS", "GDACS", "https://www.gdacs.org/", "Alerts for earthquakes, tropical cyclones, floods, droughts, wildfires and volcanoes worldwide, with impact figures."),
            TrustSource("usgs", "USGS Earthquake Hazards Program", "USGS", "https://earthquake.usgs.gov/", "Every earthquake of magnitude 2.5 or more in the past 7 days, and the shocks the 7-day aftershock outlooks follow."),
            TrustSource("emsc", "EMSC", "EMSC", "https://www.emsc-csem.org/", "An independent check on earthquakes of magnitude 4.5 or more."),
            TrustSource("eonet", "NASA EONET", "NASA EONET", "https://eonet.gsfc.nasa.gov/", "Wildfires, storms, volcanoes and other events seen from satellites."),
            TrustSource("nhc", "NOAA National Hurricane Center", "NOAA NHC", "https://www.nhc.noaa.gov/", "Active tropical cyclones in the Atlantic and eastern and central Pacific only."),
            TrustSource("nws", "NOAA National Weather Service", "NOAA NWS", "https://www.weather.gov/", "Severe and extreme weather warnings in the United States."),
            TrustSource("reliefweb", "ReliefWeb (UN OCHA)", "ReliefWeb", "https://reliefweb.int/", "Humanitarian disaster declarations, by country."),
            TrustSource("usgs_volcano", "USGS Volcano Hazards Program", "USGS Volcanoes", "https://volcanoes.usgs.gov/", "US-monitored volcanoes at a raised alert level."),
            TrustSource(null, "Open-Meteo Geocoding", "Open-Meteo", "https://open-meteo.com/en/docs/geocoding-api", "Places ReliefWeb’s country-level records, which carry no coordinates, at their country."),
        ),
        TrustGroup.MODELS to listOf(
            TrustSource(null, "Open-Meteo Forecast API", "Open-Meteo", "https://open-meteo.com/", "The coming week’s temperature, rain, dew point and wind that the heat, rain and fire-weather forecasts start from.", model = true),
            TrustSource(null, "NASA POWER", "NASA POWER", "https://power.larc.nasa.gov/", "Each place’s 30-year record (1996 to 2025) a forecast is judged against, and the measured days it is graded on.", model = true),
        ),
        TrustGroup.PLACE to listOf(
            TrustSource(null, "OpenStreetMap Nominatim", "OpenStreetMap", "https://nominatim.openstreetmap.org/", "Finds the place you type, so nearby reports can be measured from it."),
        ),
        TrustGroup.LEDGER to listOf(
            TrustSource(null, "The live feed, as recorded", "Recorded live feed", "/resources", "What GDACS, USGS, EMSC, NASA EONET, NOAA and ReliefWeb reported, kept with each run so every forecast can be checked against what happened."),
            TrustSource(null, "NASA POWER", "NASA POWER", "https://power.larc.nasa.gov/", "The measured weather each weather forecast is graded against."),
            TrustSource(null, "Open-Meteo Previous Runs API", "Open-Meteo", "https://open-meteo.com/en/docs/previous-runs-api", "Forecasts really issued 3 and 5 days ahead, used to test the method on the past."),
        ),
    )

    /** "IMD and NDMA in India, NWS and USGS in the US, GDACS worldwide". */
    const val AGENCY_LINE = "For real alerts, follow your national agency: IMD and NDMA in India, NWS and USGS in the US, GDACS worldwide."
    const val FOLLOW = "For real alerts, follow your national agency:"

    /** "Data sources: GDACS, USGS, …": the names only. One organisation can supply two datasets, so a count never matched them. */
    fun sourcesSummary(groups: Set<TrustGroup>): String =
        "Data sources: " + TrustGroup.entries.filter { it in groups }.flatMap { SOURCES.getValue(it) }.map { it.short }.distinct().joinToString(", ")

    /** trust.js `when()`: the screen's own `fmtDate`, so the note and the screen write one moment in one zone (changelog C9). */
    fun whenText(iso: String?): String = if (com.anchittandon.pnd.model.JsDate.parse(iso) == null) "" else Format.fmtDate(iso)

    fun whenLine(groups: Set<TrustGroup>, feed: FeedState, ledgerTime: String?, ledgerFailed: Boolean): String {
        val bits = mutableListOf<String>()
        val f = feed.feed
        if (TrustGroup.FEED in groups) {
            bits += when {
                f != null -> "Live data from the agencies " + whenText(f.generatedAt) +
                    (if (f.meta.json.str("live") == "false") " (they were not answering, so saved copies are shown)" else "") +
                    (if (feed.savedCopy) " (a saved copy on this device; the newest data has not loaded)" else "")
                feed.failed -> "The live data did not load, so no update time can be shown"
                else -> "Live data: loading…"
            }
        }
        if (TrustGroup.MODELS in groups && f != null) {
            f.meta.modelRun?.let { mr -> if (mr.truthy("at")) bits += "weather models run " + whenText(mr.str("at")) + (if (mr.truthy("served")) "" else " (over 36 hours ago, so their forecasts are not shown)") }
        }
        if (TrustGroup.LEDGER in groups) {
            bits += when {
                ledgerTime != null -> "Track record last recorded " + whenText(ledgerTime)
                ledgerFailed -> "The track record did not load, so no update time can be shown"
                else -> "Track record: loading…"
            }
        }
        return bits.joinToString(" · ")
    }
}

/** The trust note, on every screen that shows a forecast or a risk level (features.md §15.1). */
@Composable
fun TrustNote(groups: Set<TrustGroup>, ledgerTime: String? = null, ledgerFailed: Boolean = false) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var open by rememberSaveable { mutableStateOf(false) }
    val sources = TrustGroup.entries.filter { it in groups }.flatMap { TrustCopy.SOURCES.getValue(it) }
    Column(
        Modifier.fillMaxWidth().padding(bottom = 12.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.trustFill)
            .border(1.dp, Pnd.provBorder, RoundedCornerShape(10.dp)).testTag("trustNote"),
    ) {
        Row {
            Box(Modifier.width(3.dp).heightIn(min = 40.dp).background(Pnd.amber))
            Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    // The circle grows with the font size, so the "i" inside it is never clipped at 200%.
                    val fs = androidx.compose.ui.platform.LocalDensity.current.fontScale.coerceAtLeast(1f)
                    Box(Modifier.size(18.dp * fs).border(1.5.dp, Pnd.amber, CircleShape).testTag("trustIcon"), contentAlignment = Alignment.Center) {
                        Text("i", color = Pnd.amber, fontSize = 12.sp, lineHeight = 12.sp, fontStyle = FontStyle.Italic, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false)
                    }
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(TrustCopy.WARN, color = Pnd.trustText, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                        Text(TrustCopy.FOLLOW, color = Pnd.trustText, style = MaterialTheme.typography.bodySmall)
                        Text(agencyLine { env.container.platform.openUrl(it) }, color = Pnd.trustText, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("agencyLine"))
                    }
                }
                Text(TrustCopy.whenLine(groups, feed, ledgerTime, ledgerFailed), color = Pnd.trustWhen, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.testTag("trustWhen"))
                Text(
                    (if (open) "▾ " else "▸ ") + TrustCopy.sourcesSummary(groups),
                    color = Pnd.greenText, fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { open = !open }.padding(vertical = 12.dp)
                        .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
                )
                if (open) {
                    val meta = feed.feed?.meta
                    sources.forEach { s ->
                        Column(Modifier.padding(start = 8.dp, bottom = 4.dp)) {
                            Text(s.name, color = Pnd.link, fontSize = 13.sp, modifier = Modifier.heightIn(min = 48.dp).clickable { if (s.url.startsWith("/")) env.navigate(s.url) else env.container.platform.openUrl(s.url) }.padding(vertical = 12.dp))
                            val src = s.key?.let { meta?.sources?.get(it) }
                            if (s.key != null && src != null) {
                                val scan = meta!!.scanProviders.firstOrNull { it.str("provider") == s.key }
                                Row {
                                    Text(if (src.truthy("ok")) "answered" else "not answering", color = if (src.truthy("ok")) Pnd.green else Pnd.amber, fontSize = 12.sp)
                                    scan?.str("dataFreshness")?.let { Text(" · newest record " + TrustCopy.whenText(it), color = Pnd.trustWhen, fontSize = 12.sp) }
                                }
                            } else if (s.model && meta?.modelRun?.truthy("at") == true) {
                                Text("used in the run of " + TrustCopy.whenText(meta.modelRun!!.str("at")), color = Pnd.trustWhen, fontSize = 12.sp)
                            }
                            Text(s.adds, color = Color(0xFFC4D8CF), fontSize = 12.sp)
                        }
                    }
                    FlowRow {
                        Text("What each source can and cannot see: ", color = Pnd.trustWhen, fontSize = 12.sp, modifier = Modifier.padding(vertical = 14.dp))
                        AgencyLink("Our sources", "Our sources") { env.navigate("/resources") }
                        Text(" · ", color = Pnd.trustWhen, modifier = Modifier.padding(vertical = 14.dp))
                        AgencyLink("How it works", "How it works") { env.navigate("/methodology") }
                    }
                }
            }
        }
    }
}

/** "IMD and NDMA in India, NWS and USGS in the US, GDACS worldwide.", each agency a link named in full for TalkBack. */
fun agencyLine(open: (String) -> Unit): androidx.compose.ui.text.AnnotatedString = androidx.compose.ui.text.buildAnnotatedString {
    TrustCopy.OFFICIAL.forEachIndexed { i, (region, ags) ->
        ags.forEachIndexed { j, a ->
            withLink(androidx.compose.ui.text.LinkAnnotation.Clickable(a.full, androidx.compose.ui.text.TextLinkStyles(androidx.compose.ui.text.SpanStyle(color = Pnd.link, fontWeight = FontWeight.SemiBold))) { open(a.url) }) { append(a.name) }
            if (j < ags.size - 1) append(" and ")
        }
        append(if (region == "Worldwide") " worldwide." else " in " + (if (region == "United States") "the US" else region) + if (i < 2) ", " else "")
    }
}

@Composable
private fun AgencyLink(text: String, full: String, onClick: () -> Unit) {
    Text(text, color = Pnd.link, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Open $full") { onClick() }.padding(vertical = 14.dp, horizontal = 2.dp)
            .semantics { contentDescription = full })
}

/** The footer agencies (features.md §15.2), at the bottom of long screens and on More. */
@Composable
fun FooterAgencies() {
    val env = LocalApp.current
    Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(10.dp)).background(Pnd.footer).border(1.dp, Pnd.tabBorder, RoundedCornerShape(10.dp)).padding(16.dp).testTag("footerAgencies")) {
        Text("This is an experimental model, not an official warning service.", color = Color(0xFFE6F2EC), fontWeight = FontWeight.Bold, fontSize = 13.sp)
        Text("For real alerts and what to do in an emergency, follow your national meteorological or disaster agency:", color = Color(0xFFC4D8CF), fontSize = 13.sp)
        TrustCopy.OFFICIAL.forEach { (region, ags) ->
            Text("$region:", color = Color(0xFFE6F2EC), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
            ags.forEach { a ->
                Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { env.container.platform.openUrl(a.url) }.padding(vertical = 4.dp)) {
                    Text("${a.full} (${a.name})", color = Pnd.greenText, fontSize = 13.sp)
                    Text(a.url.removePrefix("https://").removeSuffix("/"), color = Pnd.trustWhen, fontSize = 12.sp)
                }
            }
        }
        Text("Elsewhere:", color = Color(0xFFE6F2EC), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
        Text("find your country’s national weather service", color = Pnd.greenText, fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { env.container.platform.openUrl(TrustCopy.WMO_URL) }
                .padding(vertical = 12.dp).semantics { contentDescription = "Find your country’s national weather service, from the " + TrustCopy.WMO_FULL })
    }
}
