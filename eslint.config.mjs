import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloned sites created by the app (third-party code, not ours to lint).
    ".clones/**",
    // Built-in templates are plain websites, not part of the Next.js app.
    "templates/**",
  ]),
]);

export default eslintConfig;
