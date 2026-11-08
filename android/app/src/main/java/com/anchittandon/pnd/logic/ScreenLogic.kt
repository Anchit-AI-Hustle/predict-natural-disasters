package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.bool
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.has
import com.anchittandon.pnd.model.jsNum
import com.anchittandon.pnd.model.jsNumText
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.objects
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.model.text
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonObject
import java.util.Locale

/**
 * Page logic that lives inline in the website's pages (collection.js, region-detail.html,
 * hazard-detail.html, forecast-detail.html, the detail pages, index.html, alerts.html and
 * verification-detail.html), ported as plain functions so the vectors can check them.
 */

/** collection.js `keep`, `scoped` and `countText` (logic.md §6.11, features.md §3.2). */
object Collections {
    fun forecastMode(view: String) = view == "forecast-list" || view == "forecast-calendar"

    fun keep(view: String, e: JsonObject): Boolean = when {
        view == "official-warnings" || view == "alerts-notifications" -> Portal.isOfficialWarning(e)
        // Open forecasts only (changelog C33): an ended one is graded on the track record.
        forecastMode(view) -> e.bool("forecast") == true && Portal.openForecasts(listOf(e)) { it }.size == 1
        // The frozen ND-001 benchmark is a test case, not an event happening now (changelog C45).
        e.str("forecastClass") == "retrospective-benchmark" || e.str("forecastKind") == "frozen-benchmark" -> false
        // Recently ended events: records their own provider stopped updating.
        view == "historical-events" -> e.bool("live") == false && !e.truthy("forecast")
        view == "recent-events" -> e.str("sourceType") == "official"
        else -> true
    }

    /** The region a list is scoped to, or "" for none ("World" means everywhere). */
    fun scope(region: String?): String = (region ?: "").trim().let { if (it.lowercase(Locale.ROOT) == "world") "" else it }

    fun <T> scoped(all: List<T>, view: String, region: String?, json: (T) -> JsonObject): List<T> {
        val k = all.filter { keep(view, json(it)) }
        val r = scope(region)
        return if (r.isEmpty()) k else k.filter { Portal.inPlace(json(it), r) }
    }

    private fun one(n: Int, w: String) = "$n " + if (n == 1) w.removeSuffix("s") else w

    /** The status line's count: of the scoped list, forecasts said apart. */
    fun <T> countText(scoped: List<T>, view: String, noun: String, json: (T) -> JsonObject): String {
        val shown = scoped.size
        if (forecastMode(view)) return one(shown, "open $noun")
        val fc = scoped.count { json(it).truthy("forecast") }
        return if (fc > 0) one(shown - fc, noun) + " · " + one(fc, "forecasts") else one(shown, noun)
    }

    /** "Showing only {region}. Show everywhere →", or null when the list is not scoped. */
    fun scopeNote(region: String?): String? = scope(region).takeIf { it.isNotEmpty() }?.let { "Showing only $it." }
}

/** region-detail.html: the canonical name and `matches()` (features.md §8.2). */
object RegionMatch {
    fun canonical(region: String?): String {
        val r = (region ?: "").ifEmpty { "World" }
        return Continents.continentNamed(r).ifEmpty { r }
    }

    fun matches(e: JsonObject, region: String): Boolean {
        if (region == "World") return true
        val c = Continents.continentNamed(region)
        if (c.isNotEmpty()) return Continents.onContinent(e, c)
        // A country exactly, anything else a whole word in the place fields, never the title (changelog C36).
        return Portal.inPlace(e, region)
    }

    /** Reports with no continent, said on a continent's page. */
    fun <T> atSea(list: List<T>, json: (T) -> JsonObject): Int = Portal.observed(list, json).count { Continents.continentsOf(json(it)).isEmpty() }

    fun coverage(ratio: String, here: Int, continent: String, atSea: Int): String =
        "Sources working now: $ratio. Current events here: $here." + if (continent.isEmpty()) "" else
            " $continent is counted from the countries each report names. $atSea report" + (if (atSea == 1) " is" else "s are") +
                " at sea or name no country, so " + (if (atSea == 1) "it is" else "they are") + " on no continent's page."
}

