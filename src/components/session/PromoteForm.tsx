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
import { Button, Field, Input, Textarea } from "@/components/ui";
import type { CheckInInterval, Session } from "@/types/db";

const INTERVALS: { value: CheckInInterval; label: string }[] = [
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
  { value: null, label: "Off" },
];

type GrandparentStatus = "partial" | "abandoned";

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
    <div className="space-y-4">
      <Field label="What">
        <Input value={filler.what} readOnly className="opacity-70" />
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

      <Field label="Check in every" hint="inherited from this session — change it if you want">
        <div className="flex gap-2">
          {INTERVALS.map((opt) => (
            <Button
              key={String(opt.value)}
              variant={checkIn === opt.value ? "primary" : "ghost"}
              onClick={() => setCheckIn(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </Field>

      {filler.parentSessionId !== null && (
        <Field
          label={
            parentWhat === null
              ? "The session this interrupted closes as"
              : `“${parentWhat}” closes as`
          }
          hint="promoting ends it — say how it ended"
        >
          <div className="flex gap-2">
            {(["partial", "abandoned"] as const).map((s) => (
              <Button
                key={s}
                variant={grandparentStatus === s ? "primary" : "ghost"}
                onClick={() => setGrandparentStatus(s)}
              >
                {s === "partial" ? "Partial" : "Abandoned"}
              </Button>
            ))}
          </div>
        </Field>
      )}

      {errors.form !== undefined && <p className="text-xs text-red-600">{errors.form}</p>}

      <div className="flex gap-2">
        <Button onClick={() => void promote()} pending={busy} className="flex-1 py-3">
          Promote to real work
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  );
}
