import { existsSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Route } from "playwright-core";

import { FetchError, safeFetch, type SafeFetchResult } from "@/lib/cloner/safe-fetch";

/**
 * Loads pages in a real browser (the Chrome or Edge installed on the machine),
 * so the copy has what visitors see after the page's scripts have run.
 *
 * The browser never touches the network itself: every request it makes is
 * answered by `safeFetch`, which blocks private and local addresses. Anything
 * the interception can't catch (WebSockets, WebRTC) is sent to a proxy that
 * doesn't exist, so it fails.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;
/** The most one page may take, from opening it to reading its markup. */
const PAGE_BUDGET_MS = 40_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_REQUESTS_PER_PAGE = 600;
const MAX_POST_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Responses kept for the clone to reuse instead of downloading them again. */
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

/** Requests the copy has no use for, which can be large or never finish. */
const SKIPPED_TYPES = new Set(["media", "websocket", "eventsource", "texttrack", "manifest"]);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
/** Response headers that describe the connection rather than the content. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

let cachedPath: string | null | undefined;

function candidatePaths(): string[] {
  const env = process.env;
  if (process.platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    return roots.flatMap((root) => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ];
}

/**
 * The browser to load pages with: `CLONER_BROWSER` when it names one (or "off"
 * to never use one), otherwise Chrome or Edge from their usual install places.
 */
export function findBrowser(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  const setting = (process.env.CLONER_BROWSER ?? "").trim();
  if (["off", "0", "false", "no"].includes(setting.toLowerCase())) {
    cachedPath = null;
  } else if (setting) {
    cachedPath = existsSync(setting) ? setting : null;
  } else {
    cachedPath = candidatePaths().find((candidate) => existsSync(candidate)) ?? null;
  }
  return cachedPath;
}

export function browserAvailable(): boolean {
  return findBrowser() !== null;
}

export interface RenderedPage {
  /** Address after redirects, including ones made by the page's scripts. */
  url: string;
  status: number;
  contentType: string;
  html: string;
}

/**
 * Runs in the page once it has settled and returns its markup with the state
 * scripts gave it: CSS rules inserted through the CSSOM (CSS-in-JS libraries do
 * this, and the markup never shows them), constructed stylesheets, open shadow
 * roots, and form values. Kept as plain JavaScript in a string, so the build
 * can't add helpers the page doesn't have.
 */
const SERIALIZE_PAGE = `(() => {
  const doc = document;
  const rulesText = (sheet) => {
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join(" ");
    } catch (error) {
      return null;
    }
  };

  for (const style of Array.from(doc.querySelectorAll("style"))) {
    const sheet = style.sheet;
    if (!sheet) continue;
    let written = -1;
    try {
      const probe = new CSSStyleSheet();
      probe.replaceSync(style.textContent || "");
      written = probe.cssRules.length;
    } catch (error) {
      written = -1;
    }
    if (written >= 0 && sheet.cssRules.length > written) {
      const text = rulesText(sheet);
      if (text !== null) style.textContent = text;
    }
  }

  const addSheets = (sheets, place) => {
    const text = Array.from(sheets || []).map(rulesText).filter(Boolean).join(" ");
    if (!text) return;
    const style = doc.createElement("style");
    style.setAttribute("data-cloner-adopted", "");
    style.textContent = text;
    place(style);
  };
  addSheets(doc.adoptedStyleSheets, (style) => doc.head.appendChild(style));

  const roots = [];
  const collect = (root) => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.shadowRoot) {
        roots.push(node.shadowRoot);
        collect(node.shadowRoot);
      }
    }
  };
  collect(doc.documentElement);
  for (const root of roots) addSheets(root.adoptedStyleSheets, (style) => root.prepend(style));

  for (const input of Array.from(doc.querySelectorAll("input"))) {
    if (input.type === "checkbox" || input.type === "radio") {
      input.toggleAttribute("checked", input.checked);
    } else if (input.type !== "password" && input.type !== "file" && input.value) {
      input.setAttribute("value", input.value);
    }
  }
  for (const area of Array.from(doc.querySelectorAll("textarea"))) area.textContent = area.value;
  for (const option of Array.from(doc.querySelectorAll("option"))) {
    option.toggleAttribute("selected", option.selected);
  }

  const quote = (value) => value.split("&").join("&amp;").split('"').join("&quot;");
  const root = doc.documentElement;
  let html;
  if (roots.length > 0 && typeof root.getHTML === "function") {
    const attributes = Array.from(root.attributes, (attr) => " " + attr.name + '="' + quote(attr.value) + '"');
    html = "<html" + attributes.join("") + ">" + root.getHTML({ serializableShadowRoots: true, shadowRoots: roots }) + "</html>";
  } else {
    html = root.outerHTML;
  }
  const type = doc.doctype;
  const doctype = type
    ? "<!DOCTYPE " + type.name + (type.publicId ? ' PUBLIC "' + type.publicId + '"' : "") + (type.systemId ? ' "' + type.systemId + '"' : "") + ">"
    : "<!DOCTYPE html>";
  return doctype + html;
})()`;

