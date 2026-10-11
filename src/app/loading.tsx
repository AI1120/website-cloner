import { Scene3D } from "@/components/cloner/scene-3d";
import { Wordmark } from "@/components/cloner/site-header";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex h-dvh flex-col">
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <Wordmark />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
        <Scene3D
          preset="building"
          className="h-56 w-full max-w-md"
          fallback={<div className="mx-auto mt-16 size-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />}
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
