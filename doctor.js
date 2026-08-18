// doctor.js — Doctor Dashboard: role-gated login, session list, status marking, live chat

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadToCloudinary, wireBlog, cleanupOldMessages } from "./dashboard-common.js";
import { createNotification, markRelatedAsRead, hasUnreadFor } from "./notifications.js";
import { renderChatMessages } from "./chat-ui.js";
import { startPresenceHeartbeat, setTypingState, setRecordingState, watchPresence } from "./presence.js";

const loginWrap = document.getElementById("loginWrap");
const dashApp = document.getElementById("dashApp");
const loginForm = document.getElementById("managerLoginForm");
const loginError = document.getElementById("loginError");
const resetSuccess = document.getElementById("resetSuccess");

// ===== Login + role gate (doctor role only) =====
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.hidden = true;
  const [emailEl, passEl] = loginForm.querySelectorAll("input");
  const submitBtn = loginForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
  } catch (err) {
    loginError.textContent = "Could not sign in. Check your email and password.";
    loginError.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
});

document.getElementById("forgotPasswordBtn").addEventListener("click", async () => {
  loginError.hidden = true;
  resetSuccess.hidden = true;
  const emailEl = loginForm.querySelector('input[type="email"]');
  const email = emailEl.value.trim();
  if (!email) {
    loginError.textContent = "Enter your email above first, then tap Forgot password.";
    loginError.hidden = false;
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    resetSuccess.textContent = "Password reset email sent. Check your inbox.";
    resetSuccess.hidden = false;
  } catch (err) {
    loginError.textContent = "Could not send reset email. Check the email address is correct.";
    loginError.hidden = false;
  }
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async user => {
  const submitBtn = loginForm.querySelector("button[type='submit']");
  if (!user) {
    loginWrap.hidden = false;
    dashApp.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
    return;
  }
  try {
    const staffSnap = await getDoc(doc(db, "staff", user.uid));
    const role = staffSnap.exists() ? staffSnap.data().role : null;

    if (role === "doctor" || role === "admin") {
      loginWrap.hidden = true;
      dashApp.hidden = false;
      initDashboard();
    } else {
      loginError.textContent = "This account isn't authorized for the Doctor Dashboard.";
      loginError.hidden = false;
      await signOut(auth);
    }
  } catch (err) {
    loginError.textContent = "Could not verify access: " + (err.message || err.code || "unknown error");
    loginError.hidden = false;
    await signOut(auth);
  }
});

// ===== Dashboard =====
let dashboardInitialized = false;
let currentStatus = "upcoming";

function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  const sessionsPanel = document.getElementById("sessionsPanel");
  const blogPanel = document.getElementById("blogPanel");
  const blogTabBtn = document.getElementById("blogTabBtn");

  document.querySelectorAll(".dash-tab[data-status]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      sessionsPanel.hidden = false;
      blogPanel.hidden = true;
      currentStatus = tab.dataset.status;
      loadSessions();
    });
  });

  if (blogTabBtn) {
    blogTabBtn.addEventListener("click", () => {
      document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
      blogTabBtn.classList.add("active");
      sessionsPanel.hidden = true;
      blogPanel.hidden = false;
    });
  }

  wireBlog(db);
  loadSessions();
}

