import type { NextRequest } from "next/server";

import { NDJSON_HEADERS } from "@/lib/ai/jobs";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { ChangeViewError, pictureChange, type ChangePictures } from "@/lib/projects/snapshots";

export const maxDuration = 180;

type Event =
  | { type: "status"; message: string }
  | { type: "done"; result: ChangePictures }
  | { type: "error"; message: string };

/**
 * Pictures of a page before and after one change. Body: `{ page }`. Streams
 * status lines, then `{ type: "done", result }` or `{ type: "error", message }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; checkpointId: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id, checkpointId } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let page = project.entry;
  try {
    const body = (await request.json()) as { page?: unknown } | null;
    if (typeof body?.page === "string" && body.page.length < 300 && !body.page.includes("..")) page = body.page;
  } catch {
    // The entry page, then.
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: Event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      pictureChange(project, checkpointId, page, abort.signal, (message) => send({ type: "status", message }))
        .then((result) => send({ type: "done", result }))
        .catch((error: unknown) => {
          if (!(error instanceof ChangeViewError)) console.error("Change pictures failed:", error);
          send({
            type: "error",
            message: error instanceof ChangeViewError ? error.message : "The change couldn't be pictured.",
          });
        })
        .finally(() => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // The client already went away.
          }
        });
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
