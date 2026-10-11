/*
 * Runs inside a project's preview frame and lets the editor around it pick
 * elements, edit text in place, and follow navigation. The page is sandboxed,
 * so everything goes through postMessage; nothing here can reach the editor's
 * own data. It does nothing when the page is opened outside the editor.
 */
(() => {
  "use strict";
  if (window.parent === window || window.__scBridge) return;
  window.__scBridge = true;

  const LOC = "data-sc-loc";
  const ACCENT = "#b0249a";
  const MOUNT = /^\/(?:preview|p|template-preview)\/[^/]+\//;

  let mode = "none";
  let selected = [];
  let hovered = null;
  /** The element open in the visual inspector, and its style attribute before any preview. */
  let inspected = null;
  let inspectedStyle = null;

  /** What the inspector shows and can change; keep in step with INSPECTOR_PROPERTIES on the server. */
  const INSPECTED = [
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "border-radius",
    "opacity",
  ];
  /** element -> texts of its own text nodes when editing started */
  const edited = new Map();

  const post = (message) => {
    try {
      window.parent.postMessage(message, "*");
    } catch {
      // The editor went away; nothing to tell.
    }
  };

  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();

  // ---- outlines -----------------------------------------------------------

  const layer = document.createElement("div");
  layer.setAttribute("data-sc-overlay", "");
  layer.setAttribute(
    "style",
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646;margin:0;padding:0;border:0",
  );

  const makeBox = (solid) => {
    const box = document.createElement("div");
    box.setAttribute(
      "style",
      `position:absolute;box-sizing:border-box;border:2px ${solid ? "solid" : "dashed"} ${ACCENT};` +
        `background:${solid ? "rgba(176,36,154,0.10)" : "rgba(176,36,154,0.05)"};border-radius:3px;display:none`,
    );
    const label = document.createElement("span");
    label.setAttribute(
      "style",
      `position:absolute;left:-2px;top:-20px;height:18px;padding:0 6px;background:${ACCENT};color:#fff;` +
        "font:600 11px/18px system-ui,sans-serif;border-radius:3px;white-space:nowrap",
    );
    box.appendChild(label);
    layer.appendChild(box);
    return box;
  };

  const hoverBox = makeBox(false);
  let selectedBoxes = [];

  const place = (box, element) => {
    if (!element || !element.isConnected) {
      box.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    const label = box.firstChild;
    label.textContent = element.tagName.toLowerCase();
    // Keep the label on screen when the element touches the top edge.
    label.style.top = rect.top < 22 ? "0" : "-20px";
  };

  const redraw = () => {
    place(hoverBox, mode === "none" ? null : hovered);
    selectedBoxes.forEach((box, index) => place(box, selected[index]));
  };

  const syncSelectedBoxes = () => {
    while (selectedBoxes.length > selected.length) selectedBoxes.pop().remove();
    while (selectedBoxes.length < selected.length) selectedBoxes.push(makeBox(true));
    redraw();
  };

  let frame = 0;
  const scheduleRedraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  };
  window.addEventListener("scroll", scheduleRedraw, true);
  window.addEventListener("resize", scheduleRedraw);

  // ---- describing elements -----------------------------------------------

  const bodyPath = (element) => {
    const path = [];
    let node = element;
    while (node && node !== document.body && node.parentElement) {
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
      node = node.parentElement;
    }
    return node === document.body ? path : [];
  };

  const locOf = (element) => {
    const tagged = element.closest(`[${LOC}]`);
    return tagged ? tagged.getAttribute(LOC) : null;
  };

  const describe = (element) => {
    const shell = element.cloneNode(false);
    shell.removeAttribute(LOC);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      classes: Array.from(element.classList).slice(0, 12),
      text: normalize(element.innerText || element.textContent).slice(0, 160),
      loc: locOf(element),
      path: bodyPath(element),
      html: shell.outerHTML.slice(0, 400),
    };
  };

  const isOurs = (node) => node instanceof Element && layer.contains(node);

  // ---- visual inspector ----------------------------------------------------

  const restoreInspected = () => {
    if (!inspected) return;
    if (inspectedStyle === null) inspected.removeAttribute("style");
    else inspected.setAttribute("style", inspectedStyle);
  };

  const inspect = (element) => {
    restoreInspected();
    inspected = element;
    inspectedStyle = element.getAttribute("style");
    selected = [element];
    syncSelectedBoxes();
    const computed = getComputedStyle(element);
    const values = {};
    INSPECTED.forEach((property) => {
      values[property] = computed.getPropertyValue(property);
    });
    const ownLoc = element.getAttribute(LOC);
    post({
      type: "sc:inspect",
      inspected: {
        element: describe(element),
        ownLoc,
        sameCount: ownLoc ? document.querySelectorAll(`[${LOC}="${CSS.escape(ownLoc)}"]`).length : 1,
        computed: values,
      },
    });
  };

  /** Shows the inspector's unsaved changes on the element, on top of its own style. */
  const previewStyles = (styles) => {
    if (!inspected || !inspected.isConnected) return;
    if (inspectedStyle === null) inspected.removeAttribute("style");
    else inspected.setAttribute("style", inspectedStyle);
    Object.keys(styles || {}).forEach((property) => {
      if (!INSPECTED.includes(property)) return;
      const value = styles[property];
      if (typeof value === "string" && value) inspected.style.setProperty(property, value);
    });
    scheduleRedraw();
  };

  const ownTextNodes = (element) =>
    Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.data.trim() !== "",
    );

  /** The element whose own text sits under the pointer, if any. */
  const textTarget = (node) => {
    let element = node instanceof Element ? node : null;
    while (element && element !== document.body && element !== document.documentElement) {
      if (ownTextNodes(element).length > 0) return element;
      // A wrapper without text of its own: only its children can be edited.
      if (element.children.length > 0) return null;
      element = element.parentElement;
    }
    return null;
  };

  // ---- text editing --------------------------------------------------------

  const beginEditing = (element) => {
    if (!edited.has(element)) {
      edited.set(
        element,
        ownTextNodes(element).map((node) => node.data),
      );
      // Nested elements become editable only when clicked themselves, so every
      // change can be traced to the element it belongs to.
      Array.from(element.children).forEach((child) => {
        if (!edited.has(child)) child.setAttribute("contenteditable", "false");
      });
    }
    element.setAttribute("contenteditable", "plaintext-only");
    if (element.contentEditable !== "plaintext-only") element.setAttribute("contenteditable", "true");
    element.style.outline = `2px solid ${ACCENT}`;
    element.style.outlineOffset = "2px";
    element.focus({ preventScroll: true });
  };

  const collectEdits = () => {
    const edits = [];
    edited.forEach((before, element) => {
      if (!element.isConnected) return;
      const now = ownTextNodes(element).map((node) => node.data);
      const loc = locOf(element);
      const path = bodyPath(element);
      if (before.length === 1) {
        // One piece of text: whatever the element says now replaces it.
        const after = now.join("");
        if (normalize(after) !== normalize(before[0])) {
          edits.push({ loc, path, index: 0, before: before[0], after: normalize(after) });
        }
        return;
      }
      before.forEach((text, index) => {
        const after = index < now.length ? now[index] : "";
        if (normalize(after) !== normalize(text)) {
          edits.push({ loc, path, index, before: text, after: normalize(after) });
        }
      });
    });
    return edits;
  };

  const reportDirty = () => post({ type: "sc:text-dirty", count: collectEdits().length });

  // ---- pointer handling ----------------------------------------------------

  const swallow = (event) => {
    if (mode === "none" || isOurs(event.target)) return;
    if (mode === "text" && event.target instanceof Element && event.target.isContentEditable) return;
    event.stopPropagation();
  };
  ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "submit"].forEach((name) =>
    document.addEventListener(name, swallow, true),
  );

  document.addEventListener(
    "mousemove",
    (event) => {
      if (mode === "none") return;
      const target = event.target instanceof Element ? event.target : null;
      const next = !target || isOurs(target) ? null : mode === "text" ? textTarget(target) : target;
      if (next !== hovered) {
        hovered = next;
        scheduleRedraw();
      }
    },
    true,
  );

  document.addEventListener(
    "mouseleave",
    () => {
      hovered = null;
      scheduleRedraw();
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode === "none") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || isOurs(target)) return;

      if (mode === "text") {
        if (target.isContentEditable && edited.has(target)) return;
        event.preventDefault();
        event.stopPropagation();
        const element = textTarget(target);
        if (element) beginEditing(element);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (target === document.body || target === document.documentElement) return;
      if (mode === "inspect") {
        inspect(target);
        return;
      }
      if (event.shiftKey) {
        const at = selected.indexOf(target);
        if (at === -1) selected.push(target);
        else selected.splice(at, 1);
      } else {
        selected = [target];
      }
      syncSelectedBoxes();
      post({ type: "sc:select", elements: selected.map(describe) });
    },
    true,
  );

  document.addEventListener("input", () => {
    if (mode === "text") reportDirty();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      // The editor's command palette, so the shortcut works after clicking into the page.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        post({ type: "sc:palette" });
        return;
      }
      if (mode === "none") return;
      if (event.key === "Escape") {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        post({ type: "sc:escape" });
      } else if (mode === "text" && event.key === "Enter" && !event.shiftKey) {
        // Text edits are single runs of words; Enter finishes the edit.
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    },
    true,
  );

  // ---- talking to the editor ----------------------------------------------

  const setMode = (next) => {
    mode = next === "select" || next === "text" || next === "inspect" ? next : "none";
    hovered = null;
    document.documentElement.style.cursor =
      mode === "select" || mode === "inspect" ? "crosshair" : mode === "text" ? "text" : "";
    if (mode !== "inspect" && inspected) {
      restoreInspected();
      inspected = null;
      inspectedStyle = null;
    }
    if (mode !== "select" && mode !== "inspect" && selected.length > 0) {
      selected = [];
      syncSelectedBoxes();
    }
    redraw();
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || typeof event.data.type !== "string") return;
    const message = event.data;
    if (message.type === "sc:mode") {
      setMode(message.mode);
    } else if (message.type === "sc:clear-selection") {
      selected = [];
      syncSelectedBoxes();
    } else if (message.type === "sc:collect-text") {
      post({ type: "sc:text-edits", requestId: message.requestId, edits: collectEdits() });
    } else if (message.type === "sc:style-preview") {
      previewStyles(message.styles);
    } else if (message.type === "sc:style-reset") {
      previewStyles({});
    }
  });

  const reportLocation = () => {
    const file = window.location.pathname.replace(MOUNT, "") || "index.html";
    const hash = window.location.hash.startsWith("#/") ? window.location.hash : "";
    post({ type: "sc:location", path: file + hash, title: document.title });
  };
  window.addEventListener("hashchange", reportLocation);
  window.addEventListener("popstate", reportLocation);

  window.addEventListener("error", (event) => {
    if (!event.message) return;
    post({ type: "sc:error", message: String(event.message).slice(0, 500) });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason && reason.message ? reason.message : String(reason);
    post({ type: "sc:error", message: String(message).slice(0, 500) });
  });

  const start = () => {
    document.documentElement.appendChild(layer);
    reportLocation();
    post({ type: "sc:ready" });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