/** hazard-detail.html `fillHazards` and `here` (features.md §9.2). */
object HazardPage {
    data class Fill(val options: List<String>, val selected: String)

    fun fillHazards(requested: String?, present: List<String>, was: String? = null): Fill {
        val req = Portal.hazardKey(requested)
        val keys = (Hazards.HAZARDS.keys + present.map { Portal.hazardKey(it) } + req).distinct().filter { it.isNotEmpty() }
            .sortedWith { a, b -> Sorts.collator.compare(a, b) }
        val w = was ?: req
        return Fill(keys, if (w in keys) w else req)
    }

    data class Selection<T>(val events: List<T>, val openForecasts: List<T>)

    fun <T> select(all: List<T>, hazard: String, region: String, json: (T) -> JsonObject): Selection<T> {
        val rr = region.trim().lowercase(Locale.ROOT)
        val here = { e: JsonObject -> Portal.sameHazard(e.text("type"), hazard) && (rr.isEmpty() || Portal.inPlace(e, rr)) }
        return Selection(Portal.observed(all, json).filter { here(json(it)) }, Portal.openForecasts(all, json).filter { here(json(it)) })
    }

    fun forecastNote(n: Int, hazard: String, region: Boolean): String =
        "We also have $n open forecast" + (if (n == 1) "" else "s") + " of ${hazard.lowercase(Locale.ROOT)}" + (if (region) " here" else "") +
            ". They are our own estimates, not events."

    fun emptyBody(region: Boolean) = "Our sources have no current report of this hazard" + (if (region) " here" else "") + ". This does not mean there is no danger."
}

/** The status words on event, alert and calamity detail (features.md §7.1 to §7.3, changelog C5). */
object DetailWords {
    /** Official labels follow the evidence (changelog C39): only an agency's warning in force is an official one. */
    fun eventEyebrow(e: JsonObject): String = when {
        e.truthy("forecast") -> "OUR FORECAST, NOT OFFICIAL"
        e.bool("live") == false -> "EVENT NO LONGER UPDATED"
        Portal.isOfficialWarning(e) -> Format.officialWord(e).uppercase(Locale.ROOT)
        else -> "REPORTED EVENT"
    }

    /** Alert detail's eyebrow: the same, else "REPORT FROM AN OFFICIAL AGENCY". */
    fun alertEyebrow(e: JsonObject): String = eventEyebrow(e).let { if (it == "REPORTED EVENT") "REPORT FROM AN OFFICIAL AGENCY" else it }
    fun eventRecordState(e: JsonObject): String = when {
        e.truthy("cached") -> "Saved copy, not live"
        e.truthy("forecast") -> "Forecast in progress"
        e.bool("live") == false -> Format.quietNote(e)
        else -> "Live, as the source last reported it"
    }
    fun calamityStatus(e: JsonObject): String = when {
        e.truthy("cached") -> "A saved copy, shown because the source did not list it this time"
        e.bool("live") == false -> Format.quietNote(e)
        else -> "Live, as the source last reported it"
    }
}

/** forecast-detail.html `gradeOf` and the STATUS factor (logic.md §10.4b, changelog C4). */
object Grades {
    data class Grade(val label: String, val summary: String)

    fun gradeOf(id: String, ledger: JsonObject?, modelVerdicts: JsonObject?): Grade? {
        val v = ledger.arr("verifications").objects().firstOrNull { it.str("id") == id }
        if (v != null) {
            val k = Verdicts.normalise(v.text("status"))
            if (k.isNotEmpty() && k != "PENDING" && k != "UNKNOWN") return Grade(Verdicts.LABELS[k] ?: k, v.text("summary"))
        }
        if (id.startsWith("model-")) {
            val o = modelVerdicts.arr("outlooks").objects().firstOrNull { it.str("id") == id }
            if (o?.str("verdict") == "correct") return Grade(Verdicts.LABELS.getValue("VERIFIED"), "")
            if (o?.str("verdict") == "false alarm") return Grade(Verdicts.LABELS.getValue("FALSE_ALARM"), "")
        }
        return null
    }

