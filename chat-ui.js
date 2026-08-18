// chat-ui.js — shared message-bubble rendering for both consultation chat
// and support chat. Images render as real tappable thumbnails (reusing the
// same lightbox popup as the blog), voice notes get a custom play button +
// waveform instead of the browser's default audio player, and consecutive
// messages from the same sender group together with a single timestamp.

import { initLightboxDelegation } from "./blog-lightbox.js";

initLightboxDelegation();

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const fileIconSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="chat-file-icon"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const playIconSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const pauseIconSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
const sentTickSvg = `<svg class="chat-sent-tick" viewBox="0 0 16 12" fill="none"><path d="M1 6l4 4L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function dayLabel(date) {
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildVoiceBubble(bubbleEl, voiceUrl) {
  const wrap = document.createElement("div");
  wrap.className = "chat-voice";
  wrap.innerHTML = `
    <button type="button" class="chat-voice-play">${playIconSvg}</button>
    <div class="chat-voice-bars"></div>
    <span class="chat-voice-duration">0:00</span>
  `;
  bubbleEl.appendChild(wrap);

  const audio = new Audio(voiceUrl);
  audio.setAttribute("data-chat-voice", "1");
  const playBtn = wrap.querySelector(".chat-voice-play");
  const barsEl = wrap.querySelector(".chat-voice-bars");
  const durationEl = wrap.querySelector(".chat-voice-duration");

  // A fixed decorative bar pattern (this isn't real waveform analysis of the
  // audio) — a "played" class sweeps across the bars as playback progresses.
  const heights = [40, 70, 30, 90, 55, 100, 45, 65, 35, 80, 50, 25, 60, 40, 55, 35, 75, 45];
  heights.forEach(h => {
    const bar = document.createElement("span");
    bar.style.height = h + "%";
    barsEl.appendChild(bar);
  });
  const bars = [...barsEl.children];

  audio.addEventListener("loadedmetadata", () => {
    durationEl.textContent = formatTime(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    const playedCount = Math.round((audio.currentTime / audio.duration) * bars.length);
    bars.forEach((b, i) => b.classList.toggle("played", i < playedCount));
    durationEl.textContent = formatTime(audio.duration - audio.currentTime);
  });
  audio.addEventListener("ended", () => {
    bars.forEach(b => b.classList.remove("played"));
    durationEl.textContent = formatTime(audio.duration);
  });
  audio.addEventListener("play", () => { playBtn.innerHTML = pauseIconSvg; });
  audio.addEventListener("pause", () => { playBtn.innerHTML = playIconSvg; });

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      // Only one voice note plays at a time.
      document.querySelectorAll("audio[data-chat-voice]").forEach(a => { if (a !== audio) a.pause(); });
      audio.play();
    } else {
      audio.pause();
    }
  });
}

// messages: array of plain message objects (already .data() from Firestore),
// in ascending time order. myUid decides which side ("mine"/"theirs") each
// bubble renders on by default (m.senderId === myUid). Pass isMineFn to
// override that — support chat has multiple staff members, so "mine" there
// means "sent by any staff member", not just the one currently viewing.
export function renderChatMessages(container, messages, myUid, isMineFn) {
  container.innerHTML = "";
  let lastDay = null;
  let lastSenderKey = null;
  let currentGroup = null;

  messages.forEach(m => {
    const created = m.createdAt ? m.createdAt.toDate() : new Date();
    const dLabel = dayLabel(created);
    if (dLabel !== lastDay) {
      const divider = document.createElement("div");
      divider.className = "day-divider";
      divider.textContent = dLabel;
      container.appendChild(divider);
      lastDay = dLabel;
      lastSenderKey = null; // start a fresh group after a day divider
    }

    const isMine = isMineFn ? isMineFn(m) : m.senderId === myUid;
    const senderKey = isMineFn ? (isMine ? "mine" : "theirs") : (m.senderId || m.senderRole || "?");
    if (senderKey !== lastSenderKey || !currentGroup) {
      currentGroup = document.createElement("div");
      currentGroup.className = "msg-group " + (isMine ? "mine" : "theirs");
      container.appendChild(currentGroup);
      lastSenderKey = senderKey;
    }

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (isMine ? "chat-bubble-mine" : "chat-bubble-theirs");
    const timeStr = m.createdAt ? created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    const isImage = m.isImage || (m.fileUrl && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(m.fileUrl));

    if (m.voiceUrl) {
      buildVoiceBubble(bubble, m.voiceUrl);
    } else if (m.fileUrl && isImage) {
      bubble.classList.add("chat-bubble-image");
      const img = document.createElement("img");
      img.src = m.fileUrl;
      img.alt = m.fileName || "attached photo";
      img.className = "chat-image-thumb blog-lightbox-trigger";
      img.loading = "lazy";
      bubble.appendChild(img);
      if (m.text) {
        const textEl = document.createElement("div");
        textEl.className = "chat-bubble-text";
        textEl.textContent = m.text;
        bubble.appendChild(textEl);
      }
    } else if (m.fileUrl) {
      bubble.innerHTML = `<a href="${m.fileUrl}" target="_blank" rel="noopener" class="chat-file-link">${fileIconSvg}${escapeHtml(m.fileName || "Attached file")}</a>` +
        (m.text ? `<div class="chat-bubble-text">${escapeHtml(m.text)}</div>` : "");
    } else {
      bubble.innerHTML = `<span class="chat-bubble-text">${escapeHtml(m.text)}</span>`;
    }

    const timeEl = document.createElement("span");
    timeEl.className = "chat-bubble-time";
    timeEl.innerHTML = escapeHtml(timeStr) + (isMine ? sentTickSvg : "");
    bubble.appendChild(timeEl);

    currentGroup.appendChild(bubble);
  });

  container.scrollTop = container.scrollHeight;
}
