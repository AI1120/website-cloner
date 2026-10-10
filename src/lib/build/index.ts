import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { buildReactApp, renderReactIndex } from "@/lib/build/react";
import {
  compileTailwind,
  DEFAULT_TAILWIND_INPUT,
  type TailwindSource,
} from "@/lib/build/tailwind";
import {
  buildDir,
  copyDirectory,
  pathExists,
  readJson,
  remove,
  siteDir,
  writeJson,
} from "@/lib/cloner/storage";
import type { BuildMessage, Project } from "@/types/project";

/** Tailwind input of an HTML project, at the site root. */
export const TAILWIND_INPUT_FILE = "tailwind.config.css";
/** Compiled stylesheet of an HTML project. Derived; never edited by hand. */
export const TAILWIND_OUTPUT_FILE = "assets/css/tailwind.css";

const GENERATED_NOTE = `/* Generated from ${TAILWIND_INPUT_FILE} and the classes used in the pages. Changes made here are overwritten. */\n`;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

export interface BuildStatus {
  ok: boolean;
  errors: BuildMessage[];
  /** Identifies the state of the source files the output was built from. */
  fingerprint: string;
}

/** Thrown when a project can't be turned into a site because it doesn't build. */
export class BuildFailedError extends Error {
  readonly errors: BuildMessage[];

  constructor(errors: BuildMessage[]) {
    super("The project does not build.");
    this.name = "BuildFailedError";
    this.errors = errors;
  }
}

export function needsBuild(project: Project): boolean {
  return project.framework === "react" || project.styling === "tailwind";
}

/** Short text of build errors, for the AI or a log. */
export function describeBuildErrors(errors: BuildMessage[]): string {
  return errors
    .map((error) => {
      const where = error.file
        ? `${error.file}${error.line ? `:${error.line}${error.column ? `:${error.column}` : ""}` : ""}: `
        : "";
      return `${where}${error.text}`;
    })
    .join("\n");
}

interface TreeFile {
  relative: string;
  absolute: string;
  size: number;
  modified: number;
}

