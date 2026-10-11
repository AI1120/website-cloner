import { serveProjectFile } from "@/lib/build/page-check";
import { PageRenderer, type Screenshot } from "@/lib/cloner/browser";
import type { CompareDevice, PageComparison, Project } from "@/types/project";

/**
 * "Compare with the original": screenshots the live page and the copy in the
 * same browser at the same width, and measures how closely they match.
 *
 * The copy is shown to the browser at an address that never resolves
 * (".invalid"); `PageRenderer.serveLocally` answers it from the project's files
 * through the same code as the preview, so nothing is fetched over the network
 * for it. The original goes through `safeFetch` like any clone.
 */

const COPY_ORIGIN = "https://copy.sitecloner.invalid";
const WIDTHS: Record<CompareDevice, number> = { desktop: 1440, phone: 390 };
/** Long pages are compared from the top down to this many CSS pixels. */
const MAX_HEIGHT: Record<CompareDevice, number> = { desktop: 4000, phone: 6000 };

export class CompareError extends Error {}

function toDataUrl(shot: Screenshot): string {
  return `data:image/jpeg;base64,${shot.image.toString("base64")}`;
}

export async function compareWithOriginal(
  project: Project,
  pagePath: string,
  device: CompareDevice,
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<PageComparison> {
  const page = project.pages.find((item) => item.path === pagePath);
  if (!page) throw new CompareError("That page isn't part of this project.");
  if (!page.url) {
    throw new CompareError("This page was made in the app, so there's no original to compare it with.");
  }

  status("Starting a browser");
  const renderer = await PageRenderer.open(signal);
  if (!renderer) {
    throw new CompareError("Comparing needs Chrome or Edge on the machine running the app.");
  }
  try {
    renderer.serveLocally(COPY_ORIGIN, (url) => serveProjectFile(project, url));

    const width = WIDTHS[device];
    const maxHeight = MAX_HEIGHT[device];
    status(`Opening ${new URL(page.url).hostname}`);
    const original = await renderer.screenshot(page.url, width, maxHeight);
    if (typeof original === "string") throw new CompareError(`The original page couldn't be opened: ${original}`);

    status("Opening your copy");
    const copy = await renderer.screenshot(`${COPY_ORIGIN}/${page.path}`, width, maxHeight);
    if (typeof copy === "string") throw new CompareError(`Your copy couldn't be opened: ${copy}`);

    status("Comparing");
    const { score, diff } = await renderer.compare(original, copy);
    return {
      page: page.path,
      url: page.url,
      device,
      score,
      original: toDataUrl(original),
      copy: toDataUrl(copy),
      diff,
      originalHeight: original.fullHeight,
      copyHeight: copy.fullHeight,
      truncated: original.fullHeight > original.height || copy.fullHeight > copy.height,
    };
  } finally {
    await renderer.close();
  }
}
