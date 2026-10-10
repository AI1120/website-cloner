import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

import { BuildFailedError, describeBuildErrors, ensureBuilt, materialize } from "@/lib/build";
import { jsonError } from "@/lib/cloner/http";
import { readProject, remove, siteDir } from "@/lib/cloner/storage";
import { readDirectory, zipFiles } from "@/lib/cloner/zip";
import { buildReactExport } from "@/lib/export/react";
import { buildVueExport } from "@/lib/export/vue";
import type { ExportFormat, Project } from "@/types/project";

const FORMATS: ReadonlySet<string> = new Set<ExportFormat>(["html", "react", "vue", "source"]);

/** The finished static site, built into a temporary folder and read back. */
async function builtSite(project: Project): Promise<Record<string, Uint8Array>> {
  const folder = path.join(os.tmpdir(), `sitecloner-export-${randomBytes(6).toString("hex")}`);
  try {
    await materialize(project, folder);
    return await readDirectory(folder);
  } finally {
    await remove(folder).catch(() => undefined);
  }
}

/**
 * Downloads the project as a ZIP. A static site can be exported as plain HTML
 * or converted to a React or Vue project; a React project can be exported as
 * its source or as the built site.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  const requested = request.nextUrl.searchParams.get("format") ?? "html";
  if (!FORMATS.has(requested)) return jsonError("Unknown export format.", 400);
  const format = requested as ExportFormat;

  const root = siteDir(id);
  let files: Record<string, Uint8Array>;
  try {
    if (project.framework === "react") {
      if (format === "vue") {
        return jsonError("A React project can't be exported as Vue.", 400);
      }
      // The project folder already is a complete Vite project.
      files = format === "html" ? await builtSite(project) : await readDirectory(root);
    } else {
      // Brings the generated stylesheet up to date before the files are read.
      await ensureBuilt(project);
      if (format === "react") files = await buildReactExport(root, project);
      else if (format === "vue") files = await buildVueExport(root, project);
      else files = project.source === "clone" ? await readDirectory(root) : await builtSite(project);
    }
  } catch (error) {
    if (error instanceof BuildFailedError) {
      return jsonError(
        `The project doesn't build, so it can't be exported this way yet. ${describeBuildErrors(error.errors).slice(0, 400)}`,
        422,
      );
    }
    console.error(`Export (${format}) failed:`, error);
    return jsonError("The export could not be created.", 500);
  }

  const archive = zipFiles(files);
  return new Response(Buffer.from(archive), {
    headers: {
      "content-type": "application/zip",
      "content-length": String(archive.byteLength),
      "content-disposition": `attachment; filename="${id}-${format}.zip"`,
      "cache-control": "no-store",
    },
  });
}
