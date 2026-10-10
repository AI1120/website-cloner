import fs from "node:fs/promises";
import path from "node:path";

import * as esbuild from "esbuild";

import { isScriptFile, tagJsxLocations } from "@/lib/build/jsx";
import { compileTailwind, usesTailwind, type TailwindSource } from "@/lib/build/tailwind";
import type { BuildMessage } from "@/types/project";

export type ReactBuild =
  | { ok: true; js: string; css: string }
  | { ok: false; errors: BuildMessage[] };

const ENTRY_CANDIDATES = ["src/main.jsx", "src/main.tsx", "src/main.js", "src/index.jsx", "src/index.tsx"];
const MODULE_SCRIPT = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
const SOURCE_EXTENSION = /\.(?:jsx?|tsx?|mjs|html)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** The script the app starts from: the module script in index.html, or a conventional file. */
async function findEntry(siteRoot: string): Promise<string | null> {
  try {
    const html = await fs.readFile(path.join(siteRoot, "index.html"), "utf8");
    for (const match of html.matchAll(MODULE_SCRIPT)) {
      const source = match[1];
      if (/^(?:https?:)?\/\//i.test(source)) continue;
      const relative = source.replace(/^\.?\/+/, "");
      if (await exists(path.join(siteRoot, relative))) return relative;
    }
  } catch {
    // No index.html; fall through to the conventional names.
  }
  for (const candidate of ENTRY_CANDIDATES) {
    if (await exists(path.join(siteRoot, candidate))) return candidate;
  }
  return null;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Text of every source file, for Tailwind to find the classes in use. */
async function collectSources(siteRoot: string): Promise<TailwindSource[]> {
  const sources: TailwindSource[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(full);
        } else if (SOURCE_EXTENSION.test(entry.name)) {
          sources.push({
            content: await fs.readFile(full, "utf8"),
            extension: path.extname(entry.name).slice(1),
          });
        }
      }),
    );
  };
  await visit(siteRoot);
  return sources;
}

function toMessages(siteRoot: string, messages: esbuild.Message[]): BuildMessage[] {
  return messages.slice(0, 12).map((message) => {
    const location = message.location;
    let file: string | null = null;
    if (location?.file) {
      const absolute = path.isAbsolute(location.file)
        ? location.file
        : path.resolve(siteRoot, location.file);
      const relative = toPosix(path.relative(siteRoot, absolute));
      file = relative.startsWith("..") ? toPosix(location.file) : relative;
    }
    return {
      text: message.text,
      file,
      line: location?.line ?? null,
      column: location ? location.column + 1 : null,
    };
  });
}

/**
 * Bundles a React project (a Vite-style folder with `index.html` and `src/`)
 * into one script and one stylesheet.
 *
 * In preview mode elements are tagged with their source location for the
 * editor; production output is minified and untagged.
 */
export async function buildReactApp(
  siteRoot: string,
  mode: "preview" | "production",
): Promise<ReactBuild> {
  const entry = await findEntry(siteRoot);
  if (!entry) {
    return {
      ok: false,
      errors: [
        {
          text: 'No entry script found. index.html needs <script type="module" src="/src/main.jsx"></script>.',
          file: "index.html",
          line: null,
          column: null,
        },
      ],
    };
  }

  const preview = mode === "preview";
  const plugin: esbuild.Plugin = {
    name: "project-sources",
    setup(build) {
      build.onLoad({ filter: /\.(?:jsx?|tsx?|mjs)$/ }, async (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const source = await fs.readFile(args.path, "utf8");
        const relative = toPosix(path.relative(siteRoot, args.path));
        return {
          contents: preview && isScriptFile(relative) ? tagJsxLocations(source, relative) : source,
          loader: /\.tsx?$/i.test(args.path) ? "tsx" : "jsx",
        };
      });
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const source = await fs.readFile(args.path, "utf8");
        if (!usesTailwind(source)) return undefined;
        try {
          return { contents: await compileTailwind(source, await collectSources(siteRoot)), loader: "css" };
        } catch (error) {
          return {
            errors: [{ text: `Tailwind: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      });
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: [path.join(siteRoot, entry)],
      absWorkingDir: siteRoot,
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      outdir: path.join(siteRoot, "dist"),
      entryNames: "app",
      jsx: "automatic",
      // "@/components/ui/button" style imports, as in the exported Vite project.
      alias: { "@": path.join(siteRoot, "src") },
      minify: !preview,
      legalComments: "none",
      define: { "process.env.NODE_ENV": JSON.stringify(preview ? "development" : "production") },
      loader: {
        ".svg": "dataurl",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".webp": "dataurl",
        ".avif": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
      },
      // Projects don't have their own node_modules; packages come from the app's.
      nodePaths: [path.join(process.cwd(), "node_modules")],
      logLevel: "silent",
      plugins: [plugin],
    });

    const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    return { ok: true, js, css };
  } catch (error) {
    const failure = error as Partial<esbuild.BuildFailure>;
    if (Array.isArray(failure.errors) && failure.errors.length > 0) {
      return { ok: false, errors: toMessages(siteRoot, failure.errors) };
    }
    return {
      ok: false,
      errors: [
        {
          text: error instanceof Error ? error.message : "The build failed.",
          file: null,
          line: null,
          column: null,
        },
      ],
    };
  }
}

/**
 * Turns the project's index.html into the page that loads the bundle: the
 * module script that Vite would process is replaced by the built files.
 */
export function renderReactIndex(html: string, scriptHref: string, styleHref: string): string {
  const withoutEntry = html.replace(MODULE_SCRIPT, (tag, source: string) =>
    /^(?:https?:)?\/\//i.test(source) ? tag : "",
  );
  const style = `<link rel="stylesheet" href="${styleHref}">`;
  const script = `<script defer src="${scriptHref}"></script>`;
  const withStyle = /<\/head>/i.test(withoutEntry)
    ? withoutEntry.replace(/<\/head>/i, `${style}</head>`)
    : `${style}${withoutEntry}`;
  return /<\/body>/i.test(withStyle)
    ? withStyle.replace(/<\/body>/i, `${script}</body>`)
    : `${withStyle}${script}`;
}
