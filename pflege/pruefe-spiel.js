/* ==========================================================================
   Familien-Quartett — Regelprüfung in Node
   ==========================================================================

   Spielt vollständige Partien gegen die ECHTE `game-service.js` — nicht gegen
   einen Nachbau. Firebase wird durch die
   Attrappe nebenan ersetzt, `setTimeout` durch eine Warteschlange, die die
   Reihenfolge beibehält, aber nicht wirklich wartet.

   Geprüft wird nach JEDER Runde:
     1. Kartenerhaltung — keine Karte verschwindet, keine vermehrt sich
     2. Kernregel — der Stich geht an den höchsten Wert der gewählten Kategorie
     3. Bestätigen wirkt — nach "Weiter" geht es sofort weiter, ohne dass der
        10-Sekunden-Notfalltimer feuern muss
     4. Partieende — genau eine Person hält am Ende alle Karten und ist als
        Sieger eingetragen

   Aufruf:
     node pruefe-spiel.js                 15 Partien
     node pruefe-spiel.js x 30            eigene Partienzahl
     node pruefe-spiel.js x 5 3 karten-vermehren   Mutationsprobe

   Mutationsproben (der Prüfstand MUSS bei jeder anschlagen — schlägt er nicht
   an, misst er nichts):
     karten-vermehren   splice -> slice im Kartentransfer
     falscher-sieger    Höchstwertsuche umgedreht
     vor-dem-fix        nimmt den Weiter-Fix vom 04.09.2026 zurück

   ⚠️ Die Attrappe kennt KEINE Sicherheitsregeln. Alles über .read/.write ist
   hier nicht belegt — das geht nur gegen echtes Firebase.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { macheDb } = require('./firebase-attrappe.js');

// Eigene Datenbank, deshalb kein Namensraum-Praefix vor den Pfaden.
const WURZEL = path.resolve(__dirname, '..');
const NAMENSRAUM = { 'familien-quartett': '' };
const SPIELE = ['familien-quartett'];
const PARTIEN = Number(process.argv[3] || 15);
const BOTS = Number(process.argv[4] || 3);
const MUTATION = process.argv[5] || null;

const tick = async (n = 60) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function ladeQuellen(spiel) {
  const ordner = WURZEL;
  const mock = fs.readFileSync(path.join(ordner, 'mock-data.js'), 'utf8');
  let svc = fs.readFileSync(path.join(ordner, 'game-service.js'), 'utf8');

  if (MUTATION === 'karten-vermehren') {
    const a = 'gewonneneKarten.push(...hand.splice(0, anzahlAusPott));';
    if (!svc.includes(a)) { console.log('  MUTATION FEHLGESCHLAGEN — Stelle nicht gefunden'); process.exit(2); }
    svc = svc.replace(a, 'gewonneneKarten.push(...hand.slice(0, anzahlAusPott));');
  } else if (MUTATION === 'falscher-sieger') {
    const a = 'if (wert > hoechstwert) hoechstwert = wert;';
    if (!svc.includes(a)) { console.log('  MUTATION FEHLGESCHLAGEN — Stelle nicht gefunden'); process.exit(2); }
    svc = svc.replace(a, 'if (hoechstwert === -Infinity || wert < hoechstwert) hoechstwert = wert;');
  } else if (MUTATION === 'vor-dem-fix') {
    const a = '!raum.spieler[uid].istAusgeschieden && !raum.spieler[uid].istSimuliert);';
    if (!svc.includes(a)) { console.log('  MUTATION FEHLGESCHLAGEN — Fix nicht gefunden'); process.exit(2); }
    svc = svc.replace(a, '!raum.spieler[uid].istAusgeschieden);');
    svc = svc.replace(
      'const alleBestaetigt = aktiveUids.every(uid => bestaetigtUids.includes(uid));',
      'const alleBestaetigt = aktiveUids.length > 0 && aktiveUids.every(uid => bestaetigtUids.includes(uid));');
  }
  return { mock, svc };
}

function ladeSpiel(db, quellen, uid) {
  const warteschlange = [];
  const auth = { onAuthStateChanged: cb => cb({ uid }), signInAnonymously: () => Promise.resolve() };
  const firebase = { database: { ServerValue: { TIMESTAMP: db._TS } } };
  const st = fn => { warteschlange.push(fn); return warteschlange.length; };
  const svc = new Function(
    'db', 'auth', 'firebase', 'setTimeout', 'clearTimeout', 'localStorage', 'window', 'console',
    quellen.mock + '\n' + quellen.svc + '\n; return gameService;'
  )(db, auth, firebase, st, () => {}, { getItem: () => null, setItem: () => {}, removeItem: () => {} }, {}, console);
  return { svc, warteschlange };
}

function handkarten(db, kartenPfad, code) {
  const wurzel = kartenPfad.split('/').reduce((k, t) => (k && k[t]) || null, db._baum());
  const raum = (wurzel && wurzel[code]) || {};
  const alle = [];
  Object.keys(raum).forEach(uid => {
    const h = raum[uid] && raum[uid].karten;
    if (Array.isArray(h)) h.forEach(k => alle.push({ uid: uid, id: k.id }));
  });
  return alle;
}

async function pruefeSpiel(spiel) {
  const quellen = ladeQuellen(spiel);
  const kartenPfad = 'geheime_karten';
  let ok = 0, beanstandet = 0, runden = 0, maxRunden = 0, sofort = 0, aufTimer = 0;
  const gruende = {};

  for (let p = 0; p < PARTIEN; p++) {
    const db = macheDb();
    const { svc, warteschlange } = ladeSpiel(db, quellen, 'host-uid');
    await svc.erstelleRaum('Host'); await tick();
    for (let b = 0; b < BOTS; b++) { await svc.fuegeTestSpielerHinzu(); await tick(); }
    const start = await svc.starteSpiel(); await tick();
    if (!start || start.erfolg === false) { gruende['Start abgelehnt'] = (gruende['Start abgelehnt'] || 0) + 1; beanstandet++; continue; }

    const code = svc.getZustand().raumCode;
    const anfang = handkarten(db, kartenPfad, code);
    const sollAnzahl = anfang.length;
    const sollIds = anfang.map(k => k.id).sort().join(',');
    let schritte = 0, partieRunden = 0, grund = null;

    while (schritte++ < 20000) {
      const z = svc.getZustand();
      if (z.phase === 'beendet') break;

      if (z.phase === 'amZug' && z.amZugSpielerId === z.eigenerSpielerId && z.eigeneKarten.length) {
        const kats = Object.keys(z.eigeneKarten[0].eigenschaften || {});
        if (!kats.length) { grund = 'Karte ohne Eigenschaften'; break; }
        await svc.waehleKategorie(kats[Math.floor(Math.random() * kats.length)]); await tick();
      } else if (z.phase === 'vergleich' && z.aktuelleRunde.gewinnerSpielerId && !z.aktuelleRunde.habeIchBestaetigt) {
        // 2. Kernregel: der hoechste Wert der gewaehlten Kategorie gewinnt.
        const kat = z.aktuelleRunde.gewaehlteKategorie;
        const gespielt = z.aktuelleRunde.ausgespielteKarten || [];
        if (kat && gespielt.length) {
          const werte = gespielt.map(e => ({ uid: e.spielerId, wert: e.karte.eigenschaften[kat] }));
          const hoechst = Math.max.apply(null, werte.map(w => w.wert));
          const spitze = werte.filter(w => w.wert === hoechst);
          const gewinnerWert = (werte.find(w => w.uid === z.aktuelleRunde.gewinnerSpielerId) || {}).wert;
          if (spitze.length === 1 && gewinnerWert !== hoechst) {
            grund = 'falscher Rundensieger in ' + kat + ': Hoechstwert ' + hoechst + ', Gewinner hatte ' + gewinnerWert;
            break;
          }
        }
        await svc.bestaetigeWeiter(); await tick();
        // 3. Bestaetigen muss sofort wirken — sonst haengt jede Runde im Notfalltimer.
        if (svc.getZustand().phase !== 'vergleich') sofort++; else aufTimer++;
        partieRunden++;

        // 1. Kartenerhaltung
        const jetzt = handkarten(db, kartenPfad, code);
        if (jetzt.length !== sollAnzahl) { grund = 'Kartenzahl ' + jetzt.length + ' statt ' + sollAnzahl; break; }
        if (jetzt.map(k => k.id).sort().join(',') !== sollIds) { grund = 'Karten-Ids veraendert'; break; }
      }

      if (!warteschlange.length) {
        await tick(300);
        if (!warteschlange.length) { grund = 'Ablauf steht still in Phase ' + svc.getZustand().phase; break; }
      }
      const t = warteschlange.shift();
      try { t(); } catch (e) { grund = 'Timer warf: ' + e.message; break; }
      await tick();
    }

    runden += partieRunden;
    if (partieRunden > maxRunden) maxRunden = partieRunden;
    const ende = svc.getZustand();
    if (!grund && ende.phase !== 'beendet') grund = 'nicht beendet (Phase ' + ende.phase + ')';
    if (!grund) {
      // 4. Am Ende haelt genau eine Person alle Karten.
      const rest = handkarten(db, kartenPfad, code);
      const halter = rest.map(k => k.uid).filter((u, i, a) => a.indexOf(u) === i);
      if (rest.length !== sollAnzahl) grund = 'am Ende ' + rest.length + ' statt ' + sollAnzahl + ' Karten';
      else if (halter.length !== 1) grund = 'am Ende halten ' + halter.length + ' Personen Karten';
      else if (!ende.siegerSpielerId) grund = 'kein Sieger eingetragen';
      else if (ende.siegerSpielerId !== halter[0]) grund = 'Sieger haelt nicht die Karten';
    }
    if (grund) {
      const k = grund.replace(/\d+/g, 'N');
      gruende[k] = (gruende[k] || 0) + 1;
      beanstandet++;
    } else ok++;
  }

  const ges = sofort + aufTimer;
  console.log('');
  console.log('  ' + spiel.toUpperCase());
  console.log('  ' + '-'.repeat(60));
  console.log('  ' + PARTIEN + ' Partien, Gastgeber + ' + BOTS + ' KI — sauber: ' + ok + ', beanstandet: ' + beanstandet);
  console.log('  ' + runden + ' Runden, laengste Partie ' + maxRunden);
  console.log('  nach "Weiter" sofort weiter: ' + sofort + ' / ' + ges + (ges ? '  (' + Math.round(sofort / ges * 100) + ' %)' : ''));
  if (aufTimer) console.log('  ⚠️ ' + aufTimer + ' Runden mussten auf den 10-Sekunden-Notfalltimer warten');
  Object.keys(gruende).forEach(g => console.log('  ! ' + gruende[g] + 'x  ' + g));
  return beanstandet === 0 && aufTimer === 0;
}

(async () => {
  console.log('');
  console.log('  Familien-Quartett — Regelprüfung');
  if (MUTATION) console.log('  [Mutationsprobe aktiv: ' + MUTATION + ' — es MUESSEN Beanstandungen kommen]');
  let allesGut = true;
  for (const spiel of SPIELE) {
    const gut = await pruefeSpiel(spiel);
    if (!gut) allesGut = false;
  }
  console.log('');
  if (MUTATION) {
    console.log(allesGut ? '  ⚠️ MUTATION BLIEB UNBEMERKT — der Pruefstand misst hier nichts.'
                         : '  Mutation erkannt — der Pruefstand misst.');
    process.exit(allesGut ? 1 : 0);
  }
  console.log(allesGut ? '  Alles sauber.' : '  Es gibt Beanstandungen (siehe oben).');
  process.exit(allesGut ? 0 : 1);
})();
