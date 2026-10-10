"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { plural } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";

interface DiscoveredPage {
  url: string;
  label: string;
}

/** Most pages one clone can include besides the entered one. */
const MAX_CHOSEN = 24;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; title: string; pages: DiscoveredPage[] };

interface PageChooserDialogProps {
  /** The site to look at. The dialog is open while this is set. */
  url: string | null;
  initial: string[];
  onClose: () => void;
  onConfirm: (pages: string[]) => void;
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

export function PageChooserDialog({ url, initial, onClose, onConfirm }: PageChooserDialogProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    setState({ status: "loading" });
    setChosen(new Set(initial));
    fetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setState({
            status: "error",
            message: await errorMessage(response, "The site's pages could not be listed."),
          });
          return;
        }
        const body = (await response.json()) as { title: string; pages: DiscoveredPage[] };
        setState({ status: "ready", title: body.title, pages: body.pages });
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setState({ status: "error", message: "Couldn't reach the app. Is it still running?" });
        }
      });
    return () => abort.abort();
    // `initial` is only the starting selection for a newly opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const toggle = (page: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else if (next.size < MAX_CHOSEN) next.add(page);
      return next;
    });
  };

  const pages = state.status === "ready" ? state.pages : [];
  const allChosen = pages.length > 0 && pages.slice(0, MAX_CHOSEN).every((page) => chosen.has(page.url));

  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose pages to clone</DialogTitle>
          <DialogDescription>
            {state.status === "ready"
              ? `The page you entered (“${state.title}”) is always included. Add up to ${MAX_CHOSEN} more.`
              : "The page you entered is always included."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-40 flex-1 overflow-y-auto px-1">
          {state.status === "loading" && (
            <p className="flex items-center gap-2 py-10 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Looking for pages on the site
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" className="py-6 text-destructive">
              {state.message}
            </p>
          )}
          {state.status === "ready" && pages.length === 0 && (
            <p className="py-6 text-muted-foreground">
              No other pages are linked from this page, so only it will be cloned.
            </p>
          )}
          {pages.length > 0 && (
            <>
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {plural(pages.length, "page")} found · {chosen.size} selected
                </span>
                <button
                  type="button"
                  className="rounded font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() =>
                    setChosen(
                      allChosen ? new Set() : new Set(pages.slice(0, MAX_CHOSEN).map((page) => page.url)),
                    )
                  }
                >
                  {allChosen ? "Clear selection" : pages.length > MAX_CHOSEN ? `Select first ${MAX_CHOSEN}` : "Select all"}
                </button>
              </div>
              <ul className="divide-y rounded-lg border">
                {pages.map((page) => {
                  const checked = chosen.has(page.url);
                  return (
                    <li key={page.url}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && chosen.size >= MAX_CHOSEN}
                          onChange={() => toggle(page.url)}
                          className="size-4 shrink-0 accent-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{page.label}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {pathOf(page.url)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={state.status !== "ready"}
            onClick={() => onConfirm(pages.filter((page) => chosen.has(page.url)).map((page) => page.url))}
          >
            {chosen.size === 0 ? "Clone this page only" : `Use ${plural(chosen.size + 1, "page")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
