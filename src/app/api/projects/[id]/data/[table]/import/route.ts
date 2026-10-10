import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { dataErrorResponse, importCsv, readBody } from "@/lib/data/store";
import { DATA_LIMITS } from "@/types/data";

type Context = { params: Promise<{ id: string; table: string }> };

/** Adds the rows of a CSV file, sent as the request body, to the table. */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const body = await readBody(request, DATA_LIMITS.csvBytes);
    if (body === null) return jsonError("A CSV file can be at most 2 MB.", 413);
    return Response.json(await importCsv(id, table, body.toString("utf8")));
  } catch (error) {
    return dataErrorResponse(error);
  }
}
