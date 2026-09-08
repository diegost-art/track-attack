# Zeitrille — Setup-Anleitung

Ein Hitster-artiges Musik-Zeitleiste-Spiel als PWA, das über deinen eigenen
Spotify-Premium-Account echte Songs abspielt.

## Schritt 1 — Spotify-Entwickler-App anlegen

1. Gehe zu https://developer.spotify.com/dashboard und logge dich mit deinem
   Spotify-Account ein.
2. Klicke auf **Create app**.
   - App name: z. B. „Zeitrille"
   - App description: „Privates Musik-Ratespiel"
   - Redirect URI: **das trägst du erst in Schritt 3 ein**, wenn du deine
     GitHub-Pages-URL kennst (siehe unten) — trag vorerst
     `https://localhost:3000` ein, das änderst du gleich wieder.
   - APIs, die verwendet werden: **Web Playback SDK** und **Web API** ankreuzen.
3. Speichern. Öffne die App und klicke auf **Settings**.
4. Kopiere die **Client ID** — die brauchst du in Schritt 2.

## Schritt 2 — Client ID eintragen

Öffne `app.js` und ersetze in der ersten Zeile des Konfigurationsblocks:

```js
const CLIENT_ID = "DEINE_SPOTIFY_CLIENT_ID";
```

durch deine echte Client ID, z. B.:

```js
const CLIENT_ID = "a1b2c3d4e5f6...";
```

## Schritt 3 — Auf GitHub Pages veröffentlichen

1. Erstelle ein neues **öffentliches** Repository auf GitHub, z. B. `zeitrille`.
2. Lade alle Dateien aus diesem Ordner hoch (`index.html`, `style.css`,
   `app.js`, `manifest.json`, `sw.js`, `songs.json`, `icon-192.png`,
   `icon-512.png`, README.md) — entweder per Drag & Drop im Browser
   („Add file" → „Upload files") oder per Git:
   ```
   git init
   git add .
   git commit -m "Zeitrille initial"
   git branch -M main
   git remote add origin https://github.com/DEIN-USERNAME/zeitrille.git
   git push -u origin main
   ```
3. Gehe im Repo zu **Settings → Pages**.
4. Bei **Source** wähle „Deploy from a branch", Branch `main`, Ordner `/ (root)`.
5. Speichern. Nach ~1 Minute ist die Seite live unter:
   `https://DEIN-USERNAME.github.io/zeitrille/`

## Schritt 4 — Redirect URI final eintragen

1. Zurück im Spotify-Dashboard → deine App → **Settings**.
2. Bei **Redirect URIs** die Platzhalter-URL entfernen und stattdessen exakt
   deine GitHub-Pages-URL eintragen (mit abschließendem `/`):
   ```
   https://DEIN-USERNAME.github.io/zeitrille/
   ```
3. Speichern.

## Schritt 5 — Auf dem Handy installieren

1. Öffne die GitHub-Pages-URL im Safari (iPhone) oder Chrome (Android).
2. Logge dich mit „Mit Spotify verbinden" ein (nur beim ersten Mal nötig).
3. Tippe auf „Zum Home-Bildschirm hinzufügen" (Safari: Teilen-Button → „Zum
   Home-Bildschirm"; Chrome: Menü → „App installieren").
4. Ab jetzt startet Zeitrille wie eine echte App vom Homescreen.

## Wichtig zu wissen

- **Spotify Premium ist Pflicht** — die Wiedergabe läuft über das offizielle
  Web Playback SDK, das nur mit Premium funktioniert.
- Beim Spielstart muss dein Handy kurz eine aktive Spotify-Verbindung
  aufbauen; falls „Player wird noch verbunden" erscheint, den Play-Button
  einfach nochmal antippen.
- Die Song-Datenbank (`songs.json`) enthält ~90 bekannte Songs von den
  1950ern bis heute. Du kannst dort jederzeit weitere Einträge im Format
  `{"title": "...", "artist": "...", "year": ...}` ergänzen.
