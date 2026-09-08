/* ============================================================
   Track Attack — Hitster-artiges Musik-Zeitleiste-Spiel
   Läuft komplett client-seitig gegen die Spotify Web API.
   ============================================================ */

// ---- KONFIGURATION -------------------------------------------------
// Trage hier deine Spotify Client-ID ein (siehe README.md, Schritt 1).
const CLIENT_ID = "c88ea2eefa8842ab806695da036851d6";
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

const SNIPPET_START_MS = 25000; // Startet mitten im Song, um Intros zu überspringen
const SNIPPET_DURATION_MS = 15000;

// ---- STATE -----------------------------------------------------------
let allSongs = [];
let deck = [];
let timeline = [];
let currentSong = null;
let selectedGapIndex = null;
let snippetTimer = null;
let goal = 10;
let playerName = "Spieler";

let spotifyPlayer = null;
let deviceId = null;
let sdkReady = false;

// ---- DOM SHORTCUTS -----------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = {
  login: $("screen-login"),
  setup: $("screen-setup"),
  game: $("screen-game"),
  win: $("screen-win"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

// ============================================================
// PKCE AUTH
// ============================================================

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const rand = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[rand[i] % chars.length];
  return out;
}

async function startLogin() {
  if (!CLIENT_ID || CLIENT_ID === "DEINE_SPOTIFY_CLIENT_ID") {
    toast("Bitte zuerst CLIENT_ID in app.js eintragen (siehe README).", 5000);
    return;
  }
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  localStorage.setItem("zr_verifier", verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("zr_verifier");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Token-Austausch fehlgeschlagen");
  const data = await res.json();
  storeTokens(data);
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("zr_refresh_token");
  if (!refreshToken) return false;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return false;
  const data = await res.json();
  storeTokens(data);
  return true;
}

function storeTokens(data) {
  localStorage.setItem("zr_access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("zr_refresh_token", data.refresh_token);
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem("zr_expires_at", String(expiresAt));
}

async function getValidToken() {
  const expiresAt = Number(localStorage.getItem("zr_expires_at") || 0);
  if (Date.now() > expiresAt) {
    const ok = await refreshAccessToken();
    if (!ok) return null;
  }
  return localStorage.getItem("zr_access_token");
}

function isLoggedIn() {
  return !!localStorage.getItem("zr_refresh_token");
}

async function spotifyFetch(path, options = {}) {
  const token = await getValidToken();
  if (!token) throw new Error("Nicht eingeloggt");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res;
}

// ============================================================
// WEB PLAYBACK SDK
// ============================================================

window.onSpotifyWebPlaybackSDKReady = () => {
  sdkReady = true;
  initPlayerIfReady();
};

async function initPlayerIfReady() {
  if (!sdkReady || !isLoggedIn() || spotifyPlayer) return;
  const token = await getValidToken();
  if (!token) return;

  spotifyPlayer = new Spotify.Player({
    name: "Track Attack",
    getOAuthToken: async (cb) => cb(await getValidToken()),
    volume: 0.9,
  });

  spotifyPlayer.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
  });

  spotifyPlayer.addListener("not_ready", () => {
    deviceId = null;
  });

  spotifyPlayer.addListener("initialization_error", ({ message }) => toast("Player-Fehler: " + message));
  spotifyPlayer.addListener("authentication_error", () => toast("Anmeldung abgelaufen, bitte neu verbinden."));
  spotifyPlayer.addListener("account_error", () =>
    toast("Spotify Premium wird für die Wiedergabe benötigt.", 5000)
  );

  await spotifyPlayer.connect();
}

async function playSnippet(uri) {
  if (!deviceId) {
    toast("Player wird noch verbunden … kurz nochmal versuchen.");
    return false;
  }
  const res = await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri], position_ms: SNIPPET_START_MS }),
  });
  if (res.status === 404) {
    toast("Kein aktives Spotify-Gerät gefunden.");
    return false;
  }
  if (!res.ok && res.status !== 204) {
    toast("Wiedergabe konnte nicht gestartet werden.");
    return false;
  }
  return true;
}

async function pausePlayback() {
  if (!deviceId) return;
  await spotifyFetch(`/me/player/pause?device_id=${deviceId}`, { method: "PUT" });
}

// ============================================================
// SONG-AUFLÖSUNG (Titel/Künstler -> Spotify-URI)
// ============================================================

async function resolveTrackUri(song) {
  if (song.uri) return song.uri;
  const q = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
  const res = await spotifyFetch(`/search?q=${q}&type=track&limit=1`);
  if (!res.ok) return null;
  const data = await res.json();
  const track = data.tracks?.items?.[0];
  if (!track) return null;
  song.uri = track.uri;
  return track.uri;
}

// ============================================================
// SPIEL-LOGIK
// ============================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadSongs() {
  const res = await fetch("songs.json");
  allSongs = await res.json();
}

function startGame() {
  deck = shuffle(allSongs);
  timeline = [];
  currentSong = null;
  selectedGapIndex = null;
  $("score-goal").textContent = String(goal);
  $("player-chip").textContent = playerName;
  updateScore();
  renderTimeline();
  resetDiscUI();
  showScreen("game");
  drawFirstCardFree();
}

function updateScore() {
  $("score-count").textContent = String(timeline.length);
}

// Die allererste Karte wird gratis aufgedeckt, damit die Zeitleiste einen Startpunkt hat.
function drawFirstCardFree() {
  const song = deck.pop();
  timeline.push(song);
  updateScore();
  renderTimeline();
  drawNextCard();
}

