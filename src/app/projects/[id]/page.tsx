import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Workspace } from "@/components/cloner/workspace";
import { isAiConfigured } from "@/lib/ai/agent";
import { readChat } from "@/lib/ai/chat-store";
import { runningJob } from "@/lib/ai/jobs";
import { browserAvailable } from "@/lib/cloner/browser";
import { readProject } from "@/lib/cloner/storage";
import { hasOnlyStarter } from "@/lib/projects/create";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const project = await readProject(id);
  return { title: project ? `${project.name} · SiteCloner` : "Project not found · SiteCloner" };
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const project = await readProject(id);
  if (!project) notFound();

  return (
    <Workspace
      initialProject={project}
      initialMessages={await readChat(id)}
      initiallyRunning={runningJob(id) !== null}
      aiConfigured={isAiConfigured()}
      browserAvailable={browserAvailable()}
      initiallyEmpty={await hasOnlyStarter(project)}
    />
  );
}
