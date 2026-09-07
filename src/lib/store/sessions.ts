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

import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { toSession } from "./mappers";
import { topicForTask } from "./topics";
import type { CheckInInterval, InterruptTag, Session, SessionStatus, Topic } from "@/types/db";

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

/**
 * The one row Rule 1 permits, or null. Drives `/`'s redirect and the shell's
 * active-session indicator.
 *
 * WRAPPED IN REACT'S `cache()`, AND THAT IS NOT THE CACHE ADR-0002 FORBIDS.
 * `(app)/layout.tsx` and `(app)/page.tsx` both need this row, and both used to
 * issue the identical query on the same navigation — two round trips for one
 * answer, on the most-loaded route in the app (brief Finding 5).
 *
 * `cache()` memoises for the duration of ONE server request and is discarded
 * when it ends. It cannot answer a later request, cannot survive a write, cannot
 * be read offline, and holds nothing in the browser — so it removes a duplicate
 * query without introducing anything a subsequent read could go stale against.
 * The thing ADR-0002 rules out is a client-side store that answers reads from
 * memory instead of the network; this never answers a second request at all.
 */
export const activeSession = cache(async function activeSession(): Promise<Session | null> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toSession(data) : null;
});

/**
 * ONE session, plus the row it interrupted and the rows that interrupted it.
 *
 * `/session/[id]` used to answer this by downloading `?limit=100` and scanning
 * the flattened week tree for a single row — so rendering one session cost the
 * whole recent log, and a session older than the most recent 100 was simply
 * unreachable (reactive-UI Risk 4, discharged by this brief's Slice B).
 *
 * The parent and children are what the screen actually needs beyond the row
 * itself: closing an interrupt resumes its parent (Rules 16/17) and both the
 * confirmation and the failure message have to NAME it. Two indexed queries in
 * parallel (`sessions_parent`), not a tree walk.
 */
export async function sessionWithRelations(
  id: string,
): Promise<{
  session: Session;
  parent: Session | null;
  children: Session[];
  /**
   * The topic this session's task belongs to, or `null` for an interrupt.
   *
   * READ ONLY, and for ONE purpose: the scratch pad is tinted with it, so the
   * thinking space is visibly part of the topic being worked in
   * (feature-brief-design-system-pass.md). It is deliberately not the start of a
   * topic-aware session screen — Rule 12 keeps topic to grouping and a dot, and
   * nothing else here should start branching on this.
   */
  topic: Topic | null;
} | null> {
  const session = await getSession(id);
  if (session === null) return null;

  // Three reads in parallel, not sequentially: the topic does not depend on the
  // parent or the children, so adding it costs latency only if it is awaited on
  // its own.
  const [parent, children, topic] = await Promise.all([
    session.parentSessionId === null ? null : getSession(session.parentSessionId),
    childSessions(id),
    session.taskId === null ? null : topicForTask(session.taskId),
  ]);

  return { session, parent, children, topic };
}

/** The interrupts this session suspended for, oldest first. Uses `sessions_parent`. */
async function childSessions(parentId: string): Promise<Session[]> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("*")
    .eq("parent_session_id", parentId)
    .order("started_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toSession);
}

/**
 * Rule 23's pinned rows: sessions given a resume cue that has come due.
 *
 * `/` used to find these by fetching 50 sessions, every check-in belonging to
 * them, grouping the lot into weeks and flattening the tree back out — four
 * steps of work to filter on one column (brief Finding 5). It also meant a cue
 * older than the last 50 sessions quietly stopped being pinned, which is a
 * correctness bug rather than a slow query.
 *
 * NOTE THE `.not(… is null)`: it is not redundant with the `lte` below. The
 * supporting index is PARTIAL — `where resume_planned_at is not null`
 * (0001_init.sql:208) — and Postgres only uses a partial index when the query's
 * predicate implies the index's. Without this line the plan falls back to a
 * sequential scan (brief Risk 4, resolved 2026-08-20).
 */
export async function sessionsPlannedForResume(dueBefore: Date): Promise<Session[]> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("*")
    .not("resume_planned_at", "is", null)
    .lte("resume_planned_at", dueBefore.toISOString())
    .order("resume_planned_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toSession);
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
 *
 * SIGNATURE UNCHANGED BY 0006. The migration added a second write inside the
 * function — the stated WHY / FINISH LINE / interval are also carried onto the
 * `tasks` row, as prefill for the next restart — but it needs no new argument,
 * because it writes back exactly the values already passed in. `startFocusOnNewTask`
 * below inherits it for free by delegating rather than duplicating.
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
 * ADR-0004 — start-on-capture. Create the Task and start the focus Session in
 * ONE transaction.
 *
 * The two-call version of this is not merely slower, it is WRONG: a Rule 1
 * conflict lands on the session call, after the task row is already committed,
 * leaving exactly the never-started backlog row that ADR-0004 exists to make
 * impossible. The decision would leak out through its own error path.
 *
 * Same Rule 1 error string as `startFocusSession`, so both map onto the same
 * 409 in `apiFailure()` with no second branch to keep in sync.
 */
export async function startFocusOnNewTask(input: {
  topicId: string;
  what: string;
  why: string;
  finishLine: string;
  checkInIntervalMinutes: CheckInInterval;
}): Promise<Session> {
  const { data, error } = await supabaseServer().rpc("start_focus_on_new_task", {
    p_topic_id: input.topicId,
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
