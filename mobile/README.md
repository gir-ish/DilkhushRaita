# The owner's phone app

An Android app for the dashboard, built for one thing a browser cannot do:
**ring reliably, with the phone locked and in somebody's pocket.**

It is not a second version of the dashboard. It opens the site that is already
running at dilkhushraita.com, over the same session, against the same
database — so an order accepted on the phone is accepted at the counter the
same instant, and every change deployed to the website is in the app
immediately, with no new build.

What the app adds is underneath that window.

## Why it exists

Web push depends on Chrome being alive, and Android freezes Chrome to save
battery. The alerts were arriving late, or not at all, and the sound could not
be changed because a web notification has no sound of its own — it borrows
Chrome's, shared with every other website.

| | Web push | This app |
|---|---|---|
| Works with the phone locked | sometimes | always |
| Rings through silent mode | no | yes |
| Keeps ringing until accepted | no | yes |
| Full screen, like a call | no | yes |
| Its own sound | no | the dashboard's own chime |
| Survives a power cut | no | restarts itself |

## How it works

- **`OrderWatcher`** is a foreground service, which is the only kind Android
  will not kill. It asks `/api/admin/waiting` every 15 seconds. The price of
  staying alive is one silent line in the notification shade saying so.
- **Signing in** happens in the WebView, by hand, exactly as on the website.
  The watcher reads that session's cookie rather than holding a password of
  its own — so signing out of the app blinds the watcher at the same moment.
- **`Alarm`** plays the chime on a loop as an *alarm*, not a notification,
  which is what carries it through a phone on silent. It raises a full-screen
  alert over the lock screen and keeps going until somebody opens the order or
  presses Silence.
- **Nothing is stored** in the app. No orders, no menu, no customers.

## The sound

`app/src/main/res/raw/new_order.wav` is the dashboard's own new-order chime —
the same two notes, three times, with the same envelope. The website
synthesises it in the browser; the app cannot do that with no page open, so it
is rendered to a file by:

```
node scripts/render-chime.mjs
```

Re-run that if the chime in `src/lib/sound.ts` ever changes, **and bump
`CHANNEL_ORDER` in `Config.kt`**. Android fixes a notification channel's sound
when the channel is created and never lets the app change it afterwards, so a
new sound needs a new channel id or nobody will ever hear it.

## Building it

Pushed to `main`, GitHub builds it by itself. To get the file:

**Actions → "Build the Android app" → the newest run → Artifacts →
`dilkhush-dashboard-apk`**

Unzip, put the `.apk` on the phone, tap it, allow "install from unknown
sources" once. There is no Play Store listing and there is not meant to be:
this app is for the people who run the shop.

To build it yourself you need a JDK 17 and the Android SDK:

```
cd mobile && gradle assembleRelease
```

It is signed with the debug key on purpose — it is handed out as a file to
phones the owner controls, never submitted to a store, and a release build
that cannot be installed would be worse than an honestly-signed one.

## After installing

Three settings decide whether any of this works. The app asks for the first
two; the third is worth doing by hand.

1. **Allow notifications** — asked on first open.
2. **Battery → Unrestricted** — asked once, with the reason. Without it
   Android will put the watcher to sleep and the app becomes a bookmark.
3. **Notifications → New orders → Sound** — already set to the dashboard's
   chime, but this is where to change it to anything you prefer.

On phones with their own battery manager on top of Android — Xiaomi, Oppo,
Vivo, Realme — there is usually a second switch called Autostart or Protected
Apps. Turn it on for this app too, or the service will be killed anyway.
