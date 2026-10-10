import type { Project } from "@/types/project";

/** "React · Tailwind CSS" for built projects, the source site for copies. */
export function projectKind(project: Project): string {
  if (project.source === "clone") return project.host || "Copied site";
  const framework = project.framework === "react" ? "React" : "HTML";
  const styling = project.styling === "tailwind" ? "Tailwind CSS" : "Inline styles";
  return `${framework} · ${styling}${project.uiLibrary === "shadcn" ? " · shadcn/ui" : ""}`;
}
