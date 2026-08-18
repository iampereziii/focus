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
 *
 * CLOSING A SESSION THAT HAS A PARENT RESUMES THAT PARENT. Unconditionally — no
 * chooser, no "stay out" opt-out, and the same for every close status including
 * `drifted`. It used to `PATCH` every session alike, which ended the interrupt and
 * left the session it suspended stranded in `suspended` with nothing `active`: the
 * app read as though closing a two-minute Slack reply had also closed the morning's
 * real work. It hadn't — but the only route back was the next day's review, which
 * is indistinguishable from closed. Fixed 2026-08-17.
 *
 * The one-tap rule is why there is no chooser here. The end of an interrupt is
 * where ADR-0003's tap budget is tightest; a parent that genuinely should not
 * continue is closed from its own screen, which is a real act on a real screen and
 * belongs in the log as one.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Textarea, formatElapsed } from "@/components/ui";
import { useElapsed } from "@/components/ui/useElapsed";
import { InterruptGrid, UNNAMED_FILLER } from "@/components/interrupt/InterruptGrid";
import { CheckInPrompt } from "./CheckInPrompt";
import { PromoteForm } from "./PromoteForm";
import type { Session, SessionStatus } from "@/types/db";

const CLOSE_STATUSES: { value: SessionStatus; label: string }[] = [
  { value: "done", label: "Done" },
  { value: "partial", label: "Partial" },
  { value: "abandoned", label: "Abandoned" },
];

