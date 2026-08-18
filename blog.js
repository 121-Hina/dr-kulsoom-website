// blog.js — renders the blog listing page as a grid of cards (image + title
// + short excerpt). "Read More" expands the SAME card in place — it grows
// to a centered, comfortable reading width (not the narrow grid column, and
// not a full separate page), with all of that post's photos shown together
// at the top. Clicking any photo opens it a little larger in a lightbox.

import { db } from "./firebase-config.js";
import { collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { wireLikeButton } from "./blog-likes.js";
import { initLightboxDelegation } from "./blog-lightbox.js";

initLightboxDelegation();

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// A short plain-text preview of the post body for the collapsed card.
function excerpt(body, maxLen = 110) {
  const clean = String(body || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s+\S*$/, "") + "...";
}

// Posts written before multi-image support only have a single imageUrl —
// fall back to that so old posts still show a thumbnail.
function allImages(p) {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}

// Builds a small photo mosaic for a post's images — the layout adapts to
// how many photos there are (1 = single, 2 = side by side, 3 = three
// columns, 4+ = a 2x2 grid with a "+N" badge for any beyond the first 4).
function buildMosaic(images, title) {
  if (!images.length) {
    return `<div class="blog-grid-card-mosaic blog-grid-card-mosaic-empty" data-count="1"></div>`;
  }
  const shown = images.slice(0, 4);
  const remaining = images.length - shown.length;
  const cells = shown.map((url, i) => {
    const isLastWithMore = remaining > 0 && i === shown.length - 1;
    return `
      <div class="blog-grid-card-mosaic-cell${isLastWithMore ? " blog-grid-card-mosaic-more" : ""}">
        <img src="${url}" alt="${escapeHtml(title)}" class="blog-lightbox-trigger" loading="lazy">
        ${isLastWithMore ? `<span class="blog-grid-card-mosaic-badge">+${remaining}</span>` : ""}
      </div>
    `;
  }).join("");
  return `<div class="blog-grid-card-mosaic" data-count="${shown.length}">${cells}</div>`;
}

async function loadPosts() {
  const listEl = document.getElementById("blogList");
  let snap;
  try {
    snap = await getDocs(query(collection(db, "blogPosts"), orderBy("createdAt", "desc")));
  } catch (err) {
    listEl.innerHTML = `<p class="dash-empty">Could not load posts right now.</p>`;
    return;
  }

  if (snap.empty) {
    listEl.innerHTML = `<p class="dash-empty">No posts yet, check back soon.</p>`;
    return;
  }

  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const id = docSnap.id;
    const p = docSnap.data();
    const dateStr = p.createdAt ? p.createdAt.toDate().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    const images = allImages(p);

    const article = document.createElement("article");
    article.className = "blog-grid-card";
    article.innerHTML = `
      ${buildMosaic(images, p.title)}
      <div class="blog-grid-card-body">
        <div class="blog-grid-card-full-images" hidden></div>
        <p class="blog-grid-card-date">${dateStr}</p>
        <h2 class="blog-grid-card-title">${escapeHtml(p.title)}</h2>
        <p class="blog-grid-card-excerpt">${escapeHtml(excerpt(p.body))}</p>
        <p class="blog-grid-card-fulltext" hidden>${escapeHtml(p.body).replace(/\n/g, "<br>")}</p>
        <div class="blog-grid-card-footer">
          <button class="blog-grid-card-readmore" type="button">Read More &rarr;</button>
          <div class="blog-like-row-compact">
            <button class="blog-like-btn-compact" type="button" aria-label="Like this post"></button>
            <span class="blog-like-count-compact"></span>
          </div>
        </div>
      </div>
    `;
    listEl.appendChild(article);

    // The mosaic up top is capped at 4 photos to stay tidy. Once expanded,
    // this second row shows every photo the post actually has.
    const imagesRow = article.querySelector(".blog-grid-card-full-images");
    if (images.length) {
      imagesRow.className = "blog-grid-card-full-images" + (images.length === 1 ? " blog-grid-card-full-images-single" : "");
      imagesRow.innerHTML = images.map(url =>
        `<img src="${url}" alt="${escapeHtml(p.title)}" class="blog-lightbox-trigger" loading="lazy">`
      ).join("");
    }

    const readMoreBtn = article.querySelector(".blog-grid-card-readmore");
    const mosaicEl = article.querySelector(".blog-grid-card-mosaic");
    const excerptEl = article.querySelector(".blog-grid-card-excerpt");
    const fullTextEl = article.querySelector(".blog-grid-card-fulltext");
    const bodyEl = article.querySelector(".blog-grid-card-body");

    readMoreBtn.addEventListener("click", () => {
      const isExpanding = fullTextEl.hidden;
      mosaicEl.hidden = isExpanding;
      excerptEl.hidden = isExpanding;
      fullTextEl.hidden = !isExpanding;
      imagesRow.hidden = !isExpanding;
      readMoreBtn.innerHTML = isExpanding ? "Show Less &uarr;" : "Read More &rarr;";
      article.classList.toggle("blog-grid-card-expanded", isExpanding);
      bodyEl.classList.toggle("blog-grid-card-body-expanded", isExpanding);
      if (isExpanding) article.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    wireLikeButton(
      id,
      article.querySelector(".blog-like-btn-compact"),
      article.querySelector(".blog-like-count-compact"),
      p.likesCount || 0,
      { showLabel: false }
    );
  });
}

loadPosts();
