import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  designSystemPath,
  isValidId,
  pathExists,
  projectDir,
  readJson,
  readProject,
  siteDir,
  writeProject,
} from "@/lib/cloner/storage";
import { slugify } from "@/lib/cloner/urls";
import type {
  Framework,
  Project,
  ProjectSource,
  Styling,
  TemplateInfo,
  UiLibrary,
} from "@/types/project";

function newProjectId(label: string): string {
  const stem = slugify(label, 40) || "project";
  return `${stem}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}

/** A readable project name from the first words of a prompt. */
export function nameFromPrompt(prompt: string, fallback: string): string {
  const words = prompt.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ");
  const name = words.length > 56 ? `${words.slice(0, 55).trimEnd()}…` : words;
  return name || fallback;
}

const PLACEHOLDER_STYLE =
  "min-height:100vh;display:grid;place-items:center;margin:0;font-family:system-ui,sans-serif;color:#64748b;background:#f8fafc";

function htmlScaffold(name: string, styling: Styling): Record<string, string> {
  const title = name.replace(/[<>&]/g, "");
  if (styling === "tailwind") {
    return {
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <link rel="stylesheet" href="assets/css/tailwind.css">
  </head>
  <body class="grid min-h-screen place-items-center bg-slate-50 font-sans text-slate-500">
    <p>Your page will appear here.</p>
  </body>
</html>
`,
      "tailwind.config.css": `@import "tailwindcss";

@theme {
  /* Design tokens, e.g. --color-brand-500: #4f46e5; --font-display: "Inter", sans-serif; */
}
`,
    };
  }
  return {
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="${PLACEHOLDER_STYLE}">
    <p>Your page will appear here.</p>
  </body>
</html>
`,
  };
}

function reactScaffold(name: string, styling: Styling, shadcn: boolean): Record<string, string> {
  const title = name.replace(/[<>&]/g, "");
  const tailwind = styling === "tailwind";
  const packageJson = {
    name: slugify(name, 40) || "app",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies: {
      ...(shadcn ? { "@base-ui/react": "^1.3.0", "class-variance-authority": "^0.7.1", clsx: "^2.1.1" } : {}),
      "lucide-react": "^1.6.0",
      react: "^19.2.0",
      "react-dom": "^19.2.0",
      "react-router-dom": "^7.9.0",
      ...(shadcn ? { shadcn: "^4.1.0", "tailwind-merge": "^3.5.0", "tw-animate-css": "^1.4.0" } : {}),
    },
    devDependencies: {
      ...(tailwind ? { "@tailwindcss/vite": "^4.1.0" } : {}),
      "@vitejs/plugin-react": "^6.0.0",
      ...(tailwind ? { tailwindcss: "^4.1.0" } : {}),
      vite: "^8.0.0",
    },
  };

  return {
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    "src/main.jsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    "src/App.jsx": tailwind
      ? `export default function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 bg-[radial-gradient(60%_45%_at_50%_0%,#ede9fe,transparent)] p-6 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl shadow-slate-200/70 backdrop-blur">
        <div className="mb-5 flex gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-300" />
          <span className="size-2.5 rounded-full bg-amber-300" />
          <span className="size-2.5 rounded-full bg-emerald-300" />
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-2/3 rounded-md bg-slate-200" />
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="h-3 w-5/6 rounded bg-slate-100" />
          <div className="mt-5 h-24 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100" />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Your app will appear here.</p>
      </div>
    </main>
  );
}
`
      : `const bar = (width, color = "#f1f5f9", height = 12) => ({
  height,
  width,
  borderRadius: 6,
  background: color,
  marginTop: 12,
});

export default function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        background: "radial-gradient(60% 45% at 50% 0%, #ede9fe, transparent), #f8fafc",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 448,
          padding: 24,
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          background: "rgba(255, 255, 255, 0.85)",
          boxShadow: "0 20px 40px -20px rgba(15, 23, 42, 0.25)",
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {["#fda4af", "#fcd34d", "#6ee7b7"].map((color) => (
            <span key={color} style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
          ))}
        </div>
        <div style={bar("66%", "#e2e8f0", 20)} />
        <div style={bar("100%")} />
        <div style={bar("83%")} />
        <div style={{ ...bar("100%", "linear-gradient(135deg, #ede9fe, #fae8ff)", 96), borderRadius: 12, marginTop: 20 }} />
        <p style={{ marginTop: 24, textAlign: "center", fontSize: 14, color: "#64748b" }}>Your app will appear here.</p>
      </div>
    </main>
  );
}
`,
    "src/index.css": tailwind
      ? `@import "tailwindcss";

