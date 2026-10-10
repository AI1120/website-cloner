import type { NextRequest } from "next/server";

import { CloneError, discoverPages } from "@/lib/cloner/clone-site";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";

export const maxDuration = 60;

/** Lists the pages a site links to, so they can be chosen before cloning. */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  let url: string;
  try {
    const body: unknown = await request.json();
    const value = (body as { url?: unknown } | null)?.url;
    if (typeof value !== "string" || !value.trim()) throw new Error("Missing url");
    url = value.trim().slice(0, 2048);
  } catch {
    return jsonError("Enter the address of the website.", 400);
  }

  try {
    return Response.json(await discoverPages(url, request.signal));
  } catch (error) {
    return jsonError(
      error instanceof CloneError ? error.message : "The site's pages could not be listed.",
      error instanceof CloneError ? 422 : 500,
    );
  }
}
