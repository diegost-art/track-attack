/* ============================================================
   TRACK ATTACK — Hitster-artiges Musik-Zeitleiste-Spiel
   Lokal (1 Gerät) oder Online (mehrere Geräte via Firebase + QR-Code).
   Spotify-Wiedergabe läuft in beiden Fällen ausschließlich über das
   Gerät des Gastgebers (Web Playback SDK erlaubt kein Multi-Device-Sync).
   ============================================================ */

// ---- KONFIGURATION -------------------------------------------------
const CLIENT_ID = "c88ea2eefa8842ab806695da036851d6";
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

const SNIPPET_START_MS = 25000;
const SNIPPET_DURATION_MS = 30000;
const MAX_PLAYERS = 8;

// 8 handgezeichnete Disco-Avatare — ein Avatar pro Spielerplatz (Reihenfolge = Index).
function avatarSrc(index) {
  return `avatars/avatar-${(index % MAX_PLAYERS) + 1}.svg`;
}
const CURRENT_YEAR = new Date().getFullYear();
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I
const QR_API = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=";

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

// ---- STATE: gemeinsam -------------------------------------------------
let allSongs = [];
let curatedDeck = [];
let usedTrackIds = new Set();

let goal = 10;
let sourceMode = "curated"; // "curated" | "spotify"
let selectedDecades = new Set();
let selectedGenres = new Set();

let snippetTimer = null;
let selectedGapIndex = null;

let spotifyPlayer = null;
let deviceId = null;
let sdkReady = false;
let audioElementActivated = false;

// ---- STATE: lokaler Hot-Seat-Modus -------------------------------------
let setupMode = "local"; // "local" | "online" (nur im Setup-Screen relevant)
let players = [];        // [{ name, timeline: [] }] — nur lokaler Modus
let currentPlayerIndex = 0;
let currentSong = null;  // aktuelle geheime Karte (lokal & Host)

// ---- STATE: Online-Modus (Firebase) ------------------------------------
let onlineMode = false;
let isHost = false;
let isGuest = false;
let roomCode = null;
let myPlayerId = null;
let roomRef = null;
let roomState = null;
let lastShownRevealTs = null;

// ---- DOM SHORTCUTS -----------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = {
  login: $("screen-login"),
  join: $("screen-join"),
  lobby: $("screen-lobby"),
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

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomString(len, chars) {
  const set = chars || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const rand = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += set[rand[i] % set.length];
  return out;
}

// ============================================================
// PKCE AUTH (nur Host)
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
  storeTokens(await res.json());
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
  storeTokens(await res.json());
  return true;
}

function storeTokens(data) {
  localStorage.setItem("zr_access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("zr_refresh_token", data.refresh_token);
  localStorage.setItem("zr_expires_at", String(Date.now() + (data.expires_in - 60) * 1000));
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

function fakeFailedResponse(status, message) {
  // Einheitliche "Response"-Form, damit alle Aufrufer nur res.ok/res.status
  // prüfen müssen und nichts unerwartet eine Exception wirft.
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
    clone() { return this; },
  };
}

async function spotifyFetch(path, options = {}, isRetry = false) {
  const token = await getValidToken();
  if (!token) {
    console.error("spotifyFetch: kein gültiger Token vorhanden für", path);
    return fakeFailedResponse(401, "Nicht eingeloggt");
  }
  let res;
  try {
    res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (networkErr) {
    console.error("Netzwerkfehler bei Spotify-Anfrage", path, networkErr);
    return fakeFailedResponse(0, "Netzwerkfehler");
  }

  // Token evtl. serverseitig invalidiert, obwohl unsere lokale Ablaufzeit noch gültig
  // aussah -> einmalig mit erzwungener Erneuerung wiederholen, bevor wir aufgeben.
  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return spotifyFetch(path, options, true);
  }

  if (!res.ok && res.status !== 204) {
    let detail = "";
    try { detail = (await res.clone().json())?.error?.message || ""; } catch {}
    console.error(`Spotify-API-Fehler ${res.status} bei ${path}`, detail);
  }

  return res;
}

// ============================================================
// WEB PLAYBACK SDK (nur Host)
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

  spotifyPlayer.addListener("ready", ({ device_id }) => { deviceId = device_id; });
  spotifyPlayer.addListener("not_ready", () => { deviceId = null; });
  spotifyPlayer.addListener("initialization_error", ({ message }) => toast("Player-Fehler: " + message));
  spotifyPlayer.addListener("authentication_error", () => toast("Anmeldung abgelaufen, bitte neu verbinden."));
  spotifyPlayer.addListener("account_error", () => toast("Spotify Premium wird für die Wiedergabe benötigt.", 5000));
  spotifyPlayer.addListener("autoplay_failed", () => {
    toast("Browser blockiert automatische Wiedergabe — bitte nochmal auf Play tippen.", 4500);
  });

  await spotifyPlayer.connect();
}

