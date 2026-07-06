// Werte aus der Firebase-Konsole: Projekteinstellungen -> "Meine Apps" -> Web-App -> SDK-Konfiguration.
// Diese Werte sind NICHT geheim (der Schutz kommt über die Datenbank-Regeln, nicht über diesen Schlüssel).
const firebaseConfig = {
  apiKey: "AIzaSyCufLyg8xwsPh5EykLXejhnl9adN0RarAY",
  authDomain: "familien-quartett.firebaseapp.com",
  databaseURL: "https://familien-quartett-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "familien-quartett",
  storageBucket: "familien-quartett.firebasestorage.app",
  messagingSenderId: "524665130540",
  appId: "1:524665130540:web:443a185eb654e4b11f0b89"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
