"use client";

/**
 * PROMOTION — "this filler turned out to be the real work."
 *
 * Reachable from exactly one place: the filler re-arm cap panel, which is where
 * Rule 18 put it. There is no promote button on an ordinary session, and adding
 * one would make promotion an ordinary move rather than a disposition.
 *
 * PROMOTION IS THE GATE, NOT A BYPASS OF IT. `why` and `finishLine` are required
 * here for the same reason they are required at `/` — the new row is `kind =
 * 'focus'` and must satisfy the same CHECK as any other focus session (Rules 2/3;
 * the route returns 422 without them). The check-in interval is PRE-SELECTED from
 * the filler's inherited value (Rule 26f), so the common path costs zero extra
 * taps even though the field is present.
 *
 * NO `kind` IS MUTATED, HERE OR ANYWHERE (Gap 26). The four effects — close the
 * filler `switched`, create a Task, insert the new `focus` row parented to the
 * closed filler, close the grandparent — are ONE server-side transaction behind
 * this ONE form. That is the whole reason the two-row shape is affordable: the
 * user pays for one form, and the log still records the switch instead of
 * swallowing it.
 *
 * The grandparent's disposition is asked here because promotion closes it, and an
 * app that picks `partial` or `abandoned` on the architect's behalf is deciding
 * rather than asking (Rule 7). `partial` is pre-selected as the honest default —
 * the work existed and was interrupted; it was not abandoned by choice.
 */

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { moveScratchDraft } from "@/lib/scratch-draft";
import { Button, Field, Input, SegmentedControl, Textarea } from "@/components/ui";
import { useAutoGrow } from "@/components/ui/useAutoGrow";
import type { CheckInInterval, Session } from "@/types/db";

const INTERVALS: { value: CheckInInterval; label: string }[] = [
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
  { value: null, label: "Off" },
];

type GrandparentStatus = "partial" | "abandoned";

/**
 * The grandparent's two honest dispositions, in the order they are offered.
 * `partial` first because it is the pre-selected default — the work existed and
 * was interrupted; it was not abandoned by choice.
 */
const GRANDPARENT_STATUSES: readonly { value: GrandparentStatus; label: string }[] = [
  { value: "partial", label: "Partial" },
  { value: "abandoned", label: "Abandoned" },
];

export function PromoteForm({
  filler,
  parentWhat,
  onPromoted,
  onCancel,
}: {
  filler: Session;
  /** The grandparent's `what`, so the form can NAME what it is about to close. */
  parentWhat: string | null;
  onPromoted: (promoted: Session) => void;
  onCancel: () => void;
}) {
  const [why, setWhy] = useState("");
  const [finishLine, setFinishLine] = useState("");
  // Same floor-and-grow as the gate's two fields — this IS the gate, reached by
  // another door (see the header), so it gets the same writing space.
  const whyRef = useAutoGrow(why);
  const finishLineRef = useAutoGrow(finishLine);
  /**
   * Rule 26f — inherited, not invented. `null` is a real inherited value (off).
   *
   * Named `checkIn`, not `interval`, unlike `GateForm`: promotion ends two
   * sessions, and Rule 7's guardrail refuses to let any file that ends a session
   * also contain the token `setInterval`. Shadowing a global timer name in a file
   * with a close path is exactly the adjacency that check exists to prevent, so
   * the guardrail is obeyed rather than exempted.
   */
  const [checkIn, setCheckIn] = useState<CheckInInterval>(filler.checkInIntervalMinutes);
  const [grandparentStatus, setGrandparentStatus] =
    useState<GrandparentStatus>("partial");
  const [errors, setErrors] = useState<{
    why?: string;
    finishLine?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  async function promote() {
    if (busy) return;
    const next: typeof errors = {};
    if (why.trim() === "") next.why = "One sentence. If you can't write it, don't start.";
    if (finishLine.trim() === "") next.finishLine = "How will you know you're done?";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const promoted = await api.post<Session>(
        `/api/sessions/${filler.id}/promote`,
        {
          why: why.trim(),
          finishLine: finishLine.trim(),
          checkInIntervalMinutes: checkIn,
          grandparentStatus,
        },
      );
      // Brief Risk 2 — the thought doesn't break mid-sentence. `promote_filler`
      // itself is untouched; this is client-side only, and the filler's own row
      // keeps no scratch note (it never had a close-out form to write one).
      moveScratchDraft(filler.id, promoted.id);
      onPromoted(promoted);
    } catch (err) {
      setErrors({
        form:
          err instanceof ApiError
            ? err.message
            : "Nothing was promoted — this session is still open and unchanged.",
      });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 compact:space-y-2.5">
      <Field label="What">
        <Input value={filler.what} readOnly className="opacity-70" />
      </Field>

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
        The two segmented fields pair, same mechanism as the gate's (see
        `GateForm`): a wrapping row with a min-width, so they sit side by side in
        the 500 px window this app is used in and stack on their own when there
        is no room. When the filler has no parent, the interval is alone on the
        row and simply fills it.
      */}
      <div className="space-y-4 compact:flex compact:flex-wrap compact:items-end compact:gap-2.5 compact:space-y-0">
      <Field
        label="Check in every"
        hint="inherited from this session — change it if you want"
        className="compact:min-w-[13rem] compact:flex-1"
      >
        <SegmentedControl options={INTERVALS} value={checkIn} onChange={setCheckIn} disabled={busy} />
      </Field>

      {filler.parentSessionId !== null && (
        <Field
          label={
            parentWhat === null
              ? "The session this interrupted closes as"
              : `“${parentWhat}” closes as`
          }
          hint="promoting ends it — say how it ended"
          className="compact:min-w-[13rem] compact:flex-1"
        >
          <SegmentedControl
            options={GRANDPARENT_STATUSES}
            value={grandparentStatus}
            onChange={setGrandparentStatus}
            disabled={busy}
          />
        </Field>
      )}
      </div>

      {errors.form !== undefined && (
        <p className="text-xs text-red-600 compact:text-[0.6875rem]">{errors.form}</p>
      )}

      <div className="flex gap-2">
        <Button onClick={() => void promote()} pending={busy} className="flex-1 py-3 compact:py-2">
          Promote to real work
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  );
}
