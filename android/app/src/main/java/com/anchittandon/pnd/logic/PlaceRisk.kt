package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.jsRoundL
import com.anchittandon.pnd.model.str
import kotlinx.serialization.json.JsonObject

/** place-risk.js (logic.md §3.4). */
object PlaceRisk {
    const val NEAR_KM = 50.0
    const val MODERATE_KM = 150.0
    const val AUTHORITY_LINE = "Follow instructions from the issuing authority and local emergency services. Nothing on this page replaces official instructions."

    data class Row(val e: JsonObject, val r: RiskRow, val d: Double)

    data class Assessment(
        val place: JsonObject,
        val rows: List<Row>,
        val level: Level?,
        val lead: Row?,
        val headline: String,
        val why: String,
        val checkedAt: String?,
        val searchedKm: Int = 500,
    )

    data class Actions(val steps: List<String>, val authority: String, val official: Boolean)

    private val BAND_ORDER = mapOf("A" to 0, "B" to 1, "C" to 2, "D" to 3, "E" to 4)

    fun rowsFor(place: JsonObject?, events: List<JsonObject>): List<Row> {
        if (place == null) return emptyList()
        val out = events.mapNotNull { e -> Hazards.riskRow(e, place)?.let { r -> Row(e, r, r.distanceKm ?: Double.POSITIVE_INFINITY) } }
        return out.sortedWith { p, q ->
            val b = BAND_ORDER.getValue(p.r.band) - BAND_ORDER.getValue(q.r.band)
            if (b != 0) b else p.d.compareTo(q.d).let { c -> if (p.d.isInfinite() && q.d.isInfinite()) 0 else c }
        }
    }

    fun ownLevel(e: JsonObject?): Level? {
        if (e == null) return null
        val s = RiskScale.levelOf(e.str("severity") ?: "")
        val k = if (s != Level.UNKNOWN) s else RiskScale.levelOf(e.str("alert") ?: "")
        return if (k == Level.UNKNOWN) null else k
    }

    private fun rankOf(k: Level?): Int = k?.rank ?: 0

    fun nearLevel(e: JsonObject?, km: Double): Level {
        val own = ownLevel(e); val r = rankOf(own)
        if (km <= NEAR_KM) return if (r >= Level.MODERATE.rank) own!! else Level.WATCH
        if (km <= MODERATE_KM) return if (r >= Level.HIGH.rank) own!! else if (r >= Level.MODERATE.rank) Level.WATCH else Level.LOW
        return if (r >= Level.HIGH.rank) Level.WATCH else Level.LOW
    }

    private fun atLeast(a: Level?, b: Level?): Level? {
        if (a == null) return b
        if (b == null) return a
        return if (a.rank >= b.rank) a else b
    }

    fun assess(place: JsonObject, events: List<JsonObject>, generatedAt: String?): Assessment {
        val rows = rowsFor(place, events)
        val searched = Hazards.RISK_RADIUS_KM.toInt()
        val insideWarning = rows.firstOrNull { it.r.band == "B" && it.r.containment == true }
        val insideIncident = rows.firstOrNull { it.r.band == "A" && it.r.containment == true }
        val ranked = rows.filter { it.r.band == "A" && it.r.claimDistance && it.d.isFinite() }
            .map { it to nearLevel(it.e, it.d) }
            .sortedWith { p, q -> (q.second.rank - p.second.rank).takeIf { it != 0 } ?: p.first.d.compareTo(q.first.d) }
        val top = ranked.firstOrNull()
        val nearest = top?.first
        val outlook = rows.firstOrNull { it.r.band == "C" }
        var lead: Row? = null
        var level: Level? = null
        var why = ""
        if (insideWarning != null) {
            lead = insideWarning
            level = atLeast(Level.HIGH, ownLevel(insideWarning.e))
            why = "Your place is inside the area covered by an official warning. We checked this against the warning area the agency published, not just the distance."
        } else if (insideIncident != null) {
            lead = insideIncident
            level = atLeast(Level.MODERATE, ownLevel(insideIncident.e))
            why = "Your place is inside the area reported as affected by this event."
        } else if (top != null && top.first.d <= MODERATE_KM && top.second.rank > Level.LOW.rank) {
            lead = nearest
            level = top.second
            why = "An event was reported ${jsRoundL(nearest!!.d)} km from your place. That is the distance between two points. It does not mean the affected area reaches you."
        } else if (outlook != null) {
            lead = outlook
            level = Level.WATCH
            why = "One of our forecasts covers your place. It is our own estimate of what may happen. It is not a report that something has happened, and it is not an official warning."
        } else if (top != null) {
            lead = nearest
            level = top.second
            why = if (nearest!!.d <= MODERATE_KM) "A minor event was reported ${jsRoundL(nearest.d)} km from your place."
            else "The most serious event near your place is ${jsRoundL(nearest.d)} km away. We look up to $searched km away, so it is shown, but it is far from this place."
        }
        var headline = "Nothing reported nearby"
        if (level != null) headline = level.label
        if (level == null) {
            val areaOnly = rows.count { it.r.band == "D" }
            why = "Nothing we track shows a danger at this place right now. " +
                (if (areaOnly > 0) (if (areaOnly == 1) "1 report" else "$areaOnly reports") + " within $searched km give only the centre of a wider area, so we cannot tell whether this place is inside " +
                    (if (areaOnly == 1) "it" else "them") + ". "
                else "No event with an exact location has been reported within $searched km. ") +
                "This does not mean the place is safe. Your national and local disaster agencies have the official information."
        }
        return Assessment(place, rows, level, lead, headline, why, generatedAt, searched)
    }

    fun actionsFor(a: Assessment): Actions {
        val steps = mutableListOf<String>()
        val lead = a.lead?.e
        val official = lead?.str("evidenceState") == "official-warning"
        if (a.level == null) {
            steps += "You do not need to do anything because of this page right now."
            steps += "For official information about this place, check your national or local disaster agency."
            steps += "Save the place so it is checked again each time you open this site."
            return Actions(steps, AUTHORITY_LINE, false)
        }
        steps += when {
            official -> "An official warning covers this place. Read the warning (linked below) and follow it."
            a.level == Level.WATCH && a.lead?.r?.band == "C" -> "Nothing has happened yet. This is only our forecast, so check your official weather or disaster service before you act."
            else -> "Check whether your local authorities have given instructions for this place. This page shows what agencies publish. It does not receive local orders."
        }
        if (a.level == Level.HIGH || a.level == Level.SEVERE || a.level == Level.EXTREME) {
            steps += "Do not travel into the affected area. Follow any evacuation or shelter instructions given locally."
            steps += "Keep following the official agency’s updates. Their instructions are the most current. This page is only as current as the last update shown."
        } else {
            steps += "Keep an eye on the source (linked below) and on your local agency, not only on this summary."
        }
        return Actions(steps, AUTHORITY_LINE, official)
    }

    /** My places summary chip (`personal-risk.html summarise`). */
    fun summarise(a: Assessment): String {
        if (a.level == null) return "NOTHING REPORTED NEARBY"
        val head = a.headline.uppercase()
        val l = a.lead ?: return head
        return head + when {
            l.r.band == "B" -> " · inside an official warning area"
            l.r.band == "A" && l.r.containment == true -> " · inside a reported affected area"
            l.r.band == "C" -> " · a forecast covers it"
            l.d.isFinite() -> " · event ${jsRoundL(l.d)} km away"
            else -> ""
        }
    }
}
