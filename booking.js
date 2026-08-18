// booking.js — connects the booking forms to Firestore + Cloudinary
// - Loads payment account options from Firestore (settings/payment)
// - Prevents double-booking the same date + time slot
// - Uploads the payment screenshot to Cloudinary
// - Saves the booking request to Firestore for the manager to review

import { auth, db } from "./firebase-config.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { sendBookingSubmittedEmail, sendNewBookingRequestEmail } from "./email-notify.js";
import { notifyByRole } from "./notifications.js";
import { compressImage } from "./image-compress.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ----- Cloudinary settings -----
const CLOUD_NAME = "fz4mxlu9";
const UPLOAD_PRESET = "clinic_payments";

// ----- Clinic schedule (which branch is open which days, and its hours) -----
// This lives in Firestore (settings/schedule) so Admin can edit it later without
// touching code. If that document doesn't exist yet, we fall back to the current
// known schedule so the site still works correctly today.
// days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const DEFAULT_SCHEDULE = [
  { name: "Swat International Hospital, Saidu Sharif", days: [1, 2, 3, 4], startTime: "14:00", endTime: "19:00" },
  { name: "Rahat Medical Complex, Barikot", days: [5, 6, 0], startTime: "16:00", endTime: "19:00" }
];

let clinicSchedule = DEFAULT_SCHEDULE;

async function loadSchedule() {
  try {
    const snap = await getDoc(doc(db, "settings", "schedule"));
    if (snap.exists() && Array.isArray(snap.data().branches) && snap.data().branches.length) {
      clinicSchedule = snap.data().branches;
    }
  } catch (err) {
    // keep DEFAULT_SCHEDULE on any error
  }
}

// Returns the branch open on a given date's weekday, or null if none is open.
function resolveBranchForDate(dateStr) {
  if (!dateStr) return null;
  // Parse as local date, not UTC, so the weekday matches what the patient sees
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return clinicSchedule.find(b => b.days.includes(weekday)) || null;
}

// ----- Online consultation hours (patient-facing booking window) -----
const DEFAULT_ONLINE_HOURS = { startTime: "10:00", endTime: "18:00" };
let onlineHours = DEFAULT_ONLINE_HOURS;

async function loadOnlineHours() {
  try {
    const snap = await getDoc(doc(db, "settings", "onlineHours"));
    if (snap.exists()) onlineHours = { startTime: snap.data().startTime, endTime: snap.data().endTime };
  } catch (err) {
    // keep default
  }
}

// ----- Dates the manager has blocked for physical / online -----
let unavailableDates = { physical: [], online: [] };

async function loadUnavailableDates() {
  try {
    const snap = await getDoc(doc(db, "settings", "unavailableDates"));
    if (snap.exists()) {
      unavailableDates = {
        physical: snap.data().physical || [],
        online: snap.data().online || []
      };
    }
  } catch (err) {
    // keep default (nothing blocked)
  }
}

// ----- Consultation fees shown on the option cards -----
let consultationFees = { online: "", physical: "" };

async function loadConsultationFees() {
  try {
    const snap = await getDoc(doc(db, "settings", "consultationFees"));
    if (!snap.exists()) return;
    const data = snap.data();
    consultationFees = { online: data.online || "", physical: data.physical || "" };
    const onlineEl = document.getElementById("onlineFeeDisplay");
    const physicalEl = document.getElementById("physicalFeeDisplay");
    if (onlineEl && data.online) {
      onlineEl.textContent = `PKR ${data.online} per session`;
      onlineEl.hidden = false;
    }
    if (physicalEl && data.physical) {
      physicalEl.textContent = `PKR ${data.physical} per session`;
      physicalEl.hidden = false;
    }
  } catch (err) {
    // leave prices hidden if this fails
  }
}

