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
import { Button, Field, SegmentedControl, Textarea } from "@/components/ui";
import { ElapsedClock } from "@/components/ui/ElapsedClock";
import { useAutoGrow } from "@/components/ui/useAutoGrow";
import { measure } from "@/lib/perf";
import { clearScratchDraft, readScratchDraft, writeScratchDraft } from "@/lib/scratch-draft";
import { InterruptGrid, UNNAMED_FILLER } from "@/components/interrupt/InterruptGrid";
import { CheckInPrompt } from "./CheckInPrompt";
import { PromoteForm } from "./PromoteForm";
import type { Session, SessionStatus, Topic } from "@/types/db";

const CLOSE_STATUSES: { value: SessionStatus; label: string }[] = [
  { value: "done", label: "Done" },
  { value: "partial", label: "Partial" },
  { value: "abandoned", label: "Abandoned" },
];

export function SessionView({
  initial,
  parent = null,
  topic = null,
}: {
  initial: Session;
  /** The session this one interrupted, when there is one. Read-only — used to NAME it. */
  parent?: Session | null;
  /**
   * The topic this session's task belongs to. Read-only, and used for exactly
   * ONE thing: tinting the scratch pad. `null` for an interrupt — see the pad.
   */
  topic?: Topic | null;
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

  /**
   * THE SCRATCH PAD — a thinking aid, not a record (feature-brief-session-
   * scratch-pad.md). It is EPHEMERAL: kept in localStorage only so a refresh or
   * a trip to `/log` doesn't lose it, wiped the moment this session closes, and
   * never sent to the server. Nothing on `sessions` changes because of it.
   *
   * Re-read from storage whenever the SESSION ID changes — same trigger as the
   * `prevInitial` reset above, folded in here rather than a second `useState`
   * comparison, since both exist to keep local state in sync with which session
   * is actually on screen.
   */
  const [scratchId, setScratchId] = useState(initial.id);
  const [scratch, setScratch] = useState(() => readScratchDraft(initial.id));
  if (session.id !== scratchId) {
    setScratchId(session.id);
    setScratch(readScratchDraft(session.id));
  }
  // Auto-grow, extracted verbatim into `useAutoGrow` so the gate's WHY and
  // FINISH LINE can open at one row and grow the same way. Still DOM styling
  // only, still an effect rather than the render-time adjustment used above for
  // `session`/`scratch` — see the hook for the full reasoning.
  const scratchRef = useAutoGrow(scratch);

  function onScratchChange(value: string) {
    setScratch(value);
    writeScratchDraft(session.id, value);
  }

  /**
   * Whether the WHY is revealed. It only ever HIDES anything under `compact`
   * (feature-brief-design-system-pass.md): the paragraph carries `compact:hidden`
   * when collapsed and the toggle carries `hidden compact:inline`, so a
   * comfortable viewport renders both sentences exactly as before and never shows
   * a control at all.
   *
   * THE FINISH LINE IS NEVER COLLAPSED. It is the bound the check-in asks you to
   * judge against, and the one line here that is read repeatedly rather than
   * once — the WHY was written at the gate and is the sentence you go back to,
   * not the one you glance at. The affordance is `/log`'s, verbatim.
   */
  const [showWhy, setShowWhy] = useState(false);

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
   * This used to cite `feature-brief-in-flight-feedback.md` as parked scope it
   * had been carved out of. That doc was never written; the scope was absorbed by
   * feature-brief-write-path-latency-and-in-flight-feedback.md instead (Slice A),
   * which is where the citation now points and which is why `closingStatus` below
   * exists. So this stopped being a special case and became one instance of a
   * general rule: every write control in the app reports itself in flight.
   *
   * `rearm_filler` remains the only write whose duplicate does silent DAMAGE.
   * Every other transaction re-checks state under `select … for update` and
   * rejects a duplicate — `close_session` on `ended_at` (Rule 5),
   * `resume_session` on the parent still being `suspended` — so a double tap
   * there costs a confusing error and nothing more. This one increments:
   *
   *     rearm_count = s.rearm_count + 1     (0002_session_transactions.sql:281)
   *
   * so two taps below the cap BOTH succeed and silently burn two of Rule 18's
   * three re-arms. No error, no symptom — the cap just arrives early, and
   * `rearm_count` is also the evidence column A10 reads at the 2026-09-05
   * checkpoint. A guard here protects a number, not a perception.
   */
  const [rearming, setRearming] = useState<number | null>(null);

  /**
   * WHICH close-out is in flight, or null — a REQUEST flag, unlike `closing`.
   *
   * The close-out was the one write path in the app with no in-flight state at
   * all: no guard in the handler, no `disabled` on the buttons, no spinner. It is
   * also the slowest (two transactions on the resume branch) and the most tapped.
   * A second tap during the wait produced a 409 `session_closed` from the first
   * tap's own successful write, which the catch below then reported as
   * "Nothing was saved" — factually the opposite of what happened, on the one
   * message the architect most needs to be able to trust.
   *
   * Holding the STATUS rather than a boolean lets exactly the pressed button show
   * the spinner while its siblings simply disable, so the feedback says which
   * choice is being recorded.
   *
   * Deliberately NOT cleared on success: the close navigates, and clearing it
   * first would flash every control live again for the frame before the route
   * changes. It is cleared on every failure path, because there the buttons must
   * come back.
   */
  const [closingStatus, setClosingStatus] = useState<SessionStatus | null>(null);

  const parentId = session.parentSessionId;
  const parentName = parent === null ? null : parent.what;


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
    // Guarded in the HANDLER, not only by the buttons below — same reasoning as
    // `rearm`: a path that reaches this function by keyboard, by the check-in
    // prompt's `Done`, or by a second tap landing before React re-renders has to
    // be stopped here. `close_session` rejects the duplicate anyway (Rule 5), so
    // what this protects is the MESSAGE, not the data: without it the second tap
    // reports the first tap's success as a failure to save.
    if (closingStatus !== null) return;
    setClosingStatus(status);
    setError(null);

    const outcomeNote = note.trim() === "" ? null : note.trim();
    // A promoted session's `parentSessionId` points at the filler it was promoted
    // FROM, which is already closed (`status = 'switched'`) — resuming it would
    // 409. Only take the resume branch when the parent is actually still
    // `suspended`; otherwise this is a normal close, same as a root session.
    const willResume = parentId !== null && parent !== null && parent.status === "suspended";
    try {
      await measure("closeOut", async () => {
        if (willResume) {
          await api.post<Session>(`/api/sessions/${parentId}/resume`, {
            childStatus: status,
            childOutcomeNote: outcomeNote,
          });
          // The row that just closed is THIS session (`.../resume` closes the
          // child and reactivates the parent) — the pad's draft is discarded on
          // the id that was actually written, never on the parent, which is
          // resuming rather than closing and keeps whatever it was holding.
          clearScratchDraft(session.id);
          router.push(`/session/${parentId}`);
          return;
        }
        await api.patch<Session>(`/api/sessions/${session.id}`, { status, outcomeNote });
        clearScratchDraft(session.id);
        router.push("/");
      });
      // Deliberately no `setClosingStatus(null)` here — see the state's comment.
    } catch (err) {
      setClosingStatus(null);

      if (err instanceof ApiError && err.isActiveConflict) {
        // Rule 1's NFR — NAME the blocking session and give a way to reach it.
        // Never resolve it silently; the resume would be closing something the
        // architect never chose to close.
        setBlocking(err.message);
        return;
      }

      if (err instanceof ApiError && err.code === "session_closed") {
        // THE TRUTHFUL BRANCH. A 409 here almost always means an earlier tap
        // succeeded and this one raced it — the session IS closed, and Rule 5 is
        // rejecting a second write to an immutable row. Saying "nothing was
        // saved" would be exactly backwards, and would invite a third tap. The
        // guard above makes this rare; it is kept because "rare" is not "never"
        // (another tab, a notification action, a resumed background page).
        setError(
          `This session is already closed — an earlier tap went through. Nothing was lost, and nothing was written twice. Reload to see where it landed. ${err.message}`,
        );
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
    if (rearming !== null) return;
    setRearming(waitMinutes);
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
      setRearming(null);
    }
  }

  return (
    // FULL HEIGHT UNDER `compact` (feature-brief-design-system-pass.md, revised
    // 2026-09-07). `body` is already `min-h-full flex flex-col` with exactly two
    // children — the nav and this — so `flex-1` here makes the screen as tall as
    // the window rather than as tall as its content. No `calc()`, no nav height
    // duplicated in a second place to drift.
    //
    // Measured at 500 px wide, this screen was 353 px including the nav: it fits
    // a 375-tall window, but left 67 px dead at 420 and 132 px at 485. The
    // spacer below turns that into room between the finish line and the
    // controls, which is where the thinking happens.
    <main className="mx-auto w-full max-w-xl space-y-6 p-6 compact:flex compact:max-w-none compact:flex-1 compact:flex-col compact:space-y-2 compact:p-2.5">
      {/*
        THREE ELEMENTS STACKED, OR ONE ROW — same three, same order, same words.
        Comfortable is `flex-col`, which renders identically to the block layout
        this replaced; `compact` turns the row and puts the clock on the right,
        which is ~74 px back on a screen that has to fit a 500 px window. The
        36 px clock is display, not instrumentation: at 20 px it is still the
        evidence that the session is alive.
      */}
      <header className="flex flex-col compact:flex-row compact:items-baseline compact:gap-2">
        <div className="min-w-0 compact:flex compact:flex-1 compact:items-baseline compact:gap-1.5">
        <p className="text-xs uppercase tracking-wide opacity-60 compact:shrink-0">
          {session.kind === "focus" ? "Focus" : session.kind}
          {session.interruptTag !== null && ` · ${session.interruptTag}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold compact:mt-0 compact:min-w-0 compact:truncate compact:text-[0.9375rem]">
          {session.what}
        </h1>
        </div>
        {/* Display only, and deliberately in its own leaf component: this file
            CAN close a session, so it must not also own a timer (Rule 7
            guardrail) — and the 1 Hz tick now re-renders two digits rather than
            this whole screen. */}
        <ElapsedClock
          startedAt={session.startedAt}
          className="mt-2 font-mono text-4xl tabular-nums compact:mt-0 compact:shrink-0 compact:text-xl"
        />
      </header>

      {session.why !== null && (
        <section className="space-y-1 text-sm compact:space-y-0.5 compact:text-xs">
          <p className={showWhy ? undefined : "compact:hidden"}>
            <span className="opacity-60">Why: </span>
            {session.why}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0">
              <span className="opacity-60">Finish line: </span>
              {session.finishLine}
            </p>
            {/* Hidden above the breakpoint — nothing is collapsed there, so
                there is nothing to reveal and no control to explain. */}
            <button
              type="button"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((v) => !v)}
              className="hidden shrink-0 text-xs underline decoration-dotted opacity-70 hover:opacity-100 compact:inline"
            >
              why {showWhy ? "︿" : "⌄"}
            </button>
          </div>
        </section>
      )}

      <CheckInPrompt
        session={session}
        onDone={() => setClosing(true)}
        onDrifted={() => void close("drifted")}
        closing={closingStatus !== null}
        onAnswered={() =>
          setSession((s) => ({ ...s, lastInteractionAt: new Date().toISOString() }))
        }
      />

      {/*
       * THE SCRATCH PAD. Always here, on every open session regardless of
       * `kind` — an unnamed filler included, since nothing it holds is ever
       * recorded and it makes no claim about what the wait was.
       *
       * Small and auto-growing on purpose (brief Risk 1): no label, no
       * placeholder, no border. It should read as a margin next to the task,
       * not a form to fill in — the session screen's whole job is keeping one
       * task in view, and this is the largest element ever added to it. If it
       * starts competing with the task heading, the named fallback is a
       * one-tap expand, not a smaller box or a lower position.
       */}
      {/*
        THE PAD IS TINTED WITH ITS TOPIC (feature-brief-design-system-pass.md).
        It rendered borderless and transparent, which made the one element on
        this screen you actually WRITE in the only one with no presence at all —
        invisible until typed into.

        THE COLOUR IS NOT A NEW HUE, and that distinction is the whole reason
        this is allowed. `globals.css` reserves colour for `Topic.color`, meaning
        exactly one thing: which topic this belongs to. That is precisely what is
        rendered here, carrying the same meaning it carries as the group spine on
        `/`. A second colour system would have needed a superseding decision;
        this needs none.

        Mixed against `--background` rather than `transparent`, so the wash lands
        the same weight in either theme without a second value to keep in sync.

        `null` topic — a `pulled` or `filler` interrupt, which belongs to no task
        and so to no topic — falls back to the neutral spine. That is the honest
        answer rather than a degraded one: an interrupt genuinely is not part of
        a topic.

        The wrapper carries the spine so the textarea keeps its own borderless
        classes; putting `border-l-2` on the field itself would fight the
        primitive's `border` at equal specificity, which Tailwind resolves by
        stylesheet order rather than by the order written here.
      */}
      <div
        className="rounded-r-md border-l-2 border-border-strong pl-2.5 pr-1"
        style={
          topic === null
            ? undefined
            : {
                borderLeftColor: topic.color,
                backgroundColor: `color-mix(in srgb, ${topic.color} 8%, var(--background))`,
              }
        }
      >
      <Textarea
        ref={scratchRef}
        rows={2}
        value={scratch}
        onChange={(e) => onScratchChange(e.target.value)}
        aria-label="Scratch pad — not saved, cleared when this session closes"
        className="resize-none overflow-hidden border-none bg-transparent px-0 focus:border-none compact:py-0.5 compact:text-[0.8125rem]"
      />
      </div>

      {/*
        THE SLACK, MADE EXPLICIT. A growing spacer rather than `mt-auto` on the
        controls: `space-y-*` sets `margin-top` on every sibling at a higher
        specificity than `mt-auto`, so the auto margin would silently lose and
        the controls would stay wherever the content ended. `flex-grow` is not a
        margin and cannot be overridden by one.

        It is `hidden` above the breakpoint, where the screen is not full-height
        and there is nothing to distribute.
      */}
      <div aria-hidden className="hidden compact:block compact:flex-1" />

      {session.kind === "filler" && (
        <section className="rounded-lg border border-neutral-300 p-4 compact:rounded-md compact:p-2 dark:border-neutral-700">
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
          <p className="text-sm font-medium compact:text-xs">Still waiting?</p>
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
            <div className="mt-3 space-y-3 compact:mt-1.5 compact:space-y-1.5">
              <p className="text-sm compact:text-xs">
                That&apos;s three re-arms. The app stops asking — your call.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  pending={closingStatus === "partial"}
                  disabled={closingStatus !== null}
                  onClick={() => void close("partial")}
                >
                  {parentName === null
                    ? "Back to the session this interrupted"
                    : `Back to “${parentName}”`}
                </Button>
                <Button
                  variant="ghost"
                  disabled={closingStatus !== null}
                  onClick={() => setClosing(true)}
                >
                  Close out
                </Button>
                <Button
                  variant="ghost"
                  disabled={closingStatus !== null}
                  onClick={() => setPromoting(true)}
                >
                  Promote to real work
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2 compact:mt-1.5">
              {[2, 5, 10, 30].map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  // Which wait is being added, not merely that one is — the same
                  // reasoning as the close-out buttons below.
                  pending={rearming === m}
                  disabled={rearming !== null}
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
          {/*
            A rule above `Close out` under `compact`. The grid ends in
            `I drifted`, which closes the session as drift and is irreversible
            (Rule 5); once the rows are 30 px apart rather than 44, the two want
            something between them that is not just space.
          */}
          <div className="compact:border-t compact:border-border compact:pt-2.5">
            <Button
              variant="ghost"
              className="w-full"
              disabled={closingStatus !== null}
              onClick={() => setClosing(true)}
            >
              Close out
            </Button>
          </div>
        </>
      ) : (
        <section className="space-y-3 compact:space-y-1.5">
          <Field label="Outcome" hint="one line — it is never editable afterwards">
            <Textarea
              rows={2}
              value={note}
              disabled={closingStatus !== null}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {parentId !== null && (
            <p className="text-xs opacity-60">
              {parentName === null
                ? "This takes you back to the session it interrupted."
                : `This takes you back to “${parentName}”.`}
            </p>
          )}
          {/*
            Three outcomes, equal weight, one row that cannot wrap. Only the
            pressed one spins; its siblings just go inert, so the feedback says
            WHICH outcome is being recorded rather than merely that something is
            happening. `closingStatus` can hold a status that is not offered here
            (`drifted`, from the check-in) — then nothing spins and everything
            disables, which is the truth.
          */}
          <SegmentedControl
            label="How did this session end?"
            options={CLOSE_STATUSES}
            onChange={(status) => void close(status)}
            pending={closingStatus}
            disabled={closingStatus !== null}
          />
          <Button
            variant="ghost"
            disabled={closingStatus !== null}
            onClick={() => setClosing(false)}
          >
            Back
          </Button>
        </section>
      )}

      {blocking !== null && (
        <section className="space-y-3 rounded-lg border border-amber-400 p-4 compact:space-y-1.5 compact:rounded-md compact:p-2">
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
