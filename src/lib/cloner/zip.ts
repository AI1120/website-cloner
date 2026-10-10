import fs from "node:fs/promises";
import path from "node:path";

import { zipSync, type Zippable } from "fflate";

import { extensionOf } from "@/lib/cloner/mime";
import { listFiles } from "@/lib/cloner/storage";

// Already-compressed formats: storing them is faster and no larger.
const STORED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "woff",
  "woff2",
  "mp4",
  "webm",
  "mov",
  "mp3",
  "ogg",
  "m4a",
  "aac",
  "pdf",
]);

/** Reads every file under a folder into a map of zip path → bytes. */
export async function readDirectory(
  root: string,
  prefix = "",
): Promise<Record<string, Uint8Array>> {
  const files = await listFiles(root);
  const entries = await Promise.all(
    files.map(async (file) => {
      const data = await fs.readFile(path.join(root, ...file.path.split("/")));
      return [`${prefix}${file.path}`, new Uint8Array(data)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const input: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    input[name] = [data, { level: STORED_EXTENSIONS.has(extensionOf(name)) ? 0 : 6 }];
  }
  return zipSync(input);
}
