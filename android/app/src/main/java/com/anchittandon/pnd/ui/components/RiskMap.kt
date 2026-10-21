@file:OptIn(ExperimentalLayoutApi::class)

package com.anchittandon.pnd.ui.components

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.logic.Hazards
import com.anchittandon.pnd.logic.Level
import com.anchittandon.pnd.logic.RiskScale
import com.anchittandon.pnd.model.Event
import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.jsNumber
import com.anchittandon.pnd.model.obj
import com.anchittandon.pnd.model.str
import com.anchittandon.pnd.ui.LocalApp
import com.anchittandon.pnd.ui.theme.Pnd
import kotlinx.serialization.json.JsonArray
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.MapTileProviderBasic
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.TilesOverlay

/**
 * Whether to use the real osmdroid map. Robolectric screenshot tests draw the same countries and
 * markers with the Compose fallback instead, because tile threads do not run there.
 */
val LocalLiveMap = staticCompositionLocalOf { true }

/** What the card over the map says: a selected event, or a search that found nothing (index.html `selectEvent`, `mapSearch`). */
sealed interface MapNudge {
    data class Selected(val e: Event) : MapNudge
    data class NoMatch(val title: String) : MapNudge
}

/** Selection and camera requests a screen can make of its map. A refresh never moves the map; only a new request does. */
class MapSelection {
    var nudge by mutableStateOf<MapNudge?>(null)
    /** Fly to this point at zoom max(current, 5); [flySeq] changes with each request. */
    var flyTo by mutableStateOf<Pair<Double, Double>?>(null)
    var flySeq by mutableStateOf(0)
    fun select(e: Event, fly: Boolean) {
        nudge = MapNudge.Selected(e)
        if (fly && e.lat != null && e.lon != null) { flyTo = e.lat!! to e.lon!!; flySeq++ }
    }
}

/** Fit the map to these points (padding 25%, max zoom [maxZoom]) whenever [key] changes. */
data class MapFit(val key: Any?, val points: List<Pair<Double, Double>>, val maxZoom: Double = 6.0)

data class MapCircle(val lat: Double, val lon: Double, val km: Double, val stroke: Color, val fillAlpha: Float)

/** The Esri tiles the website uses (api.md §6). */
private class EsriSource(name: String, path: String) : OnlineTileSourceBase(
    name, 0, 19, 256, "", arrayOf("https://server.arcgisonline.com/ArcGIS/rest/services/$path/MapServer/tile/"),
    "Esri, HERE, Garmin, © OpenStreetMap contributors",
) {
    override fun getTileURLString(index: Long): String =
        baseUrl + MapTileIndex.getZoom(index) + "/" + MapTileIndex.getY(index) + "/" + MapTileIndex.getX(index)
}

/** The ring drawn round the selected marker. */
private fun ringBitmap(ctx: Context): BitmapDrawable {
    val d = ctx.resources.displayMetrics.density
    val side = (34 * d).toInt()
    val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Pnd.green.toArgb(); style = Paint.Style.STROKE; strokeWidth = 3 * d }
    android.graphics.Canvas(bmp).drawCircle(side / 2f, side / 2f, side / 2f - 2 * d, p)
    return BitmapDrawable(ctx.resources, bmp)
}

private fun markerBitmap(ctx: Context, level: Level): BitmapDrawable {
    val d = ctx.resources.displayMetrics.density
    val sizePx = (level.markerSize * d).toInt().coerceAtLeast(8)
    // The mark keeps its size; the bitmap (osmdroid's hit area) is a square of at least 24 dp around it.
    val side = maxOf((level.tapSize * d).toInt(), sizePx + (6 * d).toInt())
    val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(bmp)
    val w = sizePx.toFloat(); val o = (side - sizePx) / 2f
    fun path(vararg pts: Pair<Float, Float>) = android.graphics.Path().apply { pts.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(o + x * w, o + y * w) else lineTo(o + x * w, o + y * w) }; close() }
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = (level.fill() ?: Pnd.unknownMarker).toArgb(); style = Paint.Style.FILL }
    val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 2.5f * d }
    val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF0B1F19.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.5f * d }
    val shape: android.graphics.Path? = when (level.shape) {
        com.anchittandon.pnd.logic.RiskShape.TRIANGLE -> path(0.5f to 0f, 1f to 1f, 0f to 1f)
        com.anchittandon.pnd.logic.RiskShape.DIAMOND -> path(0.5f to 0f, 1f to 0.5f, 0.5f to 1f, 0f to 0.5f)
        com.anchittandon.pnd.logic.RiskShape.HEXAGON -> path(0.25f to 0f, 0.75f to 0f, 1f to 0.5f, 0.75f to 1f, 0.25f to 1f, 0f to 0.5f)
        com.anchittandon.pnd.logic.RiskShape.STAR -> path(0.5f to 0f, 0.61f to 0.39f, 1f to 0.5f, 0.61f to 0.61f, 0.5f to 1f, 0.39f to 0.61f, 0f to 0.5f, 0.39f to 0.39f)
        else -> null
    }
    val cx = o + w / 2; val r = w / 2
    if (shape != null) { c.drawPath(shape, halo); c.drawPath(shape, fill); c.drawPath(shape, outline) }
    else {
        c.drawCircle(cx, cx, r, halo); c.drawCircle(cx, cx, r, fill); c.drawCircle(cx, cx, r, outline)
        if (level == Level.WATCH) c.drawCircle(cx, cx, r * 0.55f, Paint(outline).apply { strokeWidth = 2 * d })
    }
    return BitmapDrawable(ctx.resources, bmp)
}

