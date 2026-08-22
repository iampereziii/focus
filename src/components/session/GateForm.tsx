"use client";

/**
 * THE GATE. ADR-0001's behavioural contract, as a form.
 *
 * "If you can't write the WHY in one sentence, don't start that task."
 *
 * FOUR fields — WHAT / WHY / FINISH LINE / check-in interval. The fourth is
 * pre-selected so the common path costs ZERO extra taps (Rule 26a); `off` is a
 * first-class choice, not a degraded one.
 *
 * THERE IS NO PLANNED DURATION. Sessions have no timebox — the 90-minute box was
 * removed because the number was never justified, and the written FINISH LINE is
 * the bound (Rule 13, retired). Do not add a duration picker back.
 *
 * Budget: gate submit → running timer in UNDER 1 SECOND, and the whole start in
 * under 20 seconds. That 20 seconds is the BUILD GATE — it blocks ship.
 *
 * ── TWO TARGETS, ONE GATE (ADR-0004, 2026-08-20) ─────────────────────────────
 *
 * `<GateForm task={…} />`   — start a task that already exists. WHAT is read-only
 *                             (it was written at capture); this is `/`'s path.
 * `<GateForm topics={…} />` — start a task that does not exist yet. WHAT is
 *                             editable and a topic picker appears above it. This
 *                             is the ⌘K path, and after ADR-0004 it is the ONLY
 *                             way a task enters the system at all.
 *
 * The two modes share every gate field, deliberately. ADR-0004 moves WHEN the
 * gate is asked; it must not become a place where a second, laxer gate grows.
 * If you find yourself adding a field to one branch and not the other, stop —
 * that is the gate forking, which is the failure mode this shape exists to
 * prevent. The same reasoning as the push path: one implementation serves both.
 *
 * The FIELD COUNT is load-bearing and is now at its ceiling. New-task mode
 * renders five fields (what, topic, why, finish line, interval). Completion
 * rates hold from three to six fields and fall off past five to seven, so five
 * is the edge of the safe band, not the middle of it. A sixth field is not a
 * design tweak — it is the 20-second build gate being spent. ADR-0004's named
 * fallback if this proves heavy is to CHUNK these into two steps in one sheet,
 * never to re-add a separate un-gated capture.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { TopicPicker } from "@/components/capture/TopicPicker";
import { measure } from "@/lib/perf";
import type { CheckInInterval, Session, Task, Topic } from "@/types/db";

const INTERVALS: { value: CheckInInterval; label: string }[] = [
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
  { value: null, label: "Off" },
];

/**
 * Exactly one of `task` / `topics`. Modelled as a union rather than two
 * optional props so a call site cannot pass both or neither — the same
 * exactly-one discipline the API schema enforces on `taskId` / `topicId`.
 */
type GateFormProps =
  | { task: Task; topics?: undefined; onCancel?: () => void }
  | { task?: undefined; topics: Topic[]; onCancel?: () => void };

