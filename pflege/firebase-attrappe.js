/* ==========================================================================
   Firebase-Attrappe fuer den Node-Pruefstand der Quartetts
   ==========================================================================

   Bildet genau den Ausschnitt der Firebase-API nach, den `game-service.js`
   benutzt — im Arbeitsspeicher, ohne Netz: ref/once/set/update/remove/on/off/
   push und den Server-Zeitstempel.

   ⚠️ WAS DIESE ATTRAPPE NICHT PRUEFT: die Sicherheitsregeln. Sie kennt keine
   `.read`/`.write`-Bedingungen und laesst jeden alles. Ob
   `geheime_karten/<code>/<uid>` wirklich nur der Besitzer lesen darf, ist damit
   NICHT belegt — das geht ausschliesslich gegen echtes Firebase mit
   eingespielten Rules (siehe `spiele/pflege/pruefe-rules.js`). Sie prueft den
   Spielablauf, nicht die Absicherung.

   ⚠️ Der Server-Zeitstempel MUSS monoton steigen. Die Rundenlogik benutzt
   `vergleichStartZeit` als Rundenschluessel; mit `Date.now()` bekommen in Node
   zwei Runden denselben Wert, `weiterTransferAusgeloestFuer` sperrt die
   Folgerunde aus, und der Pruefstand meldet faelschlich "Ablauf steht still".
   ========================================================================== */

'use strict';

function macheDb() {
  let baum = {};
  const horcher = [];      // {pfad, art, rueckruf}
  let pushZaehler = 0;
  let schreibZaehler = 0;

  const teile = p => String(p || '').split('/').filter(x => x.length > 0);

  function lies(pfad) {
    let k = baum;
    for (const t of teile(pfad)) {
      if (k === null || typeof k !== 'object') return null;
      if (!(t in k)) return null;
      k = k[t];
    }
    return k === undefined ? null : k;
  }

  // Firebase loescht Knoten, die auf null gesetzt werden.
  function schreib(pfad, wert) {
    schreibZaehler++;
    const t = teile(pfad);
    if (t.length === 0) { baum = wert || {}; return; }
    let k = baum;
    for (let i = 0; i < t.length - 1; i++) {
      if (k[t[i]] === null || typeof k[t[i]] !== 'object') k[t[i]] = {};
      k = k[t[i]];
    }
    const letzt = t[t.length - 1];
    if (wert === null || wert === undefined) delete k[letzt];
    else k[letzt] = JSON.parse(JSON.stringify(wert));
  }

  function melde() {
    // Kopie, damit ein Horcher, der selbst schreibt, die Liste nicht sprengt.
    horcher.slice().forEach(h => {
      if (h.art !== 'value') return;
      h.rueckruf(macheSnap(h.pfad));
    });
  }

  function macheSnap(pfad) {
    const w = lies(pfad);
    return { val: () => w, exists: () => w !== null, key: teile(pfad).pop() || null };
  }

  function ref(pfad) {
    return {
      pfad,
      once: () => Promise.resolve(macheSnap(pfad)),
      set: w => { schreib(pfad, aufloesen(w)); melde(); return Promise.resolve(); },
      remove: () => { schreib(pfad, null); melde(); return Promise.resolve(); },
      update: obj => {
        Object.keys(obj).forEach(k => schreib(pfad + '/' + k, aufloesen(obj[k])));
        melde(); return Promise.resolve();
      },
      push: w => {
        const id = 'p' + (++pushZaehler);
        if (w !== undefined) { schreib(pfad + '/' + id, aufloesen(w)); melde(); }
        return { key: id };
      },
      on: (art, rueckruf) => { horcher.push({ pfad, art, rueckruf }); rueckruf(macheSnap(pfad)); return rueckruf; },
      off: () => { for (let i = horcher.length - 1; i >= 0; i--) if (horcher[i].pfad === pfad) horcher.splice(i, 1); },
      child: k => ref(pfad + '/' + k)
    };
  }

  const TS = { '.sv': 'timestamp' };
  // Der Server-Zeitstempel muss MONOTON steigen: die Rundenlogik benutzt
  // vergleichStartZeit als Rundenschluessel. Date.now() steht in Node zwischen
  // zwei Runden still, und dann sperrt weiterTransferAusgeloestFuer die
  // Folgerunde aus — ein Artefakt der Attrappe, nicht des Spiels.
  let uhr = Date.now();
  const jetzt = () => (uhr += 37);
  function aufloesen(w) {
    if (w === TS) return jetzt();
    if (w && typeof w === 'object' && w['.sv'] === 'timestamp') return jetzt();
    if (Array.isArray(w)) return w.map(aufloesen);
    if (w && typeof w === 'object') {
      const n = {}; Object.keys(w).forEach(k => { n[k] = aufloesen(w[k]); }); return n;
    }
    return w;
  }

  return {
    ref: p => ref(p || ''),
    _baum: () => baum,
    _schreibZaehler: () => schreibZaehler,
    _TS: TS
  };
}

module.exports = { macheDb };
