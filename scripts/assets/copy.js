(function () {
  function base64ToText(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function flash(button, symbol) {
    var original = button.getAttribute("data-label") || "📋";
    button.textContent = symbol;
    setTimeout(function () {
      button.textContent = original;
    }, 1200);
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest(".copy-button");
    if (!button) return;
    // Buttons that live inside a <summary> would otherwise also toggle the
    // parent <details> open/closed when clicked.
    e.preventDefault();
    e.stopPropagation();

    var text = base64ToText(button.getAttribute("data-copy-text"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flash(button, "✅"); },
        function () { flash(button, "⚠️"); }
      );
    } else {
      flash(button, "⚠️");
    }
  });
})();