// Mobile Browser (v. a. iOS Safari, teils Android Chrome) blockieren Audio,
// das über die REST-API auf diesem Gerät gestartet wird, als "Autoplay",
// weil der eigentliche Play-Befehl per Netzwerk-Umweg über Spotifys Server
// läuft statt direkt im Klick-Moment. activateElement() "entriegelt" den
// Audio-Kontext einmalig innerhalb eines echten Nutzer-Tips.
// Siehe: https://developer.spotify.com/documentation/web-playback-sdk/reference/#api-spotify-player-activateelement
async function unlockAudioElement() {
  if (audioElementActivated || !spotifyPlayer) return;
  try {
    await spotifyPlayer.activateElement();
    audioElementActivated = true;
  } catch (e) {
    console.warn("activateElement() fehlgeschlagen:", e);
  }
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
  if (res.status === 404) { toast("Kein aktives Spotify-Gerät gefunden."); return false; }
  if (!res.ok && res.status !== 204) { toast("Wiedergabe konnte nicht gestartet werden."); return false; }
  return true;
}

async function pausePlayback() {
  if (!deviceId) return;
  await spotifyFetch(`/me/player/pause?device_id=${deviceId}`, { method: "PUT" });
}

// ============================================================
// SONGQUELLEN (läuft immer auf dem Host-Gerät)
// ============================================================

async function loadCuratedSongs() {
  const res = await fetch("songs.json");
  allSongs = await res.json();
}

function decadeRanges() {
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
  // Titel/Artist in Anführungszeichen: verhindert Fehltreffer bei Klammern,
  // Apostrophen o. Ä. (z. B. "(I Can't Get No) Satisfaction").
  const q = encodeURIComponent(`track:"${song.title}" artist:"${song.artist}"`);
  const res = await spotifyFetch(`/search?q=${q}&type=track&limit=1`);
  if (!res.ok) return { error: res.status };
  const data = await res.json();
  const track = data.tracks?.items?.[0];
  if (!track) return null;
  song.uri = track.uri;
  return track.uri;
}

async function drawCuratedCard(attempts = 0) {
  if (attempts > 15) {
    toast("Songsuche schlägt wiederholt fehl — Spotify-Verbindung prüfen.", 4500);
    return null;
  }
  if (curatedDeck.length === 0) buildCuratedDeck();
  const song = curatedDeck.pop();
  if (!song) return null;
  const result = await resolveTrackUri(song);
  if (!result) return drawCuratedCard(attempts + 1);
  if (typeof result === "object" && result.error) {
    if (result.error === 401 || result.error === 403) {
      toast("Spotify-Sitzung ungültig — bitte neu verbinden.", 5000);
      return null;
    }
    return drawCuratedCard(attempts + 1);
  }
  return { title: song.title, artist: song.artist, year: song.year, uri: result };
}

