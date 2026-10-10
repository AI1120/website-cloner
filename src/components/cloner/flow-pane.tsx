"use client";

import { LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProjectThumbnail } from "@/components/cloner/project-thumbnail";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import type { Flow, FlowScreen, Project } from "@/types/project";

const CARD_WIDTH = 264;
const CARD_HEIGHT = 213;
const GAP_X = 104;
const GAP_Y = 40;
const PADDING = 40;
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.2];
/** Space left between an arrowhead and the card it points at. */
const ARROW_GAP = 8;

interface Placed {
  screen: FlowScreen;
  x: number;
  y: number;
}

/** Arranges screens in columns by how many links they are from the first one. */
function layout(flow: Flow): { placed: Placed[]; width: number; height: number } {
  const level = new Map<string, number>();
  const first = flow.screens[0]?.path;
  if (first) {
    level.set(first, 0);
    let frontier = [first];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const from of frontier) {
        for (const link of flow.links) {
          if (link.from === from && !level.has(link.to)) {
            level.set(link.to, (level.get(from) ?? 0) + 1);
            next.push(link.to);
          }
        }
      }
      frontier = next;
    }
  }
  // Screens nothing links to sit in a last column of their own.
  const deepest = Math.max(0, ...level.values());
  const columns = new Map<number, FlowScreen[]>();
  for (const screen of flow.screens) {
    const column = level.get(screen.path) ?? deepest + 1;
    columns.set(column, [...(columns.get(column) ?? []), screen]);
  }

  const tallest = Math.max(1, ...[...columns.values()].map((screens) => screens.length));
  const fullHeight = tallest * CARD_HEIGHT + (tallest - 1) * GAP_Y;
  const placed: Placed[] = [];
  const order = [...columns.keys()].sort((a, b) => a - b);
  order.forEach((column, columnIndex) => {
    const screens = columns.get(column) ?? [];
    const columnHeight = screens.length * CARD_HEIGHT + (screens.length - 1) * GAP_Y;
    const top = PADDING + (fullHeight - columnHeight) / 2;
    screens.forEach((screen, row) => {
      placed.push({
        screen,
        x: PADDING + columnIndex * (CARD_WIDTH + GAP_X),
        y: top + row * (CARD_HEIGHT + GAP_Y),
      });
    });
  });

  return {
    placed,
    width: PADDING * 2 + order.length * CARD_WIDTH + Math.max(0, order.length - 1) * GAP_X,
    height: PADDING * 2 + fullHeight,
  };
}

interface Connection {
  key: string;
  path: string;
  /** True when the screens link to each other in both directions. */
  both: boolean;
}

