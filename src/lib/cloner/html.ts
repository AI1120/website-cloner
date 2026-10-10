import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { rewriteCss, type ResolveAsset } from "@/lib/cloner/css";
import type { AssetKind } from "@/lib/cloner/mime";
import {
  isSameSite,
  parseSrcset,
  relativeFrom,
  serializeSrcset,
  splitHash,
  toAbsoluteUrl,
} from "@/lib/cloner/urls";

export interface RewriteContext {
  /** URL the page was served from, after redirects. */
  pageUrl: string;
  /** Path the page will be saved at, relative to the site folder. */
  pagePath: string;
  keepScripts: boolean;
  resolveAsset: ResolveAsset;
  /** Local path of the cloned copy of a page, or null if it isn't in the clone. */
  resolvePage: (url: URL) => string | null;
}

// Links ending in these are downloads or media, not pages worth crawling.
const NON_PAGE_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|css|js|mjs|json|xml|rss|atom|pdf|zip|gz|rar|7z|tar|dmg|exe|msi|apk|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|txt)$/i;

// `once` and `only` start with "on" but are not event handlers.
const NOT_EVENT_HANDLERS = new Set(["once", "only"]);

// Shown-by-JavaScript states of popular animation and lazy-loading libraries.
// Without their scripts these elements would stay invisible in a static copy.
const STATIC_FIXES = [
  "[data-aos]{opacity:1!important;transform:none!important}",
  ".wow{visibility:visible!important}",
  ".lazyload,.lazyloading{opacity:1!important}",
  ".elementor-invisible{visibility:visible!important}",
  "[data-framer-appear-id]{opacity:1!important;transform:none!important}",
  '[data-w-id][style*="opacity:0"],[data-w-id][style*="opacity: 0"]{opacity:1!important;transform:none!important}',
].join("\n");

function sniffCharset(body: Buffer, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType);
  if (fromHeader) return fromHeader[1];
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    return "utf-8";
  }
  const head = body.subarray(0, 4096).toString("latin1");
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(head);
  return fromMeta ? fromMeta[1] : "utf-8";
}

export function decodeText(body: Buffer, contentType: string): string {
  const charset = sniffCharset(body, contentType);
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function loadPage(html: string): CheerioAPI {
  return cheerio.load(html);
}

export function pageTitle($: CheerioAPI): string {
  return $("title").first().text().replace(/\s+/g, " ").trim();
}

/** True when the HTML is mostly an empty shell that scripts fill in later. */
export function looksScriptRendered($: CheerioAPI): boolean {
  if ($("script").length === 0) return false;
  const body = $("body").clone();
  body.find("script, style, noscript, template").remove();
  const text = body.text().replace(/\s+/g, " ").trim();
  return text.length < 150 && body.find("img, picture, video, svg").length < 3;
}

function documentBase($: CheerioAPI, pageUrl: string): string {
  const href = $("base[href]").first().attr("href");
  if (!href) return pageUrl;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return pageUrl;
  }
}

/** Same-site pages this page links to, in document order, without fragments. */
export function collectPageLinks($: CheerioAPI, pageUrl: string): string[] {
  const base = documentBase($, pageUrl);
  const origin = new URL(pageUrl);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const absolute = toAbsoluteUrl(element.attribs.href ?? "", base);
    if (!absolute || !isSameSite(absolute, origin)) return;
    if (NON_PAGE_EXTENSION.test(absolute.pathname)) return;
    if (element.attribs.download !== undefined) return;
    links.add(splitHash(absolute).href);
  });

  return [...links];
}

/** Visits every element. The universal selector is typed as any node, so narrow it. */
function eachElement($: CheerioAPI, visit: (element: Element) => void): void {
  $("*").each((_, node) => {
    if ("attribs" in node) visit(node);
  });
}

