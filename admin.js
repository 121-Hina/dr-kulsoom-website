// admin.js — Admin Dashboard: everything Manager has (via dashboard-common.js),
// plus Services & Pricing and Staff & Permissions management.

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
  deleteDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { wireBookings, wireLocations, wirePayments, wireAvailability, wireSupportChat, wireConsultationFees, wireBlog, escapeHtml, showSaveStatus } from "./dashboard-common.js";

const loginWrap = document.getElementById("loginWrap");
const dashApp = document.getElementById("dashApp");
const loginForm = document.getElementById("managerLoginForm");
const loginError = document.getElementById("loginError");
const resetSuccess = document.getElementById("resetSuccess");

// ===== Login + role gate (admin only) =====
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

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

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

    if (role === "admin") {
      loginWrap.hidden = true;
      dashApp.hidden = false;
      initDashboard();
    } else {
      loginError.textContent = "This account isn't authorized for the Admin Dashboard.";
      loginError.hidden = false;
      await signOut(auth);
    }
  } catch (err) {
    loginError.textContent = "Could not verify admin access: " + (err.message || err.code || "unknown error");
    loginError.hidden = false;
    await signOut(auth);
  }
});

let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  wireTabs();
  wireBookings(db);
  wireLocations(db);
  wirePayments(db);
  wireServices();
  wireStaff();
  wireAvailability(db);
  wireSupportChat(db, auth);
  wireBlog(db);
  wireConsultationFees(db);
}

function wireTabs() {
  const tabs = document.querySelectorAll(".dash-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".dash-panel").forEach(p => p.hidden = true);
      document.getElementById(tab.dataset.panel).hidden = false;
    });
  });
}

// ===== Services & Pricing =====
const DEFAULT_SERVICES = [
  { title: "Face Treatments", items: [
    { name: "Chemical Peel", description: "Acne treatment, per session", price: "2,000", unit: "/session" },
    { name: "Chemical Peel - Whitening", description: "Skin brightening & even tone", price: "3,000", unit: "/session" },
    { name: "Hydrafacial - Simple", description: "Deep cleanse & hydration", price: "6,000", unit: "" },
    { name: "Hydrafacial + Anti-Aging Serums", description: "With advanced youth-restoring serums", price: "8,000", unit: "" }
  ]},
  { title: "Skin Repair & Glow Treatments", items: [
    { name: "Microneedling + PRP", description: "Repairs skin & boosts natural healing", price: "5,000", unit: "" },
    { name: "Mesotherapy", description: "Microneedling + PRP + Serums, full skin repair boost", price: "10,000", unit: "" },
    { name: "Botox - Upper Face", description: "Smooths fine lines & wrinkles", price: "30,000", unit: "" }
  ]},
  { title: "Hair Treatments", items: [
    { name: "Hair PRP", description: "Hair growth therapy", price: "6,000", unit: "" },
    { name: "Hair PRP + Serums", description: "With growth-boosting serums", price: "10,000", unit: "" },
    { name: "Hair Laser", description: "Face / Chin area", price: "6,000", unit: "" }
  ]},
  { title: "Other Procedures", items: [
    { name: "Mole Removal", description: "Per mole", price: "2,000", unit: "/mole" }
  ]}
];

