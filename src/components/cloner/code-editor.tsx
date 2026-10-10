"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { EditorCallbacks, MountedEditor } from "@/components/cloner/code-editor-setup";

interface CodeEditorProps {
  /** The file being edited; a new path starts a fresh editor (and undo history). */
  path: string;
  value: string;
  wrap: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

/**
 * A code editor with syntax colours, line numbers, folding and search
 * (CodeMirror). The editor's code is fetched when the Code view first opens, not
 * with the workspace.
 */
export function CodeEditor({ path, value, wrap, onChange, onSave }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MountedEditor | null>(null);
  const callbacks = useRef<EditorCallbacks>({ onChange, onSave });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // The editor is created once per file; these keep its handlers and text current.
  const latest = useRef({ value, wrap });
  useEffect(() => {
    callbacks.current = { onChange, onSave };
    latest.current = { value, wrap };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    import("@/components/cloner/code-editor-setup")
      .then(({ mountEditor }) => {
        if (cancelled) return;
        editorRef.current = mountEditor(
          host,
          { ...latest.current, path, label: `Contents of ${path}` },
          callbacks,
        );
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
      setReady(false);
    };
  }, [path]);

  useEffect(() => {
    if (ready) editorRef.current?.setValue(value);
  }, [ready, value]);

  useEffect(() => {
    if (ready) editorRef.current?.setWrap(wrap);
  }, [ready, wrap]);

  if (failed) {
    // Without the editor's code (offline, blocked), a plain text box still works.
    return (
      <textarea
        aria-label={`Contents of ${path}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            onSave();
          }
        }}
        spellCheck={false}
        wrap={wrap ? "soft" : "off"}
        className="absolute inset-0 size-full resize-none bg-background p-4 font-mono text-[13px] leading-5 outline-none"
      />
    );
  }

  return (
    <>
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" aria-label="Loading the editor" />
        </div>
      )}
    </>
  );
}
