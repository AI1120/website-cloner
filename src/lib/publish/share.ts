import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { projectDir, readJson, remove, writeJson } from "@/lib/cloner/storage";
import type { Project, ShareSettings } from "@/types/project";

/**
 * The published link's settings: the title, description and image it shows when
 * shared, and an optional password.
 *
 * The password is kept as a salted scrypt hash in `publish-secret.json`, never in
 * the project's metadata (which the browser receives). Unlocking sets a cookie
 * signed with a key from the same file, so changing or removing the password
 * signs everyone out.
 *
 * Published pages are sandboxed (an opaque origin), so a cookie is only sent
 * with page navigations, not with the files a page loads. The password therefore
 * guards the pages; their images and styles can only be found from a page.
 */

export const NO_SHARE: ShareSettings = { title: "", description: "", image: null, protected: false };

export const SHARE_LIMITS = {
  title: 120,
  description: 300,
  password: 200,
  imageBytes: 5 * 1024 * 1024,
} as const;

export const SHARE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

interface PublishSecret {
  salt: string;
  hash: string;
  /** Signs unlock cookies. */
  key: string;
}

function secretPath(id: string): string {
  return path.join(projectDir(id), "publish-secret.json");
}

export function shareImagePath(id: string): string {
  return path.join(projectDir(id), "share-image");
}

export function shareSettings(project: Project): ShareSettings {
  return project.share ?? NO_SHARE;
}

/** Stores a new password, or removes it when `password` is null. */
export async function setPassword(id: string, password: string | null): Promise<void> {
  if (password === null) {
    await remove(secretPath(id));
    return;
  }
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  await writeJson(secretPath(id), { salt, hash, key: randomBytes(32).toString("hex") } satisfies PublishSecret);
}

export async function verifyPassword(id: string, password: string): Promise<boolean> {
  const secret = await readJson<PublishSecret>(secretPath(id));
  if (!secret) return false;
  const expected = Buffer.from(secret.hash, "hex");
  const actual = scryptSync(password.slice(0, SHARE_LIMITS.password), secret.salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function unlockCookieName(id: string): string {
  return `sc_unlock_${id.replace(/[^a-z0-9]/gi, "_")}`;
}

/** The value of the cookie that shows a visitor knows the password, or null when there is none. */
export async function unlockToken(id: string): Promise<string | null> {
  const secret = await readJson<PublishSecret>(secretPath(id));
  if (!secret) return null;
  return createHmac("sha256", Buffer.from(secret.key, "hex")).update(`unlock:${id}`).digest("base64url");
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export async function isUnlocked(request: Request, id: string): Promise<boolean> {
  const expected = await unlockToken(id);
  const given = readCookie(request, unlockCookieName(id));
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function setMeta(html: string, attribute: "name" | "property", key: string, content: string): string {
  const tag = `<meta ${attribute}="${key}" content="${escapeHtml(content)}">`;
  const existing = new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${key.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  if (existing.test(html)) return html.replace(existing, tag);
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) return tag + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

/**
 * Adds the link's title, description and preview image to a published page as
 * it is served. The title replaces the entry page's own; other pages keep
 * theirs but share the description and image.
 */
export function withShareTags(
  html: string,
  settings: ShareSettings,
  page: { url: string; imageUrl: string | null; isEntry: boolean },
): string {
  let out = html;
  const ownTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(out)?.[1]?.trim() ?? "";
  if (settings.title && page.isEntry) {
    const titleTag = `<title>${escapeHtml(settings.title)}</title>`;
    out = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(out)
      ? out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, titleTag)
      : out.replace(/<head\b[^>]*>/i, (head) => head + titleTag);
  }
  const title = (page.isEntry && settings.title) || ownTitle;
  if (settings.description) {
    out = setMeta(out, "name", "description", settings.description);
    out = setMeta(out, "property", "og:description", settings.description);
  }
  if (title) out = setMeta(out, "property", "og:title", title);
  out = setMeta(out, "property", "og:url", page.url);
  out = setMeta(out, "property", "og:type", "website");
  if (page.imageUrl) {
    out = setMeta(out, "property", "og:image", page.imageUrl);
    out = setMeta(out, "name", "twitter:card", "summary_large_image");
  }
  return out;
}

/** The page shown instead of a protected site until the password is given. */
export function passwordPage(options: { id: string; next: string; title: string; failed: boolean }): string {
  const action = `/p/${encodeURIComponent(options.id)}/__unlock`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Password required</title>
<style>
  :root { color-scheme: light dark; --brand: #b0249a; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent), Canvas; color: CanvasText; }
  form { width: 100%; max-width: 360px; padding: 28px; border-radius: 16px; background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    box-shadow: 0 24px 48px -24px rgb(0 0 0 / 0.35); }
  .lock { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px; margin-bottom: 16px;
    background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  p { margin: 6px 0 20px; color: color-mix(in srgb, CanvasText 60%, transparent); font-size: 14px; }
  input { width: 100%; padding: 10px 12px; border-radius: 10px; font: inherit; color: inherit; background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); outline: none; }
  input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 25%, transparent); }
  button { width: 100%; margin-top: 12px; padding: 10px 12px; border: 0; border-radius: 10px; font: inherit; font-weight: 600;
    color: #fff; background: var(--brand); cursor: pointer; }
  .error { margin: 10px 0 0; color: #dc2626; font-size: 13px; }
</style>
</head>
<body>
<form method="post" action="${action}">
  <div class="lock" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
  <h1>${escapeHtml(options.title || "This site is private")}</h1>
  <p>Enter the password to view it.</p>
  <input type="hidden" name="next" value="${escapeHtml(options.next)}">
  <label for="password" style="position:absolute;left:-9999px">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  ${options.failed ? '<p class="error" role="alert">That password isn\'t right. Try again.</p>' : ""}
  <button type="submit">View site</button>
</form>
</body>
</html>`;
}
