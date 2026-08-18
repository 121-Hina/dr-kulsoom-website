// blog-lightbox.js — a small shared "click a photo to see it a bit bigger"
// popup, used on both the blog listing (expanded cards) and the full post
// page. Not a fullscreen viewer — just a modest, centered enlargement on a
// dim backdrop. Call initLightboxDelegation() once per page; after that any
// <img class="blog-lightbox-trigger"> anywhere on the page opens it.

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "blog-lightbox";
  overlay.innerHTML = `
    <button class="blog-lightbox-close" type="button" aria-label="Close">&times;</button>
    <img class="blog-lightbox-img" src="" alt="">
  `;
  overlay.addEventListener("click", e => {
    if (e.target === overlay || e.target.classList.contains("blog-lightbox-close")) {
      closeLightbox();
    }
  });
  document.body.appendChild(overlay);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeLightbox();
  });
  return overlay;
}

export function openLightbox(src, alt) {
  const el = ensureOverlay();
  const img = el.querySelector(".blog-lightbox-img");
  img.src = src;
  img.alt = alt || "";
  el.classList.add("open");
}

export function closeLightbox() {
  if (overlay) overlay.classList.remove("open");
}

export function initLightboxDelegation() {
  document.addEventListener("click", e => {
    const img = e.target.closest(".blog-lightbox-trigger");
    if (img) openLightbox(img.src, img.alt);
  });
}
