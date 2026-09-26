/* DilKhush Dhaba service worker: cache app shell, offline fallback, update flow. */
/* Bumped when SHELL changes: activate deletes every cache that is not this one. */
const CACHE = "dk-shell-v6";
const SHELL = [
  "/offline.html",
  // Two installable apps, two manifests: the shop, and the staff dashboard.
  "/manifest.webmanifest",
  "/manifest-admin.webmanifest",
  "/icon.svg",
  // Precached because the install prompt shows these, and an install bar with
  // a missing image is worse than none at all.
  "/icon-192.png",
  "/icon-admin-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  /*
   * Anything not ours goes straight to the network, untouched.
   *
   * A service worker sits in front of EVERY request the page makes, including
   * the payment gateway's script. Re-fetching a cross-origin resource here buys
   * nothing — it is never cached below, the pathname tests cannot match it —
   * and it puts this worker on the critical path of taking money. If that fetch
   * so much as hiccups, the catch hands back Response.error(), the <script> tag
   * fires onerror, and the customer is told the payment window could not open.
   *
   * Returning without respondWith leaves the browser to do it directly.
   */
  if (url.origin !== self.location.origin) return;

  // Never cache API calls or non-GET requests.
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful static assets for faster repeat loads.
        if (res.ok && (url.pathname.startsWith("/_next/static") || SHELL.includes(url.pathname))) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === "navigate") return caches.match("/offline.html");
        return Response.error();
      })
  );
});

/* ------------------------------------------------------------------ push */

/*
 * A new order, delivered to a browser that may be closed.
 *
 * The push service wakes this worker even with no tab open, which is the
 * whole point: the dashboard's chime needs a page on screen, and at nine in
 * the evening there is not one. Everything below has to survive that — no
 * page, no React, nothing but this file.
 */
self.addEventListener("push", (e) => {
  let data = { title: "New order", body: "Open the dashboard to see it.", url: "/admin/online" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    // A push with no payload, or one we cannot read, is still worth showing:
    // something happened, and the dashboard will say what.
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-admin-192.png",
      badge: "/icon-admin-192.png",
      // Survives being ignored: an order alert must stay on the lock screen
      // until somebody looks at it.
      requireInteraction: true,
      // Android only, and silently ignored elsewhere.
      vibrate: [200, 100, 200, 100, 200],
      tag: data.tag || "dk-order",
      renotify: true,
      data: { url: data.url || "/admin/online" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin/online";

  /*
   * Reuse a dashboard tab if one is already open rather than piling up a new
   * one per order — and focus it, because on a phone the browser may be in the
   * background even though the tab exists.
   */
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/admin") && "focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
