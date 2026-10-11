import { serveProjectFile } from "@/lib/build/page-check";
import { PageRenderer } from "@/lib/cloner/browser";
import type { Project } from "@/types/project";

const SHARE_ORIGIN = "https://share.sitecloner.invalid";
/** The size link previews use (Open Graph's recommended 1.91:1). */
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * A link-preview picture of the project's entry page: the top 1200 × 630 pixels
 * as a visitor sees them. Rendered from the working copy, so it works before the
 * first publish. Null when there's no browser or the page won't open.
 */
export async function renderShareImage(project: Project, signal: AbortSignal): Promise<Buffer | null> {
  const renderer = await PageRenderer.open(signal);
  if (!renderer) return null;
  try {
    renderer.serveLocally(SHARE_ORIGIN, (url, method) => serveProjectFile(project, url, method));
    const shot = await renderer.screenshot(`${SHARE_ORIGIN}/${project.entry}`, WIDTH, HEIGHT);
    return typeof shot === "string" ? null : shot.image;
  } finally {
    await renderer.close();
  }
}
