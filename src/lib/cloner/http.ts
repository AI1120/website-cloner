import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

import { contentTypeFor } from "@/lib/cloner/mime";
import { resolveInside } from "@/lib/cloner/storage";

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Rejects requests made by other sites (or by a cloned page running in its
 * sandbox) on behalf of the person using the app. Browsers always send
 * `Origin` on cross-site and on non-GET requests.
 */
export function isTrustedOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Cloned pages are third-party content. The sandbox gives them an opaque
// origin, so their scripts can't read this app's data or call its API.
const SANDBOX =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

export interface ServeOptions {
  /** Restrict embedding to this app (used for the editable working copy). */
  sameOriginFramesOnly: boolean;
}

/** Headers every response carrying site content gets, whatever produced the body. */
function siteHeaders(contentType: string, options: ServeOptions): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
    "content-security-policy": options.sameOriginFramesOnly
      ? `${SANDBOX}; frame-ancestors 'self'`
      : SANDBOX,
  });
}

/** Serves site content that was produced in memory (a built bundle, a rewritten page). */
export function serveSiteText(
  request: Request,
  body: string,
  contentType: string,
  options: ServeOptions,
): Response {
  const headers = siteHeaders(contentType, options);
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

/**
 * Serves one file of a cloned site. `segments` is the path below the site
 * root; with no path the caller is redirected to the entry page, because the
 * pages use relative URLs that only resolve from a file path.
 */
export async function serveSiteFile(
  request: Request,
  root: string,
  segments: string[] | undefined,
  entry: string,
  options: ServeOptions,
): Promise<Response> {
  if (!segments || segments.length === 0) {
    const url = new URL(request.url);
    const location = `${url.pathname.replace(/\/+$/, "")}/${entry}`;
    return new Response(null, { status: 307, headers: { location } });
  }

  const file = resolveInside(root, segments.join("/"));
  if (!file) return new Response("Not found", { status: 404 });

  let size: number;
  let modified: number;
  try {
    const stats = await fs.stat(file);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
    modified = Math.round(stats.mtimeMs);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const etag = `W/"${size}-${modified}"`;
  const headers = siteHeaders(contentTypeFor(file), options);
  headers.set("accept-ranges", "bytes");
  headers.set("etag", etag);

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && size > 0 && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
  }

  headers.set("content-length", String(size === 0 ? 0 : end - start + 1));
  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status, headers });
  }

  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