async function loadSessions() {
  const listEl = document.getElementById("sessionsList");
  listEl.innerHTML = `<p class="dash-empty">Loading sessions...</p>`;

  // "Upcoming" = confirmed bookings not yet marked with a session outcome.
  // Completed/Cancelled/No-Show are read from sessionStatus once the doctor marks them.
  const clauses = currentStatus === "upcoming"
    ? [where("status", "==", "confirmed"), where("sessionStatus", "==", "upcoming")]
    : [where("sessionStatus", "==", currentStatus)];

  let snap;
  try {
    snap = await getDocs(query(collection(db, "bookings"), ...clauses, orderBy("date", "asc")));
  } catch (err) {
    console.error("[doctor] load sessions failed:", err.code, err.message);
    listEl.innerHTML = `<p class="dash-empty">Could not load sessions.</p>`;
    return;
  }

  if (snap.empty) {
    listEl.innerHTML = `<p class="dash-empty">Nothing here yet.</p>`;
    return;
  }

  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const b = docSnap.data();
    const id = docSnap.id;
    const card = document.createElement("div");
    card.className = "dash-card";
    card.innerHTML = `
      <div class="dash-card-main">
        <p class="dash-card-name">${escapeHtml(b.patientName || "Unnamed")}</p>
        <p class="dash-card-sub">${escapeHtml(b.patientPhone || "")}</p>
        <p class="dash-card-meta">
          <span class="dash-tag">${b.mode === "online" ? "Online" : "Physical"}</span>
          ${b.location ? `<span class="dash-tag">${escapeHtml(b.location)}</span>` : ""}
          <span class="dash-tag">${escapeHtml(b.date)} &middot; ${escapeHtml(b.timeSlot)}</span>
        </p>
      </div>
      <div class="dash-card-actions">
        ${b.mode === "online" ? `<button class="btn btn-outline-dark chat-btn" data-id="${id}" data-patient="${b.patientId}" type="button">Open Chat<span class="unread-dot" id="unreadDot_${id}" hidden></span></button>` : ""}
        ${currentStatus === "upcoming" ? `
          <button class="btn btn-primary complete-btn" data-id="${id}" type="button">Mark Completed</button>
          <button class="btn btn-outline-dark noshow-btn" data-id="${id}" type="button">Didn't Appear</button>
          <button class="btn btn-outline-dark cancel-btn" data-id="${id}" type="button">Cancel</button>
        ` : ""}
      </div>
    `;
    listEl.appendChild(card);

    if (b.mode === "online" && b.patientId) {
      hasUnreadFor(auth.currentUser.uid, b.patientId).then(unread => {
        const dot = document.getElementById(`unreadDot_${id}`);
        if (dot) dot.hidden = !unread;
      });
    }
  });

  listEl.querySelectorAll(".chat-btn").forEach(btn => {
    btn.addEventListener("click", () => openChat(btn.dataset.id));
  });
  listEl.querySelectorAll(".complete-btn").forEach(btn => {
    btn.addEventListener("click", () => setSessionStatus(btn.dataset.id, "completed"));
  });
  listEl.querySelectorAll(".noshow-btn").forEach(btn => {
    btn.addEventListener("click", () => setSessionStatus(btn.dataset.id, "no_show"));
  });
  listEl.querySelectorAll(".cancel-btn").forEach(btn => {
    btn.addEventListener("click", () => setSessionStatus(btn.dataset.id, "cancelled"));
  });
}

async function setSessionStatus(bookingId, sessionStatus) {
  await updateDoc(doc(db, "bookings", bookingId), { sessionStatus });
  loadSessions();
}

// ===== Chat =====
const chatOverlay = document.getElementById("chatOverlay");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatFile = document.getElementById("chatFile");
const chatClosedMsg = document.getElementById("chatClosedMsg");
const chatMicBtn = document.getElementById("chatMicBtn");

let activeBookingId = null;
let activePatientId = null;
let unsubscribeChat = null;
let stopHeartbeat = null;
let unsubscribePresence = null;
let typingTimeout = null;

async function openChat(bookingId) {
  activeBookingId = bookingId;
  // Clear/loading state shown immediately, before any network call — this is
  // what stops the previous patient's chat from flashing on screen while the
  // new one loads.
  chatMessagesEl.innerHTML = `<p class="dash-empty">Loading chat...</p>`;
  document.getElementById("chatPatientName").textContent = "";
  document.getElementById("chatMeta").textContent = "";
  chatOverlay.classList.add("open");

  const bookingSnap = await getDoc(doc(db, "bookings", bookingId));
  if (!bookingSnap.exists()) return;
  const b = bookingSnap.data();
  activePatientId = b.patientId;

  document.getElementById("chatPatientName").textContent = b.patientName || "Patient";
  document.getElementById("chatAvatar").textContent = (b.patientName || "P").trim().charAt(0).toUpperCase();

  const now = new Date();
  const opens = b.chatOpensAt ? b.chatOpensAt.toDate() : null;
  const closes = b.chatClosesAt ? b.chatClosesAt.toDate() : null;
  const isOpen = opens && closes && now >= opens && now <= closes;

  chatInput.disabled = !isOpen;
  chatForm.querySelector("button[type='submit']").disabled = !isOpen;
  if (chatMicBtn) chatMicBtn.disabled = !isOpen;
  chatClosedMsg.hidden = isOpen;
  chatClosedMsg.textContent = !opens
    ? "This booking doesn't have a chat window set up."
    : now < opens
      ? `Chat opens 5 minutes before the session, at ${opens.toLocaleTimeString()}.`
      : "This consultation session has ended. The chat is now closed.";

  const chatMetaEl = document.getElementById("chatMeta");
  if (isOpen) {
    stopHeartbeat = startPresenceHeartbeat(auth.currentUser.uid);
    unsubscribePresence = watchPresence(activePatientId, p => {
      chatMetaEl.textContent = p.text;
      chatMetaEl.classList.toggle("chat-status-active", !!p.typing);
    });
  } else {
    chatMetaEl.textContent = `${b.date} · ${b.timeSlot}`;
  }

  // This is a continuous thread per patient (not per booking) — so a repeat
  // consultation with the same patient picks up right where the last one
  // left off, instead of starting a brand-new empty chat every time.
  cleanupOldMessages(db, activePatientId);
  markRelatedAsRead(auth.currentUser.uid, activePatientId);

  if (unsubscribeChat) unsubscribeChat();
  const q = query(collection(db, "chats", activePatientId, "messages"), orderBy("createdAt", "asc"));
  unsubscribeChat = onSnapshot(q, snap => {
    const messages = snap.docs.map(d => d.data());
    renderChatMessages(chatMessagesEl, messages, auth.currentUser.uid);
  });
}

