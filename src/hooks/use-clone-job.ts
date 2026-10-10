"use client";

import { useCallback, useRef, useState } from "react";

import { errorMessage, readNdjson } from "@/lib/ndjson";
import type { CloneEvent, CloneOptions, Project } from "@/types/project";

export interface CloneProgress {
  message: string;
  done: number;
  total: number;
  bytes: number;
}

export type CloneJob =
  | { status: "idle" }
  | { status: "running"; url: string; progress: CloneProgress }
  | { status: "error"; message: string };

export interface CloneExtras {
  /** Exactly these pages are copied besides the entered one, when given. */
  pages?: string[];
  /** Changes for the AI to make once the copy exists. */
  prompt?: string;
}

const INITIAL_PROGRESS: CloneProgress = {
  message: "Starting",
  done: 0,
  total: 0,
  bytes: 0,
};

/**
 * Runs one clone at a time against the API and tracks its streamed progress.
 * `start` resolves with the new project, or null if it failed or was cancelled.
 */
export function useCloneJob() {
  const [job, setJob] = useState<CloneJob>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (url: string, options: CloneOptions, extra: CloneExtras = {}): Promise<Project | null> => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      let progress = INITIAL_PROGRESS;
      setJob({ status: "running", url, progress });

      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "clone",
            url,
            ...options,
            choosePages: extra.pages !== undefined,
            pages: extra.pages ?? [],
            prompt: extra.prompt ?? "",
          }),
          signal: abort.signal,
        });
        if (!response.ok) {
          setJob({
            status: "error",
            message: await errorMessage(response, "The clone could not be started."),
          });
          return null;
        }

        for await (const event of readNdjson<CloneEvent>(response)) {
          if (event.type === "status") {
            progress = { ...progress, message: event.message };
          } else if (event.type === "progress") {
            progress = {
              message: "Downloading files",
              done: event.done,
              total: event.total,
              bytes: event.bytes,
            };
          } else if (event.type === "done") {
            setJob({ status: "idle" });
            return event.project;
          } else if (event.type === "error") {
            setJob({ status: "error", message: event.message });
            return null;
          } else {
            continue;
          }
          setJob({ status: "running", url, progress });
        }

        setJob({ status: "error", message: "The connection closed before the clone finished." });
        return null;
      } catch {
        setJob(
          abort.signal.aborted
            ? { status: "idle" }
            : { status: "error", message: "Couldn't reach the app. Is it still running?" },
        );
        return null;
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismissError = useCallback(() => {
    setJob((current) => (current.status === "error" ? { status: "idle" } : current));
  }, []);

  return { job, start, cancel, dismissError };
}
