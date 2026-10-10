import fs from "node:fs/promises";

import type { NextRequest } from "next/server";

import { ChangeRecorder, MAX_TEXT_FILE_BYTES } from "@/lib/cloner/checkpoints";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { isTextFile } from "@/lib/cloner/mime";
import { readProject, resolveInside, siteDir } from "@/lib/cloner/storage";

type Context = { params: Promise<{ id: string }> };

function requestedPath(request: NextRequest): string {
  return (request.nextUrl.searchParams.get("path") ?? "").replace(/^\/+/, "");
}

/** Returns the text of one file of the project, for the code editor. */
export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  const relative = requestedPath(request);
  const file = relative ? resolveInside(siteDir(id), relative) : null;
  if (!file) return jsonError("File not found.", 404);
  if (!isTextFile(relative)) return jsonError("This file can't be opened as text.", 415);

  try {
    const stats = await fs.stat(file);
    if (!stats.isFile()) return jsonError("File not found.", 404);
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      return jsonError("This file is too large to open in the editor.", 413);
    }
    return Response.json({ path: relative, content: await fs.readFile(file, "utf8") });
  } catch {
    return jsonError("File not found.", 404);
  }
}

/** Saves an edited file and records a checkpoint so the edit can be undone. */
export async function PUT(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  const relative = requestedPath(request);
  if (!relative || !resolveInside(siteDir(id), relative)) {
    return jsonError("File not found.", 404);
  }
  if (!isTextFile(relative)) return jsonError("This file can't be edited as text.", 415);

  let content: string;
  try {
    const body: unknown = await request.json();
    const value = (body as { content?: unknown } | null)?.content;
    if (typeof value !== "string") throw new Error("Missing content");
    content = value;
  } catch {
    return jsonError("The request could not be read.", 400);
  }
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
    return jsonError("This file is too large to save.", 413);
  }

  const recorder = new ChangeRecorder(id, `Edited ${relative}`);
  await recorder.write(relative, content);
  const committed = await recorder.commit(project);
  return Response.json({ project: committed?.project ?? project });
}