/** One line per pair of screens, so links in both directions don't overlap. */
function connections(flow: Flow, byPath: Map<string, Placed>): Connection[] {
  const pairs = new Map<string, { a: Placed; b: Placed; forward: boolean; backward: boolean }>();
  for (const link of flow.links) {
    const from = byPath.get(link.from);
    const to = byPath.get(link.to);
    if (!from || !to) continue;
    // "a" is the card further left, or higher up within a column.
    const ordered = from.x < to.x || (from.x === to.x && from.y < to.y);
    const a = ordered ? from : to;
    const b = ordered ? to : from;
    const key = `${a.screen.path}|${b.screen.path}`;
    const pair = pairs.get(key) ?? { a, b, forward: false, backward: false };
    if (ordered) pair.forward = true;
    else pair.backward = true;
    pairs.set(key, pair);
  }

  return [...pairs.entries()].map(([key, { a, b, forward, backward }]) => {
    const both = forward && backward;
    // The arrow is drawn towards the path's end, so a one-way link back is drawn reversed.
    const reversed = !forward;
    let points: [number, number, number, number, number, number, number, number];
    if (a.x !== b.x) {
      const startX = a.x + CARD_WIDTH + (both || reversed ? ARROW_GAP : 0);
      const endX = b.x - ARROW_GAP;
      const startY = a.y + CARD_HEIGHT / 2;
      const endY = b.y + CARD_HEIGHT / 2;
      const bend = (endX - startX) / 2;
      points = [startX, startY, startX + bend, startY, endX - bend, endY, endX, endY];
    } else if (b.y - a.y <= CARD_HEIGHT + GAP_Y) {
      // Neighbours in a column: a short vertical line between them.
      const x = a.x + CARD_WIDTH / 2;
      const startY = a.y + CARD_HEIGHT + (both || reversed ? ARROW_GAP : 0);
      const endY = b.y - ARROW_GAP;
      points = [x, startY, x, startY, x, endY, x, endY];
    } else {
      // Further apart in a column: arc around the cards in between.
      const x = a.x + CARD_WIDTH + ARROW_GAP;
      const startY = a.y + CARD_HEIGHT / 2;
      const endY = b.y + CARD_HEIGHT / 2;
      points = [x, startY, x + 64, startY, x + 64, endY, x, endY];
    }
    const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = points;
    const path = reversed
      ? `M ${x2} ${y2} C ${c2x} ${c2y}, ${c1x} ${c1y}, ${x1} ${y1}`
      : `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
    return { key, path, both };
  });
}

type State = { status: "loading" } | { status: "error" } | { status: "ready"; flow: Flow };

interface FlowPaneProps {
  project: Project;
  /** Changes whenever the project's files change. */
  version: number;
  onOpen: (path: string) => void;
}

/** A map of the project's screens and how they lead to one another. */
export function FlowPane({ project, version, onOpen }: FlowPaneProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [zoomIndex, setZoomIndex] = useState(2);
  const zoom = ZOOM_STEPS[zoomIndex];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${project.id}/flow`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const flow = (await response.json()) as Flow;
        if (!cancelled) setState({ status: "ready", flow });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, version]);

  const flow = state.status === "ready" ? state.flow : null;
  const arranged = useMemo(() => (flow ? layout(flow) : null), [flow]);
  const lines = useMemo(() => {
    if (!flow || !arranged) return [];
    return connections(flow, new Map(arranged.placed.map((item) => [item.screen.path, item])));
  }, [arranged, flow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {flow
            ? `${plural(flow.screens.length, "screen")} · ${plural(flow.links.length, "link")} between them`
            : "Screens and how they connect"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoomIndex === 0}
          onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
        >
          <Minus />
        </Button>
        <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
        >
          <Plus />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted bg-[radial-gradient(circle,color-mix(in_oklch,var(--foreground)_12%,transparent)_1px,transparent_1px)] bg-[length:20px_20px]">
        {state.status === "loading" && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-label="Loading the flow" />
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" className="p-6 text-sm text-destructive">
            The flow could not be loaded.
          </p>
        )}
        {arranged && flow && (
          // The canvas is sized and scaled from the computed layout and the zoom level.
          <div style={{ width: arranged.width * zoom, height: arranged.height * zoom }}>
            <div
              className="relative origin-top-left"
              style={{ width: arranged.width, height: arranged.height, transform: `scale(${zoom})` }}
            >
              <svg
                aria-hidden="true"
                width={arranged.width}
                height={arranged.height}
                className="pointer-events-none absolute inset-0 text-foreground/45"
              >
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {lines.map((line) => (
                  <path
                    key={line.key}
                    d={line.path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    markerStart={line.both ? "url(#flow-arrow)" : undefined}
                    markerEnd="url(#flow-arrow)"
                  />
                ))}
              </svg>

              <ul>
                {arranged.placed.map(({ screen, x, y }) => (
                  <li
                    key={screen.path}
                    className="absolute"
                    // Position comes from the computed layout.
                    style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(screen.path)}
                      title={`Open ${screen.title} in the preview`}
                      className="block size-full overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-shadow outline-none hover:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ProjectThumbnail
                        src={`/preview/${project.id}/${screen.path}`}
                        title={`Preview of ${screen.title}`}
                      />
                      <span className="block border-t px-3 py-2">
                        <span className="block truncate text-sm font-medium">{screen.title}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {screen.path.replace(/^index\.html#/, "") || "/"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
