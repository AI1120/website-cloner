import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import type { AnyNode, ChildNode, Element } from "domhandler";

import type { Project } from "@/types/project";

import {
  characterClass,
  collapseWhitespace,
  isBlank,
  isElement,
  isJavascriptUrl,
  isParent,
  isText,
  textContent,
} from "./dom";

/** Path inside the exported project (forward slashes) mapped to file content. */
export type ExportFiles = Record<string, Uint8Array>;

/** One cloned page and the names derived from its file name. */
export interface ExportPage {
  /** File name in the site folder and in the export, e.g. "about-us.html". */
  path: string;
  /** Source URL, or an empty string when the project does not list the page. */
  url: string;
  title: string;
  /** Identifier of the page component, e.g. "AboutUs". */
  componentName: string;
  /** Base name of the entry module, e.g. "about-us". */
  entryName: string;
  html: string;
}

/** A page split into its HTML entry file and the body content to convert. */
export interface PreparedPage {
  /** The page with its `<head>` kept and its body replaced by a mount element. */
  html: string;
  /** Cleaned body content, detached from the document. */
  bodyNodes: ChildNode[];
  /** Id of the mount element; differs from the requested one if that was taken. */
  mountId: string;
  /** Text of the page's `<title>`. */
  title: string;
}

export interface PrepareOptions {
  /** File names of all exported pages, used to recognize links between them. */
  pagePaths: ReadonlySet<string>;
  /** Site-relative paths of all asset files, e.g. "assets/css/main.css". */
  assetPaths: ReadonlySet<string>;
  /** Preferred id of the mount element. */
  mountId: string;
  /** Root-absolute URL of the module that mounts the page component. */
  entrySrc: string;
}

/** What differs between the React and the Vue export. */
export interface ExportTarget {
  label: string;
  /** Suffix of the package name, e.g. "react". */
  slug: string;
  mountId: string;
  componentExtension: string;
  entryExtension: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** README bullet points describing framework-specific conversions. */
  notes: string[];
  renderComponent(page: ExportPage, bodyNodes: readonly ChildNode[]): string;
  renderEntry(page: ExportPage, mountId: string): string;
  renderViteConfig(inputs: string): string;
}

const NODE_ENGINES = "^20.19.0 || >=22.12.0";
const READ_CONCURRENCY = 32;
/** Folder Vite serves from the site root; it holds the copied `assets` tree. */
const PUBLIC_PREFIX = "public/";
const PAGE_FILE = /^[^/\\]+\.html?$/i;