export function SessionView({
  initial,
  parent = null,
}: {
  initial: Session;
  /** The session this one interrupted, when there is one. Read-only — used to NAME it. */
  parent?: Session | null;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initial);

  // The page component now re-fetches `initial` reactively (`useLive` on
  // "sessions"), so a change made elsewhere — another tab, a check-in answered
  // via notification, a promote — needs to land here too, not just on the first
  // mount. Adjusted during render (React's documented pattern for resetting state
  // from a changed prop — https://react.dev/learn/you-might-not-need-an-effect),
  // not in a `useEffect`: an effect would commit a stale frame first, and the
  // lint guardrail (`react-hooks/set-state-in-effect`) rejects that shape anyway.
  // This never fights this component's OWN writes: `rearm` already sets `session`
  // from the server response it gets back, and the next `sessions` invalidation
  // (fired automatically by that same write) just confirms it.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setSession(initial);
  }

  const [closing, setClosing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  /**
   * IN-FLIGHT GUARD FOR `rearm` — and note what it is NOT: `closing` and
   * `promoting` above are MODE flags (they swap which form is on screen), not
   * request flags. Conflating the two is what left this file with no protection
   * at all.
   *
   * Carved out of feature-brief-in-flight-feedback.md, which is otherwise parked:
   * `rearm_filler` is the ONLY non-idempotent write in the app. Every other
   * transaction re-checks state under `select … for update` and rejects a
   * duplicate — `close_session` on `ended_at` (Rule 5), `resume_session` on the
   * parent still being `suspended` — so a double tap there costs a confusing
   * error and nothing more. This one increments:
   *
   *     rearm_count = s.rearm_count + 1     (0002_session_transactions.sql:281)
   *
   * so two taps below the cap BOTH succeed and silently burn two of Rule 18's
   * three re-arms. No error, no symptom — the cap just arrives early, and
   * `rearm_count` is also the evidence column A10 reads at the 2026-09-05
   * checkpoint. A guard here protects a number, not a perception.
   */
  const [rearming, setRearming] = useState(false);

  const parentId = session.parentSessionId;
  const parentName = parent === null ? null : parent.what;

  // Display only, and deliberately in its own module: this file CAN close a
  // session, so it must not also own a timer (Rule 7 guardrail).
  const elapsed = useElapsed(session.startedAt);

  /**
   * ONE close-out, TWO endpoints, and the difference is whether `parentSessionId`
   * names a still-`suspended` parent — NOT just whether it's non-null.
   *
   * A session with a *live, suspended* parent settles through `POST .../resume` on
   * the PARENT — one transaction that closes this row and reactivates that one, so
   * exactly one row is `active` throughout (Rules 16/17). Everything else —
   * including a root session, and a promoted session whose `parentSessionId`
   * points at its already-closed filler — `PATCH`es itself and lands on the
   * backlog. (Resuming an already-closed parent is rejected by `resume_session`
   * and used to surface as a raw 500 — fixed alongside this branch.)
   *
   * `.../resume` is the ONLY correct endpoint for a live suspend/resume. Do not
   * "simplify" it by teaching `close_session` to reactivate parents: that function
   * is single-row on purpose and sits next to Rule 5's immutability check.
   */
  async function close(status: SessionStatus) {
    const outcomeNote = note.trim() === "" ? null : note.trim();
    // A promoted session's `parentSessionId` points at the filler it was promoted
    // FROM, which is already closed (`status = 'switched'`) — resuming it would
    // 409. Only take the resume branch when the parent is actually still
    // `suspended`; otherwise this is a normal close, same as a root session.
    const willResume = parentId !== null && parent !== null && parent.status === "suspended";
    try {
      if (willResume) {
        await api.post<Session>(`/api/sessions/${parentId}/resume`, {
          childStatus: status,
          childOutcomeNote: outcomeNote,
        });
        router.push(`/session/${parentId}`);
        return;
      }
      await api.patch<Session>(`/api/sessions/${session.id}`, { status, outcomeNote });
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError && err.isActiveConflict) {
        // Rule 1's NFR — NAME the blocking session and give a way to reach it.
        // Never resolve it silently; the resume would be closing something the
        // architect never chose to close.
        setBlocking(err.message);
        return;
      }
      // Gap 9: a failed write must not read like a lost session. The transaction is
      // atomic, so BOTH rows are exactly where they were — say so, by name, and
      // leave the buttons live rather than offering a lesser fallback.
      const detail = err instanceof ApiError ? err.message : "The write did not go through.";
      setError(
        willResume
          ? `Nothing was saved — this session is still open and ${
              parentName === null ? "the session it interrupted is" : `“${parentName}” is`
            } still waiting. ${detail}`
          : `Nothing was saved — this session is still open. ${detail}`,
      );
    }
  }

  async function rearm(waitMinutes: number) {
    // Guarded in the HANDLER, not only by the buttons' `disabled` below. A
    // disabled button is not a guard on its own — `QuickCapture` already submits
    // on `Enter` — so anything that reaches this function by keyboard, shortcut
    // or notification has to be stopped here.
    if (rearming) return;
    setRearming(true);
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
    } finally {
      // Cleared on BOTH paths. A flag that survives a thrown error leaves the
      // buttons dead and the session un-re-armable until a reload — strictly
      // worse than the double tap this exists to prevent.
      setRearming(false);
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
        <p className="mt-2 font-mono text-4xl tabular-nums">{formatElapsed(elapsed)}</p>
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
          {/**
            * THE HEADING DOES NOT CHANGE, and that is deliberate. This panel re-arms
            * the WAIT TIMER, so "Still waiting?" is already the literally correct
            * question — the activity reframe is about what the ROW is named, not
            * about what this control does. It is also the phrase `lib/store/push.ts`
            * quotes as its worked example of "always a question, never a claim", so
            * the two stay in sync only as long as this string holds still.
            *
            * "Still on '<activity>'?" was rejected: it is near-identical to Rule 26's
            * check-in wording, and two prompts that mean different things must not
            * sound the same.
            */}
          <p className="text-sm font-medium">Still waiting?</p>
          {session.what !== UNNAMED_FILLER && (
            // Only when the filler was actually named. An unnamed one already says
            // "Just waiting" in the heading above, and echoing that back here would
            // dress an idle wait up as an activity.
            <p className="mt-1 text-xs opacity-60">While you wait: {session.what}</p>
          )}
          <p className="mt-1 text-xs opacity-60">
            Re-armed {session.rearmCount} of 3 times.
          </p>
          {capped ? (
            /**
             * Rule 18's forced disposition, as THREE REAL CONTROLS. All three used
             * to be prose in a `<p>` with nothing behind them, so the app stopped
             * asking and then offered no way to answer.
             *
             * The first two differ in ceremony, not in outcome: "Back to …" settles
             * this filler as `partial` in one tap for the common case where the wait
             * simply ended and there is nothing to write, while "Close out" opens the
             * form for a status and a note. Both resume the parent, because every
             * close does now — a `filler` always has one (DB CHECK).
             */
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                That&apos;s three re-arms. The app stops asking — your call.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void close("partial")}>
                  {parentName === null
                    ? "Back to the session this interrupted"
                    : `Back to “${parentName}”`}
                </Button>
                <Button variant="ghost" onClick={() => setClosing(true)}>
                  Close out
                </Button>
                <Button variant="ghost" onClick={() => setPromoting(true)}>
                  Promote to real work
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              {[2, 5, 10, 30].map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  disabled={rearming}
                  onClick={() => void rearm(m)}
                >
                  +{m}m
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {promoting ? (
        <PromoteForm
          filler={session}
          parentWhat={parentName}
          // One transaction has already closed the filler, created the Task, closed
          // the grandparent and opened the new focus row. Land on it.
          onPromoted={(promoted) => router.push(`/session/${promoted.id}`)}
          onCancel={() => setPromoting(false)}
        />
      ) : !closing ? (
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
          {parentId !== null && (
            <p className="text-xs opacity-60">
              {parentName === null
                ? "This takes you back to the session it interrupted."
                : `This takes you back to “${parentName}”.`}
            </p>
          )}
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

      {blocking !== null && (
        <section className="space-y-3 rounded-lg border border-amber-400 p-4">
          <p className="text-sm font-medium">Another session is already running.</p>
          <p className="text-sm opacity-80">{blocking}</p>
          <p className="text-xs opacity-60">
            Nothing here was closed — this session and the one it interrupted are
            both exactly where they were. Close the running one first; the switch
            gets recorded rather than hidden (Rule 6).
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => router.push("/")}>
              Go to the running session
            </Button>
            <Button variant="ghost" onClick={() => setBlocking(null)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
