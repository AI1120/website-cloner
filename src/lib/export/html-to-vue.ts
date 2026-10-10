import type { AnyNode, Element } from "domhandler";

import {
  attributeEntries,
  BOOLEAN_ATTRIBUTES,
  escapeInvisible,
  isElement,
  isForeign,
  isParent,
  isText,
  jsString,
  sanitizeUrl,
  VOID_TAGS,
} from "./dom";
import {
  buildRootItems,
  isPreformatted,
  renderItems,
  type Dialect,
  type ElementContext,
  type ElementPlan,
} from "./layout";

export interface VueTemplateOptions {
  /** Indentation depth, in steps of two spaces, of the returned markup. */
  indent?: number;
}

/** Tags a template cannot hold, plus raw-text fallbacks for missing scripting. */
const DROPPED_TAGS: ReadonlySet<string> = new Set([
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
]);

/** Attributes Vue consumes itself instead of rendering them. */
const RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set(["key", "ref"]);

const VALID_TAG_NAME = /^[A-Za-z][\w.:-]*$/;
/** Rules out `@event`, `:bind`, `#slot` and `.prop` shorthands by their first character. */
const VALID_ATTRIBUTE_NAME = /^[A-Za-z_][\w.:-]*$/;
const DIRECTIVE_PREFIX = /^(?:v-|x-)/;

function escapeEntity(code: number): string {
  return code === 0xa0 ? "&nbsp;" : `&#x${code.toString(16)};`;
}

/** Escapes text for a template; `{{` is encoded so Vue does not interpolate it. */
function escapeText(text: string): string {
  const escaped = text.replace(/[&<>]|\{\{/g, (match) => {
    if (match === "&") return "&amp;";
    if (match === "<") return "&lt;";
    if (match === ">") return "&gt;";
    return "&#123;&#123;";
  });
  return escapeInvisible(escaped, escapeEntity);
}

/**
 * Writes text as an interpolated string literal, which Vue's whitespace
 * condensing does not touch. Characters with a meaning in templates are
 * written as escapes so the literal survives entity decoding.
 */
function interpolate(text: string): string {
  const literal = jsString(text).replace(
    /[&<>{}]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `{{ ${literal} }}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"]/g, (ch) => (ch === "&" ? "&amp;" : "&quot;"));
}

/** Writes the attributes of an element, each preceded by a space. */
function vueAttributes(el: Element): string {
  let out = "";
  for (const [name, rawValue] of attributeEntries(el)) {
    const lower = name.toLowerCase();
    if (/^on./.test(lower) || RESERVED_ATTRIBUTES.has(lower)) continue;
    if (!VALID_ATTRIBUTE_NAME.test(name) || DIRECTIVE_PREFIX.test(lower)) {
      continue;
    }
    const value = sanitizeUrl(lower, rawValue);
    out +=
      value === "" && BOOLEAN_ATTRIBUTES.has(lower)
        ? ` ${name}`
        : ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

function isVoid(el: Element): boolean {
  return !isForeign(el) && VOID_TAGS.has(el.name);
}

/**
 * Serializes an element whose whitespace must survive exactly, without adding
 * any line breaks or indentation. Vue only leaves literal text alone inside
 * `<pre>` and `<textarea>`; anywhere else the text goes into interpolations.
 */
function serializeExact(el: Element, literalText: boolean): string {
  const tag = el.name;
  const literal =
    literalText || (!isForeign(el) && (tag === "pre" || tag === "textarea"));
  const open = `<${tag}${vueAttributes(el)}>`;
  if (isVoid(el)) return open;

  let content = "";
  let pending = "";
  const flush = (): void => {
    if (pending === "") return;
    content += literal ? escapeText(pending) : interpolate(pending);
    pending = "";
  };
  const visit = (nodes: readonly AnyNode[]): void => {
    for (const node of nodes) {
      if (isText(node)) {
        pending += node.data;
      } else if (isElement(node)) {
        if (DROPPED_TAGS.has(node.name)) continue;
        if (!VALID_TAG_NAME.test(node.name)) {
          visit(node.children);
          continue;
        }
        flush();
        content += serializeExact(node, literal);
      } else if (isParent(node)) {
        visit(node.children);
      }
    }
  };
  visit(el.children);
  flush();

  // HTML parsers swallow one line break right after these opening tags.
  const lead =
    literal && (tag === "pre" || tag === "textarea") && content.startsWith("\n")
      ? "\n"
      : "";
  return `${open}${lead}${content}</${tag}>`;
}

const vueDialect: Dialect = {
  spaceMarker: '{{ " " }}',
  textBreakIsSpace: true,

  text: escapeText,
  exactText: interpolate,

  element(el: Element, context: ElementContext): ElementPlan {
    const tag = el.name;
    if (DROPPED_TAGS.has(tag)) return { kind: "drop" };
    if (!VALID_TAG_NAME.test(tag)) return { kind: "unwrap" };
    if (context.preformatted || isPreformatted(el)) {
      return { kind: "atom", text: serializeExact(el, false) };
    }

    const open = `<${tag}${vueAttributes(el)}`;
    if (isVoid(el)) return { kind: "atom", text: `${open}>` };
    // The content of an iframe is fallback text that browsers never render.
    if (tag === "iframe") return { kind: "atom", text: `${open}></${tag}>` };

    return {
      kind: "element",
      start: `${open}>`,
      end: `</${tag}>`,
      empty: isForeign(el) ? `${open} />` : `${open}></${tag}>`,
    };
  },
};

/**
 * Converts parsed HTML nodes to the content of a Vue `<template>` block.
 * Scripts, styles, `<noscript>`, comments, inline event handlers,
 * `javascript:` URLs and directive-like attributes are dropped.
 */
export function nodesToVueTemplate(
  nodes: readonly AnyNode[],
  options: VueTemplateOptions = {},
): string {
  const items = buildRootItems(nodes, vueDialect);
  return renderItems(items, options.indent ?? 0, vueDialect);
}
