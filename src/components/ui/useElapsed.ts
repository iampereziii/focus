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

export function useElapsed(startedAtIso: string): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return Math.max(0, now - Date.parse(startedAtIso));
}
