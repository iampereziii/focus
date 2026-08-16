"use client";

/**
 * The active session screen. ONE TASK, nothing else on the page.
 *
 * Single-threading is enforced HERE — during the work — not by blinding you at the
 * backlog beforehand (Rule 12). Once a session starts, the list is out of view.
 *
 * The elapsed timer is DERIVED from `startedAt` on every render. There is no
 * stored timer and no running clock persisted anywhere: a backgrounded PWA has no
 * guaranteed timer, so anything stored would drift (ADR-0002). Backgrounding this
 * tab for an hour and returning shows the correct elapsed time because it was
 * never counting in the first place.
 *
 * NO POMODORO RING. The entity is deferred to v1.1 and A1 is dormant — there is no
 * container for it while a session has no fixed length (Gaps 2, 8).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Textarea, formatDuration } from "@/components/ui";
import { useElapsed } from "@/components/ui/useElapsed";
import { InterruptGrid } from "@/components/interrupt/InterruptGrid";
import { CheckInPrompt } from "./CheckInPrompt";
import type { Session, SessionStatus } from "@/types/db";

const CLOSE_STATUSES: { value: SessionStatus; label: string }[] = [
  { value: "done", label: "Done" },
  { value: "partial", label: "Partial" },
  { value: "abandoned", label: "Abandoned" },
];

export function SessionView({ initial }: { initial: Session }) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  // Display only, and deliberately in its own module: this file CAN close a
  // session, so it must not also own a timer (Rule 7 guardrail).
  const elapsed = useElapsed(session.startedAt);

  async function close(status: SessionStatus) {
    try {
      await api.patch<Session>(`/api/sessions/${session.id}`, {
        status,
        outcomeNote: note.trim() === "" ? null : note.trim(),
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close the session.");
    }
  }

  async function rearm(waitMinutes: number) {
    try {
      const updated = await api.post<Session>(`/api/sessions/${session.id}/rearm`, {
        waitMinutes,
      });
      setSession(updated);
    } catch (err) {
      // Rule 18: the 4th re-arm is a 409 and the UI presents a forced disposition.
      // It must NEVER respond by auto-closing — Rule 7 is not negotiable here.
      if (err instanceof ApiError && err.isRearmCapped) setCapped(true);
      else setError(err instanceof ApiError ? err.message : "Could not re-arm.");
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide opacity-60">
          {session.kind === "focus" ? "Focus" : session.kind}
          {session.interruptTag !== null && ` · ${session.interruptTag}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{session.what}</h1>
        <p className="mt-2 font-mono text-4xl tabular-nums">{formatDuration(elapsed)}</p>
      </header>

      {session.why !== null && (
        <section className="space-y-1 text-sm">
          <p>
            <span className="opacity-60">Why: </span>
            {session.why}
          </p>
          <p>
            <span className="opacity-60">Finish line: </span>
            {session.finishLine}
          </p>
        </section>
      )}

      <CheckInPrompt
        session={session}
        onDone={() => setClosing(true)}
        onDrifted={() => void close("drifted")}
        onAnswered={() =>
          setSession((s) => ({ ...s, lastInteractionAt: new Date().toISOString() }))
        }
      />

      {session.kind === "filler" && (
        <section className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
          <p className="text-sm font-medium">Still waiting?</p>
          <p className="mt-1 text-xs opacity-60">
            Re-armed {session.rearmCount} of 3 times.
          </p>
          {capped ? (
            <p className="mt-3 text-sm">
              That&apos;s three re-arms. Choose: resume the parent, close this, or
              promote it to real work.
            </p>
          ) : (
            <div className="mt-3 flex gap-2">
              {[2, 5, 10, 30].map((m) => (
                <Button key={m} variant="ghost" onClick={() => void rearm(m)}>
                  +{m}m
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {!closing ? (
        <>
          <InterruptGrid
            parentSessionId={session.id}
            onStarted={(child) => router.push(`/session/${child.id}`)}
            onDrifted={() => router.push("/")}
          />
          <Button variant="ghost" className="w-full" onClick={() => setClosing(true)}>
            Close out
          </Button>
        </>
      ) : (
        <section className="space-y-3">
          <Field label="Outcome" hint="one line — it is never editable afterwards">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            {CLOSE_STATUSES.map((s) => (
              <Button key={s.value} variant="ghost" onClick={() => void close(s.value)}>
                {s.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setClosing(false)}>
            Back
          </Button>
        </section>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
