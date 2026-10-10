import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { isTextFile } from "@/lib/cloner/mime";
import {
  checkpointsDir,
  pathExists,
  resolveInside,
  siteDir,
  touchProject,
} from "@/lib/cloner/storage";
import { diffLines } from "@/lib/diff";
import type { FileChange, Project, ProjectCheckpoint } from "@/types/project";

const MAX_CHECKPOINTS = 30;
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
/** Larger files are listed as changed without a line-by-line comparison. */
const MAX_DIFF_BYTES = 1024 * 1024;

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

/** A file's state at some point: missing, present, and its text when it can be compared. */
interface FileState {
  exists: boolean;
  text: string | null;
}

async function readState(file: string | null, relativePath: string): Promise<FileState> {
  if (!file) return { exists: false, text: null };
  try {
    const stats = await fs.stat(file);
    if (!stats.isFile()) return { exists: false, text: null };
    const comparable = isTextFile(relativePath) && stats.size <= MAX_DIFF_BYTES;
    return { exists: true, text: comparable ? await fs.readFile(file, "utf8") : null };
  } catch {
    return { exists: false, text: null };
  }
}

function backupFile(projectId: string, checkpointId: string, relativePath: string): string | null {
  return resolveInside(path.join(checkpointsDir(projectId), checkpointId), relativePath);
}

/**
 * What one checkpoint changed, file by file. The state before the change is the
 * checkpoint's own backup. The state after it is the backup taken by the next
 * change that touched the file, or the working copy if nothing has since.
 * Returns null when the checkpoint has been undone or dropped.
 */
export async function checkpointChanges(
  project: Project,
  checkpointId: string,
): Promise<FileChange[] | null> {
  const index = project.checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index === -1) return null;
  const checkpoint = project.checkpoints[index];
  const later = project.checkpoints.slice(index + 1);
  const modified = new Set(checkpoint.modified);

  const stateAfter = (relativePath: string): Promise<FileState> => {
    for (const next of later) {
      if (next.modified.includes(relativePath)) {
        return readState(backupFile(project.id, next.id, relativePath), relativePath);
      }
      // Created by a later change, so it didn't exist after this one.
      if (next.created.includes(relativePath)) return Promise.resolve({ exists: false, text: null });
    }
    return readState(resolveInside(siteDir(project.id), relativePath), relativePath);
  };

  const files = [...checkpoint.modified, ...checkpoint.created].sort();
  return Promise.all(
    files.map(async (relativePath): Promise<FileChange> => {
      const before: FileState = modified.has(relativePath)
        ? await readState(backupFile(project.id, checkpoint.id, relativePath), relativePath)
        : { exists: false, text: null };
      const after = await stateAfter(relativePath);
      const status = !before.exists ? "added" : after.exists ? "modified" : "removed";
      const change = { path: relativePath, status, added: 0, removed: 0 } as const;

      if (!isTextFile(relativePath)) {
        return { ...change, hunks: null, note: "This file isn't text, so it can't be compared line by line." };
      }
      if ((before.exists && before.text === null) || (after.exists && after.text === null)) {
        return { ...change, hunks: null, note: "This file is too large to compare." };
      }
      if (status === "added" && !after.exists) {
        return { ...change, hunks: null, note: "This file was removed again by a later change." };
      }
      const { hunks, added, removed, truncated } = diffLines(before.text ?? "", after.text ?? "");
      return {
        ...change,
        hunks,
        added,
        removed,
        ...(truncated ? { note: "Only the first part of this change is shown." } : {}),
      };
    }),
  );
}