async function drawSpotifyCard(attempts = 0) {
  if (attempts > 8) {
    toast("Keine passenden Songs gefunden – Filter lockern?", 4000);
    return null;
  }
  const ranges = decadeRanges();
  const [start, end] = ranges[Math.floor(Math.random() * ranges.length)];
  const genre = selectedGenres.size > 0
    ? [...selectedGenres][Math.floor(Math.random() * selectedGenres.size)]
    : null;

  // Spotify liefert bei einer REINEN Feldfilter-Suche (z. B. nur "year:1950-2026"
  // ohne jeden weiteren Begriff) unzuverlässig leere Ergebnisse — ein bekanntes,
  // undokumentiertes Verhalten der Such-API. Ein zufälliger Buchstabe als
  // Freitext-Begriff davor behebt das und sorgt nebenbei für mehr Zufallsstreuung.
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const randomLetter = letters[Math.floor(Math.random() * letters.length)];
  const parts = [randomLetter, `year:${start}-${end}`];
  if (genre) parts.push(`genre:"${genre}"`);
  const query = parts.join(" ");
  // Ab ein paar erfolglosen Versuchen auf Offset 0 zurückfallen — das ist so gut
  // wie immer gültig, unabhängig davon, wie klein die Trefferzahl für diese
  // Buchstabe/Jahr-Kombination ausfällt (schützt vor "Invalid limit"-Fehlern).
  const offset = attempts >= 3 ? 0 : Math.floor(Math.random() * 20);

  const res = await spotifyFetch(
    // Seit Spotifys Development-Mode-Umstellung (März 2026) ist limit für /search
    // auf max. 10 begrenzt (vorher 50) — höhere Werte liefern einen 400-Fehler
    // "Invalid limit". Siehe: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
    `/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=${offset}`
  );
  if (res.status === 401 || res.status === 403) {
    toast("Spotify-Sitzung ungültig — bitte neu verbinden.", 5000);
    return null;
  }
  if (!res.ok) {
    console.warn(`Spotify-Suche fehlgeschlagen (${res.status}, Versuch ${attempts + 1}/8): "${query}", offset=${offset}`);
    return drawSpotifyCard(attempts + 1);
  }

  const data = await res.json();
  const items = (data.tracks?.items || []).filter(
    (t) => t.album?.release_date && !usedTrackIds.has(t.id)
  );
  if (items.length === 0) {
    console.warn(`Spotify-Suche ohne Treffer (Versuch ${attempts + 1}/8): "${query}", offset=${offset}, total=${data.tracks?.total ?? "?"}`);
    return drawSpotifyCard(attempts + 1);
  }

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
// FIREBASE / ONLINE-RAUM
// ============================================================

function firebaseUsable() {
  try {
    return (
      typeof firebase !== "undefined" &&
      firebase.apps.length > 0 &&
      firebase.apps[0].options.apiKey !== "DEIN_API_KEY"
    );
  } catch {
    return false;
  }
}

function getOrCreatePlayerId(code) {
  const key = `zr_pid_${code}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = randomString(12);
    localStorage.setItem(key, id);
  }
  return id;
}

async function createRoom(hostName) {
  if (!firebaseUsable()) {
    toast("Firebase ist noch nicht konfiguriert (siehe README).", 5000);
    return;
  }
  roomCode = randomString(5, ROOM_CODE_CHARS);
  myPlayerId = getOrCreatePlayerId(roomCode);
  isHost = true;
  isGuest = false;
  onlineMode = true;

  const initialState = {
    hostId: myPlayerId,
    status: "lobby",
    settings: {
      goal,
      sourceMode,
      decades: [...selectedDecades],
      genres: [...selectedGenres],
    },
    order: [myPlayerId],
    players: { [myPlayerId]: { name: hostName || "Gastgeber", timeline: [] } },
    turn: null,
    pendingPlacement: null,
    lastReveal: null,
    winnerId: null,
  };

  roomRef = firebase.database().ref("rooms/" + roomCode);
  await roomRef.set(initialState);
  subscribeToRoom();
  showLobby();
}

async function joinRoom(code, name) {
  if (!firebaseUsable()) {
    toast("Firebase ist noch nicht konfiguriert.", 5000);
    return;
  }
  roomCode = code.toUpperCase();
  myPlayerId = getOrCreatePlayerId(roomCode);
  isGuest = true;
  isHost = false;
  onlineMode = true;

  roomRef = firebase.database().ref("rooms/" + roomCode);
  const snap = await roomRef.get();
  if (!snap.exists()) {
    $("join-note").textContent = "Diesen Raum gibt es nicht (mehr).";
    return;
  }

  await roomRef.child(`players/${myPlayerId}`).set({ name: name || "Spieler", timeline: [] });
  await roomRef.child("order").transaction((current) => {
    current = current || [];
    if (!current.includes(myPlayerId)) current.push(myPlayerId);
    return current;
  });

  subscribeToRoom();
  showLobby();
}

function subscribeToRoom() {
  roomRef.on("value", (snap) => {
    roomState = snap.val();
    if (!roomState) return;
    onRoomUpdate();
  });
}

function showLobby() {
  showScreen("lobby");
  $("lobby-host-block").classList.toggle("hidden", !isHost);
  $("lobby-guest-note").classList.toggle("hidden", isHost);
  $("btn-lobby-start").classList.toggle("hidden", !isHost);
  if (isHost) {
    const joinUrl = `${REDIRECT_URI}?room=${roomCode}`;
    $("lobby-qr").src = QR_API + encodeURIComponent(joinUrl);
    $("lobby-code").textContent = roomCode;
  }
}

function renderLobbyPlayers() {
  const wrap = $("lobby-players");
  wrap.innerHTML = "";
  const order = roomState.order || Object.keys(roomState.players || {});
  order.forEach((pid, i) => {
    const p = roomState.players?.[pid];
    if (!p) return;
    const row = document.createElement("div");
    row.className = "standing-row";
    row.innerHTML = `<span><img class="avatar avatar-sm" alt="" src="${avatarSrc(i)}" />${escapeHtml(p.name)}${pid === roomState.hostId ? " 🎧" : ""}</span>`;
    wrap.appendChild(row);
  });
}

// Zentrale Reaktion auf jede Änderung des Raumzustands (bei allen Geräten).
function onRoomUpdate() {
  if (roomState.status === "lobby") {
    renderLobbyPlayers();
  } else if (roomState.status === "playing") {
    if (screens.game.classList.contains("hidden")) {
      showScreen("game");
      $("score-goal").textContent = String(roomState.settings.goal);
    }
    renderOnlineGame();
    if (isHost) hostWatchPendingPlacement();
  } else if (roomState.status === "finished") {
    showOnlineWinScreen();
  }
}

function amIActivePlayer() {
  return !!roomState?.turn && roomState.turn.currentPlayerId === myPlayerId;
}

function orderedPlayers() {
  const order = roomState.order || Object.keys(roomState.players || {});
  return order.map((pid) => ({ id: pid, ...roomState.players[pid] })).filter((p) => p.name);
}

function renderOnlineGame() {
  const turn = roomState.turn;
  if (!turn) return;
  const order = roomState.order || [];
  const activeIndex = order.indexOf(turn.currentPlayerId);
  const activeName = roomState.players[turn.currentPlayerId]?.name || "?";
  $("player-chip").textContent = activeName;
  $("turn-avatar").src = avatarSrc(activeIndex >= 0 ? activeIndex : 0);

  const activeTimeline = roomState.players[turn.currentPlayerId]?.timeline || [];
  $("score-count").textContent = String(activeTimeline.length);

  // Standings
  const row = $("standings-row");
  row.innerHTML = "";
  orderedPlayers().forEach((p, i) => {
    const pill = document.createElement("span");
    pill.className = "standing-pill" + (p.id === turn.currentPlayerId ? " current" : "");
    pill.innerHTML = `<img class="avatar avatar-sm" alt="" src="${avatarSrc(i)}" />${escapeHtml(p.name)}: ${(p.timeline || []).length}`;
    row.appendChild(pill);
  });

  // Disc: nur Host hat Kontrolle
  const isMeHost = isHost;
  $("btn-play").classList.toggle("hidden", !isMeHost);
  if (isMeHost) {
    const playing = turn.cardState === "playing";
    $("btn-play").classList.toggle("playing", playing);
    $("icon-play").classList.toggle("hidden", playing);
    $("icon-pause").classList.toggle("hidden", !playing);
  }

  if (!isMeHost) {
    const statusText = {
      idle: "Nächster Song wird vorbereitet …",
      loaded: amIActivePlayer() ? `Bereit — der Gastgeber spielt deinen Song ab` : `${activeName} ist dran — gleich geht's los`,
      playing: "🎧 Song läuft beim Gastgeber …",
      awaiting_placement: amIActivePlayer() ? "Wähle deine Position unten" : `${activeName} platziert gerade …`,
    }[turn.cardState] || "";
    $("mystery-status").textContent = statusText;
  } else {
    $("mystery-status").textContent = {
      idle: "Sucht Song …",
      loaded: "Tippe zum Abspielen",
      playing: "Läuft …",
      awaiting_placement: amIActivePlayer() ? "Wähle deine Position unten" : `Warte auf ${activeName} …`,
    }[turn.cardState] || "";
  }

  renderTimelineGeneric(activeTimeline, amIActivePlayer() && turn.cardState === "awaiting_placement");

  // Reveal-Overlay synchron zeigen
  if (roomState.lastReveal && roomState.lastReveal.ts !== lastShownRevealTs) {
    lastShownRevealTs = roomState.lastReveal.ts;
    displayReveal(roomState.lastReveal.correct, roomState.lastReveal.song);
    $("btn-continue").classList.toggle("hidden", !isHost);
  } else if (!roomState.lastReveal) {
    $("reveal-overlay").classList.add("hidden");
  }
}

