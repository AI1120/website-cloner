"use client";

import { ChevronRight, FileCode, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { Project, ProjectFile } from "@/types/project";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;

interface FileGroup {
  name: string;
  files: ProjectFile[];
}

/** Name shown for the files at the top level of the project. */
const ROOT = "";

function groupFiles(files: ProjectFile[]): FileGroup[] {
  const groups = new Map<string, ProjectFile[]>();
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const folder = slash === -1 ? ROOT : file.path.slice(0, slash);
    const group = groups.get(folder);
    if (group) group.push(file);
    else groups.set(folder, [file]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === ROOT ? -1 : b === ROOT ? 1 : a.localeCompare(b)))
    .map(([name, groupedFiles]) => ({ name, files: groupedFiles }));
}

type Loaded =
  | { state: "loading" }
  | { state: "ready"; original: string }
  | { state: "error"; message: string };

interface CodePaneProps {
  project: Project;
  /** Changes whenever the project's files change outside this pane. */
  version: number;
  onProjectChange: (project: Project) => void;
}

export function CodePane({ project, version, onProjectChange }: CodePaneProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selected, setSelected] = useState(project.entry);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);

  const selectedFile = files.find((file) => file.path === selected);
  const isText = selectedFile ? selectedFile.text : true;
  const dirty = loaded.state === "ready" && draft !== loaded.original;
  const groups = useMemo(() => groupFiles(files), [files]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${project.id}/files`)
      .then((response) => (response.ok ? response.json() : { files: [] }))
      .then((body: { files: ProjectFile[] }) => {
        if (!cancelled) setFiles(body.files);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, version]);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setLoaded({ state: "loading" });
    setSaveError(null);
    fetch(`/api/projects/${project.id}/file?path=${encodeURIComponent(selected)}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setLoaded({
            state: "error",
            message: await errorMessage(response, "This file could not be opened."),
          });
          return;
        }
        const body = (await response.json()) as { content: string };
        if (cancelled) return;
        setLoaded({ state: "ready", original: body.content });
        setDraft(body.content);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: "error", message: "This file could not be opened." });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, selected, isText, version]);

  const selectFile = useCallback(
    (path: string) => {
      if (path === selected) return;
      if (dirty && !window.confirm("Discard your unsaved changes to this file?")) return;
      setSelected(path);
    },
    [dirty, selected],
  );

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(
        `/api/projects/${project.id}/file?path=${encodeURIComponent(selected)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: draft }),
        },
      );
      if (!response.ok) {
        setSaveError(await errorMessage(response, "The file could not be saved."));
        return;
      }
      const body = (await response.json()) as { project: Project };
      setLoaded({ state: "ready", original: draft });
      onProjectChange(body.project);
    } catch {
      setSaveError("The file could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, onProjectChange, project.id, saving, selected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="Project files"
        className="max-h-40 shrink-0 overflow-y-auto border-b p-2 md:max-h-none md:w-60 md:border-r md:border-b-0"
      >
        {groups.map((group) => (
          <details
            key={group.name}
            // Small projects show everything; large copies open only what is usually edited.
            open={groups.length <= 8 || group.name === ROOT || group.name.endsWith("/css")}
          >
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform [[open]>summary>&]:rotate-90" />
              {group.name === ROOT ? (project.framework === "react" ? "Project" : "Pages") : group.name}
              <span className="ml-auto tabular-nums">{group.files.length}</span>
            </summary>
            <ul className="mb-1">
              {group.files.map((file) => {
                const name = file.path.slice(file.path.lastIndexOf("/") + 1);
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => selectFile(file.path)}
                      aria-current={file.path === selected ? "true" : undefined}
                      title={file.path}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md py-1 pr-1.5 pl-6 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        file.path === selected
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                        {formatBytes(file.size)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <FileCode className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {selected}
            {dirty && <span className="text-muted-foreground"> · unsaved</span>}
          </span>
          {saveError && (
            <span role="alert" className="truncate text-xs text-destructive">
              {saveError}
            </span>
          )}
          {isText && (
            <>
              <label className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <input
                  type="checkbox"
                  checked={wrap}
                  onChange={(event) => setWrap(event.target.checked)}
                  className="accent-foreground"
                />
                Wrap lines
              </label>
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                Save
              </Button>
            </>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {!isText ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              {IMAGE_EXTENSION.test(selected) ? (
                // A file of the cloned site, served by this app's preview route.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/preview/${project.id}/${selected}`}
                  alt={selected}
                  className="max-h-[70%] max-w-full rounded-md border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
                />
              ) : (
                <p>This file can&apos;t be shown as text.</p>
              )}
              {selectedFile && <p className="text-xs">{formatBytes(selectedFile.size)}</p>}
            </div>
          ) : loaded.state === "loading" ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" aria-label="Loading file" />
            </div>
          ) : loaded.state === "error" ? (
            <p role="alert" className="p-6 text-sm text-destructive">
              {loaded.message}
            </p>
          ) : (
            <textarea
              aria-label={`Contents of ${selected}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              wrap={wrap ? "soft" : "off"}
              className={cn(
                "absolute inset-0 size-full resize-none bg-background p-4 font-mono text-[13px] leading-5 outline-none",
                wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
