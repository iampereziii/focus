import "server-only";

/**
 * Tasks — the backlog.
 *
 * Rule 9: CAPTURE IS CHEAP. Creating a Task requires only `what` + `topicId`.
 * `why` and `finishLine` are collected at the GATE (session start), not here.
 * That is the rule reconciling frictionless capture with ADR-0001's hard gate —
 * the gate belongs at the moment of commitment, not the moment of the idea.
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