function drawNextCard() {
  if (deck.length === 0) {
    // Deck erneut mischen falls Songs ausgehen (sollte bei ausreichend großer Liste selten sein)
    deck = shuffle(allSongs.filter((s) => !timeline.includes(s)));
  }
  currentSong = deck.pop();
  selectedGapIndex = null;
  resetDiscUI();
  $("mystery-status").textContent = "Tippe zum Abspielen";
  renderTimeline();
}

function resetDiscUI() {
  $("btn-play").classList.remove("playing");
  $("icon-play").classList.remove("hidden");
  $("icon-pause").classList.add("hidden");
  clearTimeout(snippetTimer);
}

async function togglePlay() {
  const btn = $("btn-play");
  const isPlaying = btn.classList.contains("playing");

  if (isPlaying) {
    resetDiscUI();
    await pausePlayback();
    return;
  }

  $("mystery-status").textContent = "Lade Song …";
  const uri = await resolveTrackUri(currentSong);
  if (!uri) {
    toast("Song auf Spotify nicht gefunden, nächster …");
    drawNextCard();
    return;
  }

  const started = await playSnippet(uri);
  if (!started) return;

  btn.classList.add("playing");
  $("icon-play").classList.add("hidden");
  $("icon-pause").classList.remove("hidden");
  $("mystery-status").textContent = "Läuft …";

  snippetTimer = setTimeout(async () => {
    await pausePlayback();
    resetDiscUI();
    $("mystery-status").textContent = "Wähle eine Position unten";
  }, SNIPPET_DURATION_MS);
}

// ---- Timeline rendering -------------------------------------------------

function renderTimeline() {
  const track = $("timeline-track");
  track.innerHTML = "";

  const sorted = [...timeline].sort((a, b) => a.year - b.year);

  if (sorted.length === 0) {
    track.innerHTML = '<div class="tl-empty-hint">Deine Zeitleiste ist leer</div>';
    return;
  }

  track.appendChild(makeGap(0));
  sorted.forEach((song, i) => {
    track.appendChild(makeCard(song));
    track.appendChild(makeGap(i + 1));
  });

  // Zur Mitte scrollen
  requestAnimationFrame(() => {
    track.scrollLeft = (track.scrollWidth - track.clientWidth) / 2;
  });
}

function makeCard(song) {
  const div = document.createElement("div");
  div.className = "tl-card";
  div.innerHTML = `<div class="tl-year">${song.year}</div><div class="tl-title">${escapeHtml(song.title)}</div>`;
  return div;
}

function makeGap(index) {
  const div = document.createElement("div");
  div.className = "tl-gap";
  div.dataset.index = String(index);
  div.innerHTML = '<div class="tl-gap-inner"></div>';
  div.addEventListener("click", () => selectGap(index));
  return div;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function selectGap(index) {
  if (!currentSong) {
    toast("Erst den Song abspielen.");
    return;
  }
  document.querySelectorAll(".tl-gap").forEach((g) => g.classList.remove("selected"));
  const gapEl = document.querySelector(`.tl-gap[data-index="${index}"]`);
  if (gapEl) gapEl.classList.add("selected");
  selectedGapIndex = index;
  confirmPlacement();
}

async function confirmPlacement() {
  if (selectedGapIndex === null || !currentSong) return;
  await pausePlayback();
  resetDiscUI();

  const sorted = [...timeline].sort((a, b) => a.year - b.year);
  const before = sorted[selectedGapIndex - 1];
  const after = sorted[selectedGapIndex];

  const correct =
    (!before || currentSong.year >= before.year) &&
    (!after || currentSong.year <= after.year);

  showReveal(correct);

  if (correct) {
    timeline.push(currentSong);
    updateScore();
  }
}

function showReveal(correct) {
  const overlay = $("reveal-overlay");
  const resultEl = $("reveal-result");
  resultEl.textContent = correct ? "Richtig platziert!" : "Leider falsch";
  resultEl.className = "reveal-result " + (correct ? "correct" : "wrong");
  $("reveal-year").textContent = String(currentSong.year);
  $("reveal-song").textContent = currentSong.title;
  $("reveal-artist").textContent = currentSong.artist;
  overlay.classList.remove("hidden");
}

function continueAfterReveal() {
  $("reveal-overlay").classList.add("hidden");
  currentSong = null;

  if (timeline.length >= goal) {
    $("win-text").textContent = `Deine Rille hat ${timeline.length} Treffer, ${playerName}!`;
    showScreen("win");
    return;
  }
  renderTimeline();
  drawNextCard();
}

// ============================================================
// EVENT WIRING
// ============================================================

$("btn-login").addEventListener("click", startLogin);
$("btn-continue").addEventListener("click", continueAfterReveal);
$("btn-play").addEventListener("click", togglePlay);
$("btn-again").addEventListener("click", () => showScreen("setup"));

$("btn-start").addEventListener("click", () => {
  const name = $("player-name").value.trim();
  if (name) playerName = name;
  startGame();
});

document.querySelectorAll(".stepper-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const step = Number(btn.dataset.step);
    goal = Math.min(20, Math.max(5, goal + step));
    $("goal-value").textContent = String(goal);
  });
});

// ============================================================
// INIT / BOOTSTRAP
// ============================================================

async function init() {
  await loadSongs();

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (code) {
    window.history.replaceState({}, "", REDIRECT_URI);
    try {
      await exchangeCodeForToken(code);
    } catch (e) {
      toast("Login fehlgeschlagen, bitte erneut versuchen.");
      showScreen("login");
      return;
    }
  }

  if (isLoggedIn()) {
    await initPlayerIfReady();
    showScreen("setup");
  } else {
    showScreen("login");
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

init();
