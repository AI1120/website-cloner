"use client";

import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Rocket } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-client";
import { timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";
import type { Project } from "@/types/project";

/** Publishes (POST) or unpublishes (DELETE) a project. */
export async function requestPublish(
  projectId: string,
  method: "POST" | "DELETE",
): Promise<{ project: Project } | { error: string }> {
  try {
    const response = await fetch(`/api/projects/${projectId}/publish`, { method });
    if (!response.ok) return { error: await errorMessage(response, "That didn't work. Try again.") };
    return (await response.json()) as { project: Project };
  } catch {
    return { error: "Couldn't reach the app. Is it still running?" };
  }
}

/** Where a project's published copy can be opened. */
export function livePath(project: Project): string {
  return `/p/${project.id}/${project.entry}`;
}

interface PublishControlProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

/** A QR code for the address, as an image URL. Null until it has been drawn. */
function useQrCode(text: string | null): string | null {
  const [code, setCode] = useState<{ text: string; image: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    QRCode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((image) => {
        if (!cancelled) setCode({ text, image });
      })
      .catch(() => {
        // Without the code the link itself still works.
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  return code && code.text === text ? code.image : null;
}

export function PublishControl({ project, onProjectChange }: PublishControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const now = useNow(30_000);

  const path = livePath(project);
  const liveUrl = origin ? `${origin}${path}` : path;
  const published = project.published;
  const qr = useQrCode(open && published && origin ? liveUrl : null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOrigin(window.location.origin);
      setError(null);
      setCopied(false);
    }
    setOpen(next);
  };

  const request = useCallback(
    async (method: "POST" | "DELETE") => {
      setBusy(method === "POST" ? "publish" : "unpublish");
      setError(null);
      const result = await requestPublish(project.id, method);
      setBusy(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onProjectChange(result.project);
      if (method === "DELETE") toast.info("Unpublished. The link no longer works.");
    },
    [onProjectChange, project.id],
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The link couldn't be copied. Select it and copy it by hand.");
    }
  };

  const changedSincePublish =
    published !== null && new Date(project.updatedAt).getTime() > new Date(published.publishedAt).getTime() + 1500;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={<Button />}>
        {published ? <Check data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
        {published ? "Published" : "Publish"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        {published ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">Your project is live</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Last published {now === null ? "recently" : timeAgo(published.publishedAt, now)}.
                {changedSincePublish && " You have changes that aren't live yet."}
              </p>
            </div>

            <div className="flex gap-1.5">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Live address</span>
                <input
                  readOnly
                  value={liveUrl}
                  onFocus={(event) => event.target.select()}
                  className="h-8 w-full min-w-0 rounded-lg border bg-muted/50 px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
              <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => void copyLink()}>
                {copied ? <Check /> : <Copy />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Open live site"
                nativeButton={false}
                render={<a href={path} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-white p-1">
                {qr ? (
                  // Drawn in the browser from the address above.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR code for the live address" className="size-full" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Scan to open it on a phone. This works for devices that can reach this address.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void request("DELETE")}
              >
                {busy === "unpublish" && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
                Unpublish
              </Button>
              <Button disabled={busy !== null} onClick={() => void request("POST")}>
                {busy === "publish" ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                Update
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="font-medium">Publish this project</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Publishing puts a snapshot of the project at a link you can share. Changes you make
                afterwards stay private until you update it.
              </p>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={busy !== null} onClick={() => void request("POST")}>
              {busy === "publish" ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <Rocket data-icon="inline-start" />
              )}
              Publish
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
