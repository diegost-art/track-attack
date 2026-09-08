/* ============================================================
   ZEITRILLE — Hitster-artiges Musik-Zeitleiste-Spiel
   Läuft komplett client-seitig gegen die Spotify Web API.
   ============================================================ */

// ---- KONFIGURATION -------------------------------------------------
// Trage hier deine Spotify Client-ID ein (siehe README.md, Schritt 1).
const CLIENT_ID = "DEINE_SPOTIFY_CLIENT_ID";
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
const MAX_PLAYERS = 8;
const CURRENT_YEAR = new Date().getFullYear();

// Jahrzehnte-Auswahl (Startjahr -> Label)
const DECADES = [
  { start: 1950, label: "50er" },
  { start: 1960, label: "60er" },
  { start: 1970, label: "70er" },
  { start: 1980, label: "80er" },
  { start: 1990, label: "90er" },
  { start: 2000, label: "2000er" },
  { start: 2010, label: "2010er" },
  { start: 2020, label: "2020er" },
];

// Genres für die Spotify-Suche (Suchfeld-Filter genre:"...")
const GENRES = [
  { key: "pop", label: "Pop" },
  { key: "rock", label: "Rock" },
  { key: "hip hop", label: "Hip-Hop" },
  { key: "dance", label: "Dance/Electronic" },
  { key: "metal", label: "Metal" },
  { key: "schlager", label: "Schlager/Deutschpop" },
  { key: "r-n-b", label: "R&B/Soul" },
  { key: "country", label: "Country" },
  { key: "latin", label: "Latin" },
  { key: "jazz", label: "Jazz" },
];

// ---- STATE -----------------------------------------------------------
let allSongs = [];        // kuratierte Klassiker-Liste (aus songs.json)
let curatedDeck = [];      // gemischte, gefilterte Kopie für den laufenden Run
let usedTrackIds = new Set(); // vermiedene Wiederholungen im Spotify-Modus

let players = [];          // [{ name, timeline: [] }]
let currentPlayerIndex = 0;

let currentSong = null;    // { title, artist, year, uri }
let selectedGapIndex = null;
let snippetTimer = null;

let goal = 10;
let sourceMode = "curated"; // "curated" | "spotify"
let selectedDecades = new Set();
let selectedGenres = new Set();

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
    name: "Zeitrille",
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
// SONGQUELLEN
// ============================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadCuratedSongs() {
  const res = await fetch("songs.json");
  allSongs = await res.json();
}

function decadeRanges() {
  // Liefert Liste von [start, end] Jahres-Bereichen entsprechend der Auswahl.
  // Leere Auswahl = kompletter Zeitraum.
  if (selectedDecades.size === 0) return [[1950, CURRENT_YEAR]];
  return [...selectedDecades].map((start) => [start, start + 9]);
}

function yearMatchesSelection(year) {
  return decadeRanges().some(([a, b]) => year >= a && year <= b);
}

function buildCuratedDeck() {
  const filtered = allSongs.filter((s) => yearMatchesSelection(s.year));
  curatedDeck = shuffle(filtered.length ? filtered : allSongs);
  if (!filtered.length) toast("Keine Klassiker in diesen Jahrzehnten, nehme alle.", 3500);
}

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

// Zieht eine zufällige Karte aus der kuratierten Liste und löst deren Spotify-URI auf.
async function drawCuratedCard() {
  if (curatedDeck.length === 0) buildCuratedDeck();
  const song = curatedDeck.pop();
  if (!song) return null;
  const uri = await resolveTrackUri(song);
  if (!uri) return drawCuratedCard(); // nicht gefunden -> nächste versuchen
  return { title: song.title, artist: song.artist, year: song.year, uri };
}

