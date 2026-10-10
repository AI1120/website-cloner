"use client";

import {
  ArrowLeft,
  Code,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileDiff,
  House,
  MessageSquareText,
  PencilLine,
  Rocket,
  TriangleAlert,
  Undo2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  useOpenProjectCommands,
  useProjectList,
  useThemeCommands,
} from "@/components/cloner/app-commands";
import { ChangesDialog, type ChangesTarget } from "@/components/cloner/changes-dialog";
import { ChatPanel, type ChatRequest } from "@/components/cloner/chat-panel";
import { CodePane } from "@/components/cloner/code-pane";
import {
  CommandPalette,
  PaletteButton,
  usePaletteShortcut,
  type Command,
} from "@/components/cloner/command-palette";
import { DataPane } from "@/components/cloner/data-pane";
import { ExportMenu, exportUrl, formatsFor } from "@/components/cloner/export-menu";
import { FlowPane } from "@/components/cloner/flow-pane";
import { HistoryMenu } from "@/components/cloner/history-menu";
import { PreviewPane } from "@/components/cloner/preview-pane";
import { livePath, PublishControl, requestPublish } from "@/components/cloner/publish-control";
import { Segmented, type SegmentedOption } from "@/components/cloner/segmented";
import { ThemeToggle } from "@/components/cloner/theme-toggle";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/ndjson";
import { projectKind } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { BuildMessage, ChatMessage, Project, SelectedElement, TextEdit } from "@/types/project";

type Panel = "chat" | "preview" | "code" | "data" | "flow";

const PANELS: SegmentedOption<Panel>[] = [
  // On wide screens the chat sits beside the other views, so it needs no tab.
  { value: "chat", label: "Chat", icon: MessageSquareText, className: "lg:hidden" },
  { value: "preview", label: "Preview", icon: Eye },
  { value: "code", label: "Code", icon: Code },
  { value: "data", label: "Data", icon: Database },
  { value: "flow", label: "Flow", icon: Workflow },
];

const UNREACHABLE = "Couldn't reach the app. Is it still running?";

function showNotice({ text, error }: { text: string; error?: boolean }) {
  if (error) toast.error(text);
  else toast.info(text);
}

/** Starts a download without leaving the page. */
function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

/** Something wrong with the project that the AI can be asked to fix. */
interface Problem {
  title: string;
  detail: string;
  prompt: string;
}

function buildProblem(errors: BuildMessage[]): Problem {
  const detail = errors
    .map((error) => `${error.file ? `${error.file}${error.line ? `:${error.line}` : ""}: ` : ""}${error.text}`)
    .join("\n");
  return {
    title: "This project doesn't build",
    detail,
    prompt: `The project does not build. Fix it.\n\n${detail}`,
  };
}

interface WorkspaceProps {
  initialProject: Project;
  initialMessages: ChatMessage[];
  initiallyRunning: boolean;
  aiConfigured: boolean;
}

