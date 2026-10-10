import fs from "node:fs/promises";
import path from "node:path";

import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

export interface TailwindSource {
  content: string;
  /** File extension without the dot, e.g. "html" or "jsx". */
  extension: string;
}

export const DEFAULT_TAILWIND_INPUT = '@import "tailwindcss";\n';

/** Stylesheets of trusted packages that the shadcn/ui components need, by import name. */
const EXTRA_STYLESHEETS: Record<string, string[]> = {
  "tw-animate-css": ["tw-animate-css", "dist", "tw-animate.css"],
  "shadcn/tailwind.css": ["shadcn", "dist", "tailwind.css"],
};

function tailwindRoot(): string {
  return path.join(process.cwd(), "node_modules", "tailwindcss");
}

/** True when a stylesheet is meant to be compiled by Tailwind. */
export function usesTailwind(css: string): boolean {
  return /@import\s+(?:url\()?["']tailwindcss/.test(css) || /@tailwind\s/.test(css);
}

/**
 * Compiles a Tailwind v4 stylesheet for the classes used in `sources`.
 *
 * Project stylesheets are written by the AI or the person and may be shaped by
 * content from cloned sites, so the compiler only gets Tailwind's own files:
 * it cannot load plugins, config modules, or other stylesheets from disk.
 */
export async function compileTailwind(input: string, sources: TailwindSource[]): Promise<string> {
  const root = tailwindRoot();
  const compiler = await compile(input, {
    base: root,
    loadStylesheet: async (id) => {
      const extra = EXTRA_STYLESHEETS[id];
      if (extra) {
        const file = path.join(process.cwd(), "node_modules", ...extra);
        return { path: file, base: path.dirname(file), content: await fs.readFile(file, "utf8") };
      }
      if (id !== "tailwindcss" && !/^tailwindcss\/[a-z]+(?:\.css)?$/.test(id)) {
        throw new Error(`Only "tailwindcss" and the component library's stylesheets can be imported here (found "${id}").`);
      }
      const name = id === "tailwindcss" ? "index" : id.slice("tailwindcss/".length);
      const file = path.join(root, name.endsWith(".css") ? name : `${name}.css`);
      return { path: file, base: root, content: await fs.readFile(file, "utf8") };
    },
    loadModule: async (id) => {
      throw new Error(`Tailwind plugins and config files are not supported (found "${id}").`);
    },
  });

  const candidates = new Scanner({}).scanFiles(
    sources.map((source) => ({ content: source.content, extension: source.extension })),
  );
  return compiler.build(candidates);
}