const LOCAL_ASSET = /^\s*(?:\.\/)?assets\//;
/** Stricter form for attributes that are not known to hold URLs. */
const LOCAL_ASSET_STRICT = /^(?:\.\/)?assets\/(?:css|js|img|fonts|media|other)\//;
const SRCSET_CANDIDATE = /(^|[\s,])(?:\.\/)?(?=assets\/)/g;
const CSS_URL = /url\(\s*(["']?)(?:\.\/)?(?=assets\/)/gi;
const CSS_IMPORT = /(@import\s+["'])(?:\.\/)?(?=assets\/)/gi;
/** A whole `@import` rule for a local file; the file path is captured. */
const CSS_LOCAL_IMPORT =
  /@import\s+(?:url\(\s*)?["']?(?:\.\/)?(assets\/[^"')\s;]+)["']?\s*\)?[^;{}]*;?/gi;
const NOSCRIPT_URL = /((?:href|src|srcset)\s*=\s*["']?)(?:\.\/)?(?=assets\/)/gi;

/** Attributes that hold one URL and may therefore link to another page. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "action",
  "background",
  "data",
  "data-href",
  "data-url",
  "formaction",
  "href",
  "poster",
  "src",
]);

/** Attributes holding prose, never URLs. */
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "alt",
  "class",
  "id",
  "placeholder",
  "title",
  "value",
]);

/** Names that would shadow something a page component or its entry relies on. */
const RESERVED_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  (
    "Array Boolean Component Date Error Fragment Function Infinity JSON " +
    "KeepAlive Map Math NaN Number Object Promise Proxy React Reflect RegExp " +
    "Set Slot StrictMode String Suspense Symbol Teleport Template Transition " +
    "TransitionGroup Vue"
  ).split(" "),
);

/** Accents left behind once a letter is decomposed (U+0300 to U+036F). */
const COMBINING_MARKS = new RegExp(characterClass([[0x300, 0x36f]]), "g");
const BYTE_ORDER_MARK = 0xfeff;

const encoder = new TextEncoder();

function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Reads every file below `siteDir/assets`, keyed by its export path. */
async function collectAssets(siteDir: string): Promise<ExportFiles> {
  const found: Array<{ key: string; file: string }> = [];
  const pending: Array<{ key: string; dir: string }> = [
    { key: `${PUBLIC_PREFIX}assets`, dir: path.join(siteDir, "assets") },
  ];
  for (let current = pending.pop(); current; current = pending.pop()) {
    const entries = await readdir(current.dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const key = `${current.key}/${entry.name}`;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) pending.push({ key, dir: full });
      else if (entry.isFile()) found.push({ key, file: full });
    }
  }
  found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const contents = await mapLimit(found, READ_CONCURRENCY, (item) =>
    readFile(item.file),
  );
  const files: ExportFiles = {};
  found.forEach((item, index) => {
    files[item.key] = contents[index];
  });
  return files;
}

function uniqueName(
  base: string,
  used: Set<string>,
  join: (base: string, n: number) => string,
): string {
  // File names must stay distinct on case-insensitive file systems too.
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = join(base, n);
  used.add(name.toLowerCase());
  return name;
}

/**
 * Derives a component name from a page file name: `index.html` is `Home`,
 * `about-us.html` is `AboutUs`, `404.html` is `Page404`.
 */
function toComponentName(fileName: string): string {
  const base = fileName.replace(/\.html?$/i, "");
  if (base.toLowerCase() === "index") return "Home";
  const words = base
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  if (name === "") name = "Page";
  if (/^\d/.test(name)) name = `Page${name}`;
  if (RESERVED_COMPONENT_NAMES.has(name)) name = `${name}Page`;
  return name;
}

function toEntryName(fileName: string): string {
  const base = fileName.replace(/\.html?$/i, "");
  const name = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return name === "" ? "page" : name;
}

function normalizePagePath(pagePath: string): string {
  return pagePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Lists the pages to export: those the project knows about, in its order,
 * followed by any other HTML file found in the site folder.
 */
async function loadPages(
  siteDir: string,
  project: Project,
): Promise<ExportPage[]> {
  const entries = await readdir(siteDir, { withFileTypes: true });
  const onDisk = new Set<string>();
  for (const entry of entries) {
    if (entry.isFile() && PAGE_FILE.test(entry.name)) onDisk.add(entry.name);
  }

  const listed: Array<{ path: string; url: string; title: string }> = [];
  const seen = new Set<string>();
  const add = (pagePath: string, url: string, title: string): void => {
    const normalized = normalizePagePath(pagePath);
    if (seen.has(normalized) || !onDisk.has(normalized)) return;
    seen.add(normalized);
    listed.push({ path: normalized, url, title });
  };
  for (const page of project.pages) add(page.path, page.url, page.title);
  add(project.entry, project.finalUrl || project.url, "");
  for (const name of [...onDisk].sort()) add(name, "", "");

  if (listed.length === 0) {
    throw new Error(`No HTML pages found in ${siteDir}`);
  }

  const sources = await mapLimit(listed, READ_CONCURRENCY, (page) =>
    readFile(path.join(siteDir, page.path), "utf8"),
  );
  const componentNames = new Set<string>();
  const entryNames = new Set<string>();
  return listed.map((page, index) => ({
    ...page,
    html: stripByteOrderMark(sources[index]),
    componentName: uniqueName(
      toComponentName(page.path),
      componentNames,
      (base, n) => `${base}${n}`,
    ),
    entryName: uniqueName(
      toEntryName(page.path),
      entryNames,
      (base, n) => `${base}-${n}`,
    ),
  }));
}

function rewriteCssUrls(css: string): string {
  if (!css.includes("assets/")) return css;
  return css.replace(CSS_URL, "url($1/").replace(CSS_IMPORT, "$1/");
}

function hasAsset(url: string, assetPaths: ReadonlySet<string>): boolean {
  const file = url.replace(/[?#].*$/, "");
  if (assetPaths.has(file)) return true;
  try {
    return assetPaths.has(decodeURIComponent(file));
  } catch {
    return false;
  }
}

/**
 * Rewrites the URLs in the content of a `<style>` element. Vite inlines local
 * `@import`s when it builds a page and fails if the file does not exist, so
 * imports of missing files (which could never load anyway) are removed.
 */
function rewriteStyleSheet(
  css: string,
  assetPaths: ReadonlySet<string>,
): string {
  if (!css.includes("assets/")) return css;
  const kept = css.replace(CSS_LOCAL_IMPORT, (rule: string, file: string) =>
    hasAsset(file, assetPaths) ? rule : "",
  );
  return rewriteCssUrls(kept);
}

/** Makes one URL root-absolute if it points at a local asset or a cloned page. */
function rewriteUrl(
  value: string,
  pagePaths: ReadonlySet<string>,
  mayLinkToPage: boolean,
): string {
  const pattern = mayLinkToPage ? LOCAL_ASSET : LOCAL_ASSET_STRICT;
  if (pattern.test(value)) return `/${value.trim().replace(/^\.\//, "")}`;
  if (!mayLinkToPage) return value;

  const target = value.trim().replace(/^\.\//, "");
  const end = target.search(/[?#]/);
  const file = end < 0 ? target : target.slice(0, end);
  if (file === "") return value;
  if (pagePaths.has(file)) return `/${target}`;
  try {
    if (pagePaths.has(decodeURIComponent(file))) return `/${target}`;
  } catch {
    // Not valid percent-encoding, so it cannot name one of the pages.
  }
  return value;
}

/**
 * Removes inline event handlers, neutralizes `javascript:` URLs and makes
 * references to local assets and cloned pages root-absolute.
 */
function cleanAttributes(el: Element, pagePaths: ReadonlySet<string>): void {
  const attribs = el.attribs;
  for (const name of Object.keys(attribs)) {
    const lower = name.toLowerCase();
    const value = attribs[name];
    if (/^on./.test(lower)) {
      delete attribs[name];
    } else if (lower === "style") {
      attribs[name] = rewriteCssUrls(value);
    } else if (isJavascriptUrl(value) && URL_ATTRIBUTES.has(lower)) {
      attribs[name] = lower === "src" || lower === "data" ? "about:blank" : "#";
    } else if (lower.endsWith("srcset")) {
      attribs[name] = value.replace(SRCSET_CANDIDATE, "$1/");
    } else if (!TEXT_ATTRIBUTES.has(lower) && !lower.startsWith("aria-")) {
      attribs[name] = rewriteUrl(value, pagePaths, URL_ATTRIBUTES.has(lower));
    }
  }
}

/**
 * Stylesheets loaded through `onload` tricks (`rel="preload"` switched to
 * `stylesheet`, or `media="print"` switched to `all`) would never apply once
 * the handler is gone, so they are turned into plain stylesheets.
 */
function activateDeferredStylesheet(link: Element): void {
  const attribs = link.attribs;
  const onload = attribs.onload;
  if (onload === undefined) return;
  const rel = (attribs.rel ?? "").toLowerCase().split(/\s+/);
  const loadsStyle = (attribs.as ?? "").toLowerCase() === "style";
  if (rel.includes("preload") && loadsStyle && /\brel\b/.test(onload)) {
    attribs.rel = "stylesheet";
    delete attribs.as;
  } else if (rel.includes("stylesheet") && /\bmedia\b/.test(onload)) {
    const media = /media\s*=\s*["']([^"']*)["']/.exec(onload);
    if (media && media[1] !== "" && media[1] !== "all") attribs.media = media[1];
    else delete attribs.media;
  }
}

/** True for `<link>` hints that only exist to fetch scripts early. */
function isScriptPreload(link: Element): boolean {
  const rel = (link.attribs.rel ?? "").toLowerCase().split(/\s+/);
  if (rel.includes("modulepreload")) return true;
  return rel.includes("preload") && (link.attribs.as ?? "").toLowerCase() === "script";
}

function isJsonLd(script: Element): boolean {
  return (script.attribs.type ?? "").trim().toLowerCase() === "application/ld+json";
}

function isContentSecurityPolicy(meta: Element): boolean {
  const name = (meta.attribs["http-equiv"] ?? "").trim().toLowerCase();
  return name.startsWith("content-security-policy");
}

/**
 * Visits elements in document order without recursion. `visit` returns false
 * to skip the content of an element.
 */
function walkElements(
  roots: readonly AnyNode[],
  visit: (el: Element) => boolean,
): void {
  const stack: AnyNode[] = [...roots].reverse();
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (isElement(node) && !visit(node)) continue;
    if (!isParent(node)) continue;
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let id = `${base}-mount`;
  for (let n = 2; taken.has(id); n++) id = `${base}-mount-${n}`;
  return id;
}

/**
 * Parses a cloned page and turns it into a Vite HTML entry. Scripts (other
 * than JSON-LD in the head), body `<noscript>` blocks, inline event handlers
 * and `javascript:` URLs are removed; body `<style>` blocks move to the end of
 * the head; local URLs become root-absolute. The body content is returned
 * separately and replaced by a mount element and a module script.
 */
function preparePage(html: string, options: PrepareOptions): PreparedPage {
  const $ = cheerio.load(html);
  const root = $("html").get(0);
  const head = $("head").get(0);
  if (!$("body").get(0)) $("html").append("<body></body>");
  const body = $("body").get(0);
  if (!root || !head || !body) {
    throw new Error("The page could not be parsed as an HTML document");
  }
  const { pagePaths, assetPaths } = options;

  const removedFromHead: Element[] = [];
  walkElements(head.children, (el) => {
    const tag = el.name;
    const drop =
      (tag === "script" && !isJsonLd(el)) ||
      (tag === "meta" && isContentSecurityPolicy(el)) ||
      (tag === "link" && isScriptPreload(el));
    if (drop) {
      removedFromHead.push(el);
      return false;
    }
    if (tag === "link") activateDeferredStylesheet(el);
    // A leftover <base href> would redirect every root-absolute URL.
    if (tag === "base") delete el.attribs.href;
    if (tag === "style" || tag === "noscript") {
      // Both hold raw text; in <noscript> that text is markup.
      for (const child of el.children) {
        if (!isText(child)) continue;
        child.data =
          tag === "style"
            ? rewriteStyleSheet(child.data, assetPaths)
            : child.data.replace(NOSCRIPT_URL, "$1/");
      }
    }
    cleanAttributes(el, pagePaths);
    return true;
  });
  for (const el of removedFromHead) {
    const before = el.prev;
    if (before && isText(before) && isBlank(before.data)) $(before).remove();
    $(el).remove();
  }

  const removedFromBody: Element[] = [];
  const styles: Element[] = [];
  const ids = new Set<string>();
  walkElements(body.children, (el) => {
    const tag = el.name;
    if (tag === "script" || tag === "noscript") {
      removedFromBody.push(el);
      return false;
    }
    if (tag === "style") {
      styles.push(el);
      return false;
    }
    if (tag === "link") activateDeferredStylesheet(el);
    if (el.attribs.id !== undefined) ids.add(el.attribs.id);
    cleanAttributes(el, pagePaths);
    return true;
  });
  for (const el of removedFromBody) $(el).remove();
  for (const el of styles) {
    // A new element, because one taken from inside an <svg> would be
    // serialized with its CSS entity-encoded.
    const style = $("<style></style>");
    for (const [name, value] of Object.entries(el.attribs)) {
      if (!/^on./i.test(name)) style.attr(name, value);
    }
    const css = rewriteStyleSheet(textContent(el), assetPaths);
    style.text(css.replace(/<\/(?=style)/gi, "<\\/"));
    $(head).append(style, "\n");
    $(el).remove();
  }
  cleanAttributes(root, pagePaths);
  cleanAttributes(body, pagePaths);

  const title = collapseWhitespace($(head).children("title").first().text()).trim();
  const mountId = uniqueId(options.mountId, ids);
  const bodyNodes = [...body.children];
  $(body).empty();
  // `display: contents` keeps the mount element out of the page layout, so the
  // content still behaves like direct children of <body>.
  $(body).append(
    `\n<div id="${mountId}" style="display: contents"></div>\n` +
      `<script type="module" src="${options.entrySrc}"></script>\n`,
  );

  const output = $.html();
  return {
    html: output.endsWith("\n") ? output : `${output}\n`,
    bodyNodes,
    mountId,
    title,
  };
}

function packageName(project: Project, suffix: string): string {
  const base = (project.name || project.host || "site")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "site"}-${suffix}`;
}

function renderPackageJson(project: Project, target: ExportTarget): string {
  const manifest = {
    name: packageName(project, target.slug),
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    engines: { node: NODE_ENGINES },
    dependencies: target.dependencies,
    devDependencies: target.devDependencies,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderReadme(
  project: Project,
  target: ExportTarget,
  pages: readonly ExportPage[],
): string {
  const source = project.finalUrl || project.url;
  const rows = pages.map((page) => {
    const component = `src/pages/${page.componentName}.${target.componentExtension}`;
    const from = page.url || "-";
    return `| \`${page.path}\` | \`${component}\` | ${from} |`;
  });
  const notes = [
    "All `<script>` elements were removed, along with script preload hints. " +
      "JSON-LD (`application/ld+json`) in the `<head>` is the one exception. " +
      "Menus, sliders, forms and other behaviour driven by the original " +
      "site's JavaScript therefore do nothing until you rebuild them.",
    "Inline event handlers (`onclick`, `onload`, ...) were removed and " +
      "`javascript:` links now point to `#`.",
    "`<noscript>` blocks in the page bodies were removed.",
    "`<style>` blocks found in a page body were moved to the end of that " +
      "page's `<head>`.",
    "Content-Security-Policy `<meta>` tags were removed so the dev server can run.",
    "Local files are referenced as `/assets/...` and links between cloned " +
      "pages as `/page.html`. Links to anything else still point at the " +
      "original site.",
    ...target.notes,
  ];

  return [
    `# ${project.name || project.host}`,
    "",
    `A ${target.label} starter generated from a static copy of ${source}.`,
    "It is a Vite multi-page app: every cloned page has its own HTML file " +
      "with the original `<head>`, and its body is a component.",
    "",
    "## Getting started",
    "",
    "```sh",
    "npm install",
    "npm run dev",
    "```",
    "",
    "`npm run build` writes the site to `dist/` and `npm run preview` serves " +
      "that build. Node 20.19+ or 22.12+ is required.",
    "",
    "## Pages",
    "",
    "| Page | Component | Copied from |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Layout",
    "",
    "- `*.html` - one entry per page: the original `<head>` plus a mount element.",
    `- \`src/pages/\` - the body of each page as a ${target.label} component.`,
    "- `src/entries/` - mounts each page component.",
    "- `public/assets/` - CSS, images, fonts and media, copied unchanged.",
    "",
    "## What changed during conversion",
    "",
    ...notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

const GITIGNORE = ["node_modules", "dist", "*.local", ".DS_Store", ""].join("\n");

/** Builds the files of a Vite multi-page project for one framework. */
export async function buildExport(
  siteDir: string,
  project: Project,
  target: ExportTarget,
): Promise<ExportFiles> {
  const [pages, assets] = await Promise.all([
    loadPages(siteDir, project),
    collectAssets(siteDir),
  ]);
  const pagePaths = new Set(pages.map((page) => page.path));
  const assetPaths = new Set(
    Object.keys(assets).map((key) => key.slice(PUBLIC_PREFIX.length)),
  );
  const files: ExportFiles = {};

  for (const page of pages) {
    const entryFile = `src/entries/${page.entryName}.${target.entryExtension}`;
    const prepared = preparePage(page.html, {
      pagePaths,
      assetPaths,
      mountId: target.mountId,
      entrySrc: `/${entryFile}`,
    });
    if (page.title === "") page.title = prepared.title;
    files[page.path] = encodeText(prepared.html);
    files[`src/pages/${page.componentName}.${target.componentExtension}`] =
      encodeText(target.renderComponent(page, prepared.bodyNodes));
    files[entryFile] = encodeText(target.renderEntry(page, prepared.mountId));
  }

  const inputs = pages
    .map((page) => {
      const key = JSON.stringify(page.entryName);
      return `        ${key}: resolve(root, ${JSON.stringify(page.path)}),`;
    })
    .join("\n");
  files["vite.config.js"] = encodeText(target.renderViteConfig(inputs));
  files["package.json"] = encodeText(renderPackageJson(project, target));
  files["README.md"] = encodeText(renderReadme(project, target, pages));
  files[".gitignore"] = encodeText(GITIGNORE);

  return Object.assign(files, assets);
}
