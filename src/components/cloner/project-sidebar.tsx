"use client";

import { CopyPlus, Ellipsis, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { ProjectIcon } from "@/components/cloner/project-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-client";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";

const DAY = 24 * 60 * 60 * 1000;

interface Group {
  label: string;
  projects: Project[];
}

function groupByAge(projects: Project[], now: number): Group[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const groups: Group[] = [
    { label: "Today", projects: [] },
    { label: "Last 7 days", projects: [] },
    { label: "Earlier", projects: [] },
  ];
  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const project of sorted) {
    const time = new Date(project.updatedAt).getTime();
    const index = time >= startOfToday ? 0 : time >= startOfToday - 6 * DAY ? 1 : 2;
    groups[index].projects.push(project);
  }
  return groups.filter((group) => group.projects.length > 0);
}

interface ProjectSidebarProps {
  projects: Project[];
  open: boolean;
  onDelete: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onNew: () => void;
}

/** The list of projects beside the start screen, newest first. */
export function ProjectSidebar({ projects, open, onDelete, onDuplicate, onNew }: ProjectSidebarProps) {
  // Grouping depends on the viewer's clock, so it is done after mount.
  const now = useNow(10 * 60_000);
  const groups = useMemo(
    () => (now === null ? [{ label: "Projects", projects }] : groupByAge(projects, now)),
    [now, projects],
  );

  return (
    <aside
      aria-label="Projects"
      className={cn(
        "hidden w-64 shrink-0 flex-col border-r bg-muted/30",
        open && "lg:flex",
      )}
    >
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <Plus data-icon="inline-start" />
          New project
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {projects.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Your projects will be listed here.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h2 className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{group.label}</h2>
            <ul>
              {group.projects.map((project) => (
                <li key={project.id} className="group/item relative">
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ProjectIcon project={project} className="size-3.5" />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Options for ${project.name}`}
                      className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/item:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:opacity-100"
                    >
                      <Ellipsis className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40">
                      <DropdownMenuItem onClick={() => onDuplicate(project)}>
                        <CopyPlus />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(project)}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
