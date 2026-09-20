const CACHE = "track-attack-v9";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js", "./songs.json", "./manifest.json",
  "./avatar-1.svg", "./avatar-2.svg", "./avatar-3.svg", "./avatar-4.svg",
  "./avatar-5.svg", "./avatar-6.svg", "./avatar-7.svg", "./avatar-8.svg",
];

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