    fun status(grade: Grade?, targetEnd: String?, now: Long): String = when {
        grade != null -> "Checked: " + grade.label
        !targetEnd.isNullOrEmpty() && (JsDate.parse(targetEnd)?.let { it < now } == true) -> "Ended, not yet checked"
        else -> "Active"
    }

    fun timingText(grade: Grade, endDay: String?): String =
        "The forecast period ran to ${endDay ?: "its end"} and has been checked. Result: ${grade.label}." + (if (grade.summary.isNotEmpty()) " " + grade.summary else "")
}

/** alerts.html `draw(more)`: 40 cards at a time (changelog C6). */
object AlertsPager {
    const val PAGE = 40

    data class Footer(val note: String, val button: String?)

    fun footer(limit: Int, total: Int): Footer? = when {
        total > limit -> Footer("Showing $limit of $total.", "Show ${minOf(PAGE, total - limit)} more")
        total > PAGE -> Footer("Showing all $total.", null)
        else -> null
    }
}

/** The home map search (index.html `mapSearch` keydown, changelog C12). */
object MapSearch {
    sealed interface Result
    data class Found(val index: Int) : Result
    data class NoMatch(val title: String) : Result

    const val NO_MATCH_META = "Try a country, a city or a type of hazard."

    /** Null for an empty box (Enter does nothing); otherwise the first live record that matches, or the no-match card. */
    fun search(events: List<JsonObject>, raw: String): Result? {
        val q = raw.lowercase(Locale.ROOT).trim()
        if (q.isEmpty()) return null
        val i = events.indexOfFirst { Search.matches(it, q) }
        return if (i >= 0) Found(i) else NoMatch("No live event matches “" + raw.trim() + "”")
    }

    /** live-map.html: the note under the toolbar after a search (changelog C18). */
    fun liveMapNote(q: String, n: Int, located: Int): String? {
        val t = q.trim()
        if (t.isEmpty()) return null
        // Matches the map cannot show (no coordinates) are not said to be on it: the page says nothing matches.
        return if (located == 0) "No event matches “$t”." else "$n event" + (if (n == 1) "" else "s") + " match “$t”. The map shows " + (if (located == 1) "it." else "them.")
    }
}

/** personal-risk.html `chosenAs` (changelog C23): only the reader's own edit clears the country a search found. */
object PlaceForm {
    fun chosenAs(name: String, lat: String, lon: String) = listOf(name, lat, lon).joinToString("|")

    /** Whether a change to the name or coordinates clears the remembered country. */
    fun clearsCountry(hasCountry: Boolean, chosenAs: String, name: String, lat: String, lon: String): Boolean =
        hasCountry && !(chosenAs.isNotEmpty() && chosenAs(name, lat, lon) == chosenAs)
}

/** index.html `render()` (features.md §1.3 and §1.6, changelog C2, C3, C7, C8, C13). */
object HomeModel {
    private val RANK = mapOf("red" to 5, "critical" to 5, "orange" to 4, "high" to 4, "moderate" to 3, "watch" to 2, "green" to 1)
    fun rank(e: JsonObject): Double { val r = e.jsNum("severityRank"); return if (r.isFinite() && r > 0) r else (RANK[e.text("alert").lowercase(Locale.ROOT)] ?: 0).toDouble() }
    fun whenOf(e: JsonObject): Long = JsDate.parse(if (e.truthy("updated")) e.text("updated") else e.text("targetStart")) ?: 0L
    private fun numOf(e: JsonObject, k: String) = e.jsNum(k).let { if (it.isFinite()) it else 0.0 }
    private fun textOf(e: JsonObject, vararg keys: String): String { for (k in keys) if (e.truthy(k)) return e.text(k).lowercase(Locale.ROOT); return "￿" }
    private fun sign(x: Double) = if (x.isNaN()) 0 else if (x < 0) -1 else if (x > 0) 1 else 0
    private infix fun Int.or(next: () -> Int) = if (this != 0) this else next()
    private val newest = Comparator<JsonObject> { a, b -> whenOf(b).compareTo(whenOf(a)) }

