const CACHE = "track-attack-v2";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js", "./songs.json", "./manifest.json",
  "./avatars/avatar-1.svg", "./avatars/avatar-2.svg", "./avatars/avatar-3.svg", "./avatars/avatar-4.svg",
  "./avatars/avatar-5.svg", "./avatars/avatar-6.svg", "./avatars/avatar-7.svg", "./avatars/avatar-8.svg",
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
