// Echte Mehrgeräte-Anbindung über Firebase Realtime Database + Anonymous Auth.
// app.js redet weiterhin nur mit derselben gameService-API wie im Mock-Prototyp –
// getZustand()/onZustandsAenderung() liefern exakt dieselbe Form wie zuvor.
//
// Architektur-Kernpunkt (Datenschutz eigener Karten):
//   raeume/$raumCode               -> öffentlicher Zustand, für alle Mitspieler:innen lesbar
//   geheime_karten/$raumCode/$uid  -> private Hand, nur vom eigenen Gerät ODER vom Gastgeber lesbar
// Da Sicherheitsregeln niemandem erlauben, fremde Geheim-Hände zu lesen, übernimmt das
// Gastgeber-Gerät die Rolle des "Schiedsrichters": es vergleicht die Karten und schreibt
// nur das Ergebnis öffentlich. Das Gastgeber-Handy muss daher während der Partie offen bleiben.

const STORAGE_KEY = "familienquartett_raumcode";
const RAUMCODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I, leichter vorzulesen
const TEST_NAMEN_POOL = ["Tom", "Lena", "Max", "Sara", "Jonas", "Mia", "Paul"];
const SPIELER_FARBEN = ["#1a56a0", "#057a55", "#c9941f", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#ea580c"];
const MAX_SPIELER = 8;
const AUTO_PLAY_VERZOEGERUNG_MS = 1400;
const GLEICHSTAND_VERZOEGERUNG_MS = 1800;
const KARTEN_PRO_SPIELER_NACH_DECKGROESSE = { klein: 5, normal: 10, gross: null }; // null = ganzer Kartenpool
const BESTENLISTE_PFAD = "bestenliste";
const KARTEN_UEBERSTEUERUNGEN_PFAD = "kartenUebersteuerungen";
const FAMILIENCODE_STORAGE_KEY = "familienquartett_familiencode";

// Bestenliste und Kartenfotos sind anders als raeume/geheime_karten nicht an einen
// einzelnen Spielraum gebunden, sondern dauerhaft. Ohne einen gemeinsamen Familien-Code
// waeren sie fuer jede:n mit der App-URL lesbar (Klarnamen + Fotos). Der Code wird einmal
// pro Geraet hinterlegt (localStorage) und ist Teil des Datenbankpfads, wirkt also wie ein
// gemeinsames Passwort.
let aktiverFamilienCode = null;
try {
  aktiverFamilienCode = localStorage.getItem(FAMILIENCODE_STORAGE_KEY);
} catch (e) {
  // unkritisch, falls localStorage nicht verfügbar ist
}

function pfadSichererCode(code) {
  return (code || "").trim().replace(/[.#$\[\]/]/g, "_");
}

function getFamilienCode() {
  return aktiverFamilienCode;
}

function setzeFamilienCode(code) {
  const bereinigt = pfadSichererCode(code);
  if (!bereinigt) return { erfolg: false, fehler: "Bitte einen Code eingeben." };
  aktiverFamilienCode = bereinigt;
  try {
    localStorage.setItem(FAMILIENCODE_STORAGE_KEY, bereinigt);
  } catch (e) {
    // unkritisch
  }
  return { erfolg: true };
}

// Merged eine Basiskarte aus mock-data.js mit einer optionalen, in Firebase gespeicherten
// Bearbeitung (Name/Rolle/Foto/einzelne Eigenschaftswerte). Ohne Ueberschreibung bleibt
// die Karte unveraendert.
const KATEGORIEN_UEBERSTEUERUNGEN_PFAD = "kategorienUebersteuerungen";

function wendeKategorieUebersteuerungAn(meta, ueberschreibung) {
  if (!ueberschreibung) return meta;
  return {
    label: ueberschreibung.label || meta.label,
    icon: ueberschreibung.icon || meta.icon
  };
}

function wendeUebersteuerungAn(karte, ueberschreibung) {
  if (!ueberschreibung) return karte;
  return {
    ...karte,
    name: ueberschreibung.name || karte.name,
    rolle: ueberschreibung.rolle || karte.rolle,
    foto: ueberschreibung.foto !== undefined ? ueberschreibung.foto : karte.foto,
    eigenschaften: { ...karte.eigenschaften, ...(ueberschreibung.eigenschaften || {}) }
  };
}

function baueKarteAusUebersteuerung(id, daten, index) {
  return {
    id,
    name: daten.name || "Unbenannt",
    rolle: daten.rolle || "",
    foto: daten.foto || null,
    avatarFarbe: SPIELER_FARBEN[index % SPIELER_FARBEN.length],
    eigenschaften: daten.eigenschaften || {}
  };
}

// Basisdeck (mock-data.js) gemergt mit Bearbeitungen + komplett neu angelegten Karten,
// die nur als Ueberschreibung existieren (keine Entsprechung im Basisdeck).
function holeVollstaendigesDeck(kartenSet, ueberschreibungen) {
  const basis = getMockDeck(kartenSet);
  const basisIds = new Set(basis.map(karte => karte.id));
  const basisDeck = basis.map(karte => wendeUebersteuerungAn(karte, ueberschreibungen[karte.id]));
  const neueKarten = Object.keys(ueberschreibungen)
    .filter(id => !basisIds.has(id))
    .map((id, index) => baueKarteAusUebersteuerung(id, ueberschreibungen[id], index));
  return basisDeck.concat(neueKarten);
}

function slugifyName(name) {
  return (name || "").trim().toLowerCase().replace(/[.#$\[\]/]/g, "_") || "unbekannt";
}

// Erhoeht "gespielt" fuer alle realen (nicht simulierten) Spieler:innen im uebergebenen
// spieler-Objekt und "gewonnen" zusaetzlich fuer gewinnerUid. Mutiert das updates-Objekt,
// damit die Statistik im selben atomaren db.ref().update() wie der Spielende-Zustand landet.
function fuegeStatistikUpdatesHinzu(updates, spieler, gewinnerUid) {
  if (!aktiverFamilienCode) return; // ohne Familien-Code wird keine Statistik gespeichert
  Object.keys(spieler).forEach(uid => {
    if (spieler[uid].istSimuliert) return;
    const slug = slugifyName(spieler[uid].name);
    const basis = `${BESTENLISTE_PFAD}/${aktiverFamilienCode}/${slug}`;
    updates[`${basis}/name`] = spieler[uid].name;
    updates[`${basis}/gespielt`] = firebase.database.ServerValue.increment(1);
    if (uid === gewinnerUid) {
      updates[`${basis}/gewonnen`] = firebase.database.ServerValue.increment(1);
    }
  });
}

let eigeneUid = null;
let aktuellerRaumCode = null;
let listener = null;
let roomRef = null;
let ownHandRef = null;
let letzterOeffentlicherZustand = null;
let letzteEigeneKarten = [];
let kategorieWahlUnterwegs = false;
let botZugGeplantFuer = null;

const authBereit = new Promise(resolve => {
  auth.onAuthStateChanged(user => {
    if (user) {
      eigeneUid = user.uid;
      resolve(user.uid);
    }
  });
});
auth.signInAnonymously().catch(err => console.error("Anonyme Anmeldung fehlgeschlagen:", err));

function erzeugeRaumCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += RAUMCODE_ZEICHEN[Math.floor(Math.random() * RAUMCODE_ZEICHEN.length)];
  }
  return code;
}

async function erzeugeEindeutigenRaumCode() {
  for (let versuch = 0; versuch < 5; versuch++) {
    const code = erzeugeRaumCode();
    const snap = await db.ref(`raeume/${code}`).once("value");
    if (!snap.exists()) return code;
  }
  throw new Error("Konnte keinen freien Raum-Code erzeugen.");
}

function zustandOhneRaum() {
  return {
    raumCode: null,
    modus: null,
    eigenerSpielerId: eigeneUid,
    spieler: [],
    amZugSpielerId: null,
    phase: "start",
    kartenSet: "familie",
    deckgroesse: "normal",
    eigeneKarten: [],
    aktuelleRunde: {
      gewaehlteKategorie: null,
      ausgespielteKarten: [],
      gewinnerSpielerId: null,
      weiterBestaetigtAnzahl: 0,
      weiterBestaetigtGesamt: 0,
      habeIchBestaetigt: false
    },
    siegerSpielerId: null,
    maxSpieler: MAX_SPIELER
  };
}

function rundenKartenAlsArray(aktuelleRunde) {
  if (!aktuelleRunde || !aktuelleRunde.ausgespielteKarten) return [];
  return Object.keys(aktuelleRunde.ausgespielteKarten).map(uid => ({
    spielerId: uid,
    karte: aktuelleRunde.ausgespielteKarten[uid]
  }));
}

function getZustand() {
  const raum = letzterOeffentlicherZustand;
  if (!raum) return zustandOhneRaum();

  const spielerListe = Object.keys(raum.spieler || {}).map(uid => ({ id: uid, ...raum.spieler[uid] }));
  const eigenerSpieler = raum.spieler ? raum.spieler[eigeneUid] : null;

  let phaseFuerUi = raum.phase;
  if (raum.phase === "amZug") {
    phaseFuerUi = raum.amZugSpielerId === eigeneUid ? "amZug" : "warteAufAndere";
  } else if (raum.phase === "aufloesungLaeuft") {
    // kurzer Zwischenzustand, während der Gastgeber im Hintergrund vergleicht
    phaseFuerUi = "warteAufAndere";
  }

  const bestaetigtVon = raum.aktuelleRunde && raum.aktuelleRunde.weiterBestaetigtVon
    ? Object.keys(raum.aktuelleRunde.weiterBestaetigtVon)
    : [];
  const aktiveSpielerAnzahl = spielerListe.filter(s => !s.istAusgeschieden).length;

  return {
    raumCode: aktuellerRaumCode,
    modus: eigenerSpieler ? (eigenerSpieler.istHost ? "host" : "gast") : null,
    eigenerSpielerId: eigeneUid,
    spieler: spielerListe,
    amZugSpielerId: raum.amZugSpielerId || null,
    phase: phaseFuerUi,
    kartenSet: raum.kartenSet || "familie",
    deckgroesse: raum.deckgroesse || "normal",
    eigeneKarten: letzteEigeneKarten,
    aktuelleRunde: {
      gewaehlteKategorie: raum.aktuelleRunde ? raum.aktuelleRunde.gewaehlteKategorie : null,
      ausgespielteKarten: rundenKartenAlsArray(raum.aktuelleRunde),
      gewinnerSpielerId: raum.aktuelleRunde ? raum.aktuelleRunde.gewinnerSpielerId : null,
      weiterBestaetigtAnzahl: bestaetigtVon.length,
      weiterBestaetigtGesamt: aktiveSpielerAnzahl,
      habeIchBestaetigt: bestaetigtVon.includes(eigeneUid)
    },
    siegerSpielerId: raum.siegerSpielerId || null,
    maxSpieler: MAX_SPIELER
  };
}

function benachrichtige() {
  if (listener && letzterOeffentlicherZustand) {
    listener(getZustand());
  }
}

function loeseListenerAb() {
  if (roomRef) roomRef.off();
  if (ownHandRef) ownHandRef.off();
  roomRef = null;
  ownHandRef = null;
  letzterOeffentlicherZustand = null;
  letzteEigeneKarten = [];
}

function betretRaumLokal(code) {
  loeseListenerAb();
  aktuellerRaumCode = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (e) {
    // unkritisch, falls localStorage nicht verfügbar ist
  }

  roomRef = db.ref(`raeume/${code}`);
  ownHandRef = db.ref(`geheime_karten/${code}/${eigeneUid}/karten`);

  roomRef.on("value", snap => {
    letzterOeffentlicherZustand = snap.val();
    if (!letzterOeffentlicherZustand) return; // Raum wurde beendet/gelöscht
    pruefeUndLoeseAlsHostAus();
    benachrichtige();
  });

  ownHandRef.on("value", snap => {
    letzteEigeneKarten = snap.val() || [];
    benachrichtige();
  });
}

// --- Öffentliche API ---

async function erstelleRaum(spielerName, kartenSet, deckgroesse) {
  if (!spielerName || !spielerName.trim()) {
    return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  }
  await authBereit;
  const code = await erzeugeEindeutigenRaumCode();
  await db.ref(`raeume/${code}`).set({
    erstelltAm: firebase.database.ServerValue.TIMESTAMP,
    hostId: eigeneUid,
    phase: "lobby",
    kartenSet: kartenSet === "auto" ? "auto" : "familie",
    deckgroesse: KARTEN_PRO_SPIELER_NACH_DECKGROESSE.hasOwnProperty(deckgroesse) ? deckgroesse : "normal",
    amZugSpielerId: null,
    siegerSpielerId: null,
    aktuelleRunde: {
      gewaehlteKategorie: null,
      ausgespielteKarten: null,
      gewinnerSpielerId: null,
      weiterBestaetigtVon: null,
      vergleichStartZeit: null
    },
    spieler: {
      [eigeneUid]: {
        name: spielerName.trim(),
        avatarFarbe: SPIELER_FARBEN[0],
        istHost: true,
        istSimuliert: false,
        kartenAnzahl: 0,
        istAusgeschieden: false
      }
    }
  });
  betretRaumLokal(code);
  return { erfolg: true, raumCode: code };
}

async function tritRaumBei(raumCode, spielerName) {
  if (!spielerName || !spielerName.trim()) {
    return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  }
  if (!raumCode || !raumCode.trim()) {
    return { erfolg: false, fehler: "Bitte einen Raum-Code eingeben." };
  }
  await authBereit;
  const code = raumCode.trim().toUpperCase();
  const snap = await db.ref(`raeume/${code}`).once("value");
  if (!snap.exists()) {
    return { erfolg: false, fehler: "Raum nicht gefunden." };
  }
  const raum = snap.val();
  const spielerListe = raum.spieler || {};

  if (spielerListe[eigeneUid]) {
    betretRaumLokal(code); // schon Mitglied, z.B. nach Reload
    return { erfolg: true };
  }
  if (raum.phase !== "lobby") {
    return { erfolg: false, fehler: "Dieses Spiel läuft schon." };
  }
  if (Object.keys(spielerListe).length >= MAX_SPIELER) {
    return { erfolg: false, fehler: "Raum ist voll (max. 8)." };
  }

  const farbe = SPIELER_FARBEN[Object.keys(spielerListe).length % SPIELER_FARBEN.length];
  await db.ref(`raeume/${code}/spieler/${eigeneUid}`).set({
    name: spielerName.trim(),
    avatarFarbe: farbe,
    istHost: false,
    istSimuliert: false,
    kartenAnzahl: 0,
    istAusgeschieden: false
  });
  betretRaumLokal(code);
  return { erfolg: true };
}

async function fuegeTestSpielerHinzu() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  const uids = Object.keys(raum.spieler || {});
  if (uids.length >= MAX_SPIELER) return { erfolg: false, fehler: "Lobby ist voll (max. 8)." };

  const verwendeteNamen = uids.map(uid => raum.spieler[uid].name);
  const freierName = TEST_NAMEN_POOL.find(n => !verwendeteNamen.includes(n)) || ("Gast " + (uids.length + 1));
  const botId = "bot-" + Math.random().toString(36).slice(2, 9);
  const farbe = SPIELER_FARBEN[uids.length % SPIELER_FARBEN.length];

  await db.ref(`raeume/${aktuellerRaumCode}/spieler/${botId}`).set({
    name: freierName,
    avatarFarbe: farbe,
    istHost: false,
    istSimuliert: true,
    kartenAnzahl: 0,
    istAusgeschieden: false
  });
  return { erfolg: true };
}

async function starteSpiel() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  const uids = Object.keys(raum.spieler || {});
  if (uids.length < 2) return { erfolg: false, fehler: "Mindestens 2 Spieler nötig." };

  const ueberschreibungen = aktiverFamilienCode
    ? (await db.ref(`${KARTEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${raum.kartenSet}`).once("value")).val() || {}
    : {};
  const deck = holeVollstaendigesDeck(raum.kartenSet, ueberschreibungen);
  // Personalisierte Karten (eigene Fotos/Namen, inkl. komplett neu angelegter Karten)
  // sollen nie durch die Zufallsauswahl herausfallen, wenn die Deckgroesse kleiner
  // als der gesamte Kartenpool ist.
  const personalisierteIds = new Set(Object.keys(ueberschreibungen));
  const personalisierteKarten = mischeArray(deck.filter(karte => personalisierteIds.has(karte.id)));
  const uebrigeKarten = mischeArray(deck.filter(karte => !personalisierteIds.has(karte.id)));
  const proSpieler = KARTEN_PRO_SPIELER_NACH_DECKGROESSE[raum.deckgroesse || "normal"];
  const benoetigteAnzahl = proSpieler ? Math.min(proSpieler * uids.length, deck.length) : deck.length;
  const gemischt = mischeArray(personalisierteKarten.concat(uebrigeKarten).slice(0, benoetigteAnzahl));
  const haende = {};
  uids.forEach(uid => (haende[uid] = []));
  gemischt.forEach((karte, index) => {
    haende[uids[index % uids.length]].push(karte);
  });

  const code = aktuellerRaumCode;
  const updates = {};
  uids.forEach(uid => {
    updates[`geheime_karten/${code}/${uid}/karten`] = haende[uid];
    updates[`raeume/${code}/spieler/${uid}/kartenAnzahl`] = haende[uid].length;
    updates[`raeume/${code}/spieler/${uid}/istAusgeschieden`] = false;
  });
  updates[`raeume/${code}/amZugSpielerId`] = uids[Math.floor(Math.random() * uids.length)];
  updates[`raeume/${code}/phase`] = "amZug";

  await db.ref().update(updates);
  return { erfolg: true };
}

async function waehleKategorie(kategorieSchluessel) {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "amZug" || raum.amZugSpielerId !== eigeneUid) return { erfolg: false };
  if (kategorieWahlUnterwegs) return { erfolg: false };
  kategorieWahlUnterwegs = true;
  try {
    await db.ref(`raeume/${aktuellerRaumCode}`).update({
      phase: "aufloesungLaeuft",
      "aktuelleRunde/gewaehlteKategorie": kategorieSchluessel
    });
    return { erfolg: true };
  } finally {
    kategorieWahlUnterwegs = false;
  }
}

