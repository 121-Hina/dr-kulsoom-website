// my-bookings.js — patient's own booking list, status, and their side of the chat

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadToCloudinary, cleanupOldMessages } from "./dashboard-common.js";
import { createNotification, notifyByRole, markRelatedAsRead } from "./notifications.js";
import { sendConsultationReminderEmail } from "./email-notify.js";
import { renderChatMessages } from "./chat-ui.js";
import { startPresenceHeartbeat, setTypingState, setRecordingState, watchPresence } from "./presence.js";

const signedOutPrompt = document.getElementById("signedOutPrompt");
const bookingsSection = document.getElementById("bookingsSection");
const listEl = document.getElementById("myBookingsList");

let currentUser = null;

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (!user) {
    signedOutPrompt.hidden = false;
    bookingsSection.hidden = true;
    return;
  }
  signedOutPrompt.hidden = true;
  bookingsSection.hidden = false;
  loadMyBookings(user.uid);
});

async function loadMyBookings(uid) {
  listEl.innerHTML = `<p class="dash-empty">Loading your bookings...</p>`;

  let snap;
  try {
    snap = await getDocs(query(
      collection(db, "bookings"),
      where("patientId", "==", uid),
      orderBy("createdAt", "desc")
    ));
  } catch (err) {
    console.error("[my-bookings] load failed:", err.code, err.message);
    listEl.innerHTML = `<p class="dash-empty">Could not load your bookings.</p>`;
    return;
  }

  if (snap.empty) {
    listEl.innerHTML = `<p class="dash-empty">You haven't booked an appointment yet.</p>`;
    return;
  }

  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const b = docSnap.data();
    const id = docSnap.id;

    // Best-effort 15-minute-before reminder email — checked whenever this
    // list loads (e.g. patient has My Bookings open). There's no paid
    // scheduled-job backend to fire this at an exact moment in the
    // background, so this is a practical approximation, not a guaranteed
    // background alarm.
    if (b.mode === "online" && b.status === "confirmed" && !b.reminderEmailSent && b.patientEmail) {
      const sessionStart = parseSlotDateTime(b.date, b.timeSlot);
      if (sessionStart) {
        const minutesUntil = (sessionStart.getTime() - Date.now()) / 60000;
        if (minutesUntil > 0 && minutesUntil <= 15) {
          sendConsultationReminderEmail({ toEmail: b.patientEmail, toName: b.patientName, date: b.date, time: b.timeSlot });
          updateDoc(doc(db, "bookings", id), { reminderEmailSent: true }).catch(() => {});
        }
      }
    }

    const card = document.createElement("div");
    card.className = "mb-card";

    const now = new Date();
    const opens = b.chatOpensAt ? b.chatOpensAt.toDate() : null;
    const closes = b.chatClosesAt ? b.chatClosesAt.toDate() : null;
    const chatIsOpen = opens && closes && now >= opens && now <= closes;
    const canShowChatBtn = b.mode === "online" && b.status === "confirmed";
    const isCompleted = b.sessionStatus === "completed";

    card.innerHTML = `
      <div class="mb-card-main">
        <p class="mb-card-tag">${b.mode === "online" ? "Online Consultation" : "Physical Visit"}</p>
        ${b.location ? `<p class="mb-card-location">${escapeHtml(b.location)}</p>` : ""}
        <p class="mb-card-datetime">${escapeHtml(b.date)} &middot; ${escapeHtml(b.timeSlot)}</p>
        <span class="dash-status dash-status-${b.status}">${statusLabel(b.status)}</span>
      </div>
      <div class="mb-card-actions">
        ${canShowChatBtn ? `
          <button class="btn btn-outline-dark chat-btn" data-id="${id}" ${chatIsOpen ? "" : "disabled"} type="button">
            ${chatIsOpen ? "Join Consultation Chat" : "Chat opens 5 min before session"}
          </button>
        ` : ""}
        ${isCompleted ? `<a href="reviews.html" class="btn btn-outline-dark">Leave a Review</a>` : ""}
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll(".chat-btn:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => openChat(btn.dataset.id));
  });
}

function statusLabel(status) {
  return {
    pending_verification: "Pending Review",
    confirmed: "Confirmed",
    declined: "Declined"
  }[status] || status;
}

// ===== Chat (patient side) =====
const chatOverlay = document.getElementById("chatOverlay");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatFile = document.getElementById("chatFile");
const chatClosedMsg = document.getElementById("chatClosedMsg");
const chatMicBtn = document.getElementById("chatMicBtn");

let activeBookingId = null;
let unsubscribeChat = null;
let activePatientName = "";
let stopHeartbeat = null;
let unsubscribePresence = null;
let doctorUid = null;
let typingTimeout = null;

const chatStatusEl = document.getElementById("chatStatus");

// There's one doctor account in this clinic — look up their uid once so we
// can watch their online/typing/recording status in the chat header.
async function getDoctorUid() {
  if (doctorUid) return doctorUid;
  try {
    const snap = await getDocs(query(collection(db, "staff"), where("role", "==", "doctor")));
    if (!snap.empty) doctorUid = snap.docs[0].id;
  } catch (err) {
    // Non-critical — the header just won't show a live status.
  }
  return doctorUid;
}

async function openChat(bookingId) {
  activeBookingId = bookingId;
  chatMessagesEl.innerHTML = `<p class="dash-empty">Loading chat...</p>`;
  if (chatStatusEl) chatStatusEl.textContent = "";
  chatOverlay.classList.add("open");

  const bookingSnap = await getDoc(doc(db, "bookings", bookingId));
  if (!bookingSnap.exists()) return;
  const b = bookingSnap.data();
  activePatientName = b.patientName || "A patient";

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
      ? `Chat opens 5 minutes before your session, at ${opens.toLocaleTimeString()}.`
      : "This consultation session has ended. The chat is now closed.";

  // Continuous thread per patient — a repeat consultation continues the same
  // chat instead of starting a fresh, empty one each time.
  const myUid = auth.currentUser.uid;
  cleanupOldMessages(db, myUid);
  markRelatedAsRead(myUid, myUid);

  if (isOpen) {
    stopHeartbeat = startPresenceHeartbeat(myUid);
    const dUid = await getDoctorUid();
    if (dUid && chatStatusEl) {
      unsubscribePresence = watchPresence(dUid, p => {
        chatStatusEl.textContent = p.text;
        chatStatusEl.classList.toggle("chat-status-active", !!p.typing);
      });
    }
  }

  if (unsubscribeChat) unsubscribeChat();
  const q = query(collection(db, "chats", myUid, "messages"), orderBy("createdAt", "asc"));
  unsubscribeChat = onSnapshot(q, snap => {
    const messages = snap.docs.map(d => d.data());
    renderChatMessages(chatMessagesEl, messages, myUid);
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

// Let the doctor's side see "typing..." while this patient is composing a message.
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
  if ((!text && !file) || !activeBookingId || !auth.currentUser) return;

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
  await addDoc(collection(db, "chats", auth.currentUser.uid, "messages"), {
    senderRole: "patient",
    senderId: auth.currentUser.uid,
    text: text || "",
    fileUrl, fileName, isImage,
    createdAt: serverTimestamp()
  });
  notifyByRole("doctor", `New message from ${activePatientName} in their online consultation chat.`, "doctor.html", auth.currentUser.uid);
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
        if (!recordedChunks.length || !activeBookingId || !auth.currentUser) return;
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        chatMicBtn.disabled = true;
        try {
          const voiceUrl = await uploadToCloudinary(file);
          await addDoc(collection(db, "chats", auth.currentUser.uid, "messages"), {
            senderRole: "patient",
            senderId: auth.currentUser.uid,
            voiceUrl,
            text: "",
            createdAt: serverTimestamp()
          });
          notifyByRole("doctor", `New voice message from ${activePatientName}.`, "doctor.html", auth.currentUser.uid);
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

function parseSlotDateTime(dateStr, timeSlotStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const match = timeSlotStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let [, h, min, period] = match;
  h = Number(h);
  min = Number(min);
  if (period.toUpperCase() === "PM" && h !== 12) h += 12;
  if (period.toUpperCase() === "AM" && h === 12) h = 0;
  return new Date(y, m - 1, d, h, min, 0);
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
