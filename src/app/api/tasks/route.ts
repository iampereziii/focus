import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { createTask, listTasks } from "@/lib/store/tasks";
import { createTaskSchema } from "@/lib/validators";
import type { TaskStatus } from "@/types/db";

const TASK_STATUSES: readonly TaskStatus[] = ["backlog", "today", "done", "dropped"];

/** GET — list tasks, filterable by topic + status. */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const url = new URL(req.url);
  const topicId = url.searchParams.get("topicId") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam !== null && (TASK_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as TaskStatus)
      : undefined;

  try {
    return apiOk(await listTasks({ topicId, status }));
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * POST — create a task. ONLY `what` + `topicId` required (`createTaskSchema`).
 *
 * Rule 9: CAPTURE IS CHEAP; STARTING IS GATED. `why` and `finishLine` are
 * collected at session start, not here — the gate belongs at the moment of
 * commitment, not the moment of the idea.
 *
 * DO NOT ADD REQUIRED FIELDS. The whole project exists because a
 * higher-friction version of this protocol was abandoned the day it was written.
 *
 * Rule 8: no orphan tasks. `topicId` is required; the seeded `Inbox` topic is
 * why capture never blocks on classification.
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = createTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await createTask(parsed.data), 201);
  } catch (err) {
    return apiFailure(err);
  }
}
