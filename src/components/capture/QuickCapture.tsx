"use client";

/**
 * QUICK CAPTURE — the friction-critical path, and the reason this project exists.
 *
 * The manual version of this protocol was written on paper and rejected the same
 * day as "a hassle." The problem being solved is NOT STARTING, so any tool that
 * raises the cost of starting is working against itself. Benchmark: Microsoft
 * To Do.
 *
 * Rule 9 — CAPTURE IS CHEAP; STARTING IS GATED. One field (`what`) plus a topic.
 * `why` and `finishLine` belong at the gate, not here. DO NOT ADD FIELDS.
 *
 * Not a route, on purpose: a global sheet reachable by keyboard shortcut and a
 * persistent button from anywhere in the app.
 *
 * Budget: the sheet must open in UNDER 150 ms from keypress, and the whole capture
 * must stay inside the under-20-second gate budget — including inline topic
 * creation (Gap 14).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { TopicPicker } from "@/components/capture/TopicPicker";
import type { Task, Topic } from "@/types/db";

export function QuickCapture({ onCaptured }: { onCaptured?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [topicName, setTopicName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const whatRef = useRef<HTMLInputElement>(null);

  // Topics are loaded eagerly, so opening the sheet is never waiting on a fetch —
  // the 150 ms budget is measured from keypress, not from data arriving. Reactive
  // UI (2026-08-18): a topic created inline (below) invalidates `topics`, so this
  // list is current on the NEXT capture without a reload — the datalist used to
  // fetch once at mount and never again.
  //
  // `onCaptured` is separate and still needed post-SSR-swap: `/`'s topics/tasks
  // now come from a Server Component, which this client component can't
  // subscribe to — `AppShell` passes `router.refresh()` here so the backlog
  // picks up the new row. That refresh is now genuinely live (it was a no-op
  // pre-swap); this datalist's own liveness is a separate, client-only concern.
  const { data: topics = [] } = useLive<Topic[]>("topics", () => api.get<Topic[]>("/api/topics"));
  // Computed, not synced into state via an effect: an untouched field always
  // shows (and submits) the first topic once one exists, and typing overrides it.
  const effectiveTopicName = topicName === "" ? (topics[0]?.name ?? "Inbox") : topicName;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Reachable from every page. `n` alone would fight text entry, so it is
      // modified — but it is still one chord, not a menu dive.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) whatRef.current?.focus();
  }, [open]);

  const submit = useCallback(async () => {
    if (what.trim() === "" || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Resolve-or-create. `topics(lower(name))` is uniquely indexed, so this
      // returns the existing row for a name you already have rather than erroring
      // — re-using a topic is the single most ordinary action in capture.
      const topic = await api.post<Topic>("/api/topics", {
        name: effectiveTopicName.trim() === "" ? "Inbox" : effectiveTopicName.trim(),
      });
      await api.post<Task>("/api/tasks", { what: what.trim(), topicId: topic.id });

      setWhat("");
      setOpen(false);
      onCaptured?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not capture that.");
    } finally {
      setSaving(false);
    }
  }, [what, effectiveTopicName, saving, onCaptured]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick capture"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-neutral-900 text-2xl text-white shadow-lg dark:bg-white dark:text-neutral-900"
      >
        +
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Capture">
        <div className="space-y-3">
          <Field label="What" hint="the only thing you have to write">
            <Input
              ref={whatRef}
              value={what}
              maxLength={200}
              placeholder="Rename the sync job"
              onChange={(e) => setWhat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </Field>

          <Field label="Topic" hint="type a new name to create it">
            <TopicPicker
              topics={topics}
              value={effectiveTopicName}
              onChange={setTopicName}
              onSubmit={() => void submit()}
            />
          </Field>

          {error !== null && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={what.trim() === "" || saving}>
              Capture
            </Button>
          </div>

          {/* No WHY field here, deliberately — see Rule 9 in the header. */}
        </div>
      </Sheet>
    </>
  );
}
