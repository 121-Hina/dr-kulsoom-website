// location-map.js — "View on map" toggle for the homepage Locations
// section. Expands a small Google Maps embed in place (no API key needed —
// this uses Maps' free query-based embed), with a link out to the full
// Google Maps for directions.

document.querySelectorAll(".location-map-toggle").forEach(btn => {
  const card = btn.closest(".location-card");
  const preview = card.querySelector(".location-map-preview");
  const iframe = preview.querySelector("iframe");
  const openLink = preview.querySelector(".location-map-open");
  const query = encodeURIComponent(btn.dataset.query);
  let loaded = false;

  btn.addEventListener("click", () => {
    const isOpening = preview.hidden;

    if (isOpening && !loaded) {
      iframe.src = `https://www.google.com/maps?q=${query}&output=embed`;
      openLink.href = `https://www.google.com/maps/search/?api=1&query=${query}`;
      loaded = true;
    }

    preview.hidden = !isOpening;
    btn.textContent = isOpening ? "Hide map" : "View on map";
  });
});
