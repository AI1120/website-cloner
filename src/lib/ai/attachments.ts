import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { projectDir, readJson, remove, uploadsDir, writeJson } from "@/lib/cloner/storage";
import type { ChatAttachment, StartMode } from "@/types/project";

const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "svg",
  "vue",
  "py",
  "csv",
]);

/** A problem with an uploaded file, worded for the person who attached it. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

/** Identifies an image by its first bytes, whatever the upload claimed to be. */
function sniffImage(data: Buffer): { mediaType: string; extension: string } | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: "image/png", extension: "png" };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mediaType: "image/jpeg", extension: "jpg" };
  }
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) {
    return { mediaType: "image/gif", extension: "gif" };
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mediaType: "image/webp", extension: "webp" };
  }
  return null;
}

function extensionOf(name: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

function cleanName(name: string): string {
  const base = name.replace(/[\\/]+/g, " ").replace(/[^\w .()-]+/g, "").trim();
  return base.slice(0, 80) || "file";
}

/** Stores an uploaded file with the project and describes it. */
async function saveAttachment(projectId: string, file: File): Promise<ChatAttachment> {
  const name = cleanName(file.name);
  if (file.size === 0) throw new AttachmentError(`“${name}” is empty.`);
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AttachmentError(`“${name}” is too large. Images can be up to 6 MB.`);
  }
  const data = Buffer.from(await file.arrayBuffer());
  const image = sniffImage(data);
  const id = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

  let attachment: ChatAttachment;
  if (image) {
    attachment = {
      id: `${id}.${image.extension}`,
      name,
      kind: "image",
      mediaType: image.mediaType,
      size: data.length,
    };
  } else {
    const extension = extensionOf(name);
    const looksLikeText = TEXT_EXTENSIONS.has(extension) || file.type.startsWith("text/");
    if (!looksLikeText || data.includes(0)) {
      throw new AttachmentError(
        `“${name}” can't be attached. Use an image (PNG, JPEG, WebP, GIF), a Markdown or text file, or code.`,
      );
    }
    if (data.length > MAX_TEXT_BYTES) {
      throw new AttachmentError(`“${name}” is too large. Text files can be up to 200 KB.`);
    }
    attachment = {
      id: `${id}.${extension || "txt"}`,
      name,
      kind: "text",
      mediaType: "text/plain",
      size: data.length,
    };
  }

  const directory = uploadsDir(projectId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, attachment.id), data);
  return attachment;
}

/** Stores every file of a form field, enforcing the per-message limit. */
export async function saveAttachments(
  projectId: string,
  files: FormDataEntryValue[],
): Promise<ChatAttachment[]> {
  const uploads = files.filter((entry): entry is File => typeof entry !== "string" && entry.size > 0);
  if (uploads.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files at a time.`);
  }
  const saved: ChatAttachment[] = [];
  for (const upload of uploads) saved.push(await saveAttachment(projectId, upload));
  return saved;
}

export async function readAttachment(
  projectId: string,
  attachment: ChatAttachment,
): Promise<Buffer | null> {
  if (!/^[a-z0-9]+\.[a-z0-9]{1,8}$/.test(attachment.id)) return null;
  try {
    return await fs.readFile(path.join(uploadsDir(projectId), attachment.id));
  } catch {
    return null;
  }
}

/** What the start screen asked for, kept until the workspace starts the first build. */
export interface PendingBuild {
  mode: StartMode;
  prompt: string;
  attachments: ChatAttachment[];
  /** Site whose brand the result should follow. */
  brandUrl?: string;
  /** Figma frame to turn into code. */
  figmaUrl?: string;
}

function pendingPath(projectId: string): string {
  return path.join(projectDir(projectId), "pending.json");
}

export async function writePending(projectId: string, pending: PendingBuild): Promise<void> {
  await writeJson(pendingPath(projectId), pending);
}

/** Returns the waiting first build and forgets it, so it can only start once. */
export async function takePending(projectId: string): Promise<PendingBuild | null> {
  const pending = await readJson<PendingBuild>(pendingPath(projectId));
  if (pending) await remove(pendingPath(projectId));
  return pending;
}
