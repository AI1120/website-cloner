import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { createTable, dataErrorResponse, listTables, readJsonBody } from "@/lib/data/store";

type Context = { params: Promise<{ id: string }> };

/** Lists the project's tables. Table contents are private, so reads are origin-checked too. */
export async function GET(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    return Response.json({ tables: await listTables(id) });
  } catch (error) {
    return dataErrorResponse(error);
  }
}

/** Creates a table from `{ name, columns, access? }`. */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const spec = (await readJsonBody(request)) as Parameters<typeof createTable>[1];
    return Response.json({ table: await createTable(id, spec) }, { status: 201 });
  } catch (error) {
    return dataErrorResponse(error);
  }
}
