import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

// Sites vary their markup, CSS, and font formats by browser, so requests
// identify as a current desktop browser to receive what a visitor would see.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 5;

export type FetchErrorCode =
  | "blocked"
  | "invalid"
  | "timeout"
  | "too-large"
  | "aborted"
  | "network";

export class FetchError extends Error {
  readonly code: FetchErrorCode;

  constructor(message: string, code: FetchErrorCode) {
    super(message);
    this.name = "FetchError";
    this.code = code;
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  accept?: string;
  referer?: string;
  /** GET unless given; the cloning browser also sends a page's POST requests. */
  method?: string;
  body?: Buffer;
  /** Extra request headers. The user agent and accepted encodings stay this module's own. */
  headers?: Record<string, string>;
  /**
   * "manual" returns a redirect response as it is instead of following it, for
   * callers (the cloning browser) that follow redirects themselves.
   */
  redirect?: "follow" | "manual";
}

export interface SafeFetchResult {
  /** URL after following redirects. */
  url: string;
  status: number;
  contentType: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Request headers a caller may not set: they belong to this module or to the connection. */
const RESERVED_HEADERS = new Set([
  "user-agent",
  "accept-encoding",
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailer",
]);

// Addresses the server must never fetch on a user's behalf: loopback, private
// networks, link-local (cloud metadata lives there), and reserved ranges.
const blockList = new net.BlockList();
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
];
for (const [address, prefix] of BLOCKED_V4) {
  blockList.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of BLOCKED_V6) {
  blockList.addSubnet(address, prefix, "ipv6");
}

/** How to allow private addresses, for messages about blocked ones. */
const PRIVATE_HINT =
  "To clone sites on your own network, set CLONER_ALLOW_PRIVATE_HOSTS=1 in .env.local and restart the app (only where nobody else can reach it).";

function allowPrivateHosts(): boolean {
  return process.env.CLONER_ALLOW_PRIVATE_HOSTS === "1";
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

/**
 * Checks a URL before any request is made. Returns the parsed URL or throws.
 * Hostnames that resolve to private addresses are caught later, at connect
 * time, by the guarded DNS lookup.
 */
export function assertPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError("That is not a valid web address.", "invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("Only http and https addresses can be cloned.", "invalid");
  }
  url.username = "";
  url.password = "";
  if (allowPrivateHosts()) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 ? isBlockedAddress(host) : isBlockedHostname(host)) {
    throw new FetchError(
      `That address is on a private or local network, which is blocked by default. ${PRIVATE_HINT}`,
      "blocked",
    );
  }
  return url;
}

// Validates the addresses actually used for the connection, so a hostname
// can't pass a check and then resolve somewhere else (DNS rebinding).
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) {
      callback(new FetchError(`No address found for ${hostname}.`, "network"), "", 0);
      return;
    }
    if (!allowPrivateHosts() && list.some((entry) => isBlockedAddress(entry.address))) {
      callback(
        new FetchError(
          `${hostname} resolves to a private address here (${list.find((entry) => isBlockedAddress(entry.address))?.address}), so it's blocked. ` +
            "If it's a public site, a VPN, proxy or network filter on this computer is answering with a stand-in address; turning it off for this site, or using another DNS mode, fixes it. " +
            PRIVATE_HINT,
          "blocked",
        ),
        "",
        0,
      );
      return;
    }
    if (options.all) {
      callback(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function toFetchError(error: unknown, signal?: AbortSignal): FetchError {
  if (error instanceof FetchError) return error;
  if (signal?.aborted) return new FetchError("Cancelled.", "aborted");
  const message = error instanceof Error ? error.message : String(error);
  return new FetchError(message, "network");
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {
      accept: options.accept ?? "*/*",
      "accept-language": "en-US,en;q=0.9",
    };
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      const key = name.toLowerCase();
      if (!RESERVED_HEADERS.has(key) && !key.startsWith(":")) headers[key] = value;
    }
    headers["user-agent"] = USER_AGENT;
    headers["accept-encoding"] = "gzip, deflate, br";
    if (options.referer) headers.referer = options.referer;
    if (options.body) headers["content-length"] = String(options.body.length);

    const request = transport.request(url, {
      method: options.method ?? "GET",
      headers,
      lookup: guardedLookup,
      signal: options.signal,
    });

    let settled = false;
    const timer = setTimeout(() => {
      request.destroy(new FetchError("The site took too long to respond.", "timeout"));
    }, options.timeoutMs);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(toFetchError(error, options.signal));
    };

    request.on("error", fail);
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      response.on("error", fail);

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        settled = true;
        clearTimeout(timer);
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }

      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        request.destroy(new FetchError("The file is too large.", "too-large"));
        return;
      }

      let stream: Readable = response;
      const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
      if (encoding === "gzip" || encoding === "x-gzip") {
        stream = response.pipe(zlib.createGunzip());
      } else if (encoding === "deflate") {
        stream = response.pipe(zlib.createInflate());
      } else if (encoding === "br") {
        stream = response.pipe(zlib.createBrotliDecompress());
      }

      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("error", fail);
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          request.destroy(new FetchError("The file is too large.", "too-large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, headers: response.headers, body: Buffer.concat(chunks) });
      });
    });
    request.end(options.body);
  });
}

/**
 * Fetches a public http(s) URL with redirect, size, and time limits. Every
 * hop is re-validated so a redirect can't lead into a private network.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  let url = assertPublicUrl(input);
  let current = options;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (options.signal?.aborted) throw new FetchError("Cancelled.", "aborted");
    const response = await requestOnce(url, current);

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (isRedirect && options.redirect !== "manual") {
      let next: URL;
      try {
        next = new URL(String(response.headers.location), url);
      } catch {
        throw new FetchError("The site sent an invalid redirect.", "network");
      }
      url = assertPublicUrl(next.href);
      // As browsers do: only 307 and 308 repeat the method and body.
      if (response.status !== 307 && response.status !== 308) {
        current = { ...current, method: undefined, body: undefined };
      }
      continue;
    }

    return {
      url: url.href,
      status: response.status,
      contentType: String(response.headers["content-type"] ?? ""),
      headers: response.headers,
      body: response.body,
    };
  }

  throw new FetchError("The site redirected too many times.", "network");
}
