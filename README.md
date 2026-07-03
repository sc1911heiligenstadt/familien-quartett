# Familien-Quartett (v1.0)

Digitales Kartenspiel nach dem Vorbild des klassischen „Auto Quartett" (Top-Trumps-Prinzip), aber mit Karten von Familienmitgliedern statt Autos. Bis zu 8 Spieler:innen, jede:r mit eigenem Handy.

**Live:** https://tecko1985.github.io/familien-quartett/

## Funktionen

- **Echte Mehrgeräte-Synchronisierung** über Firebase Realtime Database + anonyme Authentifizierung: ein Gerät erstellt einen Raum mit kurzem Raum-Code (ohne verwechselbare Zeichen wie 0/O/1/I), bis zu 8 Spieler:innen treten mit dem Code bei.
- **Datenschutz eigener Karten**: die geheime Hand jedes Geräts liegt in einem eigenen Datenbankpfad, den nur das eigene Gerät oder das Gastgeber-Gerät lesen kann. Das Gastgeber-Gerät fungiert als „Schiedsrichter" beim Vergleich und muss während der Partie geöffnet bleiben.
- **Zwei Kartensets** wählbar (Familie oder Auto/klassisch) sowie drei Deckgrößen (5 Karten/Spieler:in, 10 Karten/Spieler:in, oder das komplette Kartenpool-Maximum).
- **Kartenverwaltung**: Karten (Name, Rolle, Foto, einzelne Eigenschaftswerte) sowie die Kriterien-Labels/Icons selbst bearbeiten — Änderungen liegen als Überschreibung über dem Basisdeck (`mock-data.js`).
- **Bestenliste** über alle Partien hinweg.
- **Familien-Code**: Bestenliste und Kartenfotos sind nicht an einen einzelnen Spielraum gebunden und daher zusätzlich über einen gemeinsamen, geräteweise gespeicherten Code geschützt (wirkt wie ein gemeinsames Passwort).
- Test-Spieler zum Auffüllen der Lobby für Solo-Tests, automatischer Spielablauf bis Sieg oder Abbruch.

## Architektur

Die Spiellogik liegt komplett gekapselt in `game-service.js` hinter einer async/Promise-basierten API mit Subscription-Pattern (`getZustand()`/`onZustandsAenderung()`); `app.js` steuert ausschließlich Screens/Rendering/Events und redet nie direkt mit den Datenquellen.

## Lokal starten

```
python -m http.server 8768 --directory familien-quartett
```

Danach `http://localhost:8768` öffnen. Alternativ über das Preview-Tool dieses Workspaces (Eintrag `familien-quartett` in `.claude/launch.json`).

## Testdurchlauf

1. „Raum erstellen" → eigenen Namen eingeben → Lobby
2. Über „Test-Spieler hinzufügen" auf 2–8 Spieler auffüllen
3. „Spiel starten"
4. Wenn du am Zug bist: Eigenschaft auf der eigenen Karte antippen
5. Vergleich ansehen, „Weiter" antippen, bis ein:e Spieler:in alle Karten hat
