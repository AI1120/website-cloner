import fs from "node:fs/promises";
import path from "node:path";

import { isTextFile } from "@/lib/cloner/mime";
import type { Project, ProjectFile } from "@/types/project";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** Folder that holds every project. Override with CLONER_DATA_DIR. */
function dataRoot(): string {
  const configured = process.env.CLONER_DATA_DIR;
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".clones");
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function projectDir(id: string): string {
  if (!isValidId(id)) throw new Error("Invalid project id.");
  return path.join(dataRoot(), id);
}

/** The editable working copy of the cloned site. */
export function siteDir(id: string): string {
  return path.join(projectDir(id), "site");
}

/** The snapshot served at the public link. */
export function publishedDir(id: string): string {
  return path.join(projectDir(id), "published");
}

export function checkpointsDir(id: string): string {
  return path.join(projectDir(id), "checkpoints");
}

/** Generated output of projects that need a build step (bundles, compiled CSS status). */
export function buildDir(id: string): string {
  return path.join(projectDir(id), "build");
}

/** Files the person attached to messages. They are not part of the site. */
export function uploadsDir(id: string): string {
  return path.join(projectDir(id), "uploads");
}

/** The design system text the project follows, if it has one. */
export function designSystemPath(id: string): string {
  return path.join(projectDir(id), "design.md");
}

function metaPath(id: string): string {
  return path.join(projectDir(id), "meta.json");
}

/**
 * Resolves a path requested by a client against a root folder. Returns null
 * if it would escape the root or uses characters that have no place in a path.
 */
export function resolveInside(root: string, relativePath: string): string | null {
  if (relativePath.includes("\0")) return null;
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === "..")) return null;
  const resolved = path.resolve(root, normalized);
  const rootWithSeparator = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved === root || resolved.startsWith(rootWithSeparator) ? resolved : null;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");

  // On Windows a virus scanner or indexer can briefly hold a just-written
  // file, which makes the rename fail; a short retry gets past it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retryable || attempt >= 5) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, value);
}

/** Fills in fields that projects saved by older versions of the app don't have. */
function normalizeProject(stored: Project): Project {
  return {
    ...stored,
    source: stored.source ?? "clone",
    framework: stored.framework ?? "html",
    styling: stored.styling ?? "original",
    uiLibrary: stored.uiLibrary ?? "none",
    designSystem: stored.designSystem ?? null,
    pending: stored.pending ?? false,
  };
}

export async function readProject(id: string): Promise<Project | null> {
  if (!isValidId(id)) return null;
  const stored = await readJson<Project>(metaPath(id));
  return stored ? normalizeProject(stored) : null;
}

export async function writeProject(project: Project): Promise<void> {
  await writeJson(metaPath(project.id), project);
}

/** Saves the project with a fresh `updatedAt` and returns the saved value. */
export async function touchProject(project: Project): Promise<Project> {
  const updated: Project = { ...project, updatedAt: new Date().toISOString() };
  await writeProject(updated);
  return updated;
}

export async function listProjects(): Promise<Project[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dataRoot());
  } catch {
    return [];
  }
  const projects = await Promise.all(
    entries.filter(isValidId).map((id) => readProject(id)),
  );
  return projects
    .filter((project): project is Project => project !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Removes a file or folder. On Windows a scanner or indexer can briefly hold
 * files that were just written, so the removal is retried for a moment.
 */
export async function remove(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

export async function deleteProject(id: string): Promise<void> {
  await remove(projectDir(id));
}

/** Every file under a folder, with forward-slash paths relative to it. */
export async function listFiles(root: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];

  const walk = async (directory: string, prefix: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute, relative);
        } else if (entry.isFile()) {
          const stats = await fs.stat(absolute);
          files.push({ path: relative, size: stats.size, text: isTextFile(relative) });
        }
      }),
    );
  };

  await walk(root, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function copyDirectory(from: string, to: string): Promise<void> {
  await remove(to);
  await fs.cp(from, to, { recursive: true });
}
