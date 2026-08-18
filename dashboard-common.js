// dashboard-common.js — shared dashboard building blocks used by both
// manager.js and admin.js: bookings review, locations/hours editor,
// payment accounts editor, and small shared helpers.

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
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
import { createNotification, notifyByRole, markRelatedAsRead, hasUnreadFor } from "./notifications.js";
import { sendBookingConfirmedEmail, sendBookingDeclinedEmail, sendBookingRescheduledEmail } from "./email-notify.js";
import { compressImage } from "./image-compress.js";
import { renderChatMessages } from "./chat-ui.js";
import { watchPresence, setTypingState } from "./presence.js";

export function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function statusLabel(status) {
  return {
    pending_verification: "Pending Review",
    confirmed: "Confirmed",
    declined: "Declined"
  }[status] || status;
}

const fileIconSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="chat-file-icon"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export function showSaveStatus(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2500);
}

// ===== Screenshot viewer (shared by the Bookings tab) =====
export function wireImageOverlay() {
  const overlay = document.getElementById("imgOverlay");
  const closeBtn = document.getElementById("imgClose");
  if (!overlay || !closeBtn) return;
  closeBtn.addEventListener("click", () => overlay.classList.remove("open"));
  overlay.addEventListener("click", e => {
    if (e.target.id === "imgOverlay") overlay.classList.remove("open");
  });
}

function openImage(url) {
  document.getElementById("imgOverlayImg").src = url;
  document.getElementById("imgOverlay").classList.add("open");
}

// ===== Bookings tab =====
export function wireBookings(db) {
  const listEl = document.getElementById("bookingsList");
  const filterEl = document.getElementById("statusFilter");
  if (!listEl || !filterEl) return;

  async function loadBookings() {
    listEl.innerHTML = `<p class="dash-empty">Loading bookings...</p>`;
    const filter = filterEl.value;
    const clauses = filter === "all" ? [] : [where("status", "==", filter)];
    const q = query(collection(db, "bookings"), ...clauses, orderBy("createdAt", "desc"));

    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      listEl.innerHTML = `<p class="dash-empty">Could not load bookings.</p>`;
      return;
    }

    if (snap.empty) {
      listEl.innerHTML = `<p class="dash-empty">No bookings here yet.</p>`;
      return;
    }

    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const b = docSnap.data();
      const card = document.createElement("div");
      card.className = "dash-card";
      card.innerHTML = `
        <div class="dash-card-main">
          <p class="dash-card-name">${escapeHtml(b.patientName || "Unnamed")}</p>
          <p class="dash-card-sub">${escapeHtml(b.patientPhone || "")} &middot; ${escapeHtml(b.patientEmail || "")}</p>
          <p class="dash-card-meta">
            <span class="dash-tag">${b.mode === "online" ? "Online" : "Physical"}</span>
            ${b.location ? `<span class="dash-tag">${escapeHtml(b.location)}</span>` : ""}
            <span class="dash-tag">${escapeHtml(b.date)} &middot; ${escapeHtml(b.timeSlot)}</span>
            <span class="dash-status dash-status-${b.status}">${statusLabel(b.status)}</span>
          </p>
          <p class="dash-card-meta">Paid to: ${escapeHtml(b.paymentLabel || "-")} (${escapeHtml(b.paymentAccountUsed || "-")})</p>
          ${b.selectedServices && b.selectedServices.length ? `<p class="dash-card-meta">Services: ${b.selectedServices.map(s => escapeHtml(s.name)).join(", ")}</p>` : ""}
          ${b.totalAmount ? `<p class="dash-card-meta">Total: PKR ${escapeHtml(String(b.totalAmount))}</p>` : ""}
        </div>
        <div class="dash-card-actions">
          ${b.paymentScreenshotUrl ? `<button class="btn btn-outline-dark view-screenshot-btn" data-url="${b.paymentScreenshotUrl}" type="button">View Screenshot</button>` : ""}
          ${b.status === "pending_verification" ? `
            <button class="btn btn-primary confirm-btn" data-id="${docSnap.id}" type="button">Confirm</button>
            <button class="btn btn-outline-dark decline-btn" data-id="${docSnap.id}" data-slot="${b.slotId}" type="button">Decline</button>
          ` : ""}
          ${b.status !== "declined" ? `<button class="btn btn-outline-dark reschedule-btn" data-id="${docSnap.id}" type="button">Reschedule</button>` : ""}
        </div>
        <div class="dash-reschedule-box" id="reschedule-${docSnap.id}" hidden>
          <label class="dash-edit-label">
            <span>New date</span>
            <input type="date" class="rs-date">
          </label>
          <label class="dash-edit-label">
            <span>New time (e.g. 3:00 PM)</span>
            <input type="text" class="rs-time" placeholder="3:00 PM">
          </label>
          <button class="btn btn-primary rs-save-btn" data-id="${docSnap.id}" data-mode="${b.mode}" data-location="${escapeHtml(b.location || "")}" data-oldslot="${b.slotId || ""}" type="button">Save New Time</button>
          <p class="dash-reschedule-note">Patient keeps their existing payment record; only the date/time changes.</p>
        </div>
      `;
      listEl.appendChild(card);
    });

    listEl.querySelectorAll(".view-screenshot-btn").forEach(btn => {
      btn.addEventListener("click", () => openImage(btn.dataset.url));
    });
    listEl.querySelectorAll(".confirm-btn").forEach(btn => {
      btn.addEventListener("click", () => confirmBooking(db, btn.dataset.id, loadBookings));
    });
    listEl.querySelectorAll(".decline-btn").forEach(btn => {
      btn.addEventListener("click", () => declineBooking(db, btn.dataset.id, btn.dataset.slot, loadBookings));
    });
    listEl.querySelectorAll(".reschedule-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const box = document.getElementById(`reschedule-${btn.dataset.id}`);
        box.hidden = !box.hidden;
      });
    });
    listEl.querySelectorAll(".rs-save-btn").forEach(btn => {
      btn.addEventListener("click", () => rescheduleBooking(db, btn, loadBookings));
    });
  }

  filterEl.addEventListener("change", loadBookings);
  wireImageOverlay();
  loadBookings();
}

