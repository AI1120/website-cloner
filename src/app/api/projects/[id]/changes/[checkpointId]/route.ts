import { checkpointChanges } from "@/lib/cloner/checkpoints";
import { jsonError } from "@/lib/cloner/http";
import { readProject } from "@/lib/cloner/storage";

type Context = { params: Promise<{ id: string; checkpointId: string }> };

/** The files one change touched, each compared before and after it. */
export async function GET(_request: Request, { params }: Context) {
  const { id, checkpointId } = await params;
  const project = await readProject(id);
  if (!project) return jsonError("Project not found.", 404);

  const checkpoint = project.checkpoints.find((item) => item.id === checkpointId);
  const files = checkpoint ? await checkpointChanges(project, checkpointId) : null;
  if (!checkpoint || !files) {
    return jsonError("This change was undone or is too old to show.", 404);
  }
  return Response.json({ checkpoint, files });
}
