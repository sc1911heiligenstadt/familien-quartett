// Minimaler Service Worker, nur damit die App als PWA installierbar ist.
// Kein Offline-Caching nötig, solange die App rein mit Mock-Daten läuft.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
self.addEventListener("fetch", () => {});
