// Step 2: make sure a plan is picked, then carry the choice to the welcome page.
// The plan travels in the address (welcome.html?plan=grower) so it survives a reload
// and works where storage is blocked. Session storage is a second copy when available.
(function () {
  var form = document.querySelector("[data-plan-form]");
  if (!form) return;

  var radios = Array.prototype.slice.call(form.querySelectorAll('input[name="plan"]'));
  var error = document.getElementById("plan-error");
  var submitText = form.querySelector("[data-plan-submit-text]");
  var lead = document.querySelector("[data-plan-lead]");

  // The inline message below replaces the browser's own validation bubble.
  form.setAttribute("novalidate", "");

  function read(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (storageError) {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (storageError) {
      /* carry on without storage */
    }
  }

  function selected() {
    return radios.filter(function (radio) {
      return radio.checked;
    })[0];
  }

  function planName(radio) {
    return radio.value.charAt(0).toUpperCase() + radio.value.slice(1);
  }

  function showError(message) {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function refresh() {
    var radio = selected();
    if (submitText) submitText.textContent = radio ? "Continue with " + planName(radio) : "Continue";
    if (radio) showError("");
  }

  // Greet by first name when step 1 saved it.
  var firstName = read("frondly.firstName");
  if (lead && firstName) {
    lead.textContent = "Nice to meet you, " + firstName + ". Pick the plan that fits your windowsill.";
  }

  // Coming back from the welcome page: restore the earlier choice.
  var previous = read("frondly.plan");
  radios.forEach(function (radio) {
    if (previous && radio.value === previous) radio.checked = true;
    radio.addEventListener("change", refresh);
  });
  refresh();

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var radio = selected();
    if (!radio) {
      showError("Pick a plan to continue. Seedling is free if you're not sure yet.");
      radios[0].focus();
      return;
    }

    write("frondly.plan", radio.value);
    window.location.assign("welcome.html?plan=" + encodeURIComponent(radio.value));
  });
})();
