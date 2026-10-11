"use client";

import { Eye, FileCode2, FileMinus, FilePen, FilePlus, LoaderCircle, Undo2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Segmented } from "@/components/cloner/segmented";
import { VisualChange } from "@/components/cloner/visual-change";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNow } from "@/hooks/use-client";
import { plural, timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { FileChange, Project, ProjectCheckpoint } from "@/types/project";

/** Which change to show, and optionally which of its files to open first. */
export interface ChangesTarget {
  checkpointId: string;
  file?: string;
}

interface Loaded {
  checkpointId: string;
  checkpoint: ProjectCheckpoint;
  files: FileChange[];
}

const STATUS = {
  added: { icon: FilePlus, label: "Added", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { icon: FilePen, label: "Changed", className: "text-brand" },
  removed: { icon: FileMinus, label: "Removed", className: "text-destructive" },
} satisfies Record<FileChange["status"], unknown>;

function splitPath(file: string): { name: string; folder: string } {
  const index = file.lastIndexOf("/");
  return index === -1
    ? { name: file, folder: "" }
    : { name: file.slice(index + 1), folder: file.slice(0, index + 1) };
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-red-600 dark:text-red-400">−{removed}</span>}
    </span>
  );
}

function FileDiff({ change }: { change: FileChange }) {
  if (!change.hunks) {
    return <p className="p-5 text-sm text-muted-foreground">{change.note}</p>;
  }
  if (change.hunks.length === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        {change.status === "added" ? "This new file is empty." : "The text of this file didn't change."}
      </p>
    );
  }
  return (
    <div className="min-w-0">
      {change.note && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{change.note}</p>}
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>
          {change.hunks.map((hunk, hunkIndex) => (
            <Fragment key={hunkIndex}>
              {hunkIndex > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={4} className="bg-muted/60 px-3 text-center text-muted-foreground select-none">
                    ⋯
                  </td>
                </tr>
              )}
              {hunk.lines.map((line, lineIndex) => (
                <tr
                  key={lineIndex}
                  className={cn(
                    line.kind === "added" && "bg-emerald-500/10",
                    line.kind === "removed" && "bg-red-500/10",
                  )}
                >
                  <td className="w-10 pr-2 pl-3 text-right align-top text-muted-foreground/70 select-none">
                    {line.oldLine ?? ""}
                  </td>
                  <td className="w-10 pr-2 text-right align-top text-muted-foreground/70 select-none">
                    {line.newLine ?? ""}
                  </td>
                  <td
                    className={cn(
                      "w-5 text-center align-top select-none",
                      line.kind === "added" && "text-emerald-700 dark:text-emerald-400",
                      line.kind === "removed" && "text-red-700 dark:text-red-400",
                    )}
                  >
                    {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                    <span className="sr-only">
                      {line.kind === "added" ? "added" : line.kind === "removed" ? "removed" : ""}
                    </span>
                  </td>
                  <td className="pr-4 align-top whitespace-pre">{line.text || " "}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ChangesDialogProps {
  project: Project;
  /** The change to show; null keeps the dialog closed. */
  target: ChangesTarget | null;
  onClose: () => void;
  onUndo: (checkpointId: string) => void;
  /** True while undoing isn't possible, e.g. while the AI is working. */
  undoDisabled: boolean;
  /** The page in the preview, pictured before and after in the Visual view. */
  page: string;
  /** False without a browser on the server, which the Visual view needs. */
  canPicture: boolean;
}

const MODES = [
  { value: "code" as const, label: "Code", icon: FileCode2 },
  { value: "visual" as const, label: "Visual", icon: Eye },
];

/** The files one change touched, each shown as a line-by-line comparison. */
export function ChangesDialog({ project, target, onClose, onUndo, undoDisabled, page, canPicture }: ChangesDialogProps) {
  const [mode, setMode] = useState<"code" | "visual">("code");
  const projectId = project.id;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ checkpointId: string; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(30_000);
  const checkpointId = target?.checkpointId ?? null;

  useEffect(() => {
    if (!checkpointId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/changes/${encodeURIComponent(checkpointId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response, "The change couldn't be loaded."));
        return (await response.json()) as Omit<Loaded, "checkpointId">;
      })
      .then((body) => {
        if (!cancelled) setLoaded({ ...body, checkpointId });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const text =
          reason instanceof Error && reason.message !== "Failed to fetch"
            ? reason.message
            : "Couldn't reach the app. Is it still running?";
        setError({ checkpointId, text });
      });
    return () => {
      cancelled = true;
    };
  }, [checkpointId, projectId]);

  const current = loaded && loaded.checkpointId === checkpointId ? loaded : null;
  const failure = error && error.checkpointId === checkpointId ? error.text : null;
  const files = current?.files ?? [];
  const active =
    files.find((file) => file.path === selected) ??
    files.find((file) => file.path === target?.file) ??
    files[0] ??
    null;
  const position = project.checkpoints.findIndex((item) => item.id === checkpointId);
  const laterChanges = position === -1 ? 0 : project.checkpoints.length - position - 1;
  const close = () => {
    setSelected(null);
    setMode("code");
    setLoaded(null);
    setError(null);
    onClose();
  };
  const totals = files.reduce(
    (sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
    { added: 0, removed: 0 },
  );

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="h-[min(85dvh,760px)] max-w-5xl gap-0 p-0">
        <DialogHeader className="relative border-b px-5 py-4 pr-14">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <DialogTitle className="flex-1">What changed</DialogTitle>
            {canPicture && current && (
              <Segmented label="Show the change as" value={mode} options={MODES} onChange={setMode} />
            )}
          </div>
          <DialogDescription className="line-clamp-2">
            {current ? (
              <>
                {current.checkpoint.label}
                <span className="text-muted-foreground/80">
                  {" · "}
                  {plural(files.length, "file")}
                  {now !== null && ` · ${timeAgo(current.checkpoint.createdAt, now)}`}
                </span>
              </>
            ) : (
              "Each file this change touched, before and after."
            )}
          </DialogDescription>
        </DialogHeader>

        {mode === "visual" && current ? (
          <VisualChange
            key={`${current.checkpointId}:${page}`}
            projectId={projectId}
            checkpointId={current.checkpointId}
            page={page}
          />
        ) : failure ? (
          <p role="alert" className="flex-1 p-5 text-sm text-destructive">
            {failure}
          </p>
        ) : !current ? (
          <p className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Comparing files…
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav
              aria-label="Changed files"
              className="max-h-36 shrink-0 overflow-y-auto border-b p-1.5 md:max-h-none md:w-64 md:border-r md:border-b-0"
            >
              <p className="flex items-center justify-between px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                <span>{plural(files.length, "file")}</span>
                <Counts {...totals} />
              </p>
              <ul className="space-y-0.5">
                {files.map((file) => {
                  const { icon: Icon, label, className } = STATUS[file.status];
                  const { name, folder } = splitPath(file.path);
                  const isActive = file.path === active?.path;
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        title={`${label}: ${file.path}`}
                        onClick={() => setSelected(file.path)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                          isActive && "bg-muted",
                        )}
                      >
                        <Icon className={cn("size-3.5 shrink-0", className)} aria-label={label} />
                        <span className="min-w-0 flex-1 truncate">
                          {name}
                          {folder && <span className="ml-1.5 text-xs text-muted-foreground">{folder}</span>}
                        </span>
                        <Counts added={file.added} removed={file.removed} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              {active ? (
                <>
                  <p className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{active.path}</span>
                    <span className={cn("shrink-0", STATUS[active.status].className)}>
                      {STATUS[active.status].label}
                    </span>
                  </p>
                  <FileDiff change={active} />
                </>
              ) : (
                <p className="p-5 text-sm text-muted-foreground">No files changed.</p>
              )}
            </div>
          </div>
        )}

        {current && position !== -1 && (
          <DialogFooter className="items-center border-t px-5 py-3">
            {laterChanges > 0 && (
              <p className="text-xs text-muted-foreground sm:mr-auto">
                Undoing it also undoes the {plural(laterChanges, "change")} made after it.
              </p>
            )}
            <Button
              variant="outline"
              disabled={undoDisabled}
              onClick={() => {
                onUndo(current.checkpointId);
                close();
              }}
            >
              <Undo2 data-icon="inline-start" />
              Undo this change
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