/** Scrolls through the page so content that loads or animates in on scroll appears. */
const SCROLL_THROUGH = `(async (budget) => {
  const started = performance.now();
  const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  while (performance.now() - started < budget) {
    const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (y >= height - window.innerHeight) break;
    y += step;
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  window.scrollTo(0, 0);
})`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One browser, reused for every page of a clone. Always `close()` it. */
export class PageRenderer {
  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private readonly signal: AbortSignal;
  private readonly cache = new Map<string, SafeFetchResult>();
  private cacheBytes = 0;
  private inFlight = 0;
  private requests = 0;
  private lastActivity = Date.now();
  /** Why the most recent page navigation failed, in words the person can use. */
  private navigationProblem: string | null = null;
  /**
   * Where the page's address redirected to. Playwright only intercepts the first
   * request of a redirect chain, so a redirect is never handed to the browser to
   * follow (its next request would bypass `safeFetch`); `render` opens the new
   * address itself instead.
   */
  private pendingRedirect: string | null = null;

  private constructor(browser: Browser, context: BrowserContext, signal: AbortSignal) {
    this.browser = browser;
    this.context = context;
    this.signal = signal;
  }

  /** Starts the browser, or returns null when there is none or it won't start. */
  static async open(signal: AbortSignal): Promise<PageRenderer | null> {
    const executablePath = findBrowser();
    if (!executablePath || signal.aborted) return null;
    let browser: Browser | null = null;
    try {
      const { chromium } = await import("playwright-core");
      browser = await chromium.launch({
        executablePath,
        headless: true,
        // The pages are third-party code, so keep the browser's own sandbox on.
        chromiumSandbox: true,
        proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
        args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-background-networking"],
        timeout: 20_000,
      });
      const context = await browser.newContext({
        viewport: VIEWPORT,
        userAgent: USER_AGENT,
        locale: "en-US",
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      const renderer = new PageRenderer(browser, context, signal);
      await context.route("**/*", (route) => renderer.handle(route));
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      signal.addEventListener("abort", () => void renderer.close(), { once: true });
      return renderer;
    } catch (error) {
      console.error("The cloning browser could not start:", error);
      await browser?.close().catch(() => undefined);
      return null;
    }
  }

  /** A response the browser already received for this address, if it was kept. */
  cached(url: string): SafeFetchResult | undefined {
    return this.cache.get(url.split("#")[0]);
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }

  /** Answers one of the browser's requests through `safeFetch`. */
  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = request.url();
    const isNavigation = request.isNavigationRequest() && request.frame().parentFrame() === null;
    const method = request.method().toUpperCase();
    this.requests += 1;
    if (
      this.signal.aborted ||
      !/^https?:/i.test(url) ||
      !ALLOWED_METHODS.has(method) ||
      SKIPPED_TYPES.has(request.resourceType()) ||
      this.requests > MAX_REQUESTS_PER_PAGE
    ) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    this.inFlight += 1;
    this.lastActivity = Date.now();
    try {
      const body = request.postDataBuffer();
      const headers = await request.allHeaders();
      const response = await safeFetch(url, {
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal: this.signal,
        method,
        body: body && body.length <= MAX_POST_BYTES ? body : undefined,
        headers,
        accept: headers.accept,
        // Files are followed through every hop here; a page's own address is
        // reopened by `render`, so its relative links resolve against the new one.
        redirect: isNavigation ? "manual" : "follow",
      });

      const location = response.headers.location;
      if (isNavigation && response.status >= 300 && response.status < 400 && location) {
        this.pendingRedirect = new URL(String(location), url).href;
        await route.fulfill({ status: 200, contentType: "text/html", body: "" });
        return;
      }

      const out: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
        out[name] = Array.isArray(value) ? value.join("\n") : String(value);
      }
      if (method === "GET" && response.status === 200) this.keep(response);
      await route.fulfill({ status: response.status, headers: out, body: response.body });
    } catch (error) {
      if (isNavigation && error instanceof FetchError) this.navigationProblem = error.message;
      const reason = error instanceof FetchError && error.code === "timeout" ? "timedout" : "failed";
      await route.abort(error instanceof FetchError && error.code === "blocked" ? "blockedbyclient" : reason).catch(
        () => undefined,
      );
    } finally {
      this.inFlight -= 1;
      this.lastActivity = Date.now();
    }
  }

