import { servePreview } from "@/lib/build/serve";
import { PageRenderer } from "@/lib/cloner/browser";
import { getTable, listRows } from "@/lib/data/store";
import type { Project } from "@/types/project";

/**
 * Opens a project's pages in the cloning browser to see whether they work: the
 * check that runs after the AI changes a project.
 */

const CHECK_ORIGIN = "https://check.sitecloner.invalid";
const MAX_PAGES = 3;

interface LocalResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

const DATA_API = /^\/api\/data\/([^/]+)\/([^/]+)\/?$/;

function json(status: number, value: unknown): LocalResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: Buffer.from(JSON.stringify(value)),
  };
}

/**
 * Answers the browser's request for one of a project's files, as the preview
 * would. The preview's own extras are stood in for: the editor bridge is an empty
 * script, and the data API reads rows (writes are acknowledged, never stored).
 */
export async function serveProjectFile(project: Project, url: URL, method = "GET"): Promise<LocalResponse> {
  if (url.pathname === "/sc-bridge.js") {
    return { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: Buffer.alloc(0) };
  }

  const data = DATA_API.exec(url.pathname);
  if (data) {
    const [, id, name] = data.map((part) => decodeURIComponent(part));
    if (id !== project.id) return json(404, { error: "Table not found." });
    if (method !== "GET") return { status: 204, headers: {}, body: Buffer.alloc(0) };
    const table = await getTable(project.id, name);
    if (!table) return json(404, { error: "Table not found." });
    if (table.access.read !== "everyone") return json(403, { error: "This table can't be read by apps." });
    return json(200, await listRows(project.id, table.name, { limit: 100 }));
  }

  const segments = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const response = await servePreview(new Request(url.href), project, segments);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

export interface PageProblems {
  page: string;
  problems: string[];
}

/**
 * Loads up to three of `pages` in a browser and returns the ones with problems,
 * or null when there is no browser to check with.
 */
export async function findPageProblems(
  project: Project,
  pages: string[],
  signal: AbortSignal,
): Promise<PageProblems[] | null> {
  const renderer = await PageRenderer.open(signal);
  if (!renderer) return null;
  try {
    renderer.serveLocally(CHECK_ORIGIN, (url, method) => serveProjectFile(project, url, method));
    const found: PageProblems[] = [];
    for (const page of [...new Set(pages)].slice(0, MAX_PAGES)) {
      if (signal.aborted) break;
      const problems = await renderer.diagnose(`${CHECK_ORIGIN}/${page}`, (pathname) => DATA_API.test(pathname));
      if (typeof problems === "string") {
        found.push({ page, problems: [problems] });
      } else if (problems.length > 0) {
        found.push({ page, problems });
      }
    }
    return found;
  } finally {
    await renderer.close();
  }
}

/** The problems, written for the AI to act on. */
export function describePageProblems(found: PageProblems[]): string {
  return found
    .map(({ page, problems }) => [`${page}:`, ...problems.map((problem) => `- ${problem}`)].join("\n"))
    .join("\n\n");
}
