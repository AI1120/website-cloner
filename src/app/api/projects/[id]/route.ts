import type { NextRequest } from "next/server";

import { runningJob, stopJob } from "@/lib/ai/jobs";
import { ensureBuilt } from "@/lib/build";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { deleteProject, readProject, touchProject } from "@/lib/cloner/storage";

type Context = { params: Promise<{ id: string }> };

/** The project, and whether it currently builds. */
export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  if (request.nextUrl.searchParams.get("build") !== "1") return Response.json({ project });

  const status = await ensureBuilt(project);
  return Response.json({
    project,
    build: { ok: status.ok, errors: status.errors },
    running: runningJob(id) !== null,
  });
}

/** Renames the project. */
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let name: string;
  try {
    const body: unknown = await request.json();
    const value = (body as { name?: unknown } | null)?.name;
    if (typeof value !== "string") throw new Error("Missing name");
    name = value.replace(/\s+/g, " ").trim().slice(0, 120);
  } catch {
    return jsonError("The request could not be read.", 400);
  }
  if (!name) return jsonError("A project needs a name.", 400);

  return Response.json({ project: await touchProject({ ...project, name }) });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  stopJob(id);
  await deleteProject(id);
  return Response.json({ ok: true });
}