  private keep(response: SafeFetchResult): void {
    const size = response.body.length;
    if (size > MAX_RESPONSE_BYTES || this.cacheBytes + size > MAX_CACHE_BYTES) return;
    const key = response.url.split("#")[0];
    if (this.cache.has(key)) return;
    this.cache.set(key, response);
    this.cacheBytes += size;
  }

  /** Waits until no request has been open for a moment, or `maxMs` passes. */
  private async quiet(maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (Date.now() < until && !this.signal.aborted) {
      if (this.inFlight === 0 && Date.now() - this.lastActivity > 500) return;
      await wait(100);
    }
  }

  /**
   * Opens a page, lets it finish loading, scrolls through it, and returns its
   * markup. Returns a reason string when the page can't be used.
   */
  async render(url: string): Promise<RenderedPage | string> {
    this.requests = 0;
    this.navigationProblem = null;
    const page = await this.context.newPage();
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
    page.on("popup", (popup) => void popup.close().catch(() => undefined));
    const budget = Date.now() + PAGE_BUDGET_MS;
    try {
      let status = 0;
      let contentType = "";
      let target = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        this.pendingRedirect = null;
        try {
          const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
          status = response?.status() ?? 0;
          contentType = (await response?.headerValue("content-type")) ?? "";
        } catch (error) {
          // A page that never finishes loading can still be copied as far as it got.
          if (!(error instanceof Error && error.name === "TimeoutError")) {
            return this.navigationProblem ?? "Couldn't open that page in the browser.";
          }
          status = 200;
        }
        if (!this.pendingRedirect) break;
        if (hop === MAX_REDIRECTS) return "The site redirected too many times.";
        target = this.pendingRedirect;
      }
      if (status === 0) return this.navigationProblem ?? "Couldn't open that page in the browser.";

      const remaining = () => Math.max(0, budget - Date.now());
      await page.waitForLoadState("load", { timeout: Math.min(10_000, remaining()) }).catch(() => undefined);
      await this.quiet(Math.min(4_000, remaining()));
      await page.evaluate(`${SCROLL_THROUGH}(${Math.min(6_000, remaining())})`).catch(() => undefined);
      await this.quiet(Math.min(3_000, remaining()));
      await wait(300);

      const html = (await page.evaluate(SERIALIZE_PAGE)) as string;
      return { url: page.url(), status, contentType, html };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
