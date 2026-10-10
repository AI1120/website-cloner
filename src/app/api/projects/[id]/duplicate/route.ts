import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { duplicateProject } from "@/lib/projects/create";

/** Makes an independent copy of the project. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await duplicateProject(id);
  return project ? Response.json({ project }) : jsonError("Project not found.", 404);
}
