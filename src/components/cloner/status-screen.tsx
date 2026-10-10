import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/cloner/site-header";

/** A page sketch with its dashed copy offset behind it: the app's "cloned page" motif. */
function PageSketch() {
  return (
    <div aria-hidden="true" className="relative mx-auto mb-10 h-28 w-40">
      <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-xl border-2 border-dashed border-brand/40" />
      <div className="absolute inset-0 space-y-2 rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex gap-1">
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="h-2 w-2/3 rounded bg-muted" />
        <div className="h-2 w-1/2 rounded bg-muted" />
        <div className="h-7 w-full rounded-md bg-brand/10" />
      </div>
    </div>
  );
}

interface StatusScreenProps {
  /** A short tag above the title, e.g. "404". */
  code: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
}

/** The layout of the not-found and error pages. */
export function StatusScreen({ code, title, children, actions, footnote }: StatusScreenProps) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-3 sm:px-4">
        <Link
          href="/"
          aria-label="SiteCloner home"
          className="rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Wordmark />
        </Link>
      </header>
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(55%_65%_at_50%_0%,color-mix(in_oklch,var(--brand)_16%,transparent),transparent_70%)]"
        />
        <div className="relative w-full max-w-md text-center">
          <PageSketch />
          <p className="font-mono text-xs font-medium tracking-widest text-brand uppercase">{code}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">{title}</h1>
          <div className="mt-3 text-base leading-relaxed text-pretty text-muted-foreground">{children}</div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">{actions}</div>
          {footnote && <div className="mt-8 text-xs text-muted-foreground">{footnote}</div>}
        </div>
      </main>
    </div>
  );
}
