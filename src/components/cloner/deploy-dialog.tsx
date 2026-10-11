"use client";

import { Check, CircleAlert, Cloud, ExternalLink, GitBranch, LoaderCircle, Triangle } from "lucide-react";
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-client";
import { timeAgo } from "@/lib/format";
import { errorMessage, readNdjson } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { DeployEvent, DeployTarget, Project } from "@/types/project";

interface ServiceInfo {
  target: DeployTarget;
  name: string;
  icon: LucideIcon;
  what: string;
  action: string;
  again: string;
  setting: string;
  tokenUrl: string;
  tokenHint: string;
}

const SERVICES: ServiceInfo[] = [
  {
    target: "netlify",
    name: "Netlify",
    icon: Cloud,
    what: "Hosts the finished site at a netlify.app address you can connect your own domain to.",
    action: "Deploy to Netlify",
    again: "Update on Netlify",
    setting: "NETLIFY_TOKEN",
    tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    tokenHint: "a personal access token",
  },
  {
    target: "vercel",
    name: "Vercel",
    icon: Triangle,
    what: "Hosts the finished site at a vercel.app address, on Vercel's global network.",
    action: "Deploy to Vercel",
    again: "Update on Vercel",
    setting: "VERCEL_TOKEN",
    tokenUrl: "https://vercel.com/account/tokens",
    tokenHint: "an access token (add VERCEL_TEAM_ID for a team)",
  },
  {
    target: "github",
    name: "GitHub",
    icon: GitBranch,
    what: "Pushes the project's code to a private repository, as a new commit each time.",
    action: "Push to GitHub",
    again: "Push again",
    setting: "GITHUB_TOKEN",
    tokenUrl: "https://github.com/settings/tokens",
    tokenHint: "a token allowed to create repositories and write their contents (classic: the repo scope)",
  },
];

type Run = { target: DeployTarget; message: string } | null;

interface DeployDialogProps {
  project: Project;
  available: Record<DeployTarget, boolean>;
  onClose: () => void;
  onProjectChange: (project: Project) => void;
}

/** Deploy to Netlify or Vercel, or push to GitHub. Mounted only while open. */
export function DeployDialog({ project, available, onClose, onProjectChange }: DeployDialogProps) {
  const [run, setRun] = useState<Run>(null);
  const [errors, setErrors] = useState<Partial<Record<DeployTarget, string>>>({});
  const abortRef = useRef<AbortController | null>(null);
  const now = useNow(30_000);

  const deploy = async (target: DeployTarget) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setErrors((current) => ({ ...current, [target]: undefined }));
    setRun({ target, message: "Starting" });
    try {
      const response = await fetch(`/api/projects/${project.id}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
        signal: abort.signal,
      });
      if (!response.ok) {
        setErrors((current) => ({ ...current, [target]: undefined }));
        const message = await errorMessage(response, "The deploy couldn't start.");
        setErrors((current) => ({ ...current, [target]: message }));
        return;
      }
      for await (const event of readNdjson<DeployEvent>(response)) {
        if (event.type === "status") setRun({ target, message: event.message });
        else if (event.type === "done") {
          onProjectChange(event.project);
          const service = SERVICES.find((item) => item.target === target);
          toast.success(target === "github" ? "Pushed to GitHub" : `Live on ${service?.name}`, {
            description: event.url,
            action: { label: "Open", onClick: () => window.open(event.url, "_blank", "noreferrer") },
          });
          return;
        } else {
          setErrors((current) => ({ ...current, [target]: event.message }));
          return;
        }
      }
      setErrors((current) => ({ ...current, [target]: "The connection closed before the deploy finished." }));
    } catch {
      if (!abort.signal.aborted) {
        setErrors((current) => ({ ...current, [target]: "Couldn't reach the app. Is it still running?" }));
      }
    } finally {
      setRun(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        abortRef.current?.abort();
        onClose();
      }}
    >
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Deploy</DialogTitle>
          <DialogDescription>
            Put the project live on a hosting service, or keep its code on GitHub. Uses your own accounts.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y overflow-y-auto">
          {SERVICES.map((service) => {
            const record = project.deployments?.[service.target];
            const ready = available[service.target];
            const running = run?.target === service.target;
            const error = errors[service.target];
            const Icon = service.icon;
            return (
              <li key={service.target} className="flex gap-4 px-5 py-4">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                    ready ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="font-medium">{service.name}</p>
                    {record && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3.5" aria-hidden="true" />
                        {service.target === "github" ? "Pushed" : "Deployed"}
                        {now !== null && ` ${timeAgo(record.deployedAt, now)}`}
                      </span>
                    )}
                    <Button
                      size="sm"
                      className="ml-auto"
                      variant={record ? "outline" : "default"}
                      disabled={!ready || run !== null}
                      onClick={() => void deploy(service.target)}
                    >
                      {running && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
                      {record ? service.again : service.action}
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{service.what}</p>
                  {record && (
                    <a
                      href={record.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs text-brand hover:underline"
                    >
                      {record.url.replace(/^https?:\/\//, "")}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  )}
                  {running && (
                    <p className="flex items-center gap-1.5 text-xs" aria-live="polite">
                      <LoaderCircle className="size-3.5 animate-spin text-brand" aria-hidden="true" />
                      {run?.message}
                    </p>
                  )}
                  {error && !running && (
                    <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {error}
                    </p>
                  )}
                  {!ready && (
                    <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                      To use it, create {service.tokenHint} at{" "}
                      <a href={service.tokenUrl} target="_blank" rel="noreferrer" className="text-foreground underline">
                        {service.tokenUrl.replace(/^https:\/\//, "").replace(/#.*$/, "")}
                      </a>
                      , add <code className="font-mono text-foreground">{service.setting}=…</code> to{" "}
                      <code className="font-mono text-foreground">.env.local</code>, and restart the app.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
