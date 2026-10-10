import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { CheerioAPI } from "cheerio";

import { PageRenderer } from "@/lib/cloner/browser";
import { rewriteCss } from "@/lib/cloner/css";
import {
  collectPageLinks,
  decodeText,
  loadPage,
  looksScriptRendered,
  pageTitle,
  rewritePage,
} from "@/lib/cloner/html";
import { ASSET_DIRS, classifyAsset, type AssetKind } from "@/lib/cloner/mime";
import { loadRobots } from "@/lib/cloner/robots";
import { assertPublicUrl, FetchError, safeFetch, type SafeFetchResult } from "@/lib/cloner/safe-fetch";
import { deleteProject, siteDir, writeProject } from "@/lib/cloner/storage";
import {
  assetStem,
  isSameSite,
  normalizeInputUrl,
  pageKey,
  pageStem,
  shortHash,
  slugify,
  splitHash,
  toAbsoluteUrl,
} from "@/lib/cloner/urls";
import { plural } from "@/lib/format";
import type { CloneEvent, CloneOptions, Project } from "@/types/project";

const MAX_PAGES = 25;
const MAX_ASSETS = 800;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_DURATION_MS = 4 * 60 * 1000;
/** Time kept back for downloading assets when pages are loaded in a browser. */
const ASSET_TIME_MS = 60 * 1000;
const CONCURRENCY = 6;
const PROGRESS_INTERVAL_MS = 120;

/** An error whose message is safe and useful to show to the person cloning. */
export class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}

export interface CloneRequest {
  url: string;
  options: CloneOptions;
  /**
   * Pages of the site the person chose to include besides the entered one.
   * When given, exactly these are copied and no others are looked for.
   */
  pages?: string[];
  signal: AbortSignal;
  emit: (event: CloneEvent) => void;
}

interface LoadedPage {
  url: string;
  path: string;
  title: string;
  $: CheerioAPI;
}

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    // Hand the slot straight to the next waiter instead of freeing it.
    if (next) next();
    else active -= 1;
  };
  return async (task) => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export function normalizeOptions(options: Partial<CloneOptions>): CloneOptions {
  const pages = Math.floor(Number(options.maxPages));
  return {
    maxPages: Number.isFinite(pages) ? Math.min(MAX_PAGES, Math.max(1, pages)) : 1,
    keepScripts: options.keepScripts === true,
    // A kept script would run again over markup it already built, so pages that
    // keep their JavaScript are copied as the server sends them.
    renderPages: options.keepScripts !== true && options.renderPages !== false,
  };
}

function describeFailure(error: unknown, signal: AbortSignal): CloneError {
  if (error instanceof CloneError) return error;
  if (signal.aborted) return new CloneError("Cloning was cancelled.");
  if (error instanceof FetchError) {
    if (error.code === "invalid" || error.code === "blocked" || error.code === "timeout") {
      return new CloneError(error.message);
    }
    if (error.code === "too-large") {
      return new CloneError("That page is too large to clone.");
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(error.message)) {
      return new CloneError("Couldn't find that site. Check the address and try again.");
    }
    if (/certificate|CERT_|self.signed/i.test(error.message)) {
      return new CloneError("The site's security certificate could not be verified.");
    }
    return new CloneError("Couldn't connect to that site. It may be down or blocking requests.");
  }
  console.error("Clone failed unexpectedly:", error);
  return new CloneError("Something went wrong while cloning the site.");
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CloneError("Cloning was cancelled.");
}

/** Downloads assets once each and hands out their local paths. */
class AssetStore {
  private readonly root: string;
  private readonly signal: AbortSignal;
  private readonly deadline: number;
  private readonly emit: (event: CloneEvent) => void;
  /** Files the cloning browser already downloaded, reused rather than fetched again. */
  private readonly cached: (url: string) => SafeFetchResult | undefined;
  private readonly paths = new Map<string, Promise<string | null>>();
  private readonly usedPaths = new Set<string>();
  private readonly skippedUrls = new Set<string>();
  private readonly limit = createLimiter(CONCURRENCY);
  private pending: Promise<void>[] = [];
  private lastEmit = 0;

  saved = 0;
  failed = 0;
  bytes = 0;

