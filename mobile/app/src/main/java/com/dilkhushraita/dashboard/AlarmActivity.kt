package com.dilkhushraita.dashboard

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * The order, the size of the screen, from across the room.
 *
 * Shown over the lock screen with the phone lit, because the alternative is a
 * line of grey text that has to be found. It does not close by itself and it
 * cannot be dismissed with Back: an alert that goes away on its own is the
 * problem this whole app exists to fix.
 */
class AlarmActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        setContentView(R.layout.activity_alarm)
        render()

        findViewById<Button>(R.id.open).setOnClickListener {
            Alarm.silence(this)
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
            finish()
        }
        findViewById<Button>(R.id.silence).setOnClickListener {
            Alarm.silence(this)
            finish()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        render()
    }

    /** Back must not dismiss it. Only the two buttons end this. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Deliberately nothing.
    }

    private fun render() {
        val order = Alarm.current
        if (order == null) {
            finish()
            return
        }
        findViewById<TextView>(R.id.orderNumber).text = order.orderNumber
        findViewById<TextView>(R.id.total).text = "₹${order.total.toInt()}"

        val kind = when (order.type) {
            "DELIVERY" -> getString(R.string.kind_delivery)
            "PICKUP" -> getString(R.string.kind_pickup)
            else -> getString(R.string.kind_dinein)
        }
        val items = resources.getQuantityString(R.plurals.items, order.itemCount, order.itemCount)
        findViewById<TextView>(R.id.detail).text = buildString {
            append(kind).append(" · ").append(items)
            order.customerName?.let { append(" · ").append(it) }
        }
        findViewById<TextView>(R.id.branch).text = order.branchName

        val more = findViewById<TextView>(R.id.more)
        if (Alarm.alsoWaiting > 0) {
            more.visibility = android.view.View.VISIBLE
            more.text = resources.getQuantityString(
                R.plurals.more_waiting, Alarm.alsoWaiting, Alarm.alsoWaiting
            )
        } else {
            more.visibility = android.view.View.GONE
        }
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
                .requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
