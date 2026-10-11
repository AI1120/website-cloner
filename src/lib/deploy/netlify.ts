import { zipFiles } from "@/lib/cloner/zip";
import { call, callJson, DeployError, wait, type Service } from "@/lib/deploy/http";
import type { DeployRecord } from "@/types/project";

const API = "https://api.netlify.com/api/v1";
export const NETLIFY: Service = { name: "Netlify", setting: "NETLIFY_TOKEN" };

interface Site {
  id: string;
  ssl_url?: string;
  url?: string;
  admin_url?: string;
}

interface Deploy {
  id: string;
  state: string;
  error_message?: string | null;
  ssl_url?: string;
}

/** The site to deploy to: the one used before, or a new one. */
async function siteFor(token: string, name: string, previous: DeployRecord | undefined, signal: AbortSignal): Promise<Site> {
  if (previous?.ref) {
    const response = await fetch(`${API}/sites/${encodeURIComponent(previous.ref)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    }).catch(() => null);
    if (response?.ok) return (await response.json()) as Site;
    // Deleted on Netlify's side (404): make a new one below.
    if (response && response.status !== 404) await call(NETLIFY, `${API}/sites/${previous.ref}`, { token }, signal);
  }
  const create = (body: Record<string, string>) =>
    callJson<Site>(
      NETLIFY,
      `${API}/sites`,
      { token, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      signal,
    );
  try {
    return await create({ name });
  } catch (error) {
    // The name is taken: let Netlify pick one.
    if (error instanceof DeployError && /name|subdomain|taken|unique/i.test(error.message)) return create({});
    throw error;
  }
}

/** Uploads the built site as a ZIP and waits until Netlify says it's live. */
export async function deployToNetlify(
  token: string,
  name: string,
  files: Record<string, Uint8Array>,
  previous: DeployRecord | undefined,
  status: (message: string) => void,
  signal: AbortSignal,
): Promise<DeployRecord> {
  status("Finding your Netlify site");
  const site = await siteFor(token, name, previous, signal);

  status("Uploading the site to Netlify");
  const archive = zipFiles(files);
  let deploy = await callJson<Deploy>(
    NETLIFY,
    `${API}/sites/${site.id}/deploys`,
    { token, method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(archive) },
    signal,
  );

  status("Waiting for Netlify to put it live");
  const deadline = Date.now() + 120_000;
  while (deploy.state !== "ready") {
    if (deploy.state === "error") throw new DeployError(`Netlify couldn't deploy it: ${deploy.error_message ?? "unknown error"}`);
    if (Date.now() > deadline) throw new DeployError("Netlify is taking too long. Check the deploy in your Netlify dashboard.");
    await wait(2000, signal);
    deploy = await callJson<Deploy>(NETLIFY, `${API}/deploys/${deploy.id}`, { token }, signal);
  }

  return {
    url: site.ssl_url ?? site.url ?? deploy.ssl_url ?? "",
    deployedAt: new Date().toISOString(),
    ref: site.id,
    adminUrl: site.admin_url,
  };
}
