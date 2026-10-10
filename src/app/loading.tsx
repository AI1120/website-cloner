import { LoaderCircle } from "lucide-react";

import { Wordmark } from "@/components/cloner/site-header";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex h-dvh flex-col">
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <Wordmark />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
      </div>
    </div>
  );
}
