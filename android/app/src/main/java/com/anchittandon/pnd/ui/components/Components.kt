@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Level
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.logic.RiskShape
import com.anchittandon.pnd.logic.Search
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.serialization.json.JsonObject

/* ------------------------------------------------------------------ risk */

fun Level.fill(): Color? = colour?.let { Color(it) }
fun Level.inkColor(): Color = ink?.let { Color(it) } ?: Pnd.muted

/** The level's shape, drawn as a vector so a screen reader never reads a glyph (design.md §3.2). */
fun DrawScope.drawRiskShape(shape: RiskShape, color: Color, s: Size = size, origin: Offset = Offset.Zero, stroke: Float = 1.5f) {
    val w = s.width; val h = s.height
    fun p(vararg pts: Pair<Float, Float>) = Path().apply { pts.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(origin.x + x * w, origin.y + y * h) else lineTo(origin.x + x * w, origin.y + y * h) }; close() }
    val c = Offset(origin.x + w / 2, origin.y + h / 2); val r = minOf(w, h) / 2
    when (shape) {
        RiskShape.CIRCLE -> drawCircle(color, r, c)
        RiskShape.RING -> { drawCircle(color, r * 0.28f, c); drawCircle(color, r * 0.79f, c, style = Stroke(r * 0.42f)) }
        RiskShape.TRIANGLE -> drawPath(p(0.5f to 0f, 1f to 1f, 0f to 1f), color)
        RiskShape.DIAMOND -> drawPath(p(0.5f to 0f, 1f to 0.5f, 0.5f to 1f, 0f to 0.5f), color)
        RiskShape.HEXAGON -> drawPath(p(0.25f to 0f, 0.75f to 0f, 1f to 0.5f, 0.75f to 1f, 0.25f to 1f, 0f to 0.5f), color)
        RiskShape.STAR -> drawPath(p(0.5f to 0f, 0.61f to 0.39f, 1f to 0.5f, 0.61f to 0.61f, 0.5f to 1f, 0.39f to 0.61f, 0f to 0.5f, 0.39f to 0.39f), color)
        RiskShape.HOLLOW -> drawCircle(color, r - stroke / 2, c, style = Stroke(stroke))
    }
}

@Composable
fun RiskGlyph(level: Level, color: Color, size: Dp) {
    Canvas(Modifier.size(size)) { drawRiskShape(level.shape, color) }
}

