import { connection } from "next/server";

import { StartScreen } from "@/components/cloner/start-screen";
import { figmaToken } from "@/lib/ai/figma";
import { aiReadsImages, isAiConfigured } from "@/lib/ai/provider";
import { browserAvailable } from "@/lib/cloner/browser";
import { listProjects } from "@/lib/cloner/storage";
import { listTemplates } from "@/lib/projects/create";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { clone } = await searchParams;
  // `/?clone=<address>` opens the start screen in Clone Website mode with the address filled in.
  const initialCloneUrl = typeof clone === "string" && /^https?:\/\//i.test(clone) ? clone.slice(0, 2048) : undefined;
  // Projects and settings live on disk and in the environment; both change between requests.
  await connection();
  const [projects, templates] = await Promise.all([listProjects(), listTemplates()]);

  return (
    <StartScreen
      initialProjects={projects}
      templates={templates}
      aiConfigured={isAiConfigured()}
      figmaConfigured={figmaToken() !== ""}
      imagesSupported={aiReadsImages()}
      browserAvailable={browserAvailable()}
      initialCloneUrl={initialCloneUrl}
    />
  );
}