async function confirmBooking(db, bookingId, refresh) {
  await updateDoc(doc(db, "bookings", bookingId), { status: "confirmed", sessionStatus: "upcoming" });
  const b = (await getDoc(doc(db, "bookings", bookingId))).data();
  if (b) {
    const patientMsg = b.mode === "online"
      ? `Your online consultation on ${b.date} at ${b.timeSlot} is confirmed. Please be ready and online with Dr. Kulsoom at that time.`
      : `Your physical visit on ${b.date} at ${b.timeSlot} is confirmed.`;
    createNotification(b.patientId, patientMsg, "my-bookings.html");
    notifyByRole("doctor", `New booking confirmed: ${b.patientName || "a patient"} — ${b.mode} on ${b.date} at ${b.timeSlot}.`, "doctor.html");
    if (b.patientEmail) {
      sendBookingConfirmedEmail({ toEmail: b.patientEmail, toName: b.patientName, mode: b.mode, date: b.date, time: b.timeSlot, location: b.location });
    }

    // Online bookings share one continuous chat thread per patient. Confirming
    // this booking updates the patient's window, which is what the chat's
    // security rules actually check to decide if messaging is allowed right now.
    if (b.mode === "online" && b.chatOpensAt && b.chatClosesAt) {
      try {
        await setDoc(doc(db, "patients", b.patientId), {
          currentChatWindow: { opensAt: b.chatOpensAt, closesAt: b.chatClosesAt, bookingId }
        }, { merge: true });
      } catch (err) {}
    }
  }
  refresh();
}

async function declineBooking(db, bookingId, slotId, refresh) {
  const before = (await getDoc(doc(db, "bookings", bookingId))).data();
  await updateDoc(doc(db, "bookings", bookingId), { status: "declined" });
  if (slotId) {
    try { await deleteDoc(doc(db, "slots", slotId)); } catch (err) {}
  }
  if (before) {
    createNotification(before.patientId, `Your ${before.mode} booking request for ${before.date} at ${before.timeSlot} could not be approved. Please contact us through Support Chat on our website and we'll help sort this out — we appreciate your patience.`, "my-bookings.html");
    if (before.patientEmail) {
      sendBookingDeclinedEmail({ toEmail: before.patientEmail, toName: before.patientName, mode: before.mode, date: before.date, time: before.timeSlot });
    }
  }
  refresh();
}

