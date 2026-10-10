import type { NextRequest } from "next/server";

import { jsonError } from "@/lib/cloner/http";
import { listFiles, readProject, siteDir } from "@/lib/cloner/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  return Response.json({ files: await listFiles(siteDir(id)) });
}
