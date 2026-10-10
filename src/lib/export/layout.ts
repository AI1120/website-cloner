import type { AnyNode, Element } from "domhandler";

import {
  collapseWhitespace,
  isElement,
  isForeign,
  isMathMl,
  isParent,
  isSvg,
  isText,
} from "./dom";

/** How a dialect wants one element written. */
export type ElementPlan =
  /** Leave the element and everything inside it out. */
  | { kind: "drop" }
  /** Leave the element out but keep its children in its place. */
  | { kind: "unwrap" }
  /** The element is already fully written; its children are not visited. */
  | { kind: "atom"; text: string }
  /** `start` and `end` wrap the children; `empty` is used when there are none. */
  | { kind: "element"; start: string; end: string; empty: string };

export interface ElementContext {
  /** True when an ancestor preserves whitespace (`<pre>` and friends). */
  preformatted: boolean;
}

/** The target syntax: JSX or a Vue template. */
export interface Dialect {
  /** Written where a significant space cannot be expressed as plain whitespace. */
  spaceMarker: string;
  /**
   * Whether a line break next to text is read back as a space. JSX removes
   * every line break; Vue removes it only between two elements.
   */
  textBreakIsSpace: boolean;
  /** Encodes whitespace-collapsed text that has no leading or trailing space. */
  text(value: string): string;
  /** Encodes text whose whitespace must survive exactly. */
  exactText(value: string): string;
  element(el: Element, context: ElementContext): ElementPlan;
}

interface NodeItem {
  kind: "node";
  start: string;
  end: string;
  children: Item[];
  /** Edge whitespace inside is insignificant and the element gets its own line. */
  block: boolean;
  /** Length when written on one line, or Infinity when that is not allowed. */
  inlineLength: number;
}

interface TextItem {
  kind: "text";
  text: string;
}

interface SpaceItem {
  kind: "space";
}

export type Item = NodeItem | TextItem | SpaceItem;

interface ParentTraits {
  block: boolean;
  preformatted: boolean;
  stripSpaces: boolean;
}

const SPACE: SpaceItem = { kind: "space" };
const MAX_INLINE_LENGTH = 100;

/**
 * Elements that lay out their content in their own box by default, so
 * whitespace at the start and end of their content never renders.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set(
  (
    "address article aside audio blockquote body button canvas caption center " +
    "dd details dialog dir div dl dt fieldset figcaption figure footer form " +
    "h1 h2 h3 h4 h5 h6 header hgroup hr html iframe legend li main menu nav " +
    "object ol optgroup option p pre search section select summary table " +
    "tbody td tfoot th thead tr ul video"
  ).split(" "),
);

/** HTML elements in which whitespace between child elements never renders. */
const STRIP_SPACE_TAGS: ReadonlySet<string> = new Set(
  (
    "audio colgroup datalist map optgroup picture select table tbody tfoot " +
    "thead tr video"
  ).split(" "),
);

/** SVG elements whose whitespace is part of rendered text. */
const SVG_TEXT_TAGS: ReadonlySet<string> = new Set(
  "a altGlyph desc foreignObject text textPath title tref tspan".split(" "),
);

/** MathML elements whose whitespace is part of rendered text. */
const MATHML_TEXT_TAGS: ReadonlySet<string> = new Set(
  "annotation annotation-xml mi mn mo ms mtext".split(" "),
);

const PREFORMATTED_TAGS: ReadonlySet<string> = new Set([
  "listing",
  "plaintext",
  "pre",
  "textarea",
  "xmp",
]);

const PREFORMATTED_STYLE =
  /white-space(?:-collapse)?\s*:\s*(?:pre|break-spaces)/i;

/** True when the element preserves the whitespace of its content. */
export function isPreformatted(el: Element): boolean {
  if (!isForeign(el) && PREFORMATTED_TAGS.has(el.name)) return true;
  const style = el.attribs.style;
  return style !== undefined && PREFORMATTED_STYLE.test(style);
}

function isBlock(el: Element): boolean {
  return !isForeign(el) && BLOCK_TAGS.has(el.name);
}

