// Firebase-Konfiguration für den Online-Mehrspieler-Modus (QR-Code-Räume).
// Nur nötig, wenn du den "Online"-Modus nutzen willst — der lokale
// Hot-Seat-Modus funktioniert ohne Firebase.
//
// So bekommst du diese Werte (kostenlos, Spark-Plan reicht):
// 1. https://console.firebase.google.com -> "Projekt hinzufügen"
// 2. Im Projekt: "Realtime Database" anlegen (Testmodus reicht für den Start)
// 3. Projekteinstellungen (Zahnrad) -> "Web-App hinzufügen" (</> Symbol)
// 4. Den angezeigten firebaseConfig-Block hier unten einfügen

const firebaseConfig = {
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  databaseURL: "https://DEIN_PROJEKT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "...",
  appId: "...",
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  // Wird ignoriert, falls die Platzhalterwerte noch nicht ersetzt wurden;
  // der Online-Modus zeigt in dem Fall einen Hinweis statt eines Absturzes.
}
