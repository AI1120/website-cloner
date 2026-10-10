"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProjectThumbnail } from "@/components/cloner/project-thumbnail";
import { errorMessage } from "@/lib/ndjson";
import type { Project, TemplateInfo } from "@/types/project";

interface TemplateGridProps {
  templates: TemplateInfo[];
  onCreated: (project: Project) => void;
}

/** Built-in starting points. Using one makes a project that is a copy of it. */
export function TemplateGrid({ templates, onCreated }: TemplateGridProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const use = async (template: TemplateInfo) => {
    if (pending) return;
    setPending(template.slug);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: template.slug }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "The template could not be opened."));
        return;
      }
      const body = (await response.json()) as { project: Project };
      onCreated(body.project);
      router.push(`/projects/${body.project.id}`);
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    } finally {
      setPending(null);
    }
  };

  if (templates.length === 0) return null;
  return (
    <section aria-labelledby="templates-heading" className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="templates-heading" className="text-lg font-semibold tracking-tight">
          Start from a template
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{templates.length} total</span>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {templates.map((template) => (
          <li key={template.slug}>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void use(template)}
              className="group relative block w-full overflow-hidden rounded-xl border text-left transition-shadow outline-none hover:shadow-[0_8px_30px_-12px_rgb(0_0_0/0.3)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
            >
              <ProjectThumbnail
                src={`/template-preview/${template.slug}/${template.entry}`}
                title={`Preview of ${template.name}`}
              />
              <span className="block border-t p-3">
                <span className="block truncate text-sm font-medium">{template.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {template.description}
                </span>
              </span>
              {pending === template.slug && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <LoaderCircle className="size-5 animate-spin" aria-label="Opening template" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