async function bestaetigeWeiter() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "vergleich") return { erfolg: false };
  if (!raum.aktuelleRunde || !raum.aktuelleRunde.gewinnerSpielerId) return { erfolg: false }; // Bockrunde laeuft noch
  await db.ref(`raeume/${aktuellerRaumCode}/aktuelleRunde/weiterBestaetigtVon/${eigeneUid}`).set(true);
  return { erfolg: true };
}

async function verlasseSpiel() {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (!raum || !code) return { erfolg: false };

  if (raum.hostId === eigeneUid) {
    // Gastgeber bricht das Spiel für alle ab.
    await db.ref(`raeume/${code}/phase`).set("abgebrochen");
  } else {
    // Bitte den Gastgeber, die eigenen Karten zu verteilen, sobald es sicher ist.
    // Map statt Einzelfeld: Verlassen zwei Gäste kurz nacheinander, würde ein
    // Einzelfeld die erste Anfrage überschreiben (Geist-Spieler bliebe im Raum
    // und das Spiel hinge, sobald er am Zug wäre). Das Alt-Feld wird zusätzlich
    // gesetzt, falls der Gastgeber noch eine alte App-Version offen hat.
    await db.ref(`raeume/${code}`).update({
      [`austrittAnfragen/${eigeneUid}`]: true,
      austrittAnfrageUid: eigeneUid
    });
  }

  loeseListenerAb();
  aktuellerRaumCode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (listener) listener(zustandOhneRaum());
  return { erfolg: true };
}

