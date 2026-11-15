import "server-only";

/**
 * The day plan — plain-text lines to look at between sessions (Rule 27,
 * ADR-0004 Amendment 1, FOCUS-14).
 *
 * ⚠️ WHAT THIS IS NOT. A plan line is not a Task, links to no Session, and has no
 * status. It can't start work: the gate stays the only door (ADR-0004). It is also
 * not the shelved `DailyPlan` entity — that recorded an AI's ranking; this records
 * the architect's own words in the order written. If a change here wants a
 * `taskId`, a `sessionId`, a status, a count or a reorder, it is reversing the
 * amendment, which needs an ADR and not a commit.
 *
 * THE DB DOES THE ENFORCING. The three rules that keep this from becoming a second
 * backlog are triggers in `0008_plan_lines.sql`, not code in this file: one open
 * plan (27b), written once (27c), and the day ends only when the architect ends it.
 * Their violations surface here as thrown errors containing "Rule 27", which
 * `apiFailure()` maps to a 409. This module therefore does not pre-check them —
 * a check-then-write here would only be a second, racier copy of the trigger.
 *
 * NOTHING HERE IS SCHEDULED. There is no timer, no cron and no sweep that ends a
 * day: `endDay()` runs when the architect presses the button. (Rule 7's spirit,
 * and `guardrails.test.ts` greps `lib/store/` for timers.)
 */

import { supabaseServer } from "@/lib/supabase/server";
import { toPlanLine } from "./mappers";
import type { OpenPlan, PlanLine } from "@/types/db";

/**
 * The open plan: every line with `ended_at` null, in the order written.
 *
 * `0008` guarantees they all share one `plan_date`, so it is read off the first
 * line rather than queried separately. One round trip — this is on `/`'s SSR path.
 * Dropped lines are INCLUDED: crossed-out lines stay visible all day, so the
 * morning plan is still readable in the evening.
 */
export async function listOpenPlan(): Promise<OpenPlan> {
  const { data, error } = await supabaseServer()
    .from("plan_lines")
    .select("*")
    .is("ended_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const lines = (data ?? []).map(toPlanLine);
  return { planDate: lines[0]?.planDate ?? null, lines };
}

/**
 * Add a line. `planDate` is the browser's local date (never this server's clock).
 * A line for a day other than the open plan's is refused by the DB trigger
 * (Rule 27b) and arrives as a thrown "Rule 27b" error.
 */
export async function addPlanLine(input: {
  text: string;
  planDate: string;
}): Promise<PlanLine> {
  const { data, error } = await supabaseServer()
    .from("plan_lines")
    .insert({ text: input.text, plan_date: input.planDate })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return toPlanLine(data);
}

/**
 * Cross a line out. It stays visible; nothing is deleted.
 *
 * Returns `null` for a line that doesn't exist. Dropping an already-dropped line
 * is a no-op that returns it, so a double-tap is harmless; dropping a line that
 * has been ended is refused by the trigger (Rule 27c).
 */
export async function dropPlanLine(id: string): Promise<PlanLine | null> {
  const db = supabaseServer();

  const existing = await db.from("plan_lines").select("*").eq("id", id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) return null;

  const line = toPlanLine(existing.data);
  if (line.droppedAt !== null && line.endedAt === null) return line;

  const { data, error } = await db
    .from("plan_lines")
    .update({ dropped_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return toPlanLine(data);
}

/**
 * END DAY. Ends every open line in ONE statement and returns how many.
 *
 * One statement, not a loop: either the whole plan ends or none of it does, and
 * the plan can never be left half-ended. Idempotent — with nothing open it
 * touches nothing and returns 0, so a second press is harmless.
 *
 * It touches no session and no task. It is not "the day's end" in any sense the
 * app checks: no summary, no score, no side effect. It only closes the list.
 */
export async function endDay(): Promise<number> {
  const { data, error } = await supabaseServer()
    .from("plan_lines")
    .update({ ended_at: new Date().toISOString() })
    .is("ended_at", null)
    .select("id");

  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
