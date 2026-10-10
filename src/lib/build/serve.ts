import fs from "node:fs/promises";
import path from "node:path";

import {
  compiledStylesheet,
  ensureBuilt,
  injectRuntime,
  needsBuild,
  readPreviewOutput,
  TAILWIND_OUTPUT_FILE,
} from "@/lib/build";
import { renderReactIndex } from "@/lib/build/react";
import { serveSiteFile, serveSiteText, type ServeOptions } from "@/lib/cloner/http";
import { pathExists, resolveInside, siteDir } from "@/lib/cloner/storage";
import type { BuildMessage, Project } from "@/types/project";

const PREVIEW: ServeOptions = { sameOriginFramesOnly: true };
const HTML = "text/html; charset=utf-8";
const SCRIPT = "text/javascript; charset=utf-8";
const STYLE = "text/css; charset=utf-8";

function redirectToEntry(request: Request, entry: string): Response {
  const url = new URL(request.url);
  const location = `${url.pathname.replace(/\/+$/, "")}/${entry}`;
  return new Response(null, { status: 307, headers: { location } });
}

/** A script that shows why the app could not be built, in place of the app. */
function buildErrorScript(errors: BuildMessage[]): string {
  return `(function () {
  var errors = ${JSON.stringify(errors)};
  var panel = document.createElement("div");
  panel.setAttribute("style", "position:fixed;inset:0;overflow:auto;padding:32px;background:#fff;color:#111827;font:14px/1.6 system-ui,sans-serif;z-index:2147483647");
  var title = document.createElement("h1");
  title.textContent = "This app doesn't build yet";
  title.setAttribute("style", "margin:0 0 8px;font-size:20px");
  var hint = document.createElement("p");
  hint.textContent = "Ask the AI to fix it, or correct the file in the Code view.";
  hint.setAttribute("style", "margin:0 0 20px;color:#6b7280");
  panel.appendChild(title);
  panel.appendChild(hint);
  errors.forEach(function (error) {
    var item = document.createElement("pre");
    item.setAttribute("style", "margin:0 0 12px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;border-radius:8px;background:#fef2f2;color:#991b1b;font:13px/1.5 ui-monospace,monospace");
    var where = error.file ? error.file + (error.line ? ":" + error.line : "") + "\\n" : "";
    item.textContent = where + error.text;
    panel.appendChild(item);
  });
  var show = function () { document.body.appendChild(panel); };
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  try { window.parent.postMessage({ type: "sc:build-error", errors: errors }, "*"); } catch (e) {}
})();`;
}

async function readPage(root: string, relative: string): Promise<string | null> {
  const file = resolveInside(root, relative);
  if (!file) return null;
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function serveReactPreview(
  request: Request,
  project: Project,
  segments: string[],
): Promise<Response> {
  const root = siteDir(project.id);
  const relative = segments.join("/");

  if (relative === "index.html") {
    const [status, html] = await Promise.all([ensureBuilt(project), readPage(root, "index.html")]);
    if (html === null) return new Response("Not found", { status: 404 });
    const version = status.fingerprint;
    const page = renderReactIndex(html, `__app.js?v=${version}`, `__app.css?v=${version}`);
    return serveSiteText(request, injectRuntime(page, project.id, true), HTML, PREVIEW);
  }
  if (relative === "__app.js") {
    const status = await ensureBuilt(project);
    const script = status.ok ? await readPreviewOutput(project.id, "app.js") : null;
    return serveSiteText(request, script ?? buildErrorScript(status.errors), SCRIPT, PREVIEW);
  }
  if (relative === "__app.css") {
    const status = await ensureBuilt(project);
    const styles = status.ok ? await readPreviewOutput(project.id, "app.css") : null;
    return serveSiteText(request, styles ?? "", STYLE, PREVIEW);
  }

  // Like Vite, files in public/ are served from the site root.
  const publicDir = path.join(root, "public");
  const inPublic = resolveInside(publicDir, relative);
  if (inPublic && inPublic !== publicDir && (await pathExists(inPublic))) {
    return serveSiteFile(request, publicDir, segments, project.entry, PREVIEW);
  }
  return serveSiteFile(request, root, segments, project.entry, PREVIEW);
}

/**
 * Serves the editable working copy of a project for the in-app preview:
 * builds what needs building, and adds the editor bridge to pages.
 */
export async function servePreview(
  request: Request,
  project: Project,
  segments: string[] | undefined,
): Promise<Response> {
  if (!segments || segments.length === 0) return redirectToEntry(request, project.entry);
  if (project.framework === "react") return serveReactPreview(request, project, segments);

  const root = siteDir(project.id);
  const relative = segments.join("/");
  const building = needsBuild(project);

  if (/\.html?$/i.test(relative)) {
    if (building) await ensureBuilt(project);
    const html = await readPage(root, relative);
    if (html === null) return new Response("Not found", { status: 404 });
    return serveSiteText(request, injectRuntime(html, project.id, true), HTML, PREVIEW);
  }
  if (building && relative === TAILWIND_OUTPUT_FILE) await ensureBuilt(project);
  return serveSiteFile(request, root, segments, project.entry, PREVIEW);
}

/** Serves a built-in template so it can be shown before it is used. */
export async function serveTemplate(
  request: Request,
  root: string,
  segments: string[] | undefined,
): Promise<Response> {
  if (!segments || segments.length === 0) return redirectToEntry(request, "index.html");
  if (segments.join("/") === TAILWIND_OUTPUT_FILE) {
    try {
      return serveSiteText(request, await compiledStylesheet(root), STYLE, PREVIEW);
    } catch (error) {
      console.error("Template stylesheet failed to compile:", error);
      return new Response("", { status: 500 });
    }
  }
  return serveSiteFile(request, root, segments, "index.html", PREVIEW);
}
