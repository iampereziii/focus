"use client";

/**
 * The running clock, ISOLATED INTO ITS OWN LEAF.
 *
 * `SessionView` used to call `useElapsed` itself, so the 1 Hz tick re-rendered
 * its entire subtree — the check-in prompt, the seven-cell interrupt grid, the
 * promote form, the close-out textarea — sixty times a minute to change two
 * digits. React absorbed that fine at this component count, and it was never why
 * a click felt slow: the latency is network, not render (brief Finding 9). It is
 * cleaned up as craft, in a file that was open anyway.
 *
 * Same rule as `useElapsed.ts` and for the same reason: this file has no access
 * to a session and no write path, so nothing here can end, classify or change one
 * (Rule 7). It formats a number.
 */

import { formatElapsed } from "@/components/ui";
import { useElapsed } from "@/components/ui/useElapsed";

export function ElapsedClock({
  startedAt,
  className = "",
}: {
  startedAt: string;
  className?: string;
}) {
  const elapsed = useElapsed(startedAt);
  return <p className={className}>{formatElapsed(elapsed)}</p>;
}
