// services.js — renders the homepage Services accordion from Firestore
// (settings/services), so Admin can add/edit treatments and prices without
// touching code. Falls back to the current known services if that document
// doesn't exist yet.

import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULT_SERVICES = [
  {
    title: "Face Treatments",
    items: [
      { name: "Chemical Peel", description: "Acne treatment, per session", price: "2,000", unit: "/session" },
      { name: "Chemical Peel - Whitening", description: "Skin brightening & even tone", price: "3,000", unit: "/session" },
      { name: "Hydrafacial - Simple", description: "Deep cleanse & hydration", price: "6,000", unit: "" },
      { name: "Hydrafacial + Anti-Aging Serums", description: "With advanced youth-restoring serums", price: "8,000", unit: "" }
    ]
  },
  {
    title: "Skin Repair & Glow Treatments",
    items: [
      { name: "Microneedling + PRP", description: "Repairs skin & boosts natural healing", price: "5,000", unit: "" },
      { name: "Mesotherapy", description: "Microneedling + PRP + Serums, full skin repair boost", price: "10,000", unit: "" },
      { name: "Botox - Upper Face", description: "Smooths fine lines & wrinkles", price: "30,000", unit: "" }
    ]
  },
  {
    title: "Hair Treatments",
    items: [
      { name: "Hair PRP", description: "Hair growth therapy", price: "6,000", unit: "" },
      { name: "Hair PRP + Serums", description: "With growth-boosting serums", price: "10,000", unit: "" },
      { name: "Hair Laser", description: "Face / Chin area", price: "6,000", unit: "" }
    ]
  },
  {
    title: "Other Procedures",
    items: [
      { name: "Mole Removal", description: "Per mole", price: "2,000", unit: "/mole" }
    ]
  }
];

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderServices(groups) {
  const container = document.getElementById("servicesContainer");
  if (!container) return;

  container.innerHTML = groups.map((g, gi) => `
    <div class="service-group">
      <button class="group-title" type="button"><span class="group-num">${String(gi + 1).padStart(2, "0")}</span> ${escapeHtml(g.title)} <span class="group-toggle">+</span></button>
      <div class="service-list">
        ${g.items.map(item => `
          <div class="service-row">
            <div class="service-info">
              <h4>${escapeHtml(item.name)}</h4>
              <p>${escapeHtml(item.description)}</p>
            </div>
            <div class="service-price"><span class="cur">PKR</span> ${escapeHtml(item.price)}<span class="unit">${escapeHtml(item.unit)}</span></div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  // Accordion behavior — collapsed by default, click a category to expand
  container.querySelectorAll(".group-title").forEach(btn => {
    const list = btn.nextElementSibling;
    btn.addEventListener("click", () => {
      const isOpen = list.classList.contains("list-open");
      container.querySelectorAll(".service-list").forEach(l => l.classList.remove("list-open"));
      container.querySelectorAll(".group-title").forEach(g => g.classList.remove("group-open"));
      if (!isOpen) {
        list.classList.add("list-open");
        btn.classList.add("group-open");
      }
    });
  });
}

async function loadServices() {
  try {
    const snap = await getDoc(doc(db, "settings", "services"));
    const groups = snap.exists() && Array.isArray(snap.data().groups) && snap.data().groups.length
      ? snap.data().groups
      : DEFAULT_SERVICES;
    renderServices(groups);
  } catch (err) {
    renderServices(DEFAULT_SERVICES);
  }
}

loadServices();
