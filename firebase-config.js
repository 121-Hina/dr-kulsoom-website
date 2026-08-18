// firebase-config.js
// Central Firebase setup — imported by any page that needs Auth / Firestore.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBeKPRkKcoA26zDhqcREtPS4ak_cN-IZIw",
  authDomain: "dr-kulsoom-clinic.firebaseapp.com",
  projectId: "dr-kulsoom-clinic",
  storageBucket: "dr-kulsoom-clinic.firebasestorage.app",
  messagingSenderId: "917628133857",
  appId: "1:917628133857:web:5129601eace796e35eb2a0"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Cache Firestore reads locally so repeat data (bookings list, chat history,
// settings, etc.) loads instantly from disk instead of waiting on the
// network every single time — this is the single biggest lever we have over
// how "fast" the site feels. Multi-tab variant since this site supports
// being signed in as different roles in different tabs at once.
enableMultiTabIndexedDbPersistence(db).catch(err => {
  // Non-critical — falls back to normal (server-only) behavior if the
  // browser doesn't support it (e.g. private/incognito mode in some browsers).
  console.warn("[firebase-config] offline persistence not enabled:", err.code);
});

// Keep each browser TAB's login independent instead of sharing one session
// across every tab on this site — this is what lets you be signed in as a
// patient in one tab and a manager/doctor in another at the same time.
setPersistence(auth, browserSessionPersistence);
