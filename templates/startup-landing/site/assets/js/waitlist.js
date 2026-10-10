// Waitlist forms: validate in the browser and swap the form for a thank-you message.
// There is no backend here: where the form is hidden below is the place to send the
// values to your own endpoint.
(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function messageFor(input) {
    var value = input.value.trim();
    if (!value) return input.getAttribute("data-required-message") || "This field is required.";
    if (input.type === "email" && !EMAIL.test(value)) return "That doesn't look like an email address. Check for typos?";
    return "";
  }

  function showError(input, message) {
    var error = document.getElementById(input.getAttribute("aria-describedby"));
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }

  document.querySelectorAll("form[data-waitlist]").forEach(function (form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll("input[required]"));
    var success = form.parentNode.querySelector("[data-waitlist-success]");

    // Native bubbles are replaced by the inline messages below.
    form.setAttribute("novalidate", "");

    fields.forEach(function (input) {
      // Once a field has been flagged, clear the message as soon as it is fixed.
      input.addEventListener("input", function () {
        if (input.getAttribute("aria-invalid") === "true") showError(input, messageFor(input));
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var firstInvalid = null;
      fields.forEach(function (input) {
        var message = messageFor(input);
        showError(input, message);
        if (message && !firstInvalid) firstInvalid = input;
      });

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      form.hidden = true;
      if (success) {
        success.hidden = false;
        success.focus();
      }
    });
  });
})();
