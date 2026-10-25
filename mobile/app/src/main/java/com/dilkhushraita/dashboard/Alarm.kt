package com.dilkhushraita.dashboard

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Ringing until somebody deals with it.
 *
 * A notification chimes once and waits to be noticed, which is exactly what
 * was going wrong: one chime into a noisy kitchen is one chime nobody heard.
 * This keeps playing the dashboard's own new-order tone, on a loop, and lights
 * the screen with a full-screen alert the way an incoming call does — until
 * someone opens the order or presses silence.
 *
 * The sound plays as an alarm, not a notification, so a phone on silent still
 * rings. That is a strong thing to do to somebody's phone and it is done on
 * purpose: this app has exactly one reason to make a noise, and a customer is
 * waiting at the other end of it.
 */
object Alarm {

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    /** What is currently ringing, so the alarm screen can describe it. */
    @Volatile
    var current: WaitingOrder? = null
        private set

    @Volatile
    var alsoWaiting: Int = 0
        private set

    fun raise(ctx: Context, order: WaitingOrder, count: Int) {
        current = order
        alsoWaiting = count - 1

        notify(ctx, order, count)
        startSound(ctx)
        startVibration(ctx)

        /*
         * The full-screen intent on the notification is the proper way in, and
         * Android may decline it — on 14 and up it is reserved for calls and
         * alarms unless the person has allowed it. Starting the activity
         * directly is the fallback, and it is wrapped because a background
         * start is refused outright on some versions. Either way the
         * notification and the sound have already happened.
         */
        try {
            ctx.startActivity(
                Intent(ctx, AlarmActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        } catch (_: Exception) {
        }
    }

    /** Someone has seen it. Stop making noise, leave the order alone. */
    fun silence(ctx: Context) {
        stopSound()
        stopVibration()
        current = null
        alsoWaiting = 0
        NotificationManagerCompat.from(ctx).cancel(Config.NOTIF_ORDER)
    }

    /* -------------------------------------------------------------- sound */

    private fun startSound(ctx: Context) {
        stopSound()
        try {
            val uri = Uri.parse("android.resource://${ctx.packageName}/${R.raw.new_order}")
            player = MediaPlayer().apply {
                setDataSource(ctx, uri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {
            // No audio for any reason: the screen and the buzz still carry it.
        }
    }

    private fun stopSound() {
        try {
            player?.stop()
            player?.release()
        } catch (_: Exception) {
        }
        player = null
    }

    /* ---------------------------------------------------------- vibration */

    private fun startVibration(ctx: Context) {
        stopVibration()
        try {
            val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            vibrator = v
            val pattern = longArrayOf(0, 500, 300, 500, 300, 700, 900)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(pattern, 0)
            }
        } catch (_: Exception) {
        }
    }

    private fun stopVibration() {
        try {
            vibrator?.cancel()
        } catch (_: Exception) {
        }
        vibrator = null
    }

    /* ------------------------------------------------------- notification */

    private fun notify(ctx: Context, order: WaitingOrder, count: Int) {
        val full = PendingIntent.getActivity(
            ctx, 1,
            Intent(ctx, AlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val kind = when (order.type) {
            "DELIVERY" -> ctx.getString(R.string.kind_delivery)
            "PICKUP" -> ctx.getString(R.string.kind_pickup)
            else -> ctx.getString(R.string.kind_dinein)
        }
        val money = "₹${order.total.toInt()}"
        val line = buildString {
            append(kind).append(" · ").append(money)
            order.customerName?.let { append(" · ").append(it) }
        }

        val n = NotificationCompat.Builder(ctx, Config.CHANNEL_ORDER)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(
                if (count > 1) ctx.getString(R.string.alarm_title_many, count)
                else ctx.getString(R.string.alarm_title_one, order.orderNumber)
            )
            .setContentText(line)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(false)
            .setOngoing(true)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .build()

        try {
            NotificationManagerCompat.from(ctx).notify(Config.NOTIF_ORDER, n)
        } catch (_: SecurityException) {
            // Notifications not granted. The alarm screen still gets raised.
        }
    }
}