- Die App sucht jeden Song zur Laufzeit über die Spotify-Suche — sollte ein
  Titel nicht gefunden werden, überspringt das Spiel ihn automatisch.
- Alles läuft rein clientseitig (kein eigener Server, keine Datenbank) —
  Zugangsdaten liegen nur lokal im Browser deines Handys.

## Spielregeln

- Jede:r Spieler:in bekommt zu Beginn eine gratis Startkarte für die eigene
  Zeitleiste.
- Reihum: Song abspielen (15-Sekunden-Ausschnitt), dann an der richtigen
  Stelle in der **eigenen** Zeitleiste platzieren.
- Richtig platziert → Karte bleibt in der Zeitleiste, Punktzahl steigt.
- Falsch platziert → Karte wird verworfen, der/die Nächste ist dran.
- Erste:r Spieler:in mit dem Zielwert an Karten (Standard: 10) gewinnt —
  Endstand mit Rangliste wird angezeigt.

## Mehrspieler

- Im Setup-Screen beliebig viele Spieler:innen hinzufügen (bis zu 8).
- Es wird reihum gespielt; jede Person hat ihre eigene Zeitleiste. Die
  Kopfzeile im Spiel zeigt „Am Zug: NAME" plus eine kompakte Punkteübersicht
  aller Mitspieler:innen.

## Songquelle: Klassiker oder ganzer Spotify-Katalog

Zwei Modi im Setup wählbar:

- **Kuratierte Klassiker** — die feste Liste aus `songs.json` (~90 bekannte
  Songs, von Hand mit Jahr hinterlegt). Zuverlässig erkennbare Songs, gut für
  Einsteiger:innen.
- **Alle Spotify-Songs** — greift live auf die komplette Spotify-Suche zu.
  Für jede Karte wird zufällig ein Song aus den gewählten Jahrzehnten/Genres
  gesucht (`year:`- und `genre:`-Filter der Spotify-Suche), das tatsächliche
  Erscheinungsjahr stammt direkt aus den Spotify-Metadaten. Dadurch ist
  praktisch der komplette Katalog im Spiel — die Songs können aber auch mal
  weniger bekannt sein.

## Jahrzehnte- und Genre-Filter

- **Jahrzehnte**: Mehrfachauswahl 50er–2020er. Leer gelassen = alle
  Jahrzehnte. Gilt für beide Songquellen.
- **Genres**: Nur im Modus „Alle Spotify-Songs" aktiv (Pop, Rock, Hip-Hop,
  Dance/Electronic, Metal, Schlager/Deutschpop, R&B/Soul, Country, Latin,
  Jazz). Leer gelassen = alle Genres. Mehrfachauswahl möglich — bei jeder
  neuen Karte wird zufällig eines der gewählten Genres verwendet.
- Genre-Namen sind Spotifys interne Genre-Tags; nicht jeder Künstler ist
  darüber sauber kategorisiert, daher kann die Trefferqualität je nach Genre
  schwanken.

## Wichtig zu wissen

- **Spotify Premium ist Pflicht** — die Wiedergabe läuft über das offizielle
  Web Playback SDK, das nur mit Premium funktioniert.
- Beim Spielstart muss dein Handy kurz eine aktive Spotify-Verbindung
  aufbauen; falls „Player wird noch verbunden" erscheint, den Play-Button
  einfach nochmal antippen.
- Die App sucht jeden Klassiker-Song zur Laufzeit über die Spotify-Suche —
  sollte ein Titel nicht gefunden werden, überspringt das Spiel ihn
  automatisch. Im Spotify-Modus werden bereits gespielte Songs innerhalb
  einer Runde nicht wiederholt.
- Alles läuft rein clientseitig (kein eigener Server, keine Datenbank) —
  Zugangsdaten liegen nur lokal im Browser deines Handys.

## Mögliche weitere Erweiterungen

- Leben/Fehlversuche statt sofortigem Verwerfen bei falscher Platzierung
- Bonuspunkte für exaktes Jahr statt nur Reihenfolge
- Eigene Genre-Presets pro Spielrunde speichern
