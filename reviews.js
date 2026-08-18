// reviews.js — patient star rating + review submission and public display

import { auth, db } from "./firebase-config.js";
import { doc, getDoc, collection, addDoc, query, orderBy, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function starString(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

// ===== Star picker =====
const starPicker = document.getElementById("starPicker");
let selectedRating = 0;

starPicker.querySelectorAll(".star-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedRating = Number(btn.dataset.value);
    starPicker.querySelectorAll(".star-btn").forEach(b => {
      b.classList.toggle("star-active", Number(b.dataset.value) <= selectedRating);
    });
  });
});

// ===== Submit review =====
const reviewForm = document.getElementById("reviewForm");
const reviewStatus = document.getElementById("reviewStatus");

reviewForm.addEventListener("submit", async e => {
  e.preventDefault();
  reviewStatus.hidden = true;

  if (!selectedRating) {
    reviewStatus.textContent = "Please select a star rating.";
    reviewStatus.hidden = false;
    return;
  }

  const submit = () => doSubmitReview();
  if (window.isSignedIn && window.isSignedIn()) {
    submit();
  } else {
    window.requireAuth(submit);
  }
});

async function doSubmitReview() {
  const comment = document.getElementById("reviewComment").value.trim();
  if (!comment) {
    reviewStatus.textContent = "Please write a short review.";
    reviewStatus.hidden = false;
    return;
  }
  const submitBtn = reviewForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const patientSnap = await getDoc(doc(db, "patients", auth.currentUser.uid));
    const patientName = patientSnap.exists() ? patientSnap.data().name : "A patient";

    await addDoc(collection(db, "reviews"), {
      patientId: auth.currentUser.uid,
      patientName: patientName || "A patient",
      rating: selectedRating,
      comment,
      createdAt: serverTimestamp()
    });

    reviewStatus.textContent = "Thank you for your review!";
    reviewStatus.hidden = false;
    reviewForm.reset();
    selectedRating = 0;
    starPicker.querySelectorAll(".star-btn").forEach(b => b.classList.remove("star-active"));
    loadReviews();
  } catch (err) {
    reviewStatus.textContent = "Something went wrong. Please try again.";
    reviewStatus.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Review";
  }
}

// ===== Load + display reviews =====
async function loadReviews() {
  const listEl = document.getElementById("reviewsList");
  let snap;
  try {
    snap = await getDocs(query(collection(db, "reviews"), orderBy("createdAt", "desc")));
  } catch (err) {
    listEl.innerHTML = `<p class="dash-empty">Could not load reviews right now.</p>`;
    return;
  }

  if (snap.empty) {
    listEl.innerHTML = `<p class="dash-empty">No reviews yet, be the first to share your experience.</p>`;
    document.getElementById("reviewSummary").textContent = "See what patients are saying";
    return;
  }

  let total = 0;
  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const r = docSnap.data();
    total += r.rating || 0;
    const dateStr = r.createdAt ? r.createdAt.toDate().toLocaleDateString() : "";
    const card = document.createElement("article");
    card.className = "blog-card review-card";
    card.innerHTML = `
      <div class="blog-card-body">
        <p class="review-stars">${starString(r.rating || 0)}</p>
        <p class="blog-card-text">${escapeHtml(r.comment)}</p>
        <p class="blog-card-date">${escapeHtml(r.patientName || "A patient")} &middot; ${dateStr}</p>
      </div>
    `;
    listEl.appendChild(card);
  });

  const avg = (total / snap.size).toFixed(1);
  document.getElementById("reviewSummary").textContent = `${avg} average from ${snap.size} review${snap.size === 1 ? "" : "s"}`;
}

loadReviews();
