import fs from "node:fs/promises";

import type { NextRequest } from "next/server";

import { serveSiteFile, serveSiteText } from "@/lib/cloner/http";
import { publishedDir, readProject, resolveInside } from "@/lib/cloner/storage";
import {
  isUnlocked,
  passwordPage,
  shareImagePath,
  shareSettings,
  unlockCookieName,
  unlockToken,
  verifyPassword,
  withShareTags,
} from "@/lib/publish/share";
import type { Project } from "@/types/project";

type Context = { params: Promise<{ id: string; path?: string[] }> };

const SHARE_IMAGE = "__share-image";
const UNLOCK = "__unlock";
const PUBLISHED = { sameOriginFramesOnly: false };

/** This app's own pages (the password form) are trusted, so they get a strict policy of their own. */
const FORM_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function origin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function shareImageUrl(request: Request, project: Project): string | null {
  const image = shareSettings(project).image;
  if (!image) return null;
  return `${origin(request)}/p/${project.id}/${SHARE_IMAGE}?v=${encodeURIComponent(image.updatedAt)}`;
}

/** Only addresses inside the published site may be returned to after unlocking. */
function safeNext(next: string): string {
  const clean = next.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("\\")) return "";
  return clean;
}

function lockedResponse(request: Request, project: Project, next: string, failed: boolean): Response {
  const settings = shareSettings(project);
  const page = passwordPage({ id: project.id, next, title: settings.title, failed });
  // Link previews still show the title, description and image the owner chose.
  const html = withShareTags(page, settings, {
    url: `${origin(request)}/p/${project.id}/${next}`,
    imageUrl: shareImageUrl(request, project),
    isEntry: true,
  });
  return new Response(request.method === "HEAD" ? null : html, { status: 401, headers: FORM_HEADERS });
}

/** Serves a project's published snapshot at its shareable link. */
export async function GET(request: NextRequest, { params }: Context) {
  const { id, path } = await params;
  const project = await readProject(id);
  if (!project || !project.published) return new Response("Not found", { status: 404 });
  const settings = shareSettings(project);
  const segments = path ?? [];
  const relative = segments.join("/");

  if (relative === SHARE_IMAGE) {
    if (!settings.image) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.readFile(shareImagePath(id));
      return new Response(new Uint8Array(body), {
        headers: {
          "content-type": settings.image.contentType,
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  // The password guards page loads; see lib/publish/share.ts for why not the files they use.
  const dest = request.headers.get("sec-fetch-dest");
  const isPage = dest ? dest === "document" || dest === "iframe" : segments.length === 0 || /\.html?$/i.test(relative);
  if (settings.protected && isPage && !(await isUnlocked(request, id))) {
    return lockedResponse(request, project, relative || project.entry, false);
  }

  if (/\.html?$/i.test(relative)) {
    const file = resolveInside(publishedDir(id), relative);
    const html = file ? await fs.readFile(file, "utf8").catch(() => null) : null;
    if (html !== null) {
      const tagged = withShareTags(html, settings, {
        url: `${origin(request)}/p/${id}/${relative}`,
        imageUrl: shareImageUrl(request, project),
        isEntry: relative === project.entry,
      });
      return serveSiteText(request, tagged, "text/html; charset=utf-8", PUBLISHED);
    }
  }
  return serveSiteFile(request, publishedDir(id), path, project.entry, PUBLISHED);
}

/** The password form posts here; a right password sets the unlock cookie and goes back to the page. */
export async function POST(request: NextRequest, { params }: Context) {
  const { id, path } = await params;
  if ((path ?? []).join("/") !== UNLOCK) return new Response("Not found", { status: 404 });
  const project = await readProject(id);
  if (!project || !project.published || !shareSettings(project).protected) {
    return new Response("Not found", { status: 404 });
  }

  let password = "";
  let next = "";
  try {
    const form = await request.formData();
    password = String(form.get("password") ?? "");
    next = safeNext(String(form.get("next") ?? ""));
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const token = (await verifyPassword(id, password)) ? await unlockToken(id) : null;
  if (!token) {
    // Slows down guessing.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return lockedResponse(request, project, next || project.entry, true);
  }
  const secure = origin(request).startsWith("https:") ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: `/p/${encodeURIComponent(id)}/${(next || project.entry).split("/").map(encodeURIComponent).join("/")}`,
      "set-cookie": `${unlockCookieName(id)}=${token}; Path=/p/${encodeURIComponent(id)}/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      "cache-control": "no-store",
    },
  });
}
