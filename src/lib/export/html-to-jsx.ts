import type { AnyNode, Element } from "domhandler";

import {
  attributeEntries,
  collapseWhitespace,
  INVISIBLE_CHARACTER,
  isElement,
  isParent,
  jsString,
  sanitizeUrl,
  textContent,
} from "./dom";
import {
  buildRootItems,
  isSingleElement,
  renderItems,
  type Dialect,
  type ElementPlan,
} from "./layout";

export interface JsxOptions {
  /** Indentation depth, in steps of two spaces, of the returned expression. */
  indent?: number;
}

/** camelCase names React uses for HTML attributes; keyed by their lowercase form. */
const HTML_ATTRIBUTE_NAMES =
  "acceptCharset accessKey allowFullScreen autoCapitalize autoComplete " +
  "autoCorrect autoFocus autoPlay autoSave cellPadding cellSpacing charSet " +
  "classID className colSpan contentEditable contextMenu controlsList " +
  "crossOrigin dateTime disablePictureInPicture disableRemotePlayback " +
  "encType enterKeyHint fetchPriority formAction formEncType formMethod " +
  "formNoValidate formTarget frameBorder hrefLang htmlFor httpEquiv " +
  "imageSizes imageSrcSet inputMode itemID itemProp itemRef itemScope " +
  "itemType keyParams keyType marginHeight marginWidth maxLength mediaGroup " +
  "minLength noModule noValidate playsInline popoverTarget " +
  "popoverTargetAction radioGroup readOnly referrerPolicy rowSpan " +
  "spellCheck srcDoc srcLang srcSet tabIndex useMap";

/** camelCase SVG attributes; the HTML parser may hand them over lowercased. */
const SVG_ATTRIBUTE_NAMES =
  "allowReorder attributeName attributeType autoReverse baseFrequency " +
  "baseProfile calcMode clipPathUnits contentScriptType contentStyleType " +
  "diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits " +
  "glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength " +
  "keyPoints keySplines keyTimes lengthAdjust limitingConeAngle " +
  "markerHeight markerUnits markerWidth maskContentUnits maskType maskUnits " +
  "numOctaves pathLength patternContentUnits patternTransform patternUnits " +
  "pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio " +
  "primitiveUnits refX refY repeatCount repeatDur requiredExtensions " +
  "requiredFeatures specularConstant specularExponent spreadMethod " +
  "startOffset stdDeviation stitchTiles surfaceScale systemLanguage " +
  "tableValues targetX targetY textLength viewBox viewTarget " +
  "xChannelSelector yChannelSelector zoomAndPan";

/** Hyphenated and namespaced attributes that React wants in camelCase. */
const SEPARATED_ATTRIBUTE_NAMES =
  "accept-charset http-equiv accent-height alignment-baseline arabic-form " +
  "baseline-shift cap-height clip-path clip-rule color-interpolation " +
  "color-interpolation-filters color-profile color-rendering " +
  "dominant-baseline enable-background fill-opacity fill-rule flood-color " +
  "flood-opacity font-family font-size font-size-adjust font-stretch " +
  "font-style font-variant font-weight glyph-name " +
  "glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x " +
  "horiz-origin-x image-rendering letter-spacing lighting-color marker-end " +
  "marker-mid marker-start overline-position overline-thickness paint-order " +
  "panose-1 pointer-events rendering-intent shape-rendering stop-color " +
  "stop-opacity strikethrough-position strikethrough-thickness " +
  "stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin " +
  "stroke-miterlimit stroke-opacity stroke-width text-anchor " +
  "text-decoration text-rendering transform-origin underline-position " +
  "underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic " +
  "v-hanging v-ideographic v-mathematical vector-effect vert-adv-y " +
  "vert-origin-x vert-origin-y word-spacing writing-mode x-height " +
  "xlink:actuate xlink:arcrole xlink:href xlink:role xlink:show xlink:title " +
  "xlink:type xml:base xml:lang xml:space xmlns:xlink";

