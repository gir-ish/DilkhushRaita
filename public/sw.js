/* DilKhush Dhaba service worker: cache app shell, offline fallback, update flow. */
/* Bumped when SHELL changes: activate deletes every cache that is not this one. */
const CACHE = "dk-shell-v3";
const SHELL = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon.svg",
  // Precached because the install prompt shows this icon, and an install bar
  // with a missing image is worse than none at all.
  "/icon-192.png",
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