async function neuesSpiel() {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (raum && code && raum.hostId === eigeneUid) {
    const updates = { [`raeume/${code}`]: null };
    Object.keys(raum.spieler || {}).forEach(uid => {
      updates[`geheime_karten/${code}/${uid}`] = null;
    });
    db.ref().update(updates).catch(() => {});
  }
  loeseListenerAb();
  aktuellerRaumCode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (listener) listener(zustandOhneRaum());
  return { erfolg: true };
}

async function ladeBestenliste() {
  await authBereit;
  if (!aktiverFamilienCode) return [];
  const snap = await db.ref(`${BESTENLISTE_PFAD}/${aktiverFamilienCode}`).once("value");
  const daten = snap.val() || {};
  return Object.values(daten)
    .map(eintrag => {
      const gespielt = eintrag.gespielt || 0;
      const gewonnen = eintrag.gewonnen || 0;
      return {
        name: eintrag.name || "?",
        gespielt,
        gewonnen,
        prozent: gespielt > 0 ? Math.round((gewonnen / gespielt) * 100) : 0
      };
    })
    .sort((a, b) => b.prozent - a.prozent || b.gewonnen - a.gewonnen);
}

// --- Kartenverwaltung (Karten bearbeiten + Fotos hinterlegen) ---

async function ladeKartenZurBearbeitung(kartenSet) {
  await authBereit;
  if (!aktiverFamilienCode) return getMockDeck(kartenSet);
  const snap = await db.ref(`${KARTEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}`).once("value");
  const ueberschreibungen = snap.val() || {};
  return holeVollstaendigesDeck(kartenSet, ueberschreibungen);
}

