import type { NextRequest } from "next/server";

import { readProject } from "@/lib/cloner/storage";
import {
  DataError,
  dataErrorResponse,
  getTable,
  insertRow,
  listRows,
  readBody,
} from "@/lib/data/store";
import { DATA_LIMITS, type DataTable } from "@/types/data";

// The public API that generated apps call. Those pages run in a sandbox with an
// opaque origin (`Origin: null`) or at a published link, so this route allows
// any origin and must not use `isTrustedOrigin`. What a caller may do is decided
// by the table's own access settings, and nothing but that one table's rows is
// ever returned.

type Context = { params: Promise<{ id: string; table: string }> };

const MAX_PAGE = 200;
const DEFAULT_PAGE = 100;

const HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function withCors(response: Response): Response {
  for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value);
  return response;
}

/** Runs a handler so that every outcome, including a failure, carries the CORS headers. */
async function respond(handler: () => Promise<Response>): Promise<Response> {
  try {
    return withCors(await handler());
  } catch (error) {
    return withCors(dataErrorResponse(error));
  }
}

async function findTable(context: Context): Promise<{ id: string; table: DataTable }> {
  const { id, table: name } = await context.params;
  const table = (await readProject(id)) ? await getTable(id, name) : null;
  if (!table) throw new DataError("Table not found.", 404);
  return { id, table };
}

/** Collects form fields into an object. Files are ignored; repeated fields are joined. */
function fromFields(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string> {
  const fields = new Map<string, string>();
  for (const [name, value] of entries) {
    if (typeof value !== "string") continue;
    const earlier = fields.get(name);
    fields.set(name, earlier === undefined ? value : `${earlier}, ${value}`);
  }
  return Object.fromEntries(fields);
}

/** Reads a row sent as JSON or as an HTML form (urlencoded or multipart). */
async function readRowInput(request: Request): Promise<unknown> {
  const body = await readBody(request, DATA_LIMITS.bodyBytes);
  if (body === null) throw new DataError("The request is too large. The limit is 256 KB.", 413);

  const contentType = request.headers.get("content-type") ?? "";
  const kind = contentType.split(";")[0].trim().toLowerCase();

  if (kind === "application/x-www-form-urlencoded") {
    return fromFields(new URLSearchParams(body.toString("utf8")));
  }
  if (kind === "multipart/form-data") {
    try {
      const form = await new Response(new Uint8Array(body), {
        headers: { "content-type": contentType },
      }).formData();
      return fromFields(form);
    } catch {
      throw new DataError("The form could not be read.");
    }
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new DataError("Send the row as JSON or as a form.");
  }
}

function numberParam(request: NextRequest, name: string): number | undefined {
  const text = request.nextUrl.searchParams.get(name)?.trim();
  const value = text ? Number(text) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

/** Rows of the table, newest first, when it is readable by everyone. */
export async function GET(request: NextRequest, context: Context) {
  return respond(async () => {
    const { id, table } = await findTable(context);
    if (table.access.read !== "everyone") {
      throw new DataError(
        'This table can\'t be read by apps. To allow it, set "Who can read rows" to Everyone in the editor\'s Data tab.',
        403,
      );
    }
    const limit = Math.min(Math.max(numberParam(request, "limit") ?? DEFAULT_PAGE, 0), MAX_PAGE);
    const page = await listRows(id, table.name, { limit, offset: numberParam(request, "offset") });
    return Response.json(page);
  });
}

/** Adds a row when the table accepts rows from everyone. */
export async function POST(request: NextRequest, context: Context) {
  return respond(async () => {
    const { id, table } = await findTable(context);
    if (table.access.create !== "everyone") {
      throw new DataError(
        'This table doesn\'t accept rows from apps. To allow it, set "Who can add rows" to Everyone in the editor\'s Data tab.',
        403,
      );
    }
    const row = await insertRow(id, table.name, await readRowInput(request));
    return Response.json({ row }, { status: 201 });
  });
}

/** Answers the CORS preflight that browsers send before a JSON POST. */
export function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

function methodNotAllowed(): Response {
  const response = Response.json(
    { error: "This address only accepts GET and POST." },
    { status: 405, headers: { allow: "GET, POST, OPTIONS" } },
  );
  return withCors(response);
}

// Without these Next.js would answer 405 itself, with no CORS headers, and a
// page calling from another origin couldn't read why its request failed.
export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
