import type { NextRequest } from "next/server";

import { AttachmentError, saveAttachments, writePending } from "@/lib/ai/attachments";
import { figmaToken, parseFigmaUrl } from "@/lib/ai/figma";
import { NDJSON_HEADERS } from "@/lib/ai/jobs";
import { AI_SETUP_HINT, aiReadsImages, isAiConfigured, NO_IMAGES_HINT } from "@/lib/ai/provider";
import { CloneError, cloneSite, normalizeOptions } from "@/lib/cloner/clone-site";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { assertPublicUrl, FetchError } from "@/lib/cloner/safe-fetch";
import { deleteProject, listProjects, touchProject } from "@/lib/cloner/storage";
import { normalizeInputUrl } from "@/lib/cloner/urls";
import {
  createFromTemplate,
  createScaffoldProject,
  nameFromPrompt,
} from "@/lib/projects/create";
import { findPreset, MAX_DESIGN_SYSTEM_CHARS } from "@/lib/projects/design-systems";
import type { CloneEvent, Framework, ProjectSummary, StartMode, Styling } from "@/types/project";

export const maxDuration = 300;

const MAX_PROMPT_CHARS = 12_000;
const START_MODES: ReadonlySet<string> = new Set<StartMode>([
  "prompt",
  "clone",
  "figma",
  "brand",
  "image",
]);

interface Fields {
  get(name: string): string;
  list(name: string): string[];
  files: FormDataEntryValue[];
}

async function readFields(request: NextRequest): Promise<Fields | null> {
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      return {
        get: (name) => {
          const value = form.get(name);
          return typeof value === "string" ? value : "";
        },
        list: (name) => form.getAll(name).filter((value): value is string => typeof value === "string"),
        files: form.getAll("attachments"),
      };
    }
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return null;
    const body = parsed as Record<string, unknown>;
    return {
      get: (name) => {
        const value = body[name];
        return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
      },
      list: (name) => {
        const value = body[name];
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      },
      files: [],
    };
  } catch {
    return null;
  }
}

/** Starts a clone and streams its progress as newline-delimited `CloneEvent`s. */
function cloneResponse(request: NextRequest, fields: Fields): Response {
  const url = fields.get("url").trim();
  if (!url) return jsonError("Enter the address of the website to clone.", 400);
  if (url.length > 2048) return jsonError("That address is too long.", 400);

  const followUp = fields.get("prompt").trim().slice(0, MAX_PROMPT_CHARS);
  const chosen = fields.get("choosePages") === "true" ? fields.list("pages").slice(0, 60) : undefined;
  const options = normalizeOptions({
    maxPages: Number(fields.get("maxPages")) || 1,
    keepScripts: fields.get("keepScripts") === "true",
  });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: CloneEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      cloneSite({ url, options, pages: chosen, signal: abort.signal, emit: send })
        .then(async (project) => {
          // Instructions typed with the address are carried out once the copy is open.
          if (followUp && isAiConfigured()) {
            await writePending(project.id, { mode: "clone", prompt: followUp, attachments: [] });
            send({ type: "done", project: await touchProject({ ...project, pending: true }) });
          } else {
            send({ type: "done", project });
          }
        })
        .catch((error: unknown) =>
          send({
            type: "error",
            message:
              error instanceof CloneError
                ? error.message
                : "Something went wrong while cloning the site.",
          }),
        )
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

/**
 * Creates a project. Cloning a site streams its progress; every other way of
 * starting answers with `{ project }` once the project exists, and the AI's
 * first build then runs from the workspace.
 */
/** Every project, newest first, in brief: enough to list and open them. */
export async function GET() {
  const projects: ProjectSummary[] = (await listProjects()).map((project) => ({
    id: project.id,
    name: project.name,
    host: project.host,
    updatedAt: project.updatedAt,
  }));
  return Response.json({ projects });
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const fields = await readFields(request);
  if (!fields) return jsonError("The request could not be read.", 400);

  const template = fields.get("template").trim();
  if (template) {
    const project = await createFromTemplate(template);
    return project ? Response.json({ project }) : jsonError("That template doesn't exist.", 404);
  }

  const requestedMode = fields.get("mode") || "clone";
  if (!START_MODES.has(requestedMode)) return jsonError("Unknown way to start a project.", 400);
  const mode = requestedMode as StartMode;
  if (mode === "clone") return cloneResponse(request, fields);

  if (!isAiConfigured()) return jsonError(AI_SETUP_HINT, 503);
  if (mode === "image" && !aiReadsImages()) return jsonError(NO_IMAGES_HINT, 400);

  const prompt = fields.get("prompt").trim().slice(0, MAX_PROMPT_CHARS);
  const framework: Framework = fields.get("framework") === "html" ? "html" : "react";
  const styling: Styling = fields.get("styling") === "inline" ? "inline" : "tailwind";
  const uiLibrary = fields.get("uiLibrary") === "shadcn" ? "shadcn" : "none";

  let referenceUrl = "";
  if (mode === "brand") {
    try {
      referenceUrl = assertPublicUrl(normalizeInputUrl(fields.get("url"))).href;
    } catch (error) {
      return jsonError(
        error instanceof FetchError ? error.message : "Enter the address of the brand's website.",
        400,
      );
    }
  } else if (mode === "figma") {
    referenceUrl = fields.get("url").trim();
    if (!parseFigmaUrl(referenceUrl)) {
      return jsonError("That doesn't look like a Figma link. Copy the link to a frame from Figma.", 400);
    }
    if (!figmaToken()) {
      return jsonError(
        "Importing from Figma needs a Figma access token. Add FIGMA_TOKEN to .env.local and restart the app.",
        503,
      );
    }
  } else if (mode === "prompt" && !prompt && fields.files.length === 0) {
    return jsonError("Describe what you want to build.", 400);
  }

  let designSystem: { name: string; content: string } | null = null;
  const presetId = fields.get("designSystem").trim();
  const customContent = fields.get("designSystemContent").trim();
  if (customContent) {
    if (customContent.length > MAX_DESIGN_SYSTEM_CHARS) {
      return jsonError("That design system file is too long.", 400);
    }
    designSystem = {
      name: fields.get("designSystemName").trim().slice(0, 80) || "Custom design system",
      content: customContent,
    };
  } else if (presetId) {
    const preset = findPreset(presetId);
    if (!preset) return jsonError("Unknown design system.", 400);
    designSystem = { name: preset.name, content: preset.content };
  }

  const fallbackName =
    mode === "figma" ? "Figma import" : mode === "brand" ? "Brand project" : mode === "image" ? "Image to app" : "New project";
  const project = await createScaffoldProject({
    name: nameFromPrompt(prompt, fallbackName),
    source: mode,
    framework,
    styling,
    uiLibrary,
    designSystem,
    url: referenceUrl || undefined,
    pending: true,
  });

  try {
    const attachments = await saveAttachments(project.id, fields.files);
    if (mode === "image" && !attachments.some((attachment) => attachment.kind === "image")) {
      throw new AttachmentError("Add at least one image of the design to turn into an app.");
    }
    await writePending(project.id, {
      mode,
      prompt,
      attachments,
      brandUrl: mode === "brand" ? referenceUrl : undefined,
      figmaUrl: mode === "figma" ? referenceUrl : undefined,
    });
  } catch (error) {
    await deleteProject(project.id).catch(() => undefined);
    if (error instanceof AttachmentError) return jsonError(error.message, 400);
    throw error;
  }

  return Response.json({ project });
}