async function speichereKartenUebersteuerung(kartenSet, kartenId, daten) {
  if (!aktiverFamilienCode) return { erfolg: false, fehler: "Kein Familien-Code gesetzt." };
  await authBereit;
  await db.ref(`${KARTEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}/${kartenId}`).set(daten);
  return { erfolg: true };
}

async function setzeKarteZurueck(kartenSet, kartenId) {
  if (!aktiverFamilienCode) return { erfolg: false };
  await authBereit;
  await db.ref(`${KARTEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}/${kartenId}`).remove();
  return { erfolg: true };
}

// Liefert die effektiven Kriterien (Label + Icon) eines Kartensets, gemergt mit
// gespeicherten Umbenennungen. Ohne Familien-Code (oder ohne Ueberschreibung) kommen
// einfach die Basis-Kriterien aus mock-data.js zurueck.
async function ladeKategorienZurBearbeitung(kartenSet) {
  await authBereit;
  const basis = getKategorien(kartenSet);
  if (!aktiverFamilienCode) return { ...basis };
  const snap = await db.ref(`${KATEGORIEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}`).once("value");
  const ueberschreibungen = snap.val() || {};
  const ergebnis = {};
  Object.keys(basis).forEach(schluessel => {
    ergebnis[schluessel] = wendeKategorieUebersteuerungAn(basis[schluessel], ueberschreibungen[schluessel]);
  });
  return ergebnis;
}

