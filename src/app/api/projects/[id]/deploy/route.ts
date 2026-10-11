import type { NextRequest } from "next/server";

import { NDJSON_HEADERS, runningJob } from "@/lib/ai/jobs";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";
import { DeployError, deployProject } from "@/lib/deploy";
import type { DeployEvent, DeployTarget } from "@/types/project";

export const maxDuration = 300;

const TARGETS: ReadonlySet<string> = new Set<DeployTarget>(["netlify", "vercel", "github"]);

/**
 * Deploys the project to Netlify or Vercel, or pushes it to GitHub. Body:
 * `{ target }`. Streams status lines, then `{ type: "done", project, url }`
 * or `{ type: "error", message }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  if (runningJob(id)) return jsonError("The AI is changing this project. Deploy it when it has finished.", 409);

  let target: DeployTarget;
  try {
    const body = (await request.json()) as { target?: unknown } | null;
    if (typeof body?.target !== "string" || !TARGETS.has(body.target)) throw new Error("bad target");
    target = body.target as DeployTarget;
  } catch {
    return jsonError("Choose Netlify, Vercel or GitHub.", 400);
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: DeployEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      deployProject(project, target, (message) => send({ type: "status", message }), abort.signal)
        .then((result) => send({ type: "done", ...result }))
        .catch((error: unknown) => {
          if (!(error instanceof DeployError)) console.error("Deploy failed:", error);
          send({
            type: "error",
            message: error instanceof DeployError ? error.message : "Something went wrong while deploying.",
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
