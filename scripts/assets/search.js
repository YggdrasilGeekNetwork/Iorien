(function () {
  var script = document.currentScript;
  var indexUrl = script.getAttribute("data-index");
  var rootPrefix = script.getAttribute("data-root") || "";
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");
  var data = null;

  fetch(indexUrl)
    .then(function (r) { return r.json(); })
    .then(function (d) { data = d; });

  function normalize(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function render(matches) {
    results.innerHTML = "";
    if (matches.length === 0) {
      results.innerHTML = '<div class="search-empty">Nenhum resultado</div>';
      return;
    }
    matches.forEach(function (item) {
      var a = document.createElement("a");
      a.href = rootPrefix + item.url;
      a.textContent = item.title;
      results.appendChild(a);
    });
  }

  input.addEventListener("input", function () {
    var q = normalize(input.value.trim());
    if (!q || !data) {
      results.classList.remove("open");
      return;
    }
    var matches = data
      .filter(function (item) {
        return normalize(item.title).indexOf(q) !== -1 || normalize(item.text).indexOf(q) !== -1;
      })
      .slice(0, 20);
    render(matches);
    results.classList.add("open");
  });

  document.addEventListener("click", function (e) {
    if (e.target !== input && !results.contains(e.target)) {
      results.classList.remove("open");
    }
  });
})();
