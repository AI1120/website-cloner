import type { NextRequest } from "next/server";

import { serveTemplate } from "@/lib/build/serve";
import { findTemplate, templateSiteDir } from "@/lib/projects/create";

/** Serves a built-in template's pages, for the cards on the start screen. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  const root = templateSiteDir(slug);
  if (!root || !(await findTemplate(slug))) return new Response("Not found", { status: 404 });
  return serveTemplate(request, root, path);
}
