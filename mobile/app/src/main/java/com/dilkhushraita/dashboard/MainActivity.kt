package com.dilkhushraita.dashboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * The dashboard, in a window of its own.
 *
 * It loads the site rather than reimplementing it, so every change deployed
 * to the website is in the app the moment it ships — there is no second copy
 * of the menu, the orders or anything else to drift out of step. The app's
 * whole reason to exist is the watcher behind this screen.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var status: TextView
    private val ticker = Handler(Looper.getMainLooper())

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Either way, carry on: the watcher still runs, it just cannot
            // show its line until the person changes their mind in Settings.
            OrderWatcher.start(this)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        status = findViewById(R.id.status)

        /*
         * Fires the alarm with a made-up order, so the loud path can be tried
         * without a customer. The one thing worth being able to test on
         * demand: if this rings and a real order does not, the fault is in the
         * watching, not in the ringing — which is two different fixes.
         */
        findViewById<Button>(R.id.test).setOnClickListener {
            Alarm.raise(
                this,
                WaitingOrder(
                    id = "test",
                    orderNumber = "TEST",
                    type = "PICKUP",
                    total = 0.0,
                    itemCount = 1,
                    customerName = getString(R.string.test_customer),
                    branchName = getString(R.string.app_name)
                ),
                1
            )
        }

        web = findViewById(R.id.web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            // The site decides its own sizing; a WebView zoom control on top
            // of a responsive layout only gets in the way.
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString DilKhushApp/1.0"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                // Anything that is not the dashboard — a customer's tracking
                // link, a payment page, a phone number — belongs to the phone,
                // not to this window.
                if (url.startsWith(Config.ORIGIN)) return false
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // The session may have just been created by a sign-in, and the
                // watcher reads its cookie. Flush so it is on disk first.
                CookieManager.getInstance().flush()
                findViewById<View>(R.id.loading).visibility = View.GONE
            }
        }

        if (savedInstanceState == null) web.loadUrl(Config.START_URL)
        else web.restoreState(savedInstanceState)

        requestNotificationPermission()
        askAboutBattery()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        tick()
        // Starting it here as well as at launch: it is cheap when already
        // running, and it quietly repairs the case where Android killed the
        // service while the app was in the background.
        OrderWatcher.start(this)
    }

    override fun onPause() {
        ticker.removeCallbacksAndMessages(null)
        super.onPause()
    }

    /** The status line, kept current while anyone is looking at it. */
    private fun tick() {
        status.text = Status.line()
        ticker.postDelayed({ tick() }, 2_000)
    }

    @Suppress("DEPRECATION")
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            OrderWatcher.start(this)
            return
        }
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) OrderWatcher.start(this)
        else askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /**
     * The one setting that decides whether any of this works.
     *
     * Android's battery saver will put the watcher to sleep like anything
     * else unless the app is exempted, and the exemption cannot be granted in
     * code — only asked for. Asked once, with the reason said plainly, and
     * never again if declined.
     */
    private fun askAboutBattery() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) return

        val prefs = getSharedPreferences("dk", MODE_PRIVATE)
        if (prefs.getBoolean("asked_battery", false)) return
        prefs.edit().putBoolean("asked_battery", true).apply()

        AlertDialog.Builder(this)
            .setTitle(R.string.battery_title)
            .setMessage(R.string.battery_message)
            .setPositiveButton(R.string.battery_ok) { _, _ ->
                try {
                    startActivity(
                        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    )
                } catch (_: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.parse("package:$packageName")
                        })
                    } catch (_: Exception) {
                    }
                }
            }
            .setNegativeButton(R.string.battery_later, null)
            .show()
    }
}
