import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { dataErrorResponse, deleteRows, insertRow, listRows, readJsonBody } from "@/lib/data/store";

type Context = { params: Promise<{ id: string; table: string }> };

function numberParam(request: NextRequest, name: string): number | undefined {
  const value = request.nextUrl.searchParams.get(name);
  return value === null || value.trim() === "" ? undefined : Number(value);
}

/** A page of rows, newest first: `?limit=` (100 unless given) and `?offset=`. */
export async function GET(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const page = await listRows(id, table, {
      limit: numberParam(request, "limit"),
      offset: numberParam(request, "offset"),
    });
    return Response.json(page);
  } catch (error) {
    return dataErrorResponse(error);
  }
}

/** Adds a row from a JSON object of field values. */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const row = await insertRow(id, table, await readJsonBody(request));
    return Response.json({ row }, { status: 201 });
  } catch (error) {
    return dataErrorResponse(error);
  }
}

/** Deletes rows, from `{ ids: [...] }` or `{ ids: "all" }`. */
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const body = await readJsonBody(request);
    const ids = (body as { ids?: unknown } | null)?.ids;
    const deleted = await deleteRows(id, table, ids as string[] | "all");
    return Response.json({ deleted });
  } catch (error) {
    return dataErrorResponse(error);
  }
}