// Zieht eine zufällige Karte direkt aus dem gesamten Spotify-Katalog,
// gefiltert nach ausgewählten Jahrzehnten/Genres über die Such-API.
async function drawSpotifyCard(attempts = 0) {
  if (attempts > 8) {
    toast("Keine passenden Songs gefunden – Filter lockern?", 4000);
    return null;
  }

  const ranges = decadeRanges();
  const [start, end] = ranges[Math.floor(Math.random() * ranges.length)];
  const genre =
    selectedGenres.size > 0
      ? [...selectedGenres][Math.floor(Math.random() * selectedGenres.size)]
      : null;

  const parts = [`year:${start}-${end}`];
  if (genre) parts.push(`genre:"${genre}"`);
  const query = parts.join(" ");
  const offset = Math.floor(Math.random() * 150);

  const res = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=20&offset=${offset}&market=from_token`
  );
  if (!res.ok) return drawSpotifyCard(attempts + 1);

  const data = await res.json();
  const items = (data.tracks?.items || []).filter(
    (t) => t.album?.release_date && !usedTrackIds.has(t.id)
  );
  if (items.length === 0) return drawSpotifyCard(attempts + 1);

  const track = items[Math.floor(Math.random() * items.length)];
  usedTrackIds.add(track.id);
  const year = parseInt(track.album.release_date.slice(0, 4), 10);
  if (!year || year < 1900) return drawSpotifyCard(attempts + 1);

  return {
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    year,
    uri: track.uri,
  };
}

async function drawCard() {
  return sourceMode === "spotify" ? drawSpotifyCard() : drawCuratedCard();
}

// ============================================================
// SETUP UI (Spieler, Quelle, Filter)
// ============================================================

function renderPlayerRows() {
  const wrap = $("player-rows");
  wrap.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <input type="text" maxlength="20" placeholder="Spieler ${i + 1}" value="${escapeHtml(p.name)}" />
    `;
    const input = row.querySelector("input");
    input.addEventListener("input", () => (p.name = input.value));

    if (players.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "player-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        players.splice(i, 1);
        renderPlayerRows();
      });
      row.appendChild(removeBtn);
    }
    wrap.appendChild(row);
  });
  $("btn-add-player").classList.toggle("hidden", players.length >= MAX_PLAYERS);
}

function addPlayer() {
  if (players.length >= MAX_PLAYERS) return;
  players.push({ name: "", timeline: [] });
  renderPlayerRows();
}

function renderDecadeChips() {
  const wrap = $("decade-chips");
  wrap.innerHTML = "";
  DECADES.forEach((d) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = d.label;
    chip.addEventListener("click", () => {
      if (selectedDecades.has(d.start)) selectedDecades.delete(d.start);
      else selectedDecades.add(d.start);
      chip.classList.toggle("selected", selectedDecades.has(d.start));
    });
    wrap.appendChild(chip);
  });
}

function renderGenreChips() {
  const wrap = $("genre-chips");
  wrap.innerHTML = "";
  GENRES.forEach((g) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = g.label;
    chip.addEventListener("click", () => {
      if (selectedGenres.has(g.key)) selectedGenres.delete(g.key);
      else selectedGenres.add(g.key);
      chip.classList.toggle("selected", selectedGenres.has(g.key));
    });
    wrap.appendChild(chip);
  });
}

function setSourceMode(mode) {
  sourceMode = mode;
  document.querySelectorAll(".toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.source === mode);
  });
  $("genre-field").classList.toggle("disabled", mode !== "spotify");
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// SPIEL-LOGIK
// ============================================================

function currentPlayer() {
  return players[currentPlayerIndex];
}

async function startGame() {
  players.forEach((p, i) => {
    if (!p.name.trim()) p.name = `Spieler ${i + 1}`;
    p.timeline = [];
  });
  currentPlayerIndex = 0;
  currentSong = null;
  selectedGapIndex = null;
  usedTrackIds = new Set();
  if (sourceMode === "curated") buildCuratedDeck();

  $("score-goal").textContent = String(goal);
  showScreen("game");
  $("mystery-status").textContent = "Bereite Spiel vor …";
  resetDiscUI();

  await dealStarterCards();
  updateHeader();
  renderTimeline();
  drawNextCard();
}

async function dealStarterCards() {
  for (const p of players) {
    const card = await drawCard();
    if (card) p.timeline.push(card);
  }
}

function updateHeader() {
  $("player-chip").textContent = currentPlayer().name;
  $("score-count").textContent = String(currentPlayer().timeline.length);
  renderStandings();
}

