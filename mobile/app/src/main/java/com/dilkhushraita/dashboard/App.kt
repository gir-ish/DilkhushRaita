package com.dilkhushraita.dashboard

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build

/**
 * The notification channels, created once when the app first starts.
 *
 * Android fixes a channel's sound and importance the moment it is created and
 * will not let the app change either afterwards — only the person can, from
 * Settings, which is the point of channels. That makes this the one chance to
 * get the loud one right, and the reason the alarm channel carries a version
 * in its id: changing the bundled sound means a new channel, because the old
 * one would keep the old sound for ever.
 */
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        /*
         * USAGE_ALARM, not USAGE_NOTIFICATION. It is what lets the chime
         * through a phone that has been put on silent, and it is how a
         * kitchen phone spends most of its evening.
         */
        val sound = Uri.parse("android.resource://$packageName/${R.raw.new_order}")
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val order = NotificationChannel(
            Config.CHANNEL_ORDER,
            getString(R.string.channel_order),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = getString(R.string.channel_order_desc)
            setSound(sound, attrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
            enableLights(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            // Lets it through Do Not Disturb, if the person allows the app
            // when they turn DND on.
            setBypassDnd(true)
        }
        manager.createNotificationChannel(order)

        /*
         * The other one is deliberately as quiet as Android allows. It exists
         * only because a foreground service must show something, and what it
         * shows should never be mistaken for an order.
         */
        val watching = NotificationChannel(
            Config.CHANNEL_WATCHING,
            getString(R.string.channel_watching),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.channel_watching_desc)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        manager.createNotificationChannel(watching)
    }
}
