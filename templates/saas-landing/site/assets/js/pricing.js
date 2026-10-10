// Pricing: switch every price between monthly and yearly billing.
// Each element that changes carries both values: data-monthly="…" and data-yearly="…".
// Without JavaScript the page shows the monthly prices already in the HTML.
(function () {
  var group = document.querySelector("[data-billing-toggle]");
  if (!group) return;

  var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-billing]"));
  var targets = Array.prototype.slice.call(document.querySelectorAll("[data-monthly][data-yearly]"));
  var announcer = document.querySelector("[data-billing-announcer]");

  function setBilling(period) {
    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-billing") === period ? "true" : "false");
    });
    targets.forEach(function (element) {
      element.textContent = element.getAttribute("data-" + period);
    });
    if (announcer) announcer.textContent = period === "yearly" ? "Showing yearly prices." : "Showing monthly prices.";
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      setBilling(button.getAttribute("data-billing"));
    });
  });
})();
