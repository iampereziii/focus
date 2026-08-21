"use client";

/**
 * QUICK CAPTURE IS NOW THE GATE (ADR-0004, 2026-08-20).
 *
 * It used to write a Task to the backlog and stop there — `what` + a topic, and
 * starting it was a separate trip to `/`. Rule 9 ("capture is cheap; starting is
 * gated") is RETIRED: the architect keeps their backlog in another tool, so a
 * task typed here and not started was never a parked idea. It was a start that
 * didn't happen, accumulating in the app that exists to cause starts.
 *
 * So: ENTERING A FOCUS STARTS IT. One sheet, one act, straight to the timer.
 *
 * WHAT DID NOT CHANGE, AND MUST NOT
 *
 * The problem being solved is still NOT STARTING. The manual version of this
 * protocol was written on paper and rejected the same day, and every budget
 * below is aimed at that:
 *   · the sheet still opens in UNDER 150 ms from keypress — nothing is fetched
 *     at open, topics are still loaded eagerly, and `GateForm` fetches nothing
 *     at mount;
 *   · the whole start still has to land inside the 20-SECOND BUILD GATE, which
 *     is the thing that blocks ship;
 *   · the topic is still PRE-FILLED and overridable, so the common path costs
 *     zero taps for it — same argument as the check-in interval.
 *
 * Not a route, on purpose: a global sheet reachable by keyboard from anywhere.
 *
 * ── ⌘K WHILE A SESSION IS RUNNING ───────────────────────────────────────────
 *
 * It goes to the running session; it does not open this sheet. Opening the gate
 * there would be a guaranteed dead end — Rule 1 rejects the start with a 409, so
 * the shortcut's only possible outcome would be an error message.
 *
 * It also does NOT open the interrupt grid, which was the first design. Review
 * killed that: `SessionView` already renders `InterruptGrid` unconditionally, so
 * a chord to reach it saves nothing on the session screen — and from `/log` it
 * would aim a one-tap, unconfirmed, IRREVERSIBLE `I drifted` (which closes the
 * session; Rule 5 makes that permanent, and the correction route no longer
 * exists) at a session not visible on the page you pressed it from. Navigating
 * lands the architect on the screen where that grid already lives, with the
 * session in front of them. Do not rebind this to a destructive control.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Sheet } from "@/components/ui";
import { GateForm } from "@/components/session/GateForm";
import type { Session, Topic } from "@/types/db";

export function QuickCapture({
  active = null,
  onCaptured,
}: {
  /**
   * The running session, or null — resolved SERVER-SIDE by `(app)/layout.tsx`
   * and handed down through `AppShell`.
   *
   * It is a prop and not a fetch on purpose. Deciding what ⌘K does by asking
   * `/api/sessions/active` first would put a network round trip in front of the
   * sheet opening, and the 150 ms open budget is measured FROM THE KEYPRESS.
   * The shell already knows the answer; asking again would spend the budget to
   * learn nothing.
   */
  active?: Session | null;
  onCaptured?: () => void;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Loaded eagerly so opening the sheet is never waiting on a fetch — the 150 ms
  // budget is measured from keypress, not from data arriving. A topic created
  // inline invalidates `topics`, so this list is current on the NEXT open.
  const { data: topics = [] } = useLive<Topic[]>("topics", () => api.get<Topic[]>("/api/topics"));

  // `onCaptured` is still wired and still called. `/` is a Server Component, so
  // a client component can't invalidate its data on its own — `AppShell` passes
  // `router.refresh()` here. Post-ADR-0004 a successful start navigates away,
  // but the architect comes back to `/` after closing out, and the task created
  // during the start has to be there when they do.
  const openGate = useCallback(() => {
    // Synchronous, so the sheet paints on the same interaction as the keypress.
    if (active !== null) {
      router.push(`/session/${active.id}`);
      return;
    }
    setOpen(true);
  }, [active, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Reachable from every page. `n` alone would fight text entry, so it is
      // modified — but it is still one chord, not a menu dive.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openGate();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGate]);

  return (
    <>
      <button
        onClick={openGate}
        aria-label="Start a focus"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-neutral-900 text-2xl text-white shadow-lg dark:bg-white dark:text-neutral-900"
      >
        +
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Start a focus">
        {/*
          The gate, in new-task mode. ONE implementation serves both targets —
          `/`'s existing-task path renders the same component. If you are about
          to add a field to one and not the other, stop: that is the gate
          forking, and the laxer branch becomes the one that gets used.
        */}
        <GateForm
          topics={topics}
          onCancel={() => {
            setOpen(false);
            onCaptured?.();
          }}
        />
      </Sheet>
    </>
  );
}