function closeChat() {
  chatOverlay.classList.remove("open");
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribePresence) { unsubscribePresence(); unsubscribePresence = null; }
  if (stopHeartbeat) { stopHeartbeat(); stopHeartbeat = null; }
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
  activeBookingId = null;
}

document.getElementById("chatCloseBtn").addEventListener("click", closeChat);

chatInput.addEventListener("input", () => {
  if (!auth.currentUser) return;
  setTypingState(auth.currentUser.uid, true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setTypingState(auth.currentUser.uid, false), 2000);
});

chatForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  const file = chatFile.files[0];
  if (!text && !file || !activePatientId) return;

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

  chatInput.value = "";
  chatFile.value = "";
  await addDoc(collection(db, "chats", activePatientId, "messages"), {
    senderRole: "doctor",
    senderId: auth.currentUser.uid,
    text: text || "",
    fileUrl, fileName, isImage,
    createdAt: serverTimestamp()
  });
  createNotification(activePatientId, "You have a new message from Dr. Kulsoom.", "my-bookings.html", activePatientId);
});

// ===== Voice messages =====
let mediaRecorder = null;
let recordedChunks = [];

if (chatMicBtn) {
  chatMicBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        chatMicBtn.classList.remove("mic-recording");
        if (auth.currentUser) setRecordingState(auth.currentUser.uid, false);
        if (!recordedChunks.length || !activePatientId) return;
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        chatMicBtn.disabled = true;
        try {
          const voiceUrl = await uploadToCloudinary(file);
          await addDoc(collection(db, "chats", activePatientId, "messages"), {
            senderRole: "doctor",
            senderId: auth.currentUser.uid,
            voiceUrl,
            text: "",
            createdAt: serverTimestamp()
          });
          createNotification(activePatientId, "You have a new voice message from Dr. Kulsoom.", "my-bookings.html", activePatientId);
        } catch (err) {
          alert("Voice message upload failed. Try again.");
        } finally {
          chatMicBtn.disabled = false;
        }
      };
      mediaRecorder.start();
      chatMicBtn.classList.add("mic-recording");
      if (auth.currentUser) setRecordingState(auth.currentUser.uid, true);
    } catch (err) {
      alert("Could not access your microphone. Check your browser permissions.");
    }
  });
}

document.getElementById("endSessionBtn").addEventListener("click", async () => {
  if (!activeBookingId) return;
  const newClose = Timestamp.fromDate(new Date());
  await updateDoc(doc(db, "bookings", activeBookingId), { chatClosesAt: newClose });
  if (activePatientId) {
    try { await setDoc(doc(db, "patients", activePatientId), { "currentChatWindow.closesAt": newClose }, { merge: true }); } catch (err) {}
  }
  openChat(activeBookingId); // refresh window state
});

document.getElementById("extendSessionBtn").addEventListener("click", async () => {
  if (!activeBookingId) return;
  const bookingSnap = await getDoc(doc(db, "bookings", activeBookingId));
  const b = bookingSnap.data();
  const currentClose = b.chatClosesAt ? b.chatClosesAt.toDate() : new Date();
  const newClose = new Date(Math.max(currentClose.getTime(), Date.now()) + 15 * 60000);
  const newCloseTs = Timestamp.fromDate(newClose);
  await updateDoc(doc(db, "bookings", activeBookingId), {
    chatClosesAt: newCloseTs,
    sessionMinutes: (b.sessionMinutes || 30) + 15
  });
  if (activePatientId) {
    try { await setDoc(doc(db, "patients", activePatientId), { "currentChatWindow.closesAt": newCloseTs }, { merge: true }); } catch (err) {}
  }
  openChat(activeBookingId);
});

// ===== Helpers =====
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
