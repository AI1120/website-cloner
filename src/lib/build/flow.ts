import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";

import { findLinks, findRoutes, isScriptFile, type FileLinks } from "@/lib/build/jsx";
import { siteDir } from "@/lib/cloner/storage";
import type { Flow, FlowLink, FlowScreen, Project } from "@/types/project";

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const IMPORT_DEPTH = 5;
const RESOLVE_SUFFIXES = ["", ".jsx", ".tsx", ".js", ".ts", "/index.jsx", "/index.tsx", "/index.js"];

function titleFromWords(value: string): string {
  const words = value
    .replace(/[-_/]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

async function htmlFlow(project: Project): Promise<Flow> {
  const root = siteDir(project.id);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => entry.name);
  const known = new Set(names);
  const order = new Map(project.pages.map((page, index) => [page.path, index]));
  names.sort(
    (a, b) =>
      (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b),
  );

  const screens: FlowScreen[] = [];
  const links: FlowLink[] = [];
  for (const name of names) {
    const file = path.join(root, name);
    const stats = await fs.stat(file);
    if (stats.size > MAX_PAGE_BYTES) {
      screens.push({ path: name, title: name, file: name });
      continue;
    }
    const $ = cheerio.load(await fs.readFile(file, "utf8"));
    screens.push({
      path: name,
      title: $("title").first().text().replace(/\s+/g, " ").trim() || name,
      file: name,
    });

    const targets = new Set<string>();
    $("a[href], form[action]").each((_, element) => {
      const raw = element.attribs.href ?? element.attribs.action ?? "";
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#") || raw.startsWith("/")) {
        return;
      }
      const target = raw.split(/[?#]/)[0].replace(/^\.\//, "");
      if (target !== name && known.has(target)) targets.add(target);
    });
    for (const target of targets) links.push({ from: name, to: target });
  }
  return { screens, links };
}

async function readSources(root: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await visit(path.join(directory, entry.name), relative);
      } else if (isScriptFile(entry.name)) {
        sources.set(relative, await fs.readFile(path.join(directory, entry.name), "utf8"));
      }
    }
  };
  await visit(path.join(root, "src"), "src");
  return sources;
}

function resolveImport(from: string, specifier: string, files: Map<string, unknown>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  for (const suffix of RESOLVE_SUFFIXES) {
    if (files.has(base + suffix)) return base + suffix;
  }
  return null;
}

/** Whether a link such as "/products/42" leads to a route such as "/products/:id". */
function matchesRoute(target: string, route: string): boolean {
  if (target === route) return true;
  const a = target.split("/");
  const b = route.split("/");
  return a.length === b.length && b.every((part, index) => part.startsWith(":") || part === a[index]);
}

function previewPath(route: string): string {
  const sample = route.replace(/:[A-Za-z0-9_]+\??/g, "1");
  return sample === "/" ? "index.html" : `index.html#${sample}`;
}

async function reactFlow(project: Project): Promise<Flow> {
  const sources = await readSources(siteDir(project.id));
  const linksByFile = new Map<string, FileLinks>();
  for (const [file, source] of sources) linksByFile.set(file, findLinks(source, file));

  const routes = [...sources].flatMap(([file, source]) => findRoutes(source, file));
  if (routes.length === 0) {
    return { screens: [{ path: "index.html", title: project.name, file: null }], links: [] };
  }

  /** Files pulled in by `start`, itself included, following relative imports. */
  const reachableFrom = (start: string, stopAt: Set<string>): Set<string> => {
    const reached = new Set<string>([start]);
    let frontier = [start];
    for (let depth = 0; depth < IMPORT_DEPTH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const file of frontier) {
        for (const specifier of linksByFile.get(file)?.imports.values() ?? []) {
          const resolved = resolveImport(file, specifier, sources);
          if (resolved && !reached.has(resolved) && !stopAt.has(resolved)) {
            reached.add(resolved);
            next.push(resolved);
          }
        }
      }
      frontier = next;
    }
    return reached;
  };

  const routeFiles = routes.map((route) => {
    const specifier = route.component
      ? linksByFile.get(route.declaredIn)?.imports.get(route.component)
      : undefined;
    return specifier ? resolveImport(route.declaredIn, specifier, sources) : null;
  });
  const screenFiles = new Set(routeFiles.filter((file): file is string => file !== null));

  // Links in the files around the routes (a shared header, say) work on every screen.
  const sharedTargets = new Set<string>();
  for (const declaredIn of new Set(routes.map((route) => route.declaredIn))) {
    for (const file of reachableFrom(declaredIn, screenFiles)) {
      for (const target of linksByFile.get(file)?.targets ?? []) sharedTargets.add(target);
    }
  }

  const screens: FlowScreen[] = routes.map((route, index) => ({
    path: previewPath(route.path),
    title:
      route.path === "/"
        ? "Home"
        : titleFromWords((route.component ?? "").replace(/(?:Page|Screen|View)$/, "")) ||
          titleFromWords(route.path),
    file: routeFiles[index],
  }));

  const links: FlowLink[] = [];
  const seen = new Set<string>();
  routes.forEach((_, index) => {
    const targets = new Set(sharedTargets);
    const file = routeFiles[index];
    if (file) {
      for (const reached of reachableFrom(file, new Set())) {
        for (const target of linksByFile.get(reached)?.targets ?? []) targets.add(target);
      }
    }
    for (const target of targets) {
      const to = routes.findIndex((candidate) => matchesRoute(target, candidate.path));
      if (to === -1 || to === index) continue;
      const key = `${index}>${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from: screens[index].path, to: screens[to].path });
    }
  });

  return { screens, links };
}

/** The screens of a project and which of them link to which. */
export async function analyzeFlow(project: Project): Promise<Flow> {
  try {
    return project.framework === "react" ? await reactFlow(project) : await htmlFlow(project);
  } catch (error) {
    console.error("Flow analysis failed:", error);
    return { screens: project.pages.map((page) => ({ ...page, file: null })), links: [] };
  }
}