function stripsSpaces(el: Element): boolean {
  if (isSvg(el)) return !SVG_TEXT_TAGS.has(el.name);
  if (isMathMl(el)) return !MATHML_TEXT_TAGS.has(el.name);
  return STRIP_SPACE_TAGS.has(el.name);
}

function atom(text: string, block: boolean): NodeItem {
  return {
    kind: "node",
    start: text,
    end: "",
    children: [],
    block,
    inlineLength: text.includes("\n") ? Infinity : text.length,
  };
}

function toNodeItem(
  el: Element,
  plan: Extract<ElementPlan, { kind: "atom" | "element" }>,
  inheritedPreformatted: boolean,
  dialect: Dialect,
): NodeItem {
  const block = isBlock(el);
  if (plan.kind === "atom") return atom(plan.text, block);

  const children = buildItems(
    el.children,
    {
      block,
      preformatted: inheritedPreformatted || isPreformatted(el),
      stripSpaces: stripsSpaces(el),
    },
    dialect,
  );
  if (children.length === 0) return atom(plan.empty, block);

  let inlineLength = plan.start.length + plan.end.length;
  for (const child of children) {
    if (child.kind === "space") inlineLength += 1;
    else if (child.kind === "text") inlineLength += child.text.length;
    else inlineLength += child.block ? Infinity : child.inlineLength;
  }
  return {
    kind: "node",
    start: plan.start,
    end: plan.end,
    children,
    block,
    inlineLength,
  };
}

/**
 * Decides which whitespace survives. A space between two siblings is kept,
 * because it renders between inline and inline-block boxes. Whitespace at the
 * start or end of a parent is dropped, unless it belongs to text inside an
 * inline element (`<b>bold </b>next`) or is the element's only content.
 */
function normalizeSpaces(items: Item[], traits: ParentTraits): Item[] {
  const merged: Item[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (item.kind === "space" && last && last.kind === "space") continue;
    merged.push(item);
  }

  const result: Item[] = [];
  for (let i = 0; i < merged.length; i++) {
    const item = merged[i];
    if (item.kind !== "space") {
      result.push(item);
      continue;
    }
    const prev = i > 0 ? merged[i - 1] : undefined;
    const next = i + 1 < merged.length ? merged[i + 1] : undefined;
    const nearText = prev?.kind === "text" || next?.kind === "text";
    if (!prev && !next) {
      if (!traits.block && !traits.stripSpaces) result.push(item);
    } else if (!prev || !next) {
      if (!traits.block && nearText) result.push(item);
    } else if (!traits.stripSpaces || nearText) {
      result.push(item);
    }
  }
  return result;
}

function buildItems(
  nodes: readonly AnyNode[],
  traits: ParentTraits,
  dialect: Dialect,
): Item[] {
  const items: Item[] = [];
  const chunks: string[] = [];

  const flush = (): void => {
    if (chunks.length === 0) return;
    const raw = chunks.join("");
    chunks.length = 0;
    if (raw === "") return;
    if (traits.preformatted) {
      items.push({ kind: "text", text: dialect.exactText(raw) });
      return;
    }
    const text = collapseWhitespace(raw);
    if (text === " ") {
      items.push(SPACE);
      return;
    }
    const lead = text.startsWith(" ");
    const trail = text.endsWith(" ");
    if (lead) items.push(SPACE);
    items.push({
      kind: "text",
      text: dialect.text(
        text.slice(lead ? 1 : 0, trail ? text.length - 1 : text.length),
      ),
    });
    if (trail) items.push(SPACE);
  };

  const visit = (list: readonly AnyNode[]): void => {
    for (const node of list) {
      if (isText(node)) {
        chunks.push(node.data);
      } else if (isElement(node)) {
        const plan = dialect.element(node, {
          preformatted: traits.preformatted,
        });
        if (plan.kind === "drop") continue;
        if (plan.kind === "unwrap") {
          visit(node.children);
          continue;
        }
        flush();
        items.push(toNodeItem(node, plan, traits.preformatted, dialect));
      } else if (isParent(node)) {
        // The content of a <template> and CDATA sections; comments are dropped.
        visit(node.children);
      }
    }
  };

  visit(nodes);
  flush();
  return traits.preformatted ? items : normalizeSpaces(items, traits);
}

