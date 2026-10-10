import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";

import { editJsxText, editUniqueText, isScriptFile, normalizeText, type SourceText } from "@/lib/build/jsx";
import { ChangeRecorder, MAX_TEXT_FILE_BYTES } from "@/lib/cloner/checkpoints";
import { resolveInside, siteDir } from "@/lib/cloner/storage";
import type { Project, TextEdit } from "@/types/project";

export interface TextEditOutcome {
  applied: number;
  /** Edits whose text could not be found in the source. */
  failed: TextEdit[];
  recorder: ChangeRecorder;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function ownTextNodes(element: Element): Text[] {
  return element.children.filter(
    (child): child is Text => child.type === "text" && child.data.trim() !== "",
  );
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

/** Finds where in the HTML source one edit's text sits. */
function locateInHtml($: cheerio.CheerioAPI, source: string, edit: TextEdit): Splice | null {
  const wanted = normalizeText(edit.before);
  const body = $("body").get(0);

  const candidates: Text[] = [];
  let element: Element | undefined = body;
  for (const index of edit.path) {
    element = element?.children.filter(isElement)[index];
    if (!element) break;
  }
  const byPath = element && element !== body ? ownTextNodes(element)[edit.index] : undefined;
  if (byPath && normalizeText(byPath.data) === wanted) {
    candidates.push(byPath);
  } else {
    // The page in the browser didn't match the file (a script changed it, say):
    // fall back to the text itself, if it is unambiguous.
    $("body *").each((_, node) => {
      if (!isElement(node) || node.name === "script" || node.name === "style") return;
      for (const text of ownTextNodes(node)) {
        if (normalizeText(text.data) === wanted) candidates.push(text);
      }
    });
  }
  if (candidates.length !== 1) return null;

  const location = candidates[0].sourceCodeLocation;
  if (!location) return null;
  const raw = source.slice(location.startOffset, location.endOffset);
  const leading = /^\s*/.exec(raw)?.[0] ?? "";
  const trailing = /\s*$/.exec(raw)?.[0] ?? "";
  return {
    start: location.startOffset,
    end: location.endOffset,
    text: `${leading}${escapeHtml(edit.after)}${trailing}`,
  };
}

async function editHtmlPage(
  project: Project,
  page: string,
  edits: TextEdit[],
  outcome: TextEditOutcome,
): Promise<void> {
  const file = page.split("#")[0];
  const target = /\.html?$/i.test(file) ? resolveInside(siteDir(project.id), file) : null;
  let source: string;
  try {
    if (!target) throw new Error("not a page");
    const stats = await fs.stat(target);
    if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error("too large");
    source = await fs.readFile(target, "utf8");
  } catch {
    outcome.failed.push(...edits);
    return;
  }

  const $ = cheerio.load(source, { sourceCodeLocationInfo: true });
  const splices: Splice[] = [];
  for (const edit of edits) {
    const splice = locateInHtml($, source, edit);
    if (splice && !splices.some((other) => splice.start < other.end && other.start < splice.end)) {
      splices.push(splice);
    } else {
      outcome.failed.push(edit);
    }
  }
  if (splices.length === 0) return;

  let updated = source;
  for (const splice of splices.sort((a, b) => b.start - a.start)) {
    updated = updated.slice(0, splice.start) + splice.text + updated.slice(splice.end);
  }
  await outcome.recorder.write(file, updated);
  outcome.applied += splices.length;
}

function parseLoc(loc: string | null): { file: string; line: number; column: number } | null {
  const match = loc ? /^(.+):(\d+):(\d+)$/.exec(loc) : null;
  if (!match) return null;
  return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
}

async function readScripts(root: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative);
      } else if (isScriptFile(entry.name)) {
        sources.set(relative, await fs.readFile(path.join(directory, entry.name), "utf8"));
      }
    }
  };
  await visit(path.join(root, "src"), "src");
  return sources;
}

async function editReactSources(
  project: Project,
  edits: TextEdit[],
  outcome: TextEditOutcome,
): Promise<void> {
  const sources = await readScripts(siteDir(project.id));
  const changed = new Set<string>();

  // Later positions first, so an edit doesn't move the ones still to come.
  const ordered = [...edits].sort((a, b) => {
    const first = parseLoc(a.loc);
    const second = parseLoc(b.loc);
    if (!first || !second || first.file !== second.file) return 0;
    return second.line - first.line || second.column - first.column;
  });

  for (const edit of ordered) {
    const loc = parseLoc(edit.loc);
    const current = loc ? sources.get(loc.file) : undefined;
    const direct =
      loc && current !== undefined
        ? editJsxText(current, loc.file, loc.line, loc.column, edit.before, edit.after)
        : null;
    if (loc && direct !== null) {
      sources.set(loc.file, direct);
      changed.add(loc.file);
      outcome.applied += 1;
      continue;
    }

    // The words come from somewhere else (a list of data, a prop): find them
    // wherever they are written, as long as that is exactly one place.
    const files: SourceText[] = [...sources].map(([file, source]) => ({ path: file, source }));
    const found = editUniqueText(files, edit.before, edit.after);
    if (found) {
      sources.set(found.path, found.source);
      changed.add(found.path);
      outcome.applied += 1;
    } else {
      outcome.failed.push(edit);
    }
  }

  for (const file of changed) {
    const source = sources.get(file);
    if (source !== undefined) await outcome.recorder.write(file, source);
  }
}

/**
 * Writes text changes made in the preview back into the project's files.
 * Changes are recorded on the returned recorder; the caller commits it.
 */
export async function applyTextEdits(
  project: Project,
  page: string,
  edits: TextEdit[],
): Promise<TextEditOutcome> {
  const outcome: TextEditOutcome = {
    applied: 0,
    failed: [],
    recorder: new ChangeRecorder(project.id, "Edited text in the preview"),
  };
  if (project.framework === "react") {
    await editReactSources(project, edits, outcome);
  } else {
    await editHtmlPage(project, page, edits, outcome);
  }
  return outcome;
}
