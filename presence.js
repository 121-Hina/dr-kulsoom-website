// presence.js — tracks "online now" / "last seen" / "typing" / "recording
// voice" status per user, shown in the other party's chat header. Stored in
// a small presence/{uid} doc that only that uid can write to.

import { db } from "./firebase-config.js";
import { doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HEARTBEAT_MS = 20000;
const STALE_MS = 45000; // no heartbeat in this long -> treat as offline even if state still says "online"
const TRANSIENT_MS = 8000; // typing/recording flags older than this are ignored (stuck state safety net)

// Call when a chat window opens. Marks the current user online and keeps
// refreshing that every 20s while the window stays open. Call the returned
// function when the window closes to mark them offline right away.
export function startPresenceHeartbeat(uid) {
  if (!uid) return () => {};
  const ref = doc(db, "presence", uid);
  const beat = () => setDoc(ref, { state: "online", lastActive: serverTimestamp() }, { merge: true }).catch(() => {});
  beat();
  const interval = setInterval(beat, HEARTBEAT_MS);
  const goOffline = () => {
    setDoc(ref, { state: "offline", lastActive: serverTimestamp() }, { merge: true }).catch(() => {});
  };
  window.addEventListener("beforeunload", goOffline);
  return () => {
    clearInterval(interval);
    window.removeEventListener("beforeunload", goOffline);
    goOffline();
  };
}

export function setTypingState(uid, isTyping) {
  if (!uid) return;
  setDoc(doc(db, "presence", uid), { state: isTyping ? "typing" : "online", lastActive: serverTimestamp() }, { merge: true }).catch(() => {});
}

export function setRecordingState(uid, isRecording) {
  if (!uid) return;
  setDoc(doc(db, "presence", uid), { state: isRecording ? "recording" : "online", lastActive: serverTimestamp() }, { merge: true }).catch(() => {});
}

// Live-watches another user's presence doc. callback receives a small
// {text, online, typing} object ready to drop straight into the header.
export function watchPresence(uid, callback) {
  if (!uid) return () => {};
  return onSnapshot(doc(db, "presence", uid), snap => {
    callback(presenceLabel(snap.exists() ? snap.data() : null));
  }, () => callback({ text: "" }));
}

function presenceLabel(data) {
  if (!data || !data.lastActive) return { text: "" };
  const last = data.lastActive.toDate();
  const ageMs = Date.now() - last.getTime();

  if (data.state === "typing" && ageMs < TRANSIENT_MS) return { text: "typing", typing: true, online: true };
  if (data.state === "recording" && ageMs < TRANSIENT_MS) return { text: "recording voice\u2026", online: true };
  if (data.state !== "offline" && ageMs < STALE_MS) return { text: "Online now", online: true };

  const timeStr = last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { text: `Last seen ${timeStr}` };
}