class LineWriter {
  private readonly lines: string[] = [];
  private readonly indents: string[] = [""];

  /** Indentation depth of the line currently being written. */
  depth = 0;

  line(depth: number, text: string): void {
    while (this.indents.length <= depth) {
      this.indents.push(`${this.indents[this.indents.length - 1]}  `);
    }
    this.lines.push(this.indents[depth] + text);
    this.depth = depth;
  }

  append(text: string): void {
    if (this.lines.length === 0) this.line(0, text);
    else this.lines[this.lines.length - 1] += text;
  }

  toString(): string {
    return this.lines.join("\n");
  }
}

function inlineText(node: NodeItem, dialect: Dialect): string {
  let out = node.start;
  const single = node.children.length === 1;
  for (const child of node.children) {
    if (child.kind === "space") out += single ? dialect.spaceMarker : " ";
    else if (child.kind === "text") out += child.text;
    else out += inlineText(child, dialect);
  }
  return out + node.end;
}

function writeNode(
  node: NodeItem,
  depth: number,
  glue: boolean,
  writer: LineWriter,
  dialect: Dialect,
): void {
  const fitsOneLine =
    node.children.length === 0 || node.inlineLength <= MAX_INLINE_LENGTH;
  const first = fitsOneLine ? inlineText(node, dialect) : node.start;
  if (glue) writer.append(first);
  else writer.line(depth, first);
  if (fitsOneLine) return;

  const base = writer.depth;
  const glueEnd = writeChildren(
    node.children,
    base + 1,
    node.block,
    writer,
    dialect,
  );
  if (glueEnd) writer.append(node.end);
  else writer.line(base, node.end);
}

/**
 * Writes siblings one per line. Returns true when the parent's closing tag has
 * to follow the last child directly, without a line break in between.
 */
function writeChildren(
  items: readonly Item[],
  depth: number,
  parentIsBlock: boolean,
  writer: LineWriter,
  dialect: Dialect,
): boolean {
  let prev: NodeItem | TextItem | null = null;
  let spaceBefore = false;

  for (const item of items) {
    if (item.kind === "space") {
      spaceBefore = true;
      continue;
    }
    // A line break here would be read back as a space.
    const breakIsSpace =
      dialect.textBreakIsSpace &&
      (item.kind === "text" || (prev !== null && prev.kind === "text"));
    let glue = false;
    if (prev === null) {
      if (spaceBefore) {
        if (!breakIsSpace) writer.line(depth, dialect.spaceMarker);
      } else {
        glue = breakIsSpace && !parentIsBlock;
      }
    } else if (spaceBefore) {
      if (!breakIsSpace) writer.append(dialect.spaceMarker);
    } else {
      glue = breakIsSpace;
    }

    if (item.kind === "node") writeNode(item, depth, glue, writer, dialect);
    else if (glue) writer.append(item.text);
    else writer.line(depth, item.text);

    prev = item;
    spaceBefore = false;
  }

  if (prev === null) {
    if (spaceBefore) writer.line(depth, dialect.spaceMarker);
    return false;
  }
  const breakIsSpace = dialect.textBreakIsSpace && prev.kind === "text";
  if (spaceBefore) {
    if (!breakIsSpace) writer.append(dialect.spaceMarker);
    return false;
  }
  return breakIsSpace && !parentIsBlock;
}

/** Converts top-level nodes (the content of `<body>`) to layout items. */
export function buildRootItems(
  nodes: readonly AnyNode[],
  dialect: Dialect,
): Item[] {
  return buildItems(
    nodes,
    { block: true, preformatted: false, stripSpaces: false },
    dialect,
  );
}

/** True when the items are exactly one element and nothing else. */
export function isSingleElement(items: readonly Item[]): boolean {
  return items.length === 1 && items[0].kind === "node";
}

/** Writes items as indented source, `depth` levels (of two spaces) deep. */
export function renderItems(
  items: readonly Item[],
  depth: number,
  dialect: Dialect,
): string {
  const writer = new LineWriter();
  writeChildren(items, depth, true, writer, dialect);
  return writer.toString();
}
