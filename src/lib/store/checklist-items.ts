import "server-only";

/**
 * The in-session scratchpad (feature-brief-session-scratchpad-checklist.md).
 *
 * Freeform lines you add and tick while a session runs, so mid-task sub-steps and
 * "where I left off" don't have to be held in memory or squeezed into the one
 * closing `outcomeNote`.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT:
 *
 * 1. RULE 6, SCOPED. Closed sessions are immutable, checklist included. But Rule 6
 *    governs the RECORD OF WORK DONE, not the surface used to do it — so while a
 *    session is `active` an item can be edited and even deleted, because erasing a
 *    line you no longer need is wiping a whiteboard, not rewriting history. The
 *    freeze is enforced by a DB trigger (0008_checklist_items.sql), not here; this
 *    file just surfaces the violation as a clean 409 instead of a 500.
 *
 * 2. RULE 26, DEFERRED NOT SILENCED. Every write bumps `last_interaction_at` via
 *    `touchSession()`, because the spec defines that field as "app interaction",
 *    and ticking an item is stronger evidence of being on-task than answering
 *    "yes" to a prompt. But NOTHING HERE TOUCHES `answered_at` on an open
 *    `CheckIn`. An unanswered prompt still opens the unaccounted window Rule 22
 *    subtracts. You can defer the probe by working; you cannot silence it by
 *    working. That asymmetry is the honest-number machinery and it is deliberate.
 *
 * `touchSession()` had ZERO callers before this feature — it shipped with the
 * Rule 26 work and was never wired, the same dead-write-path class as `resume` and
 * `promote` (feature-brief-resume-parent-on-interrupt-close.md). This is its first.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { toChecklistItem } from "./mappers";
import { touchSession } from "./sessions";
import type { ChecklistItem } from "@/types/db";

type Row = Record<string, unknown>;

function oneItem(data: unknown, error: { message: string } | null): ChecklistItem {
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? (data[0] as Row) : (data as Row);
  if (!row) throw new Error("Expected a checklist_item row");
  return toChecklistItem(row);
}

/**
 * This session's items, oldest first — append order, which is the whole ordering
 * model. There is no `position` column and no reordering: a scratchpad reads
 * chronologically, and the sequence you thought of things in is itself the signal.
 */
export async function checklistItemsFor(sessionId: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabaseServer()
    .from("checklist_items")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toChecklistItem(row as Row));
}

export async function createChecklistItem(
  sessionId: string,
  text: string,
): Promise<ChecklistItem> {
  const { data, error } = await supabaseServer()
    .from("checklist_items")
    .insert({ session_id: sessionId, text })
    .select()
    .single();

  const item = oneItem(data, error);
  await touchSession(sessionId);
  return item;
}

/**
 * Toggle, retitle, or both. `updated_at` is set by the trigger, not here — one
 * writer for it, so a hand-written update can't drift from a trigger-written one.
 */
export async function updateChecklistItem(
  itemId: string,
  patch: { text?: string; done?: boolean },
): Promise<ChecklistItem> {
  const { data, error } = await supabaseServer()
    .from("checklist_items")
    .update(patch)
    .eq("id", itemId)
    .select()
    .single();

  const item = oneItem(data, error);
  await touchSession(item.sessionId);
  return item;
}

/**
 * Allowed only while the session is open — the trigger enforces that, and a
 * closed session's delete surfaces as a 409.
 *
 * Note this is the app's SECOND delete path, after `push_subscriptions`. Sessions
 * still have none and must never gain one: a wrong close is corrected by the next
 * row, not by editing. A mistyped checklist line is a different thing entirely —
 * it never represented completed work, so removing it erases nothing.
 */
export async function deleteChecklistItem(itemId: string): Promise<void> {
  const client = supabaseServer();

  // Read the parent first: after the row is gone there is nothing left to touch,
  // and the Rule 26 clock still deserves the bump — deleting a line is interaction.
  const { data, error: readErr } = await client
    .from("checklist_items")
    .select("session_id")
    .eq("id", itemId)
    .single();
  if (readErr) throw new Error(readErr.message);
  const sessionId = (data as Row | null)?.session_id;

  const { error } = await client.from("checklist_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);

  if (typeof sessionId === "string") await touchSession(sessionId);
}
