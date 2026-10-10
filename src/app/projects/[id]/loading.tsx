import { LoaderCircle } from "lucide-react";

/** The workspace's outline while a project opens. */
export default function ProjectLoading() {
  return (
    <div role="status" aria-label="Opening project" className="flex h-dvh flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
        <div className="size-8 rounded-lg bg-muted" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-3 w-40 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-24 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="hidden h-8 w-64 animate-pulse rounded-lg bg-muted md:block" />
        <div className="hidden h-8 w-48 animate-pulse rounded-lg bg-muted md:block" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[380px] shrink-0 flex-col border-r lg:flex">
          <div className="h-11 border-b" />
          <div className="flex-1 space-y-4 p-4">
            <div className="ml-auto h-9 w-3/5 animate-pulse rounded-2xl bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="m-3 h-24 rounded-xl border" />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/40 p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden="true" />
            Opening project…
          </p>
        </div>
      </div>
    </div>
  );
}
