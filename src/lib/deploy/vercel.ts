import { createHash } from "node:crypto";

import { call, callJson, DeployError, wait, type Service } from "@/lib/deploy/http";
import type { DeployRecord } from "@/types/project";

const API = "https://api.vercel.com";
export const VERCEL: Service = { name: "Vercel", setting: "VERCEL_TOKEN" };
const UPLOADS_AT_ONCE = 6;

interface Deployment {
  id: string;
  url: string;
  readyState: string;
  alias?: string[];
  errorMessage?: string;
}

function withTeam(url: string): string {
  const team = process.env.VERCEL_TEAM_ID?.trim();
  return team ? `${url}${url.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : url;
}

/**
 * Uploads each file of the built site (Vercel skips ones it already has), then
 * creates a production deployment of the project `name` and waits until it's live.
 */
export async function deployToVercel(
  token: string,
  name: string,
  files: Record<string, Uint8Array>,
  status: (message: string) => void,
  signal: AbortSignal,
): Promise<DeployRecord> {
  const entries = Object.entries(files).map(([file, data]) => ({
    file,
    data,
    sha: createHash("sha1").update(data).digest("hex"),
    size: data.byteLength,
  }));

  let uploaded = 0;
  status(`Uploading ${entries.length} files to Vercel`);
  for (let start = 0; start < entries.length; start += UPLOADS_AT_ONCE) {
    await Promise.all(
      entries.slice(start, start + UPLOADS_AT_ONCE).map(async (entry) => {
        await call(
          VERCEL,
          withTeam(`${API}/v2/files`),
          {
            token,
            method: "POST",
            headers: {
              "content-type": "application/octet-stream",
              "x-vercel-digest": entry.sha,
              "content-length": String(entry.size),
            },
            body: new Uint8Array(entry.data),
          },
          signal,
        );
        uploaded += 1;
      }),
    );
    status(`Uploading files to Vercel (${uploaded} of ${entries.length})`);
  }

  status("Creating the deployment");
  let deployment = await callJson<Deployment>(
    VERCEL,
    withTeam(`${API}/v13/deployments`),
    {
      token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        target: "production",
        files: entries.map(({ file, sha, size }) => ({ file, sha, size })),
        // A ready-made static site: nothing for Vercel to install or build.
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
      }),
    },
    signal,
  );

  status("Waiting for Vercel to put it live");
  const deadline = Date.now() + 180_000;
  while (deployment.readyState !== "READY") {
    if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
      throw new DeployError(`Vercel couldn't deploy it: ${deployment.errorMessage ?? deployment.readyState.toLowerCase()}`);
    }
    if (Date.now() > deadline) throw new DeployError("Vercel is taking too long. Check the deployment in your Vercel dashboard.");
    await wait(2500, signal);
    deployment = await callJson<Deployment>(VERCEL, withTeam(`${API}/v13/deployments/${deployment.id}`), { token }, signal);
  }

  // The project's own address (name.vercel.app) when Vercel gave one, otherwise this deployment's.
  const host = deployment.alias?.find((alias) => alias.endsWith(".vercel.app")) ?? deployment.alias?.[0] ?? deployment.url;
  return { url: `https://${host}`, deployedAt: new Date().toISOString(), ref: name, adminUrl: `https://vercel.com/dashboard` };
}
