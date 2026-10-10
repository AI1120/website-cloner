import type { NextRequest } from "next/server";

import { serveSiteFile } from "@/lib/cloner/http";
import { publishedDir, readProject } from "@/lib/cloner/storage";

/** Serves a project's published snapshot at its shareable link. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id, path } = await params;
  const project = await readProject(id);
  if (!project || !project.published) return new Response("Not found", { status: 404 });

  return serveSiteFile(request, publishedDir(id), path, project.entry, {
    sameOriginFramesOnly: false,
  });
}
