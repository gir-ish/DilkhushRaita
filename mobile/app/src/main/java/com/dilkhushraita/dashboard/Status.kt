package com.dilkhushraita.dashboard

import android.os.SystemClock

/**
 * What the watcher is actually doing, in words, on the screen.
 *
 * The first build of this app rang for nobody and gave no account of itself,
 * and working out why over a chat window meant guessing between four
 * different faults that all look identical from the outside: no permission,
 * no session, a refused request, or a service that was never running at all.
 *
 * So it says. One line at the bottom of the dashboard, updated as it goes —
 * worth far more than the screen space it costs, and the first thing to ask
 * for whenever someone says "it did not ring".
 */
object Status {

    enum class State { IDLE, NO_LOGIN, REFUSED, OFFLINE, WATCHING }

    @Volatile var state: State = State.IDLE
        private set

    /** Unaccepted orders at the last successful ask. */
    @Volatile var waiting: Int = 0
        private set

    /** HTTP code of the last refusal, so 401 and 403 can be told apart. */
    @Volatile var lastCode: Int = 0
        private set

    @Volatile private var lastPollAt: Long = 0

    /** Whether the service believes it is running. */
    @Volatile var serviceUp: Boolean = false

    fun watching(count: Int) {
        state = State.WATCHING
        waiting = count
        lastCode = 200
        lastPollAt = SystemClock.elapsedRealtime()
    }

    fun noLogin() {
        state = State.NO_LOGIN
        lastPollAt = SystemClock.elapsedRealtime()
    }

    fun refused(code: Int) {
        state = State.REFUSED
        lastCode = code
        lastPollAt = SystemClock.elapsedRealtime()
    }

    fun offline() {
        state = State.OFFLINE
        lastPollAt = SystemClock.elapsedRealtime()
    }

    /** Seconds since the last attempt, or null if there has not been one. */
    fun secondsAgo(): Long? {
        if (lastPollAt == 0L) return null
        return (SystemClock.elapsedRealtime() - lastPollAt) / 1000
    }

    /** The line itself, said plainly enough to act on. */
    fun line(): String {
        if (!serviceUp) return "Watcher not running — reopen the app"
        val ago = secondsAgo()
        val age = when {
            ago == null -> "starting…"
            ago < 60 -> "${ago}s ago"
            else -> "${ago / 60}m ago"
        }
        return when (state) {
            State.IDLE -> "Watcher starting…"
            State.NO_LOGIN -> "Not signed in — sign in above ($age)"
            State.REFUSED -> "Server said $lastCode — wrong account? ($age)"
            State.OFFLINE -> "No connection ($age)"
            State.WATCHING ->
                if (waiting == 0) "Watching · nothing waiting ($age)"
                else "Watching · $waiting waiting ($age)"
        }
    }
}