/**
 * The risk map: Map (dark outlines, the default, so markers stay readable) or Satellite (Esri World
 * Imagery plus the boundaries and places overlay). Markers carry colour, shape and size, higher
 * levels on top. Tapping one selects it; the card below opens it.
 */
@Composable
fun RiskMap(
    events: List<Event>,
    modifier: Modifier = Modifier,
    height: Dp = 300.dp,
    center: Pair<Double, Double>? = null,
    zoom: Double = 1.6,
    circle: MapCircle? = null,
    showKey: Boolean = true,
    selection: MapSelection? = null,
    fit: MapFit? = null,
    onOpen: (Event) -> Unit,
) {
    val env = LocalApp.current
    val live = LocalLiveMap.current
    var layer by remember { mutableStateOf(env.container.settings.mapLayer) }
    var keyOpen by remember { mutableStateOf(false) }
    val sel = selection ?: remember { MapSelection() }
    val located = events.filter { it.lat != null && it.lon != null }.sortedBy { RiskScale.markerLevel(it.json).rank }
    val counts = located.groupingBy { RiskScale.markerLevel(it.json) }.eachCount()
    val summary = "Map of ${located.size} reported events. " +
        Level.entries.reversed().filter { (counts[it] ?: 0) > 0 }.joinToString(", ") { "${counts[it]} ${it.label}" } +
        ". The same records are listed below the map."
    Column(modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Box(Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(10.dp)).border(1.dp, Pnd.line, RoundedCornerShape(10.dp))
            .semantics { contentDescription = summary }.testTag("riskMap")) {
            if (live) {
                OsmMap(located, layer, center, zoom, circle, sel, fit) { sel.select(it, fly = false) }
            } else {
                StaticMap(located, center, zoom, circle, sel, fit)
            }
            Text(if (layer == "satellite") "Esri, HERE, Garmin, © OpenStreetMap contributors" else "Country outlines: Natural Earth (public domain)",
                color = Color(0xFFC7D6CF), fontSize = 10.sp, modifier = Modifier.align(Alignment.BottomStart).background(Color(0xB3020F0B)).padding(horizontal = 4.dp, vertical = 2.dp))
        }
        Toolbar {
            Select("Map layer", listOf("map" to "Map", "satellite" to "Satellite"), layer) { layer = it; env.container.settings.mapLayer = it }
            if (showKey) OutlinePillButton(if (keyOpen) "Hide key" else "Key") { keyOpen = !keyOpen }
        }
        if (keyOpen) MapKey(counts)
        when (val n = sel.nudge) {
            is MapNudge.Selected -> {
                val e = n.e
                Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("mapNudge")) {
                    CardBox {
                        Eyebrow("Selected event on map")
                        Text(e.displayTitle, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Muted(listOf(e.type, Format.placeOf(e.json), e.source).filter { it.isNotEmpty() }.joinToString(" · "))
                        LinkButton("See details →", Modifier.testTag("nudgeDetail")) { onOpen(e) }
                    }
                }
            }
            is MapNudge.NoMatch -> Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("mapNudge")) {
                CardBox {
                    Eyebrow("Search")
                    Text(n.title, color = Pnd.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Muted(com.anchittandon.pnd.logic.MapSearch.NO_MATCH_META)
                }
            }
            null -> {}
        }
    }
}

