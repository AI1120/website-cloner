import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { serveProjectFile } from "@/lib/build/page-check";
import { PageRenderer, type Screenshot } from "@/lib/cloner/browser";
import { revertToCheckpoint } from "@/lib/cloner/checkpoints";
import {
  checkpointsDir,
  deleteProject,
  pathExists,
  projectDir,
  siteDir,
  SNAPSHOT_PREFIX,
  writeProject,
} from "@/lib/cloner/storage";
import type { Project } from "@/types/project";

/**
 * Pictures of a page before and after one change: the "Visual" view of "What
 * changed". The earlier state is rebuilt in a temporary copy of the project,
 * rolled back with the same code as History's undo, so the project itself is
 * never touched.
 */

const CHANGE_ORIGIN = "https://change.sitecloner.invalid";
const WIDTH = 1440;
const MAX_HEIGHT = 4000;

export class ChangeViewError extends Error {}

export interface ChangePictures {
  page: string;
  /** JPEG data URLs; `before` is null when the page didn't exist before the change. */
  before: string | null;
  after: string;
  /** The "after" picture with what differs from "before" marked. */
  diff: string | null;
  /** How much of the page looks different, 0–100. */
  changed: number;
}

/** A temporary copy of the project as it was just before `checkpointId`. */
async function snapshotBefore(project: Project, checkpointId: string): Promise<Project> {
  const id = `${SNAPSHOT_PREFIX}${randomBytes(6).toString("hex")}`;
  await fs.mkdir(projectDir(id), { recursive: true });
  await fs.cp(siteDir(project.id), siteDir(id), { recursive: true });
  if (await pathExists(checkpointsDir(project.id))) {
    await fs.cp(checkpointsDir(project.id), checkpointsDir(id), { recursive: true });
  }
  const data = path.join(projectDir(project.id), "data");
  if (await pathExists(data)) await fs.cp(data, path.join(projectDir(id), "data"), { recursive: true });
  const copy: Project = { ...project, id, published: null, share: undefined, pending: false };
  await writeProject(copy);
  return (await revertToCheckpoint(copy, checkpointId)) ?? copy;
}

const toUrl = (shot: Screenshot) => `data:image/jpeg;base64,${shot.image.toString("base64")}`;

export async function pictureChange(
  project: Project,
  checkpointId: string,
  page: string,
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<ChangePictures> {
  const index = project.checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index === -1) throw new ChangeViewError("That change can no longer be shown; it may have been undone.");
  const next = project.checkpoints[index + 1];

  status("Starting a browser");
  const renderer = await PageRenderer.open(signal);
  if (!renderer) throw new ChangeViewError("Pictures of a change need Chrome or Edge on the machine running the app.");
  const temporary: Project[] = [];
  try {
    status("Rebuilding the page as it was before");
    const before = await snapshotBefore(project, checkpointId);
    temporary.push(before);
    const after = next ? await snapshotBefore(project, next.id) : project;
    if (next) temporary.push(after);

    let showing = before;
    renderer.serveLocally(CHANGE_ORIGIN, (url, method) => serveProjectFile(showing, url, method));
    const shoot = async (state: Project) => {
      showing = state;
      return renderer.screenshot(`${CHANGE_ORIGIN}/${page}`, WIDTH, MAX_HEIGHT);
    };

    status("Photographing it before the change");
    const beforeShot = await shoot(before);
    status("Photographing it after the change");
    const afterShot = await shoot(after);
    if (typeof afterShot === "string") throw new ChangeViewError(`The page couldn't be shown after the change: ${afterShot}`);
    if (typeof beforeShot === "string") {
      return { page, before: null, after: toUrl(afterShot), diff: null, changed: 100 };
    }
    status("Comparing");
    const { score, diff } = await renderer.compare(beforeShot, afterShot);
    return {
      page,
      before: toUrl(beforeShot),
      after: toUrl(afterShot),
      diff,
      changed: Math.max(0, Math.round((100 - score) * 10) / 10),
    };
  } finally {
    await renderer.close();
    for (const copy of temporary) await deleteProject(copy.id).catch(() => undefined);
  }
}
