import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { dataErrorResponse, deleteTable, readJsonBody, updateAccess } from "@/lib/data/store";
import type { DataTable } from "@/types/data";

type Context = { params: Promise<{ id: string; table: string }> };

/** Changes who can add or read rows, from `{ access: { create?, read? } }`. */
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const body = await readJsonBody(request);
    const access = (body as { access?: unknown } | null)?.access;
    if (typeof access !== "object" || access === null) {
      return jsonError('Send the new setting as { "access": { "create": …, "read": … } }.', 400);
    }
    const updated = await updateAccess(id, table, access as Partial<DataTable["access"]>);
    return Response.json({ table: updated });
  } catch (error) {
    return dataErrorResponse(error);
  }
}

/** Deletes the table and all of its rows. */
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    await deleteTable(id, table);
    return Response.json({ deleted: true });
  } catch (error) {
    return dataErrorResponse(error);
  }
}
