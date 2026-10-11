import fs from "node:fs/promises";
import path from "node:path";

import { readAttachment } from "@/lib/ai/attachments";
import {
  AI_SETUP_HINT,
  AiError,
  providersFor,
  type ImageInput,
  type ToolResult,
  type TurnInput,
} from "@/lib/ai/provider";
import { buildFirstMessage, systemPromptFor } from "@/lib/ai/prompts";
import { ProjectTools, toolsFor } from "@/lib/ai/tools";
import { describeBuildErrors, ensureBuilt, needsBuild } from "@/lib/build";
import { analyzeFlow } from "@/lib/build/flow";
import { describePageProblems, findPageProblems } from "@/lib/build/page-check";
import { ChangeRecorder } from "@/lib/cloner/checkpoints";
import { readProject, siteDir, touchProject } from "@/lib/cloner/storage";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  Project,
  ProjectPage,
  SelectedElement,
} from "@/types/project";

export { isAiConfigured } from "@/lib/ai/provider";

/** How many times the model may be called for one request. */
const MAX_TURNS = 40;
/** How many times a failing build is handed back to the model to fix. */
const MAX_BUILD_FIXES = 3;
/** Rounds spent fixing errors seen in the browser; kept low, as each costs model calls. */
const MAX_PAGE_FIXES = 1;

/** The pages worth opening after a change: the one in view, then changed pages. */
function pagesToCheck(project: Project, currentPage: string, changed: string[]): string[] {
  if (project.framework === "react") return [currentPage || project.entry];
  const changedPages = changed.filter((file) => /\.html?$/i.test(file));
  const current = currentPage.split("#")[0] || project.entry;
  return [current, ...changedPages];
}

/** An error whose message can be shown to the person using the editor. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentRequest {
  project: Project;
  /** What the person asked for, as shown in the chat. */
  prompt: string;
  /** What the model is asked to do, when that differs from `prompt`. */
  instructions?: string;
  /** Extra material for the model, e.g. brand details extracted from a site. */
  context?: string;
  /** Files the person attached. Images are shown to the model; text is quoted. */
  attachments?: ChatAttachment[];
  /** Images that don't come from an upload, e.g. a frame rendered by Figma. */
  images?: ImageInput[];
  /** Elements the person picked in the preview. */
  elements?: SelectedElement[];
  /** Earlier messages of this project's conversation. */
  history: ChatMessage[];
  /** The page open in the preview. */
  currentPage: string;
  /** True for the build that turns a new project's request into its first version. */
  firstBuild?: boolean;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
}

export interface AgentResult {
  text: string;
  changed: string[];
  checkpointId?: string;
  project: Project;
}

/** The pages of a static site: its top-level HTML files, known ones first. */
async function htmlPages(project: Project): Promise<ProjectPage[]> {
  const root = siteDir(project.id);
  const known = new Map(project.pages.map((page) => [page.path, page]));
  const entries = await fs.readdir(root, { withFileTypes: true });
  const pages: ProjectPage[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
    const html = await fs.readFile(path.join(root, entry.name), "utf8");
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
    const existing = known.get(entry.name);
    pages.push({
      url: existing?.url ?? "",
      path: entry.name,
      // Copied pages keep the title they were found with; built ones follow the file.
      title: (project.source === "clone" ? existing?.title : undefined) ?? (title || entry.name),
    });
  }

  // Keep the original order, with new pages after the existing ones.
  const order = new Map(project.pages.map((page, index) => [page.path, index]));
  return pages.sort(
    (a, b) =>
      (order.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.path) ?? Number.MAX_SAFE_INTEGER) || a.path.localeCompare(b.path),
  );
}

/** Brings the project's list of pages in line with its files after a change. */
export async function syncPages(project: Project): Promise<ProjectPage[]> {
  if (project.framework === "react") {
    const flow = await analyzeFlow(project);
    return flow.screens.map((screen) => ({ url: "", path: screen.path, title: screen.title }));
  }
  return htmlPages(project);
}

/** Removes Markdown emphasis and code marks, which the chat would show as stray symbols. */
function plainText(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/gm, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
}

/** The title the project's entry page declares, used to name a newly built project. */
async function entryTitle(project: Project): Promise<string | null> {
  try {
    const html = await fs.readFile(path.join(siteDir(project.id), "index.html"), "utf8");
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
    return title ? title.slice(0, 80) : null;
  } catch {
    return null;
  }
}

async function loadImages(request: AgentRequest): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  for (const attachment of request.attachments ?? []) {
    if (attachment.kind !== "image") continue;
    const data = await readAttachment(request.project.id, attachment);
    if (data) images.push({ mediaType: attachment.mediaType, data });
  }
  return [...images, ...(request.images ?? [])];
}

/**
 * Runs one request: the model reads and changes the project's files with its
 * tools until the request is done, then answers with a short summary. All file
 * changes are recorded as a single checkpoint that can be undone.
 */
