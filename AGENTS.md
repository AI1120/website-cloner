<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SiteCloner

## What This Is
A Next.js app for cloning websites by URL and building or changing sites with AI (see "SiteCloner App" below).

## Tech Stack
- **Framework:** Next.js 16 (App Router, React 19, TypeScript strict)
- **UI:** shadcn/ui (Base UI primitives, Tailwind CSS v4, `cn()` utility)
- **Icons:** Lucide React
- **3D:** three.js, for the start screen backdrop only (`hero-scene.ts`, loaded on demand by `hero-backdrop.tsx`)
- **Styling:** Tailwind CSS v4 with oklch design tokens
- **Deployment:** Vercel

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npm run typecheck` — TypeScript check
- `npm run check` — Run lint + typecheck + build

## Code Style
- TypeScript strict mode, no `any`
- Named exports, PascalCase components, camelCase utils
- Tailwind utilities or scoped CSS; avoid inline styles unless behavior needs dynamic values
- 2-space indentation
- Responsive: mobile-first

## Project Structure
```
src/
  app/              # Pages, API routes, preview and publish servers
  components/
    cloner/         # Start screen and workspace
    ui/             # shadcn/ui primitives
  lib/              # Engine code (see below); utils.ts has cn()
  types/            # TypeScript interfaces
  hooks/            # Custom React hooks
public/sc-bridge.js # Preview-frame bridge
templates/          # Built-in templates and the shadcn/ui kit for projects
```

## SiteCloner App
The app in `src/app/` is a studio for building sites with AI. Projects start from a prompt, a cloned site, a brand, an image, a Figma frame or a template.
- `src/lib/cloner/` — cloning engine: guarded fetching (`safe-fetch.ts`), page rendering in the installed Chrome/Edge (`browser.ts`, via playwright-core), "Compare with the original" (`compare.ts`: screenshots plus an in-browser canvas diff; the copy is served to the browser from disk at a `.invalid` address), HTML/CSS rewriting, storage, checkpoints (undo, and `checkpointChanges` for before/after diffs via `lib/diff.ts`), ZIP.
- `src/lib/ai/` — the AI agent: `provider.ts` picks Gemini or the Claude API (`providers/`), `agent.ts` runs the tool loop, `prompts.ts` and `tools.ts` define what it knows and can do, `jobs.ts` keeps requests running in the background, plus attachments, brand extraction and Figma import.
- `src/lib/build/` — turns project sources into a previewable site: `react.ts` bundles React projects with esbuild, `tailwind.ts` compiles Tailwind, `serve.ts` serves previews, `jsx.ts` and `text-edits.ts` map preview elements back to source, `flow.ts` finds screens and links.
- `src/lib/projects/` — project creation (starter files, templates, duplication) and design-system presets. `src/lib/data/` — the per-project database. `src/lib/export/` — React and Vue exporters for static sites.
- `src/app/api/projects/` — REST and streaming (NDJSON) endpoints; `src/app/api/data/` is the public data API generated apps call; `src/app/preview/`, `src/app/p/` and `src/app/template-preview/` serve project files.
- `src/components/cloner/` — start screen and workspace UI. `public/sc-bridge.js` runs inside the preview frame and talks to the workspace by `postMessage`. Show feedback with `toast` from `components/ui/toast.tsx`; add actions to the Ctrl+K palette (`command-palette.tsx`) when you add one to a screen. Chat replies go through the small Markdown renderer in `markdown.tsx` (React elements only, never raw HTML).
- Theme: `.dark` on `<html>`, set before paint by `THEME_SCRIPT` (`lib/theme.ts`) and kept in step by `useTheme`. Use the colour tokens in `globals.css` so new UI works in both themes.
- `templates/<slug>/` — built-in templates (`template.json` + `site/`). `templates/_ui/shadcn/` holds the shadcn/ui components copied into React + Tailwind projects that ask for them (generated with the shadcn CLI as JSX; regenerate rather than hand-edit).
- Projects are stored in `.clones/<id>/` (git-ignored): `meta.json`, `site/` (working copy), `build/`, `published/`, `checkpoints/`, `uploads/`, `data/`, `chat.json`, `design.md`.
- A project is either a static site (`framework: "html"`: cloned, or generated with Tailwind or inline styles) or a Vite-style React project (`framework: "react"`). Anything that changes files should go through `ChangeRecorder` so it can be undone, and `ensureBuilt` rebuilds what is derived.
- Project pages are untrusted content (third-party sites, AI output): they are always served with a `sandbox` Content-Security-Policy, and mutating API routes check the request origin. Keep both when adding routes. The Tailwind compiler is given no way to load plugins or files from a project.
- Every outbound request for a user-supplied URL must go through `safeFetch`, which blocks private and local addresses. That includes the cloning browser: `PageRenderer` answers every request it makes with `safeFetch`, closes WebSockets, and points the browser at a dead proxy so nothing else gets out. Keep all three when changing it.
- The Gemini provider paces requests and falls back across models; free keys allow about five requests a minute per model, so design AI features to need few model calls.