async function listTree(root: string): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(absolute, relative);
        } else if (entry.isFile()) {
          const stats = await fs.stat(absolute);
          files.push({ relative, absolute, size: stats.size, modified: Math.round(stats.mtimeMs) });
        }
      }),
    );
  };
  await visit(root, "");
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function fingerprintOf(files: TreeFile[]): string {
  const hash = createHash("sha1");
  for (const file of files) {
    if (file.relative === TAILWIND_OUTPUT_FILE) continue;
    hash.update(`${file.relative}:${file.size}:${file.modified}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

function statusPath(projectId: string): string {
  return path.join(buildDir(projectId), "status.json");
}

function previewOutputDir(projectId: string): string {
  return path.join(buildDir(projectId), "preview");
}

/** Compiles the Tailwind stylesheet of an HTML site from its config and pages. */
async function compileHtmlStyles(root: string, files: TreeFile[]): Promise<string> {
  const inputFile = path.join(root, TAILWIND_INPUT_FILE);
  const input = (await pathExists(inputFile))
    ? await fs.readFile(inputFile, "utf8")
    : DEFAULT_TAILWIND_INPUT;

  const sources: TailwindSource[] = await Promise.all(
    files
      .filter((file) => /\.(?:html?|m?js)$/i.test(file.relative) && file.size < 2 * 1024 * 1024)
      .map(async (file) => ({
        content: await fs.readFile(file.absolute, "utf8"),
        extension: path.extname(file.relative).slice(1),
      })),
  );
  return GENERATED_NOTE + (await compileTailwind(input, sources));
}

async function buildHtmlStyles(root: string, files: TreeFile[]): Promise<BuildMessage[]> {
  try {
    const css = await compileHtmlStyles(root, files);
    const output = path.join(root, ...TAILWIND_OUTPUT_FILE.split("/"));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, css, "utf8");
    return [];
  } catch (error) {
    return [
      {
        text: `Tailwind: ${error instanceof Error ? error.message : String(error)}`,
        file: TAILWIND_INPUT_FILE,
        line: null,
        column: null,
      },
    ];
  }
}

const stylesheetCache = new Map<string, { fingerprint: string; css: string }>();

/**
 * The compiled Tailwind stylesheet of an HTML site that is read-only on disk
 * (a built-in template), kept in memory instead of written next to it.
 */
export async function compiledStylesheet(root: string): Promise<string> {
  const files = await listTree(root);
  const fingerprint = fingerprintOf(files);
  const cached = stylesheetCache.get(root);
  if (cached && cached.fingerprint === fingerprint) return cached.css;
  const css = await compileHtmlStyles(root, files);
  stylesheetCache.set(root, { fingerprint, css });
  return css;
}

async function buildNow(project: Project): Promise<BuildStatus> {
  const root = siteDir(project.id);
  const files = await listTree(root);
  const fingerprint = fingerprintOf(files);

  const previous = await readJson<BuildStatus>(statusPath(project.id));
  if (previous && previous.fingerprint === fingerprint) {
    const outputReady =
      project.framework === "react"
        ? !previous.ok || (await pathExists(path.join(previewOutputDir(project.id), "app.js")))
        : await pathExists(path.join(root, ...TAILWIND_OUTPUT_FILE.split("/")));
    if (outputReady) return previous;
  }

  let errors: BuildMessage[];
  if (project.framework === "react") {
    const result = await buildReactApp(root, "preview");
    if (result.ok) {
      const output = previewOutputDir(project.id);
      await fs.mkdir(output, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(output, "app.js"), result.js, "utf8"),
        fs.writeFile(path.join(output, "app.css"), result.css, "utf8"),
      ]);
      errors = [];
    } else {
      errors = result.errors;
    }
  } else {
    errors = await buildHtmlStyles(root, files);
  }

  const status: BuildStatus = { ok: errors.length === 0, errors, fingerprint };
  await writeJson(statusPath(project.id), status);
  return status;
}

// One build per project at a time; requests that arrive meanwhile share it.
const globalState = globalThis as typeof globalThis & {
  __clonerBuilds?: Map<string, Promise<BuildStatus>>;
};
const running = (globalState.__clonerBuilds ??= new Map<string, Promise<BuildStatus>>());

/**
 * Brings a project's generated output up to date with its source files and
 * reports whether it builds. Cheap when nothing changed.
 */
export function ensureBuilt(project: Project): Promise<BuildStatus> {
  if (!needsBuild(project)) {
    return Promise.resolve({ ok: true, errors: [], fingerprint: "" });
  }
  const existing = running.get(project.id);
  if (existing) return existing;
  const build = buildNow(project).finally(() => running.delete(project.id));
  running.set(project.id, build);
  return build;
}

/** Reads a file of a React project's preview bundle ("app.js" or "app.css"). */
export async function readPreviewOutput(projectId: string, name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(previewOutputDir(projectId), name), "utf8");
  } catch {
    return null;
  }
}

/**
 * Adds what a page needs from this app at run time: the address of the
 * project's data API, and in the editor the bridge that lets the workspace
 * talk to the page.
 */
export function injectRuntime(html: string, projectId: string, withBridge: boolean): string {
  const scripts =
    `<script>window.SC_DATA_URL=${JSON.stringify(`/api/data/${projectId}`)};</script>` +
    (withBridge ? '<script src="/sc-bridge.js"></script>' : "");
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + scripts + html.slice(at);
  }
  const root = /<html\b[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return html.slice(0, at) + scripts + html.slice(at);
  }
  return scripts + html;
}

/**
 * Writes the finished, static site of a project into `outDir`: what gets
 * published, and what a plain HTML export contains.
 */
export async function materialize(project: Project, outDir: string): Promise<void> {
  const root = siteDir(project.id);

  if (project.framework === "react") {
    const result = await buildReactApp(root, "production");
    if (!result.ok) throw new BuildFailedError(result.errors);

    await remove(outDir);
    const publicDir = path.join(root, "public");
    if (await pathExists(publicDir)) await fs.cp(publicDir, outDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const index = await fs.readFile(path.join(root, "index.html"), "utf8");
    const page = injectRuntime(renderReactIndex(index, "app.js", "app.css"), project.id, false);
    await Promise.all([
      fs.writeFile(path.join(outDir, "index.html"), page, "utf8"),
      fs.writeFile(path.join(outDir, "app.js"), result.js, "utf8"),
      fs.writeFile(path.join(outDir, "app.css"), result.css, "utf8"),
    ]);
    return;
  }

  const status = await ensureBuilt(project);
  if (!status.ok) throw new BuildFailedError(status.errors);
  await copyDirectory(root, outDir);

  // Copies of other sites are published exactly as they are in the editor.
  if (project.source === "clone") return;
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
      .map(async (entry) => {
        const file = path.join(outDir, entry.name);
        await fs.writeFile(file, injectRuntime(await fs.readFile(file, "utf8"), project.id, false));
      }),
  );
}