function buildSlotId(mode, date, timeSlot, location) {
  const raw = `${mode}_${date}_${timeSlot}_${location || "online"}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 200);
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

async function rescheduleBooking(db, btn, refresh) {
  const bookingId = btn.dataset.id;
  const mode = btn.dataset.mode;
  const location = btn.dataset.location || null;
  const oldSlotId = btn.dataset.oldslot;
  const box = document.getElementById(`reschedule-${bookingId}`);
  const newDate = box.querySelector(".rs-date").value;
  const newTime = box.querySelector(".rs-time").value.trim();

  if (!newDate || !newTime) {
    alert("Pick a date and type a time (e.g. 3:00 PM) first.");
    return;
  }

  const newSlotId = buildSlotId(mode, newDate, newTime, location);
  try {
    await setDoc(doc(db, "slots", newSlotId), {
      mode, date: newDate, timeSlot: newTime,
      location: mode === "physical" ? location : null,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    alert("That new slot is already taken by someone else. Pick a different time.");
    return;
  }

  const updates = { date: newDate, timeSlot: newTime, slotId: newSlotId };
  if (mode === "online") {
    const sessionStart = parseSlotDateTime(newDate, newTime);
    if (sessionStart) {
      updates.chatOpensAt = Timestamp.fromDate(new Date(sessionStart.getTime() - 5 * 60000));
      updates.chatClosesAt = Timestamp.fromDate(new Date(sessionStart.getTime() + 30 * 60000));
    }
  }
  await updateDoc(doc(db, "bookings", bookingId), updates);

  if (oldSlotId && oldSlotId !== newSlotId) {
    try { await deleteDoc(doc(db, "slots", oldSlotId)); } catch (err) {}
  }

  // Let the patient and doctor know their session moved, both in-app and by email.
  try {
    const b = (await getDoc(doc(db, "bookings", bookingId))).data();
    if (b) {
      createNotification(b.patientId, `Your ${b.mode} booking has been rescheduled to ${b.date} at ${b.timeSlot}.`, "my-bookings.html");
      if (b.status === "confirmed") {
        notifyByRole("doctor", `Booking rescheduled: ${b.patientName || "a patient"} — ${b.mode} now on ${b.date} at ${b.timeSlot}.`, "doctor.html");
      }
      if (b.patientEmail) {
        sendBookingRescheduledEmail({ toEmail: b.patientEmail, toName: b.patientName, mode: b.mode, date: b.date, time: b.timeSlot, location: b.location });
      } else {
        console.warn("[reschedule] booking has no patientEmail, skipping email:", bookingId);
      }
    } else {
      console.warn("[reschedule] could not re-fetch booking after update:", bookingId);
    }
  } catch (err) {
    console.error("[reschedule] failed to notify patient:", err);
  }

  box.hidden = true;
  refresh();
}

// ===== Locations & Hours tab =====
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function wireLocations(db) {
  const listEl = document.getElementById("branchList");
  const addBtn = document.getElementById("addBranchBtn");
  const saveBtn = document.getElementById("saveScheduleBtn");
  if (!listEl || !addBtn || !saveBtn) return;

  let branches = [];

  async function load() {
    const snap = await getDoc(doc(db, "settings", "schedule"));
    branches = snap.exists() && Array.isArray(snap.data().branches) ? snap.data().branches : [];
    render();
  }

  function render() {
    listEl.innerHTML = "";
    branches.forEach((b, i) => {
      const row = document.createElement("div");
      row.className = "dash-edit-card";
      row.innerHTML = `
        <label class="dash-edit-label">
          <span>Location name</span>
          <input type="text" class="branch-name" value="${escapeHtml(b.name)}">
        </label>
        <div class="dash-day-picker">
          ${DAY_NAMES.map((d, idx) => `
            <label class="dash-day-chip">
              <input type="checkbox" class="branch-day" value="${idx}" ${b.days.includes(idx) ? "checked" : ""}>
              <span>${d}</span>
            </label>
          `).join("")}
        </div>
        <div class="field-row">
          <label class="dash-edit-label">
            <span>Start time</span>
            <input type="time" class="branch-start" value="${escapeHtml(b.startTime)}">
          </label>
          <label class="dash-edit-label">
            <span>End time</span>
            <input type="time" class="branch-end" value="${escapeHtml(b.endTime)}">
          </label>
        </div>
        <button class="btn btn-outline-dark remove-branch-btn" type="button">Remove</button>
      `;
      row.querySelector(".remove-branch-btn").addEventListener("click", () => {
        branches.splice(i, 1);
        render();
      });
      listEl.appendChild(row);
    });
  }

  addBtn.addEventListener("click", () => {
    branches.push({ name: "", days: [], startTime: "09:00", endTime: "17:00" });
    render();
  });

  saveBtn.addEventListener("click", async () => {
    const rows = [...listEl.querySelectorAll(".dash-edit-card")];
    const updated = rows.map(row => ({
      name: row.querySelector(".branch-name").value.trim(),
      days: [...row.querySelectorAll(".branch-day:checked")].map(cb => Number(cb.value)),
      startTime: row.querySelector(".branch-start").value,
      endTime: row.querySelector(".branch-end").value
    })).filter(b => b.name && b.days.length && b.startTime && b.endTime);

    await setDoc(doc(db, "settings", "schedule"), { branches: updated });
    branches = updated;
    showSaveStatus("scheduleSaveStatus", "Saved.");
  });

  load();
}

// ===== Payment Accounts tab =====
export function wirePayments(db) {
  const listEl = document.getElementById("accountList");
  const addBtn = document.getElementById("addAccountBtn");
  const saveBtn = document.getElementById("savePaymentsBtn");
  if (!listEl || !addBtn || !saveBtn) return;

  let accounts = [];

  async function load() {
    const snap = await getDoc(doc(db, "settings", "payment"));
    accounts = snap.exists() && Array.isArray(snap.data().accounts) ? snap.data().accounts : [];
    render();
  }

  function render() {
    listEl.innerHTML = "";
    accounts.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "dash-edit-card dash-edit-card-row";
      row.innerHTML = `
        <label class="dash-edit-label">
          <span>Label (e.g. JazzCash, Easypaisa, Bank)</span>
          <input type="text" class="acc-label" value="${escapeHtml(a.label)}">
        </label>
        <label class="dash-edit-label">
          <span>Account number</span>
          <input type="text" class="acc-number" value="${escapeHtml(a.number)}">
        </label>
        <label class="dash-edit-label">
          <span>Account holder name</span>
          <input type="text" class="acc-holder" value="${escapeHtml(a.holderName || "")}">
        </label>
        <button class="btn btn-outline-dark remove-acc-btn" type="button">Remove</button>
      `;
      row.querySelector(".remove-acc-btn").addEventListener("click", () => {
        accounts.splice(i, 1);
        render();
      });
      listEl.appendChild(row);
    });
  }

  addBtn.addEventListener("click", () => {
    accounts.push({ label: "", number: "", holderName: "" });
    render();
  });

  saveBtn.addEventListener("click", async () => {
    const rows = [...listEl.querySelectorAll(".dash-edit-card")];
    const updated = rows.map(row => ({
      label: row.querySelector(".acc-label").value.trim(),
      number: row.querySelector(".acc-number").value.trim(),
      holderName: row.querySelector(".acc-holder").value.trim()
    })).filter(a => a.label && a.number);

    await setDoc(doc(db, "settings", "payment"), { accounts: updated });
    accounts = updated;
    showSaveStatus("paymentsSaveStatus", "Saved.");
  });

  load();
}

// ===== Blog authoring (Doctor / Admin) =====
export function wireBlog(db) {
  const listEl = document.getElementById("blogPostList");
  const titleEl = document.getElementById("blogTitleInput");
  const bodyEl = document.getElementById("blogBodyInput");
  const fileEl = document.getElementById("blogImageInput");
  const publishBtn = document.getElementById("blogPublishBtn");
  if (!listEl || !titleEl || !bodyEl || !publishBtn) return;

  publishBtn.addEventListener("click", async () => {
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    if (!title || !body) {
      showSaveStatus("blogSaveStatus", "Add a title and some content first.");
      return;
    }
    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing...";
    let imageUrls = [];
    try {
      const files = [...fileEl.files];
      if (files.length) {
        imageUrls = await Promise.all(files.map(f => uploadToCloudinary(f)));
      }
      await addDoc(collection(db, "blogPosts"), {
        title, body, imageUrls,
        likesCount: 0,
        createdAt: serverTimestamp()
      });
      titleEl.value = "";
      bodyEl.value = "";
      fileEl.value = "";
      showSaveStatus("blogSaveStatus", "Published.");
      loadPosts();
    } catch (err) {
      showSaveStatus("blogSaveStatus", "Could not publish. Try again.");
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish Post";
    }
  });

  async function loadPosts() {
    listEl.innerHTML = `<p class="dash-empty">Loading posts...</p>`;
    let snap;
    try {
      snap = await getDocs(query(collection(db, "blogPosts"), orderBy("createdAt", "desc")));
    } catch (err) {
      listEl.innerHTML = `<p class="dash-empty">Could not load posts.</p>`;
      return;
    }
    if (snap.empty) {
      listEl.innerHTML = `<p class="dash-empty">No posts published yet.</p>`;
      return;
    }
    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const p = docSnap.data();
      const dateStr = p.createdAt ? p.createdAt.toDate().toLocaleDateString() : "";
      const card = document.createElement("div");
      card.className = "dash-card";
      card.innerHTML = `
        <div class="dash-card-main">
          <p class="dash-card-name">${escapeHtml(p.title)}</p>
          <p class="dash-card-sub">${dateStr}</p>
        </div>
        <div class="dash-card-actions">
          <button class="btn btn-outline-dark blog-delete-btn" data-id="${docSnap.id}" type="button">Delete</button>
        </div>
      `;
      listEl.appendChild(card);
    });
    listEl.querySelectorAll(".blog-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this post?")) return;
        await deleteDoc(doc(db, "blogPosts", btn.dataset.id));
        loadPosts();
      });
    });
  }

  loadPosts();
}

// ===== Chat message cleanup (90-day retention) =====
// There's no scheduled background job running (that needs a paid Cloud
// Functions setup we don't have), so this runs "lazily" — every time a chat
// thread is opened, anything older than 90 days in that thread gets deleted.
// Not a perfect fixed schedule, but keeps things bounded in practice.
export async function cleanupOldMessages(db, patientId) {
  try {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const oldMsgs = await getDocs(query(
      collection(db, "chats", patientId, "messages"),
      where("createdAt", "<", cutoff)
    ));
    await Promise.all(oldMsgs.docs.map(d => deleteDoc(d.ref)));
  } catch (err) {
    // non-critical — if this fails (e.g. missing index), just skip it silently
  }
}

// ===== Consultation fees (shown on the booking page's Online/Physical cards) =====
export function wireConsultationFees(db) {
  const onlineFeeEl = document.getElementById("onlineFee");
  const physicalFeeEl = document.getElementById("physicalFee");
  const saveBtn = document.getElementById("saveFeesBtn");
  if (!onlineFeeEl || !physicalFeeEl || !saveBtn) return;

  async function load() {
    const snap = await getDoc(doc(db, "settings", "consultationFees"));
    const data = snap.exists() ? snap.data() : {};
    onlineFeeEl.value = data.online || "";
    physicalFeeEl.value = data.physical || "";
  }

  saveBtn.addEventListener("click", async () => {
    await setDoc(doc(db, "settings", "consultationFees"), {
      online: onlineFeeEl.value.trim(),
      physical: physicalFeeEl.value.trim()
    });
    showSaveStatus("feesSaveStatus", "Saved.");
  });

  load();
}

// ===== Availability tab: online consultation hours + unavailable dates =====
export function wireAvailability(db) {
  const startEl = document.getElementById("onlineStart");
  const endEl = document.getElementById("onlineEnd");
  const saveHoursBtn = document.getElementById("saveOnlineHoursBtn");
  const physicalDatesList = document.getElementById("physicalUnavailableList");
  const onlineDatesList = document.getElementById("onlineUnavailableList");
  const addPhysicalDateBtn = document.getElementById("addPhysicalUnavailableBtn");
  const addOnlineDateBtn = document.getElementById("addOnlineUnavailableBtn");
  const newPhysicalDate = document.getElementById("newPhysicalUnavailableDate");
  const newOnlineDate = document.getElementById("newOnlineUnavailableDate");
  if (!startEl || !saveHoursBtn) return;

  async function loadHours() {
    const snap = await getDoc(doc(db, "settings", "onlineHours"));
    const data = snap.exists() ? snap.data() : { startTime: "10:00", endTime: "18:00" };
    startEl.value = data.startTime || "10:00";
    endEl.value = data.endTime || "18:00";
  }

  saveHoursBtn.addEventListener("click", async () => {
    await setDoc(doc(db, "settings", "onlineHours"), {
      startTime: startEl.value,
      endTime: endEl.value
    });
    showSaveStatus("onlineHoursSaveStatus", "Saved.");
  });

  let unavailable = { physical: [], online: [] };

  async function loadDates() {
    const snap = await getDoc(doc(db, "settings", "unavailableDates"));
    unavailable = snap.exists() ? {
      physical: snap.data().physical || [],
      online: snap.data().online || []
    } : { physical: [], online: [] };
    renderDates();
  }

  function renderDates() {
    physicalDatesList.innerHTML = unavailable.physical.length
      ? unavailable.physical.map(d => `<span class="dash-tag date-tag">${escapeHtml(d)} <button class="rm-date-btn" data-kind="physical" data-date="${escapeHtml(d)}" type="button">&times;</button></span>`).join(" ")
      : `<p class="dash-empty">No dates blocked.</p>`;
    onlineDatesList.innerHTML = unavailable.online.length
      ? unavailable.online.map(d => `<span class="dash-tag date-tag">${escapeHtml(d)} <button class="rm-date-btn" data-kind="online" data-date="${escapeHtml(d)}" type="button">&times;</button></span>`).join(" ")
      : `<p class="dash-empty">No dates blocked.</p>`;

    [...physicalDatesList.querySelectorAll(".rm-date-btn"), ...onlineDatesList.querySelectorAll(".rm-date-btn")].forEach(btn => {
      btn.addEventListener("click", async () => {
        unavailable[btn.dataset.kind] = unavailable[btn.dataset.kind].filter(d => d !== btn.dataset.date);
        await setDoc(doc(db, "settings", "unavailableDates"), unavailable);
        renderDates();
      });
    });
  }

  addPhysicalDateBtn.addEventListener("click", async () => {
    const d = newPhysicalDate.value;
    if (!d || unavailable.physical.includes(d)) return;
    unavailable.physical.push(d);
    await setDoc(doc(db, "settings", "unavailableDates"), unavailable);
    newPhysicalDate.value = "";
    renderDates();
  });

  addOnlineDateBtn.addEventListener("click", async () => {
    const d = newOnlineDate.value;
    if (!d || unavailable.online.includes(d)) return;
    unavailable.online.push(d);
    await setDoc(doc(db, "settings", "unavailableDates"), unavailable);
    newOnlineDate.value = "";
    renderDates();
  });

  loadHours();
  loadDates();
}

// ===== Support Chat tab (Manager/Admin side) =====
export function wireSupportChat(db, auth) {
  const listEl = document.getElementById("supportPatientList");
  const overlay = document.getElementById("supportChatOverlay");
  if (!listEl || !overlay) return;

  const nameEl = document.getElementById("supportChatName");
  const messagesEl = document.getElementById("supportChatMessages");
  const form = document.getElementById("supportChatForm");
  const input = document.getElementById("supportChatInput");
  const fileInput = document.getElementById("supportChatFile");
  const closeBtn = document.getElementById("supportChatCloseBtn");
  const statusEl = document.getElementById("supportChatStatus");

  let activePatientId = null;
  let unsubscribe = null;
  let unsubscribePresence = null;
  let typingTimeout = null;

  async function loadPatientList() {
    listEl.innerHTML = `<p class="dash-empty">Loading...</p>`;
    let snap;
    try {
      snap = await getDocs(collection(db, "supportChats"));
    } catch (err) {
      listEl.innerHTML = `<p class="dash-empty">Could not load support chats.</p>`;
      return;
    }
    if (snap.empty) {
      listEl.innerHTML = `<p class="dash-empty">No support conversations yet.</p>`;
      return;
    }
    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const s = docSnap.data();
      const row = document.createElement("div");
      row.className = "dash-card";
      row.innerHTML = `
        <div class="dash-card-main">
          <p class="dash-card-name">${escapeHtml(s.patientName || "Patient")}</p>
          <p class="dash-card-sub">${escapeHtml(s.patientEmail || "")}</p>
        </div>
        <div class="dash-card-actions">
          <button class="btn btn-outline-dark open-support-btn" data-id="${docSnap.id}" data-name="${escapeHtml(s.patientName || "Patient")}" type="button">Open Chat<span class="unread-dot" id="unreadDotSupport_${docSnap.id}" hidden></span></button>
        </div>
      `;
      listEl.appendChild(row);
      hasUnreadFor(auth.currentUser.uid, docSnap.id).then(unread => {
        const dot = document.getElementById(`unreadDotSupport_${docSnap.id}`);
        if (dot) dot.hidden = !unread;
      });
    });
    listEl.querySelectorAll(".open-support-btn").forEach(btn => {
      btn.addEventListener("click", () => openSupportChat(btn.dataset.id, btn.dataset.name));
    });
  }

  function openSupportChat(patientId, patientName) {
    activePatientId = patientId;
    nameEl.textContent = patientName;
    const avatarEl = document.getElementById("supportChatAvatar");
    if (avatarEl) avatarEl.textContent = (patientName || "P").trim().charAt(0).toUpperCase();
    overlay.classList.add("open");
    markRelatedAsRead(auth.currentUser.uid, patientId);

    if (unsubscribePresence) unsubscribePresence();
    if (statusEl) {
      unsubscribePresence = watchPresence(patientId, p => {
        statusEl.textContent = p.text;
        statusEl.classList.toggle("chat-status-active", !!p.typing);
      });
    }

    if (unsubscribe) unsubscribe();
    const q = query(collection(db, "supportChats", patientId, "messages"), orderBy("createdAt", "asc"));
    unsubscribe = onSnapshot(q, snap => {
      const messages = snap.docs.map(d => d.data());
      renderChatMessages(messagesEl, messages, auth.currentUser.uid, m => m.senderRole !== "patient");
    });
  }

  closeBtn.addEventListener("click", () => {
    overlay.classList.remove("open");
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (unsubscribePresence) { unsubscribePresence(); unsubscribePresence = null; }
    if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
    activePatientId = null;
  });

  if (input) {
    input.addEventListener("input", () => {
      if (!auth.currentUser) return;
      setTypingState(auth.currentUser.uid, true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => setTypingState(auth.currentUser.uid, false), 2000);
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!activePatientId) return;
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
    await addDoc(collection(db, "supportChats", activePatientId, "messages"), {
      senderRole: "staff",
      senderId: auth.currentUser.uid,
      text: text || "",
      fileUrl, fileName, isImage,
      createdAt: serverTimestamp()
    });
    createNotification(activePatientId, "You have a new message from clinic support.", "my-bookings.html", activePatientId);
  });

  loadPatientList();
}

// ===== Shared Cloudinary upload (images, PDFs, docs — used by all chats) =====
const CLOUD_NAME = "fz4mxlu9";
const UPLOAD_PRESET = "clinic_payments";

export async function uploadToCloudinary(rawFile) {
  // Compress it first if it's a photo — this is what actually makes
  // "Publish"/"Send" feel fast, since the upload itself is most of the wait.
  const file = await compressImage(rawFile);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  // Cloudinary's "auto" endpoint reliably detects images and video, but
  // documents (Word, etc.) must be uploaded explicitly as "raw" or they get
  // rejected. PDFs work fine as images. Audio recordings must be uploaded as
  // "video" — Cloudinary groups audio under the video resource type.
  let resourceType = "auto";
  if (file.type && file.type.startsWith("audio/")) {
    resourceType = "video";
  } else if (file.type && !file.type.startsWith("image/") && !file.type.startsWith("video/") && file.type !== "application/pdf") {
    resourceType = "raw";
  }

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.secure_url;
}
