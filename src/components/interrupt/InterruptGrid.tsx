"use client";

/**
 * THE SEVEN-CELL INTERRUPT TAP.
 *
 * Budget: ONE TAP, two for `filler`. That is the whole design constraint, and A8
 * is the assumption it rests on. Anything beyond this is friction at the worst
 * possible moment and the model fails on adoption.
 *
 *   ┌─────────┬─────────┬─────────┐
 *   │   PR    │  Alert  │   DM    │   these five write kind='pulled'
 *   ├─────────┼─────────┼─────────┤   AND interruptTag in ONE gesture
 *   │ Meeting │  Other  │    ·    │
 *   └─────────┴─────────┴─────────┘
 *   ┌─────────────────────────────┐
 *   │           Filler            │ → kind='filler'; ONE more tap for the wait
 *   ├─────────────────────────────┤
 *   │         I drifted           │ → closes the parent `drifted`. Starts NOTHING.
 *   └─────────────────────────────┘
 *
 * `Filler` is on its own row for a reason: in an earlier draft it sat beside
 * `Meeting` and `Other` under one arrow, which read as though all three produced a
 * filler session. Only the one cell does — `Meeting` and `Other` are two of the
 * five `pulled` tags (Gap 24c).
 *
 * `I drifted` starts no session, because DRIFT IS NOT A KIND. It is a `status`
 * (`drifted`), a `kindCorrectedTo` value and a day-split bucket. The `kind` enum
 * has exactly three members and never gains a fourth (Rule 16).
 *
 * No `kind` is ever written without an explicit choice among these seven — there
 * is no silent default any more (Rule 21, retitled by Gap 24b).
 */

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { measure } from "@/lib/perf";
import { Button, Input } from "@/components/ui";
import type { InterruptTag, Session } from "@/types/db";

const PULLED_CELLS: { tag: InterruptTag; label: string }[] = [
  { tag: "pr", label: "PR" },
  { tag: "alert", label: "Alert" },
  { tag: "dm", label: "DM" },
  { tag: "meeting", label: "Meeting" },
  { tag: "other", label: "Other" },
];

/** Rule 18 — one tap for the wait. */
const WAITS = [2, 5, 10, 30] as const;

/**
 * What a filler writes when the activity field is left blank.
 *
 * It is an ANSWER to "what will you do while you wait?" — the answer being
 * *nothing* — not a restatement of the blockage. Exported because `SessionView`
 * needs to recognise an unnamed filler to avoid echoing it back as though it were
 * an activity; keeping ONE definition is what stops the two drifting apart.
 */
export const UNNAMED_FILLER = "Just waiting";

export function InterruptGrid({
  parentSessionId,
  onStarted,
  onDrifted,
}: {
  parentSessionId: string | null;
  onStarted: (session: Session) => void;
  onDrifted: () => void;
}) {
  const [pickingWait, setPickingWait] = useState(false);
  const [description, setDescription] = useState("");
  /**
   * WHICH cell is in flight, not merely that one is.
   *
   * The tap budget here is one gesture (two for `filler`), which makes this the
   * worst place in the app to leave a tap unacknowledged: the whole point is that
   * classifying an interrupt costs nothing at the moment it arrives, and an
   * unresponsive-looking grid is what turns one tap into three. Naming the busy
   * cell lets the pressed one spin while the rest go inert.
   */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(cell: string, fn: () => Promise<void>) {
    if (busy !== null) return;
    setBusy(cell);
    setError(null);
    try {
      await measure("interruptTap", fn);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that.");
    } finally {
      setBusy(null);
    }
  }

  /** One gesture writes BOTH `kind` and `interruptTag` — the tag costs nothing. */
  const startPulled = (tag: InterruptTag, label: string) =>
    run(tag, async () => {
      const session = await api.post<Session>("/api/sessions", {
        kind: "pulled",
        what: label,
        interruptTag: tag,
        parentSessionId,
      });
      onStarted(session);
    });

  const startFiller = (waitMinutes: number) =>
    run(`filler:${waitMinutes}`, async () => {
      const session = await api.post<Session>("/api/sessions", {
        kind: "filler",
        what: description.trim() || UNNAMED_FILLER,
        parentSessionId,
        waitMinutes,
      });
      setPickingWait(false);
      setDescription("");
      onStarted(session);
    });

  /** Closes the parent `drifted`. Starts no session — see Rule 16. */
  const recordDrift = () =>
    run("drift", async () => {
      if (parentSessionId === null) return;
      await api.patch<Session>(`/api/sessions/${parentSessionId}`, {
        status: "drifted",
        outcomeNote: null,
      });
      onDrifted();
    });

  if (pickingWait) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">How long is the wait?</p>
        {/* THE FIELD NAMES THE ACTIVITY, NOT THE BLOCKAGE — it asks what you will DO
         * while you wait, not what the wait is about. That is what makes the row
         * answer "what did you do?" in the log, and what makes promotion coherent:
         * `promote` carries this string into the new Task's title, so a filler that
         * turns out to be the real work is named after the work rather than after
         * whatever was blocking.
         *
         * Optional, and blank writes "Just waiting" — an ANSWER meaning *nothing*,
         * not a restatement of the old question. Auto-focused so typing costs
         * nothing, but a wait-duration tap is still required either way: the two-tap
         * budget (Rule 11 / A8) is untouched, and making this field required is the
         * one change that would break it. */}
        <Input
          autoFocus
          placeholder="What will you do while you wait? (optional)"
          maxLength={200}
          disabled={busy !== null}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-4 gap-2">
          {WAITS.map((m) => (
            <Button
              key={m}
              variant="ghost"
              pending={busy === `filler:${m}`}
              disabled={busy !== null}
              onClick={() => void startFiller(m)}
            >
              {m} min
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setPickingWait(false);
            setDescription("");
          }}
        >
          Back
        </Button>
        {error !== null && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Something came up</p>

      <div className="grid grid-cols-3 gap-2">
        {PULLED_CELLS.map((cell) => (
          <Button
            key={cell.tag}
            variant="ghost"
            pending={busy === cell.tag}
            disabled={busy !== null}
            className="py-4"
            onClick={() => void startPulled(cell.tag, cell.label)}
          >
            {cell.label}
          </Button>
        ))}
        {/* Keeps the grid square. Not a target. */}
        <div aria-hidden className="rounded-lg border border-dashed border-neutral-200 dark:border-neutral-800" />
      </div>

      <Button
        variant="ghost"
        disabled={busy !== null || parentSessionId === null}
        className="w-full py-3"
        onClick={() => setPickingWait(true)}
      >
        Filler
      </Button>

      <Button
        variant="ghost"
        pending={busy === "drift"}
        disabled={busy !== null || parentSessionId === null}
        className="w-full py-3"
        onClick={() => void recordDrift()}
      >
        I drifted
      </Button>

      {error !== null && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
