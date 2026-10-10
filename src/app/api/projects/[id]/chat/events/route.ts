import type { NextRequest } from "next/server";

import { jobStream, NDJSON_HEADERS, runningJob } from "@/lib/ai/jobs";

export const maxDuration = 900;

/**
 * Follows the AI request that is running for a project: replays what it has
 * done so far, then streams the rest. Answers 204 when nothing is running.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = runningJob(id);
  if (!job) return new Response(null, { status: 204 });
  return new Response(jobStream(job), { headers: NDJSON_HEADERS });
}