function camelCase(name: string): string {
  return name.replace(/[-:]+([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

function buildAttributeNames(): Map<string, string> {
  const names = new Map<string, string>([
    ["class", "className"],
    ["for", "htmlFor"],
  ]);
  for (const list of [HTML_ATTRIBUTE_NAMES, SVG_ATTRIBUTE_NAMES]) {
    for (const name of list.split(" ")) names.set(name.toLowerCase(), name);
  }
  for (const name of SEPARATED_ATTRIBUTE_NAMES.split(" ")) {
    const mapped = camelCase(name);
    names.set(name, mapped);
    names.set(mapped.toLowerCase(), mapped);
  }
  return names;
}

const ATTRIBUTE_NAMES = buildAttributeNames();

/** Props React treats as booleans: written bare, whatever the HTML value was. */
const BOOLEAN_PROPS: ReadonlySet<string> = new Set(
  (
    "allowFullScreen async autoFocus autoPlay controls default defer disabled " +
    "disablePictureInPicture disableRemotePlayback formNoValidate hidden inert " +
    "itemScope loop multiple muted noModule noValidate open playsInline " +
    "readOnly required reversed scoped seamless selected"
  ).split(" "),
);

/** Props that are `true` when empty and a string otherwise. */
const OPTIONAL_VALUE_PROPS: ReadonlySet<string> = new Set([
  "capture",
  "download",
]);

/** Attribute names React reserves or refuses on DOM elements. */
const RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "children",
  "dangerouslysetinnerhtml",
  "defaultchecked",
  "defaultvalue",
  "innerhtml",
  "key",
  "ref",
  "suppresscontenteditablewarning",
  "suppresshydrationwarning",
]);

/** Input types whose `value` React lets through without an `onChange`. */
const READ_ONLY_VALUE_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit",
]);

/** Hyphenated names that are regular SVG/MathML elements, not custom elements. */
const NOT_CUSTOM_ELEMENTS: ReadonlySet<string> = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "missing-glyph",
]);

/** Elements whose content is raw text that only matters without scripting. */
const DROPPED_TAGS: ReadonlySet<string> = new Set([
  "noembed",
  "noframes",
  "noscript",
  "script",
]);

const VALID_TAG_NAME = /^[a-z][\w-]*$/;
const VALID_ATTRIBUTE_NAME = /^[A-Za-z_][\w-]*$/;
const NEEDS_EXPRESSION = /[{}<>]|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i;
const UNSAFE_IN_ATTRIBUTE_STRING = /["&\\\n\r\t]/;

function isCustomElement(el: Element): boolean {
  if (!el.name.includes("-")) return typeof el.attribs.is === "string";
  return !NOT_CUSTOM_ELEMENTS.has(el.name);
}

/** Maps an HTML or SVG attribute name to the prop name React expects. */
function jsxAttributeName(name: string): string {
  if (name.startsWith("data-") || name.startsWith("aria-")) return name;
  const lower = name.toLowerCase();
  // React rejects unknown mixed-case names such as MathML's `definitionURL`,
  // so anything it has no camelCase form for is written in lowercase.
  return ATTRIBUTE_NAMES.get(lower) ?? lower;
}

function stripCssComments(css: string): string {
  if (!css.includes("/*")) return css;
  let out = "";
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "\\") {
      i++;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "/" && css[i + 1] === "*" && depth === 0) {
      const close = css.indexOf("*/", i + 2);
      out += `${css.slice(start, i)} `;
      if (close < 0) return out;
      i = close + 1;
      start = close + 2;
    }
  }
  return out + css.slice(start);
}

/**
 * Splits an inline style into declarations. Semicolons and colons inside
 * quotes or parentheses (`url(data:image/png;base64,...)`) are left alone.
 */
