@file:OptIn(ExperimentalMaterial3Api::class)

package com.anchittandon.pnd.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.anchittandon.pnd.data.AppContainer
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.logic.Format
import com.anchittandon.pnd.ui.components.StaleBox
import com.anchittandon.pnd.ui.screens.*
import com.anchittandon.pnd.ui.theme.Pnd
import com.anchittandon.pnd.ui.theme.PndTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What every screen can reach: the data, and a way to go somewhere by web path. */
class AppEnv(val container: AppContainer, val navigate: (String) -> Unit, val back: () -> Unit, val tz: String)

val LocalApp = compositionLocalOf<AppEnv> { error("No AppEnv") }

/** The five tabs, in the website's order (features.md §0.1). */
val TABS = listOf(
    Triple("Map", "live-map", Icons.Filled.Map),
    Triple("Alerts & events", "alerts", Icons.Filled.Warning),
    Triple("Forecasts", "forecasts", Icons.Filled.ShowChart),
    Triple("My places", "personal-risk", Icons.Filled.Place),
    Triple("Track record", "accuracy", Icons.Filled.FactCheck),
)

/** Home and the five tab roots: screens reached from the tab bar or the logo, which never show a back arrow. */
fun isRoot(route: String?): Boolean = route == null || route == "home" || TABS.any { it.second == route }

/** `PND.NAV_ALIAS`: which tab a secondary screen belongs to. */
fun tabFor(route: String?): String? {
    val r = route ?: return null
    val base = r.substringBefore('/').substringBefore('?')
    return when (base) {
        "live-map" -> "live-map"
        "alerts", "calamities", "events", "recent-events", "official-warnings", "alerts-notifications", "hazard-types", "historical-events", "disasters" -> "alerts"
        "forecasts", "forecast-list", "forecast-calendar", "verification-forecasts" -> "forecasts"
        "personal-risk" -> "personal-risk"
        "accuracy", "verification", "verification-detail" -> "accuracy"
        else -> null
    }
}

@Composable
fun PndApp(container: AppContainer, startRoute: String? = null, poll: Boolean = true) {
    val settings by container.settings.values.collectAsState()
    val tz = com.anchittandon.pnd.logic.Portal.timezone(settings["pnd_timezone"], AppClock.deviceZone)
    AppClock.zone = tz
    val nav = rememberNavController()
    val env = remember(tz) { AppEnv(container, { p -> go(nav, p) }, { if (!nav.popBackStack()) Unit }, tz) }
    PndTheme {
        CompositionLocalProvider(LocalApp provides env) {
            if (poll) FeedPolling(container)
            val entry by nav.currentBackStackEntryAsState()
            val route = entry?.destination?.route
            Scaffold(
                containerColor = Pnd.bg,
                topBar = { TopBar(route, canGoBack = nav.previousBackStackEntry != null, onBack = { nav.popBackStack() }) },
                bottomBar = { TabBar(tabFor(route)) { go(nav, it, tab = true) } },
            ) { pad ->
                NavHost(nav, startDestination = "home", modifier = Modifier.padding(pad)) { routes() }
                // After the graph is set (the content is composed after the frame around it).
                LaunchedEffect(startRoute) { if (startRoute != null && startRoute != "home") go(nav, startRoute) }
            }
        }
    }
}

/** Open a web path (`/disasters/x`, `/events?q=y`) as a screen. */
fun go(nav: NavHostController, path: String, tab: Boolean = false) {
    val r = DeepLinks.route(path) ?: "home"
    try {
        nav.navigate(r) {
            if (tab) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true }
        }
    } catch (e: IllegalArgumentException) {
        nav.navigate("home")
    }
}

/** Polls `/api/events` every 60 s while the app is visible (`PND.autoRefresh`). */
@Composable
private fun FeedPolling(container: AppContainer) {
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                container.feed.refresh(fresh = false)
                delay(60_000)
            }
        }
    }
}

/**
 * Changing the time zone redraws the screen, as the web reloads the page, but keeps the reader on it:
 * only the screen's content is rebuilt, never the navigation graph.
 */
@Composable
private fun Tz(content: @Composable () -> Unit) = androidx.compose.runtime.key(LocalApp.current.tz) { content() }

