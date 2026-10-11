"use client";

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, LoaderCircle, Paintbrush, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Segmented } from "@/components/cloner/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InspectedElement } from "@/types/project";

type Changes = Record<string, string>;

const WEIGHTS = [
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Extra bold"],
  ["900", "Black"],
] as const;

const ALIGNS = [
  { value: "left", label: "Left", icon: AlignLeft, iconOnly: true },
  { value: "center", label: "Center", icon: AlignCenter, iconOnly: true },
  { value: "right", label: "Right", icon: AlignRight, iconOnly: true },
  { value: "justify", label: "Justify", icon: AlignJustify, iconOnly: true },
];

/** "rgb(10, 20, 30)" or "rgba(…, 0)" as "#0a141e", or null when transparent. */
function toHex(color: string): string | null {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(color);
  if (!match) return /^#[0-9a-f]{3,8}$/i.test(color) ? color.slice(0, 7) : null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number(match[4]);
  if (alpha === 0) return null;
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

/** "16px" as 16; "normal" and other words as null. */
function px(value: string | undefined): number | null {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

interface InspectorPanelProps {
  inspected: InspectedElement;
  framework: "react" | "html";
  saving: boolean;
  onPreview: (changes: Changes) => void;
  onSave: (changes: Changes) => void;
  onClose: () => void;
}

/**
 * The visual inspector: an element's colours, type, spacing and corners,
 * changed directly. Changes show in the preview straight away and are written
 * into the project's files only on Save, as one change that can be undone.
 */
export function InspectorPanel({ inspected, framework, saving, onPreview, onSave, onClose }: InspectorPanelProps) {
  const [changes, setChanges] = useState<Changes>({});
  const value = (property: string) => changes[property] ?? inspected.computed[property] ?? "";
  const set = (property: string, next: string) => setChanges((current) => ({ ...current, [property]: next }));
  const count = Object.keys(changes).length;

  useEffect(() => {
    onPreview(changes);
  }, [changes, onPreview]);

  const file = inspected.ownLoc?.replace(/:\d+:\d+$/, "") ?? null;
  const shared = file !== null && /components\/ui\//.test(file);
  const unsupported = framework === "react" && inspected.ownLoc === null;
  const { element } = inspected;
  const label = `${element.tag}${element.id ? `#${element.id}` : ""}${element.classes.length > 0 ? `.${element.classes.slice(0, 2).join(".")}` : ""}`;

  return (
    <aside
      aria-label="Style inspector"
      className="flex w-72 shrink-0 flex-col border-l bg-background text-sm"
    >
      <div className="flex items-start gap-2 border-b px-3 py-2.5">
        <Paintbrush className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Style</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={label}>
            {label}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close the inspector" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {unsupported ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed">
            This element isn&apos;t written in the project&apos;s own code (it may come from a library), so it
            can&apos;t be styled here. Pick another element, or ask the AI.
          </p>
        ) : (
          (inspected.sameCount > 1 || shared) && (
            <p className="rounded-lg border border-brand/25 bg-brand/5 p-2.5 text-xs leading-relaxed text-muted-foreground">
              {shared
                ? `This comes from ${file}, so saving changes every element made by that component.`
                : `${inspected.sameCount} elements on this page come from the same code; saving changes them all.`}
            </p>
          )
        )}

        <Section title="Text">
          <ColorRow label="Colour" value={value("color")} onChange={(next) => set("color", next)} />
          <NumberRow label="Size" unit="px" min={6} max={160} value={px(value("font-size"))} onChange={(next) => set("font-size", `${next}px`)} slider />
          <Row label="Weight">
            <select
              value={String(Math.round(Number(value("font-weight")) / 100) * 100)}
              onChange={(event) => set("font-weight", event.target.value)}
              className="h-7 w-full rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {WEIGHTS.map(([weight, name]) => (
                <option key={weight} value={weight}>
                  {weight} · {name}
                </option>
              ))}
            </select>
          </Row>
          <NumberRow label="Line height" unit="px" min={0} max={200} value={px(value("line-height"))} placeholder="normal" onChange={(next) => set("line-height", `${next}px`)} />
          <NumberRow label="Spacing" unit="px" min={-10} max={40} step={0.1} value={px(value("letter-spacing"))} placeholder="normal" onChange={(next) => set("letter-spacing", `${next}px`)} />
          <Row label="Align">
            <Segmented
              label="Text alignment"
              value={["left", "center", "right", "justify"].includes(value("text-align")) ? value("text-align") : "left"}
              options={ALIGNS}
              onChange={(next) => set("text-align", next)}
            />
          </Row>
        </Section>

        <Section title="Fill">
          <ColorRow label="Background" value={value("background-color")} onChange={(next) => set("background-color", next)} allowClear />
        </Section>

        <Section title="Spacing">
          <BoxModel value={value} onChange={set} />
        </Section>

        <Section title="Shape">
          <NumberRow label="Corners" unit="px" min={0} max={80} value={px(value("border-radius"))} onChange={(next) => set("border-radius", `${next}px`)} slider />
          <NumberRow
            label="Opacity"
            unit="%"
            min={0}
            max={100}
            value={Math.round(Number(value("opacity") || "1") * 100)}
            onChange={(next) => set("opacity", String(Math.min(100, Math.max(0, next)) / 100))}
            slider
          />
        </Section>
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {count === 0 ? "Click another element to switch" : `${count} unsaved ${count === 1 ? "change" : "changes"}`}
        </span>
        <Button variant="ghost" size="sm" disabled={count === 0 || saving} onClick={() => setChanges({})}>
          Reset
        </Button>
        <Button size="sm" disabled={count === 0 || saving || unsupported} onClick={() => onSave(changes)}>
          {saving && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
          Save
        </Button>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const FIELD =
  "h-7 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ColorRow({
  label,
  value,
  onChange,
  allowClear = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
}) {
  const hex = toHex(value);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        <label
          className={cn(
            "relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border",
            !hex && "bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px]",
          )}
          style={hex ? { backgroundColor: hex } : undefined}
        >
          <span className="sr-only">Pick {label.toLowerCase()}</span>
          <input
            type="color"
            value={hex ?? "#ffffff"}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <input
          aria-label={`${label} as hex`}
          value={draft ?? hex ?? "none"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null && /^#[0-9a-f]{6}$/i.test(draft.trim())) onChange(draft.trim());
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={cn(FIELD, "font-mono")}
        />
        {allowClear && hex && (
          <Button variant="ghost" size="icon-xs" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange("transparent")}>
            <X />
          </Button>
        )}
      </div>
    </Row>
  );
}

