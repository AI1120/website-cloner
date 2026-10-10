import { connection } from "next/server";

import { StartScreen } from "@/components/cloner/start-screen";
import { figmaToken } from "@/lib/ai/figma";
import { aiReadsImages, isAiConfigured } from "@/lib/ai/provider";
import { listProjects } from "@/lib/cloner/storage";
import { listTemplates } from "@/lib/projects/create";

export default async function Home() {
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
    />
  );
}
