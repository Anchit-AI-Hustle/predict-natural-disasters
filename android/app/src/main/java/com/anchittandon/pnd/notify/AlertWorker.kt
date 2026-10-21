package com.anchittandon.pnd.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.anchittandon.pnd.MainActivity
import com.anchittandon.pnd.R
import com.anchittandon.pnd.data.Api
import com.anchittandon.pnd.data.DataStoreBackend
import com.anchittandon.pnd.data.OkHttpHttp
import com.anchittandon.pnd.data.SettingsStore
import com.anchittandon.pnd.logic.Alert
import com.anchittandon.pnd.logic.AlertRules
import com.anchittandon.pnd.model.Feed
import com.anchittandon.pnd.model.JsDate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.util.concurrent.TimeUnit

/**
 * The on-device background check (features.md §16.3): fetch `/api/events` about once an hour,
 * run alert-rules and the major-event rule against the saved places, and notify with the same
 * 6-hour de-duplication. Places never leave the device. Forecasts never produce an alert.
 */
class AlertWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val settings = SettingsStore(DataStoreBackend(applicationContext, CoroutineScope(SupervisorJob() + Dispatchers.IO)))
        if (!settings.alertsEnabled) return Result.success()
        val r = OkHttpHttp().get(Api.events(false, System.currentTimeMillis()), emptyMap())
        if (!r.ok) return Result.retry()
        val feed = try { Feed.parse(r.body!!) } catch (e: Exception) { return Result.retry() }
        val now = System.currentTimeMillis()
        val seen = settings.notified()
        val alerts = AlertRules.toNotify(feed.live.map { it.json }, settings.places.map { it.json() }, seen, now)
        settings.saveNotified(seen, now)
        settings.set("pnd_alerts_last", JsDate.iso(now))
        alerts.forEach { show(applicationContext, it) }
        return Result.success()
    }

    companion object {
        const val CHANNEL = "pnd_alerts"
        private const val WORK = "pnd-background-alerts"

        fun schedule(ctx: Context, on: Boolean) {
            val wm = WorkManager.getInstance(ctx)
            if (!on) { wm.cancelUniqueWork(WORK); return }
            val req = PeriodicWorkRequestBuilder<AlertWorker>(1, TimeUnit.HOURS, 15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build())
                .build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun ensureChannel(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Alerts near your places", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Dangers reported at or near your saved places, and major events. Never our own forecasts."
            })
        }

        /** Title, body and tag as the web sends them; the tag replaces the previous notification with the same tag. */
        fun show(ctx: Context, a: Alert) {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            ensureChannel(ctx)
            // Only app routes are opened; anything else opens My places.
            val target = if (a.url.startsWith("/")) a.url else "/personal-risk"
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(Api.BASE + target), ctx, MainActivity::class.java)
            val pi = PendingIntent.getActivity(ctx, a.tag.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_alert)
                .setContentTitle(a.title).setContentText(a.body).setStyle(NotificationCompat.BigTextStyle().bigText(a.body))
                .setContentIntent(pi).setAutoCancel(true).setOnlyAlertOnce(false).setWhen(System.currentTimeMillis())
                .setPriority(NotificationCompat.PRIORITY_HIGH).build()
            try { NotificationManagerCompat.from(ctx).notify(a.tag, 1, n) } catch (e: SecurityException) { /* permission revoked meanwhile */ }
        }
    }
}
