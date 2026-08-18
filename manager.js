// manager.js — Manager Dashboard: role-gated login, then delegates the actual
// tab functionality to dashboard-common.js (shared with admin.js)

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { wireBookings, wireLocations, wirePayments, wireAvailability, wireSupportChat, wireConsultationFees } from "./dashboard-common.js";

const loginWrap = document.getElementById("loginWrap");
const dashApp = document.getElementById("dashApp");
const loginForm = document.getElementById("managerLoginForm");
const loginError = document.getElementById("loginError");
const resetSuccess = document.getElementById("resetSuccess");

// ===== Login + role gate =====
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

    if (role === "manager" || role === "admin") {
      loginWrap.hidden = true;
      dashApp.hidden = false;
      initDashboard();
    } else {
      loginError.textContent = "This account isn't authorized for the Manager Dashboard.";
      loginError.hidden = false;
      await signOut(auth);
    }
  } catch (err) {
    loginError.textContent = "Could not verify manager access: " + (err.message || err.code || "unknown error");
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
  wireAvailability(db);
  wireSupportChat(db, auth);
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
