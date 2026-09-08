const CACHE = "zeitrille-v1";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./songs.json", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Nur eigene statische Assets cachen; Spotify-API/SDK-Aufrufe immer live vom Netz laden.
  if (e.request.url.includes("spotify.com") || e.request.url.includes("scdn.co")) return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
