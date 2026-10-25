package com.dilkhushraita.dashboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Back on watch after a restart, without anyone opening the app.
 *
 * A power cut at a dhaba is not an unusual evening, and a phone that comes
 * back up silent is indistinguishable from one that is working — which is the
 * worst way for this to fail. Also fires after the app is updated, since an
 * update stops the service.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> OrderWatcher.start(context)
        }
    }
}