// Host: startet die Runde aus der Lobby heraus
async function startOnlineGame() {
  buildFiltersFromInputs();
  await roomRef.child("settings").set({
    goal,
    sourceMode,
    decades: [...selectedDecades],
    genres: [...selectedGenres],
  });
  if (sourceMode === "curated") buildCuratedDeck();
  usedTrackIds = new Set();

  const order = roomState.order;
  for (const pid of order) {
    const card = await drawCard();
    if (card) await roomRef.child(`players/${pid}/timeline`).set([card]);
  }
  await roomRef.child("turn").set({ currentPlayerId: order[0], cardState: "idle" });
  await roomRef.child("status").set("playing");
  hostDrawNextCard();
}

async function hostDrawNextCard() {
  currentSong = await drawCard();
  await roomRef.child("turn/cardState").set(currentSong ? "loaded" : "idle");
}

// Host: Disc-Button in Online-Runden
async function hostTogglePlayOnline() {
  if (!currentSong) return;
  await unlockAudioElement();
  const playing = roomState.turn.cardState === "playing";
  if (playing) {
    clearTimeout(snippetTimer);
    await pausePlayback();
    await roomRef.child("turn/cardState").set("loaded");
    return;
  }
  const started = await playSnippet(currentSong.uri);
  if (!started) return;
  spotifyPlayer?.resume().catch(() => {}); // zusätzlicher Nudge gegen Mobile-Autoplay-Blocker
  await roomRef.child("turn/cardState").set("playing");

  snippetTimer = setTimeout(async () => {
    await pausePlayback();
    await roomRef.child("turn/cardState").set("awaiting_placement");
  }, SNIPPET_DURATION_MS);
}