async function speichereKategorieUebersteuerung(kartenSet, schluessel, daten) {
  if (!aktiverFamilienCode) return { erfolg: false, fehler: "Kein Familien-Code gesetzt." };
  await authBereit;
  await db.ref(`${KATEGORIEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}/${schluessel}`).set(daten);
  return { erfolg: true };
}

async function setzeKategorieZurueck(kartenSet, schluessel) {
  if (!aktiverFamilienCode) return { erfolg: false };
  await authBereit;
  await db.ref(`${KATEGORIEN_UEBERSTEUERUNGEN_PFAD}/${aktiverFamilienCode}/${kartenSet}/${schluessel}`).remove();
  return { erfolg: true };
}

function onZustandsAenderung(callback) {
  listener = callback;
  let gespeicherterCode = null;
  try {
    gespeicherterCode = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (gespeicherterCode) {
    authBereit.then(() => betretRaumLokal(gespeicherterCode));
  } else {
    callback(zustandOhneRaum());
  }
}

// --- Gastgeber-Schiedsrichter-Logik (einzige Instanz mit Zugriff auf alle Geheim-Hände) ---

// Verhindert, dass zwei on()-Events im Fenster zwischen Trigger und dem
// phase-Update auf "vergleich" die Auflösung doppelt starten (z.B. wenn im
// selben Moment eine Austrittsanfrage geschrieben wird).
let aufloesungLaeuftLokal = false;

function pruefeUndLoeseAlsHostAus() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.hostId !== eigeneUid) return;

  if (raum.phase === "aufloesungLaeuft" && raum.aktuelleRunde && raum.aktuelleRunde.gewaehlteKategorie && !raum.aktuelleRunde.ausgespielteKarten) {
    if (!aufloesungLaeuftLokal) {
      aufloesungLaeuftLokal = true;
      loeseRundeAufAlsHost(raum.aktuelleRunde.gewaehlteKategorie).finally(() => { aufloesungLaeuftLokal = false; });
    }
  }
  if (raum.phase === "vergleich" && raum.aktuelleRunde && raum.aktuelleRunde.gewinnerSpielerId) {
    pruefeWeiterBedingungAlsHost();
  }
  if (raum.phase === "amZug" && raum.amZugSpielerId && raum.spieler[raum.amZugSpielerId] && raum.spieler[raum.amZugSpielerId].istSimuliert) {
    planeBotZugFallsNoetig(raum.amZugSpielerId);
  }
  // Eine Karten-Runde ist nie "in der Luft", solange phase === "amZug" ist –
  // genau dann ist es sicher, ausstehende Austrittsanfragen zu verarbeiten.
  // austrittAnfragen ist eine Map (mehrere gleichzeitige Anfragen möglich);
  // das Alt-Feld austrittAnfrageUid wird für Gäste mit alter App-Version weiter beachtet.
  if (raum.phase === "amZug") {
    const anfragen = Object.keys(raum.austrittAnfragen || {});
    if (raum.austrittAnfrageUid && !anfragen.includes(raum.austrittAnfrageUid)) anfragen.push(raum.austrittAnfrageUid);
    const naechster = anfragen.find((uid) => raum.spieler[uid]);
    if (naechster) entferneSpielerUndVerteileKartenAlsHost(naechster);
  }
}

