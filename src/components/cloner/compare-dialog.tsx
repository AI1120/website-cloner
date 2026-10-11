"use client";

import { CircleAlert, ExternalLink, LoaderCircle, Monitor, RotateCw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { Scene3D } from "@/components/cloner/scene-3d";
import { Segmented } from "@/components/cloner/segmented";
import { SHOT_VIEWS, ShotViews, type ShotView } from "@/components/cloner/shot-views";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, readNdjson } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { CompareDevice, CompareEvent, PageComparison, ProjectPage } from "@/types/project";

type State =
  | { status: "running"; message: string }
  | { status: "done"; result: PageComparison }
  | { status: "error"; message: string };

const DEVICES = [
  { value: "desktop" as const, label: "Desktop", icon: Monitor },
  { value: "phone" as const, label: "Phone", icon: Smartphone },
];

const WIDTH: Record<CompareDevice, number> = { desktop: 1440, phone: 390 };

function verdict(score: number): { label: string; tone: string } {
  if (score >= 95) return { label: "Nearly identical", tone: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 80) return { label: "Close match", tone: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 60) return { label: "Some differences", tone: "text-amber-600 dark:text-amber-400" };
  return { label: "Large differences", tone: "text-destructive" };
}

const number = new Intl.NumberFormat("en-US");

interface CompareDialogProps {
  projectId: string;
  page: ProjectPage;
  onClose: () => void;
}

/**
 * "Compare with the original": the live page and the copy, screenshotted in the
 * same browser, with a match score. Mounted only while open; it starts comparing
 * straight away.
 */
export function CompareDialog({ projectId, page, onClose }: CompareDialogProps) {
  const [device, setDevice] = useState<CompareDevice>("desktop");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "running", message: "Starting" });
  const [view, setView] = useState<ShotView>("side");

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/compare`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ page: page.path, device }),
          signal: abort.signal,
        });
        if (!response.ok) {
          setState({ status: "error", message: await errorMessage(response, "The comparison could not start.") });
          return;
        }
        for await (const event of readNdjson<CompareEvent>(response)) {
          if (event.type === "status") {
            setState({ status: "running", message: event.message });
          } else if (event.type === "done") {
            setState({ status: "done", result: event.result });
            return;
          } else {
            setState({ status: "error", message: event.message });
            return;
          }
        }
        setState({ status: "error", message: "The connection closed before the comparison finished." });
      } catch {
        if (!abort.signal.aborted) {
          setState({ status: "error", message: "Couldn't reach the app. Is it still running?" });
        }
      }
    })();
    return () => abort.abort();
  }, [projectId, page.path, device, attempt]);

  const restart = (next: CompareDevice = device) => {
    setState({ status: "running", message: "Starting" });
    setDevice(next);
    setAttempt((count) => count + 1);
  };

  const result = state.status === "done" ? state.result : null;
  const running = state.status === "running";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[min(90dvh,960px)] max-w-6xl gap-0 p-0">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b px-5 py-4 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold">Compare with the original</DialogTitle>
            <DialogDescription className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
              <span className="truncate">{page.title || page.path}</span>
              <span aria-hidden="true">·</span>
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
              >
                <span className="truncate">{page.url.replace(/^https?:\/\//, "")}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Screen size"
              value={device}
              options={DEVICES}
              onChange={(next) => restart(next)}
              collapseLabels
            />
            {result && <Segmented label="Show" value={view} options={SHOT_VIEWS} onChange={setView} collapseLabels />}
            <Button variant="outline" size="sm" disabled={running} onClick={() => restart()}>
              <RotateCw data-icon="inline-start" />
              Run again
            </Button>
          </div>
        </div>

        {state.status === "running" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center" aria-live="polite">
            <Scene3D
              preset="compare"
              className="h-[min(40vh,320px)] w-full max-w-3xl"
              fallback={
                <div className="flex h-full items-center justify-center">
                  <LoaderCircle className="size-6 animate-spin text-brand" />
                </div>
              }
            />
            <p className="font-medium">{state.message}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Both pages are opened in a browser at {number.format(WIDTH[device])} pixels wide and
              screenshotted. This usually takes 10 to 30 seconds.
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
            <p role="alert" className="max-w-md text-sm">
              {state.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => restart()}>
              Try again
            </Button>
          </div>
        )}

        {result && (
          <>
            <ScoreBar result={result} />
            <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
              <ShotViews
                view={view}
                left={{ label: "Original", src: result.original }}
                right={{ label: "Your copy", src: result.copy }}
                diff={result.diff}
                diffNote="Red marks the parts of your copy that look different from the original, or that are missing from it."
                narrow={result.device === "phone"}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScoreBar({ result }: { result: PageComparison }) {
  const { label, tone } = verdict(result.score);
  const heightsDiffer = Math.abs(result.originalHeight - result.copyHeight) > Math.max(40, result.originalHeight * 0.02);
  const limit = result.device === "phone" ? 6000 : 4000;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-5 py-3">
      <div className="flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tracking-tight tabular-nums", tone)}>
          {Math.round(result.score)}%
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        How much of your copy looks the same as the live page, at {number.format(WIDTH[result.device])}{" "}
        pixels wide.
        {heightsDiffer &&
          ` The original is ${number.format(result.originalHeight)} px tall and your copy ${number.format(result.copyHeight)} px.`}
        {result.truncated && ` Long pages are compared down to ${number.format(limit)} px.`} The live site
        may also have changed since you copied it.
      </p>
    </div>
  );
}
