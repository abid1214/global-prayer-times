// Service worker — gives the PWA offline support after first load.
//
// Strategy:
//   - HTML / JS / CSS: stale-while-revalidate (use the cache, update in the
//     background so a code change reaches the user on the next launch).
//   - Vendor / texture / icon: cache-first (these are pinned by URL).
//   - Geocoding (Nominatim): network only — we don't want a stale city search.
//
// Inside the Capacitor WKWebView/WebView, the service worker is a no-op:
// all files are served from the local bundle anyway. Registering is still
// harmless and keeps the web build's behavior consistent.

const VERSION = "v1";
const CACHE = `gpt-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/main.js",
  "./src/panel.js",
  "./src/prayer.js",
  "./src/settings.js",
  "./src/settingsPanel.js",
  "./src/earthMaterial.js",
  "./src/globeControls.js",
  "./src/highLatCities.js",
  "./src/search.js",
  "./src/solar.js",
  "./assets/icon/icon-192.png",
  "./assets/icon/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache geocoding — it's an online-only feature.
  if (url.hostname === "nominatim.openstreetmap.org") return;

  // Cache-first for pinned vendor + textures + icons.
  if (url.pathname.includes("/vendor/") || url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Stale-while-revalidate for everything else same-origin.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    );
  }
});
