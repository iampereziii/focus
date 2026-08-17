import "server-only";

/**
 * Sessions — THE LOG. This module holds the highest-risk code in the app.
 *
 * Every multi-step path delegates to a plpgsql function in
 * supabase/migrations/0002_session_transactions.sql, because supabase-js has no
 * multi-statement transaction and Rules 16, 18 and 23 all require one in so many
 * words. A partial failure that leaves zero or two `active` rows violates Rule 1.
 *
 * WHAT IS NOT HERE, AND NEVER WILL BE:
 *   - a delete path (Rule 14 — the log is append-only; the migration grants no
 *     delete policy, so it is impossible rather than merely forbidden)
 *   - anything that closes a session the architect did not close: no timeout, no
 *     cron, no cleanup job, no "stale session" sweep (Rule 7, Convention #9)
 *   - derived numbers. Focused time and the day split are computed in
 *     `lib/facts/`, which is pure. `store` fetches rows; `facts` derives.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { toSession } from "./mappers";
import type { CheckInInterval, InterruptTag, Session, SessionStatus } from "@/types/db";

type Row = Record<string, unknown>;

/** Unwraps an rpc() result that returns a single `sessions` row. */
function oneSession(data: unknown, error: { message: string } | null): Session {
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? (data[0] as Row) : (data as Row);
  if (!row) throw new Error("Expected a session row from the transaction");
  return toSession(row);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toSession(data) : null;
}

/** The one row Rule 1 permits, or null. Drives `/`'s redirect. */
export async function activeSession(): Promise<Session | null> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toSession(data) : null;
}

/**
 * The log, newest first, PAGINATED — never the full history (Rule 11 / the
 * under-2-minutes half of the build gate). Callers group by week; the parent/child
 * tree is assembled in `lib/facts/`, not here.
 */
export async function listSessionsPage(limit: number, before?: string): Promise<Session[]> {
  let query = supabaseServer()
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (before !== undefined) query = query.lt("started_at", before);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSession);
}

// ── Writes: the gate ──────────────────────────────────────────────────────────

/**
 * Rule 1 + Rules 2/3/4. Returns 409 (via `apiFailure`) when another session is
 * active — the NFR requires the UI to name WHICH session is blocking, with a link
 * to close it, so this never silently closes anything. The switch is then recorded
 * as `switched` by a deliberate act (Rule 6).
 */
export async function startFocusSession(input: {
  taskId: string;
  what: string;
  why: string;
  finishLine: string;
  checkInIntervalMinutes: CheckInInterval;
}): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("start_focus_session", {
    p_task_id: input.taskId,
    p_what: input.what,
    p_why: input.why,
    p_finish_line: input.finishLine,
    p_interval: input.checkInIntervalMinutes,
  });
  return oneSession(data, error);
}

/**
 * Rules 16, 17, 19, 26f — one transaction: suspend the parent, start the child,
 * inherit the check-in interval. A parentless `pulled` is valid (Rule 19) and
 * gets a null interval.
 */
export async function suspendAndStartInterrupt(input: {
  kind: "pulled" | "filler";
  what: string;
  interruptTag: InterruptTag | null;
  parentSessionId: string | null;
  waitMinutes: number | null;
}): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("suspend_and_start_interrupt", {
    p_kind: input.kind,
    p_what: input.what,
    p_interrupt_tag: input.interruptTag,
    p_parent_id: input.parentSessionId,
    p_wait_minutes: input.waitMinutes,
  });
  return oneSession(data, error);
}

/** Rule 5 — 409 on any edit to a closed session, including the outcome note. */
export async function closeSession(
  id: string,
  status: SessionStatus,
  outcomeNote: string | null,
): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("close_session", {
    p_session_id: id,
    p_status: status,
    p_outcome_note: outcomeNote,
  });
  return oneSession(data, error);
}

/** Rules 16/17/26g — settle the child, reactivate the parent, reset the probe clock. */
export async function resumeSession(
  parentId: string,
  childStatus: SessionStatus = "partial",
  childNote: string | null = null,
): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("resume_session", {
    p_parent_id: parentId,
    p_child_status: childStatus,
    p_child_note: childNote,
  });
  return oneSession(data, error);
}

/** Rule 18 — 409 on the 4th. The UI presents a forced disposition, never an auto-close. */
export async function rearmFiller(id: string, waitMinutes: number): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("rearm_filler", {
    p_session_id: id,
    p_wait_minutes: waitMinutes,
  });
  return oneSession(data, error);
}

/** Gap 26 — closes the filler and INSERTS a new focus row. No `kind` is mutated. */
export async function promoteFiller(input: {
  fillerId: string;
  why: string;
  finishLine: string;
  checkInIntervalMinutes: CheckInInterval;
  grandparentStatus: "partial" | "abandoned";
  topicId?: string;
}): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("promote_filler", {
    p_filler_id: input.fillerId,
    p_why: input.why,
    p_finish_line: input.finishLine,
    p_interval: input.checkInIntervalMinutes,
    p_grandparent_status: input.grandparentStatus,
    p_topic_id: input.topicId ?? null,
  });
  return oneSession(data, error);
}

/** Bumps the Rule 26 probe clock. App interaction, not OS activity. */
export async function touchSession(id: string): Promise<void> {
  const { error } = await supabaseServer()
    .from("sessions")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", id)
    .is("ended_at", null);

  if (error) throw new Error(error.message);
}
