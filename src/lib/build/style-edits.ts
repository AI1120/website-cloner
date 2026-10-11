import fs from "node:fs/promises";

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { editJsxStyle } from "@/lib/build/jsx";
import { ChangeRecorder, MAX_TEXT_FILE_BYTES } from "@/lib/cloner/checkpoints";
import { resolveInside, siteDir } from "@/lib/cloner/storage";
import type { Project, StyleEdit } from "@/types/project";

/**
 * Saves style changes made in the visual inspector into the project's files:
 * the element's `style` attribute in an HTML page, or its `style={{ … }}` prop in
 * JSX. Only the properties the inspector offers are accepted, with values made
 * of plain characters, so nothing else can be written into a page this way.
 */

export const INSPECTOR_PROPERTIES = [
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
] as const;

const ALLOWED: ReadonlySet<string> = new Set(INSPECTOR_PROPERTIES);
/** Colours (#hex, rgb()), lengths, numbers, keywords; no quotes, semicolons, braces or url(). */
const SAFE_VALUE = /^(?!.*url\s*\()(?!.*expression)[#a-zA-Z0-9.%(),\s/-]{1,60}$/;

/** The accepted changes, or null when any of them isn't allowed. */
export function cleanStyleChanges(input: unknown): Record<string, string | null> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const changes: Record<string, string | null> = {};
  for (const [property, value] of Object.entries(input)) {
    if (!ALLOWED.has(property)) return null;
    if (value === null || value === "") {
      changes[property] = null;
    } else if (typeof value === "string" && SAFE_VALUE.test(value.trim())) {
      changes[property] = value.trim();
    } else {
      return null;
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Splits a style attribute into its declarations, keeping their order. */
function parseStyleAttribute(style: string): [string, string][] {
  const declarations: [string, string][] = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const at = current.indexOf(":");
    if (at > 0) declarations.push([current.slice(0, at).trim().toLowerCase(), current.slice(at + 1).trim()]);
    current = "";
  };
  for (const ch of style) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) flush();
    else current += ch;
  }
  flush();
  return declarations;
}

export function mergeStyleAttribute(existing: string, changes: Record<string, string | null>): string {
  const declarations = parseStyleAttribute(existing).filter(([property]) => !(property in changes));
  for (const [property, value] of Object.entries(changes)) {
    if (value !== null) declarations.push([property, value]);
  }
  return declarations.map(([property, value]) => `${property}: ${value}`).join("; ");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

async function readSource(project: Project, file: string): Promise<string | null> {
  const target = resolveInside(siteDir(project.id), file);
  if (!target) return null;
  try {
    const stats = await fs.stat(target);
    if (stats.size > MAX_TEXT_FILE_BYTES) return null;
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

function editHtmlStyle(source: string, path: number[], changes: Record<string, string | null>): string | null {
  const $ = cheerio.load(source, { sourceCodeLocationInfo: true });
  let element: Element | undefined = $("body").get(0);
  for (const index of path) {
    element = element?.children.filter(isElement)[index];
    if (!element) return null;
  }
  const startTag = element?.sourceCodeLocation?.startTag;
  if (!element || path.length === 0 || !startTag) return null;

  const merged = mergeStyleAttribute(element.attribs.style ?? "", changes).replace(/"/g, "&quot;");
  const attribute = merged ? `style="${merged}"` : "";
  // parse5 records where each attribute is; cheerio's types leave that out.
  const attrs = (element.sourceCodeLocation as { attrs?: Record<string, { startOffset: number; endOffset: number }> })
    .attrs;
  const existing = attrs?.style;
  if (existing) {
    // Removing the attribute also removes the space before it.
    const start = attribute ? existing.startOffset : Math.max(startTag.startOffset, existing.startOffset - 1);
    return source.slice(0, start) + attribute + source.slice(existing.endOffset);
  }
  if (!attribute) return source;
  const tag = source.slice(startTag.startOffset, startTag.endOffset);
  const at = startTag.endOffset - (tag.endsWith("/>") ? 2 : 1);
  return `${source.slice(0, at)} ${attribute}${source.slice(at)}`;
}

/** Applies one inspector change; returns the recorder holding it, or a reason it couldn't be saved. */
export async function applyStyleEdit(project: Project, edit: StyleEdit): Promise<ChangeRecorder | string> {
  const recorder = new ChangeRecorder(project.id, `Changed the style of a ${edit.tag || "element"}`);
  const loc = edit.loc ? /^(.+):(\d+):(\d+)$/.exec(edit.loc) : null;

  if (project.framework === "react") {
    if (!loc) return "This element isn't written in the project's code, so it can't be styled here. Ask the AI instead.";
    const [, file, line, column] = loc;
    const source = await readSource(project, file);
    const updated = source === null ? null : editJsxStyle(source, file, Number(line), Number(column), edit.styles);
    if (updated === null) return "The element couldn't be found in its file. Reload the preview and try again.";
    await recorder.write(file, updated);
    return recorder;
  }

  const file = edit.page.split("#")[0];
  if (!/\.html?$/i.test(file)) return "Only pages can be styled here.";
  const source = await readSource(project, file);
  const updated = source === null ? null : editHtmlStyle(source, edit.path, edit.styles);
  if (updated === null) {
    return "This element was added by the page's scripts, so it isn't in the file. Ask the AI to change it instead.";
  }
  await recorder.write(file, updated);
  return recorder;
}
