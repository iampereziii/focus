import "server-only";

/**
 * Tasks — no longer the backlog.
 *
 * ⚠️ RULE 9 IS RETIRED (ADR-0004, 2026-08-20). It used to read "capture is
 * cheap; starting is gated," and this file's job was to make an un-started Task
 * easy to create. It no longer is: the app has ONE door, and going through it
 * starts a session. The architect keeps their backlog in a different tool, so
 * an un-started Task here was never a parked idea — it was a start that didn't
 * happen, accumulating in the tool that exists to cause starts.
 *
 * `createTask()` below still exists and is still correct — it is what
 * `POST /api/tasks` calls. What changed is that nothing in the UI calls it any
 * more: the ⌘K path goes through `startFocusOnNewTask()` in `./sessions.ts`,
 * which creates the Task and the Session in ONE transaction so a blocked start
 * cannot leave a task behind.
 *
 * The gate itself is unchanged. ADR-0001 said it belongs "at the moment of
 * commitment"; ADR-0004 only corrects when that moment is.
 *
 * ⚠️ THERE IS NO `startedOnly` FILTER HERE, AND THAT IS THE DECISION.
 *
 * The brief proposed re-sourcing `/` to "tasks that have at least one session."
 * Review killed it as a no-op: `0003_task_completion_on_close.sql` moves a
 * finished task to `done`, `Drop` moves it to `dropped`, and after ADR-0004 no
 * task can exist without a session. So `status = 'backlog'` ALREADY means
 * "started and unfinished" — by construction, with no join. Adding one would
 * have put a subquery on `/`'s SSR path to filter a set that stops growing the
 * day this ships. If you are about to add that filter, this is why it isn't
 * here.
 *
 * Tasks captured BEFORE ADR-0004 are the one exception — they have no session
 * and are genuinely un-started. They are retired by
 * `0005_retire_pre_adr_0004_captures.sql`, once, rather than filtered forever.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { toTask } from "./mappers";
import type { Task, TaskStatus } from "@/types/db";

export interface ListTasksFilter {
  topicId?: string;
  status?: TaskStatus;
}

export async function listTasks(filter: ListTasksFilter = {}): Promise<Task[]> {
  let query = supabaseServer().from("tasks").select("*");

  if (filter.topicId !== undefined) query = query.eq("topic_id", filter.topicId);
  if (filter.status !== undefined) query = query.eq("status", filter.status);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const { data, error } = await supabaseServer()
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toTask(data) : null;
}

/**
 * Rule 8: no orphan tasks — `topicId` is required and FK-enforced. The seeded
 * `Inbox` topic is why capture never blocks on classification.
 *
 * Do not add required fields to this signature. Every one costs time on the path
 * the 20-second build gate is measured against.
 */
export async function createTask(input: {
  what: string;
  topicId: string;
}): Promise<Task> {
  const { data, error } = await supabaseServer()
    .from("tasks")
    .insert({ what: input.what.trim(), topic_id: input.topicId, status: "backlog" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return toTask(data);
}

/**
 * Partial update.
 *
 * NOTE Rule 4: editing a Task must NEVER alter an existing Session row. Sessions
 * snapshot `what`/`why`/`finishLine` at start; nothing here writes to `sessions`,
 * and nothing here ever should.
 */
export async function updateTask(
  id: string,
  patch: Partial<{
    what: string;
    why: string | null;
    finishLine: string | null;
    status: TaskStatus;
    estimateMinutes: number | null;
  }>,
): Promise<Task | null> {
  const row: Record<string, unknown> = {};
  if (patch.what !== undefined) row.what = patch.what.trim();
  if (patch.why !== undefined) row.why = patch.why;
  if (patch.finishLine !== undefined) row.finish_line = patch.finishLine;
  if (patch.status !== undefined) {
    row.status = patch.status;
    row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  if (patch.estimateMinutes !== undefined) row.estimate_minutes = patch.estimateMinutes;

  if (Object.keys(row).length === 0) return getTask(id);

  const { data, error } = await supabaseServer()
    .from("tasks")
    .update(row)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toTask(data) : null;
}