function renderStandings() {
  const row = $("standings-row");
  row.innerHTML = "";
  if (players.length < 2) return;
  players.forEach((p, i) => {
    const pill = document.createElement("span");
    pill.className = "standing-pill" + (i === currentPlayerIndex ? " current" : "");
    pill.textContent = `${p.name}: ${p.timeline.length}`;
    row.appendChild(pill);
  });
}

async function drawNextCard() {
  currentSong = null;
  selectedGapIndex = null;
  resetDiscUI();
  $("mystery-status").textContent = "Sucht Song …";

  const card = await drawCard();
  if (!card) {
    $("mystery-status").textContent = "Keine Songs mehr verfügbar";
    return;
  }
  currentSong = card;
  $("mystery-status").textContent = "Tippe zum Abspielen";
}

function resetDiscUI() {
  $("btn-play").classList.remove("playing");
  $("icon-play").classList.remove("hidden");
  $("icon-pause").classList.add("hidden");
  clearTimeout(snippetTimer);
}

async function togglePlay() {
  if (!currentSong) return;
  const btn = $("btn-play");
  const isPlaying = btn.classList.contains("playing");

  if (isPlaying) {
    resetDiscUI();
    await pausePlayback();
    return;
  }

  const started = await playSnippet(currentSong.uri);
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

  const sorted = [...currentPlayer().timeline].sort((a, b) => a.year - b.year);

  if (sorted.length === 0) {
    track.innerHTML = '<div class="tl-empty-hint">Deine Zeitleiste ist leer</div>';
    return;
  }

  track.appendChild(makeGap(0));
  sorted.forEach((song, i) => {
    track.appendChild(makeCard(song));
    track.appendChild(makeGap(i + 1));
  });

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

  const timeline = currentPlayer().timeline;
  const sorted = [...timeline].sort((a, b) => a.year - b.year);
  const before = sorted[selectedGapIndex - 1];
  const after = sorted[selectedGapIndex];

  const correct =
    (!before || currentSong.year >= before.year) &&
    (!after || currentSong.year <= after.year);

  showReveal(correct);

  if (correct) {
    timeline.push(currentSong);
    updateHeader();
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

async function continueAfterReveal() {
  $("reveal-overlay").classList.add("hidden");
  currentSong = null;

  const winner = players.find((p) => p.timeline.length >= goal);
  if (winner) {
    showWinScreen();
    return;
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  updateHeader();
  renderTimeline();
  await drawNextCard();
}

function showWinScreen() {
  const ranked = [...players].sort((a, b) => b.timeline.length - a.timeline.length);
  $("win-text").textContent =
    players.length > 1
      ? `${ranked[0].name} gewinnt mit ${ranked[0].timeline.length} Treffern!`
      : `Deine Rille hat ${ranked[0].timeline.length} Treffer, ${ranked[0].name}!`;

  const wrap = $("win-standings");
  wrap.innerHTML = "";
  if (players.length > 1) {
    ranked.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "standing-row" + (i === 0 ? " winner" : "");
      row.innerHTML = `<span><span class="rank">${i + 1}.</span>${escapeHtml(p.name)}</span><span>${p.timeline.length}</span>`;
      wrap.appendChild(row);
    });
  }
  showScreen("win");
}

// ============================================================
// EVENT WIRING
// ============================================================

$("btn-login").addEventListener("click", startLogin);
$("btn-continue").addEventListener("click", continueAfterReveal);
$("btn-play").addEventListener("click", togglePlay);
$("btn-again").addEventListener("click", () => showScreen("setup"));
$("btn-add-player").addEventListener("click", addPlayer);

$("btn-start").addEventListener("click", () => {
  startGame();
});

document.querySelectorAll(".stepper-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const step = Number(btn.dataset.step);
    goal = Math.min(20, Math.max(3, goal + step));
    $("goal-value").textContent = String(goal);
  });
});

document.querySelectorAll(".toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => setSourceMode(btn.dataset.source));
});

// ============================================================
// INIT / BOOTSTRAP
// ============================================================

async function init() {
  await loadCuratedSongs();

  players = [{ name: "", timeline: [] }];
  renderPlayerRows();
  renderDecadeChips();
  renderGenreChips();
  setSourceMode("curated");

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
