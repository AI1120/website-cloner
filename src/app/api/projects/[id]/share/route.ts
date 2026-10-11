import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject, touchProject } from "@/lib/cloner/storage";
import { setPassword, SHARE_LIMITS, shareSettings } from "@/lib/publish/share";

type Context = { params: Promise<{ id: string }> };

/**
 * Updates the published link's settings. Body (all optional): `title`,
 * `description`, and `password`, a string to set one or null to remove it.
 */
export async function PUT(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let body: { title?: unknown; description?: unknown; password?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const current = shareSettings(project);
  const text = (value: unknown, limit: number, fallback: string) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : fallback;
  const next = {
    ...current,
    title: text(body.title, SHARE_LIMITS.title, current.title),
    description: text(body.description, SHARE_LIMITS.description, current.description),
  };

  if (body.password === null) {
    await setPassword(id, null);
    next.protected = false;
  } else if (typeof body.password === "string") {
    const password = body.password;
    if (password.length < 4) return jsonError("Use a password of at least 4 characters.", 400);
    if (password.length > SHARE_LIMITS.password) return jsonError("That password is too long.", 400);
    await setPassword(id, password);
    next.protected = true;
  }

  const updated = await touchProject({ ...project, share: next });
  return Response.json({ project: updated });
}
