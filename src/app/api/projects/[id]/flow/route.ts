import type { NextRequest } from "next/server";

import { analyzeFlow } from "@/lib/build/flow";
import { jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";

/** The project's screens and the links between them. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  return Response.json(await analyzeFlow(project));
}
