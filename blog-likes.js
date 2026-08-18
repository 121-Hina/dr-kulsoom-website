// blog-likes.js — shared "like" button wiring for blog posts. Used both on
// blog.html (a compact button on every card) and blog-post.html (the full
// post page). One "like" doc per user per post is what actually records
// the like; blogPosts/{id}.likesCount is just a fast-to-read counter kept
// in sync alongside it.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const heartOutline = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 1.8 4.5 5 3.6c2-.55 4 .2 5 2 1-1.8 3-2.55 5-2 3.2.9 4.6 4.4 3 7.7-2.5 4.6-10 9.2-10 9.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const heartFilled = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 1.8 4.5 5 3.6c2-.55 4 .2 5 2 1-1.8 3-2.55 5-2 3.2.9 4.6 4.4 3 7.7-2.5 4.6-10 9.2-10 9.2z"/></svg>`;

// btn: the clickable heart button element.
// countEl: where the count text goes (can be null to skip showing a count).
// initialCount: p.likesCount as already loaded, so no extra read is needed.
// options.showLabel: true -> "3 likes", false -> just "3".
export function wireLikeButton(postId, btn, countEl, initialCount, options = {}) {
  const showLabel = options.showLabel !== false;
  let liked = false;
  let count = initialCount || 0;

  function render() {
    btn.innerHTML = liked ? heartFilled : heartOutline;
    btn.classList.toggle("blog-like-btn-active", liked);
    if (countEl) countEl.textContent = showLabel ? (count === 1 ? "1 like" : `${count} likes`) : String(count);
  }
  render();

  onAuthStateChanged(auth, async user => {
    if (!user) {
      liked = false;
      render();
      return;
    }
    try {
      const snap = await getDoc(doc(db, "blogPosts", postId, "likes", user.uid));
      liked = snap.exists();
      render();
    } catch (err) {
      // Non-critical — button just falls back to its unliked look.
    }
  });

  async function toggleLike() {
    const user = auth.currentUser;
    if (!user) return;
    const likeRef = doc(db, "blogPosts", postId, "likes", user.uid);
    const postRef = doc(db, "blogPosts", postId);

    // Update the button instantly, then sync with Firestore — feels
    // responsive even on a slow connection.
    const wasLiked = liked;
    liked = !wasLiked;
    count += liked ? 1 : -1;
    render();

    try {
      if (wasLiked) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, { likesCount: increment(-1) });
      } else {
        await setDoc(likeRef, { likedAt: serverTimestamp() });
        await updateDoc(postRef, { likesCount: increment(1) });
      }
    } catch (err) {
      // Roll back the optimistic update if the write failed.
      liked = wasLiked;
      count += wasLiked ? 1 : -1;
      render();
      console.error("[blog-likes] toggleLike failed:", err);
    }
  }

  btn.addEventListener("click", () => {
    if (auth.currentUser) {
      toggleLike();
    } else if (window.requireAuth) {
      window.requireAuth(toggleLike);
    }
  });
}
