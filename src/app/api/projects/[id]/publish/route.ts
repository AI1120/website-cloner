import type { NextRequest } from "next/server";

import { BuildFailedError, describeBuildErrors, materialize } from "@/lib/build";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { publishedDir, readProject, remove, touchProject } from "@/lib/cloner/storage";

type Context = { params: Promise<{ id: string }> };

/** Publishes the current working copy as a snapshot at the shareable link. */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  try {
    await materialize(project, publishedDir(id));
  } catch (error) {
    if (error instanceof BuildFailedError) {
      return jsonError(
        `The project doesn't build, so it can't be published yet. ${describeBuildErrors(error.errors).slice(0, 400)}`,
        422,
      );
    }
    console.error("Publish failed:", error);
    return jsonError("The project could not be published.", 500);
  }

  const updated = await touchProject({
    ...project,
    published: { publishedAt: new Date().toISOString() },
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

  await remove(publishedDir(id));
  const updated = await touchProject({ ...project, published: null });
  return Response.json({ project: updated });
}