/** Colour, word and shape, always all three; the accessibility label names the level and its inputs. */
@Composable
fun RiskBadge(level: Level, text: String = level.label, description: String? = null, modifier: Modifier = Modifier) {
    val fill = level.fill()
    val shape = RoundedCornerShape(7.dp)
    val base = if (fill != null) modifier.background(fill, shape) else modifier.border(1.dp, Pnd.provBorder, shape)
    Row(
        base.padding(horizontal = 7.dp, vertical = 3.dp).clearAndSetSemantics { contentDescription = description ?: "$text risk level" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RiskGlyph(level, level.inkColor(), 9.dp)
        Spacer(Modifier.width(5.dp))
        Text(text, color = level.inkColor(), fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, softWrap = false, letterSpacing = 0.3.sp)
    }
}

/** The one badge a record gets (`PND.riskTag`). */
@Composable
fun RecordBadge(e: JsonObject, modifier: Modifier = Modifier) {
    val lv = RiskScale.resolve(e)
    RiskBadge(lv, lv.label, RiskScale.tagTitle(e), modifier)
}

/** Never a LOW badge for nothing found (global rule 3). */
@Composable
fun NothingNearbyChip() = RiskBadge(Level.UNKNOWN, "Nothing reported nearby", "Nothing reported nearby. This does not mean the place is safe.")

/* ----------------------------------------------------------------- pills */

@Composable
fun Pill(text: String, border: Color = Pnd.provBorder, color: Color = Pnd.provText, description: String? = null, upper: Boolean = true) {
    Text(
        if (upper) text.uppercase() else text,
        Modifier.border(1.dp, border, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 3.dp)
            .let { m -> if (description != null) m.semantics { contentDescription = description } else m },
        color = color, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, letterSpacing = 0.4.sp,
    )
}

@Composable
fun SourcePill(e: Event) {
    val full = e.source.ifEmpty { "Source not stated" }
    Pill(Format.shortSource(full), Pnd.provBorder, Pnd.sourceText, "Source: $full", upper = false)
}

@Composable
fun ProvenancePill(text: String) = Pill(text, Color(0xFF39715D), Pnd.text)

/** Track record verdict colours (design.md §1.3). */
fun verdictColors(state: String): Pair<Color, Color> = when (state) {
    "VERIFIED" -> Pnd.okBorder to Pnd.okText
    "PARTIAL" -> Pnd.warnBorder to Pnd.warnText
    "FALSE_ALARM", "UNKNOWN" -> Pnd.badBorder to Pnd.badText
    "MISSED", "NOT_A_PREDICTION" -> Pnd.missedBorder to Pnd.missedText
    "OPEN" -> Pnd.blue to Pnd.text
    "AWAITING" -> Pnd.unknownMarker to Pnd.text
    else -> Pnd.mutedBorder to Pnd.mutedText
}

/* --------------------------------------------------------------- surfaces */

@Composable
fun Panel(title: String? = null, modifier: Modifier = Modifier, subtitle: String? = null, trailing: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(10.dp))
            .background(Brush.verticalGradient(listOf(Pnd.panelTop, Pnd.panelBottom)))
            .border(1.dp, Pnd.panelBorder, RoundedCornerShape(10.dp)),
    ) {
        if (title != null) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(title, style = MaterialTheme.typography.titleSmall, color = Pnd.text, modifier = Modifier.semantics { heading() })
                    trailing?.invoke()
                }
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Pnd.muted, modifier = Modifier.padding(top = 3.dp))
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 1.dp, max = 1.dp).background(Pnd.divider))
        }
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
fun CardBox(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, label: String? = null, accent: Color? = null, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(9.dp)
    var m = modifier.fillMaxWidth().clip(shape).background(Pnd.card).border(1.dp, Pnd.cardBorder, shape)
    if (onClick != null) m = m.clickable(role = Role.Button, onClickLabel = label ?: "Open details") { onClick() }
    Row(m.heightIn(min = 48.dp)) {
        if (accent != null) Box(Modifier.width(4.dp).heightIn(min = 48.dp).background(accent))
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
    }
}

@Composable
fun Eyebrow(text: String, color: Color = Pnd.greenText) =
    Text(text.uppercase(), color = color, style = MaterialTheme.typography.labelSmall, letterSpacing = 1.2.sp)

@Composable
fun Heading(text: String, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.headlineLarge, color = Pnd.text, modifier = modifier.semantics { heading() })

@Composable
fun SubHeading(text: String, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.titleSmall, color = Pnd.text, modifier = modifier.semantics { heading() })

@Composable
fun Body(text: String, color: Color = Pnd.body, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.bodyMedium, color = color, modifier = modifier)

@Composable
fun Muted(text: String, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.bodySmall, color = Pnd.muted, modifier = modifier)

@Composable
fun Label(text: String) = Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Pnd.label)

/** Amber informational box. */
@Composable
fun Notice(text: String, modifier: Modifier = Modifier) = Text(
    text, modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(8.dp)).background(Pnd.noticeFill)
        .border(1.dp, Pnd.noticeBorder, RoundedCornerShape(8.dp)).padding(10.dp),
    color = Pnd.noticeText, style = MaterialTheme.typography.bodySmall,
)

/** Warning box: a quiet record, a load failure. */
@Composable
fun StaleBox(text: String, modifier: Modifier = Modifier, tag: String? = null) = Text(
    text, modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(8.dp)).background(Pnd.staleFill)
        .border(1.dp, Pnd.staleBorder, RoundedCornerShape(8.dp)).padding(10.dp).let { if (tag != null) it.testTag(tag) else it },
    color = Pnd.text, style = MaterialTheme.typography.bodySmall,
)