private fun androidx.navigation.NavGraphBuilder.routes() {
    val str = { n: String -> navArgument(n) { type = NavType.StringType; nullable = true; defaultValue = null } }
    composable("home") { Tz { HomeScreen() } }
    composable("live-map") { Tz { MapScreen() } }
    composable("alerts") { Tz { AlertsScreen() } }
    composable("forecasts") { Tz { ForecastsScreen() } }
    composable("personal-risk") { Tz { MyPlacesScreen() } }
    composable("accuracy") { Tz { TrackRecordUi() } }
    for (v in CollectionView.entries) {
        composable(v.route + "?q={q}&region={region}", listOf(str("q"), str("region"))) { b -> Tz { CollectionScreen(v, b.arguments?.getString("q") ?: "", b.arguments?.getString("region") ?: "") } }
    }
    composable("forecast-calendar?region={region}", listOf(str("region"))) { b -> Tz { ForecastCalendarScreen(b.arguments?.getString("region") ?: "") } }
    composable("calamities") { Tz { CalamitiesScreen() } }
    composable("regions") { Tz { RegionsScreen() } }
    composable("resources") { Tz { ResourcesScreen() } }
    composable("insights") { Tz { InsightsScreen() } }
    composable("methodology") { Tz { MethodologyScreen() } }
    composable("about") { Tz { AboutScreen() } }
    composable("verification") { Tz { VerificationListScreen() } }
    composable("verification-detail") { Tz { VerificationDetailScreen() } }
    composable("more") { Tz { MoreScreen() } }
    composable("settings") { Tz { SettingsScreen() } }
    composable("disasters/{id}", listOf(str("id"))) { b -> Tz { RecordDetailScreen(DetailKind.EVENT, b.arguments?.getString("id") ?: "") } }
    composable("alerts/{id}", listOf(str("id"))) { b -> Tz { RecordDetailScreen(DetailKind.ALERT, b.arguments?.getString("id") ?: "") } }
    composable("calamities/{id}", listOf(str("id"))) { b -> Tz { RecordDetailScreen(DetailKind.CALAMITY, b.arguments?.getString("id") ?: "") } }
    composable("forecasts/{id}", listOf(str("id"))) { b -> Tz { ForecastDetailScreen(b.arguments?.getString("id") ?: "ND-001") } }
    composable("regions/{name}", listOf(str("name"))) { b -> Tz { RegionDetailScreen(b.arguments?.getString("name") ?: "World") } }
    composable("locations/{name}?lat={lat}&lon={lon}&level={level}&country={country}&cc={cc}",
        listOf(str("name"), str("lat"), str("lon"), str("level"), str("country"), str("cc"))) { b ->
        val a = b.arguments
        Tz { LocationDetailScreen(a?.getString("name") ?: "World", a?.getString("lat")?.toDoubleOrNull(), a?.getString("lon")?.toDoubleOrNull(),
            a?.getString("level") ?: "", a?.getString("country") ?: "", a?.getString("cc") ?: "") }
    }
    composable("hazards/{type}?region={region}", listOf(str("type"), str("region"))) { b -> Tz { HazardDetailScreen(b.arguments?.getString("type") ?: "Flood", b.arguments?.getString("region") ?: "") } }
    composable("history/{id}", listOf(str("id"))) { b -> Tz { HistoryDetailScreen(b.arguments?.getString("id") ?: "") } }
    composable("sources/{name}", listOf(str("name"))) { b -> Tz { SourceDetailScreen(b.arguments?.getString("name") ?: "GDACS") } }
}

@Composable
private fun TopBar(route: String?, canGoBack: Boolean, onBack: () -> Unit) {
    val env = LocalApp.current
    Column(Modifier.fillMaxWidth().background(Color(0xF702110D)).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (canGoBack && !isRoot(route)) {
                IconButton(onBack, Modifier.size(48.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Pnd.text) }
            }
            Row(
                Modifier.weight(1f).heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Check a place") { env.navigate("/") }
                    .semantics(mergeDescendants = true) { contentDescription = "Predict Natural Disasters - check a place" }.padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("◎", color = Pnd.green, fontSize = 26.sp)
                Column(Modifier.padding(start = 6.dp)) {
                    Text("Predict Natural Disasters", color = Pnd.text, fontWeight = FontWeight.ExtraBold, fontSize = capped(15f, 1.3f), lineHeight = capped(18f, 1.3f))
                    if ((!canGoBack || isRoot(route)) && androidx.compose.ui.platform.LocalDensity.current.fontScale <= 1.3f) Text("Check a place · live hazards · forecasts", color = Color(0xFFCBE5DA), fontSize = 11.sp, lineHeight = 14.sp)
                }
            }
            Text(Format.tzLabel(env.tz), color = Color(0xFFEAF7F1), fontSize = 12.sp,
                modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Change the time zone") { env.navigate("/settings") }
                    .semantics { contentDescription = "Display time zone: ${Format.tzMenuLabel(env.tz)}. Change it" }.padding(12.dp).testTag("tzButton"))
            Text("● Live", color = Pnd.greenLive, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Open live events") { env.navigate("/events") }
                    .border(1.dp, Color(0xFF187858), RoundedCornerShape(8.dp)).background(Color(0xFF06251B), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 12.dp))
            IconButton({ env.navigate("/more") }, Modifier.size(48.dp).testTag("moreButton")) { Icon(Icons.Filled.Menu, "More of this app", tint = Pnd.text) }
        }
        Box(Modifier.fillMaxWidth().heightIn(min = 1.dp, max = 1.dp).background(Pnd.line2))
    }
}