@theme {
  /* Design tokens, e.g. --color-brand-500: #4f46e5; --font-display: "Inter", sans-serif; */
}
`
      : `*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
}
`,
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "vite.config.js": tailwind
      ? `import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so the built site works from any folder.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
});
`
      : `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so the built site works from any folder.
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": "/src" } },
});
`,
    ".gitignore": "node_modules\ndist\n",
  };
}

export interface NewProjectInput {
  name: string;
  source: ProjectSource;
  framework: Framework;
  styling: Styling;
  uiLibrary?: UiLibrary;
  designSystem?: { name: string; content: string } | null;
  /** The site or design the project is based on, if any. */
  url?: string;
  /** True when the first build still has to be run by the workspace. */
  pending: boolean;
}

function blankProject(id: string, input: NewProjectInput): Project {
  const now = new Date().toISOString();
  let host = "";
  try {
    host = input.url ? new URL(input.url).hostname.replace(/^www\./i, "") : "";
  } catch {
    host = "";
  }
  return {
    id,
    name: input.name,
    source: input.source,
    framework: input.framework,
    styling: input.styling,
    uiLibrary: input.uiLibrary ?? "none",
    designSystem: input.designSystem?.name ?? null,
    pending: input.pending,
    url: input.url ?? "",
    finalUrl: input.url ?? "",
    host,
    createdAt: now,
    updatedAt: now,
    options: { maxPages: 1, keepScripts: true },
    stats: { assets: 0, bytes: 0 },
    entry: "index.html",
    icon: null,
    pages: [{ url: "", path: "index.html", title: input.name }],
    warnings: [],
    published: null,
    checkpoints: [],
  };
}

/** Creates a project with the starting files for its framework and styling. */
export async function createScaffoldProject(input: NewProjectInput): Promise<Project> {
  const id = newProjectId(input.name);
  const root = siteDir(id);
  // The component library is built on Tailwind, so it only goes with that combination.
  const shadcn =
    input.uiLibrary === "shadcn" && input.framework === "react" && input.styling === "tailwind";
  const files =
    input.framework === "react"
      ? reactScaffold(input.name, input.styling, shadcn)
      : htmlScaffold(input.name, input.styling);

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  if (shadcn) {
    // Components, the cn() helper and the theme stylesheet they are styled by.
    await fs.cp(path.join(uiLibraryDir("shadcn"), "src"), path.join(root, "src"), { recursive: true });
  }
  if (input.designSystem) {
    await fs.writeFile(designSystemPath(id), input.designSystem.content, "utf8");
  }

  const project = blankProject(id, { ...input, uiLibrary: shadcn ? "shadcn" : "none" });
  await writeProject(project);
  return project;
}

/** Folder holding the files of a component library that projects can include. */
function uiLibraryDir(name: string): string {
  return path.join(templatesRoot(), "_ui", name);
}

function templatesRoot(): string {
  return path.join(process.cwd(), "templates");
}

const TEMPLATE_SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

/** Folder holding a template's files, or null for a name that isn't a template. */
export function templateSiteDir(slug: string): string | null {
  return TEMPLATE_SLUG.test(slug) ? path.join(templatesRoot(), slug, "site") : null;
}

interface TemplateManifest {
  name?: string;
  description?: string;
  framework?: Framework;
  styling?: Styling;
}

async function readTemplate(slug: string): Promise<TemplateInfo | null> {
  const site = templateSiteDir(slug);
  if (!site) return null;
  const manifest = await readJson<TemplateManifest>(path.join(templatesRoot(), slug, "template.json"));
  if (!manifest?.name || !(await pathExists(path.join(site, "index.html")))) return null;
  return {
    slug,
    name: manifest.name,
    description: manifest.description ?? "",
    framework: manifest.framework === "react" ? "react" : "html",
    styling: manifest.styling === "inline" ? "inline" : "tailwind",
    entry: "index.html",
  };
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(templatesRoot());
  } catch {
    return [];
  }
  const templates = await Promise.all(entries.sort().map((slug) => readTemplate(slug)));
  return templates.filter((template): template is TemplateInfo => template !== null);
}

/** A pseudo-project that lets a template be built and previewed like a project. */
export async function findTemplate(slug: string): Promise<TemplateInfo | null> {
  return readTemplate(slug);
}

async function htmlPages(root: string): Promise<{ path: string; title: string }[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const pages: { path: string; title: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
    const html = await fs.readFile(path.join(root, entry.name), "utf8");
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
    pages.push({ path: entry.name, title: title || entry.name });
  }
  // The entry page first, then the rest by name.
  return pages.sort((a, b) =>
    a.path === "index.html" ? -1 : b.path === "index.html" ? 1 : a.path.localeCompare(b.path),
  );
}

/** Starts a project as a copy of a built-in template. */
export async function createFromTemplate(slug: string): Promise<Project | null> {
  const template = await readTemplate(slug);
  const source = templateSiteDir(slug);
  if (!template || !source) return null;

  const id = newProjectId(template.name);
  await fs.cp(source, siteDir(id), { recursive: true });
  const project = blankProject(id, {
    name: template.name,
    source: "template",
    framework: template.framework,
    styling: template.styling,
    pending: false,
  });
  if (template.framework === "html") {
    const pages = await htmlPages(siteDir(id));
    project.pages = pages.map((page) => ({ url: "", ...page }));
  }
  await writeProject(project);
  return project;
}

/** Makes an independent copy of a project: its files, design system and data. */
export async function duplicateProject(id: string): Promise<Project | null> {
  const original = await readProject(id);
  if (!original || !isValidId(id)) return null;

  const copyId = newProjectId(original.name);
  await fs.cp(siteDir(id), siteDir(copyId), { recursive: true });
  for (const extra of ["design.md", "data"]) {
    const from = path.join(projectDir(id), extra);
    if (await pathExists(from)) {
      await fs.cp(from, path.join(projectDir(copyId), extra), { recursive: true });
    }
  }

  const now = new Date().toISOString();
  const copy: Project = {
    ...original,
    id: copyId,
    name: `${original.name} (copy)`.slice(0, 120),
    createdAt: now,
    updatedAt: now,
    pending: false,
    published: null,
    checkpoints: [],
  };
  await writeProject(copy);
  return copy;
}
