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
 * ── PREFILLED ON RESTART, NOT SKIPPED (2026-08-26) ──────────────────────────
 *
 * In existing-task mode all three carried values — WHY, FINISH LINE and the
 * interval — open pre-filled from the last start of that task (migration 0006
 * writes them; feature-brief-gate-prefill-on-restart.md). Continuing work is a
 * read-and-confirm rather than a re-type of a sentence you already wrote.
 *
 * THIS DOES NOT RELAX ADR-0001, AND THE SHAPE IS WHAT KEEPS IT HONEST. The sheet
 * opens, both fields are visible, both stay editable, both are still REJECTED
 * when empty — clearing a pre-filled field and pressing Start fails exactly as a
 * blank one always did. `Start` remains a deliberate second act.
 *
 * A one-tap Resume that skips this sheet was proposed and withdrawn the same
 * session (brief Risk 1): it is faster, and it removes the gate from every start
 * after the first, which is a superseding-ADR conversation rather than a commit.
 *
 * A pre-filled value is styled IDENTICALLY to typed text — no marker, no
 * dimming, no "from last time" hint. Dimmed text is the universal placeholder
 * convention and would signal "this will not submit", which is the opposite of
 * what happens. The accepted consequence, knowingly retained: nothing on screen
 * marks a three-day-old WHY as old, so a stale one can be read past.
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
import { Button, Field, Input, SegmentedControl, Textarea } from "@/components/ui";
import { useAutoGrow } from "@/components/ui/useAutoGrow";
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
  | { task: Task; topics?: undefined; onCancel?: () => void; onStarted?: () => void }
  | { task?: undefined; topics: Topic[]; onCancel?: () => void; onStarted?: () => void };

