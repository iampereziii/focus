"use client";

/**
 * A DISPLAY-ONLY clock.
 *
 * This file exists separately, and contains no session logic whatsoever, so that
 * the Rule 7 guardrail can tell it apart from anything that ends a session. It
 * returns a number for rendering. It cannot close, classify, or change a session,
 * because it has no access to one.
 *
 * Nothing here is accumulated or persisted. Elapsed time is ALWAYS derived from
 * `startedAt` — a backgrounded PWA has no guaranteed timer, so a stored count
 * would drift (ADR-0002). Background this tab for an hour and the number is still
 * right, because it was never counting.
 */

import { useEffect, useState } from "react";

/**
 * `tickMs` — HOW OFTEN THE DISPLAY CAN CHANGE, which is not always once a second.
 *
 * The app-shell indicator renders MINUTE resolution (`formatDuration`), so 59 of
 * every 60 ticks re-rendered the nav chrome of every page to paint an identical
 * string. Callers state the resolution they actually show.
 *
 * This changes no measured latency and is not pretending to (brief Finding 9,
 * recorded as craft). It is here because a subtree re-rendering 60×/minute makes
 * the 100 ms tap-feedback budget harder to hold than it needs to be.
 */
export function useElapsed(startedAtIso: string, tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(tick);
  }, [tickMs]);

  return Math.max(0, now - Date.parse(startedAtIso));
}
