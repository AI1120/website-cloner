"use client";

import {
  Check,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  RotateCw,
  Smartphone,
  Tablet,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { OPEN_PALETTE_EVENT } from "@/components/cloner/command-palette";
import { PREVIEW_SANDBOX } from "@/components/cloner/project-thumbnail";
import { Segmented, type SegmentedOption } from "@/components/cloner/segmented";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { BuildMessage, Project, SelectedElement, TextEdit } from "@/types/project";

type Device = "desktop" | "tablet" | "mobile";
type Tool = "none" | "select" | "text";

const DEVICES: SegmentedOption<Device>[] = [
  { value: "desktop", label: "Desktop", icon: Monitor, iconOnly: true },
  { value: "tablet", label: "Tablet", icon: Tablet, iconOnly: true },
  { value: "mobile", label: "Phone", icon: Smartphone, iconOnly: true },
];

const DEVICE_FRAME: Record<Device, string> = {
  desktop: "w-full",
  tablet: "w-[820px] max-w-full",
  mobile: "w-[390px] max-w-full",
};

/** Messages the bridge inside the preview sends to the editor. */
type BridgeMessage =
  | { type: "sc:ready" }
  | { type: "sc:location"; path: string }
  | { type: "sc:select"; elements: SelectedElement[] }
  | { type: "sc:text-dirty"; count: number }
  | { type: "sc:text-edits"; requestId: number; edits: TextEdit[] }
  | { type: "sc:error"; message: string }
  | { type: "sc:build-error"; errors: BuildMessage[] }
  | { type: "sc:escape" }
  | { type: "sc:palette" };

interface PreviewPaneProps {
  project: Project;
  currentPage: string;
  onPageChange: (path: string) => void;
  /** Changes whenever the project's files change, to reload the frame. */
  version: number;
  /** True while the AI is changing the project; editing in place waits. */
  busy: boolean;
  selectionCount: number;
  onSelect: (elements: SelectedElement[]) => void;
  onProjectChange: (project: Project) => void;
  onNotice: (notice: { text: string; error?: boolean }) => void;
  onRuntimeError: (message: string) => void;
  onBuildErrors: (errors: BuildMessage[]) => void;
  /** Text edits that could not be saved; the workspace offers them to the AI. */
  onUnsavedEdits: (edits: TextEdit[]) => void;
}

export function PreviewPane({
  project,
  currentPage,
  onPageChange,
  version,
  busy,
  selectionCount,
  onSelect,
  onProjectChange,
  onNotice,
  onRuntimeError,
  onBuildErrors,
  onUnsavedEdits,
}: PreviewPaneProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [tool, setTool] = useState<Tool>("none");
  const [expanded, setExpanded] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [saving, setSaving] = useState(false);
  // The page the frame is known to show, and the address it was last sent to.
  // Navigation inside the frame changes the first without the second, so the
  // frame isn't reloaded for it.
  const [shownPage, setShownPage] = useState(currentPage);
  const [frameSrc, setFrameSrc] = useState(`/preview/${project.id}/${currentPage}`);
  if (shownPage !== currentPage) {
    // The page was changed from the editor, not by the frame: send the frame there.
    setShownPage(currentPage);
    setFrameSrc(`/preview/${project.id}/${currentPage}`);
  }

  // Unsaved text edits belong to one loaded document; a reload starts from zero.
  const frameKey = `${frameSrc.split("#")[0]}:${version}:${reloads}`;
  const [dirtyState, setDirtyState] = useState({ key: frameKey, count: 0 });
  const dirty = dirtyState.key === frameKey ? dirtyState.count : 0;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const toolRef = useRef<Tool>("none");
  const frameKeyRef = useRef(frameKey);
  const reportedPageRef = useRef(currentPage);
  useEffect(() => {
    frameKeyRef.current = frameKey;
    reportedPageRef.current = shownPage;
  }, [frameKey, shownPage]);
  const pendingEditsRef = useRef<{ id: number; resolve: (edits: TextEdit[]) => void } | null>(null);
  const requestIdRef = useRef(0);
  const framed = device !== "desktop";

  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  const changeTool = useCallback(
    (next: Tool) => {
      toolRef.current = next;
      setTool(next);
      post({ type: "sc:mode", mode: next });
      if (next !== "select") onSelect([]);
    },
    [onSelect, post],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as BridgeMessage | null;
      if (!message || typeof message.type !== "string") return;

      switch (message.type) {
        case "sc:ready":
          post({ type: "sc:mode", mode: toolRef.current });
          break;
        case "sc:location":
          if (typeof message.path === "string" && message.path !== reportedPageRef.current) {
            const known = project.pages.some((page) => page.path === message.path);
            if (known) {
              reportedPageRef.current = message.path;
              setShownPage(message.path);
              onPageChange(message.path);
            }
          }
          break;
        case "sc:select":
          if (Array.isArray(message.elements)) onSelect(message.elements);
          break;
        case "sc:text-dirty":
          setDirtyState({
            key: frameKeyRef.current,
            count: typeof message.count === "number" ? message.count : 0,
          });
          break;
        case "sc:text-edits": {
          const pending = pendingEditsRef.current;
          if (pending && pending.id === message.requestId && Array.isArray(message.edits)) {
            pendingEditsRef.current = null;
            pending.resolve(message.edits);
          }
          break;
        }
        case "sc:error":
          if (typeof message.message === "string") onRuntimeError(message.message);
          break;
        case "sc:build-error":
          if (Array.isArray(message.errors)) onBuildErrors(message.errors);
          break;
        case "sc:escape":
          if (toolRef.current === "select") changeTool("none");
          break;
        case "sc:palette":
          window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [changeTool, onBuildErrors, onPageChange, onRuntimeError, onSelect, post, project.pages]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // The selection can be cleared from the chat; the frame's outlines follow.
  useEffect(() => {
    if (selectionCount === 0) post({ type: "sc:clear-selection" });
  }, [post, selectionCount]);

  const collectEdits = useCallback((): Promise<TextEdit[]> => {
    requestIdRef.current += 1;
    const id = requestIdRef.current;
    return new Promise((resolve) => {
      pendingEditsRef.current = { id, resolve };
      post({ type: "sc:collect-text", requestId: id });
      setTimeout(() => {
        if (pendingEditsRef.current?.id === id) {
          pendingEditsRef.current = null;
          resolve([]);
        }
      }, 3000);
    });
  }, [post]);

  const applyEdits = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const edits = await collectEdits();
      if (edits.length === 0) {
        onNotice({ text: "There were no text changes to save." });
        changeTool("none");
        return;
      }
      const response = await fetch(`/api/projects/${project.id}/text-edits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: reportedPageRef.current, edits }),
      });
      if (!response.ok) {
        onNotice({
          text: await errorMessage(response, "The text changes could not be saved."),
          error: true,
        });
        return;
      }
      const body = (await response.json()) as {
        project: Project;
        applied: number;
        failed: TextEdit[];
      };
      changeTool("none");
      onProjectChange(body.project);
      if (body.failed.length > 0) {
        onUnsavedEdits(body.failed);
      } else {
        onNotice({ text: `Saved ${plural(body.applied, "text change")}.` });
      }
    } catch {
      onNotice({ text: "Couldn't reach the app. Is it still running?", error: true });
    } finally {
      setSaving(false);
    }
  }, [changeTool, collectEdits, onNotice, onProjectChange, onUnsavedEdits, project.id, saving]);

  const discardEdits = () => {
    changeTool("none");
    setReloads((count) => count + 1);
  };

  const toggleTool = (wanted: Exclude<Tool, "none">) => {
    if (tool === "text" && dirty > 0 && wanted !== "text") {
      if (!window.confirm("Discard the text changes you haven't applied?")) return;
      setReloads((count) => count + 1);
    }
    changeTool(tool === wanted ? "none" : wanted);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background",
        expanded && "fixed inset-0 z-40",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        {project.pages.length > 1 ? (
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="sr-only">Page</span>
            <select
              value={currentPage}
              onChange={(event) => onPageChange(event.target.value)}
              className="h-7 max-w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {project.pages.map((page) => (
                <option key={page.path} value={page.path}>
                  {page.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {project.pages[0]?.title ?? currentPage}
          </span>
        )}

        <Button
          variant={tool === "select" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Select elements to ask about"
          aria-pressed={tool === "select"}
          title="Select elements to ask about (Shift-click for several)"
          onClick={() => toggleTool("select")}
        >
          <MousePointer2 />
        </Button>
        <Button
          variant={tool === "text" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Edit text in the preview"
          aria-pressed={tool === "text"}
          title="Edit text in the preview"
          disabled={busy}
          onClick={() => toggleTool("text")}
        >
          <Type />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Segmented label="Screen size" value={device} options={DEVICES} onChange={setDevice} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload preview"
          title="Reload preview"
          onClick={() => setReloads((count) => count + 1)}
        >
          <RotateCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Leave full screen" : "Full screen"}
          aria-pressed={expanded}
          title={expanded ? "Leave full screen (Esc)" : "Full screen"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open preview in a new tab"
          title="Open in a new tab"
          nativeButton={false}
          render={<a href={`/preview/${project.id}/${currentPage}`} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink />
        </Button>
      </div>

      {tool === "select" && (
        <p className="shrink-0 border-b bg-brand/5 px-4 py-1.5 text-xs text-muted-foreground">
          Click an element to select it, Shift-click to add more, then describe the change in the
          chat.
        </p>
      )}
      {tool === "text" && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-brand/5 px-4 py-1.5 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">
            {dirty > 0
              ? `${plural(dirty, "text change")} not saved yet.`
              : "Click any text in the preview and type to change it."}
          </span>
          <Button variant="outline" size="xs" disabled={saving} onClick={discardEdits}>
            <X data-icon="inline-start" />
            Discard
          </Button>
          <Button size="xs" disabled={saving || dirty === 0} onClick={() => void applyEdits()}>
            {saving ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Apply changes
          </Button>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-0 flex-1 justify-center overflow-auto bg-muted",
          framed && "p-4 sm:p-6",
        )}
      >
        <iframe
          ref={frameRef}
          key={frameKey}
          src={frameSrc}
          title={`Preview of ${project.name}`}
          sandbox={PREVIEW_SANDBOX}
          className={cn(
            "h-full min-h-0 border-0 bg-white",
            DEVICE_FRAME[device],
            framed && "rounded-xl shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_20px_50px_-20px_rgb(0_0_0/0.35)]",
          )}
        />
      </div>
    </div>
  );
}
