"use client";

import { CircleAlert, Columns2, ExternalLink, LoaderCircle, Monitor, RotateCw, ScanEye, Smartphone, SplitSquareHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { Scene3D } from "@/components/cloner/scene-3d";
import { Segmented } from "@/components/cloner/segmented";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, readNdjson } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { CompareDevice, CompareEvent, PageComparison, ProjectPage } from "@/types/project";

type View = "side" | "slider" | "diff";

type State =
  | { status: "running"; message: string }
  | { status: "done"; result: PageComparison }
  | { status: "error"; message: string };

const DEVICES = [
  { value: "desktop" as const, label: "Desktop", icon: Monitor },
  { value: "phone" as const, label: "Phone", icon: Smartphone },
];

const VIEWS = [
  { value: "side" as const, label: "Side by side", icon: Columns2 },
  { value: "slider" as const, label: "Slider", icon: SplitSquareHorizontal },
  { value: "diff" as const, label: "Differences", icon: ScanEye },
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
  const [view, setView] = useState<View>("side");
  const [split, setSplit] = useState(50);

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
            {result && <Segmented label="Show" value={view} options={VIEWS} onChange={setView} collapseLabels />}
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
              {view === "side" && (
                <div className={cn("mx-auto grid grid-cols-2 gap-4", result.device === "phone" ? "max-w-3xl" : "max-w-none")}>
                  <Shot label="Original" src={result.original} />
                  <Shot label="Your copy" src={result.copy} />
                </div>
              )}
              {view === "slider" && (
                <div className={cn("mx-auto", result.device === "phone" ? "max-w-sm" : "max-w-4xl")}>
                  <label className="sticky top-0 z-10 mb-3 flex items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
                    <span className="shrink-0 font-medium text-foreground">Original</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={split}
                      onChange={(event) => setSplit(Number(event.target.value))}
                      className="min-w-0 flex-1 accent-(--brand)"
                      aria-label="How much of the original to show"
                    />
                    <span className="shrink-0 font-medium text-foreground">Your copy</span>
                  </label>
                  <div className="relative overflow-hidden rounded-lg border bg-white shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
                    <img src={result.copy} alt="Your copy" className="block w-full" />
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
                    <img
                      src={result.original}
                      alt="The original"
                      className="absolute top-0 left-0 block w-full"
                      // The visible share follows the slider.
                      style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 w-0.5 bg-brand shadow-[0_0_0_1px_rgb(255_255_255/0.7)]"
                      style={{ left: `${split}%` }}
                    />
                  </div>
                </div>
              )}
              {view === "diff" && (
                <div className={cn("mx-auto", result.device === "phone" ? "max-w-sm" : "max-w-4xl")}>
                  <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block size-3 rounded-sm bg-[rgb(225_29_72/0.7)]" aria-hidden="true" />
                    Red marks the parts of your copy that look different from the original, or that
                    are missing from it.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
                  <img
                    src={result.diff}
                    alt="Your copy with the differences marked"
                    className="block w-full rounded-lg border shadow-sm"
                  />
                </div>
              )}
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

function Shot({ label, src }: { label: string; src: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="sticky top-0 z-10 mb-2 text-xs font-medium text-muted-foreground">
        <span className="rounded-md bg-background/95 px-2 py-1 shadow-xs backdrop-blur">{label}</span>
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
      <img src={src} alt={label} className="block w-full rounded-lg border bg-white shadow-sm" />
    </figure>
  );
}
