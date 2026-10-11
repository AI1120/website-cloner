import type { NextRequest } from "next/server";

import { NDJSON_HEADERS } from "@/lib/ai/jobs";
import { CompareError, compareWithOriginal } from "@/lib/cloner/compare";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import type { CompareDevice, CompareEvent } from "@/types/project";

export const maxDuration = 180;

/**
 * Compares a page of a copied site with the live original. Streams status
 * lines, then `{ type: "done", result }` or `{ type: "error", message }`.
 * Body: `{ page, device }`, device being "desktop" (default) or "phone".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  let pagePath: string;
  let device: CompareDevice;
  try {
    const body = (await request.json()) as { page?: unknown; device?: unknown } | null;
    pagePath = typeof body?.page === "string" ? body.page : project.entry;
    device = body?.device === "phone" ? "phone" : "desktop";
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: CompareEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      compareWithOriginal(project, pagePath, device, abort.signal, (message) =>
        send({ type: "status", message }),
      )
        .then((result) => send({ type: "done", result }))
        .catch((error: unknown) => {
          if (!(error instanceof CompareError)) console.error("Compare failed:", error);
          send({
            type: "error",
            message:
              error instanceof CompareError ? error.message : "Something went wrong while comparing.",
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