function NumberRow({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  slider = false,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  placeholder?: string;
  slider?: boolean;
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        {slider && (
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value ?? min}
            onChange={(event) => onChange(Number(event.target.value))}
            className="min-w-0 flex-1 accent-(--brand)"
          />
        )}
        <div className={cn("relative", slider ? "w-[4.5rem] shrink-0" : "w-full")}>
          <input
            type="number"
            aria-label={`${label} in ${unit}`}
            min={min}
            max={max}
            step={step}
            value={value ?? ""}
            placeholder={placeholder}
            onChange={(event) => {
              if (event.target.value !== "") onChange(Number(event.target.value));
            }}
            className={cn(FIELD, "pr-6")}
          />
          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </div>
    </Row>
  );
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Margin around padding around the element, each side editable, like a browser's box model. */
function BoxModel({ value, onChange }: { value: (property: string) => string; onChange: (property: string, value: string) => void }) {
  const cell = (property: string, className: string) => (
    <input
      type="number"
      aria-label={property.replace("-", " ")}
      value={px(value(property)) ?? 0}
      onChange={(event) => {
        if (event.target.value !== "") onChange(property, `${event.target.value}px`);
      }}
      className={cn(
        "h-6 w-10 rounded bg-transparent text-center text-[11px] tabular-nums outline-none hover:bg-background/80 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    />
  );
  const ring = (kind: "margin" | "padding", inner: ReactNode) => (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] items-center justify-items-center rounded-md border border-dashed p-0.5",
        kind === "margin" ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5",
      )}
    >
      <span className="col-start-1 row-start-1 self-start justify-self-start pl-1 text-[9px] text-muted-foreground uppercase">{kind}</span>
      <div className="col-start-2 row-start-1">{cell(`${kind}-${SIDES[0]}`, "")}</div>
      <div className="col-start-3 row-start-2">{cell(`${kind}-${SIDES[1]}`, "")}</div>
      <div className="col-start-2 row-start-3">{cell(`${kind}-${SIDES[2]}`, "")}</div>
      <div className="col-start-1 row-start-2">{cell(`${kind}-${SIDES[3]}`, "")}</div>
      <div className="col-start-2 row-start-2 w-full">{inner}</div>
    </div>
  );
  return ring(
    "margin",
    ring("padding", <div className="mx-auto h-6 w-full rounded border bg-muted/60" aria-hidden="true" />),
  );
}