function relTokens(element: Element): Set<string> {
  return new Set((element.attribs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

function isPlaceholderSource(src: string | undefined): boolean {
  if (!src) return true;
  return (
    src.startsWith("data:") ||
    /(?:placeholder|blank|spacer|transparent|1x1|pixel)[^/]*\.(?:gif|png|svg)/i.test(src)
  );
}

/**
 * Turns a page into one that renders without its scripts: removes them,
 * activates stylesheets and images that scripts would have switched on.
 */
function makeStatic($: CheerioAPI): void {
  $("link").each((_, element) => {
    const attrs = element.attribs;
    const rel = relTokens(element);
    const as = (attrs.as ?? "").toLowerCase();

    if (
      rel.has("modulepreload") ||
      ((rel.has("preload") || rel.has("prefetch")) && as === "script")
    ) {
      $(element).remove();
      return;
    }
    // <link rel="preload" as="style" onload="this.rel='stylesheet'">
    if (rel.has("preload") && as === "style" && attrs.onload !== undefined) {
      attrs.rel = "stylesheet";
      delete attrs.as;
    }
    // <link rel="stylesheet" media="print" onload="this.media='all'">
    if (
      rel.has("stylesheet") &&
      attrs.onload !== undefined &&
      (attrs.media ?? "").toLowerCase() === "print"
    ) {
      attrs.media = "all";
    }
  });

  $("script").each((_, element) => {
    const type = (element.attribs.type ?? "").toLowerCase();
    if (type !== "application/ld+json") $(element).remove();
  });
  $("noscript").remove();

  eachElement($, (element) => {
    const attrs = element.attribs;
    for (const name of Object.keys(attrs)) {
      const lower = name.toLowerCase();
      if (/^on[a-z]{3,}$/.test(lower) && !NOT_EVENT_HANDLERS.has(lower)) {
        delete attrs[name];
      }
    }

    if (element.tagName === "img" || element.tagName === "source") {
      const lazySrc =
        attrs["data-src"] ??
        attrs["data-lazy-src"] ??
        attrs["data-original"] ??
        attrs["data-lazy"];
      if (lazySrc && element.tagName === "img" && isPlaceholderSource(attrs.src)) {
        attrs.src = lazySrc;
      }
      const lazySrcset = attrs["data-srcset"] ?? attrs["data-lazy-srcset"];
      if (lazySrcset && !attrs.srcset) attrs.srcset = lazySrcset;
      const lazySizes = attrs["data-sizes"];
      if (lazySizes && lazySizes !== "auto" && !attrs.sizes) attrs.sizes = lazySizes;
    }

    const lazyBackground = attrs["data-bg"] ?? attrs["data-background-image"];
    if (lazyBackground && !/background(?:-image)?\s*:/i.test(attrs.style ?? "")) {
      const value = /^url\(/i.test(lazyBackground.trim())
        ? lazyBackground.trim()
        : `url("${lazyBackground.trim().replace(/"/g, "%22")}")`;
      attrs.style = `${attrs.style ? `${attrs.style.replace(/;\s*$/, "")};` : ""}background-image:${value}`;
    }

    if (attrs.class && /(?:^|\s)(?:lazyload|lazyloading)(?:\s|$)/.test(attrs.class)) {
      attrs.class = attrs.class
        .split(/\s+/)
        .map((name) => (name === "lazyload" || name === "lazyloading" ? "lazyloaded" : name))
        .join(" ");
    }
  });
}

/**
 * Rewrites a parsed page in place so every stylesheet, image, font, and script
 * it uses points at a local copy, links to other cloned pages stay inside the
 * clone, and everything else points back at the source site.
 */
export async function rewritePage($: CheerioAPI, context: RewriteContext): Promise<void> {
  const base = documentBase($, context.pageUrl);
  $("base").remove();

  $("meta").each((_, element) => {
    const equiv = (element.attribs["http-equiv"] ?? "").toLowerCase();
    if (
      element.attribs.charset !== undefined ||
      equiv === "content-type" ||
      equiv === "refresh" ||
      equiv.startsWith("content-security-policy")
    ) {
      $(element).remove();
    }
  });
  $("head").prepend('<meta charset="utf-8">');

  if (!context.keepScripts) makeStatic($);

  const tasks: Promise<void>[] = [];

  const resolveReference = async (
    raw: string,
    hint: AssetKind | null,
  ): Promise<string | null> => {
    const absolute = toAbsoluteUrl(raw, base);
    if (!absolute) return null;
    const { href, hash } = splitHash(absolute);
    const local = await context.resolveAsset(href, hint);
    return local ? relativeFrom(context.pagePath, local) + hash : absolute.href;
  };

  const assetAttr = (element: Element, name: string, hint: AssetKind | null) => {
    const raw = element.attribs[name];
    if (raw === undefined) return;
    tasks.push(
      resolveReference(raw, hint).then((value) => {
        if (value !== null) element.attribs[name] = value;
      }),
    );
  };

  const srcsetAttr = (element: Element, name: string) => {
    const raw = element.attribs[name];
    if (!raw) return;
    const candidates = parseSrcset(raw);
    tasks.push(
      Promise.all(
        candidates.map(async (candidate) => ({
          url: (await resolveReference(candidate.url, "image")) ?? candidate.url,
          descriptor: candidate.descriptor,
        })),
      ).then((resolved) => {
        element.attribs[name] = serializeSrcset(resolved);
      }),
    );
  };

  const absoluteAttr = (element: Element, name: string) => {
    const raw = element.attribs[name];
    if (raw === undefined) return;
    const absolute = toAbsoluteUrl(raw, base);
    if (absolute) element.attribs[name] = absolute.href;
  };

  const rewriteLink = (element: Element) => {
    const attrs = element.attribs;
    const rel = relTokens(element);
    const as = (attrs.as ?? "").toLowerCase();

    if (rel.has("stylesheet")) {
      assetAttr(element, "href", "css");
    } else if (
      rel.has("icon") ||
      rel.has("apple-touch-icon") ||
      rel.has("apple-touch-icon-precomposed") ||
      rel.has("mask-icon")
    ) {
      assetAttr(element, "href", "image");
    } else if (rel.has("preload") || rel.has("prefetch")) {
      const hints: Record<string, AssetKind> = {
        style: "css",
        font: "font",
        image: "image",
        script: "js",
        video: "media",
        audio: "media",
      };
      const hint = hints[as];
      if (hint) {
        assetAttr(element, "href", hint);
        srcsetAttr(element, "imagesrcset");
      } else {
        absoluteAttr(element, "href");
      }
    } else {
      absoluteAttr(element, "href");
    }
  };

  const rewriteAnchor = (element: Element) => {
    const raw = element.attribs.href;
    if (raw === undefined) return;
    if (/^\s*javascript:/i.test(raw)) {
      if (!context.keepScripts) element.attribs.href = "#";
      return;
    }
    const absolute = toAbsoluteUrl(raw, base);
    if (!absolute) return;
    const local = context.resolvePage(absolute);
    element.attribs.href = local
      ? relativeFrom(context.pagePath, local) + absolute.hash
      : absolute.href;
  };

  eachElement($, (element) => {
    const attrs = element.attribs;

    // Local copies are same-origin files; these would only make them fail.
    delete attrs.integrity;
    delete attrs.nonce;

    switch (element.tagName) {
      case "link":
        delete attrs.crossorigin;
        rewriteLink(element);
        break;
      case "script":
        delete attrs.crossorigin;
        assetAttr(element, "src", "js");
        break;
      case "img":
        delete attrs.crossorigin;
        assetAttr(element, "src", "image");
        srcsetAttr(element, "srcset");
        assetAttr(element, "data-src", "image");
        assetAttr(element, "data-lazy-src", "image");
        assetAttr(element, "data-original", "image");
        srcsetAttr(element, "data-srcset");
        srcsetAttr(element, "data-lazy-srcset");
        break;
      case "source": {
        const parent = element.parent;
        const parentTag = parent && "tagName" in parent ? parent.tagName : "";
        const isMedia = parentTag === "video" || parentTag === "audio";
        assetAttr(element, "src", isMedia ? "media" : "image");
        srcsetAttr(element, "srcset");
        srcsetAttr(element, "data-srcset");
        break;
      }
      case "video":
        delete attrs.crossorigin;
        assetAttr(element, "src", "media");
        assetAttr(element, "poster", "image");
        break;
      case "audio":
        delete attrs.crossorigin;
        assetAttr(element, "src", "media");
        break;
      case "track":
        assetAttr(element, "src", "other");
        break;
      case "input":
        if ((attrs.type ?? "").toLowerCase() === "image") {
          assetAttr(element, "src", "image");
        }
        break;
      case "image":
        assetAttr(element, "href", "image");
        assetAttr(element, "xlink:href", "image");
        break;
      case "use":
        for (const name of ["href", "xlink:href"]) {
          const value = attrs[name];
          if (value && !value.startsWith("#")) assetAttr(element, name, "image");
        }
        break;
      case "iframe":
      case "frame":
      case "embed":
        absoluteAttr(element, "src");
        break;
      case "object":
        absoluteAttr(element, "data");
        break;
      case "a":
      case "area":
        rewriteAnchor(element);
        break;
      case "form":
        absoluteAttr(element, "action");
        break;
      case "meta": {
        const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
        if (/^(?:og:(?:image|video|audio|url)(?::\w+)?|twitter:image(?::src)?|image)$/.test(key)) {
          absoluteAttr(element, "content");
        }
        break;
      }
      case "style": {
        const css = $(element).text();
        if (css.includes("url(") || /@import/i.test(css)) {
          tasks.push(
            rewriteCss(css, base, context.pagePath, context.resolveAsset).then((value) => {
              $(element).text(value);
            }),
          );
        }
        break;
      }
      case "body":
      case "table":
      case "tr":
      case "td":
      case "th":
        assetAttr(element, "background", "image");
        break;
    }

    const inlineStyle = attrs.style;
    if (inlineStyle && inlineStyle.includes("url(")) {
      tasks.push(
        rewriteCss(inlineStyle, base, context.pagePath, context.resolveAsset).then((value) => {
          attrs.style = value;
        }),
      );
    }
  });

  await Promise.all(tasks);

  if (!context.keepScripts) {
    $("head").append(`<style data-cloner="static-fixes">\n${STATIC_FIXES}\n</style>`);
  }
}
