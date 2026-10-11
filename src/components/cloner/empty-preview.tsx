"use client";

import { Globe, Hammer, MessageSquareText, Sparkles } from "lucide-react";
import Link from "next/link";

import { Scene3D } from "@/components/cloner/scene-3d";
import { Button } from "@/components/ui/button";
import { cloneIntent, displayAddress } from "@/lib/clone-intent";

interface EmptyPreviewProps {
  /** True while the AI is working on the project. */
  running: boolean;
  /** What the person first asked for, if known. */
  request: string | null;
  aiConfigured: boolean;
  /** Sends `request` to the AI again. */
  onBuild: (request: string) => void;
}

/**
 * Shown in place of the preview while a project has nothing built yet: a page
 * assembling itself while the AI works, or a blueprint waiting to be built.
 */
export function EmptyPreview({ running, request, aiConfigured, onBuild }: EmptyPreviewProps) {
  const address = request ? cloneIntent(request) : null;

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-background px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_50%_at_50%_42%,color-mix(in_oklch,var(--brand)_14%,transparent),transparent_75%)]"
      />
      <Scene3D
        preset={running ? "building" : "idle"}
        className="h-[min(46vh,380px)] w-full max-w-2xl"
        fallback={<div className="mx-auto mt-8 h-40 w-60 rounded-2xl border-2 border-dashed border-brand/40" />}
      />

      <div className="relative mt-2 max-w-lg">
        {running ? (
          <>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
              <Sparkles className="size-3.5 animate-pulse" aria-hidden="true" />
              Building
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance">Your app is taking shape</h2>
            <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
              The AI is writing the pages now. Follow each step in the chat; the preview appears here
              the moment the first version builds.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight text-balance">Nothing built yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
              {request
                ? "The first build didn't finish, so there's no page to show. Start it again, or describe what you want in the chat."
                : "Describe what you want in the chat and the AI will build it here."}
            </p>
          </>
        )}

        {request && (
          <blockquote className="mx-auto mt-5 max-w-md rounded-xl border bg-card/80 px-4 py-3 text-left text-sm shadow-xs backdrop-blur">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquareText className="size-3.5" aria-hidden="true" />
              Your request
            </span>
            <span className="line-clamp-3 break-words">{request}</span>
          </blockquote>
        )}

        {!running && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {address && (
              <Button size="lg" nativeButton={false} render={<Link href={`/?clone=${encodeURIComponent(address)}`} />}>
                <Globe data-icon="inline-start" />
                Clone {displayAddress(address)}
              </Button>
            )}
            {request && aiConfigured && (
              <Button size="lg" variant={address ? "outline" : "default"} onClick={() => onBuild(request)}>
                <Hammer data-icon="inline-start" />
                {address ? "Build it with AI instead" : "Build it now"}
              </Button>
            )}
          </div>
        )}
        {!running && address && (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Your request mentions copying a site. <strong className="font-medium text-foreground">Clone Website</strong>{" "}
            copies the real page with its images and fonts, which the AI can&apos;t do from a link.
          </p>
        )}
      </div>
    </div>
  );
}
