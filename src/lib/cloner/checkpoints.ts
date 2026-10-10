import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  checkpointsDir,
  pathExists,
  resolveInside,
  siteDir,
  touchProject,
} from "@/lib/cloner/storage";
import type { Project, ProjectCheckpoint } from "@/types/project";

const MAX_CHECKPOINTS = 30;
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Records the state of files just before a change touches them, so the whole
 * change (one AI turn, one manual save) can be undone as a unit.
 */
export class ChangeRecorder {
  private readonly projectId: string;
  private readonly label: string;
  private readonly id = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  private readonly modified = new Set<string>();
  private readonly created = new Set<string>();

  constructor(projectId: string, label: string) {
    this.projectId = projectId;
    this.label = label;
  }

  get changedFiles(): string[] {
    return [...this.modified, ...this.created].sort();
  }

  /** Writes a file in the project's site folder, backing up what was there. */
  async write(relativePath: string, content: string | Uint8Array): Promise<void> {
    const root = siteDir(this.projectId);
    const target = resolveInside(root, relativePath);
    if (!target || target === root) throw new Error(`Invalid path: ${relativePath}`);

    const key = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!this.modified.has(key) && !this.created.has(key)) {
      if (await pathExists(target)) {
        const backup = path.join(this.backupRoot(), ...key.split("/"));
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(target, backup);
        this.modified.add(key);
      } else {
        this.created.add(key);
      }
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  /** Deletes a file of the site, keeping a copy so the change can be undone. */
  async remove(relativePath: string): Promise<boolean> {
    const root = siteDir(this.projectId);
    const target = resolveInside(root, relativePath);
    if (!target || target === root) throw new Error(`Invalid path: ${relativePath}`);
    if (!(await pathExists(target))) return false;

    const key = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (this.created.has(key)) {
      // Made and removed within the same change: nothing to restore.
      this.created.delete(key);
    } else if (!this.modified.has(key)) {
      const backup = path.join(this.backupRoot(), ...key.split("/"));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(target, backup);
      this.modified.add(key);
    }
    await fs.rm(target, { force: true });
    return true;
  }

  /** Saves the checkpoint on the project. Returns null if nothing changed. */
  async commit(
    project: Project,
  ): Promise<{ project: Project; checkpoint: ProjectCheckpoint } | null> {
    if (this.modified.size === 0 && this.created.size === 0) return null;

    const checkpoint: ProjectCheckpoint = {
      id: this.id,
      createdAt: new Date().toISOString(),
      label: this.label.slice(0, 200),
      modified: [...this.modified].sort(),
      created: [...this.created].sort(),
    };
    const checkpoints = [...project.checkpoints, checkpoint];
    const dropped = checkpoints.splice(0, Math.max(0, checkpoints.length - MAX_CHECKPOINTS));
    await Promise.all(
      dropped.map((old) =>
        fs.rm(path.join(checkpointsDir(project.id), old.id), { recursive: true, force: true }),
      ),
    );

    const updated = await touchProject({ ...project, checkpoints });
    return { project: updated, checkpoint };
  }

  private backupRoot(): string {
    return path.join(checkpointsDir(this.projectId), this.id);
  }
}

/**
 * Undoes a checkpoint and every change made after it, newest first, and
 * removes them from the project's history.
 */
export async function revertToCheckpoint(
  project: Project,
  checkpointId: string,
): Promise<Project | null> {
  const index = project.checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index === -1) return null;

  const root = siteDir(project.id);
  const toUndo = project.checkpoints.slice(index).reverse();

  for (const checkpoint of toUndo) {
    const backupRoot = path.join(checkpointsDir(project.id), checkpoint.id);
    for (const file of checkpoint.created) {
      const target = resolveInside(root, file);
      if (target) await fs.rm(target, { force: true });
    }
    for (const file of checkpoint.modified) {
      const target = resolveInside(root, file);
      const backup = resolveInside(backupRoot, file);
      if (!target || !backup || !(await pathExists(backup))) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(backup, target);
    }
    await fs.rm(backupRoot, { recursive: true, force: true });
  }

  return touchProject({ ...project, checkpoints: project.checkpoints.slice(0, index) });
}
