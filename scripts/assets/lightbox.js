(function () {
  function closeLightbox() {
    var overlay = document.querySelector(".lightbox-overlay");
    if (overlay) overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeLightbox();
  }

  function openLightbox(src, alt) {
    var overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    overlay.appendChild(img);
    overlay.addEventListener("click", closeLightbox);
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
  }

  document.addEventListener("click", function (e) {
    var img = e.target.closest("article img");
    if (!img) return;
    openLightbox(img.currentSrc || img.src, img.alt);
  });
})();
