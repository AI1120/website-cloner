import type { NextRequest } from "next/server";

import { revertToCheckpoint } from "@/lib/cloner/checkpoints";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";

/** Undoes a checkpoint and everything changed after it. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let checkpointId: string;
  try {
    const body: unknown = await request.json();
    const value = (body as { checkpointId?: unknown } | null)?.checkpointId;
    if (typeof value !== "string") throw new Error("Missing checkpoint");
    checkpointId = value;
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const updated = await revertToCheckpoint(project, checkpointId);
  if (!updated) return jsonError("That change can no longer be undone.", 404);
  return Response.json({ project: updated });
}
