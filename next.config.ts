import type { NextConfig } from "next";

type RenameCallback = (error?: NodeJS.ErrnoException | null) => void;

interface CacheFileSystem {
  rename(from: string, to: string, callback: RenameCallback): void;
}

/** Errors Windows gives while another process briefly has a file open. */
const LOCKED_FILE_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"]);
const RENAME_RETRY_MS = 5_000;

/**
 * Webpack saves its build cache by writing "<file>_" and renaming it over
 * "<file>". On Windows, antivirus scanning locks a file for a few milliseconds
 * right after it is written, so the rename often fails and webpack logs
 * "Caching failed for pack: Error: EBUSY". This retries the rename until the
 * lock clears instead of dropping that part of the cache.
 */
class RetryLockedCacheRenames {
  apply(compiler: { intermediateFileSystem: CacheFileSystem | null }) {
    const fs = compiler.intermediateFileSystem;
    if (!fs) return;
    // Plugins are applied before webpack sets up its cache, which then uses this.
    compiler.intermediateFileSystem = Object.assign(Object.create(fs) as CacheFileSystem, {
      rename(from: string, to: string, callback: RenameCallback) {
        const started = Date.now();
        const attempt = (delay: number) => {
          fs.rename(from, to, (error) => {
            const locked = error?.code !== undefined && LOCKED_FILE_ERRORS.has(error.code);
            if (locked && Date.now() - started < RENAME_RETRY_MS) {
              setTimeout(() => attempt(Math.min(delay * 2, 250)), delay);
            } else {
              callback(error);
            }
          });
        };
        attempt(10);
      },
    });
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // The app is as often opened at 127.0.0.1 as at localhost while developing.
  allowedDevOrigins: ["127.0.0.1"],
  // Build tools the server runs for generated projects. They ship native
  // binaries or load their own files at run time, so they must not be bundled.
  serverExternalPackages: ["esbuild", "typescript", "tailwindcss", "@tailwindcss/oxide"],
  // Cloned sites are runtime data, not part of the app bundle.
  outputFileTracingExcludes: {
    "/*": [".clones/**/*"],
  },
  // Read from disk at run time rather than imported, so tracing can't see them:
  // the built-in templates, Tailwind's stylesheets, and the packages that
  // generated React projects are bundled with.
  outputFileTracingIncludes: {
    "/*": [
      "templates/**/*",
      "node_modules/tailwindcss/*.css",
      "node_modules/{react,react-dom,scheduler,react-router,react-router-dom,cookie,set-cookie-parser,lucide-react,clsx}/**/*",
      // The shadcn/ui components some projects include, and what those import.
      "node_modules/{class-variance-authority,tailwind-merge,reselect,tabbable,use-sync-external-store}/**/*",
      "node_modules/@base-ui/{react,utils}/**/*",
      "node_modules/@floating-ui/{core,dom,react-dom,utils}/**/*",
      "node_modules/@babel/runtime/**/*",
      "node_modules/tw-animate-css/dist/*.css",
      "node_modules/shadcn/dist/tailwind.css",
    ],
  },
  webpack: (config: { plugins: unknown[] }) => {
    if (process.platform === "win32") config.plugins.push(new RetryLockedCacheRenames());
    return config;
  },
};

export default nextConfig;
