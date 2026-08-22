"use client";

/**
 * THE BUDGETS, AND THE ONLY THING THAT MEASURES THEM.
 *
 * Before this file, every performance claim in the app was a comment. ADR-0001
 * budgets "under 1 second from gate submit to a running timer" and Rule 9 budgets
 * "quick capture opens in under 150 ms" — both asserted, neither instrumented, so
 * if either were being missed nobody would know. That is the gap this closes
 * (feature-brief-write-path-latency-and-in-flight-feedback.md, Slice F).
 *
 * DELIBERATELY DEPENDENCY-FREE. `performance.now()`, a named span, a console line.
 * No analytics SDK: it would be a new dependency and a second network write path,
 * in an app whose entire latency problem is that it already makes too many
 * requests. It would also be the first thing in the app reporting the architect's
 * behaviour to a third party, which is not a trade a personal focus tool should
 * make for a number you can read in the console.
 *
 * NOT A CACHE, NOT A TIMER, AND IT CHANGES NOTHING. It observes. Nothing here may
 * ever gate, retry, close or classify anything — a measurement that can act is a
 * Rule 7 problem wearing a stopwatch.
 */

/**
 * Warm-connection budgets, in milliseconds. Revising one is a one-line change
 * here — that is the point of them living in code rather than in prose.
 *
 * `tapFeedback` is the spine of the brief and the only one met by RENDERING
 * rather than by the network: 100 ms is the threshold below which a response
 * reads as instantaneous, so every write control must show something within it
 * regardless of how long the write itself takes.
 *
 * Cold starts are measured but deliberately have no budget (brief Risk 8) — a
 * cold Vercel lambda is a platform property this app has no lever on, and folding
 * it into a warm target would make every number unreadable.
 */
export const BUDGETS = {
  /** Any data-processing tap → a visible state change. */
  tapFeedback: 100,
  /** Gate submit → running timer. ADR-0001's budget, unchanged, now measured. */
  gateSubmit: 1_000,
  /** Interrupt cell tap → the child session screen. */
  interruptTap: 1_000,
  /** Close-out tap → the next screen is usable. */
  closeOut: 1_500,
  // `captureCommit: 500` — RETIRED 2026-08-20 with Rule 9 (ADR-0004). It timed
  // the `Capture` tap → sheet closed and task exists. There is no such tap any
  // more: ⌘K opens the gate, so committing a new task IS a gate submit and is
  // measured as one, navigation and all. Removed rather than left at zero call
  // sites, because a budget nothing reports against is a number that can only
  // ever look met.
} as const;

export type Budget = keyof typeof BUDGETS;

/**
 * The first span after a page load is reported as `cold`, every later one as
 * `warm`. Crude on purpose: it separates the sample that may have paid for a
 * lambda spin-up from the samples the budgets actually apply to, which is the
 * whole of what Risk 8 asked for.
 */
let seenFirstSpan = false;

/**
 * Times `run`, reports it against its budget, and returns whatever `run`
 * returned. Errors propagate untouched and are still reported — a write that
 * fails slowly is exactly the case worth seeing.
 */
export async function measure<T>(budget: Budget, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const warmth = seenFirstSpan ? "warm" : "cold";
  seenFirstSpan = true;
  try {
    return await run();
  } finally {
    report(budget, performance.now() - startedAt, warmth);
  }
}

function report(budget: Budget, elapsedMs: number, warmth: "warm" | "cold"): void {
  const target = BUDGETS[budget];
  const rounded = Math.round(elapsedMs);
  // A cold sample is never called a miss: it has no budget to miss (Risk 8).
  const verdict = warmth === "cold" ? "cold — no budget" : rounded <= target ? "met" : "MISSED";
  console.info(`[focus:perf] ${budget} ${rounded}ms / ${target}ms budget — ${verdict}`);
}