  constructor(
    root: string,
    signal: AbortSignal,
    deadline: number,
    emit: (event: CloneEvent) => void,
    cached: (url: string) => SafeFetchResult | undefined = () => undefined,
  ) {
    this.root = root;
    this.signal = signal;
    this.deadline = deadline;
    this.emit = emit;
    this.cached = cached;
  }

  get skipped(): number {
    return this.skippedUrls.size;
  }

  /**
   * Resolves to the asset's local path as soon as it has been fetched. A
   * stylesheet's own references are processed afterwards (see `settle`), so
   * stylesheets that import each other can't wait on one another forever.
   */
  resolve(url: string, hint: AssetKind | null, referer: string): Promise<string | null> {
    const existing = this.paths.get(url);
    if (existing) return existing;

    if (
      this.paths.size >= MAX_ASSETS ||
      this.bytes >= MAX_TOTAL_BYTES ||
      Date.now() > this.deadline
    ) {
      this.skippedUrls.add(url);
      return Promise.resolve(null);
    }

    const download = this.download(url, hint, referer);
    this.paths.set(url, download);
    return download;
  }

  /** Waits until every download and stylesheet rewrite has finished. */
  async settle(): Promise<void> {
    await Promise.all(this.paths.values());
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      await Promise.all(batch);
      await Promise.all(this.paths.values());
    }
  }

  private async download(
    url: string,
    hint: AssetKind | null,
    referer: string,
  ): Promise<string | null> {
    try {
      const response =
        this.cached(url) ??
        (await this.limit(() =>
          safeFetch(url, {
            maxBytes: MAX_ASSET_BYTES,
            timeoutMs: REQUEST_TIMEOUT_MS,
            signal: this.signal,
            referer,
          }),
        ));
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      const type = classifyAsset(response.contentType, response.url, hint);
      if (type.kind === "html") {
        throw new Error("Received a web page instead of a file.");
      }

      const localPath = this.allocate(url, type.kind, type.ext);
      if (type.kind === "css") {
        this.pending.push(
          this.saveStylesheet(localPath, response.body, response.contentType, response.url),
        );
      } else {
        await this.write(localPath, response.body);
        this.finish(response.body.length);
      }
      return localPath;
    } catch {
      this.finish(null);
      return null;
    }
  }

  private async saveStylesheet(
    localPath: string,
    body: Buffer,
    contentType: string,
    servedFrom: string,
  ): Promise<void> {
    let output = body;
    try {
      const css = decodeText(body, contentType).replace(
        /^﻿?@charset\s+["'][^"']*["'];?/i,
        '@charset "UTF-8";',
      );
      const rewritten = await rewriteCss(css, servedFrom, localPath, (target, hint) =>
        this.resolve(target, hint, servedFrom),
      );
      output = Buffer.from(rewritten, "utf8");
    } catch {
      output = body;
    }
    try {
      await this.write(localPath, output);
      this.finish(output.length);
    } catch {
      this.finish(null);
    }
  }

  private allocate(url: string, kind: AssetKind, ext: string): string {
    const stem = assetStem(new URL(url)) || kind;
    const hash = shortHash(url);
    let candidate = `${ASSET_DIRS[kind]}/${stem}-${hash}.${ext}`;
    for (let suffix = 2; this.usedPaths.has(candidate); suffix += 1) {
      candidate = `${ASSET_DIRS[kind]}/${stem}-${hash}-${suffix}.${ext}`;
    }
    this.usedPaths.add(candidate);
    return candidate;
  }

  private async write(localPath: string, data: Buffer): Promise<void> {
    await fs.writeFile(path.join(this.root, ...localPath.split("/")), data);
  }

  private finish(size: number | null): void {
    if (size === null) {
      this.failed += 1;
    } else {
      this.saved += 1;
      this.bytes += size;
    }
    const done = this.saved + this.failed;
    const total = this.paths.size;
    const now = Date.now();
    if (done < total && now - this.lastEmit < PROGRESS_INTERVAL_MS) return;
    this.lastEmit = now;
    this.emit({ type: "progress", done, total, bytes: this.bytes });
  }
}

interface FetchedPage {
  url: string;
  $: CheerioAPI;
  /** True when the markup was read from a browser after the page's scripts ran. */
  rendered: boolean;
}

