"use client";

import { ChevronDown, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat, Project } from "@/types/project";

export interface FormatChoice {
  format: ExportFormat;
  label: string;
  hint: string;
}

/** A React project is its own source; a static site can also be converted. */
export function formatsFor(project: Project): FormatChoice[] {
  if (project.framework === "react") {
    return [
      { format: "source", label: "React project", hint: "The Vite project, ready for npm install" },
      { format: "html", label: "Built site", hint: "Static files, ready to host" },
    ];
  }
  return [
    { format: "html", label: "HTML", hint: "Static files, ready to host" },
    { format: "react", label: "React", hint: "Vite project with JSX pages" },
    { format: "vue", label: "Vue", hint: "Vite project with Vue pages" },
  ];
}

export function exportUrl(project: Project, format: ExportFormat): string {
  return `/api/projects/${project.id}/export?format=${format}`;
}

export function ExportMenu({ project }: { project: Project }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Download data-icon="inline-start" />
        Export
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {formatsFor(project).map(({ format, label, hint }) => (
          <DropdownMenuItem
            key={format}
            render={<a href={exportUrl(project, format)} download />}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-medium">{label} (.zip)</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
