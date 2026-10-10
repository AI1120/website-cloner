import type { NextRequest } from "next/server";

import { servePreview } from "@/lib/build/serve";
import { readProject } from "@/lib/cloner/storage";

/** Serves the editable working copy of a project, for the in-app preview. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id, path } = await params;
  const project = await readProject(id);
  if (!project) return new Response("Not found", { status: 404 });
  return servePreview(request, project, path);
}
