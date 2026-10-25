package com.dilkhushraita.dashboard

/**
 * The one place that knows where the shop lives.
 *
 * The app holds no data of its own and no copy of anything. It opens the
 * dashboard that is already running at this address and watches the same
 * order queue the website does, over the same session — so an order accepted
 * here is accepted everywhere, instantly, because there is only ever one of
 * it.
 */
object Config {
    const val ORIGIN = "https://www.dilkhushraita.com"
    const val START_URL = "$ORIGIN/admin"
    const val LOGIN_URL = "$ORIGIN/admin/login"

    /** Unaccepted website orders, the short answer. See api/admin/waiting. */
    const val WAITING_URL = "$ORIGIN/api/admin/waiting"

    /** How often to ask. Fast enough to be useful, slow enough to ignore. */
    const val POLL_MS = 15_000L

    /**
     * How long to wait after a failed poll before trying again.
     *
     * A phone on a patchy counter wifi fails often and briefly; backing off
     * hard would mean missing the order that arrives thirty seconds later.
     */
    const val RETRY_MS = 20_000L

    /** Ordinary running: one quiet line in the shade saying the app is awake. */
    const val CHANNEL_WATCHING = "watching"

    /**
     * The alarm. Its own channel because a channel's importance and sound can
     * never be raised once created — so the loud one has to be born loud,
     * separately from the quiet one.
     */
    const val CHANNEL_ORDER = "new_order_v2"

    const val NOTIF_WATCHING = 1
    const val NOTIF_ORDER = 2
}
