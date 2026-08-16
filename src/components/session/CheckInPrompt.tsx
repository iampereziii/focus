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
import { Button } from "@/components/ui";
import type { CheckIn, CheckInAnswer, Session } from "@/types/db";

export function CheckInPrompt({
  session,
  onDone,
  onDrifted,
  onAnswered,
}: {
  session: Session;
  onDone: () => void;
  onDrifted: () => void;
  onAnswered: () => void;
}) {
  const [pending, setPending] = useState<CheckIn | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (pending === null || busy) return;
      setBusy(true);
      try {
        await api.patch<CheckIn>(`/api/checkins/${pending.id}`, { answer: value });
        setPending(null);
        // The answer is recorded here; the CONSEQUENCE is an explicit act by the
        // architect. This component never closes a session itself.
        if (value === "done") onDone();
        else if (value === "drifted") onDrifted();
        else onAnswered();
      } finally {
        setBusy(false);
      }
    },
    [pending, busy, onDone, onDrifted, onAnswered],
  );

  if (pending === null) return null;

  return (
    <div className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <p className="text-sm font-medium">Still on “{session.what}”?</p>
      <div className="mt-3 flex gap-2">
        <Button disabled={busy} onClick={() => void answer("yes")}>
          Yes
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void answer("done")}>
          Done
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void answer("drifted")}>
          I drifted
        </Button>
      </div>
      <p className="mt-2 text-xs opacity-60">
        Ignoring this changes nothing about the session — it only stops counting the
        silence as focused time.
      </p>
    </div>
  );
}