export function Workspace({
  initialProject,
  initialMessages,
  initiallyRunning,
  aiConfigured,
}: WorkspaceProps) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [panel, setPanel] = useState<Panel>("preview");
  const [currentPage, setCurrentPage] = useState(initialProject.entry);
  const [version, setVersion] = useState(0);
  const [changesTarget, setChangesTarget] = useState<ChangesTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(initialProject.warnings.length > 0);
  const [selection, setSelection] = useState<SelectedElement[]>([]);
  const [running, setRunning] = useState(initiallyRunning || initialProject.pending);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [request, setRequest] = useState<ChatRequest | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialProject.name);
  const requestIdRef = useRef(0);

  /** Takes a project whose files changed and reloads everything showing them. */
  const applyChangedProject = useCallback((next: Project) => {
    setProject(next);
    setVersion((value) => value + 1);
    setSelection([]);
    setProblem(null);
    setCurrentPage((page) => (next.pages.some((item) => item.path === page) ? page : next.entry));
  }, []);

  const askAi = useCallback((prompt: string) => {
    requestIdRef.current += 1;
    setRequest({ id: requestIdRef.current, prompt });
    setProblem(null);
  }, []);

  const undo = useCallback(
    async (checkpointId: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/projects/${project.id}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ checkpointId }),
        });
        if (!response.ok) {
          toast.error(await errorMessage(response, "That change could not be undone."));
          return false;
        }
        const body = (await response.json()) as { project: Project };
        applyChangedProject(body.project);
        toast.success("Change undone");
        return true;
      } catch {
        toast.error(UNREACHABLE);
        return false;
      }
    },
    [applyChangedProject, project.id],
  );

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const name = nameDraft.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!name || name === project.name) {
      setNameDraft(project.name);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        toast.error(await errorMessage(response, "The name could not be changed."));
        setNameDraft(project.name);
        return;
      }
      const body = (await response.json()) as { project: Project };
      setProject(body.project);
      setNameDraft(body.project.name);
    } catch {
      toast.error(UNREACHABLE);
      setNameDraft(project.name);
    }
  };

  const handleRuntimeError = useCallback((message: string) => {
    setProblem((current) =>
      current ?? {
        title: "The page reported an error",
        detail: message,
        prompt: `The page shows this error in the browser. Find the cause and fix it.\n\n${message}`,
      },
    );
  }, []);

  const handleBuildErrors = useCallback((errors: BuildMessage[]) => {
    if (errors.length > 0) setProblem(buildProblem(errors));
  }, []);

  // Ask whether the project builds whenever its files change. The preview also
  // reports build errors, but it can do so before this page is listening.
  const hasBuildStep = project.framework === "react" || project.styling === "tailwind";
  useEffect(() => {
    if (!hasBuildStep) return;
    let cancelled = false;
    fetch(`/api/projects/${project.id}?build=1`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { build?: { ok: boolean; errors: BuildMessage[] } } | null) => {
        if (!cancelled && body?.build && !body.build.ok) handleBuildErrors(body.build.errors);
      })
      .catch(() => {
        // The preview will show the problem if there is one.
      });
    return () => {
      cancelled = true;
    };
  }, [handleBuildErrors, hasBuildStep, project.id, version]);

  const handleUnsavedEdits = useCallback((edits: TextEdit[]) => {
    const list = edits
      .map((edit) => `- change "${edit.before.trim()}" to "${edit.after.trim()}"`)
      .join("\n");
    setProblem({
      title: `${edits.length === 1 ? "One text change" : `${edits.length} text changes`} couldn't be saved automatically`,
      detail: "The text comes from somewhere the editor couldn't trace. The AI can make the change instead.",
      prompt: `Make these text changes on the page:\n${list}`,
    });
  }, []);

  const openScreen = useCallback((path: string) => {
    setCurrentPage(path);
    setPanel("preview");
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteShortcut(openPalette);
  const themeCommands = useThemeCommands();
  const projectCommands = useOpenProjectCommands(useProjectList(paletteOpen), project.id);
  const latestChange = project.checkpoints.at(-1) ?? null;

  const publish = useCallback(async () => {
    const result = await requestPublish(project.id, "POST");
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setProject(result.project);
    toast.success(project.published ? "Published site updated" : "Published", {
      description: "Anyone with the link can open it.",
      action: {
        label: "Open",
        onClick: () => window.open(livePath(result.project), "_blank", "noreferrer"),
      },
    });
  }, [project.id, project.published]);

  const commands = useMemo((): Command[] => {
    const list: Command[] = PANELS.map((option) => ({
      id: `view-${option.value}`,
      group: "Views",
      label: option.value === "chat" ? "Chat with the AI" : `Show ${option.label.toLowerCase()}`,
      icon: option.icon,
      keywords: "view switch tab",
      run: () => {
        if (option.value !== "chat") {
          setPanel(option.value);
          return;
        }
        // Wide screens always show the chat; narrow ones switch to it.
        if (!window.matchMedia("(min-width: 64rem)").matches) setPanel("chat");
        requestAnimationFrame(() => document.getElementById("chat-prompt")?.focus());
      },
    }));

    if (latestChange) {
      list.push({
        id: "change-view",
        group: "Project",
        label: "View the latest change",
        icon: FileDiff,
        keywords: "diff history compare what changed",
        hint: latestChange.label,
        run: () => setChangesTarget({ checkpointId: latestChange.id }),
      });
      if (!running) {
        list.push({
          id: "change-undo",
          group: "Project",
          label: "Undo the latest change",
          icon: Undo2,
          keywords: "revert history",
          hint: latestChange.label,
          run: () => void undo(latestChange.id),
        });
      }
    }
    list.push({
      id: "rename",
      group: "Project",
      label: "Rename project",
      icon: PencilLine,
      run: () => setRenaming(true),
    });
    list.push({
      id: "publish",
      group: "Project",
      label: project.published ? "Update the published site" : "Publish",
      icon: Rocket,
      keywords: "share link deploy live",
      run: () => void publish(),
    });
    if (project.published) {
      const path = livePath(project);
      list.push(
        {
          id: "live-open",
          group: "Project",
          label: "Open the published site",
          icon: ExternalLink,
          keywords: "live link",
          run: () => window.open(path, "_blank", "noreferrer"),
        },
        {
          id: "live-copy",
          group: "Project",
          label: "Copy the published link",
          icon: Copy,
          keywords: "share live url",
          run: () => {
            navigator.clipboard
              .writeText(`${window.location.origin}${path}`)
              .then(() => toast.success("Link copied"))
              .catch(() => toast.error("The link couldn't be copied."));
          },
        },
      );
    }
    for (const { format, label, hint } of formatsFor(project)) {
      list.push({
        id: `export-${format}`,
        group: "Export",
        label: `Export: ${label} (.zip)`,
        icon: Download,
        keywords: "download zip code",
        hint,
        run: () => {
          download(exportUrl(project, format));
          toast.info("Preparing the download…");
        },
      });
    }
    list.push({
      id: "home",
      group: "Projects",
      label: "All projects",
      icon: House,
      keywords: "home back start new",
      run: () => router.push("/"),
    });
    return [...list, ...projectCommands, ...themeCommands];
  }, [latestChange, project, projectCommands, publish, router, running, themeCommands, undo]);

  const mainView: Exclude<Panel, "chat"> = panel === "chat" ? "preview" : panel;
  const actions = (
    <>
      <HistoryMenu
        project={project}
        disabled={running}
        onRestore={(id) => void undo(id)}
        onView={(checkpointId) => setChangesTarget({ checkpointId })}
      />
      <ThemeToggle />
      <ExportMenu project={project} />
      <PublishControl project={project} onProjectChange={setProject} />
    </>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to projects"
          title="Back to projects"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={rename}>
              <label htmlFor="project-name" className="sr-only">
                Project name
              </label>
              <input
                id="project-name"
                autoFocus
                value={nameDraft}
                maxLength={120}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={rename}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setNameDraft(project.name);
                    setRenaming(false);
                  }
                }}
                className="h-7 w-full max-w-sm rounded-md border bg-background px-2 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </form>
          ) : (
            <h1 className="truncate text-sm leading-tight font-medium">
              <button
                type="button"
                title="Rename"
                onClick={() => setRenaming(true)}
                className="max-w-full truncate rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {project.name}
              </button>
            </h1>
          )}
          {project.source === "clone" ? (
            <a
              href={project.finalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">Copied from {project.host}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {projectKind(project)}
              {project.designSystem ? ` · ${project.designSystem}` : ""}
            </p>
          )}
        </div>

        <Segmented label="View" value={panel} options={PANELS} onChange={setPanel} collapseLabels />

        <PaletteButton onClick={openPalette} className="hidden md:inline-flex" />
        <div className="hidden items-center gap-2 md:flex">{actions}</div>
      </header>

      {/* Narrow screens get the actions on their own row so the title keeps its space. */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-b px-3 py-2 md:hidden">
        <PaletteButton onClick={openPalette} className="mr-auto" />
        {actions}
      </div>

      {problem && !running && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2.5 border-b bg-destructive/5 px-4 py-2.5 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{problem.title}</p>
            <p className="mt-0.5 line-clamp-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {problem.detail}
            </p>
          </div>
          {aiConfigured && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => askAi(problem.prompt)}
            >
              <Wrench data-icon="inline-start" />
              Fix with AI
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setProblem(null)}>
            <X />
          </Button>
        </div>
      )}

      {warningsOpen && project.warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2.5 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <ul className="min-w-0 flex-1 space-y-1">
            {project.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss notes"
            onClick={() => setWarningsOpen(false)}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ChatPanel
          project={project}
          initialMessages={initialMessages}
          initiallyRunning={initiallyRunning}
          aiConfigured={aiConfigured}
          currentPage={currentPage}
          selection={selection}
          onRemoveSelected={(index) =>
            setSelection((current) => current.filter((_, position) => position !== index))
          }
          onClearSelection={() => setSelection([])}
          request={request}
          onProjectChange={applyChangedProject}
          onRunningChange={setRunning}
          onUndo={undo}
          onViewChanges={setChangesTarget}
          className={cn(
            "w-full lg:flex lg:w-[380px] lg:shrink-0 lg:border-r",
            panel === "chat" ? "flex" : "hidden",
          )}
        />
        <main className={cn("min-w-0 flex-1 flex-col lg:flex", panel === "chat" ? "hidden" : "flex")}>
          {/* The preview stays mounted so a half-finished text edit survives a look at the code. */}
          <div className={cn("min-h-0 flex-1 flex-col", mainView === "preview" ? "flex" : "hidden")}>
            <PreviewPane
              project={project}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              version={version}
              busy={running}
              selectionCount={selection.length}
              onSelect={setSelection}
              onProjectChange={applyChangedProject}
              onNotice={showNotice}
              onRuntimeError={handleRuntimeError}
              onBuildErrors={handleBuildErrors}
              onUnsavedEdits={handleUnsavedEdits}
            />
          </div>
          {mainView === "code" && (
            <CodePane project={project} version={version} onProjectChange={applyChangedProject} />
          )}
          {mainView === "data" && <DataPane project={project} version={version} />}
          {mainView === "flow" && <FlowPane project={project} version={version} onOpen={openScreen} />}
        </main>
      </div>

      <ChangesDialog
        project={project}
        target={changesTarget}
        onClose={() => setChangesTarget(null)}
        onUndo={(checkpointId) => void undo(checkpointId)}
        undoDisabled={running}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  );
}
