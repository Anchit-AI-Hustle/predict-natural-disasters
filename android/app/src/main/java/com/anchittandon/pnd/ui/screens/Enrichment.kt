@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.data.EnrichmentRepository
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.num
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.strings
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.toFixed
import com.anchittandon.pnd.model.truthy
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.components.*
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject

/** The ten panels of event-enrichment.js, in order (features.md §7.5). */
private val PANELS = listOf(
    Triple("whenWhere", "When and where it happened", "Where it started, the nearest place and the areas affected"),
    Triple("distress", "Who may need help, and how to stay safe", "General guidance for this type of disaster, not confirmed reports about people"),
    Triple("news", "News reports", ""),
    Triple("reports", "Official situation reports", "From ReliefWeb (UN OCHA)"),
    Triple("videos", "Videos", ""),
    Triple("helplines", "Emergency phone numbers", "Only numbers published by national authorities"),
    Triple("authorities", "Official agencies and contacts", ""),
    Triple("support", "Local and national support groups", ""),
    Triple("relief", "Relief organisations and donations", "Links to official organisation websites only"),
    Triple("directories", "Directories, and where this information comes from", ""),
)

fun enrichmentUrl(e: JsonObject): String = Api.enrichment(e.text("title"), e.text("country"), e.text("region"), e.text("type"), e.text("updated"),
    e.truthy("forecast"), e.num("lat"), e.num("lon"))

/** Adds the enrichment panels to a screen's list; re-requests every 5 minutes. */
fun LazyListScope.enrichmentBlock(e: JsonObject?) {
    if (e == null) return
    item(key = "enrichment") { EnrichmentPanels(e) }
}

