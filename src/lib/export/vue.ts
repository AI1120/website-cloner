import type { Project } from "@/types/project";

import { nodesToVueTemplate } from "./html-to-vue";
import { buildExport, type ExportFiles, type ExportTarget } from "./shared";

const vueTarget: ExportTarget = {
  label: "Vue",
  slug: "vue",
  mountId: "app",
  componentExtension: "vue",
  entryExtension: "js",
  dependencies: {
    vue: "^3.5.0",
  },
  devDependencies: {
    "@vitejs/plugin-vue": "^6.0.0",
    vite: "^8.0.0",
  },
  notes: [
    "Markup was rewritten as Vue templates. Attributes Vue would read as " +
      "directives (`@...`, `:...`, `v-...`, `#...`, `x-...`) were dropped, as " +
      "were HTML comments, and literal `{{` in text is escaped.",
    "`vite.config.js` tells the template compiler to treat every lowercase " +
      "tag as a plain element and to leave `/assets/...` URLs alone. " +
      "Components you add must use PascalCase tags (`<MyWidget />`).",
  ],

  renderComponent(_page, bodyNodes) {
    const content = nodesToVueTemplate(bodyNodes, { indent: 1 });
    return content === ""
      ? "<template></template>\n"
      : `<template>\n${content}\n</template>\n`;
  },

  renderEntry(page, mountId) {
    return [
      'import { createApp } from "vue";',
      "",
      `import ${page.componentName} from "../pages/${page.componentName}.vue";`,
      "",
      `createApp(${page.componentName}).mount(${JSON.stringify(`#${mountId}`)});`,
      "",
    ].join("\n");
  },

  renderViteConfig(inputs) {
    return [
      'import { resolve } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      'import vue from "@vitejs/plugin-vue";',
      'import { defineConfig } from "vite";',
      "",
      'const root = fileURLToPath(new URL(".", import.meta.url));',
      "",
      "// A multi-page app: every cloned page is its own HTML entry.",
      "export default defineConfig({",
      '  appType: "mpa",',
      "  plugins: [",
      "    vue({",
      "      template: {",
      "        // Asset URLs point at files in public/ and stay as written.",
      "        transformAssetUrls: false,",
      "        compilerOptions: {",
      "          // The pages are plain markup: lowercase tags are elements,",
      "          // only PascalCase tags are resolved as Vue components.",
      "          isCustomElement: (tag) => !/^[A-Z]/.test(tag),",
      "        },",
      "      },",
      "    }),",
      "  ],",
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
 * Turns a cloned site folder into a Vite + Vue 3 multi-page project. Returns
 * the project's files keyed by path; nothing is written to disk.
 */
export async function buildVueExport(
  siteDir: string,
  project: Project,
): Promise<ExportFiles> {
  return buildExport(siteDir, project, vueTarget);
}
