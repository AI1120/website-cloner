"use client";

import { Check, FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DESIGN_PRESETS, MAX_DESIGN_SYSTEM_CHARS } from "@/lib/projects/design-systems";
import { cn } from "@/lib/utils";

export type DesignChoice =
  | { kind: "none" }
  | { kind: "preset"; id: string; name: string }
  | { kind: "custom"; name: string; content: string };

interface DesignSystemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DesignChoice;
  onChange: (value: DesignChoice) => void;
}

function choiceKey(choice: DesignChoice): string {
  return choice.kind === "preset" ? `preset:${choice.id}` : choice.kind;
}

export function DesignSystemDialog({ open, onOpenChange, value, onChange }: DesignSystemDialogProps) {
  const [draft, setDraft] = useState<DesignChoice>(value);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setError(null);
    }
    onOpenChange(next);
  };

  const readFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_DESIGN_SYSTEM_CHARS * 4) {
      setError("That file is too large for a design system.");
      return;
    }
    const content = (await file.text()).trim();
    if (!content) {
      setError("That file is empty.");
    } else if (content.length > MAX_DESIGN_SYSTEM_CHARS) {
      setError("That file is too long for a design system.");
    } else {
      setDraft({ kind: "custom", name: file.name.replace(/\.[a-z0-9]+$/i, "") || "Design system", content });
    }
  };

  const selected = choiceKey(draft);
  const optionClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
      active ? "border-foreground bg-muted/60" : "hover:bg-muted/50",
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a design system</DialogTitle>
          <DialogDescription>
            The AI follows it for colors, type, spacing and components.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Your design system</h3>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={optionClass(draft.kind === "custom")}
              onClick={() => fileRef.current?.click()}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileUp className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {draft.kind === "custom" ? draft.name : "Upload DESIGN.md"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {draft.kind === "custom"
                    ? "Uploaded. Choose again to replace it."
                    : "A Markdown file describing your colors, type and components."}
                </span>
              </span>
              {draft.kind === "custom" && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Ready-made</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {DESIGN_PRESETS.map((preset) => {
                const active = selected === `preset:${preset.id}`;
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      className={cn(optionClass(active), "h-full items-start")}
                      onClick={() => setDraft({ kind: "preset", id: preset.id, name: preset.name })}
                    >
                      <span
                        className="mt-0.5 grid size-9 shrink-0 grid-cols-2 overflow-hidden rounded-md ring-1 ring-foreground/10"
                        aria-hidden="true"
                      >
                        {preset.swatches.map((color, index) => (
                          // Swatch colors are data of the preset.
                          <span key={index} style={{ backgroundColor: color }} />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{preset.name}</span>
                        <span className="block text-xs text-muted-foreground">{preset.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <button
              type="button"
              aria-pressed={draft.kind === "none"}
              className={optionClass(draft.kind === "none")}
              onClick={() => setDraft({ kind: "none" })}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">None</span>
                <span className="block text-xs text-muted-foreground">
                  Let the AI choose a look that suits the request.
                </span>
              </span>
              {draft.kind === "none" && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </button>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onChange(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
