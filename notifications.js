// notifications.js — shared notification bell (unread badge + dropdown) and
// helpers to create notifications, used across patient and staff pages.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Send a notification to one specific user (by their UID). relatedId ties the
// notification to a specific chat/patient (used to auto-clear it once that
// chat is opened) — pass the other party's UID for chat-message notifications,
// or omit it for things like booking status updates.
export async function createNotification(recipientId, text, link, relatedId) {
  if (!recipientId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      recipientId,
      text,
      link: link || null,
      relatedId: relatedId || null,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    // Non-critical — a failed notification shouldn't break the action that triggered it,
    // but we still want to see it in the console instead of it vanishing silently.
    console.error("[notifications] createNotification failed for", recipientId, err);
  }
}

// Send a notification to every staff member with a given role (e.g. every "doctor").
export async function notifyByRole(role, text, link, relatedId) {
  try {
    const snap = await getDocs(query(collection(db, "staff"), where("role", "==", role)));
    if (snap.empty) {
      console.warn(`[notifications] notifyByRole("${role}") found no staff with that role — check the role field on their staff doc.`);
    }
    await Promise.all(snap.docs.map(d => createNotification(d.id, text, link, relatedId)));
  } catch (err) {
    console.error(`[notifications] notifyByRole("${role}") failed:`, err);
  }
}

// Marks every unread notification tied to a specific chat as read — call this
// the moment that chat/thread is opened, so its unread count clears
// immediately, the same way opening a conversation does in any chat app.
export async function markRelatedAsRead(recipientId, relatedId) {
  if (!recipientId || !relatedId) return;
  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("recipientId", "==", recipientId),
      where("relatedId", "==", relatedId),
      where("read", "==", false)
    ));
    await Promise.all(snap.docs.map(d => updateDoc(doc(db, "notifications", d.id), { read: true })));
  } catch (err) {
    // Non-critical
  }
}

// One-time check: does this recipient have any unread notification tied to
// this specific chat right now? Used to show a small unread dot next to a
// particular patient in a list, without needing a live listener per row.
export async function hasUnreadFor(recipientId, relatedId) {
  if (!recipientId || !relatedId) return false;
  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("recipientId", "==", recipientId),
      where("relatedId", "==", relatedId),
      where("read", "==", false),
      limit(1)
    ));
    return !snap.empty;
  } catch (err) {
    return false;
  }
}

// Marks every notification this recipient has as read (the bell's "mark all
// as read" button).
async function markAllRead(recipientId) {
  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("recipientId", "==", recipientId),
      where("read", "==", false)
    ));
    await Promise.all(snap.docs.map(d => updateDoc(doc(db, "notifications", d.id), { read: true })));
  } catch (err) {
    console.error("[notifications] markAllRead failed:", err);
  }
}

// Deletes every notification this recipient has (the bell's "clear all"
// button).
async function clearAllNotifications(recipientId) {
  try {
    const snap = await getDocs(query(
      collection(db, "notifications"),
      where("recipientId", "==", recipientId)
    ));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "notifications", d.id))));
  } catch (err) {
    console.error("[notifications] clearAllNotifications failed:", err);
  }
}

// Deletes a single notification (the small × on each notification).
async function clearOneNotification(notifId) {
  try {
    await deleteDoc(doc(db, "notifications", notifId));
  } catch (err) {
    console.error("[notifications] clearOneNotification failed:", err);
  }
}

// Mounts a bell icon + unread badge + dropdown into the element with this ID.
// Automatically shows/hides based on sign-in state, and listens live for new
// notifications for whoever is currently signed in.
export function mountNotificationBell(slotId) {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  slot.innerHTML = `
    <div class="notif-bell-wrap">
      <button class="notif-bell-btn" id="notifBellBtn" type="button" aria-label="Notifications">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <span class="notif-badge" id="notifBadge_${slotId}" hidden>0</span>
      </button>
      <div class="notif-dropdown" id="notifDropdown_${slotId}">
        <div class="notif-dropdown-header">
          <p class="notif-dropdown-title">Notifications</p>
          <div class="notif-header-actions">
            <button class="notif-action-btn" id="notifMarkAllBtn_${slotId}" type="button" aria-label="Mark all as read" title="Mark all as read">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="notif-action-btn" id="notifClearAllBtn_${slotId}" type="button" aria-label="Clear all" title="Clear all">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <div id="notifList_${slotId}" class="notif-list"><p class="dash-empty">No notifications yet.</p></div>
      </div>
    </div>
  `;

  const btn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById(`notifDropdown_${slotId}`);
  const badge = document.getElementById(`notifBadge_${slotId}`);
  const listEl = document.getElementById(`notifList_${slotId}`);
  const markAllBtn = document.getElementById(`notifMarkAllBtn_${slotId}`);
  const clearAllBtn = document.getElementById(`notifClearAllBtn_${slotId}`);

  btn.addEventListener("click", e => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });
  document.addEventListener("click", () => dropdown.classList.remove("open"));
  dropdown.addEventListener("click", e => e.stopPropagation());

  let unsubscribe = null;
  let currentUid = null;

  markAllBtn.addEventListener("click", () => {
    if (currentUid) markAllRead(currentUid);
  });
  clearAllBtn.addEventListener("click", () => {
    if (currentUid) clearAllNotifications(currentUid);
  });

  onAuthStateChanged(auth, user => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!user) {
      slot.hidden = true;
      currentUid = null;
      return;
    }
    slot.hidden = false;
    currentUid = user.uid;

    const q = query(
      collection(db, "notifications"),
      where("recipientId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    unsubscribe = onSnapshot(q, snap => {
      let unread = 0;
      listEl.innerHTML = "";
      if (snap.empty) {
        listEl.innerHTML = `<p class="dash-empty">No notifications yet.</p>`;
      }
      snap.forEach(docSnap => {
        const n = docSnap.data();
        if (!n.read) unread++;
        const item = document.createElement("div");
        item.className = "notif-item" + (n.read ? "" : " notif-item-unread");
        const timeStr = n.createdAt
          ? n.createdAt.toDate().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "";
        item.innerHTML = `<button class="notif-item-close" type="button" aria-label="Clear this notification">&times;</button><p class="notif-text">${escapeHtml(n.text)}</p><p class="notif-time">${timeStr}</p>`;
        item.addEventListener("click", async () => {
          if (!n.read) {
            try { await updateDoc(doc(db, "notifications", docSnap.id), { read: true }); } catch (err) {}
          }
        });
        item.querySelector(".notif-item-close").addEventListener("click", e => {
          e.stopPropagation();
          clearOneNotification(docSnap.id);
        });
        listEl.appendChild(item);
      });
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.hidden = unread === 0;
    });
  });
}
