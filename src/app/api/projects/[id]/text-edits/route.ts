import type { NextRequest } from "next/server";

import { syncPages } from "@/lib/ai/agent";
import { runningJob } from "@/lib/ai/jobs";
import { applyTextEdits } from "@/lib/build/text-edits";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject, touchProject } from "@/lib/cloner/storage";
import type { TextEdit } from "@/types/project";

const MAX_EDITS = 200;
const MAX_TEXT_CHARS = 5000;

function parseEdits(raw: unknown): TextEdit[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_EDITS) return null;
  const edits: TextEdit[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.before !== "string" || typeof record.after !== "string") return null;
    if (record.before.length > MAX_TEXT_CHARS || record.after.length > MAX_TEXT_CHARS) return null;
    edits.push({
      loc: typeof record.loc === "string" && /^[\w./-]+:\d+:\d+$/.test(record.loc) ? record.loc : null,
      path: Array.isArray(record.path)
        ? record.path.filter((index): index is number => Number.isInteger(index) && index >= 0)
        : [],
      index: Number.isInteger(record.index) && (record.index as number) >= 0 ? (record.index as number) : 0,
      before: record.before,
      after: record.after,
    });
  }
  return edits;
}

/** Saves text that was edited directly in the preview into the project's files. */
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
  if (runningJob(id)) {
    return jsonError("The AI is changing this project. Apply your edits when it has finished.", 409);
  }

  let page: string;
  let edits: TextEdit[] | null;
  try {
    const body = (await request.json()) as { page?: unknown; edits?: unknown } | null;
    page = typeof body?.page === "string" ? body.page : project.entry;
    edits = parseEdits(body?.edits);
  } catch {
    return jsonError("The request could not be read.", 400);
  }
  if (!edits) return jsonError("There are no text changes to save.", 400);

  const outcome = await applyTextEdits(project, page, edits);
  const committed = await outcome.recorder.commit(project);
  let updated = committed?.project ?? project;
  if (committed) {
    updated = await touchProject({ ...updated, pages: await syncPages(updated) });
  }
  return Response.json({ project: updated, applied: outcome.applied, failed: outcome.failed });
}
