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
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Textarea } from "@/components/ui";
import type { CheckInInterval, Session, Task } from "@/types/db";

const INTERVALS: { value: CheckInInterval; label: string }[] = [
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
  { value: null, label: "Off" },
];

export function GateForm({ task }: { task: Task }) {
  const router = useRouter();
  const [why, setWhy] = useState(task.why ?? "");
  const [finishLine, setFinishLine] = useState(task.finishLine ?? "");
  // Pre-selected. The architect states the bound; the app invents nothing.
  const [interval, setInterval] = useState<CheckInInterval>(60);
  const [errors, setErrors] = useState<{ why?: string; finishLine?: string; form?: string }>({});
  const [blocking, setBlocking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    const next: typeof errors = {};
    if (why.trim() === "") next.why = "One sentence. If you can't write it, don't start.";
    if (finishLine.trim() === "") next.finishLine = "How will you know you're done?";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const session = await api.post<Session>("/api/sessions", {
        kind: "focus",
        taskId: task.id,
        what: task.what,
        why: why.trim(),
        finishLine: finishLine.trim(),
        checkInIntervalMinutes: interval,
      });
      router.push(`/session/${session.id}`);
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
      <Field label="What">
        <Input value={task.what} readOnly className="opacity-70" />
      </Field>

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

      <Button onClick={() => void start()} disabled={busy} className="w-full py-3">
        Start
      </Button>
    </div>
  );
}
