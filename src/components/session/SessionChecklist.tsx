"use client";

/**
 * The in-session scratchpad (feature-brief-session-scratchpad-checklist.md).
 *
 * `'use client'` because the whole point is typing and ticking without a
 * navigation — every interaction here is local state plus one write.
 *
 * WHAT THIS IS FOR: leaving yourself breadcrumbs mid-session, so "where was I"
 * survives a coffee break without waiting for the one closing `outcomeNote`. It is
 * a working surface, not a second backlog — items appear on this screen and
 * nowhere else (not `/`, not `/log`, not a notification).
 *
 * IT GOES READ-ONLY THE MOMENT THE SESSION DOES. Rule 6 scoped: while `active` you
 * may add, retitle, tick and delete; once the session closes the checklist freezes
 * with it, exactly like the outcome note. The DB trigger is the real enforcement
 * (0008_checklist_items.sql) — this component just doesn't render controls it knows
 * the server would reject.
 *
 * APPEND ORDER, NO REORDERING. A scratchpad reads chronologically and the order you
 * thought of things is itself the signal. There is no `position` column to sort by.
 *
 * LIVE KEY: subscribes on the `sessions` domain noun with a `:checklist` scope, so
 * it gets its own SWR cache entry while still being re-read by any `sessions`
 * invalidation — which is what every write below fires, via `keysFor`. No new
 * LiveKey and no EFFECTS entry: `/api/sessions/...` already maps to `sessions`.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Button, Input } from "@/components/ui";
import type { ChecklistItem, Session } from "@/types/db";

/** Matches the DB check and the Zod schema — all three say 200 on purpose. */
const MAX_TEXT = 200;

export function SessionChecklist({ session }: { session: Session }) {
  const editable = session.endedAt === null && session.status === "active";
  const { data: items } = useLive<ChecklistItem[]>(
    "sessions",
    () => api.get<ChecklistItem[]>(`/api/sessions/${session.id}/checklist-items`),
    `${session.id}:checklist`,
  );

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every write funnels through here so one place owns the error surface. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // Loud, not optimistic (ADR-0002: online-only, writes fail visibly). A 409
      // here means the session closed underneath you — say that, don't swallow it.
      setError(err instanceof Error ? err.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    await run(async () => {
      await api.post(`/api/sessions/${session.id}/checklist-items`, { text });
      setDraft("");
    });
  };

  const toggle = (item: ChecklistItem) =>
    run(() =>
      api.patch(`/api/sessions/${session.id}/checklist-items/${item.id}`, {
        done: !item.done,
      }),
    );

  const remove = (item: ChecklistItem) =>
    run(() => api.del(`/api/sessions/${session.id}/checklist-items/${item.id}`));

  // Nothing to say yet on a closed session with no items — don't render an empty
  // frozen box in the log-facing view of a finished session.
  if (!editable && (items === undefined || items.length === 0)) return null;

  const done = items?.filter((i) => i.done).length ?? 0;

  return (
    <section className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Scratchpad</h2>
        {items !== undefined && items.length > 0 && (
          <span className="text-xs opacity-60">
            {done} / {items.length}
          </span>
        )}
      </div>

      {items === undefined ? (
        <p className="text-sm opacity-60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-60">
          Nothing here yet. Jot the next step so you don&apos;t have to hold it.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.done}
                disabled={!editable || busy}
                onChange={() => void toggle(item)}
                aria-label={item.text}
                className="mt-1 shrink-0"
              />
              <span className={item.done ? "flex-1 line-through opacity-50" : "flex-1"}>
                {item.text}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busy}
                  aria-label={`Remove "${item.text}"`}
                  className="shrink-0 px-1 text-xs opacity-40 hover:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <form onSubmit={(e) => void add(e)} className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_TEXT}
            placeholder="Next step, or where you left off…"
            aria-label="New checklist item"
            className="flex-1"
          />
          <Button type="submit" pending={busy} disabled={draft.trim() === ""}>
            Add
          </Button>
        </form>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