function parseDeclarations(source: string): Array<[string, string]> {
  const css = stripCssComments(source);
  const declarations: Array<[string, string]> = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  let colon = -1;

  const finish = (end: number): void => {
    if (colon >= 0) {
      const property = css.slice(start, colon).trim();
      const value = css.slice(colon + 1, end).trim();
      if (property && value) declarations.push([property, value]);
    }
    start = end + 1;
    colon = -1;
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "\\") {
      i++;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === ":" && colon < 0 && depth === 0) {
      colon = i;
    } else if (ch === ";" && depth === 0) {
      finish(i);
    }
  }
  finish(css.length);
  return declarations;
}

function styleKey(property: string): string | null {
  if (property.startsWith("--")) return jsString(property);
  const lower = property.toLowerCase();
  if (!/^-?[a-z][a-z0-9-]*$/.test(lower)) return null;
  // `-webkit-box` becomes `WebkitBox`, but Microsoft's prefix stays lowercase.
  return camelCase(lower.startsWith("-ms-") ? lower.slice(1) : lower);
}

/**
 * Converts an inline `style` attribute to a JavaScript object literal, or
 * returns null when it holds no usable declaration. `!important` is removed
 * because React cannot set it; an important declaration still wins over a
 * later normal one, as it does in CSS.
 */
