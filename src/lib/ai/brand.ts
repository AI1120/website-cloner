import { decodeText, loadPage, pageTitle } from "@/lib/cloner/html";
import { safeFetch } from "@/lib/cloner/safe-fetch";
import { normalizeInputUrl, toAbsoluteUrl } from "@/lib/cloner/urls";

const MAX_STYLESHEETS = 6;
const MAX_STYLESHEET_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

function topEntries(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => `${value} (${count}×)`);
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Reads a website's visual identity from its CSS: the colors, fonts and corner
 * radii it uses most, its color variables, and how its buttons are styled.
 * Returns a text summary for the editing agent to restyle a project with.
 */
export async function describeBrand(input: string, signal: AbortSignal): Promise<string> {
  const url = normalizeInputUrl(input);
  const response = await safeFetch(url, {
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: TIMEOUT_MS,
    signal,
    accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The reference site answered with status ${response.status}.`);
  }

  const $ = loadPage(decodeText(response.body, response.contentType));
  const cssParts: string[] = [];
  $("style").each((_, element) => {
    cssParts.push($(element).text());
  });

  const fontLinks: string[] = [];
  const stylesheetUrls: string[] = [];
  $("link[href]").each((_, element) => {
    const rel = (element.attribs.rel ?? "").toLowerCase();
    if (!rel.includes("stylesheet")) return;
    const absolute = toAbsoluteUrl(element.attribs.href ?? "", response.url);
    if (!absolute) return;
    if (/fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net/.test(absolute.hostname)) {
      fontLinks.push(absolute.href);
    } else {
      stylesheetUrls.push(absolute.href);
    }
  });

  const sheets = await Promise.all(
    stylesheetUrls.slice(0, MAX_STYLESHEETS).map(async (href) => {
      try {
        const sheet = await safeFetch(href, {
          maxBytes: MAX_STYLESHEET_BYTES,
          timeoutMs: TIMEOUT_MS,
          signal,
          referer: response.url,
        });
        return sheet.status === 200 ? decodeText(sheet.body, sheet.contentType) : "";
      } catch {
        return "";
      }
    }),
  );
  const css = [...cssParts, ...sheets].join("\n");

  const colors = new Map<string, number>();
  for (const match of css.matchAll(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl|oklch)a?\([^)]{3,60}\)/gi)) {
    const color = match[0].toLowerCase().replace(/\s+/g, "");
    // Fully transparent values say nothing about the brand.
    if (/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/.test(color)) continue;
    count(colors, color);
  }

  const fonts = new Map<string, number>();
  for (const match of css.matchAll(/font-family\s*:\s*([^;}{]{2,160})/gi)) {
    const family = match[1].replace(/!important/i, "").replace(/\s+/g, " ").trim();
    if (!/^(?:inherit|initial|unset|var\()|[<>]/i.test(family)) count(fonts, family);
  }

  const radii = new Map<string, number>();
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}{]{1,40})/gi)) {
    count(radii, match[1].replace(/!important/i, "").trim());
  }

  const variables: string[] = [];
  const seenVariables = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9-]{2,50})\s*:\s*([^;}{]{1,80})/gi)) {
    const name = match[1];
    const value = match[2].trim();
    const looksLikeColor = /^(?:#|rgb|hsl|oklch)/i.test(value);
    const looksLikeFont = /font|family/i.test(name);
    // Skip utility-framework internals; they are plumbing, not brand choices.
    if (name.startsWith("--tw-") || value === "initial") continue;
    if ((!looksLikeColor && !looksLikeFont) || seenVariables.has(name)) continue;
    seenVariables.add(name);
    variables.push(`${name}: ${value}`);
    if (variables.length >= 40) break;
  }

  const buttonRules: string[] = [];
  let buttonChars = 0;
  for (const match of css.matchAll(/([^{}]{1,200})\{([^{}]{10,400})\}/g)) {
    const selector = match[1].trim();
    if (!/(?:^|[\s,>.])(?:button|\.btn|\.button|\[type=["']?submit)/i.test(selector)) continue;
    if (!/background|border|color|radius|padding/i.test(match[2])) continue;
    const rule = `${selector.slice(0, 120)} { ${match[2].replace(/\s+/g, " ").trim()} }`;
    buttonChars += rule.length;
    if (buttonChars > 1800) break;
    buttonRules.push(rule);
  }

  const themeColor = $('meta[name="theme-color"]').attr("content");
  const lines = [
    `Brand reference: ${pageTitle($) || response.url} (${response.url})`,
    themeColor ? `Theme color: ${themeColor}` : "",
    `Most used colors: ${topEntries(colors, 14).join(", ") || "(none found)"}`,
    `Font families: ${topEntries(fonts, 6).join(" | ") || "(none found)"}`,
    fontLinks.length > 0 ? `Font stylesheets it loads: ${fontLinks.slice(0, 4).join(" , ")}` : "",
    `Corner radii: ${topEntries(radii, 5).join(", ") || "(none found)"}`,
    variables.length > 0 ? `Color and font variables:\n${variables.join("\n")}` : "",
    buttonRules.length > 0 ? `Button styles:\n${buttonRules.join("\n")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