// Host: beobachtet Platzierungs-Anfragen von Mitspieler-Geräten
function hostWatchPendingPlacement() {
  if (!roomState.pendingPlacement) return;
  const { playerId, gapIndex } = roomState.pendingPlacement;
  resolvePlacement(playerId, gapIndex);
  roomRef.child("pendingPlacement").set(null);
}

async function resolvePlacement(playerId, gapIndex) {
  const timeline = roomState.players[playerId]?.timeline || [];
  const sorted = [...timeline].sort((a, b) => a.year - b.year);
  const before = sorted[gapIndex - 1];
  const after = sorted[gapIndex];
  const correct =
    (!before || currentSong.year >= before.year) &&
    (!after || currentSong.year <= after.year);

  if (correct) {
    const newTimeline = [...timeline, currentSong];
    await roomRef.child(`players/${playerId}/timeline`).set(newTimeline);
  }
  await roomRef.child("lastReveal").set({
    playerId,
    correct,
    song: currentSong,
    ts: Date.now(),
  });
}

// Host: "Weiter" nach dem Reveal im Online-Modus
async function hostContinueOnline() {
  await roomRef.child("lastReveal").set(null);

  const players = orderedPlayers();
  const winner = players.find((p) => (p.timeline || []).length >= roomState.settings.goal);
  if (winner) {
    await roomRef.child("winnerId").set(winner.id);
    await roomRef.child("status").set("finished");
    return;
  }

  const order = roomState.order;
  const curIdx = order.indexOf(roomState.turn.currentPlayerId);
  const nextId = order[(curIdx + 1) % order.length];
  await roomRef.child("turn/currentPlayerId").set(nextId);
  await hostDrawNextCard();
}

