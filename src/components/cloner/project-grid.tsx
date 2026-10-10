"use client";

import { TriangleAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ProjectIcon } from "@/components/cloner/project-icon";
import { ProjectThumbnail } from "@/components/cloner/project-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes, plural, timeAgo } from "@/lib/format";
import { projectKind } from "@/lib/projects/labels";
import type { Project } from "@/types/project";

interface ProjectCardProps {
  project: Project;
  now: number | null;
  onDelete: (project: Project) => void;
}

function ProjectCard({ project, now, onDelete }: ProjectCardProps) {
  const href = `/projects/${project.id}`;
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]">
      <Link href={href} className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ProjectThumbnail
          src={`/preview/${project.id}/${project.entry}`}
          title={`Preview of ${project.name}`}
        />
        <span className="sr-only">Open {project.name}</span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 border-t p-3.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5">
            <ProjectIcon project={project} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={href}
              className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
            >
              {project.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{projectKind(project)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${project.name}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(project)}
          >
            <Trash2 />
          </Button>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{plural(project.pages.length, "page")}</span>
          {project.source === "clone" && (
            <>
              <span aria-hidden="true">·</span>
              <span>{plural(project.stats.assets, "file")}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(project.stats.bytes)}</span>
            </>
          )}
          {now !== null && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={project.createdAt}>{timeAgo(project.createdAt, now)}</time>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {project.warnings.length > 0 && (
              <TriangleAlert
                className="size-3.5 text-amber-600"
                aria-label={`${plural(project.warnings.length, "note")} about this clone`}
              />
            )}
            {project.published && <Badge variant="secondary">Published</Badge>}
          </span>
        </div>
      </div>
    </li>
  );
}

interface ProjectGridProps {
  projects: Project[];
  onDelete: (project: Project) => void;
}

export function ProjectGrid({ projects, onDelete }: ProjectGridProps) {
  // Relative times depend on the viewer's clock, so render them after mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-12 text-center">
        <p className="text-sm font-medium">No projects yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe an idea or paste a website address above, and your first project will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} now={now} onDelete={onDelete} />
      ))}
    </ul>
  );
}