/** Why a page response can't be used, or null when it can. */
function responseProblem(status: number, contentType: string): string | null {
  if (status === 401 || status === 403 || status === 429) {
    return `The site refused the request (status ${status}). It may block automated copying.`;
  }
  if (status === 404 || status === 410) {
    return `No page was found at that address (status ${status}).`;
  }
  if (status < 200 || status >= 300) {
    return `The site answered with an error (status ${status}).`;
  }
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime && !/html|xml/.test(mime)) {
    return `That address is not a web page (it returned ${mime}).`;
  }
  return null;
}

/**
 * Fetches and parses a page: through the browser when one is given, falling back
 * to a plain request if the browser can't open it. Returns a reason string when
 * the page can't be used.
 */
async function fetchPage(
  url: string,
  signal: AbortSignal,
  renderer: PageRenderer | null = null,
): Promise<FetchedPage | string> {
  if (renderer) {
    try {
      const page = await renderer.render(url);
      if (typeof page !== "string" && /^https?:/i.test(page.url)) {
        return responseProblem(page.status, page.contentType) ?? { url: page.url, $: loadPage(page.html), rendered: true };
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  const response = await safeFetch(url, {
    maxBytes: MAX_PAGE_BYTES,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  return (
    responseProblem(response.status, response.contentType) ?? {
      url: response.url,
      $: loadPage(decodeText(response.body, response.contentType)),
      rendered: false,
    }
  );
}

function makeId(hostname: string): string {
  const stem = slugify(hostname.replace(/^www\./i, ""), 40) || "site";
  return `${stem}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}

function allocatePagePath(url: URL, used: Set<string>): string {
  let stem = pageStem(url) || "page";
  if (stem === "index") stem = "index-page";
  let candidate = `${stem}.html`;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    candidate = `${stem}-${suffix}.html`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Copies a website into a new project folder: fetches the entered page (and
 * optionally more pages of the same site), saves every stylesheet, image,
 * font, and script they use, and rewrites the pages to use the local copies.
 */
export async function cloneSite(request: CloneRequest): Promise<Project> {
  const { emit, signal } = request;
  const deadline = Date.now() + MAX_DURATION_MS;
  const options = normalizeOptions(request.options);
  const inputUrl = normalizeInputUrl(request.url);

  let entryUrl: URL;
  try {
    entryUrl = assertPublicUrl(inputUrl);
  } catch (error) {
    throw describeFailure(error, signal);
  }

  const id = makeId(entryUrl.hostname);
  const root = siteDir(id);
  let renderer: PageRenderer | null = null;

  try {
    await Promise.all(
      Object.values(ASSET_DIRS).map((directory) =>
        fs.mkdir(path.join(root, ...directory.split("/")), { recursive: true }),
      ),
    );
    emit({ type: "start", id });

    const wantedRendering = options.renderPages === true;
    if (wantedRendering) {
      emit({ type: "status", message: "Starting a browser", stage: "open" });
      renderer = await PageRenderer.open(signal);
    }
    options.renderPages = renderer !== null;
    const pageDeadline = renderer ? deadline - ASSET_TIME_MS : deadline;
    let unrendered = 0;

    emit({ type: "status", message: `Opening ${entryUrl.hostname}`, stage: "open" });
    const entry = await fetchPage(entryUrl.href, signal, renderer);
    if (typeof entry === "string") throw new CloneError(entry);
    if (renderer && !entry.rendered) unrendered += 1;

    const entryFinalUrl = new URL(entry.url);
    const warnings: string[] = [];
    if (!entry.rendered && !options.keepScripts && looksScriptRendered(entry.$)) {
      warnings.push(
        wantedRendering && !renderer
          ? "This page builds most of its content with JavaScript, so the copy may look empty. Install Google Chrome or Microsoft Edge on the machine running the app so pages can be loaded in a browser, or clone it again with “Keep JavaScript” turned on."
          : "This page builds most of its content with JavaScript, so the copy may look empty. Try cloning it again with “Keep JavaScript” turned on.",
      );
    }

    const usedPagePaths = new Set<string>(["index.html"]);
    const pagePaths = new Map<string, string>([
      [pageKey(entryUrl), "index.html"],
      [pageKey(entryFinalUrl), "index.html"],
    ]);
    const pages: LoadedPage[] = [
      { url: entry.url, path: "index.html", title: pageTitle(entry.$), $: entry.$ },
    ];

    const chosen = request.pages
      ?.map((page) => toAbsoluteUrl(page, entry.url))
      .filter((page): page is URL => page !== null && isSameSite(page, entryFinalUrl))
      .slice(0, MAX_PAGES - 1)
      .map((page) => splitHash(page).href);
    if (chosen) options.maxPages = chosen.length + 1;

    if (options.maxPages > 1) {
      const allowedByRobots = await loadRobots(entryFinalUrl.origin, signal);
      const queue = chosen ?? collectPageLinks(entry.$, entry.url);
      const seen = new Set(pagePaths.keys());
      let attempts = 0;
      let blockedByRobots = 0;

      while (
        pages.length < options.maxPages &&
        queue.length > 0 &&
        attempts < options.maxPages * 3 &&
        Date.now() < pageDeadline
      ) {
        assertNotAborted(signal);
        const href = queue.shift();
        if (!href) break;
        const next = new URL(href);
        const key = pageKey(next);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!allowedByRobots(next)) {
          blockedByRobots += 1;
          continue;
        }

        attempts += 1;
        emit({
          type: "status",
          message: `Reading page ${pages.length + 1} of up to ${options.maxPages}`,
          stage: "pages",
        });

        let loaded: FetchedPage | string;
        try {
          loaded = await fetchPage(next.href, signal, renderer);
        } catch {
          continue;
        }
        if (typeof loaded === "string") continue;
        if (renderer && !loaded.rendered) unrendered += 1;

        const finalUrl = new URL(loaded.url);
        if (!isSameSite(finalUrl, entryFinalUrl)) continue;
        const finalKey = pageKey(finalUrl);
        const existing = pagePaths.get(finalKey);
        if (existing) {
          pagePaths.set(key, existing);
          continue;
        }

        const localPath = allocatePagePath(finalUrl, usedPagePaths);
        pagePaths.set(key, localPath);
        pagePaths.set(finalKey, localPath);
        seen.add(finalKey);
        pages.push({ url: loaded.url, path: localPath, title: pageTitle(loaded.$), $: loaded.$ });
        if (!chosen) queue.push(...collectPageLinks(loaded.$, loaded.url));
      }

      if (blockedByRobots > 0) {
        warnings.push(
          `${plural(blockedByRobots, "page")} skipped because the site's robots.txt asks crawlers not to visit ${blockedByRobots === 1 ? "it" : "them"}.`,
        );
      }
    }

    // Every page is read; the browser's downloads stay available to the asset store.
    await renderer?.close();
    if (unrendered > 0) {
      warnings.push(
        `${plural(unrendered, "page")} couldn't be loaded in the browser and ${unrendered === 1 ? "was" : "were"} copied as the server sent ${unrendered === 1 ? "it" : "them"}.`,
      );
    }

    assertNotAborted(signal);
    emit({ type: "status", message: "Downloading styles, images and fonts", stage: "assets" });

    // Browsers request /favicon.ico on their own; make that explicit so the
    // icon is saved with the copy.
    const ICON_MARKER = "data-cloner-default-icon";
    if (entry.$('link[rel~="icon"]').length === 0) {
      entry.$("head").append(`<link rel="icon" href="/favicon.ico" ${ICON_MARKER}>`);
    }

    const browserFiles = renderer;
    const assets = new AssetStore(root, signal, deadline, emit, (url) => browserFiles?.cached(url));
    await Promise.all(
      pages.map((page) =>
        rewritePage(page.$, {
          pageUrl: page.url,
          pagePath: page.path,
          keepScripts: options.keepScripts,
          resolveAsset: (url, hint) => assets.resolve(url, hint, page.url),
          resolvePage: (url) => pagePaths.get(pageKey(url)) ?? null,
        }),
      ),
    );
    await assets.settle();
    assertNotAborted(signal);

    const defaultIcon = entry.$(`link[${ICON_MARKER}]`);
    if (defaultIcon.length > 0) {
      if (/^https?:/i.test(defaultIcon.attr("href") ?? "")) defaultIcon.remove();
      else defaultIcon.removeAttr(ICON_MARKER);
    }
    const iconHref = entry.$('link[rel~="icon"]').first().attr("href") ?? "";
    const icon = iconHref.startsWith("assets/") ? iconHref.split("#")[0] : null;

    emit({ type: "status", message: "Saving pages", stage: "save" });
    let pageBytes = 0;
    for (const page of pages) {
      const data = Buffer.from(page.$.html(), "utf8");
      await fs.writeFile(path.join(root, page.path), data);
      pageBytes += data.length;
    }

    if (assets.failed > 0) {
      warnings.push(
        `${plural(assets.failed, "file")} could not be downloaded and still ${assets.failed === 1 ? "loads" : "load"} from the original site.`,
      );
    }
    if (assets.skipped > 0) {
      warnings.push(
        `The clone reached its size or time limit, so ${plural(assets.skipped, "file")} still ${assets.skipped === 1 ? "loads" : "load"} from the original site.`,
      );
    }

    const now = new Date().toISOString();
    const host = entryFinalUrl.hostname.replace(/^www\./i, "");
    const project: Project = {
      id,
      name: pages[0].title || host,
      source: "clone",
      framework: "html",
      styling: "original",
      uiLibrary: "none",
      designSystem: null,
      pending: false,
      url: inputUrl,
      finalUrl: entry.url,
      host,
      createdAt: now,
      updatedAt: now,
      options,
      stats: {
        assets: assets.saved,
        bytes: assets.bytes + pageBytes,
      },
      entry: "index.html",
      icon,
      pages: pages.map((page) => ({
        url: page.url,
        path: page.path,
        title: page.title || page.path,
      })),
      warnings,
      published: null,
      checkpoints: [],
    };
    await writeProject(project);
    return project;
  } catch (error) {
    await deleteProject(id).catch(() => undefined);
    throw describeFailure(error, signal);
  } finally {
    await renderer?.close();
  }
}

export interface DiscoveredPage {
  url: string;
  /** Words of the link that leads to the page, or its path when the link has none. */
  label: string;
}

export interface Discovery {
  /** The entered address after redirects. */
  url: string;
  title: string;
  pages: DiscoveredPage[];
}

const MAX_DISCOVERED_PAGES = 60;

/**
 * Opens a page and lists the other pages of the same site it links to, so the
 * person can choose which ones to copy along with it.
 */
export async function discoverPages(input: string, signal: AbortSignal): Promise<Discovery> {
  let entryUrl: URL;
  try {
    entryUrl = assertPublicUrl(normalizeInputUrl(input));
  } catch (error) {
    throw describeFailure(error, signal);
  }

  let renderer: PageRenderer | null = null;
  try {
    let entry = await fetchPage(entryUrl.href, signal);
    if (typeof entry === "string") throw new CloneError(entry);
    // Menus that scripts build are invisible to a plain request; ask a browser.
    if (looksScriptRendered(entry.$) || collectPageLinks(entry.$, entry.url).length < 3) {
      renderer = await PageRenderer.open(signal);
      if (renderer) {
        const rendered = await fetchPage(entryUrl.href, signal, renderer).catch(() => null);
        if (rendered && typeof rendered !== "string") entry = rendered;
      }
    }
    const finalUrl = new URL(entry.url);
    const allowedByRobots = await loadRobots(finalUrl.origin, signal);

    const labels = new Map<string, string>();
    entry.$("a[href]").each((_, element) => {
      const target = toAbsoluteUrl(element.attribs.href ?? "", entry.url);
      if (!target) return;
      const key = splitHash(target).href;
      const text = entry.$(element).text().replace(/\s+/g, " ").trim();
      if (text && !labels.has(key)) labels.set(key, text.slice(0, 80));
    });

    const seen = new Set([pageKey(entryUrl), pageKey(finalUrl)]);
    const pages: DiscoveredPage[] = [];
    for (const href of collectPageLinks(entry.$, entry.url)) {
      const target = new URL(href);
      const key = pageKey(target);
      if (seen.has(key) || !allowedByRobots(target)) continue;
      seen.add(key);
      pages.push({ url: href, label: labels.get(href) ?? (target.pathname + target.search) });
      if (pages.length >= MAX_DISCOVERED_PAGES) break;
    }

    return { url: entry.url, title: pageTitle(entry.$) || finalUrl.hostname, pages };
  } catch (error) {
    throw describeFailure(error, signal);
  } finally {
    await renderer?.close();
  }
}
