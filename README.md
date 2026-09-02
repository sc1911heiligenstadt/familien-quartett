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
4. Bei Gleichstand geht der Pott in die **Bockrunde**.
5. Die **Bestenliste** hält fest, wer wie oft gespielt und gewonnen hat.

Bis zu **8 Mitspielende**. Vor dem Eröffnen wählbar: **Familien-Quartett oder
Auto-Quartett** und die Größe des Decks (klein mit 5 Karten je Person, normal mit
10 oder groß mit allem, was der Kartenpool hergibt). Ist gerade niemand sonst da,
setzt der Warteraum auf Knopfdruck **Test-Spieler** dazu.

Oben rechts liegt der **Info**-Reiter mit der Änderungsliste und dem
Datenschutz-Hinweis.

## Eigene Karten

Das Spiel ist nicht auf ein festes Kartenset festgelegt: Unter **Karten
bearbeiten** und **Kriterien bearbeiten** lässt sich ein eigenes Quartett bauen
— eigene Karten mit eigenem Foto, eigene Vergleichswerte samt Bezeichnung und
Symbol. Eine geänderte Karte geht auf Knopfdruck wieder auf das Original zurück,
und beide Kartensets werden getrennt gepflegt.

## Zugang

Dieses Werkzeug braucht **keine Anmeldung** über das Vereinskonto. Wer den
Raumcode hat, spielt mit.

Karten, Kriterien und Bestenliste hängen an einem selbst gewählten
**Familien-Code**. Er trennt die Sets verschiedener Haushalte voneinander und
wirkt dabei wie ein gemeinsames Passwort — wer ihn kennt, sieht eure Karten und
eure Bestenliste.

## Lokal starten

Über den Eintrag `familien-quartett` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8773/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Live-Daten liegen in einer Firebase-Datenbank, damit alle Geräte im Raum denselben Stand sehen.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
