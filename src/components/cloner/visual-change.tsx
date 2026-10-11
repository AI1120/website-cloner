"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Scene3D } from "@/components/cloner/scene-3d";
import { Segmented } from "@/components/cloner/segmented";
import { SHOT_VIEWS, ShotViews, type ShotView } from "@/components/cloner/shot-views";
import { errorMessage, readNdjson } from "@/lib/ndjson";

interface ChangePictures {
  page: string;
  before: string | null;
  after: string;
  diff: string | null;
  changed: number;
}

type State =
  | { status: "running"; message: string }
  | { status: "done"; result: ChangePictures }
  | { status: "error"; message: string };

type Event =
  | { type: "status"; message: string }
  | { type: "done"; result: ChangePictures }
  | { type: "error"; message: string };

/**
 * The page before and after one change, photographed in the browser. Mount it
 * with a `key` per change and page; it starts straight away.
 */
export function VisualChange({ projectId, checkpointId, page }: { projectId: string; checkpointId: string; page: string }) {
  const [state, setState] = useState<State>({ status: "running", message: "Starting" });
  const [view, setView] = useState<ShotView>("slider");

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/changes/${checkpointId}/visual`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ page }),
          signal: abort.signal,
        });
        if (!response.ok) {
          setState({ status: "error", message: await errorMessage(response, "The change couldn't be pictured.") });
          return;
        }
        for await (const event of readNdjson<Event>(response)) {
          if (event.type === "status") setState({ status: "running", message: event.message });
          else if (event.type === "done") {
            setState({ status: "done", result: event.result });
            return;
          } else {
            setState({ status: "error", message: event.message });
            return;
          }
        }
        setState({ status: "error", message: "The connection closed before the pictures were ready." });
      } catch {
        if (!abort.signal.aborted) setState({ status: "error", message: "Couldn't reach the app. Is it still running?" });
      }
    })();
    return () => abort.abort();
  }, [projectId, checkpointId, page]);

  if (state.status === "running") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center" aria-live="polite">
        <Scene3D
          preset="compare"
          className="h-[min(36vh,280px)] w-full max-w-2xl"
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoaderCircle className="size-6 animate-spin text-brand" />
            </div>
          }
        />
        <p className="font-medium">{state.message}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The page is rebuilt as it was before this change and photographed next to how it looks after.
        </p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
        <p role="alert" className="max-w-md text-sm">
          {state.message}
        </p>
      </div>
    );
  }

  const { result } = state;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <p className="min-w-0 flex-1 text-sm">
          {result.before === null ? (
            <>This change created <span className="font-mono text-xs">{result.page}</span>.</>
          ) : result.changed < 0.5 ? (
            <>This page looks the same before and after; the change is elsewhere or not visible here.</>
          ) : (
            <>
              <span className="font-semibold tabular-nums">{Math.round(result.changed)}%</span> of{" "}
              <span className="font-mono text-xs">{result.page}</span> looks different.
            </>
          )}
        </p>
        {result.before && <Segmented label="Show" value={view} options={SHOT_VIEWS} onChange={setView} collapseLabels />}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        {result.before ? (
          <ShotViews
            view={view}
            left={{ label: "Before", src: result.before }}
            right={{ label: "After", src: result.after }}
            diff={result.diff}
            diffNote="Red marks what this change made look different."
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view
          <img src={result.after} alt="The new page" className="mx-auto block w-full max-w-4xl rounded-lg border shadow-sm" />
        )}
      </div>
    </div>
  );
}
