import { randomBytes } from "node:crypto";

import { callJson, DeployError, wait, type Service } from "@/lib/deploy/http";
import type { DeployRecord } from "@/types/project";

const API = "https://api.github.com";
export const GITHUB: Service = { name: "GitHub", setting: "GITHUB_TOKEN" };
const BLOBS_AT_ONCE = 6;
/** GitHub refuses files over 100 MB; stay well under. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "content-type": "application/json",
};

interface Repo {
  full_name: string;
  html_url: string;
  default_branch: string;
}

/**
 * Pushes the project's files to a private repository as one commit: a new
 * repository the first time (made with a README so it has a branch to build
 * on), then a new commit on the same branch each time after.
 */
export async function pushToGitHub(
  token: string,
  name: string,
  description: string,
  files: Record<string, Uint8Array>,
  previous: DeployRecord | undefined,
  status: (message: string) => void,
  signal: AbortSignal,
): Promise<DeployRecord> {
  const api = <T>(path: string, init: RequestInit = {}) =>
    callJson<T>(GITHUB, `${API}${path}`, { token, ...init, headers: { ...HEADERS, ...init.headers } }, signal);

  let repo: Repo | null = null;
  if (previous?.ref) {
    status(`Opening ${previous.ref}`);
    repo = await api<Repo>(`/repos/${previous.ref}`).catch((error: unknown) => {
      if (error instanceof DeployError && /not found/i.test(error.message)) return null;
      throw error;
    });
  }
  if (!repo) {
    status("Creating a private repository");
    const create = (repoName: string) =>
      api<Repo>("/user/repos", {
        method: "POST",
        body: JSON.stringify({ name: repoName, description: description.slice(0, 300), private: true, auto_init: true }),
      });
    try {
      repo = await create(name);
    } catch (error) {
      if (!(error instanceof DeployError) || !/already exists|name/i.test(error.message)) throw error;
      repo = await create(`${name}-${randomBytes(2).toString("hex")}`);
    }
  }

  const branch = repo.default_branch || "main";
  // A brand-new repository's first commit can take a moment to appear.
  let head: { object: { sha: string } } | null = null;
  for (let attempt = 0; !head; attempt += 1) {
    try {
      head = await api<{ object: { sha: string } }>(`/repos/${repo.full_name}/git/ref/heads/${branch}`);
    } catch (error) {
      if (attempt >= 5 || !(error instanceof DeployError) || !/not found|empty/i.test(error.message)) throw error;
      await wait(1000, signal);
    }
  }

  const entries = Object.entries(files).filter(([, data]) => data.byteLength <= MAX_FILE_BYTES);
  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  status(`Uploading ${entries.length} files to GitHub`);
  for (let start = 0; start < entries.length; start += BLOBS_AT_ONCE) {
    const batch = await Promise.all(
      entries.slice(start, start + BLOBS_AT_ONCE).map(async ([path, data]) => {
        const blob = await api<{ sha: string }>(`/repos/${repo.full_name}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: Buffer.from(data).toString("base64"), encoding: "base64" }),
        });
        return { path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
      }),
    );
    tree.push(...batch);
    status(`Uploading files to GitHub (${tree.length} of ${entries.length})`);
  }

  status("Making the commit");
  const newTree = await api<{ sha: string }>(`/repos/${repo.full_name}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree }),
  });
  const commit = await api<{ sha: string }>(`/repos/${repo.full_name}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: previous ? `Update ${name} from SiteCloner` : `Add ${name} from SiteCloner`,
      tree: newTree.sha,
      parents: [head.object.sha],
    }),
  });
  await api(`/repos/${repo.full_name}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { url: repo.html_url, deployedAt: new Date().toISOString(), ref: repo.full_name };
}
