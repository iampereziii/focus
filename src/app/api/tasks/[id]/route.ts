import { apiError, apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { updateTask } from "@/lib/store/tasks";
import { updateTaskSchema } from "@/lib/validators";

/**
 * PATCH — partial update (`updateTaskSchema`).
 *
 * Rule 4: editing a Task must NEVER alter an existing Session row. `what`, `why`
 * and `finishLine` are SNAPSHOT onto the Session at start; a later edit here
 * changes the Task and nothing else. That is what makes the log append-only in
 * substance and not just in policy.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = updateTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    const task = await updateTask(id, parsed.data);
    if (task === null) return apiError(404, "not_found", "No such task.");
    return apiOk(task);
  } catch (err) {
    return apiFailure(err);
  }
}