function parsePrice(str) {
  const n = parseFloat(String(str || "0").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatPkr(n) {
  return "PKR " + n.toLocaleString("en-US");
}

// ----- Services picker (optional add-on treatments shown on the booking form) -----
const DEFAULT_SERVICES_FALLBACK = [
  { title: "Face Treatments", items: [
    { name: "Chemical Peel", price: "2,000" },
    { name: "Chemical Peel - Whitening", price: "3,000" },
    { name: "Hydrafacial - Simple", price: "6,000" },
    { name: "Hydrafacial + Anti-Aging Serums", price: "8,000" }
  ]},
  { title: "Skin Repair & Glow Treatments", items: [
    { name: "Microneedling + PRP", price: "5,000" },
    { name: "Mesotherapy", price: "10,000" },
    { name: "Botox - Upper Face", price: "30,000" }
  ]},
  { title: "Hair Treatments", items: [
    { name: "Hair PRP", price: "6,000" },
    { name: "Hair PRP + Serums", price: "10,000" },
    { name: "Hair Laser", price: "6,000" }
  ]},
  { title: "Other Procedures", items: [
    { name: "Mole Removal", price: "2,000" }
  ]}
];

let serviceGroups = DEFAULT_SERVICES_FALLBACK;

async function loadServiceGroups() {
  try {
    const snap = await getDoc(doc(db, "settings", "services"));
    if (snap.exists() && Array.isArray(snap.data().groups) && snap.data().groups.length) {
      serviceGroups = snap.data().groups;
    }
  } catch (err) {
    // keep fallback
  }
}

function renderServicesPicker(form) {
  const listEl = form.querySelector(".services-picker-list");
  if (!listEl) return;
  listEl.innerHTML = serviceGroups.map(g => `
    <p class="svc-picker-group-title">${g.title}</p>
    ${g.items.map(item => `
      <label class="svc-picker-row">
        <span class="svc-picker-check"><input type="checkbox" class="svc-picker-checkbox" data-name="${item.name}" data-price="${item.price}"></span>
        <span class="svc-picker-name">${item.name}</span>
        <span class="svc-picker-price">PKR ${item.price}</span>
      </label>
    `).join("")}
  `).join("");

  listEl.querySelectorAll(".svc-picker-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const noneBox = form.querySelector(".svc-picker-none-checkbox");
      if (cb.checked && noneBox) noneBox.checked = false;
      updatePaymentBreakdown(form);
    });
  });

  const noneBox = form.querySelector(".svc-picker-none-checkbox");
  if (noneBox) {
    noneBox.addEventListener("change", () => {
      if (noneBox.checked) {
        listEl.querySelectorAll(".svc-picker-checkbox:checked").forEach(cb => { cb.checked = false; });
      }
      updatePaymentBreakdown(form);
    });
  }
}

function updatePaymentBreakdown(form) {
  const mode = form.dataset.mode;
  const sessionFee = parsePrice(consultationFees[mode]);
  const checked = [...form.querySelectorAll(".svc-picker-checkbox:checked")];
  const servicesTotal = checked.reduce((sum, cb) => sum + parsePrice(cb.dataset.price), 0);
  const total = sessionFee + servicesTotal;

  const sessionFeeEl = form.querySelector(".pb-session-fee");
  if (sessionFeeEl) sessionFeeEl.textContent = formatPkr(sessionFee);

  const servicesBox = form.querySelector(".pb-services");
  if (servicesBox) {
    servicesBox.innerHTML = checked.map(cb => `
      <p class="pb-row pb-service-row"><span>${cb.dataset.name}</span><span>PKR ${cb.dataset.price}</span></p>
    `).join("");
  }

  const totalEl = form.querySelector(".pb-total-amount");
  if (totalEl) totalEl.textContent = formatPkr(total);
}

// Builds 30-minute time options between a branch's startTime and endTime (both "HH:MM").
function buildTimeSlots(startTime, endTime) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots = [];
  for (let mins = start; mins < end; mins += 30) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    slots.push(`${h12}:${m.toString().padStart(2, "0")} ${period}`);
  }
  return slots;
}

// ===== 1) Load payment account options into both forms =====
async function loadPaymentOptions() {
  const containers = document.querySelectorAll(".payment-options");
  try {
    const snap = await getDoc(doc(db, "settings", "payment"));
    const accounts = snap.exists() ? snap.data().accounts || [] : [];

    if (!accounts.length) {
      containers.forEach(c => {
        c.innerHTML = `<p class="pay-note">Payment details will be shared shortly. Please contact the clinic if you need them now.</p>`;
      });
      return;
    }

    containers.forEach((c, containerIndex) => {
      c.innerHTML = accounts.map((acc, i) => `
        <label class="pay-option">
          <input type="radio" name="payAccount-${containerIndex}" value="${acc.number}" data-label="${acc.label}" ${i === 0 ? "checked" : ""} required>
          <span>${acc.label}: <strong>${acc.number}</strong>${acc.holderName ? ` <span class="pay-holder">(Account holder: ${acc.holderName})</span>` : ""}</span>
        </label>
      `).join("");
    });
  } catch (err) {
    containers.forEach(c => {
      c.innerHTML = `<p class="pay-note">Could not load payment details. Please refresh the page.</p>`;
    });
  }
}

