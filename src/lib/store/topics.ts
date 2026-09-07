import "server-only";

/**
 * Topics — read and inline create.
 *
 * v1 has NO topic board (Gap 1). A Topic is created inline in quick capture, by
 * name only, and managed nowhere: no rename, no park, no complete, no re-colour.
 * Those return with the board in v1.1.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { PALETTE } from "./index";
import { toTopic } from "./mappers";
import type { Topic } from "@/types/db";

/**
 * THE TOPIC A SESSION IS BEING WORKED UNDER, via its task.
 *
 * One round trip, not two: the embedded select brings the topic back with the
 * task rather than making the caller fetch the task, read `topic_id`, and go
 * again. The session screen is not the friction-critical path the gate is, but
 * `feature-brief-write-path-latency-and-in-flight-feedback.md` established that
 * round trips on a screen load are worth counting, and this keeps the count at
 * one.
 *
 * Returns `null` for an interrupt: a `pulled` or `filler` session has no
 * `taskId` and therefore belongs to no topic. That is a real answer rather than
 * a missing one, and the session screen renders it as such.
 */
export async function topicForTask(taskId: string): Promise<Topic | null> {
  const { data, error } = await supabaseServer()
    .from("tasks")
    .select("topics(*)")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  // Supabase types an embedded one-to-one as an object; be defensive about the
  // array shape some client versions return for the same relationship.
  const embedded: unknown = (data as { topics?: unknown } | null)?.topics;
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  if (row === undefined || row === null) return null;
  return toTopic(row as Parameters<typeof toTopic>[0]);
}

/** Feeds the capture picker and `/`'s grouping (Rule 12). */
export async function listTopics(): Promise<Topic[]> {
  const { data, error } = await supabaseServer()
    .from("topics")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toTopic);
}

/**
 * RESOLVE-OR-CREATE, not insert.
 *
 * The schema carries `create unique index topics_name_ci on topics (lower(name))`
 * — which the project spec's Topic table does NOT mention (it says only "max 80
 * chars"). The index is a sensible call, but it makes a plain insert throw on the
 * single most ordinary action in capture: re-using a topic you already have.
 *
 * Capture is the friction-critical path and the reason the paper version was
 * abandoned the day it was written. An error there is not a validation nicety, it
 * is the failure mode the whole project exists to avoid. So: an existing name
 * (any casing) resolves to the existing row.
 *
 * `color` is assigned server-side by cycling PALETTE — the user never picks one
 * in v1 because there is no editor. `status` is 'active'; `why` stays null
 * (Rule 15 defers with the board).
 *
 * Raised by the schema audit, 2026-08-17. Recorded in FOCUS-1 / FOCUS-2.
 */
export async function createTopicByName(name: string): Promise<Topic> {
  const db = supabaseServer();
  const trimmed = name.trim();

  const existing = await db
    .from("topics")
    .select("*")
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return toTopic(existing.data);

  const { count, error: countError } = await db
    .from("topics")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(countError.message);

  const color = PALETTE[(count ?? 0) % PALETTE.length];

  const { data, error } = await db
    .from("topics")
    .insert({ name: trimmed, color, status: "active" })
    .select("*")
    .single();

  if (error) {
    // Lost a race against a concurrent create of the same name. Resolve rather
    // than surface a unique violation on the capture path.
    const retry = await db.from("topics").select("*").ilike("name", trimmed).maybeSingle();
    if (retry.data) return toTopic(retry.data);
    throw new Error(error.message);
  }
  return toTopic(data);
}

/** The seeded default (supabase/seed.sql). Promotion's new Task lands here. */
export async function inboxTopicId(): Promise<string> {
  const { data, error } = await supabaseServer()
    .from("topics")
    .select("id")
    .ilike("name", "Inbox")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seeded 'Inbox' topic is missing — run supabase/seed.sql");
  return String(data.id);
}
