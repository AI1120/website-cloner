"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useMemo } from "react";

import { cn } from "@/lib/utils";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const TEXT_ACCEPT = ".md,.txt,.html,.css,.js,.jsx,.ts,.tsx,.json,.svg,.vue,.py,.csv,text/*";
const MAX_FILES = 6;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Adds files to a list, dropping duplicates and anything over the limit. */
export function mergeFiles(current: File[], added: File[]): File[] {
  const merged = [...current];
  for (const file of added) {
    const duplicate = merged.some(
      (other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified,
    );
    if (!duplicate) merged.push(file);
  }
  return merged.slice(0, MAX_FILES);
}

interface AttachmentChipsProps {
  files: File[];
  onRemove: (file: File) => void;
  className?: string;
}

/** The files waiting to be sent with a message. */
export function AttachmentChips({ files, onRemove, className }: AttachmentChipsProps) {
  const previews = useMemo(
    () => new Map(files.filter(isImageFile).map((file) => [file, URL.createObjectURL(file)])),
    [files],
  );
  useEffect(() => {
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
    };
  }, [previews]);

  if (files.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {files.map((file) => {
        const preview = previews.get(file);
        return (
          <li
            key={`${file.name}:${file.size}:${file.lastModified}`}
            className="flex max-w-56 items-center gap-2 rounded-lg border bg-background py-1 pr-1 pl-1.5 text-xs"
          >
            {preview ? (
              // A local preview of a file the person just picked.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-7 shrink-0 rounded object-cover" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{file.name}</span>
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(file)}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