// ===== 2) Slot availability + atomic locking via a separate "slots" collection =====
// The slots collection only ever stores mode/date/time/location — never patient
// details — so it's safe for any signed-in patient to read it to see what's free.
// Locking a slot is done by creating a doc with a deterministic ID; Firestore
// security rules block re-creating (overwriting) an existing slot doc, so two
// patients can never successfully claim the same slot.

function slotId(mode, date, timeSlot, location) {
  const raw = `${mode}_${date}_${timeSlot}_${location || "online"}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 200);
}

async function getTakenSlots(mode, date, location) {
  const clauses = [where("mode", "==", mode), where("date", "==", date)];
  if (mode === "physical" && location) {
    clauses.push(where("location", "==", location));
  }
  const q = query(collection(db, "slots"), ...clauses);
  const snap = await getDocs(q);
  return new Set(snap.docs.map(d => d.data().timeSlot));
}

async function claimSlot(mode, date, timeSlot, location) {
  const id = slotId(mode, date, timeSlot, location);
  try {
    await setDoc(doc(db, "slots", id), {
      mode,
      date,
      timeSlot,
      location: mode === "physical" ? location : null,
      claimedBy: auth.currentUser ? auth.currentUser.uid : null,
      createdAt: serverTimestamp()
    });
    return id; // claimed successfully
  } catch (err) {
    return null; // someone already holds this slot
  }
}

function populateTimeSelect(timeSelect, slotLabels) {
  timeSelect.innerHTML = '<option value="">Select a time</option>' +
    slotLabels.map(s => `<option>${s}</option>`).join("");
}

async function refreshSlotOptions(form) {
  const mode = form.dataset.mode;
  const dateInput = form.querySelector(".date-input");
  const timeSelect = form.querySelector(".time-select");
  const date = dateInput.value;
  const unavailableMsg = form.querySelector(".unavailable-msg");
  let location = null;

  if (unavailableMsg) unavailableMsg.hidden = true;

  if (mode === "physical") {
    const resolvedBox = form.querySelector(".resolved-location");
    const resolvedName = form.querySelector(".resolved-location-name");
    const locationValue = form.querySelector(".location-value");
    const closedMsg = form.querySelector(".closed-day-msg");

    if (!date) {
      resolvedBox.hidden = true;
      closedMsg.hidden = true;
      timeSelect.disabled = true;
      timeSelect.innerHTML = '<option value="">Select a date first</option>';
      return;
    }

    if (unavailableDates.physical.includes(date)) {
      resolvedBox.hidden = true;
      closedMsg.hidden = true;
      timeSelect.disabled = true;
      timeSelect.innerHTML = '<option value="">Not available this date</option>';
      if (unavailableMsg) {
        unavailableMsg.hidden = false;
        unavailableMsg.textContent = "Sorry, Dr. Kulsoom is not available for physical consultation on this date. You may choose Online Consultation instead.";
      }
      return;
    }

    const branch = resolveBranchForDate(date);
    if (!branch) {
      resolvedBox.hidden = true;
      closedMsg.hidden = false;
      timeSelect.disabled = true;
      timeSelect.innerHTML = '<option value="">Not available this day</option>';
      return;
    }

    closedMsg.hidden = true;
    resolvedBox.hidden = false;
    resolvedName.textContent = `${branch.name} (${branch.startTime}-${branch.endTime})`;
    locationValue.value = branch.name;
    location = branch.name;

    populateTimeSelect(timeSelect, buildTimeSlots(branch.startTime, branch.endTime));
    timeSelect.disabled = false;
  }

  if (mode === "online") {
    if (!date) {
      timeSelect.disabled = true;
      timeSelect.innerHTML = '<option value="">Select a date first</option>';
      return;
    }
    if (unavailableDates.online.includes(date)) {
      timeSelect.disabled = true;
      timeSelect.innerHTML = '<option value="">Not available this date</option>';
      if (unavailableMsg) {
        unavailableMsg.hidden = false;
        unavailableMsg.textContent = "Sorry, Dr. Kulsoom is not available for online consultation on this date. Please contact the clinic or try another date.";
      }
      return;
    }
    populateTimeSelect(timeSelect, buildTimeSlots(onlineHours.startTime, onlineHours.endTime));
    timeSelect.disabled = false;
  }

  if (!date) return;

  const taken = await getTakenSlots(mode, date, location);
  const previouslySelected = timeSelect.value;

  [...timeSelect.options].forEach(opt => {
    if (!opt.value) return;
    const isTaken = taken.has(opt.value);
    opt.disabled = isTaken;
    opt.textContent = isTaken ? `${opt.value} (booked)` : opt.value;
  });

  if (taken.has(previouslySelected)) {
    timeSelect.value = "";
  }
}

// Parses a date ("YYYY-MM-DD") and a time slot label ("2:30 PM") into a real
// local Date object, used to compute when a session (and its chat) starts.
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

const DEFAULT_SESSION_MINUTES = 30;
const CHAT_OPENS_MINUTES_BEFORE = 5;

// ===== 3) Upload the payment screenshot to Cloudinary =====
async function uploadScreenshot(rawFile) {
  // Compress it first — payment screenshots from a phone gallery are often
  // several MB, and that upload is most of what makes Submit feel slow.
  const file = await compressImage(rawFile);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.secure_url;
}

// ===== 4) Handle form submission =====
function setFormBusy(form, busy) {
  form.querySelectorAll("input, select, button[type='submit']").forEach(el => el.disabled = busy);
}

async function handleSubmit(form, e) {
  e.preventDefault();

  // Guard against a double-submit (fast double click/tap before the form
  // has a chance to disable itself) — this was causing two identical
  // bookings and two identical "booking received" emails per submission.
  if (form.dataset.submitting === "true") return;
  form.dataset.submitting = "true";

  const status = form.querySelector(".form-status");
  const slotTakenMsg = form.querySelector(".slot-taken-msg");
  status.hidden = true;
  slotTakenMsg.hidden = true;

  const mode = form.dataset.mode;
  const date = form.querySelector(".date-input").value;
  const timeSlot = form.querySelector(".time-select").value;
  const locationValueEl = form.querySelector(".location-value");
  const location = locationValueEl ? locationValueEl.value : null;
  const fileInput = form.querySelector(".screenshot-input");
  const file = fileInput.files[0];
  const selectedPayRadio = form.querySelector(".payment-options input[type='radio']:checked");
  const selectedServiceEls = [...form.querySelectorAll(".svc-picker-checkbox:checked")];
  const selectedServices = selectedServiceEls.map(cb => ({ name: cb.dataset.name, price: cb.dataset.price }));
  const sessionFeeAmount = parsePrice(consultationFees[mode]);
  const servicesTotal = selectedServiceEls.reduce((sum, cb) => sum + parsePrice(cb.dataset.price), 0);
  const totalAmount = sessionFeeAmount + servicesTotal;

  const guestNameEl = form.querySelector(".guest-name-input");
  const guestPhoneEl = form.querySelector(".guest-phone-input");
  const guestName = guestNameEl ? guestNameEl.value.trim() : "";
  const guestPhone = guestPhoneEl ? guestPhoneEl.value.trim() : "";

  if (mode === "online") {
    // Online consultation still requires a real account (so patients can
    // access their chat and booking history later).
    if (!auth.currentUser) {
      window.requireAuth(() => {});
      form.dataset.submitting = "false";
      return;
    }
  } else {
    // Physical visit: guest checkout. Sign in anonymously if needed so
    // Firestore's rules (which require a signed-in uid) are satisfied,
    // without forcing the patient to create a real account.
    if (!guestName || !guestPhone) {
      status.textContent = "Please fill in your name and phone number.";
      status.hidden = false;
      form.dataset.submitting = "false";
      return;
    }
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        status.textContent = "Could not start booking. Please try again.";
        status.hidden = false;
        form.dataset.submitting = "false";
        return;
      }
    }
  }

  if (!date || !timeSlot || (mode === "physical" && !location) || !file) {
    status.textContent = "Please fill in all fields and attach a payment screenshot.";
    status.hidden = false;
    form.dataset.submitting = "false";
    return;
  }

  setFormBusy(form, true);
  status.textContent = "Reserving your slot...";
  status.hidden = false;

  // Atomically claim the slot — this is what actually prevents double-booking.
  // If someone else grabbed it a moment ago, this returns null.
  const claimedSlotId = await claimSlot(mode, date, timeSlot, location);
  if (!claimedSlotId) {
    slotTakenMsg.hidden = false;
    status.hidden = true;
    setFormBusy(form, false);
    form.dataset.submitting = "false";
    await refreshSlotOptions(form);
    return;
  }

  try {
    let patientName, patientPhone, patientEmail;
    if (mode === "online") {
      // Get patient details saved at signup
      const patientSnap = await getDoc(doc(db, "patients", auth.currentUser.uid));
      const patientData = patientSnap.exists() ? patientSnap.data() : {};
      patientName = patientData.name || "";
      patientPhone = patientData.phone || "";
      patientEmail = patientData.email || auth.currentUser.email || "";
    } else {
      patientName = guestName;
      patientPhone = guestPhone;
      patientEmail = auth.currentUser.email || "";
    }

    status.textContent = "Uploading payment screenshot...";
    const screenshotUrl = await uploadScreenshot(file);

    status.textContent = "Saving your booking...";
    const sessionStart = parseSlotDateTime(date, timeSlot);
    const chatOpensAt = sessionStart ? new Date(sessionStart.getTime() - CHAT_OPENS_MINUTES_BEFORE * 60000) : null;
    const chatClosesAt = sessionStart ? new Date(sessionStart.getTime() + DEFAULT_SESSION_MINUTES * 60000) : null;

    await addDoc(collection(db, "bookings"), {
      patientId: auth.currentUser.uid,
      patientName,
      patientPhone,
      patientEmail,
      mode,
      date,
      timeSlot,
      location: mode === "physical" ? location : null,
      slotId: claimedSlotId,
      paymentLabel: selectedPayRadio ? selectedPayRadio.dataset.label : "",
      paymentAccountUsed: selectedPayRadio ? selectedPayRadio.value : "",
      paymentScreenshotUrl: screenshotUrl,
      selectedServices,
      sessionFeeAmount,
      totalAmount,
      status: "pending_verification",
      sessionMinutes: DEFAULT_SESSION_MINUTES,
      chatOpensAt: chatOpensAt ? Timestamp.fromDate(chatOpensAt) : null,
      chatClosesAt: chatClosesAt ? Timestamp.fromDate(chatClosesAt) : null,
      sessionStatus: "upcoming",
      createdAt: serverTimestamp()
    });

    if (patientEmail) {
      sendBookingSubmittedEmail({ toEmail: patientEmail, toName: patientName, mode, date, time: timeSlot });
    }

    // Let the manager/admin know a new booking needs review, both in-app and by email.
    notifyByRole("manager", `New booking request: ${patientName || "a patient"} — ${mode} on ${date} at ${timeSlot}.`, "manager.html");
    notifyByRole("admin", `New booking request: ${patientName || "a patient"} — ${mode} on ${date} at ${timeSlot}.`, "admin.html");
    sendNewBookingRequestEmail({ patientName, mode, date, time: timeSlot });

    status.textContent = "Your request has been noted. Our booking manager will confirm once your payment is verified.";
    setFormBusy(form, true);
    showBookingConfirmPopup();
  } catch (err) {
    console.error(err);
    // Something failed after we reserved the slot — free it back up so it
    // isn't stuck locked forever with no booking behind it.
    try { await deleteDoc(doc(db, "slots", claimedSlotId)); } catch (_) {}
    status.textContent = "Something went wrong while submitting. Please try again.";
    setFormBusy(form, false);
    form.dataset.submitting = "false";
  }
}

// ===== Booking confirmation popup =====
function showBookingConfirmPopup() {
  const overlay = document.getElementById("bookingConfirmOverlay");
  if (overlay) overlay.classList.add("open");
}
function hideBookingConfirmPopup() {
  const overlay = document.getElementById("bookingConfirmOverlay");
  if (overlay) overlay.classList.remove("open");
}
document.getElementById("bookingConfirmClose")?.addEventListener("click", hideBookingConfirmPopup);
document.getElementById("bookingConfirmOk")?.addEventListener("click", hideBookingConfirmPopup);
document.getElementById("bookingConfirmOverlay")?.addEventListener("click", e => {
  if (e.target.id === "bookingConfirmOverlay") hideBookingConfirmPopup();
});

// ===== Wire everything up =====
document.querySelectorAll(".booking-form").forEach(form => {
  form.addEventListener("submit", e => handleSubmit(form, e));

  const dateInput = form.querySelector(".date-input");
  dateInput.addEventListener("change", () => refreshSlotOptions(form));
});

loadPaymentOptions();

// Load schedule/hours/blocked-dates before the patient can meaningfully pick
// a date; if they've already started, re-check their current selection once
// this data is in so the fields reflect it (e.g. onlineHours arriving after
// they'd already picked a date on a slow connection).
Promise.all([loadSchedule(), loadOnlineHours(), loadUnavailableDates(), loadConsultationFees(), loadServiceGroups()]).then(() => {
  document.querySelectorAll(".booking-form").forEach(form => {
    renderServicesPicker(form);
    updatePaymentBreakdown(form);
    if (form.querySelector(".date-input").value) refreshSlotOptions(form);
  });
});