    /** The card's own comparators (they differ from `SORT_DEFS`): no `startedAt`, no glossary expansion. */
    val SORTS: Map<String, Comparator<JsonObject>> = linkedMapOf(
        "newest" to newest,
        "severity" to Comparator { a, b -> sign(rank(b) - rank(a)) or { newest.compare(a, b) } },
        "oldest" to Comparator { a, b -> whenOf(a).compareTo(whenOf(b)) },
        "deaths" to Comparator { a, b -> sign(numOf(b, "deaths") - numOf(a, "deaths")) or { newest.compare(a, b) } },
        "affected" to Comparator { a, b -> sign(numOf(b, "affected") - numOf(a, "affected")) or { newest.compare(a, b) } },
        "country" to Comparator { a, b -> Sorts.collator.compare(textOf(a, "place", "country", "region"), textOf(b, "place", "country", "region")) },
        "type" to Comparator { a, b -> Sorts.collator.compare(textOf(a, "type"), textOf(b, "type")) },
        "source" to Comparator { a, b -> Sorts.collator.compare(textOf(a, "source"), textOf(b, "source")) },
        "title" to Comparator { a, b -> Sorts.collator.compare(textOf(a, "title"), textOf(b, "title")) },
    )
    val SORT_KEYS: List<String> = SORTS.keys.toList()

    val ICONS = mapOf("Earthquake" to "⌁", "Wildfire" to "🔥", "Flood" to "●", "Drought" to "⌛", "Tropical Cyclone" to "◉", "Severe Storm" to "◈",
        "Volcano" to "▲", "Landslide" to "△", "Tornado" to "✦", "Extreme Cold" to "❄", "Extreme Heat" to "☀", "Tsunami" to "≈")

    data class Chip(val hazard: String, val icon: String, val text: String, val link: String, val observedOnly: Boolean)

    data class Render(
        val list: List<JsonObject>, val reports: List<JsonObject>,
        val kEvents: String, val kEventsNote: String, val kWarnings: String, val kForecasts: String, val kForecastsNote: String, val kCountries: String,
        val liveEvents: List<JsonObject>, val latestEvents: List<JsonObject>, val officialWarnings: List<JsonObject>, val latestForecasts: List<JsonObject>,
        val hazardStrip: List<Chip>,
    )

    /**
     * The hazard select (index.html `fillHazards`, changelog C38): reports per hazard key, most first; a hazard we only
     * forecast says "(forecasts only)"; "All hazards" has no count.
     */
    fun hazardOptions(events: List<JsonObject>, selected: String?): List<Pair<String, String>> {
        val rep = LinkedHashMap<String, Int>(); val fcs = HashSet<String>()
        events.filter { it.bool("live") != false }.forEach { e ->
            val k = Portal.hazardKey(e.text("type"))
            if (k.isEmpty()) return@forEach
            if (e.truthy("forecast")) fcs += k else rep[k] = (rep[k] ?: 0) + 1
        }
        val keys = (rep.keys + fcs).distinct().sortedWith { a, b -> ((rep[b] ?: 0) - (rep[a] ?: 0)).takeIf { it != 0 } ?: Sorts.collator.compare(a, b) }.toMutableList()
        if (!selected.isNullOrEmpty() && selected !in keys) keys += selected
        return listOf("" to "All hazards") + keys.map { k -> k to "$k (" + (rep[k]?.toString() ?: if (k in fcs) "forecasts only" else "0") + ")" }
    }

