// Mobile navigation: toggles the panel under the header.
// Without JavaScript the panel is simply shown (see the `noscript:` classes in the HTML).
(function () {
  var toggle = document.querySelector("[data-menu-toggle]");
  var menu = document.querySelector("[data-menu]");
  if (!toggle || !menu) return;

  var label = toggle.querySelector("[data-menu-label]");

  function isOpen() {
    return toggle.getAttribute("aria-expanded") === "true";
  }

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    menu.classList.toggle("hidden", !open);
    if (label) label.textContent = open ? "Close" : "Menu";
  }

  toggle.addEventListener("click", function () {
    setOpen(!isOpen());
  });

  // Following a link inside the menu closes it.
  menu.addEventListener("click", function (event) {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // Leaving the mobile breakpoint resets the menu.
  window.matchMedia("(min-width: 1024px)").addEventListener("change", function (event) {
    if (event.matches) setOpen(false);
  });
})();