@Composable
fun EmptyText(text: String) = Text(text, color = Pnd.empty, style = MaterialTheme.typography.bodyMedium)

/** Label above value, for detail lists; stacks on a phone. */
@Composable
fun KvList(rows: List<Pair<String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { (k, v) ->
            Column(Modifier.semantics(mergeDescendants = true) {}) {
                Text(k, color = Color(0xFF89AB9D), style = MaterialTheme.typography.bodySmall)
                Text(v, color = Pnd.body, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** The stat line: number then label (`.statline`). */
@Composable
fun StatLine(items: List<Pair<String, String>>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        items.forEach { (label, value) ->
            Text(buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Pnd.text, fontSize = 17.sp)) { append(value) }
                append(" ")
                withStyle(SpanStyle(color = Pnd.muted, fontSize = 13.sp)) { append(label.lowercase()) }
            }, modifier = Modifier.semantics(mergeDescendants = true) {})
        }
    }
}

/** KPI-style tiles in a wrapping grid. */
@Composable
fun MetricTiles(items: List<Pair<String, String>>, minWidth: Dp = 150.dp) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        items.forEach { (k, v) ->
            Column(
                Modifier.widthIn(min = minWidth).weight(1f).clip(RoundedCornerShape(10.dp)).background(Pnd.metric)
                    .border(1.dp, Pnd.metricBorder, RoundedCornerShape(10.dp)).padding(10.dp).semantics(mergeDescendants = true) {},
            ) {
                Label(k)
                Text(v, color = Pnd.text, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

/** Key facts grid: a missing value says "Not reported", with the note as its hint (logic.md §5.3). */
@Composable
fun KeyFactsGrid(e: JsonObject) {
    val facts = Hazards.keyFacts(e)
    if (facts.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        facts.forEach { f ->
            Column(
                Modifier.widthIn(min = 140.dp).weight(1f).clip(RoundedCornerShape(8.dp)).background(Pnd.cardAlt)
                    .border(1.dp, Pnd.divider, RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 8.dp)
                    .semantics(mergeDescendants = true) { if (!f.reported) contentDescription = f.label + ": Not reported" + (f.note?.let { ". $it" } ?: "") },
            ) {
                Text(f.label.uppercase(), color = Color(0xFF8FB0A2), style = MaterialTheme.typography.labelSmall)
                if (f.reported) Text(f.value ?: "", color = Color(0xFFEAF7F1), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                else Text("Not reported", color = Color(0xFF9FB8AD), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/* ---------------------------------------------------------------- controls */

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) = Button(
    onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = RoundedCornerShape(9.dp),
    colors = ButtonDefaults.buttonColors(containerColor = Pnd.green, contentColor = Pnd.onGreen, disabledContainerColor = Pnd.green.copy(alpha = 0.6f), disabledContentColor = Pnd.onGreen),
) { Text(text, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp) }

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = OutlinedButton(
    onClick, modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(9.dp), border = BorderStroke(1.dp, Color(0xFF2E6B55)),
    colors = ButtonDefaults.outlinedButtonColors(containerColor = Color(0xFF0B3E2E), contentColor = Color(0xFFEAF7F1)),
) { Text(text, fontWeight = FontWeight.Bold, fontSize = 13.sp) }

@Composable
fun OutlinePillButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = OutlinedButton(
    onClick, modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(999.dp), border = BorderStroke(1.dp, Pnd.provBorder),
    colors = ButtonDefaults.outlinedButtonColors(contentColor = Pnd.greenText),
) { Text(text, fontWeight = FontWeight.Bold, fontSize = 12.sp) }

@Composable
fun LinkButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = TextButton(onClick, modifier.heightIn(min = 48.dp)) {
    Text(text, color = Pnd.link, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
}

/** A select (sort, filter): the current label on a button, the options in a menu. */
@Composable
fun Select(label: String, options: List<Pair<String, String>>, selected: String, modifier: Modifier = Modifier, tag: String? = null, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.first == selected }?.second ?: options.firstOrNull()?.second ?: ""
    Box(modifier) {
        OutlinedButton(
            { open = true }, Modifier.heightIn(min = 48.dp).semantics { contentDescription = "$label: $current" }.let { if (tag != null) it.testTag(tag) else it },
            shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Pnd.inputBorder),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = Pnd.input, contentColor = Color(0xFFEEF8F3)),
        ) { Text("$current ▾", fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(open, { open = false }) {
            options.forEach { (v, l) ->
                DropdownMenuItem({ Text(l + if (v == selected) "  ✓" else "") }, { open = false; onSelect(v) }, Modifier.heightIn(min = 48.dp).let { if (tag != null) it.testTag("$tag:$v") else it })
            }
        }
    }
}

@Composable
fun SearchField(value: String, label: String, modifier: Modifier = Modifier, tag: String? = null, imeSearch: (() -> Unit)? = null, onChange: (String) -> Unit) {
    OutlinedTextField(
        value, onChange, modifier.fillMaxWidth().heightIn(min = 52.dp).let { if (tag != null) it.testTag(tag) else it },
        label = { Text(label, fontSize = 13.sp) }, singleLine = true, shape = RoundedCornerShape(8.dp),
        keyboardOptions = KeyboardOptions(imeAction = if (imeSearch != null) ImeAction.Search else ImeAction.Done),
        keyboardActions = KeyboardActions(onSearch = { imeSearch?.invoke() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Pnd.green, unfocusedBorderColor = Pnd.inputBorder, focusedContainerColor = Pnd.input, unfocusedContainerColor = Pnd.input,
            focusedTextColor = Pnd.text, unfocusedTextColor = Pnd.text, focusedLabelColor = Pnd.greenText, unfocusedLabelColor = Pnd.muted, cursorColor = Pnd.green,
        ),
    )
}

@Composable
fun Toolbar(content: @Composable () -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) { content() }
}

/** search.js emptyHtml, with its button to the events list. */
@Composable
fun EmptyCard(state: Search.EmptyState, onSeeEvents: (String) -> Unit) {
    CardBox(Modifier.testTag("empty")) {
        Text(state.title, fontWeight = FontWeight.Bold, color = Pnd.text, style = MaterialTheme.typography.bodyMedium)
        state.body?.let { Muted(it) }
        if (state.buttonLabel != null) SecondaryButton(state.buttonLabel) { onSeeEvents(state.buttonQuery ?: "") }
    }
}

/** The shared record card (features.md §0.4). */
@Composable
fun EventCard(e: Event, onOpen: () -> Unit, extra: String? = null, showSavedCopy: Boolean = false) {
    val j = e.json
    CardBox(Modifier.testTag("card:${e.id}"), onClick = onOpen, label = "Open ${e.displayTitle}") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RecordBadge(j)
            SourcePill(e)
            if (e.forecast) Pill(if (j.str("forecastKind") == "frozen-benchmark") "Test case, not made in advance" else "Our forecast, not official")
            if (e.forecast && e.windowClosed) Pill("Forecast period ended")
            if (showSavedCopy && e.cached) Pill("Saved copy")
        }
        Text(e.displayTitle, style = MaterialTheme.typography.titleSmall, color = Pnd.text, modifier = Modifier.padding(top = 3.dp))
        Text("${e.type} · ${Format.placeOf(j, "Place not given")}", style = MaterialTheme.typography.bodySmall, color = Color(0xFFABC7BB))
        if (extra != null) Text(extra, style = MaterialTheme.typography.bodySmall, color = Pnd.textSoft)
        val facts = Format.keyFactsLine(j, 3)
        if (facts.isNotEmpty()) Text(facts, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = Pnd.body)
        else {
            val s = Format.summary(Format.impactText(j).ifEmpty { e.details })
            if (s.isNotEmpty()) Text(s, style = MaterialTheme.typography.bodySmall, color = Color(0xFFABC7BB))
        }
        val window = if (e.forecast && j["targetEnd"] != null) Format.windowText(j) + " · " else ""
        Muted(window + "Source updated ${Format.fmtDate(e.updated)} · ${Format.age(e.updated)}")
    }
}