const WEITER_MINDESTWARTEZEIT_MS = 10000;
let weiterTransferAusgeloestFuer = null; // verhindert doppelten Transfer fuer dieselbe Runde
let weiterTimerGeplantFuer = null;

// "Weiter" geht erst weiter, wenn entweder alle aktiven Spieler:innen bestaetigt haben,
// oder spaetestens nach WEITER_MINDESTWARTEZEIT_MS seit Rundenende (Fallback-Timer).
function pruefeWeiterBedingungAlsHost() {
  const raum = letzterOeffentlicherZustand;
  const runde = raum.aktuelleRunde;
  const startZeit = runde.vergleichStartZeit;
  if (weiterTransferAusgeloestFuer === startZeit) return;

  const aktiveUids = Object.keys(raum.spieler).filter(uid => !raum.spieler[uid].istAusgeschieden);
  const bestaetigtUids = runde.weiterBestaetigtVon ? Object.keys(runde.weiterBestaetigtVon) : [];
  const alleBestaetigt = aktiveUids.length > 0 && aktiveUids.every(uid => bestaetigtUids.includes(uid));

  if (alleBestaetigt) {
    weiterTransferAusgeloestFuer = startZeit;
    fuehreRundenTransferAusAlsHost();
    return;
  }

  if (weiterTimerGeplantFuer === startZeit) return; // Fallback-Timer schon fuer diese Runde geplant
  weiterTimerGeplantFuer = startZeit;
  setTimeout(() => {
    weiterTimerGeplantFuer = null;
    const aktuellerRaum = letzterOeffentlicherZustand;
    if (!aktuellerRaum || !aktuellerRaum.aktuelleRunde) return;
    if (aktuellerRaum.aktuelleRunde.vergleichStartZeit !== startZeit) return; // Runde ist schon weiter
    if (weiterTransferAusgeloestFuer === startZeit) return;
    weiterTransferAusgeloestFuer = startZeit;
    fuehreRundenTransferAusAlsHost();
  }, WEITER_MINDESTWARTEZEIT_MS);
}

let entfernungLaeuft = false;

