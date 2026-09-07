"use client";

/**
 * RULE 26 — THE CHECK-IN PROBE. "Still on <what>?"
 *
 * THE APP ASKS; IT NEVER DECIDES.
 *
 * This is the one thing that GREW BACK after the v1 cuts, and it was checked
 * against research before being accepted: thought probes are the standard
 * instrument for catching off-task episodes self-report misses, because people are
 * meta-aware of only a small proportion of their own. It is the strongest of the
 * three drift-capture paths — and it does not suppress the other two, which is why
 * the interrupt grid keeps its `I drifted` cell.
 *
 * What it must never become:
 *   26b — no auto-close, no auto-classify, no escalation. An unanswered prompt is
 *         SILENCE, and silence changes nothing about the session. Rule 7 has no
 *         exceptions and this is not one.
 *   26d — this is ACTIVE, not passive. ADR-0003 rejects the app inferring your
 *         state from silence, because that misclassifies thinking, reading and
 *         whiteboarding as idle — which for this app is the highest-value state.
 *         Asking cannot make that mistake, because you answer.
 *   26e — every prompt writes a CheckIn row, ANSWERED OR NOT. An unanswered one
 *         becomes an `unaccounted` window that Rule 22 subtracts. The app never
 *         acts on silence, but it does stop crediting it.
 *
 * The interval is the session's own, stated at the gate. `null` means off, and a
 * session with it off simply never gets a prompt (this component renders nothing).
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SegmentedControl } from "@/components/ui";
import type { CheckIn, CheckInAnswer, Session } from "@/types/db";

/**
 * Rule 26's three answers, in the order they are offered. `drifted` here is a
 * STATUS and a correction, never a fourth `kind` (CLAUDE.md § 12).
 */
const ANSWERS: readonly { value: CheckInAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "done", label: "Done" },
  { value: "drifted", label: "I drifted" },
];

export function CheckInPrompt({
  session,
  onDone,
  onDrifted,
  onAnswered,
  closing = false,
}: {
  session: Session;
  onDone: () => void;
  onDrifted: () => void;
  onAnswered: () => void;
  /**
   * True while the parent screen has a close-out in flight. `I drifted` here
   * closes the session through that same path, so without this the prompt's
   * buttons stay live during a write they already started — and a second tap
   * would land on `close()`'s guard with nothing on screen explaining why.
   */
  closing?: boolean;
}) {
  const [pending, setPending] = useState<CheckIn | null>(null);
  const [busy, setBusy] = useState<CheckInAnswer | null>(null);

  const interval = session.checkInIntervalMinutes;

  useEffect(() => {
    // `off` is a legitimate choice — nothing is armed and nothing is inferred.
    if (interval === null || session.status !== "active") return;

    const tick = window.setInterval(() => {
      const silentMs = Date.now() - Date.parse(session.lastInteractionAt);
      if (silentMs < interval * 60_000 || pending !== null) return;

      // Record the prompt BEFORE it is answered. That ordering is the mechanism:
      // the unanswered row is what marks the window.
      api
        .post<CheckIn>(`/api/sessions/${session.id}/checkins`)
        .then(setPending)
        .catch(() => {
          /* A failed prompt is silence, and silence changes nothing (26b). */
        });
    }, 30_000);

    return () => window.clearInterval(tick);
  }, [interval, session.id, session.status, session.lastInteractionAt, pending]);

  const answer = useCallback(
    async (value: CheckInAnswer) => {
      if (pending === null || busy !== null) return;
      setBusy(value);
      try {
        await api.patch<CheckIn>(`/api/checkins/${pending.id}`, { answer: value });
        setPending(null);
        // The answer is recorded here; the CONSEQUENCE is an explicit act by the
        // architect. This component never closes a session itself.
        if (value === "done") onDone();
        else if (value === "drifted") onDrifted();
        else onAnswered();
      } finally {
        setBusy(null);
      }
    },
    [pending, busy, onDone, onDrifted, onAnswered],
  );

  if (pending === null) return null;

  return (
    <div className="rounded-lg border border-neutral-300 p-4 compact:rounded-md compact:p-2 dark:border-neutral-700">
      {/*
        ONE ROW UNDER `compact` — question left, the three answers right. This
        prompt is the most expensive state the session screen has, and stacking
        the question above a full-width control spent ~50 px of a window that is
        375 px tall at its shortest. The question truncates; the session's name
        is the heading directly above it either way.
      */}
      <div className="compact:flex compact:items-center compact:gap-2.5">
      <p className="text-sm font-medium compact:min-w-0 compact:flex-1 compact:truncate compact:text-xs">
        Still on “{session.what}”?
      </p>
      {/*
        THREE ANSWERS, EQUAL WEIGHT (2026-09-07). `Yes` used to be the only
        `primary` of the three, which put the app's thumb on one answer to its own
        question — and 26d is explicit that this probe is worth having precisely
        BECAUSE you answer it rather than the app inferring. An action row states
        the three and fills none.

        The row also cannot wrap now, which matters here more than anywhere: this
        prompt appears unannounced, mid-work, in whatever window happens to be open.
      */}
      <div className="mt-3 compact:mt-0 compact:w-[13rem] compact:shrink-0">
        <SegmentedControl
          label={`Still on ${session.what}?`}
          options={ANSWERS}
          onChange={(value) => void answer(value)}
          pending={busy}
          disabled={closing}
        />
      </div>
      </div>
      <p className="mt-2 text-xs opacity-60 compact:mt-1 compact:text-[0.6875rem]">
        Ignoring this changes nothing about the session — it only stops counting the
        silence as focused time.
      </p>
    </div>
  );
}
