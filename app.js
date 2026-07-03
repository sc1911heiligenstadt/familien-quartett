// Steuert ausschließlich Screens/Rendering/Events. Redet NIE direkt mit mock-data.js,
// sondern ausschließlich über die gameService-API (siehe game-service.js).

const SCREEN_FUER_PHASE = {
  start: "screen-start",
  lobby: "screen-lobby",
  amZug: "screen-spiel",
  warteAufAndere: "screen-spiel",
  vergleich: "screen-vergleich",
  beendet: "screen-game-over",
  abgebrochen: "screen-abgebrochen"
};

const PHASEN_MIT_ABBRUCH_BUTTON = ["amZug", "warteAufAndere", "vergleich"];

let ausstehenderModus = null; // "erstellen" | "beitreten"
let raumcodeEingabe = "";
let ausstehenderKartenSet = "familie";
let ausstehenderDeckgroesse = "normal";

const DECKGROESSE_LABEL = { klein: "5 Karten/Spieler:in", normal: "10 Karten/Spieler:in", gross: "Maximum aus dem Kartenpool" };

let kvAusgewaehltesDeck = "familie";
let kvBearbeiteteKarte = null;
let kvNeuesFoto = undefined; // undefined = unveraendert, sonst Daten-URL des neuen Fotos
let nachFamiliencodeAktion = null; // "bestenliste" | "kartenverwaltung"

// Kriterien (Label/Icon) sind ueber den Karten-Tab umbenennbar. Da getKategorien()
// synchron aus mock-data.js liest, wird hier zusaetzlich ein async geladener,
// pro Kartenset gemergter Cache gehalten; ohne Familien-Code bleiben es die Basiswerte.
let kategorienCache = {};

async function stelleKategorienBereit(kartenSet) {
  if (kategorienCache[kartenSet] || !gameService.getFamilienCode()) return;
  try {
    kategorienCache[kartenSet] = await gameService.ladeKategorienZurBearbeitung(kartenSet);
    render(gameService.getZustand());
  } catch (e) {
    // unkritisch: Basiskategorien bleiben als Fallback
  }
}