@Composable
fun MapKey(counts: Map<Level, Int>) {
    FlowRow(
        Modifier.fillMaxWidth().padding(bottom = 8.dp).background(Color(0xEB04120E), RoundedCornerShape(10.dp)).border(1.dp, Color(0xFF1F4A3C), RoundedCornerShape(10.dp)).padding(10.dp).testTag("mapKey"),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        (Level.entries.filter { it != Level.UNKNOWN }.reversed() + Level.UNKNOWN).forEach { lv ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "${lv.label}: ${counts[lv] ?: 0} on the map" }) {
                RiskGlyph(lv, lv.fill() ?: Pnd.unknownMarker, 14.dp)
                Text(" ${lv.label} ", color = Pnd.text, fontSize = 13.sp)
                Text("${counts[lv] ?: 0}", color = Pnd.muted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun OsmMap(events: List<Event>, layer: String, center: Pair<Double, Double>?, zoom: Double, circle: MapCircle?, sel: MapSelection, fit: MapFit?, onSelect: (Event) -> Unit) {
    val env = LocalApp.current
    val ctx = LocalContext.current
    val countries = remember { env.container.countries.features }
    val view = remember {
        Configuration.getInstance().userAgentValue = Api.USER_AGENT
        Configuration.getInstance().osmdroidBasePath = ctx.cacheDir
        Configuration.getInstance().osmdroidTileCache = java.io.File(ctx.cacheDir, "tiles")
        MapView(ctx).apply {
            setMultiTouchControls(true)
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.SHOW_AND_FADEOUT)
            isHorizontalMapRepetitionEnabled = true
            minZoomLevel = 1.0; maxZoomLevel = 18.0
            setTileSource(EsriSource("Esri World Imagery", "World_Imagery"))
        }
    }
    DisposableEffect(view) { view.onResume(); onDispose { view.onPause(); view.onDetach() } }
    // The camera moves only for a new request: the first draw, a new fit key or a new fly-to. A refresh leaves it.
    val camera = remember { arrayOf<Any?>(Unit, null, -1) }
    AndroidView({ view }, Modifier.fillMaxSize(), update = { m ->
        m.overlays.clear()
        val sat = layer == "satellite"
        m.overlayManager.tilesOverlay.isEnabled = sat
        m.setBackgroundColor(Pnd.ocean.toArgb())
        if (sat) {
            val ref = MapTileProviderBasic(ctx, EsriSource("Esri Boundaries and Places", "Reference/World_Boundaries_and_Places"))
            m.overlays.add(TilesOverlay(ref, ctx).apply { loadingBackgroundColor = android.graphics.Color.TRANSPARENT })
        } else {
            m.overlayManager.tilesOverlay.loadingBackgroundColor = Pnd.ocean.toArgb()
            countries.forEach { f ->
                val g = f.obj("geometry") ?: return@forEach
                val polys = when (g.str("type")) { "Polygon" -> listOf(g.arr("coordinates")); "MultiPolygon" -> g.arr("coordinates")?.map { it as? JsonArray } ?: emptyList(); else -> emptyList() }
                polys.forEach { rings ->
                    val outer = (rings?.getOrNull(0) as? JsonArray) ?: return@forEach
                    val p = Polygon(m)
                    p.points = outer.mapNotNull { pt -> (pt as? JsonArray)?.let { GeoPoint(jsNumber(it[1]), jsNumber(it[0])) } }
                    p.fillPaint.color = Pnd.land.toArgb(); p.outlinePaint.color = Pnd.border.toArgb(); p.outlinePaint.strokeWidth = 1f
                    p.setOnClickListener { _, _, _ -> false }
                    m.overlays.add(p)
                }
            }
        }
        circle?.let { c ->
            val p = Polygon(m)
            p.points = Polygon.pointsAsCircle(GeoPoint(c.lat, c.lon), c.km * 1000)
            p.fillPaint.color = c.stroke.copy(alpha = c.fillAlpha).toArgb(); p.outlinePaint.color = c.stroke.toArgb(); p.outlinePaint.strokeWidth = 3f
            p.setOnClickListener { _, _, _ -> false }
            m.overlays.add(p)
        }
        events.take(400).forEach { e ->
            val lv = RiskScale.markerLevel(e.json)
            val mk = Marker(m)
            mk.position = GeoPoint(e.lat!!, e.lon!!)
            mk.icon = markerBitmap(ctx, lv)
            mk.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
            mk.title = RiskScale.markerLabel(e.alert, e.displayTitle)
            mk.setInfoWindow(null)
            mk.setOnMarkerClickListener { _, _ -> onSelect(e); true }
            m.overlays.add(mk)
        }
        val ring = (sel.nudge as? MapNudge.Selected)?.e
        if (ring?.lat != null && ring.lon != null) {
            val mk = Marker(m)
            mk.position = GeoPoint(ring.lat!!, ring.lon!!)
            mk.icon = ringBitmap(ctx)
            mk.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
            mk.setInfoWindow(null)
            mk.setOnMarkerClickListener { _, _ -> false }
            m.overlays.add(mk)
        }
        if (camera[0] == Unit) {
            camera[0] = null
            if (center != null) { m.controller.setZoom(zoom); m.controller.setCenter(GeoPoint(center.first, center.second)) }
            else { m.controller.setZoom(zoom); m.controller.setCenter(GeoPoint(20.0, 20.0)) }
        }
        if (fit != null && fit.key != camera[1]) {
            camera[1] = fit.key
            if (fit.points.isNotEmpty()) {
                val la = fit.points.map { it.first }; val lo = fit.points.map { it.second }
                val padLa = (la.max() - la.min()) * 0.25; val padLo = (lo.max() - lo.min()) * 0.25
                val box = org.osmdroid.util.BoundingBox((la.max() + padLa).coerceAtMost(85.0), (lo.max() + padLo).coerceAtMost(180.0),
                    (la.min() - padLa).coerceAtLeast(-85.0), (lo.min() - padLo).coerceAtLeast(-180.0))
                m.post {
                    m.zoomToBoundingBox(box, false)
                    if (m.zoomLevelDouble > fit.maxZoom) m.controller.setZoom(fit.maxZoom)
                }
            }
        }
        if (sel.flySeq != camera[2]) {
            camera[2] = sel.flySeq
            sel.flyTo?.let { (la, lo) -> m.controller.animateTo(GeoPoint(la, lo), maxOf(m.zoomLevelDouble, 5.0), 550L) }
        }
        m.invalidate()
    })
}

/** The same picture drawn in Compose (equirectangular), for tests and as a fallback. */
@Composable
fun StaticMap(events: List<Event>, center0: Pair<Double, Double>?, zoom0: Double, circle: MapCircle?, sel: MapSelection? = null, fit: MapFit? = null) {
    val env = LocalApp.current
    val countries = remember { env.container.countries.features }
    // The same camera rules as the live map: a fit to the points (max zoom 6), then a fly-to at zoom max(current, 5).
    var center = center0; var zoom = zoom0
    if (fit != null && fit.points.isNotEmpty()) {
        val la = fit.points.map { it.first }; val lo = fit.points.map { it.second }
        center = (la.max() + la.min()) / 2 to (lo.max() + lo.min()) / 2
        val range = maxOf(lo.max() - lo.min(), la.max() - la.min(), 0.01) * 1.5
        zoom = (1.6 + Math.log(360.0 / range) / Math.log(2.0)).coerceIn(1.6, fit.maxZoom)
    }
    sel?.flyTo?.let { center = it; zoom = maxOf(zoom, 5.0) }
    val ring = (sel?.nudge as? MapNudge.Selected)?.e
    Canvas(Modifier.fillMaxSize().background(Pnd.ocean)) {
        val span = 360.0 / Math.pow(2.0, (zoom - 1.6).coerceAtLeast(0.0))
        val cLat = center?.first ?: 15.0; val cLon = center?.second ?: 20.0
        val degW = span; val degH = span * size.height / size.width
        fun xy(lat: Double, lon: Double) = Offset(((lon - cLon) / degW * size.width + size.width / 2).toFloat(), ((cLat - lat) / degH * size.height + size.height / 2).toFloat())
        countries.forEach { f ->
            val g = f.obj("geometry") ?: return@forEach
            val polys = when (g.str("type")) { "Polygon" -> listOf(g.arr("coordinates")); "MultiPolygon" -> g.arr("coordinates")?.map { it as? JsonArray } ?: emptyList(); else -> emptyList() }
            polys.forEach { rings ->
                val outer = (rings?.getOrNull(0) as? JsonArray) ?: return@forEach
                val path = Path()
                outer.forEachIndexed { i, pt -> val a = pt as JsonArray; val o = xy(jsNumber(a[1]), jsNumber(a[0])); if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y) }
                path.close()
                drawPath(path, Pnd.land); drawPath(path, Pnd.border, style = Stroke(0.6f))
            }
        }
        circle?.let { c ->
            val o = xy(c.lat, c.lon); val r = (c.km / 111.0 / degW * size.width).toFloat()
            drawCircle(c.stroke.copy(alpha = c.fillAlpha), r, o); drawCircle(c.stroke, r, o, style = Stroke(2f))
        }
        events.forEach { e ->
            val lv = RiskScale.markerLevel(e.json)
            val s = lv.markerSize * density
            val o = xy(e.lat!!, e.lon!!)
            val tl = Offset(o.x - s / 2, o.y - s / 2)
            drawCircle(Color.White, s / 2 + 1.5f, o)
            drawRiskShape(if (lv == Level.UNKNOWN) com.anchittandon.pnd.logic.RiskShape.CIRCLE else lv.shape, lv.fill() ?: Pnd.unknownMarker, Size(s, s), tl)
        }
        if (ring?.lat != null && ring.lon != null) drawCircle(Pnd.green, 14 * density, xy(ring.lat!!, ring.lon!!), style = Stroke(3 * density))
    }
}

@Suppress("unused") private val unusedHazards = Hazards
