package com.dilkhushraita.dashboard

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The thing that is awake when nobody is.
 *
 * A browser tab stops running the moment the screen goes off, which is the
 * whole reason order alerts were being missed. A foreground service does not:
 * Android keeps it alive precisely because it is showing a notification
 * saying so, and that trade — one quiet line in the shade, in exchange for
 * never being killed — is the only honest way to watch a queue on a phone.
 *
 * It signs in as nobody. The session cookie belongs to the WebView, where the
 * owner logged in by hand, and this reads it from the shared cookie store
 * rather than holding a password of its own. Sign out in the app and the
 * watcher goes blind at the same moment, which is right.
 */
class OrderWatcher : Service() {

    private var job: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * Orders already announced.
     *
     * Without it every poll would re-announce everything waiting, so one
     * unaccepted order would mean an alarm every fifteen seconds for ever.
     * The dashboard's own chime makes the same distinction for the same
     * reason — it is the arrival that is news, not the waiting.
     */
    private val announced = mutableSetOf<String>()

    /** Null until the first poll answers: what was already waiting is not news. */
    private var primed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(Config.NOTIF_WATCHING, watchingNotification(null))
        if (job?.isActive != true) job = scope.launch { loop() }
        // START_STICKY: if Android does reclaim us under real memory pressure,
        // come back by ourselves rather than waiting for someone to notice.
        return START_STICKY
    }

    override fun onDestroy() {
        job?.cancel()
        super.onDestroy()
    }

    private suspend fun loop() {
        while (scope.isActive) {
            val wait = try {
                val waiting = fetchWaiting()
                if (waiting == null) {
                    // Not signed in, or no network. Say so quietly rather than
                    // pretending all is well with an empty queue.
                    update(watchingNotification(null))
                    Config.RETRY_MS
                } else {
                    onWaiting(waiting)
                    Config.POLL_MS
                }
            } catch (e: Exception) {
                Log.w(TAG, "poll failed", e)
                Config.RETRY_MS
            }
            delay(wait)
        }
    }

    private fun onWaiting(orders: List<WaitingOrder>) {
        update(watchingNotification(orders.size))

        val ids = orders.map { it.id }.toSet()
        // Forget the ones that have been dealt with, or the set grows all day
        // and an order re-placed with the same id could never ring again.
        announced.retainAll(ids)

        if (!primed) {
            // First answer after starting: adopt whatever is already waiting
            // without ringing. Opening the app must not set the alarm off.
            announced.addAll(ids)
            primed = true
            return
        }

        val fresh = orders.filter { it.id !in announced }
        if (fresh.isEmpty()) return
        announced.addAll(fresh.map { it.id })
        Alarm.raise(this, fresh.first(), fresh.size)
    }

    /* ----------------------------------------------------------- fetching */

    private fun fetchWaiting(): List<WaitingOrder>? {
        val cookie = CookieManager.getInstance().getCookie(Config.ORIGIN)
        if (cookie.isNullOrBlank()) return null

        val conn = (URL(Config.WAITING_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Accept", "application/json")
            connectTimeout = 10_000
            readTimeout = 10_000
            instanceFollowRedirects = false
        }
        try {
            // 401/403: signed out, or a role with no order access. Both mean
            // "nothing to watch", and neither is an error worth shouting about.
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val arr = JSONObject(body).optJSONArray("orders") ?: return emptyList()
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                WaitingOrder(
                    id = o.getString("id"),
                    orderNumber = o.optString("orderNumber"),
                    type = o.optString("type"),
                    total = o.optDouble("total", 0.0),
                    itemCount = o.optInt("itemCount", 0),
                    customerName = o.optString("customerName").takeIf { it.isNotBlank() && it != "null" },
                    branchName = o.optString("branchName")
                )
            }
        } finally {
            conn.disconnect()
        }
    }

    /* ------------------------------------------------------ the quiet line */

    private fun update(n: Notification) {
        val m = androidx.core.app.NotificationManagerCompat.from(this)
        try {
            m.notify(Config.NOTIF_WATCHING, n)
        } catch (e: SecurityException) {
            // Notifications not granted yet. The service still runs; the line
            // appears as soon as the person says yes.
        }
    }

    private fun watchingNotification(waiting: Int?): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val text = when {
            waiting == null -> getString(R.string.watching_signed_out)
            waiting == 0 -> getString(R.string.watching_clear)
            waiting == 1 -> getString(R.string.watching_one)
            else -> getString(R.string.watching_many, waiting)
        }
        return NotificationCompat.Builder(this, Config.CHANNEL_WATCHING)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val TAG = "OrderWatcher"

        fun start(ctx: Context) {
            val i = Intent(ctx, OrderWatcher::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }
}

data class WaitingOrder(
    val id: String,
    val orderNumber: String,
    val type: String,
    val total: Double,
    val itemCount: Int,
    val customerName: String?,
    val branchName: String
)
