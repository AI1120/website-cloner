"use client";

import { History, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/hooks/use-client";
import { plural, timeAgo } from "@/lib/format";
import type { Project } from "@/types/project";

interface HistoryMenuProps {
  project: Project;
  disabled: boolean;
  onRestore: (checkpointId: string) => void;
}

/** Every change made to the project, newest first, each of which can be undone. */
export function HistoryMenu({ project, disabled, onRestore }: HistoryMenuProps) {
  const now = useNow(30_000);
  const changes = [...project.checkpoints].reverse();

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label="History" title="History" />}
      >
        <History />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">History</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Undoing a change also undoes everything made after it.
          </p>
        </div>
        {changes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol className="max-h-80 overflow-y-auto py-1">
            {changes.map((change, index) => {
              const files = change.modified.length + change.created.length;
              return (
                <li key={change.id} className="flex items-start gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm break-words">{change.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {plural(files, "file")}
                      {now !== null && ` · ${timeAgo(change.createdAt, now)}`}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    title={index === 0 ? "Undo this change" : "Undo this change and the ones after it"}
                    onClick={() => onRestore(change.id)}
                  >
                    <Undo2 data-icon="inline-start" />
                    Undo
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
