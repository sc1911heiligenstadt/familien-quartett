# 🃏 Familien-Quartett

Digitales Kartenspiel nach dem **Quartett-Prinzip** für mehrere Geräte. Ein
Gerät eröffnet den Raum, die anderen treten mit dem **Raumcode** bei — danach
sieht jeder seine eigenen Karten auf seinem eigenen Handy.

**➡️ [Familien-Quartett öffnen](https://sc1911heiligenstadt.github.io/familien-quartett/)**

## Wie gespielt wird

1. Ein Gerät eröffnet den Raum und bekommt einen **Raumcode**.
2. Die anderen geben den Code im **Warteraum** ein.
3. Gespielt wird wie beim Quartett: Ein Kriterium ansagen, die Werte
   **vergleichen**, wer den besseren hat, bekommt die Karte.
4. Die **Bestenliste** hält fest, wer wie oft gewonnen hat.

## Eigene Karten

Das Spiel ist nicht auf ein festes Kartenset festgelegt: Unter **Karten
bearbeiten** und **Kriterien bearbeiten** lässt sich ein eigenes Quartett bauen
— eigene Karten, eigene Vergleichswerte.

## Zugang

Dieses Werkzeug braucht **keine Anmeldung** über das Vereinskonto. Wer den
Raumcode hat, spielt mit.

## Lokal starten

Über den Eintrag `familien-quartett` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8773/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Live-Daten liegen in einer Firebase-Datenbank, damit alle Geräte im Raum denselben Stand sehen.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