    fun render(all: List<JsonObject>, hazardFilter: String, sort: String): Render {
        val events = all.filter { it.bool("live") != false }
        val h = hazardFilter.lowercase(Locale.ROOT)
        val list = events.filter { h.isEmpty() || h == "all" || Portal.sameHazard(it.text("type"), h) }
        val reports = list.filter { !it.truthy("forecast") }
        // The count per level each report resolves to (PND.riskKey), so the parts add up to the total (changelog C38).
        val byLvl = reports.groupingBy { RiskScale.keyFor(it) }.eachCount()
        val levels = (listOf(Level.EXTREME, Level.SEVERE, Level.HIGH, Level.MODERATE, Level.WATCH, Level.LOW, Level.UNKNOWN))
            .filter { (byLvl[it] ?: 0) > 0 }.joinToString(" · ") { "${byLvl[it]} ${it.label.lowercase(Locale.ROOT)}" }
        val note = if (reports.isNotEmpty() && levels.isNotEmpty()) levels else if (h.isEmpty() || h == "all") "From all our sources" else "Matching the hazard you chose"
        val warnAll = Portal.officialWarnings(list) { it }
        val cmp = SORTS[sort] ?: newest
        // In order of when each starts, latest first (changelog C38).
        val fcStart = { e: JsonObject -> JsDate.parse(if (e.truthy("targetStart")) e.text("targetStart") else e.text("updated")) ?: 0L }
        val fc = list.filter { it.truthy("forecast") && !it.truthy("windowClosed") }.sortedWith { a, b -> fcStart(b).compareTo(fcStart(a)) }
        val split = Level.entries.filter { it != Level.UNKNOWN }.reversed().map { lv -> lv.label to fc.count { RiskScale.matchesRiskLevel(it, lv.name) } }.filter { it.second > 0 }
        val byHaz = LinkedHashMap<String, Int>()
        reports.forEach { e -> val k = Portal.hazardKey(e.text("type")); if (k.isNotEmpty()) byHaz[k] = (byHaz[k] ?: 0) + 1 }
        val strip = byHaz.entries.sortedWith { a, b -> (b.value - a.value).takeIf { it != 0 } ?: Sorts.collator.compare(a.key, b.key) }.filter { it.value > 0 }.map { (t, c) ->
            val never = !Hazards.hazardOf(t).forecastable
            Chip(t, ICONS[t] ?: "◆", "$c reported" + if (never) " · reports only, no forecast" else "", "/hazards/" + Format.enc(t), never)
        }
        return Render(list, reports, reports.size.toString(), note, warnAll.size.toString(), fc.size.toString(),
            if (split.isNotEmpty()) split.joinToString(" · ") { "${it.second} ${it.first}" } else "Recorded for grading",
            Format.countryCount(reports).toString(),
            reports.sortedWith(cmp).take(5), reports.sortedWith(newest).take(5), warnAll.sortedWith(SORTS.getValue("severity")).take(5), fc.take(6), strip)
    }

    const val NO_FORECASTS = "No open forecasts right now."
    const val NO_WARNINGS = "No official warning is in force in our sources right now."

    /** The three tables as the page writes them: one text row when a table is empty (the events table has none). */
    fun latestEventRows(r: Render) = r.latestEvents.map { latestEventRow(it) }
    fun warningRows(r: Render) = r.officialWarnings.map { warningRow(it) }.ifEmpty { listOf(listOf(NO_WARNINGS)) }
    fun forecastRows(r: Render) = r.latestForecasts.map { forecastRow(it) }.ifEmpty { listOf(listOf(NO_FORECASTS)) }

    fun latestEventRow(e: JsonObject) = listOf(Format.fmtDate(e.text("updated").ifEmpty { null }), Format.placeOf(e, "-"), e.text("type").ifEmpty { "Event" }, e.text("source"))
    fun warningRow(e: JsonObject): List<String> {
        val end = if (e.truthy("expiresAt")) e.text("expiresAt") else e.text("expectedEnd")
        return listOf(e.text("source").ifEmpty { "Official" }, Format.placeOf(e, "-"), e.text("title"), if (end.isNotEmpty()) Format.fmtDate(end) else "Not stated")
    }
    fun forecastRow(e: JsonObject) = listOf(Format.fmtWhen(if (e.truthy("targetStart")) e.text("targetStart") else e.text("updated").ifEmpty { null }),
        Format.placeOf(e, "-"), e.text("type").ifEmpty { "Outlook" }, RiskScale.tagText(e))
}