async function entferneSpielerUndVerteileKartenAlsHost(verlassenerUid) {
  if (entfernungLaeuft) return;
  entfernungLaeuft = true;
  try {
    const code = aktuellerRaumCode;
    const raum = letzterOeffentlicherZustand;

    const verlasseneHandSnap = await db.ref(`geheime_karten/${code}/${verlassenerUid}/karten`).once("value");
    const verlasseneKarten = verlasseneHandSnap.val() || [];

    const verbleibendeUids = Object.keys(raum.spieler).filter(
      uid => uid !== verlassenerUid && !raum.spieler[uid].istAusgeschieden
    );

    const updates = {};

    if (verbleibendeUids.length === 0) {
      updates[`raeume/${code}/phase`] = "abgebrochen";
    } else {
      const schnappschuesse = await Promise.all(
        verbleibendeUids.map(uid => db.ref(`geheime_karten/${code}/${uid}/karten`).once("value"))
      );
      verbleibendeUids.forEach((uid, i) => {
        const eigeneHand = (schnappschuesse[i].val() || []).slice();
        // Zu gleichen Teilen verteilen: Karte i des Verlassenen geht an Spieler (i % Anzahl).
        const anteil = verlasseneKarten.filter((_, kartenIndex) => kartenIndex % verbleibendeUids.length === i);
        const neueHand = eigeneHand.concat(anteil);
        updates[`geheime_karten/${code}/${uid}/karten`] = neueHand;
        updates[`raeume/${code}/spieler/${uid}/kartenAnzahl`] = neueHand.length;
      });

      if (verbleibendeUids.length === 1) {
        updates[`raeume/${code}/phase`] = "beendet";
        updates[`raeume/${code}/siegerSpielerId`] = verbleibendeUids[0];
        updates[`raeume/${code}/amZugSpielerId`] = null;
        const spielerOhneVerlassenen = { ...raum.spieler };
        delete spielerOhneVerlassenen[verlassenerUid];
        fuegeStatistikUpdatesHinzu(updates, spielerOhneVerlassenen, verbleibendeUids[0]);
      } else if (raum.amZugSpielerId === verlassenerUid) {
        updates[`raeume/${code}/amZugSpielerId`] = verbleibendeUids[0];
      }
    }

    updates[`raeume/${code}/spieler/${verlassenerUid}`] = null;
    updates[`geheime_karten/${code}/${verlassenerUid}`] = null;
    updates[`raeume/${code}/austrittAnfragen/${verlassenerUid}`] = null;
    // Alt-Feld nur löschen, wenn es diese (oder eine verwaiste) Anfrage betrifft —
    // sonst ginge die Anfrage eines Gastes mit alter App-Version verloren.
    if (raum.austrittAnfrageUid === verlassenerUid || !raum.spieler[raum.austrittAnfrageUid]) {
      updates[`raeume/${code}/austrittAnfrageUid`] = null;
    }

    await db.ref().update(updates);
  } finally {
    entfernungLaeuft = false;
  }
}

async function loeseRundeAufAlsHost(kategorieSchluessel) {
  const code = aktuellerRaumCode;
  const raum = letzterOeffentlicherZustand;
  const aktiveUids = Object.keys(raum.spieler).filter(uid => !raum.spieler[uid].istAusgeschieden);

  // Phase sofort auf "vergleich" setzen, damit der Aufloesungs-Trigger nicht doppelt feuert,
  // waehrend die (eventuell mehrstufige) Bockrunde unten noch laeuft.
  await db.ref(`raeume/${code}`).update({
    phase: "vergleich",
    "aktuelleRunde/gewinnerSpielerId": null,
    "aktuelleRunde/gleichstand": false
  });

  await fuehreVergleichsRundeAlsHost(kategorieSchluessel, aktiveUids, 0, []);
}

// Vergleicht die Karte an kartenIndex aller teilnehmerUids in der gewaehlten Kategorie.
// Bei Gleichstand des Hoechstwerts wird automatisch mit der naechsten Karte (gleiche Kategorie)
// weiterverglichen ("Bockrunde") – nur unter den gleichstehenden Spieler:innen, alle gespielten
// Karten sammeln sich im Pott und gehen am Ende komplett an die Siegerin/den Sieger.
async function fuehreVergleichsRundeAlsHost(kategorieSchluessel, teilnehmerUids, kartenIndex, bisherigerPott) {
  const code = aktuellerRaumCode;
  const schnappschuesse = await Promise.all(
    teilnehmerUids.map(uid => db.ref(`geheime_karten/${code}/${uid}/karten`).once("value"))
  );

  const aktuelleKarten = {};
  const pott = bisherigerPott.slice();
  teilnehmerUids.forEach((uid, i) => {
    const hand = schnappschuesse[i].val() || [];
    const karte = hand[kartenIndex];
    if (karte) {
      aktuelleKarten[uid] = karte;
      pott.push({ spielerId: uid, karte });
    }
  });

  const teilnehmerMitKarte = Object.keys(aktuelleKarten);
  if (teilnehmerMitKarte.length === 0) {
    // Niemand hat mehr eine Karte für die Bockrunde – Notbremse, damit das Spiel nicht haengt.
    await db.ref(`raeume/${code}/aktuelleRunde`).update({
      gewinnerSpielerId: teilnehmerUids[0],
      gleichstand: false,
      pottKarten: pott,
      weiterBestaetigtVon: null,
      vergleichStartZeit: firebase.database.ServerValue.TIMESTAMP
    });
    return;
  }

  let hoechstwert = -Infinity;
  teilnehmerMitKarte.forEach(uid => {
    const wert = aktuelleKarten[uid].eigenschaften[kategorieSchluessel];
    if (wert > hoechstwert) hoechstwert = wert;
  });
  const gleichstandUids = teilnehmerMitKarte.filter(
    uid => aktuelleKarten[uid].eigenschaften[kategorieSchluessel] === hoechstwert
  );

  if (gleichstandUids.length === 1) {
    await db.ref(`raeume/${code}/aktuelleRunde`).update({
      ausgespielteKarten: aktuelleKarten,
      gewinnerSpielerId: gleichstandUids[0],
      gleichstand: false,
      pottKarten: pott,
      weiterBestaetigtVon: null,
      vergleichStartZeit: firebase.database.ServerValue.TIMESTAMP
    });
    return;
  }

  await db.ref(`raeume/${code}/aktuelleRunde`).update({
    ausgespielteKarten: aktuelleKarten,
    gewinnerSpielerId: null,
    gleichstand: true,
    pottKarten: pott
  });
  await new Promise(resolve => setTimeout(resolve, GLEICHSTAND_VERZOEGERUNG_MS));
  await fuehreVergleichsRundeAlsHost(kategorieSchluessel, gleichstandUids, kartenIndex + 1, pott);
}