function wireServices() {
  const listEl = document.getElementById("groupList");
  const addGroupBtn = document.getElementById("addGroupBtn");
  const saveBtn = document.getElementById("saveServicesBtn");

  let groups = [];

  async function load() {
    const snap = await getDoc(doc(db, "settings", "services"));
    groups = snap.exists() && Array.isArray(snap.data().groups) && snap.data().groups.length
      ? snap.data().groups
      : DEFAULT_SERVICES;
    render();
  }

  function itemRowHtml(item) {
    return `
      <div class="svc-item-row">
        <input type="text" class="svc-item-name" placeholder="Treatment name" value="${escapeHtml(item.name)}">
        <input type="text" class="svc-item-desc" placeholder="Short description" value="${escapeHtml(item.description)}">
        <input type="text" class="svc-item-price" placeholder="Price" value="${escapeHtml(item.price)}">
        <input type="text" class="svc-item-unit" placeholder="/unit (optional)" value="${escapeHtml(item.unit || "")}">
        <button class="btn btn-outline-dark remove-item-btn" type="button">&times;</button>
      </div>
    `;
  }

  function render() {
    listEl.innerHTML = "";
    groups.forEach((g, gi) => {
      const card = document.createElement("div");
      card.className = "dash-edit-card";
      card.innerHTML = `
        <label class="dash-edit-label">
          <span>Category name</span>
          <input type="text" class="svc-group-title" value="${escapeHtml(g.title)}">
        </label>
        <div class="svc-items">${g.items.map(itemRowHtml).join("")}</div>
        <div class="svc-card-actions">
          <button class="btn btn-outline-dark add-item-btn" type="button">+ Add Treatment</button>
          <button class="btn btn-outline-dark remove-group-btn" type="button">Remove Category</button>
        </div>
      `;
      card.querySelector(".add-item-btn").addEventListener("click", () => {
        groups[gi].items.push({ name: "", description: "", price: "", unit: "" });
        render();
      });
      card.querySelector(".remove-group-btn").addEventListener("click", () => {
        groups.splice(gi, 1);
        render();
      });
      card.querySelectorAll(".remove-item-btn").forEach((btn, ii) => {
        btn.addEventListener("click", () => {
          groups[gi].items.splice(ii, 1);
          render();
        });
      });
      listEl.appendChild(card);
    });
  }

  addGroupBtn.addEventListener("click", () => {
    groups.push({ title: "", items: [{ name: "", description: "", price: "", unit: "" }] });
    render();
  });

  saveBtn.addEventListener("click", async () => {
    const cards = [...listEl.querySelectorAll(".dash-edit-card")];
    const updated = cards.map(card => ({
      title: card.querySelector(".svc-group-title").value.trim(),
      items: [...card.querySelectorAll(".svc-item-row")].map(row => ({
        name: row.querySelector(".svc-item-name").value.trim(),
        description: row.querySelector(".svc-item-desc").value.trim(),
        price: row.querySelector(".svc-item-price").value.trim(),
        unit: row.querySelector(".svc-item-unit").value.trim()
      })).filter(item => item.name && item.price)
    })).filter(g => g.title && g.items.length);

    await setDoc(doc(db, "settings", "services"), { groups: updated });
    groups = updated;
    showSaveStatus("servicesSaveStatus", "Saved. The homepage will show these on next load.");
  });

  load();
}

// ===== Staff & Permissions =====
function wireStaff() {
  const listEl = document.getElementById("staffList");
  const addBtn = document.getElementById("addStaffBtn");

  async function loadStaff() {
    listEl.innerHTML = `<p class="dash-empty">Loading staff...</p>`;
    let snap;
    try {
      snap = await getDocs(collection(db, "staff"));
    } catch (err) {
      listEl.innerHTML = `<p class="dash-empty">Could not load staff list.</p>`;
      return;
    }
    if (snap.empty) {
      listEl.innerHTML = `<p class="dash-empty">No staff accounts yet.</p>`;
      return;
    }
    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const s = docSnap.data();
      const uid = docSnap.id;
      const row = document.createElement("div");
      row.className = "dash-card";
      row.innerHTML = `
        <div class="dash-card-main">
          <p class="dash-card-name">${escapeHtml(s.name || "Unnamed")}</p>
          <p class="dash-card-sub">${escapeHtml(s.email || "")}</p>
          <p class="dash-card-meta"><span class="dash-tag">UID: ${escapeHtml(uid)}</span></p>
        </div>
        <div class="dash-card-actions">
          <select class="dash-filter role-select" data-uid="${uid}">
            <option value="manager" ${s.role === "manager" ? "selected" : ""}>Manager</option>
            <option value="doctor" ${s.role === "doctor" ? "selected" : ""}>Doctor</option>
            <option value="admin" ${s.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <button class="btn btn-outline-dark save-role-btn" data-uid="${uid}" type="button">Save Role</button>
          <button class="btn btn-outline-dark remove-staff-btn" data-uid="${uid}" type="button">Remove</button>
        </div>
      `;
      listEl.appendChild(row);
    });

    listEl.querySelectorAll(".save-role-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const role = listEl.querySelector(`.role-select[data-uid="${uid}"]`).value;
        await setDoc(doc(db, "staff", uid), { role }, { merge: true });
        showSaveStatus("staffSaveStatus", "Role updated.");
        loadStaff();
      });
    });
    listEl.querySelectorAll(".remove-staff-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this staff member's dashboard access? (Their login account itself is not deleted, do that separately in Authentication if needed.)")) return;
        await deleteDoc(doc(db, "staff", btn.dataset.uid));
        loadStaff();
      });
    });
  }

  addBtn.addEventListener("click", async () => {
    const uid = document.getElementById("newStaffUid").value.trim();
    const role = document.getElementById("newStaffRole").value;
    const name = document.getElementById("newStaffName").value.trim();
    const email = document.getElementById("newStaffEmail").value.trim();

    if (!uid || !name || !email) {
      showSaveStatus("staffSaveStatus", "Fill in UID, name, and email first.");
      return;
    }

    await setDoc(doc(db, "staff", uid), { role, name, email });
    showSaveStatus("staffSaveStatus", "Staff member saved.");
    document.getElementById("newStaffUid").value = "";
    document.getElementById("newStaffName").value = "";
    document.getElementById("newStaffEmail").value = "";
    loadStaff();
  });

  loadStaff();
}