/** verification-detail.html (features.md §14, changelog C11). */
object VerificationCheck {
    const val NR = "Not reported by any of our sources"
    const val NF = "Not included. This forecast does not predict casualties."
    private val MATCH = Regex("[Vv]ietnam|[Đđ]à [Nn]ẵng|[Hh]uế|[Qq]uảng|[Qq]uang")

    data class Check(val kVerdict: String, val kEvidence: String, val kTarget: String, val kWindow: String, val rows: List<List<String>>, val evidence: List<JsonObject>)

    /** The Result stat: `LABELS[VERDICTS[row.status]]` with the raw status (no normalise). Null ledger means the request failed. */
    fun verdict(id: String, ledger: JsonObject?, failed: Boolean): String {
        if (failed) return "Not available"
        val row = ledger.arr("verifications").objects().firstOrNull { it.str("id") == id } ?: return "Not checked yet"
        val key = Verdicts.VERDICTS[row.str("status") ?: ""] ?: return "Not checked yet"
        return Verdicts.LABELS[key] ?: "Not checked yet"
    }

    fun matching(events: List<JsonObject>): List<JsonObject> = events.filter { e ->
        MATCH.containsMatchIn(listOf("title", "country", "region", "details").joinToString(" ") { k -> e.el(k)?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else it.toString() } ?: "" })
    }

    private fun dateOf(v: String) = if (JsDate.parse(v) != null) Format.fmtWhen(v).split(",")[0].trim() else ""
    private fun timeOf(v: String) = if (JsDate.parse(v) != null) Format.fmtTime(v) else ""

    fun check(id: String, events: List<JsonObject>, verdict: String, sort: String = "newest"): Check {
        val ev = matching(events)
        val fc = Format.findEvent(events, id) { it }
        val fcStart = fc?.let { if (it.truthy("targetStart")) it.text("targetStart") else if (it.truthy("startedAt")) it.text("startedAt") else it.text("updated") } ?: ""
        val times = ev.mapNotNull { JsDate.parse(it.text("startedAt")) }.sorted()
        val first = times.firstOrNull()?.let { JsDate.iso(it) } ?: ""; val last = times.lastOrNull()?.let { JsDate.iso(it) } ?: ""
        val anyDeaths = ev.any { it.has("deaths") }
        val deaths = if (anyDeaths) ev.sumOf { jsNumber(it["deaths"]).let { d -> if (d.isFinite()) d else 0.0 } } else null
        val places = ev.map { if (it.truthy("country")) it.text("country") else it.text("region") }.filter { it.isNotEmpty() }.distinct()
        val mags = ev.mapNotNull { e -> val t = e.text("title"); (Regex("\\bM\\s*(\\d+(?:\\.\\d+)?)\\b").find(t) ?: Regex("\\bmagnitude\\s+(\\d+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE).find(t))?.groupValues?.get(1)?.toDoubleOrNull() }
        val dur = fc?.let { Format.duration(fcStart, it.text("targetEnd")) } ?: ""
        val area = fc?.let { if (it.truthy("region")) it.text("region") else it.text("country") }.orEmpty()
        val alerts = ev.map { it.text("alert") }.filter { it.isNotEmpty() }.distinct().joinToString(" · ")
        val rows = listOf(
            listOf("Area", area.ifEmpty { "Not stated in the recorded forecast" }, places.joinToString(" · ").ifEmpty { NR }),
            listOf("Start date", dateOf(fcStart).ifEmpty { "Not stated" }, dateOf(first).ifEmpty { NR }),
            listOf("Start time", timeOf(fcStart).ifEmpty { "Not stated" }, timeOf(first).ifEmpty { NR }),
            listOf("Duration", dur.ifEmpty { "Not stated" }, Format.duration(first, last).ifEmpty { if (times.isNotEmpty()) "Still developing" else NR }),
            listOf("How widespread", fc?.text("details")?.ifEmpty { null } ?: "Not measured in the recorded forecast",
                if (ev.isNotEmpty()) "${ev.size} matching report" + (if (ev.size == 1) "" else "s") + " from ${places.size} area" + (if (places.size == 1) "" else "s") else NR),
            listOf("Strength or severity", fc?.text("alert")?.ifEmpty { null } ?: "Not stated",
                if (mags.isNotEmpty()) "Highest magnitude reported: " + jsNumText(mags.max()) else alerts.ifEmpty { NR }),
            listOf("Lives lost", NF, deaths?.let { Format.grouped(it) } ?: NR),
            listOf("Missing people", NF, NR),
        )
        return Check(verdict, ev.size.toString(), dateOf(fcStart).ifEmpty { "Not stated" }, dur.ifEmpty { "Not stated" }, rows, Sorts.sort(ev, sort) { it })
    }
}

/**
 * place-risk.js `feedState`, `PENDING` and `PENDING_STEP` (changelog C26): a place answer before the feed has
 * loaded is "Checking…" or "Live data unavailable", never an all-clear drawn from an empty list.
 */
object PlaceAnswer {
    enum class State { LOADING, FAILED, LOADED }

    /** [loaded]: any feed has loaded here; [failed]: the last try failed. A later failed refresh keeps the answer. */
    fun feedState(loaded: Boolean, failed: Boolean): State = if (loaded) State.LOADED else if (failed) State.FAILED else State.LOADING

    data class Pending(val headline: String, val text: String, val lastChecked: String)

    val PENDING = mapOf(
        State.LOADING to Pending("Checking…", "Checking the latest reports for this place.", "not yet: the data is still loading"),
        State.FAILED to Pending("Live data unavailable", Portal.UNAVAILABLE_BODY, "not yet: the latest data could not be loaded"),
    )
    const val PENDING_STEP = "For official information about this place, check your national or local disaster agency."

    /** What the answer card says, block by block (the `home.placeAnswerStates` vectors read the same blocks). */
    data class View(
        val state: State, val badge: String, val level: Level?, val happeningTitle: String?, val happening: String, val unavailableCard: Boolean,
        val why: String?, val steps: List<String>, val authority: String, val lastChecked: String, val busy: Boolean, val lead: JsonObject?,
    ) {
        /** The "What's happening" block as one line of text. */
        val happeningText: String get() = if (unavailableCard) Portal.UNAVAILABLE_TITLE + " " + happening else listOfNotNull(happeningTitle, happening).joinToString(" ")
    }

    fun view(place: JsonObject, state: State, events: List<JsonObject>, generatedAt: String?): View {
        if (state != State.LOADED) {
            val w = PENDING.getValue(state)
            return View(state, w.headline, null, null, w.text, state == State.FAILED, null, listOf(PENDING_STEP), PlaceRisk.AUTHORITY_LINE, w.lastChecked, state == State.LOADING, null)
        }
        val a = PlaceRisk.assess(place, events, generatedAt)
        val act = PlaceRisk.actionsFor(a)
        val lead = a.lead?.e
        val happening = if (lead != null) {
            val pl = Format.placeOf(lead)
            lead.text("type").ifEmpty { "Hazard" } + (if (pl.isNotEmpty()) " · $pl" else "") + " · " + RiskScale.riskWords(lead) + " · reported " + Format.age(lead.text("updated"))
        } else "None of our sources reports anything at this place right now."
        return View(state, a.level?.label ?: "Nothing reported nearby", a.level, lead?.let { Glossary.expandAlways(Format.titleOf(it)) }, happening, false, a.why,
            act.steps, act.authority, if (generatedAt != null) Format.fmtDate(generatedAt) + " · " + Format.age(generatedAt) else "not yet: the data is still loading", false, lead)
    }
}