export function GateForm({ task, topics, onCancel, onStarted }: GateFormProps) {
  const router = useRouter();
  const newTaskMode = task === undefined;

  const [what, setWhat] = useState(task?.what ?? "");
  const [topicName, setTopicName] = useState("");
  // Prefill on restart (0006). These two lines are unchanged — they always read
  // the task's values; what changed is that the task now HAS them.
  const [why, setWhy] = useState(task?.why ?? "");
  const [finishLine, setFinishLine] = useState(task?.finishLine ?? "");
  // Both fields open at their CSS floor (two rows comfortable, one compact) and
  // grow with what is typed — see `useAutoGrow`. The floor is what preserves the
  // short-viewport brief's "space to write a sentence in"; the growth is what
  // stops a one-line WHY costing two rows in a 500 px window.
  const whyRef = useAutoGrow(why);
  const finishLineRef = useAutoGrow(finishLine);
  // Pre-selected. The architect states the bound; the app invents nothing.
  //
  // BRANCHED ON THE MODE, NOT COALESCED. `task?.checkInIntervalMinutes ?? 60` is
  // the obvious one-liner and it is wrong: `null` here means the architect chose
  // `off`, which Rule 26a makes a first-class answer, so a coalesce would
  // silently re-arm a probe they switched off. New-task mode has nothing to
  // carry and gets the default; existing-task mode gets whatever was chosen last
  // time, `off` included.
  const [interval, setInterval] = useState<CheckInInterval>(
    newTaskMode ? 60 : task.checkInIntervalMinutes,
  );
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
        // Tell the caller to close its Sheet BEFORE navigating. Both call sites
        // (QuickCapture, BacklogList) render this form inside a Sheet whose
        // open/gating state they own, not this component — and QuickCapture's
        // lives in the persistent (app) layout, which does not remount on a
        // client-side navigation. Without this, `open`/`busy` never reset on the
        // success path (only `onCancel` cleared them), so the Sheet sat on
        // screen, spinner frozen, over the session screen rendering invisibly
        // behind it — indistinguishable from a hang.
        onStarted?.();
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
    // COMPACT ON SMALL VIEWPORTS (feature-brief-gate-sheet-short-viewport.md,
    // 2026-08-26; re-expressed through the `compact` variant 2026-09-07). 16 px
    // between five fields is 96 px of rhythm; 10 px is 60 px, and what that
    // returns is most of what keeps `Start` above the fold once the gate raises
    // its inline errors. The threshold is no longer written here — it is the one
    // `@custom-variant compact` in `globals.css`, which `Sheet` reads too, so the
    // two can no longer drift apart. `short-viewport-gate.test.ts` pins it there.
    //
    // NOTHING IS REMOVED. Same five fields, same wording, same rejections. WHY and
    // FINISH LINE keep two rows of writing space on a comfortable viewport and
    // open at one under `compact`, growing on the first wrapped line — the space
    // to write a sentence in is preserved, it is just no longer reserved before
    // there is a sentence. The field count is ADR-0004's ceiling and a rendering
    // pass is not a licence to spend it.
    <div className="space-y-4 compact:flex compact:flex-1 compact:flex-col compact:space-y-2">
      {/*
        A PAIRING ROW (feature-brief-design-system-pass.md, revised 2026-09-07).
        The window this app is used in is 500 × 375–485 — LANDSCAPE — and the
        gate rendered a 439 px column into it, measured, which overflows the
        short end by 64 px while leaving the width empty. WHAT and TOPIC are
        both single-line, so they pair.

        A wrapping row, not a second breakpoint: `min-w-[13rem]` means two
        fields sit side by side while there is room for both and stack on their
        own when there is not, so a narrower window needs no new rule and no
        second threshold to keep in sync with the first.
      */}
      <div className="space-y-4 compact:flex compact:flex-wrap compact:gap-2.5 compact:space-y-0">
      <Field label="What" error={errors.what} className="compact:min-w-[11rem] compact:flex-1">
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
        <Field
          label="Topic"
          hint="type a new name to create it"
          className="compact:min-w-[11rem] compact:flex-1"
        >
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
      </div>

      <Field label="Why" hint="one sentence" error={errors.why}>
        <Textarea
          ref={whyRef}
          rows={1}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          className="min-h-[3.5rem] resize-none overflow-hidden compact:min-h-[2.25rem]"
        />
      </Field>

      <Field label="Finish line" hint="reachable in one sitting" error={errors.finishLine}>
        <Textarea
          ref={finishLineRef}
          rows={1}
          value={finishLine}
          onChange={(e) => setFinishLine(e.target.value)}
          className="min-h-[3.5rem] resize-none overflow-hidden compact:min-h-[2.25rem]"
        />
      </Field>

      {/*
        A SEGMENTED CONTROL, not four buttons in a flex row (2026-09-07). The old
        shape needed ~352 px of `px-4` buttons inside a ~288 px sheet at a 360 px
        window, so "30 min" wrapped onto two lines and the row grew instead of
        fitting. Equal `1fr` columns cannot overflow. Four options, same labels,
        same pre-selection, `Off` still a first-class answer — the only thing that
        changed is that the row is now as wide as the sheet rather than as wide as
        its contents.
      */}
      {/*
        THE SLACK. Same growing spacer as the session screen, and for the same
        reason: `space-y-*` sets `margin-top` at a higher specificity than
        `mt-auto`, so an auto margin would lose silently and the action row would
        sit wherever the fields happened to end — which in a 430 px window left
        180 px of nothing beneath it.
      */}
      <div aria-hidden className="hidden compact:block compact:flex-1" />

      {/*
        The second pairing row, now the panel's FOOTER: the interval sits beside
        the buttons, on the floor, behind a rule. `Start` then lands in the same
        place every time instead of moving with the length of the form. Same
        mechanism, same fallback. `items-end` aligns `Start` with the bottom of
        the segmented control rather than with its label.

        `errors.form` stays BETWEEN them in source order, exactly where it was,
        and carries `compact:w-full` so a form-level error takes its own line and
        pushes the buttons below it. That costs the pairing on the rare path
        where the server refused the start — which is the path where the message
        should be the widest thing on screen anyway.
      */}
      <div className="space-y-4 compact:flex compact:flex-wrap compact:items-end compact:gap-2.5 compact:space-y-0 compact:border-t compact:border-border compact:pt-2.5">
        <Field
          label="Check in every"
          hint="the app asks; it never decides"
          className="compact:min-w-[11rem] compact:flex-1"
        >
          <SegmentedControl
            options={INTERVALS}
            value={interval}
            onChange={setInterval}
            disabled={busy}
          />
        </Field>

        {errors.form !== undefined && (
          <p className="text-xs text-red-600 compact:w-full">{errors.form}</p>
        )}

        <div className="space-y-4 compact:flex compact:min-w-[11rem] compact:flex-1 compact:gap-2 compact:space-y-0">
          <Button
            onClick={() => void start()}
            pending={busy}
            className="w-full py-3 compact:flex-1 compact:py-2"
          >
            Start
          </Button>

          {onCancel !== undefined && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={busy}
              className="w-full compact:w-auto compact:flex-none"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