async function fuehreRundenTransferAusAlsHost() {
  const code = aktuellerRaumCode;
  const raum = letzterOeffentlicherZustand;
  const runde = raum.aktuelleRunde;
  const gewinnerUid = runde.gewinnerSpielerId;
  // pottKarten enthaelt alle Karten aller Bockrunden-Stufen; ohne Gleichstand ist es genau
  // eine Karte pro Teilnehmer:in (wie zuvor).
  const pottKarten = runde.pottKarten || [];
  const beteiligteUids = [...new Set(pottKarten.map(eintrag => eintrag.spielerId))];

  const schnappschuesse = await Promise.all(
    beteiligteUids.map(uid => db.ref(`geheime_karten/${code}/${uid}/karten`).once("value"))
  );

  const updates = {};
  const gewonneneKarten = [];
  beteiligteUids.forEach((uid, i) => {
    const hand = (schnappschuesse[i].val() || []).slice();
    const anzahlAusPott = pottKarten.filter(eintrag => eintrag.spielerId === uid).length;
    gewonneneKarten.push(...hand.splice(0, anzahlAusPott));
    updates[`geheime_karten/${code}/${uid}/karten`] = hand;
  });
  const gewinnerRestHand = updates[`geheime_karten/${code}/${gewinnerUid}/karten`] || [];
  updates[`geheime_karten/${code}/${gewinnerUid}/karten`] = gewinnerRestHand.concat(gewonneneKarten);

  let nochAktiveAnzahl = 0;
  let letzterAktiverUid = null;
  Object.keys(raum.spieler).forEach(uid => {
    const aktuelleAnzahl = beteiligteUids.includes(uid)
      ? updates[`geheime_karten/${code}/${uid}/karten`].length
      : raum.spieler[uid].kartenAnzahl;
    const ausgeschieden = aktuelleAnzahl === 0;
    updates[`raeume/${code}/spieler/${uid}/kartenAnzahl`] = aktuelleAnzahl;
    updates[`raeume/${code}/spieler/${uid}/istAusgeschieden`] = ausgeschieden;
    if (!ausgeschieden) {
      nochAktiveAnzahl++;
      letzterAktiverUid = uid;
    }
  });

  if (nochAktiveAnzahl <= 1) {
    const siegerUid = letzterAktiverUid || gewinnerUid;
    updates[`raeume/${code}/phase`] = "beendet";
    updates[`raeume/${code}/siegerSpielerId`] = siegerUid;
    updates[`raeume/${code}/amZugSpielerId`] = null;
    fuegeStatistikUpdatesHinzu(updates, raum.spieler, siegerUid);
  } else {
    updates[`raeume/${code}/phase`] = "amZug";
    updates[`raeume/${code}/amZugSpielerId`] = gewinnerUid;
    updates[`raeume/${code}/aktuelleRunde`] = { gewaehlteKategorie: null, ausgespielteKarten: null, gewinnerSpielerId: null };
  }

  await db.ref().update(updates);
}

function planeBotZugFallsNoetig(botUid) {
  if (botZugGeplantFuer === botUid) return; // schon geplant
  botZugGeplantFuer = botUid;
  setTimeout(async () => {
    botZugGeplantFuer = null;
    const raum = letzterOeffentlicherZustand;
    if (!raum || raum.phase !== "amZug" || raum.amZugSpielerId !== botUid) return;
    const handSnap = await db.ref(`geheime_karten/${aktuellerRaumCode}/${botUid}/karten`).once("value");
    const hand = handSnap.val() || [];
    if (!hand.length) return;
    const kategorien = Object.keys(hand[0].eigenschaften);
    const zufallsKategorie = kategorien[Math.floor(Math.random() * kategorien.length)];
    await db.ref(`raeume/${aktuellerRaumCode}`).update({
      phase: "aufloesungLaeuft",
      "aktuelleRunde/gewaehlteKategorie": zufallsKategorie
    });
  }, AUTO_PLAY_VERZOEGERUNG_MS);
}

const gameService = {
  erstelleRaum,
  tritRaumBei,
  fuegeTestSpielerHinzu,
  starteSpiel,
  waehleKategorie,
  bestaetigeWeiter,
  verlasseSpiel,
  neuesSpiel,
  getZustand,
  onZustandsAenderung,
  ladeBestenliste,
  ladeKartenZurBearbeitung,
  speichereKartenUebersteuerung,
  setzeKarteZurueck,
  ladeKategorienZurBearbeitung,
  speichereKategorieUebersteuerung,
  setzeKategorieZurueck,
  getFamilienCode,
  setzeFamilienCode
};
