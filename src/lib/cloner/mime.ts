export type AssetKind = "css" | "js" | "image" | "font" | "media" | "other";

export interface AssetType {
  kind: AssetKind | "html";
  ext: string;
}

export const ASSET_DIRS: Record<AssetKind, string> = {
  css: "assets/css",
  js: "assets/js",
  image: "assets/img",
  font: "assets/fonts",
  media: "assets/media",
  other: "assets/other",
};

const BY_CONTENT_TYPE: Record<string, AssetType> = {
  "text/html": { kind: "html", ext: "html" },
  "application/xhtml+xml": { kind: "html", ext: "html" },
  "text/css": { kind: "css", ext: "css" },
  "text/javascript": { kind: "js", ext: "js" },
  "application/javascript": { kind: "js", ext: "js" },
  "application/x-javascript": { kind: "js", ext: "js" },
  "application/ecmascript": { kind: "js", ext: "js" },
  "image/png": { kind: "image", ext: "png" },
  "image/apng": { kind: "image", ext: "png" },
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/jpg": { kind: "image", ext: "jpg" },
  "image/gif": { kind: "image", ext: "gif" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/avif": { kind: "image", ext: "avif" },
  "image/svg+xml": { kind: "image", ext: "svg" },
  "image/x-icon": { kind: "image", ext: "ico" },
  "image/vnd.microsoft.icon": { kind: "image", ext: "ico" },
  "image/bmp": { kind: "image", ext: "bmp" },
  "font/woff2": { kind: "font", ext: "woff2" },
  "font/woff": { kind: "font", ext: "woff" },
  "font/ttf": { kind: "font", ext: "ttf" },
  "font/otf": { kind: "font", ext: "otf" },
  "font/sfnt": { kind: "font", ext: "ttf" },
  "application/font-woff2": { kind: "font", ext: "woff2" },
  "application/font-woff": { kind: "font", ext: "woff" },
  "application/x-font-woff": { kind: "font", ext: "woff" },
  "application/x-font-ttf": { kind: "font", ext: "ttf" },
  "application/x-font-opentype": { kind: "font", ext: "otf" },
  "application/vnd.ms-fontobject": { kind: "font", ext: "eot" },
  "video/mp4": { kind: "media", ext: "mp4" },
  "video/webm": { kind: "media", ext: "webm" },
  "video/ogg": { kind: "media", ext: "ogv" },
  "video/quicktime": { kind: "media", ext: "mov" },
  "audio/mpeg": { kind: "media", ext: "mp3" },
  "audio/ogg": { kind: "media", ext: "ogg" },
  "audio/wav": { kind: "media", ext: "wav" },
  "audio/mp4": { kind: "media", ext: "m4a" },
  "audio/aac": { kind: "media", ext: "aac" },
  "application/json": { kind: "other", ext: "json" },
  "application/manifest+json": { kind: "other", ext: "webmanifest" },
  "text/vtt": { kind: "other", ext: "vtt" },
  "application/xml": { kind: "other", ext: "xml" },
  "text/xml": { kind: "other", ext: "xml" },
  "application/pdf": { kind: "other", ext: "pdf" },
};

const KIND_BY_EXT: Record<string, AssetKind | "html"> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "js",
  mjs: "js",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  ico: "image",
  bmp: "image",
  woff2: "font",
  woff: "font",
  ttf: "font",
  otf: "font",
  eot: "font",
  mp4: "media",
  webm: "media",
  ogv: "media",
  mov: "media",
  mp3: "media",
  ogg: "media",
  wav: "media",
  m4a: "media",
  aac: "media",
  json: "other",
  webmanifest: "other",
  vtt: "other",
  xml: "other",
  pdf: "other",
  txt: "other",
  map: "other",
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
};

const TEXT_EXTENSIONS = new Set([
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "json",
  "webmanifest",
  "xml",
  "txt",
  "svg",
  "vtt",
  "map",
  "md",
  // Source files of generated projects.
  "jsx",
  "ts",
  "tsx",
  "cjs",
  "yml",
  "yaml",
  "gitignore",
]);

export function extensionOf(pathname: string): string {
  const name = pathname.split("/").pop() ?? "";
  const match = /\.([a-z0-9]{1,11})$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPE_BY_EXT[extensionOf(filePath)] ?? "application/octet-stream";
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(filePath));
}

/**
 * Decides what a downloaded file is. The response's content type wins; when it
 * is missing or generic, the URL's extension and then the referencing context
 * (`hint`) are used.
 */
export function classifyAsset(
  contentType: string,
  url: string,
  hint: AssetKind | null,
): AssetType {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const known = BY_CONTENT_TYPE[mime];
  let urlExt = "";
  try {
    urlExt = extensionOf(new URL(url).pathname);
  } catch {
    urlExt = "";
  }

  if (known) {
    // Keep a more specific extension from the URL when it agrees on the kind.
    if (urlExt && KIND_BY_EXT[urlExt] === known.kind && known.kind !== "html") {
      return { kind: known.kind, ext: urlExt === "jpeg" ? "jpg" : urlExt };
    }
    return known;
  }

  if (mime.startsWith("image/")) return { kind: "image", ext: urlExt || "img" };
  if (mime.startsWith("font/")) return { kind: "font", ext: urlExt || "font" };
  if (mime.startsWith("video/")) return { kind: "media", ext: urlExt || "mp4" };
  if (mime.startsWith("audio/")) return { kind: "media", ext: urlExt || "mp3" };

  const kindFromExt = urlExt ? KIND_BY_EXT[urlExt] : undefined;
  if (kindFromExt) return { kind: kindFromExt, ext: urlExt };

  if (hint === "css") return { kind: "css", ext: "css" };
  if (hint === "js") return { kind: "js", ext: "js" };
  return { kind: hint ?? "other", ext: urlExt || "bin" };
}