function showOnlineWinScreen() {
  const players = orderedPlayers().sort((a, b) => (b.timeline || []).length - (a.timeline || []).length);
  const winner = players[0];
  $("win-text").textContent = `${winner.name} gewinnt mit ${(winner.timeline || []).length} Treffern!`;
  const wrap = $("win-standings");
  wrap.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "standing-row" + (i === 0 ? " winner" : "");
    const origIndex = (roomState.order || []).indexOf(p.id);
    row.innerHTML = `<span><span class="rank">${i + 1}.</span><img class="avatar avatar-sm" alt="" src="${avatarSrc(origIndex >= 0 ? origIndex : 0)}" />${escapeHtml(p.name)}</span><span>${(p.timeline || []).length}</span>`;
    wrap.appendChild(row);
  });
  showScreen("win");
}

// ============================================================
// SETUP UI
// ============================================================

function renderPlayerRows() {
  const wrap = $("player-rows");
  wrap.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<img class="avatar avatar-md" alt="" src="${avatarSrc(i)}" /><input type="text" maxlength="20" placeholder="Spieler ${i + 1}" value="${escapeHtml(p.name)}" />`;
    const input = row.querySelector("input");
    input.addEventListener("input", () => (p.name = input.value));
    if (players.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "player-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => { players.splice(i, 1); renderPlayerRows(); });
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
  document.querySelectorAll(".toggle-btn[data-source]").forEach((b) => {
    b.classList.toggle("active", b.dataset.source === mode);
  });
  $("genre-field").classList.toggle("disabled", mode !== "spotify");
}

function setSetupMode(mode) {
  setupMode = mode;
  document.querySelectorAll(".toggle-btn[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  $("local-players-field").classList.toggle("hidden", mode !== "local");
  $("online-host-field").classList.toggle("hidden", mode !== "online");
  $("btn-start").classList.toggle("hidden", mode !== "local");
  $("btn-create-room").classList.toggle("hidden", mode !== "online");
}

function buildFiltersFromInputs() {
  // Decades/Genres werden bereits live in den Sets gepflegt; nichts weiter zu tun.
}

// ============================================================
// LOKALER HOT-SEAT-MODUS
// ============================================================

function currentPlayer() {
  return players[currentPlayerIndex];
}

async function startLocalGame() {
  onlineMode = false;
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
  $("btn-play").classList.remove("hidden");
  $("btn-continue").classList.remove("hidden");

  for (const p of players) {
    const card = await drawCard();
    if (card) p.timeline.push(card);
  }
  updateLocalHeader();
  renderTimelineGeneric(currentPlayer().timeline, true);
  await drawNextLocalCard();
}

function updateLocalHeader() {
  $("player-chip").textContent = currentPlayer().name;
  $("turn-avatar").src = avatarSrc(currentPlayerIndex);
  $("score-count").textContent = String(currentPlayer().timeline.length);
  const row = $("standings-row");
  row.innerHTML = "";
  if (players.length < 2) return;
  players.forEach((p, i) => {
    const pill = document.createElement("span");
    pill.className = "standing-pill" + (i === currentPlayerIndex ? " current" : "");
    pill.innerHTML = `<img class="avatar avatar-sm" alt="" src="${avatarSrc(i)}" />${escapeHtml(p.name)}: ${p.timeline.length}`;
    row.appendChild(pill);
  });
}

async function drawNextLocalCard() {
  currentSong = null;
  selectedGapIndex = null;
  resetDiscUI();
  $("mystery-status").textContent = "Sucht Song …";
  const card = await drawCard();
  if (!card) { $("mystery-status").textContent = "Keine Songs mehr verfügbar"; return; }
  currentSong = card;
  $("mystery-status").textContent = "Tippe zum Abspielen";
}

function resetDiscUI() {
  $("btn-play").classList.remove("playing");
  $("icon-play").classList.remove("hidden");
  $("icon-pause").classList.add("hidden");
  clearTimeout(snippetTimer);
}

async function togglePlayLocal() {
  if (!currentSong) return;
  await unlockAudioElement();
  const btn = $("btn-play");
  const isPlaying = btn.classList.contains("playing");
  if (isPlaying) { resetDiscUI(); await pausePlayback(); return; }

  const started = await playSnippet(currentSong.uri);
  if (!started) return;
  spotifyPlayer?.resume().catch(() => {}); // zusätzlicher Nudge gegen Mobile-Autoplay-Blocker
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

async function confirmPlacementLocal(gapIndex) {
  await pausePlayback();
  resetDiscUI();
  const timeline = currentPlayer().timeline;
  const sorted = [...timeline].sort((a, b) => a.year - b.year);
  const before = sorted[gapIndex - 1];
  const after = sorted[gapIndex];
  const correct = (!before || currentSong.year >= before.year) && (!after || currentSong.year <= after.year);

  displayReveal(correct, currentSong);
  if (correct) {
    timeline.push(currentSong);
    updateLocalHeader();
  }
}

async function continueLocal() {
  $("reveal-overlay").classList.add("hidden");
  currentSong = null;

  const winner = players.find((p) => p.timeline.length >= goal);
  if (winner) {
    $("win-text").textContent = players.length > 1
      ? `${winner.name} gewinnt mit ${winner.timeline.length} Treffern!`
      : `Deine Rille hat ${winner.timeline.length} Treffer, ${winner.name}!`;
    const ranked = [...players].sort((a, b) => b.timeline.length - a.timeline.length);
    const wrap = $("win-standings");
    wrap.innerHTML = "";
    if (players.length > 1) {
      ranked.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "standing-row" + (i === 0 ? " winner" : "");
        const origIndex = players.indexOf(p);
        row.innerHTML = `<span><span class="rank">${i + 1}.</span><img class="avatar avatar-sm" alt="" src="${avatarSrc(origIndex)}" />${escapeHtml(p.name)}</span><span>${p.timeline.length}</span>`;
        wrap.appendChild(row);
      });
    } else {
      wrap.innerHTML = "";
    }
    showScreen("win");
    return;
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  updateLocalHeader();
  renderTimelineGeneric(currentPlayer().timeline, true);
  await drawNextLocalCard();
}

// ============================================================
// GEMEINSAME TIMELINE-/REVEAL-DARSTELLUNG
// ============================================================

function renderTimelineGeneric(timeline, interactive) {
  const track = $("timeline-track");
  track.innerHTML = "";
  const sorted = [...timeline].sort((a, b) => a.year - b.year);

  if (sorted.length === 0) {
    track.innerHTML = '<div class="tl-empty-hint">Zeitleiste ist leer</div>';
    return;
  }

  track.appendChild(makeGap(0, interactive));
  sorted.forEach((song, i) => {
    track.appendChild(makeCard(song));
    track.appendChild(makeGap(i + 1, interactive));
  });

  requestAnimationFrame(() => {
    track.scrollLeft = (track.scrollWidth - track.clientWidth) / 2;
  });

  $("timeline-hint").textContent = interactive
    ? "Wähle die Position in der Zeitleiste:"
    : "Zeitleiste (nicht deine Runde)";
}

function makeCard(song) {
  const div = document.createElement("div");
  div.className = "tl-card";
  div.innerHTML = `<div class="tl-year">${song.year}</div><div class="tl-title">${escapeHtml(song.title)}</div>`;
  return div;
}

function makeGap(index, interactive) {
  const div = document.createElement("div");
  div.className = "tl-gap" + (interactive ? "" : " locked");
  div.dataset.index = String(index);
  div.innerHTML = '<div class="tl-gap-inner"></div>';
  if (interactive) div.addEventListener("click", () => handleGapClick(index));
  return div;
}

function handleGapClick(index) {
  if (!currentSong && !onlineMode) {
    toast("Erst den Song abspielen.");
    return;
  }
  document.querySelectorAll(".tl-gap").forEach((g) => g.classList.remove("selected"));
  const gapEl = document.querySelector(`.tl-gap[data-index="${index}"]`);
  if (gapEl) gapEl.classList.add("selected");
  selectedGapIndex = index;

  if (onlineMode) {
    if (isHost && amIActivePlayer()) {
      resolvePlacement(myPlayerId, index).then(() => {
        // Host löst sofort lokal auf; lastReveal-Listener übernimmt die Anzeige.
      });
    } else if (!isHost && amIActivePlayer()) {
      roomRef.child("pendingPlacement").set({ playerId: myPlayerId, gapIndex: index });
    }
  } else {
    confirmPlacementLocal(index);
  }
}

function displayReveal(correct, song) {
  const overlay = $("reveal-overlay");
  const resultEl = $("reveal-result");
  resultEl.textContent = correct ? "Richtig platziert!" : "Leider falsch";
  resultEl.className = "reveal-result " + (correct ? "correct" : "wrong");
  $("reveal-year").textContent = String(song.year);
  $("reveal-song").textContent = song.title;
  $("reveal-artist").textContent = song.artist;
  overlay.classList.remove("hidden");
}

// ============================================================
// EVENT WIRING
// ============================================================

$("btn-login").addEventListener("click", startLogin);

$("btn-toggle-debug").addEventListener("click", () => {
  $("debug-redirect-uri").textContent = REDIRECT_URI;
  $("debug-details").classList.toggle("hidden");
});

$("btn-join-room").addEventListener("click", () => {
  const name = $("join-name").value.trim();
  if (!name) { toast("Bitte einen Namen eingeben."); return; }
  joinRoom(roomCode, name);
});

$("btn-continue").addEventListener("click", () => {
  if (onlineMode) hostContinueOnline();
  else continueLocal();
});

$("btn-play").addEventListener("click", () => {
  if (onlineMode) hostTogglePlayOnline();
  else togglePlayLocal();
});

$("btn-again").addEventListener("click", () => {
  if (onlineMode && roomRef) roomRef.off();
  onlineMode = false; isHost = false; isGuest = false; roomRef = null; roomState = null;
  showScreen("setup");
});

$("btn-add-player").addEventListener("click", addPlayer);

$("btn-start").addEventListener("click", startLocalGame);

$("btn-create-room").addEventListener("click", () => {
  const name = $("host-name").value.trim() || "Gastgeber";
  createRoom(name);
});

$("btn-lobby-start").addEventListener("click", startOnlineGame);

document.querySelectorAll(".stepper-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const step = Number(btn.dataset.step);
    goal = Math.min(20, Math.max(3, goal + step));
    $("goal-value").textContent = String(goal);
  });
});

document.querySelectorAll(".toggle-btn[data-source]").forEach((btn) => {
  btn.addEventListener("click", () => setSourceMode(btn.dataset.source));
});

document.querySelectorAll(".toggle-btn[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => setSetupMode(btn.dataset.mode));
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
  setSetupMode("local");

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  const code = params.get("code");
  const authError = params.get("error");

  // Beitritt per QR-Code/Link: komplett ohne Spotify-Login.
  if (roomParam && !code) {
    roomCode = roomParam.toUpperCase();
    showScreen("join");
    return;
  }

  // Spotify hat den Login abgelehnt/abgebrochen -> konkrete Ursache statt stillem Fehlschlag.
  if (authError) {
    window.history.replaceState({}, "", REDIRECT_URI);
    if (authError === "access_denied") {
      toast(
        "Zugriff verweigert: Ist dein Spotify-Account im Dashboard unter 'User Management' als Tester freigegeben?",
        7000
      );
    } else {
      toast("Spotify-Login-Fehler: " + authError, 6000);
    }
    showScreen("login");
    return;
  }

  if (code) {
    window.history.replaceState({}, "", REDIRECT_URI);
    try {
      await exchangeCodeForToken(code);
    } catch (e) {
      console.error("Token-Austausch fehlgeschlagen:", e);
      toast(
        "Login fehlgeschlagen — meist eine falsche Redirect-URI im Spotify-Dashboard. Details unten auf dem Login-Screen.",
        7000
      );
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
