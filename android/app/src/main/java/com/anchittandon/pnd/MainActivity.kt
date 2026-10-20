package com.anchittandon.pnd

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.anchittandon.pnd.data.AppContainer
import com.anchittandon.pnd.data.DataStoreBackend
import com.anchittandon.pnd.data.OkHttpHttp
import com.anchittandon.pnd.data.Platform
import com.anchittandon.pnd.data.SettingsStore
import com.anchittandon.pnd.logic.AlertRules
import com.anchittandon.pnd.logic.AppClock
import com.anchittandon.pnd.model.JsDate
import com.anchittandon.pnd.notify.AlertWorker
import com.anchittandon.pnd.ui.DeepLinks
import com.anchittandon.pnd.ui.PndApp
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

class MainActivity : ComponentActivity(), Platform {
    private var permissionResult: CompletableDeferred<Map<String, Boolean>>? = null
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissionResult?.complete(it) }
    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val settings = SettingsStore(DataStoreBackend(applicationContext, lifecycleScope))
        container = AppContainer(OkHttpHttp(), settings, cacheDir, { assets.open(it).bufferedReader().use { r -> r.readText() } }, lifecycleScope, this)
        AlertWorker.ensureChannel(this)
        show(intent)
        // Foreground notifications on each feed load, unless background alerts are on (they already sent them).
        lifecycleScope.launch {
            container.feed.state.collectLatest { st ->
                val f = st.feed ?: return@collectLatest
                if (st.savedCopy || st.loading || settings.alertsEnabled || !notificationsAllowed()) return@collectLatest
                val now = AppClock.now()
                val seen = settings.notified()
                AlertRules.toNotify(f.live.map { it.json }, settings.places.map { it.json() }, seen, now).forEach { AlertWorker.show(this@MainActivity, it) }
                settings.saveNotified(seen, now)
            }
        }
        // The current location is refreshed on launch only where permission was already given: arriving never prompts.
        lifecycleScope.launch {
            if (hasLocationPermission() && settings.places.any { it.id == "loc-current" }) {
                currentLocation(prompt = false)?.let { (la, lo) -> settings.setCurrentLocation(la, lo, container.countries.countryAt(la, lo) ?: "", "", JsDate.iso(AppClock.now())) }
            }
        }
        if (settings.alertsEnabled) AlertWorker.schedule(this, true)
    }

    private fun show(i: Intent?) {
        val r = i?.data?.toString()?.let { DeepLinks.route(it) }
        setContent { PndApp(container, startRoute = r) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data != null) show(intent)
    }

    override fun openUrl(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { /* nothing can open it */ }
    }

    override fun share(title: String, url: String) {
        val i = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, title); putExtra(Intent.EXTRA_TEXT, "$title\n$url") }
        startActivity(Intent.createChooser(i, "Share"))
    }

    override fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private suspend fun ask(vararg perms: String): Map<String, Boolean> {
        val d = CompletableDeferred<Map<String, Boolean>>()
        permissionResult = d
        askPermissions.launch(arrayOf(*perms))
        return d.await()
    }

    @SuppressLint("MissingPermission")
    override suspend fun currentLocation(prompt: Boolean): Pair<Double, Double>? {
        if (!hasLocationPermission()) {
            if (!prompt) return null
            val r = ask(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            if (r.values.none { it }) return null
        }
        val client = LocationServices.getFusedLocationProviderClient(this)
        val cts = CancellationTokenSource()
        // 10 s, as the web's geolocation timeout.
        return withTimeoutOrNull(10_000) {
            suspendCancellableCoroutine { cont ->
                client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token)
                    .addOnSuccessListener { l -> cont.resume(l?.let { it.latitude to it.longitude }) }
                    .addOnFailureListener { cont.resume(null) }
                cont.invokeOnCancellation { cts.cancel() }
            }
        }
    }

    override fun notificationsAllowed(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        else androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled()

    override suspend fun requestNotifications(): Boolean {
        if (notificationsAllowed()) return true
        if (Build.VERSION.SDK_INT < 33) return false
        return ask(Manifest.permission.POST_NOTIFICATIONS)[Manifest.permission.POST_NOTIFICATIONS] == true
    }

    override fun scheduleBackgroundChecks(on: Boolean) = AlertWorker.schedule(this, on)
}
