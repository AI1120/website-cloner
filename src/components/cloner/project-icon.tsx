"use client";

import { Globe, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";

/**
 * A project's icon: the copied site's own icon when there is one, a globe for
 * other copies, and a sparkle in the brand colour for projects built with AI.
 */
export function ProjectIcon({ project, className }: { project: Project; className?: string }) {
  const [failed, setFailed] = useState(false);
  const size = cn("size-4 shrink-0", className);

  if (project.icon && !failed) {
    return (
      // A small icon served by this app's own preview route; next/image adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/preview/${project.id}/${project.icon}`}
        alt=""
        width={16}
        height={16}
        className={cn(size, "rounded-[3px] object-contain")}
        onError={() => setFailed(true)}
      />
    );
  }
  if (project.source === "clone") {
    return <Globe className={cn(size, "text-muted-foreground")} aria-hidden="true" />;
  }
  return <Sparkles className={cn(size, "text-brand")} aria-hidden="true" />;
}
