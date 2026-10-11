"use client";

import { Camera, ImageOff, ImageUp, LoaderCircle, Lock, LockOpen } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/ndjson";
import type { Project } from "@/types/project";

const TITLE_LIMIT = 120;
const DESCRIPTION_LIMIT = 300;

interface ShareSettingsDialogProps {
  project: Project;
  onClose: () => void;
  onProjectChange: (project: Project) => void;
}

/**
 * The published link's settings: title, description and preview image for when
 * it's shared, and an optional password. Mounted only while open.
 */
export function ShareSettingsDialog({ project, onClose, onProjectChange }: ShareSettingsDialogProps) {
  const share = project.share;
  const pageTitle = project.pages.find((page) => page.path === project.entry)?.title ?? project.name;
  const [title, setTitle] = useState(share?.title ?? "");
  const [description, setDescription] = useState(share?.description ?? "");
  const [locked, setLocked] = useState(share?.protected ?? false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState<"generate" | "upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const image = share?.image ?? null;
  const imageUrl = image ? `/api/projects/${project.id}/share/image?v=${encodeURIComponent(image.updatedAt)}` : null;
  const wasProtected = share?.protected ?? false;
  const needsPassword = locked && (!wasProtected || password !== "");

  const imageRequest = async (kind: "generate" | "upload" | "remove", file?: File) => {
    setImageBusy(kind);
    setError(null);
    try {
      let init: RequestInit;
      if (kind === "remove") init = { method: "DELETE" };
      else if (kind === "upload" && file) {
        const form = new FormData();
        form.append("file", file);
        init = { method: "POST", body: form };
      } else {
        init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ generate: true }) };
      }
      const response = await fetch(`/api/projects/${project.id}/share/image`, init);
      if (!response.ok) {
        setError(await errorMessage(response, "The image couldn't be changed."));
        return;
      }
      const body = (await response.json()) as { project: Project };
      onProjectChange(body.project);
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    } finally {
      setImageBusy(null);
    }
  };

  const save = async () => {
    if (needsPassword && password.length < 4) {
      setError("Use a password of at least 4 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: { title: string; description: string; password?: string | null } = { title, description };
      if (!locked && wasProtected) body.password = null;
      else if (needsPassword) body.password = password;
      const response = await fetch(`/api/projects/${project.id}/share`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "The settings couldn't be saved."));
        return;
      }
      const result = (await response.json()) as { project: Project };
      onProjectChange(result.project);
      toast.success("Link settings saved", {
        description: project.published ? "They apply to the live link right away." : "They apply once you publish.",
      });
      onClose();
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    } finally {
      setSaving(false);
    }
  };

  const shownTitle = title.trim() || pageTitle;
  const host = typeof window === "undefined" ? "" : window.location.host;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Link settings</DialogTitle>
          <DialogDescription>
            How your published link looks when it&apos;s shared, and who can open it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-6 overflow-y-auto px-5 py-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="share-title">Title</Label>
              <Input
                id="share-title"
                value={title}
                maxLength={TITLE_LIMIT}
                placeholder={pageTitle}
                onChange={(event) => setTitle(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Shown in the browser tab and link previews. Leave empty to keep the page&apos;s own.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-description">Description</Label>
              <Textarea
                id="share-description"
                value={description}
                maxLength={DESCRIPTION_LIMIT}
                rows={3}
                placeholder="A sentence about the site, for search results and link previews."
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Preview image</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={imageBusy !== null} onClick={() => void imageRequest("generate")}>
                  {imageBusy === "generate" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Camera data-icon="inline-start" />}
                  Take from the page
                </Button>
                <Button variant="outline" size="sm" disabled={imageBusy !== null} onClick={() => fileRef.current?.click()}>
                  {imageBusy === "upload" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <ImageUp data-icon="inline-start" />}
                  Upload
                </Button>
                {image && (
                  <Button variant="ghost" size="sm" disabled={imageBusy !== null} onClick={() => void imageRequest("remove")}>
                    <ImageOff data-icon="inline-start" />
                    Remove
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void imageRequest("upload", file);
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                &ldquo;Take from the page&rdquo; photographs the top of your home page at 1200 × 630, the size
                link previews use.
              </p>
            </div>

            <div className="space-y-2 rounded-xl border p-3.5">
              <div className="flex items-center gap-3">
                {locked ? <Lock className="size-4 text-brand" aria-hidden="true" /> : <LockOpen className="size-4 text-muted-foreground" aria-hidden="true" />}
                <Label htmlFor="share-lock" className="flex-1">Require a password</Label>
                <Switch id="share-lock" checked={locked} onCheckedChange={setLocked} />
              </div>
              {locked && (
                <div className="space-y-1.5 pt-1">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    aria-label={wasProtected ? "New password" : "Password"}
                    placeholder={wasProtected ? "Leave empty to keep the current password" : "Choose a password"}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Visitors enter it once per browser. It locks the pages; the images and styles they use
                    can only be found from a page.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">When the link is shared</p>
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex aspect-[1200/630] items-center justify-center bg-muted">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by this app for the preview
                  <img src={imageUrl} alt="Preview image" className="size-full object-cover" />
                ) : (
                  <span className="px-4 text-center text-xs text-muted-foreground">No preview image</span>
                )}
              </div>
              <div className="space-y-1 border-t px-3 py-2.5">
                <p className="truncate text-[11px] text-muted-foreground uppercase">{host}</p>
                <p className="line-clamp-2 text-sm font-semibold">{shownTitle}</p>
                {description.trim() && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{description.trim()}</p>
                )}
              </div>
            </div>
            {locked && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" />
                Opening it asks for the password.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="items-center border-t px-5 py-3.5">
          {error && (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
