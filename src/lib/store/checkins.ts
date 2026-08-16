import "server-only";

/**
 * Check-ins — Rule 26's probe. ONE ROW PER PROMPT, ANSWERED OR NOT (26e).
 *
 * This is the honest-number machinery. An unanswered row marks `promptedAt` → the
 * next answer (or session close) as an `unaccounted` window that Rule 22 subtracts
 * from focused time and Rule 24 buckets. Answered check-ins subtract nothing —
 * they are the positive signal.
 *
 * 26b, and it is the line that keeps this from becoming surveillance: THE APP
 * NEVER ACTS ON SILENCE, BUT IT DOES STOP CREDITING IT. Nothing here changes a
 * session's status, closes anything, or classifies anything on the architect's
 * behalf. It changes a derived figure at review, where it is displayed as a bare
 * fact and carries the same optional, never-forced reclassification as Rule 21.
 *
 * Research backing (spec Research Notes): thought probes are the standard
 * instrument for catching off-task episodes self-report misses, because people are
 * meta-aware of only a small proportion of their own. Probes also do NOT suppress
 * self-catching, which is why the interrupt tap keeps its `drift` cell — the three
 * capture paths are additive, not redundant.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { toCheckIn } from "./mappers";
import type { CheckIn, CheckInAnswer } from "@/types/db";

type Row = Record<string, unknown>;

function oneCheckIn(data: unknown, error: { message: string } | null): CheckIn {
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? (data[0] as Row) : (data as Row);
  if (!row) throw new Error("Expected a check_in row");
  return toCheckIn(row);
}

/** Every prompt is recorded at the moment it fires — before any answer exists. */
export async function recordPrompt(sessionId: string): Promise<CheckIn> {
  const { data, error } = await supabaseServer().rpc("record_check_in", {
    p_session_id: sessionId,
  });
  return oneCheckIn(data, error);
}

/**
 * Yes / Done / I drifted.
 *
 * This writes the answer and re-arms the probe clock. It does NOT close or
 * reclassify the session: `done` and `drifted` route to close-out through the
 * normal `closeSession` path, by an explicit act. Keeping that separation is what
 * makes 26b true in the code and not only in the doc.
 */
export async function recordAnswer(
  checkInId: string,
  answer: CheckInAnswer,
): Promise<CheckIn> {
  const { data, error } = await supabaseServer().rpc("answer_check_in", {
    p_check_in_id: checkInId,
    p_answer: answer,
  });
  return oneCheckIn(data, error);
}

export async function checkInsForSessions(sessionIds: readonly string[]): Promise<CheckIn[]> {
  if (sessionIds.length === 0) return [];

  const { data, error } = await supabaseServer()
    .from("check_ins")
    .select("*")
    .in("session_id", sessionIds as string[])
    .order("prompted_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toCheckIn);
}

/**
 * Sessions whose probe is due: `active`, an interval set, and silent for at least
 * that long — with no unanswered prompt already outstanding (asking twice about
 * the same silence would double-count the window and train the prompt to be
 * ignored).
 *
 * A session with the interval `off` is absent from this list by construction. It
 * generates no rows and gets no subtraction, so its focused time reads high — the
 * visible cost of a choice made at the gate, not a defect.
 */
export async function sessionsDueForCheckIn(now: Date): Promise<string[]> {
  const { data, error } = await supabaseServer()
    .from("sessions")
    .select("id, check_in_interval_minutes, last_interaction_at")
    .eq("status", "active")
    .not("check_in_interval_minutes", "is", null);

  if (error) throw new Error(error.message);

  const candidates = (data ?? []).filter((row) => {
    const interval = Number(row.check_in_interval_minutes);
    const last = Date.parse(String(row.last_interaction_at));
    return now.getTime() - last >= interval * 60_000;
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((row) => String(row.id));
  const outstanding = await supabaseServer()
    .from("check_ins")
    .select("session_id")
    .in("session_id", ids)
    .is("answered_at", null);

  if (outstanding.error) throw new Error(outstanding.error.message);
  const blocked = new Set((outstanding.data ?? []).map((r) => String(r.session_id)));
  return ids.filter((id) => !blocked.has(id));
}
