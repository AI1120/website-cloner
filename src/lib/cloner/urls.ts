import { createHash } from "node:crypto";
import path from "node:path";

const NON_FETCHABLE = /^(?:data|blob|javascript|mailto|tel|sms|about|chrome|file|ws|wss|ftp|intent|whatsapp|viber|skype|callto):/i;

export function shortHash(value: string, length = 10): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

/** Adds a scheme to bare input like "example.com". */
export function normalizeInputUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Resolves a reference found in a page or stylesheet. Returns null for
 * anything that isn't an http(s) resource (fragments, data URIs, mailto, ...),
 * which the caller should leave untouched.
 */
export function toAbsoluteUrl(raw: string, base: string): URL | null {
  const value = raw.trim();
  if (!value || value.startsWith("#") || NON_FETCHABLE.test(value)) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Splits "https://a/b.svg#icon" into the fetchable URL and its fragment. */
export function splitHash(url: URL): { href: string; hash: string } {
  const hash = url.hash;
  const copy = new URL(url.href);
  copy.hash = "";
  return { href: copy.href, hash };
}

/** Relative path from one file in the site folder to another. */
export function relativeFrom(fromFile: string, toFile: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative || path.posix.basename(toFile);
}

function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isSameSite(a: URL, b: URL): boolean {
  return siteHost(a.hostname) === siteHost(b.hostname);
}

/** Identity of a page for de-duplication: host, path, and query. */
export function pageKey(url: URL): string {
  let pathname = url.pathname.replace(/\/(?:index\.(?:html?|php))$/i, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return `${siteHost(url.hostname)}${pathname || "/"}${url.search}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Lowercase, filesystem-safe fragment for use in a file name. */
export function slugify(value: string, maxLength = 48): string {
  return safeDecode(value)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "")
    .toLowerCase();
}

/** File-name stem for an asset URL, without its extension. */
export function assetStem(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  return slugify(last.replace(/\.[a-z0-9]{1,11}$/i, ""));
}

/** Flat file name for an additional page, e.g. "/about/team" → "about-team". */
export function pageStem(url: URL): string {
  const stem = slugify(url.pathname.replace(/\.(?:html?|php|aspx?)$/i, ""), 60);
  if (!url.search) return stem;
  return `${stem || "page"}-${shortHash(url.search, 6)}`;
}

export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

/**
 * Parses a `srcset` value. URLs may contain commas, so candidates can't be
 * split on commas alone: a URL runs to the next whitespace, and a trailing
 * comma on it ends the candidate.
 */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let index = 0;
  const length = value.length;

  while (index < length) {
    while (index < length && /[\s,]/.test(value[index])) index += 1;
    if (index >= length) break;

    let end = index;
    while (end < length && !/\s/.test(value[end])) end += 1;
    let url = value.slice(index, end);
    index = end;

    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      let depth = 0;
      const start = index;
      while (index < length) {
        const char = value[index];
        if (char === "(") depth += 1;
        else if (char === ")") depth = Math.max(0, depth - 1);
        else if (char === "," && depth === 0) break;
        index += 1;
      }
      descriptor = value.slice(start, index).trim();
      index += 1;
    }

    if (url) candidates.push({ url, descriptor });
  }

  return candidates;
}

export function serializeSrcset(candidates: SrcsetCandidate[]): string {
  return candidates
    .map((candidate) =>
      candidate.descriptor ? `${candidate.url} ${candidate.descriptor}` : candidate.url,
    )
    .join(", ");
}
