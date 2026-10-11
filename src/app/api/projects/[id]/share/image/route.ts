import fs from "node:fs/promises";

import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject, remove, touchProject } from "@/lib/cloner/storage";
import { SHARE_IMAGE_TYPES, SHARE_LIMITS, shareImagePath, shareSettings } from "@/lib/publish/share";
import { renderShareImage } from "@/lib/publish/share-image";

type Context = { params: Promise<{ id: string }> };

export const maxDuration = 120;

/** The current link-preview image, for the settings dialog. */
export async function GET(_request: NextRequest, { params }: Context) {
  const { id } = await params;
  const project = await readProject(id);
  const image = project ? shareSettings(project).image : null;
  if (!project || !image) return new Response("Not found", { status: 404 });
  try {
    const body = await fs.readFile(shareImagePath(id));
    return new Response(new Uint8Array(body), {
      headers: { "content-type": image.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Sets the link-preview image: an uploaded file (`multipart/form-data` with
 * `file`), or with `{ "generate": true }` a screenshot of the entry page.
 */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let body: Buffer;
  let contentType: string;
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("Choose an image to upload.", 400);
    if (!(SHARE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      return jsonError("Use a JPEG, PNG or WebP image.", 400);
    }
    if (file.size > SHARE_LIMITS.imageBytes) return jsonError("Use an image under 5 MB.", 400);
    body = Buffer.from(await file.arrayBuffer());
    contentType = file.type;
  } else {
    const shot = await renderShareImage(project, request.signal).catch((error: unknown) => {
      console.error("Share image failed:", error);
      return null;
    });
    if (!shot) {
      return jsonError(
        "The page couldn't be photographed. This needs Chrome or Edge on the machine running the app.",
        422,
      );
    }
    body = shot;
    contentType = "image/jpeg";
  }

  await fs.writeFile(shareImagePath(id), body);
  const updated = await touchProject({
    ...project,
    share: { ...shareSettings(project), image: { contentType, updatedAt: new Date().toISOString() } },
  });
  return Response.json({ project: updated });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  await remove(shareImagePath(id));
  const updated = await touchProject({ ...project, share: { ...shareSettings(project), image: null } });
  return Response.json({ project: updated });
}