function effektiveKategorien(kartenSet) {
  stelleKategorienBereit(kartenSet);
  return kategorienCache[kartenSet] || getKategorien(kartenSet);
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function getSpielerName(zustand, spielerId) {
  const spieler = zustand.spieler.find(s => s.id === spielerId);
  return spieler ? spieler.name : "?";
}

function getEigenerSpieler(zustand) {
  return zustand.spieler.find(s => s.id === zustand.eigenerSpielerId) || null;
}

function avatarInitiale(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

// Für alle innerHTML-Templates: Spielernamen, Kartennamen/-fotos usw. kommen aus
// Firebase (Mitspieler-Eingaben) — ohne Escaping könnte ein Beitritt mit einem
// HTML-Namen Skript auf allen Geräten im Raum ausführen.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Foto-Lightbox (Großansicht per Klick) ---

function oeffneFotoLightbox(src) {
  if (!src) return;
  document.getElementById("foto-lightbox-img").src = src;
  document.getElementById("foto-lightbox").classList.add("aktiv");
}

document.getElementById("foto-lightbox").addEventListener("click", () => {
  document.getElementById("foto-lightbox").classList.remove("aktiv");
});

// --- Karten-Rendering ---

function erzeugeKartenElement(karte, { waehlbar, kartenSet }, kategorien) {
  const wrapper = document.createElement("div");
  wrapper.className = "quartett-karte";
  wrapper.style.setProperty("--avatar-farbe", karte.avatarFarbe);

  const fotoHtml = karte.foto
    ? `<img src="${escapeHtml(karte.foto)}" alt="${escapeHtml(karte.name)}">`
    : `<img class="avatar-fallback" src="avatar-placeholder.svg" alt="Kein Foto">`;

  const eigenschaftenHtml = Object.keys(karte.eigenschaften).map(schluessel => {
    const meta = kategorien[schluessel] || { label: schluessel, icon: "▫️" };
    const klasse = waehlbar ? "eigenschaft waehlbar" : "eigenschaft";
    return `
      <li class="${klasse}" data-kategorie="${escapeHtml(schluessel)}">
        <span class="eig-icon">${escapeHtml(meta.icon)}</span>
        <span class="eig-label">${escapeHtml(meta.label)}</span>
        <span class="eig-wert">${escapeHtml(karte.eigenschaften[schluessel])}</span>
      </li>`;
  }).join("");

  const rolleHtml = kartenSet === "familie" ? "" : `<span class="karte-rolle">${escapeHtml(karte.rolle)}</span>`;
  wrapper.innerHTML = `
    <div class="karte-kopf">
      <span class="karte-name">${escapeHtml(karte.name)}</span>
      ${rolleHtml}
    </div>
    <div class="karte-foto">${fotoHtml}</div>
    <ul class="karte-eigenschaften">${eigenschaftenHtml}</ul>
  `;

  if (waehlbar) {
    wrapper.querySelectorAll(".eigenschaft").forEach(li => {
      li.addEventListener("click", () => gameService.waehleKategorie(li.dataset.kategorie));
    });
  }

  if (karte.foto) {
    wrapper.querySelector(".karte-foto img").addEventListener("click", () => oeffneFotoLightbox(karte.foto));
  }

  return wrapper;
}

// --- Render je Screen ---

function renderLobby(zustand) {
  document.getElementById("lobby-raumcode").textContent = zustand.raumCode || "------";
  document.getElementById("lobby-zaehler").textContent = `${zustand.spieler.length}/${zustand.maxSpieler} Spieler:innen`;

  const liste = document.getElementById("lobby-spielerliste");
  liste.innerHTML = "";
  zustand.spieler.forEach(s => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="spieler-avatar" style="background:${escapeHtml(s.avatarFarbe)}">${escapeHtml(avatarInitiale(s.name))}</span>
      <span class="spieler-name">${escapeHtml(s.name)}</span>
      <span class="spieler-badge">${s.istHost ? "Gastgeber:in" : ""}</span>
    `;
    liste.appendChild(li);
  });

  const eigener = getEigenerSpieler(zustand);
  const istHost = !!(eigener && eigener.istHost);
  document.getElementById("btn-test-spieler").style.display = istHost ? "block" : "none";
  document.getElementById("btn-spiel-starten").style.display = istHost ? "block" : "none";
  document.getElementById("btn-spiel-starten").disabled = zustand.spieler.length < 2;
  document.getElementById("lobby-warte-hinweis").style.display = istHost ? "none" : "block";
  const modusLabel = zustand.kartenSet === "auto" ? "🚗 Auto-Quartett" : "🎴 Familien-Quartett";
  const groesseLabel = DECKGROESSE_LABEL[zustand.deckgroesse] || DECKGROESSE_LABEL.normal;
  document.getElementById("lobby-modus").textContent = `${modusLabel} · ${groesseLabel}`;
}

function renderSpiel(zustand) {
  const eigeneKarte = zustand.eigeneKarten[0];
  const amZug = zustand.phase === "amZug";
  const kategorien = effektiveKategorien(zustand.kartenSet);

  document.getElementById("spiel-eigene-kartenanzahl").textContent = `🂠 ${zustand.eigeneKarten.length} Karten`;
  document.getElementById("spiel-status-text").textContent = amZug
    ? "Du bist am Zug"
    : `Warte auf ${getSpielerName(zustand, zustand.amZugSpielerId)} …`;
  document.getElementById("spiel-hinweis").textContent = amZug
    ? "Wähle eine Eigenschaft deiner Karte aus."
    : "Die Karten werden gleich aufgedeckt.";

  const buehne = document.getElementById("spiel-karte-container");
  buehne.innerHTML = "";
  if (eigeneKarte) {
    buehne.appendChild(erzeugeKartenElement(eigeneKarte, { waehlbar: amZug, kartenSet: zustand.kartenSet }, kategorien));
  }
}

function renderVergleich(zustand) {
  const runde = zustand.aktuelleRunde;
  const kategorien = effektiveKategorien(zustand.kartenSet);
  const meta = kategorien[runde.gewaehlteKategorie] || { label: runde.gewaehlteKategorie, icon: "▫️" };
  document.getElementById("vergleich-kategorie-label").textContent = `${meta.icon} ${meta.label}`;

  const liste = document.getElementById("vergleich-liste");
  liste.innerHTML = "";
  runde.ausgespielteKarten
    .slice()
    .sort((a, b) => b.karte.eigenschaften[runde.gewaehlteKategorie] - a.karte.eigenschaften[runde.gewaehlteKategorie])
    .forEach(eintrag => {
      const spielerName = getSpielerName(zustand, eintrag.spielerId);
      const istGewinner = eintrag.spielerId === runde.gewinnerSpielerId;
      const istEigene = eintrag.spielerId === zustand.eigenerSpielerId;
      const li = document.createElement("li");
      li.className = "quartett-karte--mini" + (istGewinner ? " gewinner" : "") + (istEigene ? " eigene" : "");
      li.innerHTML = `
        <span class="mini-avatar" style="background:${escapeHtml(eintrag.karte.avatarFarbe)}">${escapeHtml(avatarInitiale(spielerName))}</span>
        <span class="mini-name">${escapeHtml(spielerName)} – ${escapeHtml(eintrag.karte.name)}</span>
        <span class="mini-wert">${escapeHtml(eintrag.karte.eigenschaften[runde.gewaehlteKategorie])}</span>
      `;
      liste.appendChild(li);
    });

  const weiterBtn = document.getElementById("btn-vergleich-weiter");
  const bereitText = document.getElementById("vergleich-bereit-text");
  if (!runde.gewinnerSpielerId) {
    document.getElementById("vergleich-gewinner-text").textContent =
      "Gleichstand! Die nächste Karte wird automatisch in derselben Kategorie verglichen …";
    weiterBtn.style.display = "none";
    bereitText.textContent = "";
  } else {
    document.getElementById("vergleich-gewinner-text").textContent =
      `${getSpielerName(zustand, runde.gewinnerSpielerId)} gewinnt die Runde!`;
    weiterBtn.style.display = "block";
    bereitText.textContent =
      `${runde.weiterBestaetigtAnzahl}/${runde.weiterBestaetigtGesamt} Spieler:innen bereit – spätestens nach 10 Sekunden geht’s automatisch weiter.`;
    if (runde.habeIchBestaetigt) {
      weiterBtn.disabled = true;
      weiterBtn.textContent = "Du bist bereit – warte auf die anderen …";
    } else {
      weiterBtn.disabled = false;
      weiterBtn.textContent = "Weiter";
    }
  }
}

function renderGameOver(zustand) {
  document.getElementById("game-over-sieger").textContent =
    `${getSpielerName(zustand, zustand.siegerSpielerId)} hat alle Karten gesammelt!`;

  const liste = document.getElementById("game-over-endstand");
  liste.innerHTML = "";
  zustand.spieler
    .slice()
    .sort((a, b) => b.kartenAnzahl - a.kartenAnzahl)
    .forEach(s => {
      const li = document.createElement("li");
      li.textContent = `${s.name} – ${s.kartenAnzahl} Karten`;
      liste.appendChild(li);
    });
}

function renderAbbrechenButton(zustand) {
  const btn = document.getElementById("btn-spiel-abbrechen");
  const sichtbar = PHASEN_MIT_ABBRUCH_BUTTON.includes(zustand.phase);
  btn.style.display = sichtbar ? "inline-block" : "none";
  if (sichtbar) {
    const eigener = getEigenerSpieler(zustand);
    btn.textContent = eigener && eigener.istHost ? "Spiel abbrechen" : "Spiel verlassen";
  }
}

function renderKartenverwaltungButton(zustand) {
  const btn = document.getElementById("btn-kartenverwaltung-oeffnen");
  btn.style.display = PHASEN_MIT_ABBRUCH_BUTTON.includes(zustand.phase) ? "none" : "inline-block";
}

// Browser drosseln Timer/Firebase-Listener stark, sobald der Bildschirm sperrt
// (besonders auf dem Gastgeber-Handy spuerbar, da dort die gesamte Spiellogik laeuft).
// Wake Lock haelt den Bildschirm waehrend einer aktiven Partie wach.
let bildschirmWakeLock = null;

async function sichereBildschirmWach() {
  if (!("wakeLock" in navigator) || bildschirmWakeLock) return;
  try {
    bildschirmWakeLock = await navigator.wakeLock.request("screen");
    bildschirmWakeLock.addEventListener("release", () => {
      bildschirmWakeLock = null;
    });
  } catch (e) {
    // unkritisch, z.B. wenn der Tab gerade nicht sichtbar ist
  }
}

function gibBildschirmFrei() {
  if (bildschirmWakeLock) {
    bildschirmWakeLock.release().catch(() => {});
    bildschirmWakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && gameService.getZustand().phase !== "start") {
    sichereBildschirmWach();
  }
});

function render(zustand) {
  if (zustand.phase === "start") {
    gibBildschirmFrei();
  } else {
    sichereBildschirmWach();
  }
  showScreen(SCREEN_FUER_PHASE[zustand.phase] || "screen-start");
  renderAbbrechenButton(zustand);
  renderKartenverwaltungButton(zustand);
  if (zustand.phase === "lobby") renderLobby(zustand);
  if (zustand.phase === "amZug" || zustand.phase === "warteAufAndere") renderSpiel(zustand);
  if (zustand.phase === "vergleich") renderVergleich(zustand);
  if (zustand.phase === "beendet") renderGameOver(zustand);
}

// --- Kartenverwaltung (Karten bearbeiten + Fotos hinterlegen) ---

function erzeugeKvEintrag(karte) {
  const div = document.createElement("div");
  div.className = "kv-karten-eintrag";

  const thumb = document.createElement("span");
  thumb.className = "kv-thumb";
  thumb.style.background = karte.avatarFarbe;
  const img = document.createElement("img");
  img.alt = "";
  if (karte.foto) {
    img.src = karte.foto;
    img.addEventListener("click", e => {
      e.stopPropagation();
      oeffneFotoLightbox(karte.foto);
    });
  } else {
    img.src = "avatar-placeholder.svg";
    img.className = "avatar-fallback";
  }
  thumb.appendChild(img);

  const name = document.createElement("span");
  name.className = "kv-name";
  name.textContent = karte.name;

  div.append(thumb, name);
  if (kvAusgewaehltesDeck !== "familie") {
    const rolle = document.createElement("span");
    rolle.className = "kv-rolle";
    rolle.textContent = karte.rolle;
    div.appendChild(rolle);
  }

  div.addEventListener("click", () => oeffneKartenBearbeitung(karte));
  return div;
}

async function ladeUndZeigeKartenverwaltung() {
  showScreen("screen-kartenverwaltung");
  document.getElementById("kv-deck-familie").classList.toggle("aktiv", kvAusgewaehltesDeck === "familie");
  document.getElementById("kv-deck-auto").classList.toggle("aktiv", kvAusgewaehltesDeck === "auto");

  const liste = document.getElementById("kv-kartenliste");
  liste.innerHTML = "";
  const ladeHinweis = document.createElement("p");
  ladeHinweis.className = "hinweis-text";
  ladeHinweis.textContent = "Lade Karten …";
  liste.appendChild(ladeHinweis);

  let karten;
  try {
    karten = await gameService.ladeKartenZurBearbeitung(kvAusgewaehltesDeck);
  } catch (e) {
    liste.innerHTML = "";
    const fehlerText = document.createElement("p");
    fehlerText.className = "hinweis-text fehler";
    fehlerText.textContent = "Karten konnten nicht geladen werden.";
    liste.appendChild(fehlerText);
    return;
  }
  liste.innerHTML = "";
  karten.forEach(karte => liste.appendChild(erzeugeKvEintrag(karte)));
}

async function oeffneKartenBearbeitung(karte) {
  kvBearbeiteteKarte = karte;
  kvNeuesFoto = undefined;
  document.getElementById("kb-fehler").textContent = "";
  document.getElementById("kb-name").value = karte.name;
  document.getElementById("kb-rolle").value = karte.rolle;
  document.getElementById("kb-rolle-zeile").style.display = kvAusgewaehltesDeck === "familie" ? "none" : "block";
  const vorschau = document.getElementById("kb-foto-vorschau");
  vorschau.src = karte.foto || "avatar-placeholder.svg";
  vorschau.onclick = () => oeffneFotoLightbox(vorschau.src);

  const istBenutzerdefiniert = karte.id.startsWith("custom-");
  document.getElementById("kb-titel").textContent = karte.istNeu ? "Neue Karte anlegen" : "Karte bearbeiten";
  const zuruecksetzenBtn = document.getElementById("btn-kb-zuruecksetzen");
  zuruecksetzenBtn.style.display = karte.istNeu ? "none" : "block";
  zuruecksetzenBtn.textContent = istBenutzerdefiniert ? "Karte löschen" : "Auf Original zurücksetzen";

  let kategorien;
  try {
    kategorien = await gameService.ladeKategorienZurBearbeitung(kvAusgewaehltesDeck);
  } catch (e) {
    kategorien = getKategorien(kvAusgewaehltesDeck);
  }
  const container = document.getElementById("kb-eigenschaften-felder");
  container.innerHTML = "";
  Object.keys(kategorien).forEach(schluessel => {
    const meta = kategorien[schluessel];
    const label = document.createElement("label");
    label.className = "kb-feld-label";
    label.textContent = `${meta.icon} ${meta.label}`;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "eingabe";
    input.dataset.kategorie = schluessel;
    input.value = karte.eigenschaften[schluessel] !== undefined ? karte.eigenschaften[schluessel] : 50;
    container.append(label, input);
  });

  showScreen("screen-karte-bearbeiten");
}

async function oeffneNeueKartenErstellung() {
  const farben = ["#1a56a0", "#057a55", "#c9941f", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#ea580c"];
  const karte = {
    id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "",
    rolle: "",
    foto: null,
    avatarFarbe: farben[Math.floor(Math.random() * farben.length)],
    eigenschaften: {},
    istNeu: true
  };
  await oeffneKartenBearbeitung(karte);
}

// --- Kriterien bearbeiten (Label + Icon je Eigenschaft) ---

async function ladeUndZeigeKriterienBearbeitung() {
  showScreen("screen-kriterien-bearbeiten");
  const container = document.getElementById("kr-kriterien-felder");
  const fehlerEl = document.getElementById("kr-fehler");
  fehlerEl.textContent = "";
  container.innerHTML = "<p class='hinweis-text'>Lade Kriterien …</p>";

  let kategorien;
  try {
    kategorien = await gameService.ladeKategorienZurBearbeitung(kvAusgewaehltesDeck);
  } catch (e) {
    container.innerHTML = "";
    fehlerEl.textContent = "Kriterien konnten nicht geladen werden.";
    return;
  }

  container.innerHTML = "";
  Object.keys(kategorien).forEach(schluessel => {
    const meta = kategorien[schluessel];
    const zeile = document.createElement("div");
    zeile.className = "kr-kriterium-zeile";

    const iconInput = document.createElement("input");
    iconInput.type = "text";
    iconInput.className = "eingabe kr-icon-eingabe";
    iconInput.maxLength = 4;
    iconInput.dataset.kategorie = schluessel;
    iconInput.dataset.feld = "icon";
    iconInput.value = meta.icon;

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "eingabe kr-label-eingabe";
    labelInput.maxLength = 30;
    labelInput.dataset.kategorie = schluessel;
    labelInput.dataset.feld = "label";
    labelInput.value = meta.label;

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "kr-reset-btn";
    resetBtn.title = "Auf Original zurücksetzen";
    resetBtn.textContent = "↺";
    resetBtn.addEventListener("click", async () => {
      await gameService.setzeKategorieZurueck(kvAusgewaehltesDeck, schluessel);
      delete kategorienCache[kvAusgewaehltesDeck];
      ladeUndZeigeKriterienBearbeitung();
    });

    zeile.append(iconInput, labelInput, resetBtn);
    container.appendChild(zeile);
  });
}

// --- Event-Wiring ---

document.getElementById("btn-raum-erstellen").addEventListener("click", () => {
  ausstehenderModus = "erstellen";
  ausstehenderKartenSet = document.getElementById("checkbox-auto-modus").checked ? "auto" : "familie";
  const deckgroesseInput = document.querySelector('input[name="deckgroesse"]:checked');
  ausstehenderDeckgroesse = deckgroesseInput ? deckgroesseInput.value : "normal";
  document.getElementById("name-eingabe-titel").textContent = "Wie heißt du?";
  document.getElementById("input-spielername").value = "";
  document.getElementById("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

document.getElementById("btn-raum-beitreten").addEventListener("click", () => {
  const code = document.getElementById("input-raumcode").value.trim();
  if (!code) {
    document.getElementById("start-fehler").textContent = "Bitte einen Raum-Code eingeben.";
    return;
  }
  document.getElementById("start-fehler").textContent = "";
  raumcodeEingabe = code;
  ausstehenderModus = "beitreten";
  document.getElementById("name-eingabe-titel").textContent = "Wie heißt du?";
  document.getElementById("input-spielername").value = "";
  document.getElementById("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

document.getElementById("input-raumcode").addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase();
});

document.getElementById("btn-name-bestaetigen").addEventListener("click", async () => {
  const name = document.getElementById("input-spielername").value.trim();
  const fehlerEl = document.getElementById("name-eingabe-fehler");
  const ergebnis = ausstehenderModus === "erstellen"
    ? await gameService.erstelleRaum(name, ausstehenderKartenSet, ausstehenderDeckgroesse)
    : await gameService.tritRaumBei(raumcodeEingabe, name);

  if (!ergebnis.erfolg) {
    fehlerEl.textContent = ergebnis.fehler || "Das hat nicht funktioniert.";
  }
});

document.getElementById("btn-name-zurueck").addEventListener("click", () => {
  showScreen("screen-start");
});

document.getElementById("btn-test-spieler").addEventListener("click", () => {
  gameService.fuegeTestSpielerHinzu();
});

async function zeigeBestenliste() {
  const koerper = document.getElementById("bestenliste-koerper");
  const leerText = document.getElementById("bestenliste-leer");
  koerper.innerHTML = "";
  leerText.style.display = "none";
  showScreen("screen-bestenliste");

  let eintraege;
  try {
    eintraege = await gameService.ladeBestenliste();
  } catch (e) {
    leerText.textContent = "Bestenliste konnte nicht geladen werden.";
    leerText.style.display = "block";
    return;
  }
  if (eintraege.length === 0) {
    leerText.textContent = "Noch keine beendeten Spiele.";
    leerText.style.display = "block";
    return;
  }
  eintraege.forEach(eintrag => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = eintrag.name;
    const tdGespielt = document.createElement("td");
    tdGespielt.textContent = eintrag.gespielt;
    const tdGewonnen = document.createElement("td");
    tdGewonnen.textContent = eintrag.gewonnen;
    const tdProzent = document.createElement("td");
    tdProzent.textContent = `${eintrag.prozent}%`;
    tr.append(tdName, tdGespielt, tdGewonnen, tdProzent);
    koerper.appendChild(tr);
  });
}

function oeffneMitFamiliencode(aktion) {
  if (gameService.getFamilienCode()) {
    if (aktion === "bestenliste") zeigeBestenliste();
    else ladeUndZeigeKartenverwaltung();
    return;
  }
  nachFamiliencodeAktion = aktion;
  document.getElementById("input-familiencode").value = "";
  document.getElementById("familiencode-fehler").textContent = "";
  showScreen("screen-familiencode-eingabe");
}

document.getElementById("btn-bestenliste-oeffnen").addEventListener("click", () => {
  oeffneMitFamiliencode("bestenliste");
});

document.getElementById("btn-bestenliste-zurueck").addEventListener("click", () => {
  showScreen("screen-start");
});

document.getElementById("btn-familiencode-bestaetigen").addEventListener("click", () => {
  const code = document.getElementById("input-familiencode").value;
  const ergebnis = gameService.setzeFamilienCode(code);
  if (!ergebnis.erfolg) {
    document.getElementById("familiencode-fehler").textContent = ergebnis.fehler;
    return;
  }
  if (nachFamiliencodeAktion === "bestenliste") zeigeBestenliste();
  else ladeUndZeigeKartenverwaltung();
});

document.getElementById("btn-familiencode-zurueck").addEventListener("click", () => {
  showScreen("screen-start");
});

document.getElementById("btn-spiel-starten").addEventListener("click", () => {
  gameService.starteSpiel();
});

document.getElementById("btn-vergleich-weiter").addEventListener("click", () => {
  gameService.bestaetigeWeiter();
});

document.getElementById("btn-neues-spiel").addEventListener("click", () => {
  gameService.neuesSpiel();
});

document.getElementById("btn-abbruch-zurueck").addEventListener("click", () => {
  gameService.neuesSpiel();
});

document.getElementById("btn-spiel-abbrechen").addEventListener("click", () => {
  const zustand = gameService.getZustand();
  const eigener = getEigenerSpieler(zustand);
  const istHost = !!(eigener && eigener.istHost);
  const frage = istHost
    ? "Spiel für alle Mitspieler:innen abbrechen?"
    : "Spiel verlassen? Deine Karten werden gleichmäßig an die übrigen Mitspieler:innen verteilt.";
  if (!window.confirm(frage)) return;
  gameService.verlasseSpiel();
});

document.getElementById("btn-kartenverwaltung-oeffnen").addEventListener("click", () => {
  oeffneMitFamiliencode("kartenverwaltung");
});

document.getElementById("kv-deck-familie").addEventListener("click", () => {
  kvAusgewaehltesDeck = "familie";
  ladeUndZeigeKartenverwaltung();
});

document.getElementById("kv-deck-auto").addEventListener("click", () => {
  kvAusgewaehltesDeck = "auto";
  ladeUndZeigeKartenverwaltung();
});

document.getElementById("btn-kartenverwaltung-zurueck").addEventListener("click", () => {
  showScreen("screen-start");
});

document.getElementById("btn-kriterien-oeffnen").addEventListener("click", () => {
  ladeUndZeigeKriterienBearbeitung();
});

document.getElementById("btn-kv-neue-karte").addEventListener("click", () => {
  oeffneNeueKartenErstellung();
});

document.getElementById("btn-kr-zurueck").addEventListener("click", () => {
  showScreen("screen-kartenverwaltung");
});

document.getElementById("btn-kr-speichern").addEventListener("click", async () => {
  const fehlerEl = document.getElementById("kr-fehler");
  const schluessel = new Set();
  document.querySelectorAll("#kr-kriterien-felder input").forEach(input => schluessel.add(input.dataset.kategorie));

  try {
    for (const key of schluessel) {
      const icon = document.querySelector(`#kr-kriterien-felder input[data-kategorie="${key}"][data-feld="icon"]`).value.trim();
      const label = document.querySelector(`#kr-kriterien-felder input[data-kategorie="${key}"][data-feld="label"]`).value.trim();
      if (!icon || !label) {
        fehlerEl.textContent = "Bitte Icon und Bezeichnung für jedes Kriterium ausfüllen.";
        return;
      }
      await gameService.speichereKategorieUebersteuerung(kvAusgewaehltesDeck, key, { icon, label });
    }
  } catch (e) {
    fehlerEl.textContent = "Speichern fehlgeschlagen.";
    return;
  }

  delete kategorienCache[kvAusgewaehltesDeck];
  fehlerEl.textContent = "";
  showScreen("screen-kartenverwaltung");
});

