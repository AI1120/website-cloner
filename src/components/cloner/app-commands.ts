"use client";

import { FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { Command } from "@/components/cloner/command-palette";
import { THEME_ICONS, THEME_LABELS } from "@/components/cloner/theme-toggle";
import { useTheme } from "@/hooks/use-theme";
import { THEME_PREFERENCES } from "@/lib/theme";
import type { ProjectSummary } from "@/types/project";

/** Commands that switch between light, dark and the device's theme. */
export function useThemeCommands(): Command[] {
  const { preference, setPreference } = useTheme();
  return useMemo(
    () =>
      THEME_PREFERENCES.map((value) => ({
        id: `theme-${value}`,
        group: "Theme",
        label: value === "system" ? "Theme: match the device" : `Theme: ${THEME_LABELS[value].toLowerCase()}`,
        icon: THEME_ICONS[value],
        keywords: "appearance color mode dark light",
        hint: value === preference ? "Current" : undefined,
        run: () => setPreference(value),
      })),
    [preference, setPreference],
  );
}

/** Commands that open each project, leaving out the one already open. */
export function useOpenProjectCommands(projects: ProjectSummary[], currentId?: string): Command[] {
  const router = useRouter();
  return useMemo(
    () =>
      projects
        .filter((project) => project.id !== currentId)
        .map((project) => ({
          id: `project-${project.id}`,
          group: "Projects",
          label: project.name,
          icon: FolderOpen,
          keywords: `open project ${project.host}`,
          hint: project.host || undefined,
          run: () => router.push(`/projects/${project.id}`),
        })),
    [currentId, projects, router],
  );
}

/** The project list, fetched each time `active` turns true (the palette opens). */
export function useProjectList(active: boolean): ProjectSummary[] {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/projects")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { projects?: ProjectSummary[] } | null) => {
        if (!cancelled && body?.projects) setProjects(body.projects);
      })
      .catch(() => {
        // The palette still works without the list.
      });
    return () => {
      cancelled = true;
    };
  }, [active]);
  return projects;
}
