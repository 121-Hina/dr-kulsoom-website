// blog-post.js — renders one full blog post (all its images + full text),
// picked by ?id=... in the URL. Reachable by a direct/shared link, or by
// visiting a post's own URL — the main blog.html listing itself expands
// posts inline instead of linking here.

import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { wireLikeButton } from "./blog-likes.js";
import { initLightboxDelegation } from "./blog-lightbox.js";

initLightboxDelegation();

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Posts written before multi-image support only have a single imageUrl —
// fall back to that so old posts still show their photo.
function allImages(p) {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}

async function loadPost() {
  const wrap = document.getElementById("blogPost");
  const id = new URLSearchParams(window.location.search).get("id");

  if (!id) {
    wrap.innerHTML = `<p class="dash-empty">Post not found.</p>`;
    return;
  }

  let snap;
  try {
    snap = await getDoc(doc(db, "blogPosts", id));
  } catch (err) {
    wrap.innerHTML = `<p class="dash-empty">Could not load this post right now.</p>`;
    return;
  }

  if (!snap.exists()) {
    wrap.innerHTML = `<p class="dash-empty">This post could not be found.</p>`;
    return;
  }

  const p = snap.data();
  const dateStr = p.createdAt ? p.createdAt.toDate().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const images = allImages(p);

  document.getElementById("pageTitle").textContent = `${p.title} | Dr. Kulsoom Skin & Laser Clinic`;
  const descEl = document.getElementById("pageDescription");
  if (descEl) descEl.setAttribute("content", String(p.body || "").replace(/\s+/g, " ").trim().slice(0, 155));

  wrap.innerHTML = `
    <article class="blog-card">
      ${images.map(url => `<div class="blog-card-image"><img src="${url}" alt="${escapeHtml(p.title)}" class="blog-lightbox-trigger"></div>`).join("")}
      <div class="blog-card-body">
        <p class="blog-card-date">${dateStr}</p>
        <h1 class="blog-card-title">${escapeHtml(p.title)}</h1>
        <p class="blog-card-text">${escapeHtml(p.body).replace(/\n/g, "<br>")}</p>
        <div class="blog-like-row">
          <button class="blog-like-btn" id="blogLikeBtn" type="button" aria-label="Like this post"></button>
          <span class="blog-like-count" id="blogLikeCount"></span>
        </div>
      </div>
    </article>
  `;

  wireLikeButton(id, document.getElementById("blogLikeBtn"), document.getElementById("blogLikeCount"), p.likesCount || 0);
}

loadPost();
