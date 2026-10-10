// Step 3: show the plan that was chosen on the previous page.
// The choice arrives in the address (welcome.html?plan=grower). Session storage is the
// second place to look. If neither has a known plan, the "Not chosen yet" block stays.
(function () {
  function read(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (storageError) {
      return null;
    }
  }

  var fromAddress = new URLSearchParams(window.location.search).get("plan");
  var wanted = String(fromAddress || read("frondly.plan") || "").toLowerCase();

  var blocks = Array.prototype.slice.call(document.querySelectorAll("[data-plan]"));
  var match = blocks.filter(function (block) {
    return block.getAttribute("data-plan") === wanted;
  })[0];
  var fallback = document.querySelector("[data-plan-fallback]");

  if (match) {
    match.hidden = false;
    if (fallback) fallback.hidden = true;
    var name = match.querySelector("[data-plan-name]");
    if (name) document.title = "Welcome to " + name.textContent + " — Frondly";
  }

  // Greet by first name when step 1 saved it.
  var firstName = read("frondly.firstName");
  var nameSlot = document.querySelector("[data-welcome-name]");
  if (firstName && nameSlot) nameSlot.textContent = ", " + firstName;
})();
