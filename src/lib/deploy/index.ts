import { BuildFailedError, describeBuildErrors, readBuiltSite } from "@/lib/build";
import { readProject, siteDir, touchProject } from "@/lib/cloner/storage";
import { slugify } from "@/lib/cloner/urls";
import { readDirectory } from "@/lib/cloner/zip";
import { pushToGitHub } from "@/lib/deploy/github";
import { DeployError } from "@/lib/deploy/http";
import { deployToNetlify } from "@/lib/deploy/netlify";
import { deployToVercel } from "@/lib/deploy/vercel";
import type { DeployTarget, Project } from "@/types/project";

export { DeployError } from "@/lib/deploy/http";

/**
 * Deploying a project to Netlify or Vercel (its finished static site, the same
 * files publishing serves) or pushing its source to GitHub, with the person's
 * own tokens from .env.local. Tokens stay on the server.
 */

const TOKENS: Record<DeployTarget, string[]> = {
  netlify: ["NETLIFY_TOKEN", "NETLIFY_AUTH_TOKEN"],
  vercel: ["VERCEL_TOKEN"],
  github: ["GITHUB_TOKEN"],
};

function token(target: DeployTarget): string | null {
  for (const name of TOKENS[target]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** Which services have a token set. */
export function deployTargets(): Record<DeployTarget, boolean> {
  return { netlify: token("netlify") !== null, vercel: token("vercel") !== null, github: token("github") !== null };
}

function readme(project: Project): string {
  const run =
    project.framework === "react"
      ? "```bash\nnpm install\nnpm run dev\n```\n"
      : "Open `index.html` in a browser, or serve the folder with any static file server.\n";
  const source = project.finalUrl ? `\nCopied from ${project.finalUrl}.\n` : "";
  return `# ${project.name}\n\nMade with SiteCloner.${source}\n## Running it\n\n${run}`;
}

/** The files for a target: the built site for hosts, the source for GitHub. */
async function filesFor(project: Project, target: DeployTarget): Promise<Record<string, Uint8Array>> {
  if (target === "github") {
    const files = await readDirectory(siteDir(project.id));
    if (!Object.keys(files).some((file) => file.toLowerCase() === "readme.md")) {
      files["README.md"] = new TextEncoder().encode(readme(project));
    }
    return files;
  }
  try {
    return await readBuiltSite(project);
  } catch (error) {
    if (error instanceof BuildFailedError) {
      throw new DeployError(`The project doesn't build, so it can't be deployed yet. ${describeBuildErrors(error.errors).slice(0, 300)}`);
    }
    throw error;
  }
}

export async function deployProject(
  project: Project,
  target: DeployTarget,
  status: (message: string) => void,
  signal: AbortSignal,
): Promise<{ project: Project; url: string }> {
  const secret = token(target);
  if (!secret) throw new DeployError(`Add ${TOKENS[target][0]} to .env.local and restart the app to deploy there.`);

  status(target === "github" ? "Collecting the project's files" : "Building the site");
  const files = await filesFor(project, target);
  if (Object.keys(files).length === 0) throw new DeployError("The project has no files to deploy.");

  const name = slugify(project.name, 40) || slugify(project.id, 40) || "sitecloner-site";
  const previous = project.deployments?.[target];
  const record =
    target === "netlify"
      ? await deployToNetlify(secret, name, files, previous, status, signal)
      : target === "vercel"
        ? await deployToVercel(secret, name, files, status, signal)
        : await pushToGitHub(secret, name, `${project.name} — made with SiteCloner`, files, previous, status, signal);

  // Read again: the project may have changed while this ran.
  const latest = (await readProject(project.id)) ?? project;
  const updated = await touchProject({ ...latest, deployments: { ...latest.deployments, [target]: record } });
  return { project: updated, url: record.url };
}
