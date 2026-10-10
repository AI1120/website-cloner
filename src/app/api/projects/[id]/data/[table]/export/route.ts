import type { NextRequest } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { dataErrorResponse, exportCsv } from "@/lib/data/store";

type Context = { params: Promise<{ id: string; table: string }> };

/** Downloads the table as a CSV file. */
export async function GET(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, table } = await params;
  if (!(await readProject(id))) return jsonError("Project not found.", 404);

  try {
    const csv = await exportCsv(id, table);
    // The byte order mark makes spreadsheet apps read the file as UTF-8.
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        // Table names are limited to a-z, 0-9 and "_", so this needs no escaping.
        "content-disposition": `attachment; filename="${table}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return dataErrorResponse(error);
  }
}
