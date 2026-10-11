import { Check, LoaderCircle } from "lucide-react";

import { Scene3D } from "@/components/cloner/scene-3d";
import { Progress } from "@/components/ui/progress";
import type { CloneProgress as Progressing } from "@/hooks/use-clone-job";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CloneStage } from "@/types/project";

const STAGES: CloneStage[] = ["open", "pages", "assets", "save"];

function stageLabel(stage: CloneStage, viaBrowser: boolean): string {
  switch (stage) {
    case "open":
      return viaBrowser ? "Open in a browser" : "Open the site";
    case "pages":
      return "Read pages";
    case "assets":
      return "Download files";
    case "save":
      return "Save the copy";
  }
}

/** Where a running clone has got to: four steps, the current message, and file counts. */
export function CloneProgress({ progress }: { progress: Progressing }) {
  const current = STAGES.indexOf(progress.stage);
  const percent =
    progress.stage === "assets" && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : progress.stage === "save"
        ? 100
        : null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card px-4 pb-3.5 text-left shadow-xs">
      <Scene3D
        preset="compare"
        className="-mx-4 mb-3 h-36 border-b bg-[radial-gradient(60%_80%_at_50%_50%,color-mix(in_oklch,var(--brand)_10%,transparent),transparent)]"
      />
      <ol className="flex items-center gap-1.5" aria-label="Clone steps">
        {STAGES.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={stage} className="flex min-w-0 flex-1 items-center gap-1.5 last:flex-none">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums transition-colors",
                  done && "border-brand bg-brand text-brand-foreground",
                  active && "border-brand text-brand",
                  !done && !active && "text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3.5" aria-label="Done" />
                ) : active ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-label="In progress" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:inline",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {stageLabel(stage, progress.viaBrowser)}
              </span>
              {index < STAGES.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn("h-px min-w-3 flex-1 transition-colors", done ? "bg-brand" : "bg-border")}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{progress.message}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {progress.total > 0
            ? `${progress.done} of ${progress.total} files · ${formatBytes(progress.bytes)}`
            : progress.viaBrowser && current <= 1
              ? "Waiting for the page's scripts"
              : ""}
        </span>
      </div>
      <Progress
        value={percent}
        className={cn("mt-2.5 **:data-[slot=progress-indicator]:bg-brand", percent === null && "opacity-60")}
        aria-label="Clone progress"
      />
    </div>
  );
}