export async function runEditAgent(request: AgentRequest): Promise<AgentResult> {
  const { project, signal, emit } = request;
  const attachments = request.attachments ?? [];
  const hasAttachedImages = attachments.some((attachment) => attachment.kind === "image");
  const providers = providersFor(hasAttachedImages || (request.images?.length ?? 0) > 0);
  if (providers.length === 0) throw new AgentError(AI_SETUP_HINT);

  const recorder = new ChangeRecorder(project.id, request.prompt);
  const tools = new ProjectTools(project, recorder, attachments);
  const hooks = {
    signal,
    onText: (text: string) => emit({ type: "text", text }),
    onStatus: (message: string) => emit({ type: "status", message }),
  };

  let finalText = "";
  let failure: AgentError | null = null;
  let buildProblem: string | null = null;

  for (const [attempt, provider] of providers.entries()) {
    failure = null;
    try {
      const session = provider.startSession({
        system: systemPromptFor(project),
        tools: toolsFor(project, hasAttachedImages),
      });
      const opening = await buildFirstMessage(request, provider.supportsImages);
      let input: TurnInput = {
        kind: "user",
        // A second service starts from whatever the first one left behind.
        text:
          attempt === 0
            ? opening
            : `${opening}\n\nAn earlier attempt at this request was interrupted part-way. The files shown above are the project as it is now: check what is already done, then finish the request.`,
        images: provider.supportsImages ? await loadImages(request) : [],
      };
      let finished = false;
      let buildFixes = 0;
      let pageFixes = 0;

      for (let turn = 0; turn < MAX_TURNS && !finished; turn += 1) {
        const output = await session.send(input, {
          ...hooks,
          hasFallback: attempt < providers.length - 1,
        });

        if (output.stop === "refusal") {
          finalText = "I can't help with that request.";
          break;
        }
        // A tool input cut off at the token limit can still look valid; never run it.
        if (output.stop === "max_tokens" && output.toolCalls.length > 0) {
          throw new AgentError(
            "That change was too large to make in one step. Try asking for it in smaller parts.",
          );
        }

        if (output.toolCalls.length > 0) {
          const results: ToolResult[] = [];
          // Run in order: edits to the same file must not race each other.
          for (const call of output.toolCalls) {
            const outcome = await tools.run(call.name, call.input);
            emit({ type: "tool", name: call.name, detail: outcome.detail });
            results.push({ call, content: outcome.content, isError: outcome.isError });
          }
          input = { kind: "tool_results", results };
          continue;
        }

        // The model says it is done. Projects with a build step must still build.
        finalText = output.text.trim();
        buildProblem = null;
        if (needsBuild(project) && recorder.changedFiles.length > 0) {
          emit({ type: "status", message: "Checking that the project builds" });
          const status = await ensureBuilt(project);
          if (!status.ok) {
            buildProblem = describeBuildErrors(status.errors);
            if (buildFixes < MAX_BUILD_FIXES) {
              buildFixes += 1;
              emit({ type: "status", message: "Fixing a build error" });
              input = {
                kind: "user",
                text: `The project does not build after your changes. Fix the cause. When it is fixed, end with your summary of everything you did for the person's request, not of this fix.\n\n${buildProblem}`,
              };
              continue;
            }
          }
        }

        // Then the pages must work in a browser. Copied sites are left out: their
        // pages often carry the original site's own errors, which aren't the AI's.
        if (
          buildProblem === null &&
          pageFixes < MAX_PAGE_FIXES &&
          project.source !== "clone" &&
          recorder.changedFiles.length > 0
        ) {
          emit({ type: "status", message: "Opening the page in a browser to check it" });
          const found = await findPageProblems(project, pagesToCheck(project, request.currentPage, recorder.changedFiles), signal).catch(
            (error: unknown) => {
              console.error("Page check failed:", error);
              return null;
            },
          );
          if (found && found.length > 0) {
            pageFixes += 1;
            emit({ type: "status", message: "Fixing errors on the page" });
            input = {
              kind: "user",
              text: `The project builds, but opening it in a browser shows these errors. Fix their causes in the project's files; ignore anything that only concerns other sites' files. When it is fixed, end with your summary of everything you did for the person's request, not of this fix.\n\n${describePageProblems(found)}`,
            };
            continue;
          }
        }
        finished = true;
      }

      if (!finished && !finalText) {
        finalText =
          "I ran out of steps before finishing. Check the preview and tell me what is still missing.";
      }
      break;
    } catch (error) {
      if (error instanceof AgentError) {
        failure = error;
      } else if (signal.aborted) {
        failure = new AgentError("Stopped.");
      } else if (error instanceof AiError) {
        failure = new AgentError(error.message);
        // The service is down, busy or over its limit: the other one takes over.
        const next = providers[attempt + 1];
        if (next) {
          emit({
            type: "status",
            message: `${provider.label} couldn't finish this step. Switching to ${next.label}`,
          });
          continue;
        }
      } else {
        console.error("AI edit failed:", error);
        failure = new AgentError("Something went wrong while making the change.");
      }
      break;
    }
  }
  // Record whatever was changed, even after a failure, so it can be undone.
  const current = (await readProject(project.id)) ?? project;
  const committed = await recorder.commit(current);
  let updated = committed?.project ?? current;
  if (committed) {
    const pages = await syncPages(updated);
    const title = request.firstBuild ? await entryTitle(updated) : null;
    updated = await touchProject({
      ...updated,
      pages,
      name: title ?? updated.name,
    });
  }

  if (failure) {
    const changed = recorder.changedFiles.length;
    throw new AgentError(
      changed > 0
        ? `${failure.message} ${changed} file${changed === 1 ? " was" : "s were"} already changed; use Undo to roll that back.`
        : failure.message,
    );
  }

  const summary = plainText(finalText || "Done.");
  return {
    text: buildProblem
      ? `${summary}\n\nThe project still has a build error I couldn't fix:\n${buildProblem.slice(0, 600)}`
      : summary,
    changed: recorder.changedFiles,
    checkpointId: committed?.checkpoint.id,
    project: updated,
  };
}
