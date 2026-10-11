import type { NextRequest } from "next/server";

import { runningJob } from "@/lib/ai/jobs";
import { applyStyleEdit, cleanStyleChanges } from "@/lib/build/style-edits";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";

/**
 * Saves a style change made with the visual inspector. Body: `{ page, tag, loc,
 * path, styles }`, `styles` mapping CSS properties to values (or null to remove).
 * Saved as one checkpoint, so it can be undone from History.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  if (runningJob(id)) {
    return jsonError("The AI is changing this project. Save your style when it has finished.", 409);
  }

  let body: { page?: unknown; tag?: unknown; loc?: unknown; path?: unknown; styles?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The request could not be read.", 400);
  }
  const styles = cleanStyleChanges(body?.styles);
  if (!styles) return jsonError("Those style values can't be saved.", 400);

  const outcome = await applyStyleEdit(project, {
    page: typeof body?.page === "string" ? body.page : project.entry,
    tag: typeof body?.tag === "string" ? body.tag.replace(/[^a-z0-9-]/gi, "").slice(0, 20) : "",
    loc: typeof body?.loc === "string" && /^[\w./-]+:\d+:\d+$/.test(body.loc) ? body.loc : null,
    path: Array.isArray(body?.path)
      ? body.path.filter((index): index is number => Number.isInteger(index) && index >= 0).slice(0, 200)
      : [],
    styles,
  });
  if (typeof outcome === "string") return jsonError(outcome, 422);

  const committed = await outcome.commit(project);
  return Response.json({ project: committed?.project ?? project });
}
