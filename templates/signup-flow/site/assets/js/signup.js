// Step 1: validate the account form in the browser, then continue to the plan page.
// There is no backend. Where the page navigates below is the place to send the values
// to your own sign-up endpoint first.
(function () {
  var form = document.querySelector("[data-signup-form]");
  if (!form) return;

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // One rule per field name. Each returns an error message, or "" when the value is fine.
  var rules = {
    name: function (input) {
      var value = input.value.trim();
      if (!value) return "Tell us what to call you.";
      if (value.length < 2) return "That looks a little short. Use at least 2 characters.";
      return "";
    },
    email: function (input) {
      var value = input.value.trim();
      if (!value) return "Enter your email address.";
      if (!EMAIL.test(value)) return "That email doesn't look right. Check for typos?";
      return "";
    },
    password: function (input) {
      var value = input.value;
      if (!value) return "Choose a password.";
      if (value.length < 8) return "Use at least 8 characters.";
      if (!/\d/.test(value)) return "Add at least one number.";
      return "";
    },
    terms: function (input) {
      return input.checked ? "" : "Please accept the terms to continue.";
    },
  };

  var fields = Object.keys(rules).map(function (name) {
    return form.elements[name];
  });
  var summary = form.querySelector("[data-error-summary]");

  // The inline messages below replace the browser's own validation bubbles.
  form.setAttribute("novalidate", "");

  function errorElement(input) {
    return document.getElementById(input.id + "-error");
  }

  function validate(input) {
    var message = rules[input.name](input);
    var error = errorElement(input);
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    return !message;
  }

  function showSummary(count) {
    if (!summary) return;
    summary.textContent = count === 1 ? "One thing needs fixing before you continue." : count + " things need fixing before you continue.";
    summary.hidden = count === 0;
  }

  fields.forEach(function (input) {
    // Check a field when the person leaves it, and re-check while they fix a flagged one.
    input.addEventListener("blur", function () {
      if (input.type === "checkbox" || input.value) validate(input);
    });
    input.addEventListener(input.type === "checkbox" ? "change" : "input", function () {
      if (input.getAttribute("aria-invalid") === "true") validate(input);
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var invalid = fields.filter(function (input) {
      return !validate(input);
    });
    showSummary(invalid.length);

    if (invalid.length) {
      invalid[0].focus();
      return;
    }

    // Remember the first name for the next pages. Storage can be unavailable
    // (private mode, sandboxed previews), and the flow works without it.
    try {
      window.sessionStorage.setItem("frondly.firstName", form.elements.name.value.trim().split(/\s+/)[0]);
    } catch (error) {
      /* carry on without the name */
    }

    window.location.assign(form.getAttribute("data-next") || "plan.html");
  });

  // Show / hide the password.
  var toggle = form.querySelector("[data-password-toggle]");
  var password = form.elements.password;
  if (toggle && password) {
    toggle.addEventListener("click", function () {
      var reveal = password.type === "password";
      password.type = reveal ? "text" : "password";
      var text = toggle.querySelector("[data-password-toggle-text]");
      if (text) text.textContent = reveal ? "Hide" : "Show";
    });
  }
})();
