import type { AnyNode, Element, ParentNode, Text } from "domhandler";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/** Elements that never have content or a closing tag. */
export const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** HTML attributes whose presence alone means "true". */
export const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "disablepictureinpicture",
  "disableremoteplayback",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "scoped",
  "seamless",
  "selected",
]);

export function isElement(node: AnyNode): node is Element {
  const type: string = node.type;
  return type === "tag" || type === "script" || type === "style";
}

export function isText(node: AnyNode): node is Text {
  const type: string = node.type;
  return type === "text";
}

export function isParent(node: AnyNode): node is ParentNode {
  return "children" in node;
}

export function isSvg(el: Element): boolean {
  return el.namespace === SVG_NAMESPACE;
}

export function isMathMl(el: Element): boolean {
  return el.namespace === MATHML_NAMESPACE;
}

/** True for SVG and MathML elements. */
export function isForeign(el: Element): boolean {
  return isSvg(el) || isMathMl(el);
}

/**
 * Attributes as written in the source. The parser stores `xlink:href` as
 * `href` plus a separate prefix, so the qualified name is put back together.
 */
export function attributeEntries(el: Element): Array<[string, string]> {
  const prefixes = el["x-attribsPrefix"];
  const entries: Array<[string, string]> = [];
  for (const name of Object.keys(el.attribs)) {
    const prefix = prefixes ? prefixes[name] : undefined;
    entries.push([prefix ? `${prefix}:${name}` : name, el.attribs[name]]);
  }
  return entries;
}

/** Concatenated text of a node and its descendants. */
export function textContent(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isParent(node)) return "";
  let text = "";
  for (const child of node.children) text += textContent(child);
  return text;
}

/** Collapses runs of HTML whitespace (which excludes no-break spaces) to one space. */
export function collapseWhitespace(text: string): string {
  return text.replace(/[ \t\n\f\r]+/g, " ");
}

export function isBlank(text: string): boolean {
  return !/[^ \t\n\f\r]/.test(text);
}

/** Matches `javascript:` URLs the way browsers do, ignoring embedded whitespace. */
export function isJavascriptUrl(value: string): boolean {
  let compact = "";
  for (const ch of value.slice(0, 64)) {
    if (ch > " ") compact += ch;
  }
  return compact.toLowerCase().startsWith("javascript:");
}

/** Attributes whose `javascript:` URLs would run script when followed or loaded. */
const SCRIPTABLE_URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "action",
  "data",
  "formaction",
  "href",
  "src",
  "xlink:href",
]);

/** Replaces a `javascript:` URL in a (lowercase) attribute with a harmless one. */
export function sanitizeUrl(name: string, value: string): string {
  if (!SCRIPTABLE_URL_ATTRIBUTES.has(name) || !isJavascriptUrl(value)) return value;
  return name === "src" || name === "data" ? "about:blank" : "#";
}

/** Four-digit hexadecimal form of a UTF-16 code unit. */
function hex4(code: number): string {
  return code.toString(16).padStart(4, "0");
}

/**
 * A regular expression character class for inclusive code unit ranges. The
 * class is assembled from numbers so that this source file stays plain ASCII.
 */
export function characterClass(
  ranges: ReadonlyArray<readonly [number, number]>,
): string {
  const backslash = String.fromCharCode(0x5c);
  const unit = (code: number): string => `${backslash}u${hex4(code)}`;
  const parts = ranges.map(([from, to]) =>
    from === to ? unit(from) : `${unit(from)}-${unit(to)}`,
  );
  return `[${parts.join("")}]`;
}

/**
 * Characters that are invisible or easily lost in source code and are
 * therefore written as escapes: DEL and the C1 controls, the no-break space,
 * the soft hyphen, the other Unicode spaces, zero-width and directional
 * marks, line and paragraph separators, and the byte order mark.
 */
const INVISIBLE_CLASS = characterClass([
  [0x7f, 0xa0],
  [0xad, 0xad],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
]);

/** Matches one invisible character. Stateless, so safe to share. */
export const INVISIBLE_CHARACTER = new RegExp(INVISIBLE_CLASS);

const INVISIBLE_CHARACTERS = new RegExp(INVISIBLE_CLASS, "g");

/** Replaces every invisible character using `escape`. */
export function escapeInvisible(
  text: string,
  escape: (code: number) => string,
): string {
  if (!INVISIBLE_CHARACTER.test(text)) return text;
  return text.replace(INVISIBLE_CHARACTERS, (ch) => escape(ch.charCodeAt(0)));
}

/** A double-quoted JavaScript string literal with invisible characters escaped. */
export function jsString(value: string): string {
  const backslash = String.fromCharCode(0x5c);
  return escapeInvisible(
    JSON.stringify(value),
    (code) => `${backslash}u${hex4(code)}`,
  );
}
