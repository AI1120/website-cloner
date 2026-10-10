import type { Project } from "@/types/project";

import { nodesToJsx } from "./html-to-jsx";
import { buildExport, type ExportFiles, type ExportTarget } from "./shared";

const reactTarget: ExportTarget = {
  label: "React",
  slug: "react",
  mountId: "root",
  componentExtension: "jsx",
  entryExtension: "jsx",
  dependencies: {
    react: "^19.0.0",
    "react-dom": "^19.0.0",
  },
  devDependencies: {
    "@vitejs/plugin-react": "^6.0.0",
    vite: "^8.0.0",
  },
  notes: [
    "Markup was rewritten as JSX: `class` became `className`, inline styles " +
      "became objects (without `!important`, which React cannot set), and " +
      "form fields use `defaultValue` / `defaultChecked` so they stay editable.",
    "Attributes that are not valid JSX names (`@click`, `:class`, " +
      "`x-on:click.prevent`, ...) were dropped, as were HTML comments.",
  ],

  renderComponent(page, bodyNodes) {
    return [
      `export function ${page.componentName}() {`,
      "  return (",
      nodesToJsx(bodyNodes, { indent: 2 }),
      "  );",
      "}",
      "",
    ].join("\n");
  },

  renderEntry(page, mountId) {
    return [
      'import { StrictMode } from "react";',
      'import { createRoot } from "react-dom/client";',
      "",
      `import { ${page.componentName} } from "../pages/${page.componentName}.jsx";`,
      "",
      `createRoot(document.getElementById(${JSON.stringify(mountId)})).render(`,
      "  <StrictMode>",
      `    <${page.componentName} />`,
      "  </StrictMode>,",
      ");",
      "",
    ].join("\n");
  },

  renderViteConfig(inputs) {
    return [
      'import { resolve } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      'import react from "@vitejs/plugin-react";',
      'import { defineConfig } from "vite";',
      "",
      'const root = fileURLToPath(new URL(".", import.meta.url));',
      "",
      "// A multi-page app: every cloned page is its own HTML entry.",
      "export default defineConfig({",
      '  appType: "mpa",',
      "  plugins: [react()],",
      "  build: {",
      "    rollupOptions: {",
      "      input: {",
      inputs,
      "      },",
      "    },",
      "  },",
      "});",
      "",
    ].join("\n");
  },
};

/**
 * Turns a cloned site folder into a Vite + React multi-page project. Returns
 * the project's files keyed by path; nothing is written to disk.
 */
export async function buildReactExport(
  siteDir: string,
  project: Project,
): Promise<ExportFiles> {
  return buildExport(siteDir, project, reactTarget);
}
