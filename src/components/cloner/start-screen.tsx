"use client";

import { LayoutTemplate, PanelLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useOpenProjectCommands, useThemeCommands } from "@/components/cloner/app-commands";
import {
  CommandPalette,
  PaletteButton,
  usePaletteShortcut,
  type Command,
} from "@/components/cloner/command-palette";
import { HeroBackdrop } from "@/components/cloner/hero-backdrop";
import { ProjectGrid } from "@/components/cloner/project-grid";
import { ProjectSidebar } from "@/components/cloner/project-sidebar";
import { Wordmark } from "@/components/cloner/site-header";
import { StartComposer } from "@/components/cloner/start-composer";
import { TemplateGrid } from "@/components/cloner/template-grid";
import { ThemeToggle } from "@/components/cloner/theme-toggle";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useStoredFlag } from "@/hooks/use-client";
import { errorMessage } from "@/lib/ndjson";
import type { Project, TemplateInfo } from "@/types/project";

const SIDEBAR_KEY = "sitecloner:sidebar";

interface StartScreenProps {
  initialProjects: Project[];
  templates: TemplateInfo[];
  aiConfigured: boolean;
  figmaConfigured: boolean;
  imagesSupported: boolean;
  browserAvailable: boolean;
}

export function StartScreen({
  initialProjects,
  templates,
  aiConfigured,
  figmaConfigured,
  imagesSupported,
  browserAvailable,
}: StartScreenProps) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [sidebarOpen, setSidebarOpen] = useStoredFlag(SIDEBAR_KEY, true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleCreated = useCallback((project: Project) => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
  }, []);

  const handleDelete = useCallback(async (project: Project) => {
    if (!window.confirm(`Delete “${project.name}”? This removes the project and its published link.`)) {
      return;
    }
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        toast.error(await errorMessage(response, "The project could not be deleted."));
        return;
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
      toast.success(`Deleted “${project.name}”`);
    } catch {
      toast.error("Couldn't reach the app. Is it still running?");
    }
  }, []);

  const handleDuplicate = useCallback(
    async (project: Project) => {
      try {
        const response = await fetch(`/api/projects/${project.id}/duplicate`, { method: "POST" });
        if (!response.ok) {
          toast.error(await errorMessage(response, "The project could not be duplicated."));
          return;
        }
        const body = (await response.json()) as { project: Project };
        handleCreated(body.project);
        router.push(`/projects/${body.project.id}`);
      } catch {
        toast.error("Couldn't reach the app. Is it still running?");
      }
    },
    [handleCreated, router],
  );

  const focusPrompt = useCallback(() => {
    document.getElementById("start-main")?.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("start-prompt")?.focus({ preventScroll: true });
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteShortcut(openPalette);
  const themeCommands = useThemeCommands();
  const projectCommands = useOpenProjectCommands(projects);

  const commands = useMemo((): Command[] => {
    const list: Command[] = [
      {
        id: "new",
        group: "Start",
        label: "New project",
        icon: Plus,
        keywords: "create build clone prompt",
        run: focusPrompt,
      },
    ];
    if (templates.length > 0) {
      list.push({
        id: "templates",
        group: "Start",
        label: "Browse templates",
        icon: LayoutTemplate,
        run: () => document.getElementById("templates")?.scrollIntoView({ behavior: "smooth" }),
      });
    }
    list.push({
      id: "sidebar",
      group: "Start",
      label: sidebarOpen ? "Hide the project list" : "Show the project list",
      icon: PanelLeft,
      keywords: "sidebar",
      run: () => setSidebarOpen(!sidebarOpen),
    });
    return [...list, ...projectCommands, ...themeCommands];
  }, [focusPrompt, projectCommands, setSidebarOpen, sidebarOpen, templates.length, themeCommands]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={sidebarOpen ? "Hide project list" : "Show project list"}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? "Hide project list" : "Show project list"}
          className="hidden lg:inline-flex"
          onClick={toggleSidebar}
        >
          <PanelLeft />
        </Button>
        <Link href="/" aria-label="SiteCloner home" className="rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Wordmark />
        </Link>
        <nav className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
          <PaletteButton onClick={openPalette} />
          {templates.length > 0 && (
            <a href="#templates" className="transition-colors hover:text-foreground">
              Templates
            </a>
          )}
          <a href="#projects" className="transition-colors hover:text-foreground">
            Projects
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        <ProjectSidebar
          projects={projects}
          open={sidebarOpen}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onNew={focusPrompt}
        />

        <main id="start-main" className="relative min-w-0 flex-1 overflow-y-auto">
          <HeroBackdrop />

          <section className="relative mx-auto w-full max-w-3xl px-4 pt-14 text-center sm:px-6 sm:pt-20">
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
              What do you want to build?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
              Start from an idea, a design, a screenshot or an existing website. Refine it by
              chatting, then export the code or publish it.
            </p>
            <div className="mt-8">
              <StartComposer
                aiConfigured={aiConfigured}
                figmaConfigured={figmaConfigured}
                imagesSupported={imagesSupported}
                browserAvailable={browserAvailable}
                onCreated={handleCreated}
              />
            </div>
          </section>

          <div className="relative mx-auto mt-14 w-full max-w-6xl space-y-12 px-4 pb-20 sm:px-6">
            <div id="templates" className="scroll-mt-6">
              <TemplateGrid templates={templates} onCreated={handleCreated} />
            </div>

            <section id="projects" className="scroll-mt-6">
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <h2 className="text-lg font-semibold tracking-tight">Your projects</h2>
                {projects.length > 0 && (
                  <span className="text-sm text-muted-foreground tabular-nums">{projects.length}</span>
                )}
              </div>
              <ProjectGrid projects={projects} onDelete={handleDelete} />
            </section>

            <p className="text-center text-xs text-muted-foreground">
              Projects are stored on this machine. When you clone a site, its logos, brand assets
              and original text still belong to their owners.
            </p>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  );
}
