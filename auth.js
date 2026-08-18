// auth.js — patient Sign In / Create Account, backed by Firebase Auth + Firestore

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const overlay = document.getElementById("authOverlay");
const closeBtn = document.getElementById("authClose");
const navSignIn = document.getElementById("navSignIn");
const footerSignIn = document.getElementById("footerSignIn");

const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginError = document.getElementById("loginError");
const signupError = document.getElementById("signupError");
const resetSuccess = document.getElementById("resetSuccess");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

let currentUser = null;
let pendingAction = null;

function openModal(tab = "login") {
  overlay.classList.add("open");
  setTab(tab);
}

function closeModal() {
  overlay.classList.remove("open");
  loginError.hidden = true;
  signupError.hidden = true;
  resetSuccess.hidden = true;
}

function setTab(tab) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  loginForm.hidden = tab !== "login";
  signupForm.hidden = tab !== "signup";
}

// Open modal from nav or footer link — unless already signed in (handled below)
[navSignIn, footerSignIn].forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    if (link.dataset.mode === "account") {
      signOut(auth);
    } else {
      openModal("login");
    }
  });
});

closeBtn.addEventListener("click", closeModal);
overlay.addEventListener("click", e => {
  if (e.target === overlay) closeModal();
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

const switchSignupLink = document.getElementById("authSwitchSignup");
if (switchSignupLink) {
  switchSignupLink.addEventListener("click", () => setTab("signup"));
}

// ----- Login -----
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.hidden = true;
  const [emailEl, passEl] = loginForm.querySelectorAll("input");
  const submitBtn = loginForm.querySelector("button[type='submit']");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
    closeModal();
    resolvePendingAction();
  } catch (err) {
    loginError.textContent = "Could not sign in. Check your email and password.";
    loginError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

// ----- Forgot password -----
if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", async () => {
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
}

// ----- Signup -----
signupForm.addEventListener("submit", async e => {
  e.preventDefault();
  signupError.hidden = true;
  const [nameEl, phoneEl, emailEl, passEl] = signupForm.querySelectorAll("input");
  const submitBtn = signupForm.querySelector("button[type='submit']");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating account...";
  try {
    const cred = await createUserWithEmailAndPassword(auth, emailEl.value, passEl.value);
    await setDoc(doc(db, "patients", cred.user.uid), {
      name: nameEl.value,
      phone: phoneEl.value,
      email: emailEl.value,
      role: "patient",
      createdAt: serverTimestamp()
    });
    closeModal();
    resolvePendingAction();
  } catch (err) {
    signupError.textContent = "Could not create account. This email may already be registered.";
    signupError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

// ----- Reflect signed-in state in the nav/footer links -----
// Anonymous sessions (created quietly for guest checkout / Support Chat)
// must NOT count as "signed in" here — the nav, My Bookings link, and the
// Online Consultation gate should only react to a real account.
onAuthStateChanged(auth, user => {
  const isRealUser = user && !user.isAnonymous;
  currentUser = isRealUser ? user : null;
  [navSignIn, footerSignIn].forEach(link => {
    if (isRealUser) {
      link.textContent = "Sign Out";
      link.dataset.mode = "account";
    } else {
      link.textContent = "Sign In";
      delete link.dataset.mode;
    }
  });
  const myBookingsLink = document.getElementById("navMyBookings");
  if (myBookingsLink) myBookingsLink.hidden = !isRealUser;
});

function resolvePendingAction() {
  if (pendingAction) {
    const action = pendingAction;
    pendingAction = null;
    action();
  }
}

// requireAuth: call an action only if genuinely signed in with a real
// account — otherwise open the sign-in popup first, then run the action
// automatically once signed in. An anonymous session never satisfies this.
function requireAuth(action) {
  if (currentUser) {
    action();
  } else {
    pendingAction = action;
    openModal("login");
  }
}

window.requireAuth = requireAuth;
window.isSignedIn = () => !!currentUser;

export { openModal, requireAuth };
