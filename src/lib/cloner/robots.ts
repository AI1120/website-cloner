import { safeFetch } from "@/lib/cloner/safe-fetch";

interface Rule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

export type RobotsCheck = (url: URL) => boolean;

function toPattern(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Rules of the group that applies to every crawler (`User-agent: *`). */
function parseRobots(text: string): Rule[] {
  const rules: Rule[] = [];
  let agents: string[] = [];
  let readingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!readingAgents) agents = [];
      agents.push(value.toLowerCase());
      readingAgents = true;
      continue;
    }
    readingAgents = false;

    if ((field === "allow" || field === "disallow") && agents.includes("*") && value) {
      rules.push({ allow: field === "allow", pattern: toPattern(value), length: value.length });
    }
  }
  return rules;
}

/**
 * Loads a site's robots.txt and returns a check for whether a page may be
 * crawled. A missing or unreadable robots.txt allows everything.
 */
export async function loadRobots(origin: string, signal: AbortSignal): Promise<RobotsCheck> {
  let rules: Rule[] = [];
  try {
    const response = await safeFetch(new URL("/robots.txt", origin).href, {
      maxBytes: 512 * 1024,
      timeoutMs: 8000,
      signal,
      accept: "text/plain,*/*;q=0.5",
    });
    const isText = !/html/i.test(response.contentType);
    if (response.status === 200 && isText) {
      rules = parseRobots(response.body.toString("utf8"));
    }
  } catch {
    rules = [];
  }

  return (url) => {
    const target = url.pathname + url.search;
    let best: Rule | null = null;
    for (const rule of rules) {
      if (!rule.pattern.test(target)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) {
        best = rule;
      }
    }
    return best ? best.allow : true;
  };
}
