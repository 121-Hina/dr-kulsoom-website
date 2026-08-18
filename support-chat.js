// support-chat.js — shared guest/patient Support Chat widget, usable on any
// page (Home, Booking, My Bookings). Opens in place, no navigation needed.
// Works without an account (anonymous auth + auto-assigned "Patient N"
// label), and shows the real name if the visitor is actually signed in.

import { auth, db } from "./firebase-config.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadToCloudinary } from "./dashboard-common.js";
import { notifyByRole, markRelatedAsRead } from "./notifications.js";
import { renderChatMessages } from "./chat-ui.js";
import { setTypingState } from "./presence.js";

async function getNextGuestLabel() {
  const counterRef = doc(db, "counters", "guestCounter");
  const n = await runTransaction(db, async transaction => {
    const snap = await transaction.get(counterRef);
    const next = (snap.exists() ? snap.data().count : 0) + 1;
    transaction.set(counterRef, { count: next }, { merge: true });
    return next;
  });
  return `Patient ${n}`;
}

export function initSupportChat() {
  const overlay = document.getElementById("supportChatOverlay");
  if (!overlay) return () => {};

  const messagesEl = document.getElementById("supportChatMessages");
  const form = document.getElementById("supportChatForm");
  const input = document.getElementById("supportChatInput");
  const fileInput = document.getElementById("supportChatFile");
  const closeBtn = document.getElementById("supportChatCloseBtn");

  let unsubscribe = null;
  let typingTimeout = null;

  async function openSupportChat() {
    // Show the window and a loading state immediately — the actual sign-in
    // and setup happen in the background so the click feels instant.
    overlay.classList.add("open");
    messagesEl.innerHTML = `<p class="dash-empty">Loading chat...</p>`;

    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        messagesEl.innerHTML = `<p class="dash-empty">Could not open chat. Please try again.</p>`;
        return;
      }
    }
    const uid = auth.currentUser.uid;
    const isGuest = auth.currentUser.isAnonymous;

    const existing = await getDoc(doc(db, "supportChats", uid));
    let displayName = existing.exists() ? existing.data().patientName : "";
    if (!displayName) {
      displayName = isGuest
        ? await getNextGuestLabel()
        : (await getDoc(doc(db, "patients", uid))).data()?.name || "";
    }

    await setDoc(doc(db, "supportChats", uid), {
      patientName: displayName,
      patientEmail: isGuest ? "" : (auth.currentUser.email || "")
    }, { merge: true });

    markRelatedAsRead(uid, uid);

    // First-time-only: send a friendly automatic welcome message so the
    // chat never opens looking empty and unattended.
    const messagesRef = collection(db, "supportChats", uid, "messages");
    const firstCheck = await getDocs(query(messagesRef, orderBy("createdAt", "asc"), limit(1)));
    if (firstCheck.empty) {
      await addDoc(messagesRef, {
        senderRole: "staff",
        senderId: "auto",
        text: "Welcome to Dr. Kulsoom Skin & Laser Clinic support chat! How may I help you today?",
        createdAt: serverTimestamp()
      });
    }

    if (unsubscribe) unsubscribe();
    const q = query(collection(db, "supportChats", uid, "messages"), orderBy("createdAt", "asc"));
    unsubscribe = onSnapshot(q, snap => {
      const messages = snap.docs.map(d => d.data());
      renderChatMessages(messagesEl, messages, uid);
    });
  }

  function closeSupportChat() {
    overlay.classList.remove("open");
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
    if (auth.currentUser) setTypingState(auth.currentUser.uid, false);
  }

  if (closeBtn) closeBtn.addEventListener("click", closeSupportChat);
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeSupportChat();
  });

  if (input) {
    input.addEventListener("input", () => {
      if (!auth.currentUser) return;
      setTypingState(auth.currentUser.uid, true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => setTypingState(auth.currentUser.uid, false), 2000);
    });
  }

  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!auth.currentUser) return;
      const text = input.value.trim();
      const file = fileInput.files[0];
      if (!text && !file) return;

      clearTimeout(typingTimeout);
      setTypingState(auth.currentUser.uid, false);

      let fileUrl = null, fileName = null, isImage = false;
      if (file) {
        try {
          fileUrl = await uploadToCloudinary(file);
          fileName = file.name;
          isImage = file.type.startsWith("image/");
        } catch (err) {
          alert("File upload failed. Try again.");
          return;
        }
      }

      input.value = "";
      fileInput.value = "";
      await addDoc(collection(db, "supportChats", auth.currentUser.uid, "messages"), {
        senderRole: "patient",
        senderId: auth.currentUser.uid,
        text: text || "",
        fileUrl, fileName, isImage,
        createdAt: serverTimestamp()
      });
      notifyByRole("manager", "You have a new support message from a patient.", "manager.html", auth.currentUser.uid);
      notifyByRole("admin", "You have a new support message from a patient.", "admin.html", auth.currentUser.uid);
    });
  }

  // Wire up every trigger on the page that should open this chat
  document.querySelectorAll("[data-open-support]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.preventDefault();
      const originalLabel = btn.textContent;
      btn.textContent = "Opening chat...";
      btn.disabled = true;
      await openSupportChat();
      btn.textContent = originalLabel;
      btn.disabled = false;
    });
  });

  return openSupportChat;
}
