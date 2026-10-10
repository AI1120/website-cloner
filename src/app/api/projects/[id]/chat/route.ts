import type { NextRequest } from "next/server";

import { AgentError, isAiConfigured, runEditAgent, type AgentRequest } from "@/lib/ai/agent";
import { AttachmentError, saveAttachments, takePending } from "@/lib/ai/attachments";
import { describeBrand } from "@/lib/ai/brand";
import { appendChat, newMessage, readChat } from "@/lib/ai/chat-store";
import { fetchFigmaDesign, FigmaError } from "@/lib/ai/figma";
import { jobStream, NDJSON_HEADERS, runningJob, startJob } from "@/lib/ai/jobs";
import { AI_SETUP_HINT } from "@/lib/ai/provider";
import { isTrustedOrigin, jsonError } from "@/lib/cloner/http";
import { readProject, touchProject } from "@/lib/cloner/storage";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  Project,
  SelectedElement,
} from "@/types/project";

export const maxDuration = 900;

type Context = { params: Promise<{ id: string }> };

const MAX_PROMPT_CHARS = 12_000;
const MAX_ELEMENTS = 8;

const REPLACE_STARTER = "replacing the placeholder starter content";

function restyleInstructions(project: Project): string {
  const how =
    project.source === "clone"
      ? "Change its colors, typography, corner radii and button styling to match the reference, using append_css. If the reference loads its fonts from a font stylesheet listed above, load the same stylesheet with @import at the top of your CSS; otherwise use the font family names with sensible fallbacks."
      : "Change its design tokens, colors, typography, corner radii and button styling to match the reference. If the reference loads its fonts from a font stylesheet listed above, load the same stylesheet; otherwise use the font family names with sensible fallbacks.";
  return `Restyle this project so it looks like it belongs to the reference brand described above. Keep the project's layout, content, images and logo exactly as they are. ${how} Do not copy the reference's logo, images or wording.`;
}

function parseElements(raw: unknown): SelectedElement[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const text = (input: unknown, max: number) => (typeof input === "string" ? input.slice(0, max) : "");
  return value.slice(0, MAX_ELEMENTS).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const tag = text(record.tag, 40).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) return [];
    return [
      {
        tag,
        id: text(record.id, 120),
        classes: Array.isArray(record.classes)
          ? record.classes.filter((name): name is string => typeof name === "string").slice(0, 12)
          : [],
        text: text(record.text, 200),
        loc: /^[\w./-]+:\d+:\d+$/.test(text(record.loc, 200)) ? text(record.loc, 200) : null,
        path: Array.isArray(record.path)
          ? record.path.filter((index): index is number => Number.isInteger(index)).slice(0, 60)
          : [],
        html: text(record.html, 400),
      },
    ];
  });
}

function elementLabel(element: SelectedElement): string {
  const name = element.id ? `${element.tag}#${element.id}` : element.tag;
  return element.text ? `${name}: ${element.text.slice(0, 40)}` : name;
}

interface Fields {
  prompt: string;
  currentPage: string;
  brandUrl: string;
  start: boolean;
  elements: SelectedElement[];
  files: FormDataEntryValue[];
}

async function readFields(request: NextRequest): Promise<Fields | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === "string" ? value : "";
      };
      return {
        prompt: text("prompt"),
        currentPage: text("currentPage"),
        brandUrl: text("brandUrl"),
        start: text("start") === "1",
        elements: parseElements(text("elements")),
        files: form.getAll("attachments"),
      };
    }
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return null;
    const body = parsed as Record<string, unknown>;
    const text = (name: string) => (typeof body[name] === "string" ? (body[name] as string) : "");
    return {
      prompt: text("prompt"),
      currentPage: text("currentPage"),
      brandUrl: text("brandUrl"),
      start: body.start === true,
      elements: parseElements(body.elements),
      files: [],
    };
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: Context) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  return Response.json({
    messages: await readChat(id),
    aiConfigured: isAiConfigured(),
    running: runningJob(id) !== null,
  });
}

/**
 * Starts a request to the AI and streams its progress as newline-delimited
 * JSON (`ChatEvent`s). The work continues if the connection closes; another
 * request can follow it at `chat/events`.
 *
 * Send `prompt` for a normal request (optionally with `attachments` files and
 * picked `elements`), `brandUrl` to restyle the project after another site's
 * brand, or `start` to run the build a new project is waiting for.
 */
