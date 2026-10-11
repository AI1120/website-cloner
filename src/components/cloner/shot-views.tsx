"use client";

import { Columns2, ScanEye, SplitSquareHorizontal } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type ShotView = "side" | "slider" | "diff";

export const SHOT_VIEWS = [
  { value: "side" as const, label: "Side by side", icon: Columns2 },
  { value: "slider" as const, label: "Slider", icon: SplitSquareHorizontal },
  { value: "diff" as const, label: "Differences", icon: ScanEye },
];

interface Picture {
  label: string;
  src: string;
}

interface ShotViewsProps {
  view: ShotView;
  left: Picture;
  right: Picture;
  /** The right picture with differences marked, for the "Differences" view. */
  diff: string | null;
  /** What the red marks mean, shown above the differences picture. */
  diffNote: string;
  /** Narrow (phone) pictures are shown at a phone-like width. */
  narrow?: boolean;
}

/** Two screenshots of a page shown side by side, under a slider, or with their differences marked. */
export function ShotViews({ view, left, right, diff, diffNote, narrow = false }: ShotViewsProps) {
  const [split, setSplit] = useState(50);
  const width = narrow ? "max-w-sm" : "max-w-4xl";

  if (view === "side") {
    return (
      <div className={cn("mx-auto grid grid-cols-2 gap-4", narrow ? "max-w-3xl" : "max-w-none")}>
        <Shot {...left} />
        <Shot {...right} />
      </div>
    );
  }
  if (view === "slider") {
    return (
      <div className={cn("mx-auto", width)}>
        <label className="sticky top-0 z-10 mb-3 flex items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <span className="shrink-0 font-medium text-foreground">{left.label}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(event) => setSplit(Number(event.target.value))}
            className="min-w-0 flex-1 accent-(--brand)"
            aria-label={`How much of "${left.label}" to show`}
          />
          <span className="shrink-0 font-medium text-foreground">{right.label}</span>
        </label>
        <div className="relative overflow-hidden rounded-lg border bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
          <img src={right.src} alt={right.label} className="block w-full" />
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view */}
          <img
            src={left.src}
            alt={left.label}
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
    );
  }
  return (
    <div className={cn("mx-auto", width)}>
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block size-3 shrink-0 rounded-sm bg-[rgb(225_29_72/0.7)]" aria-hidden="true" />
        {diffNote}
      </p>
      {diff ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL made for this view
        <img src={diff} alt={`${right.label} with the differences marked`} className="block w-full rounded-lg border shadow-sm" />
      ) : (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">There is nothing to compare.</p>
      )}
    </div>
  );
}

function Shot({ label, src }: Picture) {
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
