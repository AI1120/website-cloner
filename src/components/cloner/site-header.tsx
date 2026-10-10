import Image from "next/image";

import logo from "@/components/cloner/sitecloner-logo.png";
import { cn } from "@/lib/utils";

/** The logo alone, at a small size (16px tall by default), e.g. beside an AI reply. */
export function LogoMark({ className }: { className?: string }) {
  return <Image src={logo} alt="" width={13} height={16} className={cn("h-4 w-auto", className)} />;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      {/* Sized to how it is shown (28px tall), so a small file is fetched. */}
      <Image src={logo} alt="" width={23} height={28} preload className="h-7 w-auto" />
      SiteCloner
    </span>
  );
}