document.getElementById("kb-foto-input").addEventListener("change", e => {
  const datei = e.target.files[0];
  if (!datei) return;
  const reader = new FileReader();
  reader.onload = () => {
    const bild = new Image();
    bild.onload = () => {
      const maxBreite = 480;
      const maxHoehe = 360;
      let { width, height } = bild;
      const skalierung = Math.min(maxBreite / width, maxHoehe / height, 1);
      width = Math.round(width * skalierung);
      height = Math.round(height * skalierung);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bild, 0, 0, width, height);
      kvNeuesFoto = canvas.toDataURL("image/jpeg", 0.8);
      document.getElementById("kb-foto-vorschau").src = kvNeuesFoto;
    };
    bild.src = reader.result;
  };
  reader.readAsDataURL(datei);
});

document.getElementById("btn-kb-speichern").addEventListener("click", async () => {
  const karte = kvBearbeiteteKarte;
  if (!karte) return;
  const istFamilie = kvAusgewaehltesDeck === "familie";
  const name = document.getElementById("kb-name").value.trim();
  const rolle = istFamilie ? karte.rolle : document.getElementById("kb-rolle").value.trim();
  const fehlerEl = document.getElementById("kb-fehler");
  if (!name || (!istFamilie && !rolle)) {
    fehlerEl.textContent = istFamilie ? "Bitte einen Namen eingeben." : "Bitte Name und Rolle ausfüllen.";
    return;
  }
  const eigenschaften = {};
  document.querySelectorAll("#kb-eigenschaften-felder input").forEach(input => {
    eigenschaften[input.dataset.kategorie] = Number(input.value) || 0;
  });
  const daten = {
    name,
    rolle,
    foto: kvNeuesFoto !== undefined ? kvNeuesFoto : (karte.foto || null),
    eigenschaften
  };
  fehlerEl.textContent = "";
  try {
    await gameService.speichereKartenUebersteuerung(kvAusgewaehltesDeck, karte.id, daten);
  } catch (e) {
    fehlerEl.textContent = "Speichern fehlgeschlagen.";
    return;
  }
  await ladeUndZeigeKartenverwaltung();
});

document.getElementById("btn-kb-zuruecksetzen").addEventListener("click", async () => {
  const karte = kvBearbeiteteKarte;
  if (!karte) return;
  const istBenutzerdefiniert = karte.id.startsWith("custom-");
  if (istBenutzerdefiniert && !window.confirm("Diese Karte wirklich endgültig löschen?")) return;
  try {
    await gameService.setzeKarteZurueck(kvAusgewaehltesDeck, karte.id);
  } catch (e) {
    document.getElementById("kb-fehler").textContent = "Zurücksetzen fehlgeschlagen.";
    return;
  }
  await ladeUndZeigeKartenverwaltung();
});

document.getElementById("btn-kb-abbrechen").addEventListener("click", () => {
  showScreen("screen-kartenverwaltung");
});

gameService.onZustandsAenderung(render);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