function styleToObjectLiteral(style: string): string | null {
  const entries = new Map<string, { value: string; important: boolean }>();
  for (const [property, rawValue] of parseDeclarations(style)) {
    const key = styleKey(property);
    if (key === null) continue;
    const value = rawValue.replace(/\s*!\s*important\s*$/i, "");
    if (value === "") continue;
    const important = value.length !== rawValue.length;
    const existing = entries.get(key);
    if (existing && existing.important && !important) continue;
    // Re-inserting keeps declarations in the order in which they take effect.
    entries.delete(key);
    entries.set(key, { value, important });
  }
  if (entries.size === 0) return null;
  const parts: string[] = [];
  for (const [key, entry] of entries) {
    parts.push(`${key}: ${jsString(entry.value)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function attributeValue(value: string): string {
  return UNSAFE_IN_ATTRIBUTE_STRING.test(value) || INVISIBLE_CHARACTER.test(value)
    ? `{${jsString(value)}}`
    : `"${value}"`;
}

function optionValue(option: Element): string {
  const value = option.attribs.value;
  return value ?? collapseWhitespace(textContent(option)).trim();
}

function findSelectedOptions(node: AnyNode, found: Element[]): void {
  if (!isParent(node)) return;
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.name === "option") {
      if (child.attribs.selected !== undefined) found.push(child);
    } else {
      findSelectedOptions(child, found);
    }
  }
}

/** `defaultValue` for a `<select>`, replacing `selected` on its options. */
function selectDefaultValue(select: Element): string | null {
  const selected: Element[] = [];
  findSelectedOptions(select, selected);
  if (selected.length === 0) return null;
  if (select.attribs.multiple !== undefined) {
    return `defaultValue={[${selected.map((el) => jsString(optionValue(el))).join(", ")}]}`;
  }
  const last = selected[selected.length - 1];
  return `defaultValue=${attributeValue(optionValue(last))}`;
}

/** Writes the attributes of an element as JSX props, each preceded by a space. */
function jsxAttributes(el: Element): string {
  const tag = el.name;
  const custom = isCustomElement(el);
  const inputType = (el.attribs.type ?? "text").toLowerCase();
  const seen = new Set<string>();
  let out = "";

  const add = (name: string, value: string | null): void => {
    if (seen.has(name) || !VALID_ATTRIBUTE_NAME.test(name)) return;
    seen.add(name);
    out += value === null ? ` ${name}` : ` ${name}=${value}`;
  };

  for (const [rawName, rawValue] of attributeEntries(el)) {
    const lower = rawName.toLowerCase();
    if (/^on./.test(lower) || RESERVED_ATTRIBUTES.has(lower)) continue;

    if (lower === "style") {
      const literal = styleToObjectLiteral(rawValue);
      if (literal !== null) add("style", `{${literal}}`);
      continue;
    }

    const value = sanitizeUrl(lower, rawValue);
    if (custom) {
      // React passes attributes of custom elements through under their own name.
      add(rawName, attributeValue(value));
      continue;
    }

    if (tag === "input" && lower === "value") {
      const name = READ_ONLY_VALUE_TYPES.has(inputType) ? "value" : "defaultValue";
      add(name, attributeValue(value));
      continue;
    }
    if (tag === "input" && lower === "checked") {
      add("defaultChecked", null);
      continue;
    }
    // A `value` attribute means nothing on these; their state is set below.
    if ((tag === "select" || tag === "textarea") && lower === "value") continue;
    if (tag === "option" && lower === "selected") continue;
    // React warns about empty URLs and removes them, except for `<a href="">`.
    if (value === "" && (lower === "src" || (lower === "href" && tag !== "a"))) {
      continue;
    }

    const name = jsxAttributeName(rawName);
    if (BOOLEAN_PROPS.has(name)) add(name, null);
    else if (value === "" && OPTIONAL_VALUE_PROPS.has(name)) add(name, null);
    else add(name, attributeValue(value));

    if (name === "contentEditable" && value.toLowerCase() !== "false") {
      add("suppressContentEditableWarning", null);
    }
  }

  if (!custom && tag === "select") {
    const selected = selectDefaultValue(el);
    if (selected !== null && !seen.has("defaultValue")) {
      seen.add("defaultValue");
      out += ` ${selected}`;
    }
  }
  return out;
}

const jsxDialect: Dialect = {
  spaceMarker: '{" "}',
  textBreakIsSpace: false,

  text(value: string): string {
    return NEEDS_EXPRESSION.test(value) || INVISIBLE_CHARACTER.test(value)
      ? `{${jsString(value)}}`
      : value;
  },

  exactText(value: string): string {
    return `{${jsString(value)}}`;
  },

  element(el: Element): ElementPlan {
    const tag = el.name;
    if (DROPPED_TAGS.has(tag)) return { kind: "drop" };
    // Names such as `o:p` cannot be written as JSX elements.
    if (!VALID_TAG_NAME.test(tag) || tag === "this") return { kind: "unwrap" };

    const open = `<${tag}${jsxAttributes(el)}`;
    if (tag === "style") {
      const css = jsString(textContent(el));
      return {
        kind: "atom",
        text: `${open} dangerouslySetInnerHTML={{ __html: ${css} }} />`,
      };
    }
    if (tag === "textarea") {
      const text = textContent(el);
      const value = text === "" ? "" : ` defaultValue={${jsString(text)}}`;
      return { kind: "atom", text: `${open}${value} />` };
    }
    // The content of an iframe is fallback text that browsers never render.
    if (tag === "iframe") return { kind: "atom", text: `${open} />` };

    return {
      kind: "element",
      start: `${open}>`,
      end: `</${tag}>`,
      empty: `${open} />`,
    };
  },
};

/**
 * Converts parsed HTML nodes to one JSX expression: a single element, a
 * fragment, or `null` when nothing is left. Scripts, `<noscript>`, comments,
 * inline event handlers and `javascript:` URLs are dropped.
 */
export function nodesToJsx(
  nodes: readonly AnyNode[],
  options: JsxOptions = {},
): string {
  const depth = options.indent ?? 0;
  const pad = "  ".repeat(depth);
  const items = buildRootItems(nodes, jsxDialect);
  if (items.length === 0) return `${pad}null`;
  if (isSingleElement(items)) return renderItems(items, depth, jsxDialect);
  return `${pad}<>\n${renderItems(items, depth + 1, jsxDialect)}\n${pad}</>`;
}