export function GateForm({ task, topics, onCancel }: GateFormProps) {
  const router = useRouter();
  const newTaskMode = task === undefined;

  const [what, setWhat] = useState(task?.what ?? "");
  const [topicName, setTopicName] = useState("");
  const [why, setWhy] = useState(task?.why ?? "");
  const [finishLine, setFinishLine] = useState(task?.finishLine ?? "");
  // Pre-selected. The architect states the bound; the app invents nothing.
  const [interval, setInterval] = useState<CheckInInterval>(60);
  const [errors, setErrors] = useState<{
    what?: string;
    why?: string;
    finishLine?: string;
    form?: string;
  }>({});
  const [blocking, setBlocking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Computed, not synced through an effect: an untouched field always shows
  // (and submits) the first topic once one exists, and typing overrides it.
  // Pre-filled and overridable, so the common path costs zero taps — the same
  // budget argument as the interval above.
  const effectiveTopicName =
    topicName === "" ? (topics?.[0]?.name ?? "Inbox") : topicName;

  async function start() {
    // Guarded in the handler, not only by the button: this form submits from the
    // keyboard too, and ADR-0001's whole budget is measured from this tap.
    if (busy) return;
    const next: typeof errors = {};
    if (newTaskMode && what.trim() === "") next.what = "What are you doing?";
    if (why.trim() === "") next.why = "One sentence. If you can't write it, don't start.";
    if (finishLine.trim() === "") next.finishLine = "How will you know you're done?";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      // ADR-0001's budget, finally measured rather than asserted: gate submit →
      // running timer, under 1 second warm. The navigation is inside the span
      // because the timer is on the NEXT screen — stopping the clock at the
      // response would measure something no one experiences.
      //
      // ADR-0004 puts the topic resolve inside this span too, for the same
      // reason: it sits between the tap and the timer, so leaving it out would
      // measure a path nobody walks. It is also the one step start-on-capture
      // ADDED, and the review's open question is whether it costs the budget —
      // which can only be answered if it is inside the measurement.
      await measure("gateSubmit", async () => {
        // ADR-0004: in new-task mode the Task is NOT created here. Only the
        // topic is resolved — then the task and the session are created
        // together, server-side, in ONE transaction. Creating the task from the
        // client would put a task insert in front of Rule 1's conflict check,
        // and a blocked start would leave behind precisely the never-started
        // row ADR-0004 exists to prevent.
        //
        // NO WRITE ON THE COMMON PATH, ONE ONLY WHEN THE TOPIC IS GENUINELY NEW
        // — the local resolve carried over from capture, which is where this
        // logic lived until the gate absorbed it. `topics` is loaded eagerly by
        // `QuickCapture`, so starting into a topic that already exists needs no
        // topic write at all. Case-insensitive to agree with the uniquely
        // indexed `topics(lower(name))`: matching case-sensitively would send
        // "inbox" down the create path to be resolved back to "Inbox", which is
        // the round trip this avoids.
        let target: { taskId: string } | { topicId: string };
        if (newTaskMode) {
          const name = effectiveTopicName.trim() === "" ? "Inbox" : effectiveTopicName.trim();
          const known = topics.find((t) => t.name.toLowerCase() === name.toLowerCase());
          target = { topicId: known?.id ?? (await api.post<Topic>("/api/topics", { name })).id };
        } else {
          target = { taskId: task.id };
        }

        const session = await api.post<Session>("/api/sessions", {
          kind: "focus",
          ...target,
          what: newTaskMode ? what.trim() : task.what,
          why: why.trim(),
          finishLine: finishLine.trim(),
          checkInIntervalMinutes: interval,
        });
        router.push(`/session/${session.id}`);
      });
    } catch (err) {
      if (err instanceof ApiError && err.isActiveConflict) {
        // Rule 1 — say WHICH session is blocking, with a way to close it. Never
        // close it silently: the switch has to be recorded as a deliberate act.
        setBlocking(err.message);
      } else {
        setErrors({ form: err instanceof ApiError ? err.message : "Could not start." });
      }
      setBusy(false);
    }
  }

  if (blocking !== null) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-400 p-4">
        <p className="text-sm font-medium">Another session is already running.</p>
        <p className="text-sm opacity-80">{blocking}</p>
        <p className="text-xs opacity-60">
          Close it first — the switch gets recorded as <code>switched</code> rather
          than hidden (Rule 6).
        </p>
        <Button variant="ghost" onClick={() => router.push("/")}>
          Go to the running session
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label="What" error={errors.what}>
        {newTaskMode ? (
          <Input
            autoFocus
            value={what}
            maxLength={200}
            placeholder="Rename the sync job"
            onChange={(e) => setWhat(e.target.value)}
          />
        ) : (
          <Input value={task.what} readOnly className="opacity-70" />
        )}
      </Field>

      {newTaskMode && (
        <Field label="Topic" hint="type a new name to create it">
          <TopicPicker
            topics={topics}
            value={effectiveTopicName}
            onChange={setTopicName}
            // Enter on the topic field submits the gate, same as capture always
            // did — but the gate can reject, so this is not a fast path to a
            // half-filled start: `start()` validates WHY and FINISH LINE first.
            onSubmit={() => void start()}
            disabled={busy}
          />
        </Field>
      )}

      <Field label="Why" hint="one sentence" error={errors.why}>
        <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>

      <Field label="Finish line" hint="reachable in one sitting" error={errors.finishLine}>
        <Textarea
          rows={2}
          value={finishLine}
          onChange={(e) => setFinishLine(e.target.value)}
        />
      </Field>

      <Field label="Check in every" hint="the app asks; it never decides">
        <div className="flex gap-2">
          {INTERVALS.map((opt) => (
            <Button
              key={String(opt.value)}
              variant={interval === opt.value ? "primary" : "ghost"}
              onClick={() => setInterval(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </Field>

      {errors.form !== undefined && <p className="text-xs text-red-600">{errors.form}</p>}

      <Button onClick={() => void start()} pending={busy} className="w-full py-3">
        Start
      </Button>

      {onCancel !== undefined && (
        <Button variant="ghost" onClick={onCancel} disabled={busy} className="w-full">
          Cancel
        </Button>
      )}
    </div>
  );
}