@Composable
fun EnrichmentPanels(e: JsonObject) {
    val env = LocalApp.current
    val url = remember(e) { enrichmentUrl(e) }
    var result by remember(url) { mutableStateOf<EnrichmentRepository.Result>(EnrichmentRepository.Result.Loading) }
    LaunchedEffect(url) {
        while (true) {
            result = env.container.enrichment.load(url, force = result is EnrichmentRepository.Result.Ok)
            delay(300_000)
        }
    }
    androidx.compose.foundation.layout.Column(Modifier.testTag("enrichment")) {
        when (val r = result) {
            is EnrichmentRepository.Result.Loading -> PANELS.forEach { (_, h, note) -> Panel(h, subtitle = note.ifEmpty { "Loading…" }) { Muted("Loading…") } }
            is EnrichmentRepository.Result.Failed -> PANELS.forEach { (_, h, _) ->
                Panel(h, subtitle = "Trying again") {
                    Text("This information is not available right now", color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted("Our help-information service did not respond. The rest of this page is still live. This section will try again by itself.")
                }
            }
            is EnrichmentRepository.Result.Ok -> Rendered(r.data, e)
        }
    }
}

@Composable
private fun Rendered(d: JsonObject, e: JsonObject) {
    val env = LocalApp.current
    val open = { u: String -> env.container.platform.openUrl(Api.absolute(u)) }
    val w = d.obj("where"); val wh = d.obj("when"); val place = w.obj("resolvedPlace")
    // 1. When and where
    Panel(PANELS[0].second, subtitle = "Updated " + Format.fmtDate(d.str("generatedAt"))) {
        val rows = mutableListOf<Pair<String, String>>()
        val rep = wh.text("reportedAt").ifEmpty { e.text("updated") }
        rows += "When it was reported" to (Format.fmtDate(rep.ifEmpty { null }) + (if (rep.isNotEmpty()) " · " + Format.age(rep) else ""))
        if (e.truthy("startedAt")) rows += "When it started" to Format.fmtDate(e.str("startedAt"))
        if (e.truthy("forecast") && e.truthy("targetStart")) rows += "Forecast period" to Format.windowText(e)
        if (e.truthy("expiresAt")) rows += "Official warning ends" to Format.fmtDate(e.str("expiresAt"))
        rows += "Where it started" to w.text("originArea").ifEmpty { e.text("region").ifEmpty { e.text("country").ifEmpty { "Not given by the source" } } }
        if (place != null) {
            rows += "Nearest place" to (listOf("locality", "city", "state", "country").map { place.text(it) }.filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "-" } +
                "\nWorked out from the map position the source gave · " + place.text("resolvedBy").ifEmpty { "map lookup" })
            if (place.truthy("continent")) rows += "Continent" to place.text("continent")
        }
        rows += "Areas affected" to w.text("affectedAreaText").ifEmpty { "-" }
        KvList(rows)
        w.obj("coordinates")?.let { c ->
            KvList(listOf("Coordinates" to toFixed(c.jsNum("lat"), 4) + ", " + toFixed(c.jsNum("lon"), 4)))
            val m = w.obj("mapLinks")
            Toolbar {
                m?.str("openStreetMap")?.let { u -> LinkButton("OpenStreetMap ↗") { open(u) } }
                m?.str("googleMaps")?.let { u -> LinkButton("Google Maps ↗") { open(u) } }
                m?.str("windy")?.let { u -> LinkButton("Weather map ↗") { open(u) } }
            }
        }
        KvList(listOf("Type" to e.text("type").ifEmpty { "-" }, "Source" to e.text("source").ifEmpty { "-" }))
        if (e.truthy("sourceUrl")) LinkButton("Open the original report ↗") { open(e.text("sourceUrl")) }
        KvList(listOf("About these times" to wh.text("note")))
    }
    // 2. Who may need help
    Panel(PANELS[1].second, subtitle = "${d.arr("distressGroups")?.size ?: 0} groups · ${d.arr("immediateNeeds")?.size ?: 0} needs") {
        listOf("Who may need help first" to "distressGroups", "Immediate needs" to "immediateNeeds", "Other dangers to watch for" to "secondaryRisks", "How to stay safe" to "safetyActions").forEach { (t, k) ->
            CardBox {
                Text(t, color = Pnd.text, fontWeight = FontWeight.Bold)
                val items = d.arr(k).strings()
                if (items.isEmpty()) Muted("Not available for this event.") else items.forEach { Text("• $it", color = Color(0xFFCFE7DD), fontSize = 13.sp) }
            }
        }
    }
    // 3, 4. News and situation reports
    val news = d.arr("news").objects()
    Panel(PANELS[2].second, subtitle = "${news.size} report" + (if (news.size == 1) "" else "s") + " · only from established newsrooms and official agencies") {
        if (news.isEmpty()) SearchCard("No news reports found yet", "News searches can be slow to pick up a new event. Try the directories below. This section refreshes by itself.", "Search news ↗", d.obj("searches")?.str("googleNews"), open)
        news.forEach { NewsCard(it, open) }
    }
    val reps = d.arr("situationReports").objects()
    Panel(PANELS[3].second, subtitle = "${reps.size} official report" + if (reps.size == 1) "" else "s") {
        if (reps.isEmpty()) SearchCard("No matching ReliefWeb report yet", "Situation reports come out once aid groups organise a response, so there may be none in the first hours of an event.", "Search ReliefWeb ↗", d.obj("searches")?.str("reliefweb"), open)
        reps.forEach { NewsCard(it, open) }
    }
    // 5. Videos
    val vids = d.arr("videos").objects()
    Panel(PANELS[4].second, subtitle = "${vids.size} video" + if (vids.size == 1) "" else "s") {
        if (vids.isEmpty()) SearchCard("No videos found", "Video search may be down, or it has not picked up this event yet.", "Search for videos ↗", d.obj("searches")?.str("youtube"), open)
        vids.forEach { v ->
            CardBox(onClick = { open(v.text("url")) }, label = "Watch ${v.text("title")}") {
                Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)).background(Color(0xFF062018)).semantics { contentDescription = "Video thumbnail" })
                Text(v.text("title"), color = Pnd.text, fontWeight = FontWeight.Bold)
                Text("Watch ↗", color = Pnd.link, fontWeight = FontWeight.Bold)
            }
        }
    }
    // 6. Emergency numbers
    val h = d.obj("helplines")
    val nums = h.arr("emergency").objects()
    val emails = d.arr("authorities").objects().filter { it.truthy("email") }.map { it to false } + d.arr("reliefGroups").objects().filter { it.truthy("email") }.map { it to true }
    Panel(PANELS[5].second, subtitle = (if (h.truthy("country")) h.text("country") + " · " else "") + "${nums.size} verified number" + (if (nums.size == 1) "" else "s") +
        " · ${emails.size} published email contact" + if (emails.size == 1) "" else "s") {
        if (nums.isEmpty()) CardBox {
            Text("We have no verified national emergency number for this place", color = Pnd.text, fontWeight = FontWeight.Bold)
            Muted("We never guess a number. Use the official agency links in the next section, or call your local emergency service.")
        }
        nums.forEach { x ->
            val phone = x.text("phone")
            CardBox(onClick = { env.container.platform.dial(phone.replace(Regex("[^+0-9]"), "")) }, label = "Call ${x.text("label")} on $phone") {
                Text(x.text("label").ifEmpty { "Emergency contact" }, color = Pnd.text, fontWeight = FontWeight.Bold)
                Text(phone, color = Pnd.greenText, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                if (x.truthy("note")) Muted(x.text("note"))
                Muted(h.text("country"))
            }
        }
        emails.forEach { (a, relief) ->
            CardBox {
                Text(a.text("name") + if (relief) " (email and phone)" else " (email)", color = Pnd.text, fontWeight = FontWeight.Bold)
                LinkButton(a.text("email")) { open("mailto:" + a.text("email")) }
                if (relief && a.truthy("phone")) LinkButton(a.text("phone")) { env.container.platform.dial(a.text("phone").replace(Regex("[^+0-9]"), "")) }
                if (a.truthy("contactUrl")) LinkButton("Official contact page ↗") { open(a.text("contactUrl")) }
            }
        }
        CardBox { Text("Where these contacts come from", color = Pnd.text, fontWeight = FontWeight.Bold); Muted(h.text("note")) }
    }
    // 7. Agencies
    val auth = d.arr("authorities").objects()
    Panel(PANELS[6].second, subtitle = "${auth.size} agenc" + if (auth.size == 1) "y" else "ies") {
        if (auth.isEmpty()) CardBox { Text("We do not have a national agency listed for this country yet", color = Pnd.text, fontWeight = FontWeight.Bold); Muted("Use the directories below to find the right national agency.") }
        auth.forEach { a ->
            CardBox {
                Text(a.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold)
                Muted("Official national agency for warnings, advice and emergency response.")
                Toolbar {
                    SecondaryButton("Open the official website ↗") { open(a.text("url")) }
                    if (a.truthy("contactUrl")) LinkButton("Contact ↗") { open(a.text("contactUrl")) }
                }
            }
        }
    }
    // 8. Support groups
    val sup = d.arr("supportGroups").objects()
    Panel(PANELS[7].second, subtitle = "${sup.size} support group" + if (sup.size == 1) "" else "s") {
        if (sup.isEmpty()) CardBox {
            Text("We do not have a national support group listed yet", color = Pnd.text, fontWeight = FontWeight.Bold)
            Muted("The IFRC directory below lists the Red Cross or Red Crescent society for every country.")
            SecondaryButton("Find your national Red Cross or Red Crescent ↗") { open("https://www.ifrc.org/national-societies-directory") }
        }
        sup.forEach { s ->
            CardBox {
                Text(s.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold)
                Muted("National relief and support organisation.")
                Toolbar {
                    if (s.truthy("donate")) SecondaryButton("Donate ↗") { open(s.text("donate")) }
                    LinkButton("Website ↗") { open(s.text("url")) }
                }
            }
        }
    }
    // 9. Relief and donations (always empty for forecasts)
    val rel = d.arr("reliefGroups").objects()
    Panel(PANELS[8].second, subtitle = "${rel.size} organisation" + (if (rel.size == 1) "" else "s") + " with donation pages") {
        if (rel.isEmpty()) CardBox(Modifier.testTag("donationsHeldBack")) { Text("Donation links held back", color = Pnd.text, fontWeight = FontWeight.Bold); Muted(d.text("donationPolicy")) }
        else {
            rel.forEach { x ->
                CardBox {
                    Text(x.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold)
                    Muted(x.text("kind").ifEmpty { "Humanitarian support" })
                    Toolbar {
                        SecondaryButton("Official donation page ↗") { open(x.text("donate").ifEmpty { x.text("url") }) }
                        LinkButton("Emergency page ↗") { open(x.text("url")) }
                    }
                }
            }
            CardBox { Text("About donations", color = Pnd.text, fontWeight = FontWeight.Bold); Muted(d.text("donationPolicy")) }
        }
    }
    // 10. Directories and provenance
    Panel(PANELS[9].second, subtitle = "How often this updates: " + d.obj("coverage")?.text("refreshTarget")?.ifEmpty { null }.let { it ?: "each time the page loads" }) {
        d.arr("directories").objects().forEach { x ->
            CardBox {
                Text(x.text("name"), color = Pnd.text, fontWeight = FontWeight.Bold)
                Muted(x.text("kind"))
                SecondaryButton("Open ↗") { open(x.text("url")) }
            }
        }
        CardBox {
            Text("Where this information comes from", color = Pnd.text, fontWeight = FontWeight.Bold)
            d.arr("sources").objects().forEach { s ->
                val n = s.jsNum("items").let { if (it.isFinite()) it.toLong() else 0L }
                Text("• ${s.text("name")}: ${s.text("role")} · $n item" + (if (n == 1L) "" else "s"), color = Color(0xFFCFE7DD), fontSize = 13.sp)
            }
            Muted(d.text("disclaimer"))
        }
    }
}

