import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden="true"
        className="relative inline-block size-5 rounded-[5px] bg-foreground"
      >
        <span className="absolute -right-1 -bottom-1 size-5 rounded-[5px] border-2 border-background bg-brand" />
      </span>
      SiteCloner
    </span>
  );
}
