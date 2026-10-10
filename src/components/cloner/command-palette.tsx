"use client";

import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useHydrated } from "@/hooks/use-client";
import { cn } from "@/lib/utils";

/** Raised on `window` to open the palette, e.g. by Ctrl+K inside the preview frame. */
export const OPEN_PALETTE_EVENT = "sitecloner:command-palette";

export interface Command {
  id: string;
  group: string;
  label: string;
  icon?: LucideIcon;
  /** Extra words the search should match. */
  keywords?: string;
  /** A short hint shown on the right, e.g. a shortcut or a host name. */
  hint?: string;
  run: () => void;
}

function matches(command: Command, words: string[]): boolean {
  const haystack = `${command.label} ${command.group} ${command.keywords ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Opens on Ctrl+K or ⌘K anywhere on the page, and on OPEN_PALETTE_EVENT. */
export function usePaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [onOpen]);
}

function useShortcutLabel(): string {
  const hydrated = useHydrated();
  if (!hydrated) return "Ctrl K";
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
}

/** The button that opens the palette, showing its shortcut. */
export function PaletteButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const shortcut = useShortcutLabel();
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-label={`Search and commands (${shortcut})`}
      title={`Search and commands (${shortcut})`}
      className={cn("gap-2 text-muted-foreground", className)}
    >
      <Search data-icon="inline-start" />
      <span className="hidden xl:inline">Search</span>
      <kbd className="hidden rounded border bg-muted px-1 font-sans text-[10px] font-medium sm:inline">
        {shortcut}
      </kbd>
    </Button>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
}

export function CommandPalette({ open, onOpenChange, commands, placeholder }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 0 ? commands : commands.filter((command) => matches(command, words));
  }, [commands, query]);
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
    setActiveIndex(0);
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : results.length - 1);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      run(results[active]);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        showClose={false}
        className="top-[12vh] max-h-[min(70dvh,520px)] max-w-xl translate-y-0 gap-0 p-0"
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search for a command or project"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? "Search for a command or project…"}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">Esc</kbd>
        </div>

        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label="Commands"
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
          ) : (
            results.map((command, index) => {
              const Icon = command.icon;
              const heading = command.group !== results[index - 1]?.group ? command.group : null;
              return (
                <div key={command.id}>
                  {heading && (
                    <p
                      role="presentation"
                      className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {heading}
                    </p>
                  )}
                  <div
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onPointerMove={() => {
                      if (index !== active) setActiveIndex(index);
                    }}
                    onClick={() => run(command)}
                    className={cn(
                      "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm select-none",
                      index === active && "bg-muted",
                    )}
                  >
                    {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && (
                      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                        {command.hint}
                      </span>
                    )}
                    {index === active && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
