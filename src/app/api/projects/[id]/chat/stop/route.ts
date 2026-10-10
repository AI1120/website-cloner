import type { NextRequest } from "next/server";

import { stopJob } from "@/lib/ai/jobs";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";

/** Stops the AI request that is running for a project. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  return Response.json({ stopped: stopJob(id) });
}