@Composable
private fun SearchCard(title: String, body: String, button: String, url: String?, open: (String) -> Unit) = CardBox {
    Text(title, color = Pnd.text, fontWeight = FontWeight.Bold); Muted(body)
    if (!url.isNullOrEmpty()) SecondaryButton(button) { open(url) }
}

@Composable
private fun NewsCard(x: JsonObject, open: (String) -> Unit) = CardBox(onClick = { open(x.text("link")) }, label = "Read more: ${x.text("title")}") {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(4.dp)) {
        Pill(x.text("outlet").ifEmpty { "Source" }, if (x.truthy("established")) Pnd.green else Pnd.provBorder, if (x.truthy("established")) Pnd.greenText else Pnd.sourceText, upper = false)
        if (x.truthy("established")) Pill("Established newsroom", Pnd.green, Pnd.greenText, upper = false)
    }
    Text(x.text("title"), color = Pnd.text, fontWeight = FontWeight.Bold)
    Muted(x.text("summary").take(200))
    Muted((if (x.truthy("publishedAt")) Format.fmtDate(x.text("publishedAt")) else "Publication time not given") + (if (x.truthy("via")) " · via " + x.text("via") else ""))
    Text("Read more ↗", color = Pnd.link, fontWeight = FontWeight.Bold)
}

private val Int.dp get() = androidx.compose.ui.unit.Dp(this.toFloat())