@Composable
private fun TabBar(active: String?, onTab: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().background(Pnd.tabBar).windowInsetsPadding(WindowInsets.navigationBars)) {
        Box(Modifier.fillMaxWidth().heightIn(min = 1.dp, max = 1.dp).background(Pnd.tabBorder))
        Row(Modifier.fillMaxWidth()) {
            TABS.forEach { (label, route, icon) ->
                val on = active == route
                Column(
                    Modifier.weight(1f).heightIn(min = 58.dp).clickable(role = Role.Tab, onClickLabel = "Open $label") { onTab("/$route") }
                        .semantics(mergeDescendants = true) { selected = on }.testTag("tab:$route"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.fillMaxWidth().heightIn(min = 2.dp, max = 2.dp).background(if (on) Pnd.green else Color.Transparent))
                    Spacer(Modifier.heightIn(min = 6.dp))
                    Icon(icon, null, tint = if (on) Pnd.greenText else Pnd.tabInactive, modifier = Modifier.size(20.dp))
                    // Labels follow the font size up to 1.3x so a word never breaks across lines; TalkBack reads them in full.
                    val cap = capped(11f, 1.3f)
                    Text(label, color = if (on) Pnd.greenText else Pnd.tabInactive, fontSize = cap, lineHeight = cap * 1.2f, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 2.dp, vertical = 3.dp))
                }
            }
        }
    }
}

/**
 * The frame every screen sits in: pull to refresh (`?ts=`), the trust note where the screen has
 * a data group, the failure banner ("a failed load is not an empty world"), and the footer agencies.
 */
@Composable
fun PndScreen(
    trust: Set<TrustGroup>? = setOf(TrustGroup.FEED, TrustGroup.MODELS),
    footer: Boolean = true,
    feedBanner: Boolean = true,
    trustAfterHeader: Boolean = false,
    ledgerTime: String? = null,
    ledgerFailed: Boolean = false,
    onRefresh: (suspend () -> Unit)? = null,
    header: (LazyListScope.() -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    val env = LocalApp.current
    val feed by env.container.feed.state.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; try { (onRefresh ?: { env.container.feed.refresh(fresh = true) })() } finally { refreshing = false } } },
        modifier = Modifier.fillMaxSize().background(Pnd.bg),
    ) {
        LazyColumn(Modifier.fillMaxSize().testTag("screen"), state = rememberLazyListState(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)) {
            if (trust != null && !trustAfterHeader) item(key = "trust") { TrustNote(trust, ledgerTime, ledgerFailed) }
            header?.invoke(this)
            if (trust != null && trustAfterHeader) item(key = "trust") { TrustNote(trust, ledgerTime, ledgerFailed) }
            if (feedBanner) item(key = "feedBanner") { FeedBanner(feed) }
            content()
            if (footer) item(key = "footer") { FooterAgencies() }
        }
    }
}

/** "Live data unavailable. Trying again automatically." and the saved-copy label. */
@Composable
fun FeedBanner(feed: com.anchittandon.pnd.data.FeedState) {
    if (feed.failed) StaleBox("Live data unavailable. Trying again automatically." +
        (feed.feed?.let { " Showing a saved copy from ${Format.fmtDate(it.generatedAt)}. It is not live." } ?: ""), tag = "feedError")
    else if (feed.savedCopy && feed.feed != null) StaleBox("Showing a saved copy from ${Format.fmtDate(feed.feed.generatedAt)} while the latest data loads.", tag = "savedCopy")
}

/** A size that follows the system font scale up to [max], for chrome that must not wrap mid-word. */
@Composable
fun capped(sp: Float, max: Float): androidx.compose.ui.unit.TextUnit {
    val fs = androidx.compose.ui.platform.LocalDensity.current.fontScale
    return (sp * minOf(fs, max) / fs).sp
}
