import type { AssetKind } from "@/lib/cloner/mime";
import { relativeFrom, splitHash, toAbsoluteUrl } from "@/lib/cloner/urls";

/**
 * Downloads an asset and returns its path inside the site folder, or null when
 * it could not be saved (the reference then keeps pointing at the source).
 */
export type ResolveAsset = (url: string, hint: AssetKind | null) => Promise<string | null>;

// Either `@import "x"` / `@import 'x'`, or any `url(...)` token.
const CSS_REFERENCE =
  /@import\s+(?:"([^"]+)"|'([^']+)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s][^)]*?))\s*\)/gi;

interface CssReference {
  start: number;
  end: number;
  raw: string;
  isImport: boolean;
  isUrlToken: boolean;
}

function findReferences(css: string): CssReference[] {
  const references: CssReference[] = [];
  CSS_REFERENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_REFERENCE.exec(css)) !== null) {
    const importTarget = match[1] ?? match[2];
    if (importTarget !== undefined) {
      references.push({
        start: match.index,
        end: match.index + match[0].length,
        raw: importTarget,
        isImport: true,
        isUrlToken: false,
      });
      continue;
    }
    const raw = match[3] ?? match[4] ?? match[5] ?? "";
    const before = css.slice(Math.max(0, match.index - 16), match.index);
    references.push({
      start: match.index,
      end: match.index + match[0].length,
      raw,
      isImport: /@import\s*$/i.test(before),
      isUrlToken: true,
    });
  }
  return references;
}

/**
 * Rewrites every `url()` and `@import` in a stylesheet (or inline style) so it
 * points at a locally saved copy.
 *
 * @param baseUrl  URL the CSS was served from, used to resolve relative paths.
 * @param fromFile Path of the file that will contain this CSS, relative to the
 *                 site folder, so the emitted paths are relative to it.
 */
export async function rewriteCss(
  css: string,
  baseUrl: string,
  fromFile: string,
  resolveAsset: ResolveAsset,
): Promise<string> {
  const references = findReferences(css);
  if (references.length === 0) return css;

  const replacements = await Promise.all(
    references.map(async (reference) => {
      const unescaped = reference.raw.replace(/\\(.)/g, "$1");
      const absolute = toAbsoluteUrl(unescaped, baseUrl);
      if (!absolute) return null;

      const { href, hash } = splitHash(absolute);
      const local = await resolveAsset(href, reference.isImport ? "css" : null);
      const target = local ? relativeFrom(fromFile, local) + hash : absolute.href;
      const quoted = `"${target.replace(/"/g, "%22")}"`;
      return reference.isUrlToken ? `url(${quoted})` : `@import ${quoted}`;
    }),
  );

  let output = "";
  let cursor = 0;
  references.forEach((reference, index) => {
    const replacement = replacements[index];
    if (replacement === null) return;
    output += css.slice(cursor, reference.start) + replacement;
    cursor = reference.end;
  });
  return output + css.slice(cursor);
}