export async function POST(request: NextRequest, { params }: Context) {
  if (!isTrustedOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }
  const { id } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);
  if (!isAiConfigured()) return jsonError(AI_SETUP_HINT, 503);

  const fields = await readFields(request);
  if (!fields) return jsonError("The request could not be read.", 400);
  if (runningJob(id)) return jsonError("The AI is already working on this project.", 409);

  const brandUrl = fields.brandUrl.trim().slice(0, 2048);
  const typed = fields.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!fields.start && !brandUrl && !typed && fields.files.length === 0) {
    return jsonError("Describe the change you want.", 400);
  }

  let uploaded: ChatAttachment[];
  try {
    uploaded = await saveAttachments(id, fields.files);
  } catch (error) {
    if (error instanceof AttachmentError) return jsonError(error.message, 400);
    throw error;
  }

  const currentPage = project.pages.some((page) => page.path === fields.currentPage)
    ? fields.currentPage
    : project.entry;

  const job = startJob(id, async (emit, signal) => {
    const history = await readChat(id);
    let working = project;
    let userMessage = newMessage("user", typed || "See the attached files.");
    let announced = false;
    /** Shows the request in the chat and stores it, so it is not lost if the app stops. */
    const announce = async (message: ChatMessage) => {
      announced = true;
      await appendChat(id, [message]);
      emit({ type: "user", message });
    };

    try {
      const agent: Omit<AgentRequest, "signal" | "emit" | "history" | "project"> = {
        prompt: typed,
        currentPage,
        attachments: uploaded,
        elements: fields.elements,
      };

      if (fields.start) {
        const pending = await takePending(id);
        working = await touchProject({ ...project, pending: false });
        if (!pending) throw new AgentError("Nothing is waiting to be built for this project.");

        const wish = pending.prompt.trim();
        agent.attachments = pending.attachments;
        agent.firstBuild = pending.mode !== "clone";
        const imageCount = pending.attachments.filter((item) => item.kind === "image").length;

        if (pending.mode === "brand" && pending.brandUrl) {
          agent.prompt = wish || `Build a page in the style of ${pending.brandUrl}`;
          userMessage = newMessage("user", `${agent.prompt}\n\nBrand: ${pending.brandUrl}`, {
            attachments: pending.attachments,
          });
          await announce(userMessage);
          emit({ type: "tool", name: "read_brand", detail: pending.brandUrl });
          try {
            agent.context = await describeBrand(pending.brandUrl, signal);
          } catch (error) {
            throw new AgentError(
              error instanceof Error && error.name === "FetchError"
                ? `Couldn't read the brand's site: ${error.message}`
                : "Couldn't read the brand's site.",
            );
          }
          agent.instructions = `Build this as the first version of the project, ${REPLACE_STARTER}, in the visual style of the reference brand described above. Use its colors, typography, corner radii and button styling. If the reference loads its fonts from a font stylesheet listed above, load the same stylesheet. Do not copy the reference's logo, images or wording.\n\n${wish || "A landing page that suits this brand."}`;
        } else if (pending.mode === "figma" && pending.figmaUrl) {
          agent.prompt = wish || "Turn this Figma design into code";
          userMessage = newMessage("user", `${agent.prompt}\n\nFigma: ${pending.figmaUrl}`, {
            attachments: pending.attachments,
          });
          await announce(userMessage);
          emit({ type: "tool", name: "read_figma", detail: pending.figmaUrl });
          const design = await fetchFigmaDesign(pending.figmaUrl, signal);
          agent.images = [design.image];
          agent.context = `Layers of the Figma frame "${design.name}" (type, name, size, position within the frame, and style):\n${design.summary}`;
          agent.instructions = `Turn the Figma frame into this project, ${REPLACE_STARTER}. The last attached image shows how it must look; the layer list above gives exact sizes, positions, colors, fonts and text. Match it closely, and make it adapt sensibly to screens narrower than the frame.${wish ? `\n\nThe person adds: ${wish}` : ""}`;
        } else if (pending.mode === "image") {
          agent.prompt = wish || "Turn this design into a working page";
          userMessage = newMessage("user", agent.prompt, { attachments: pending.attachments });
          await announce(userMessage);
          agent.instructions = `Recreate the attached ${imageCount > 1 ? "designs" : "design"} as this project, ${REPLACE_STARTER}. Match the layout, proportions, colors, type and wording closely.${imageCount > 1 ? " Each image is a separate screen; build each as its own page and link them in a sensible order." : ""}${wish ? `\n\nThe person adds: ${wish}` : ""}`;
        } else {
          agent.prompt = wish;
          userMessage = newMessage("user", wish, { attachments: pending.attachments });
          await announce(userMessage);
          if (pending.mode !== "clone") {
            agent.instructions = `Build this as the first version of the project, ${REPLACE_STARTER}:\n\n${wish}`;
          }
        }
      } else if (brandUrl) {
        agent.prompt = `Match the brand of ${brandUrl}`;
        userMessage = newMessage("user", agent.prompt);
        await announce(userMessage);
        emit({ type: "tool", name: "read_brand", detail: brandUrl });
        try {
          agent.context = await describeBrand(brandUrl, signal);
        } catch (error) {
          throw new AgentError(
            error instanceof Error && error.name === "FetchError"
              ? `Couldn't read the reference site: ${error.message}`
              : "Couldn't read the reference site.",
          );
        }
        agent.instructions = restyleInstructions(project);
      } else {
        agent.prompt = typed || "Use the attached files.";
        userMessage = newMessage("user", agent.prompt, {
          attachments: uploaded.length > 0 ? uploaded : undefined,
          elements:
            fields.elements.length > 0 ? fields.elements.map(elementLabel) : undefined,
        });
        await announce(userMessage);
      }

      const result = await runEditAgent({ ...agent, project: working, history, signal, emit });
      const reply = newMessage("assistant", result.text, {
        changed: result.changed,
        checkpointId: result.checkpointId,
      });
      await appendChat(id, [reply]);
      emit({ type: "done", message: reply, project: result.project });
    } catch (error) {
      const message =
        error instanceof AgentError || error instanceof FigmaError
          ? error.message
          : "Something went wrong while making the change.";
      if (!(error instanceof AgentError) && !(error instanceof FigmaError)) {
        console.error("Chat request failed:", error);
      }
      const reply = newMessage("assistant", message, { error: true });
      await appendChat(id, announced ? [reply] : [userMessage, reply]);
      const event: ChatEvent = {
        type: "error",
        message,
        chatMessage: reply,
        project: (await readProject(id)) ?? working,
      };
      emit(event);
    }
  });
  if (!job) return jsonError("The AI is already working on this project.", 409);

  return new Response(jobStream(job), { headers: NDJSON_HEADERS });
}
