// Minimaler Service Worker, nur damit die App als PWA installierbar ist.
// Kein Offline-Caching: Raum, Spielstand und Karten kommen live aus Firebase.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
self.addEventListener("fetch", () => {});
