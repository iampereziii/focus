/**
 * `lib/facts/` — PURE AND DETERMINISTIC.
 *
 * Date math, counts, the five-bucket day split, derived focused time. Computed
 * in code, unit-tested, NO I/O beyond reads passed in as arguments. If something
 * needs judgment, it isn't a fact (Rule 11, Convention #7).
 *
 * In v1 this folder has EXACTLY ONE CONSUMER: `/api/review/today`. Keeping it
 * pure is what makes the v1.1 AI layer addable without rework — treat it as a
 * seam, the way `lib/store/` is the offline seam.
 *
 * THERE IS NO AI IN v1. No SDK, no `lib/ai/`, no API key, no model call. The
 * layer was cut deliberately (spec Gaps 3 & 4): the problem is flattening and
 * protection, not ranking, and there is no logged data to rank against yet. If a
 * task here looks like it wants a model, it is a v1.1 question.
 */

import type { CheckIn, Session } from "@/types/db";

// ── The day split ─────────────────────────────────────────────────────────────

/**
 * FIVE buckets. Not four.
 *
 * `unaccounted` carries BOTH of Rule 24's sources — day-boundary tails AND
 * unanswered check-in windows. They share one bucket rather than earning a sixth
 * because they are the same phenomenon: a stretch the app cannot honestly credit.
 * They stay distinguishable in the data (an unanswered window has a CheckIn row
 * behind it; a tail does not), so review can label them without splitting the
 * bucket.
 */
export const DAY_SPLIT_BUCKETS = [
  "focused",
  "pulled",
  "filler",
  "drift",
  "unaccounted",
] as const;

export type DaySplitBucket = (typeof DAY_SPLIT_BUCKETS)[number];

/** Milliseconds per bucket. */
export type DaySplit = Record<DaySplitBucket, number>;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Session duration = `endedAt − startedAt`.
 *
 * There is NO STORED TIMER and no client-side running clock (ADR-0002): a
 * backgrounded PWA has no guaranteed timer. An open session (`endedAt === null`)
 * is measured against `now` by the caller, never persisted.
 */
export function durationMs(startedAt: string, endedAt: string | null, now: Date): number {
  const start = Date.parse(startedAt);
  const end = endedAt === null ? now.getTime() : Date.parse(endedAt);
  return Math.max(0, end - start);
}

/**
 * The windows Rule 22 subtracts and Rule 24 buckets as `unaccounted`.
 *
 * An UNANSWERED check-in marks `promptedAt` → the next `answeredAt` (or the
 * session close) as time never confirmed. Answered check-ins subtract nothing —
 * they are the positive signal.
 *
 * A session run with the check-in `off` produces no rows and gets no
 * subtraction, so its focused time reads high. That is the visible cost of a
 * choice made at the gate, not a bug to fix.
 *
 * `checkIns` must be for a single session; the caller sorts nothing — this
 * function does, so it is order-independent and safe to unit-test with fixtures
 * in any order.
 */
export function unansweredWindows(
  checkIns: readonly CheckIn[],
  sessionEndedAt: string | null,
  now: Date,
): { fromMs: number; toMs: number }[] {
  const sorted = [...checkIns].sort(
    (a, b) => Date.parse(a.promptedAt) - Date.parse(b.promptedAt),
  );
  const closeMs = sessionEndedAt === null ? now.getTime() : Date.parse(sessionEndedAt);

  const windows: { fromMs: number; toMs: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.answeredAt !== null) continue;

    // The window runs to the NEXT answer, not the next prompt — an unanswered
    // prompt followed by three more unanswered prompts is one uncredited stretch,
    // not four.
    let toMs = closeMs;
    for (let j = i + 1; j < sorted.length; j++) {
      const later = sorted[j];
      if (later.answeredAt !== null) {
        toMs = Date.parse(later.answeredAt);
        break;
      }
    }
    const fromMs = Date.parse(c.promptedAt);
    if (toMs > fromMs) windows.push({ fromMs, toMs });

    // Skip the unanswered run we just absorbed.
    while (i + 1 < sorted.length && sorted[i + 1].answeredAt === null) i++;
  }
  return windows;
}

/**
 * THE ACCEPTANCE TEST, as a function.
 *
 * The five buckets must sum to the wall time between the day's first `startedAt`
 * and its last `endedAt` — not to a working day, and not to any target the app
 * invents. If they do not balance, something Rule 22 subtracted has no bucket
 * (that is exactly what Gap 21 was).
 *
 * Tolerance is for rounding only; a real imbalance is a defect, not a rounding
 * artefact.
 */
export function splitBalances(
  split: DaySplit,
  wallTimeMs: number,
  toleranceMs = 1000,
): boolean {
  const total = DAY_SPLIT_BUCKETS.reduce((sum, bucket) => sum + split[bucket], 0);
  return Math.abs(total - wallTimeMs) <= toleranceMs;
}

/**
 * The day's wall time: first `startedAt` → last `endedAt`. Open sessions run to
 * `now`. Returns 0 for an empty day.
 */
export function dayWallTimeMs(sessions: readonly Session[], now: Date): number {
  if (sessions.length === 0) return 0;
  let first = Infinity;
  let last = -Infinity;
  for (const s of sessions) {
    first = Math.min(first, Date.parse(s.startedAt));
    last = Math.max(last, s.endedAt === null ? now.getTime() : Date.parse(s.endedAt));
  }
  return Math.max(0, last - first);
}

/**
 * Walks `parentSessionId` upward. Depth 3+ is DISPLAYED AS A WARNING (Rule 20) —
 * a P1 preempting a PR review is correct triage, not a discipline failure. It is
 * never optimised as a workflow and never blocked.
 *
 * A PROMOTED session does not inflate this: its parent is closed in the same
 * transaction, so the walk stops there (Gap 17b).
 */
export function stackDepth(
  sessionId: string,
  byId: ReadonlyMap<string, Session>,
): number {
  let depth = 0;
  let current = byId.get(sessionId)?.parentSessionId ?? null;
  const seen = new Set<string>([sessionId]);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    // A parent that is no longer suspended is not holding this session up — it
    // is lineage, not stack. That is what keeps a promoted session at depth 0.
    if (parent === undefined || parent.status !== "suspended") break;
    depth++;
    current = parent.parentSessionId;
  }
  return depth;
}

// ── Interval arithmetic ───────────────────────────────────────────────────────
// The day split is built by subtracting intervals rather than by adding numbers.
// That is deliberate: every millisecond is attributed to exactly one bucket by
// construction, so `splitBalances()` is an identity rather than an aspiration.

export interface Interval {
  from: number;
  to: number;
}

function clip(interval: Interval, window: Interval): Interval | null {
  const from = Math.max(interval.from, window.from);
  const to = Math.min(interval.to, window.to);
  return to > from ? { from, to } : null;
}

/** Merges overlapping/adjacent intervals into a disjoint, sorted set. */
export function union(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.to > i.from).sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && next.from <= last.to) {
      last.to = Math.max(last.to, next.to);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/** `a` minus every interval in `b`. */
export function subtract(a: Interval, b: readonly Interval[]): Interval[] {
  let remaining: Interval[] = [{ ...a }];
  for (const cut of union(b)) {
    const next: Interval[] = [];
    for (const piece of remaining) {
      if (cut.to <= piece.from || cut.from >= piece.to) {
        next.push(piece);
        continue;
      }
      if (cut.from > piece.from) next.push({ from: piece.from, to: cut.from });
      if (cut.to < piece.to) next.push({ from: cut.to, to: piece.to });
    }
    remaining = next;
  }
  return remaining;
}

export function totalMs(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.to - i.from), 0);
}

function intervalOf(session: Session, now: Date): Interval {
  return {
    from: Date.parse(session.startedAt),
    to: session.endedAt === null ? now.getTime() : Date.parse(session.endedAt),
  };
}

/**
 * THE DAY-SPLIT DENOMINATOR: the union of time actually covered by a session.
 *
 * ⚠️ NOT the same as `dayWallTimeMs()`, and the difference is a spec correction.
 *
 * The acceptance criterion said the five buckets must sum to "the wall time
 * between the day's first `startedAt` and its last `endedAt`". Every bucket is
 * derived from sessions, so any stretch with NO SESSION OPEN — lunch, a gap
 * between a close and the next start — falls inside that span and into no bucket.
 * As written the criterion could not pass on any real day. (Raised by the
 * 2026-08-16 review; it is FOCUS-0's fourth item.)
 *
 * Implemented as the union of covered intervals, which keeps everything the
 * original wording was protecting — it is still measured, still not a working day,
 * still not a target the app invents — while making the sum an identity. Adding a
 * sixth "nothing open" bucket was the alternative, and it contradicts the spec's
 * emphatic "FIVE buckets. Not four."
 *
 * `dayWallTimeMs()` is left untouched: the day's SPAN is a real and different
 * quantity, and the review screen shows both.
 */
export function coveredWallTimeMs(
  sessions: readonly Session[],
  now: Date,
  window?: Interval,
): number {
  const intervals = sessions
    .map((s) => (window === undefined ? intervalOf(s, now) : clip(intervalOf(s, now), window)))
    .filter((i): i is Interval => i !== null);
  return totalMs(union(intervals));
}

/**
 * Rule 22 — FOCUSED TIME IS DERIVED, NEVER STORED. Storing it would let it drift
 * from the tree that justifies it.
 *
 *     parent wall time
 *       − recursive sum of children's durations
 *       − unanswered check-in windows
 *
 * The honest limit, stated rather than fixed: a session run with the check-in
 * `off` produces no windows and gets no subtraction, so its focused time reads
 * high. That is the visible cost of a choice made at the gate.
 */
export function focusedTimeMs(
  session: Session,
  children: readonly Session[],
  checkIns: readonly CheckIn[],
  now: Date,
): number {
  const own = intervalOf(session, now);
  const childIntervals = children.map((c) => intervalOf(c, now));
  const windows = unansweredWindows(checkIns, session.endedAt, now).map((w) => ({
    from: w.fromMs,
    to: w.toMs,
  }));
  return totalMs(subtract(own, [...childIntervals, ...windows]));
}

/**
 * Which bucket a session's own time belongs to.
 *
 * A correction (Rule 21) wins over the original `kind` — that is what the
 * correction is FOR — but the original `kind` on the row is never touched, so the
 * attribution stays auditable. `drifted` status also routes to `drift`: drift is a
 * status, a correction target and a bucket, but NEVER a kind.
 */
function bucketOf(session: Session): DaySplitBucket {
  if (session.kindCorrectedTo !== null) {
    switch (session.kindCorrectedTo) {
      case "focus":
        return "focused";
      case "pulled":
        return "pulled";
      case "filler":
        return "filler";
      case "drift":
        return "drift";
      case "unaccounted":
        return "unaccounted";
    }
  }
  if (session.status === "drifted") return "drift";
  switch (session.kind) {
    case "focus":
      return "focused";
    case "pulled":
      return "pulled";
    case "filler":
      return "filler";
  }
}

/**
 * THE FIVE BUCKETS (Rule 24), for the day containing `dayStart`.
 *
 * `unaccounted` carries BOTH of Rule 24's sources and no others:
 *
 *   (a) a session crossing a DAY BOUNDARY — the tail nobody was present for. A
 *       session that started before this day and runs into it contributes its
 *       slice of this day here, because the app cannot honestly credit hours
 *       nobody was awake for.
 *   (b) an UNANSWERED CHECK-IN WINDOW — `promptedAt` → the next answer or close.
 *
 * They share one bucket rather than earning a sixth because they are the same
 * phenomenon: a stretch the app cannot honestly credit. They stay distinguishable
 * in the data (an unanswered window has a CheckIn row behind it; a tail does not),
 * so review can label them separately without splitting the bucket.
 *
 * INFERENCE IS NOT A SOURCE. A long silent stretch inside an open session is never
 * guessed at and never auto-classified. Passive idle detection stays rejected: it
 * misclassifies thinking, reading and whiteboarding as idle, which for this app is
 * the highest-value state.
 */
export function daySplit(
  sessions: readonly Session[],
  checkIns: readonly CheckIn[],
  dayStart: Date,
  now: Date,
): DaySplit {
  const dayWindow: Interval = {
    from: dayStart.getTime(),
    to: dayStart.getTime() + 24 * 60 * 60 * 1000,
  };

  const split: DaySplit = { focused: 0, pulled: 0, filler: 0, drift: 0, unaccounted: 0 };

  const childrenOf = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.parentSessionId === null) continue;
    const siblings = childrenOf.get(s.parentSessionId) ?? [];
    siblings.push(s);
    childrenOf.set(s.parentSessionId, siblings);
  }

  const checkInsBySession = new Map<string, CheckIn[]>();
  for (const c of checkIns) {
    const rows = checkInsBySession.get(c.sessionId) ?? [];
    rows.push(c);
    checkInsBySession.set(c.sessionId, rows);
  }

  for (const session of sessions) {
    const clipped = clip(intervalOf(session, now), dayWindow);
    if (clipped === null) continue;

    // Source (a): started before this day → the overnight tail.
    if (Date.parse(session.startedAt) < dayWindow.from) {
      split.unaccounted += clipped.to - clipped.from;
      continue;
    }

    // A parent's own time excludes its children's — that is Rule 22's subtraction,
    // and it is what keeps the total from double-counting a suspended stretch.
    const kids = (childrenOf.get(session.id) ?? []).map((c) => intervalOf(c, now));
    const ownPieces = subtract(clipped, kids);

    // Source (b): unanswered check-in windows, clipped to what is left.
    const windows = unansweredWindows(
      checkInsBySession.get(session.id) ?? [],
      session.endedAt,
      now,
    ).map((w) => ({ from: w.fromMs, to: w.toMs }));

    let uncredited = 0;
    let credited = 0;
    for (const piece of ownPieces) {
      const kept = subtract(piece, windows);
      credited += totalMs(kept);
      uncredited += piece.to - piece.from - totalMs(kept);
    }

    split[bucketOf(session)] += credited;
    split.unaccounted += uncredited;
  }

  return split;
}

/**
 * Rule 25, job 4 — DRIFT CAPTURE, as three bare lines with no interpretation.
 *
 * The three paths are additive, not redundant (research: probes do not suppress
 * self-catching), so the split matters:
 *
 *   tap        — you noticed and tapped "I drifted"
 *   probe      — a check-in caught it
 *   correction — day review relabelled it (the WEAKEST path: retrospective recall
 *                reliably under-reports low-salience activity)
 *
 * The probe counts are not decoration. A9's falsifier is "drift ≈ 0 WHILE THE
 * PROBE IS ARMED AND BEING ANSWERED" — a near-zero drift count on its own proves
 * nothing, because low meta-awareness is a documented alternative explanation. The
 * reading is only possible if review states both halves.
 */
export interface DriftCapture {
  byTap: number;
  byProbe: number;
  byCorrection: number;
  sessionsArmed: number;
  sessionsTotal: number;
  promptsAnswered: number;
  promptsTotal: number;
}

export function driftCapturePaths(
  sessions: readonly Session[],
  checkIns: readonly CheckIn[],
): DriftCapture {
  const driftedByProbe = new Set(
    checkIns.filter((c) => c.answer === "drifted").map((c) => c.sessionId),
  );

  let byTap = 0;
  let byProbe = 0;
  let byCorrection = 0;

  for (const s of sessions) {
    if (s.kindCorrectedTo === "drift") {
      byCorrection++;
    } else if (s.status === "drifted") {
      if (driftedByProbe.has(s.id)) byProbe++;
      else byTap++;
    }
  }

  return {
    byTap,
    byProbe,
    byCorrection,
    sessionsArmed: sessions.filter((s) => s.checkInIntervalMinutes !== null).length,
    sessionsTotal: sessions.length,
    promptsAnswered: checkIns.filter((c) => c.answeredAt !== null).length,
    promptsTotal: checkIns.length,
  };
}

/**
 * Rule 25 — TWO BARE LINES. No blocking, no extra questions, no interpretation.
 *
 * The gate bypass is deliberately left open: interrupts are ungated, so "declare
 * everything `pulled`" is always available. Visibility IS the countermeasure —
 * enforcement would contradict the one-tap driver, and treating a lapse as a
 * failure is what converts it into abandonment.
 */
export function focusInterruptRatio(sessions: readonly Session[]): {
  focus: number;
  interrupt: number;
} {
  let focus = 0;
  let interrupt = 0;
  for (const s of sessions) {
    if (s.kind === "focus") focus++;
    else interrupt++;
  }
  return { focus, interrupt };
}

// ── The log ───────────────────────────────────────────────────────────────────

export interface SessionNode {
  session: Session;
  children: SessionNode[];
  /** Rule 22, for this node. Displayed, never stored. */
  focusedMs: number;
  /** True when this row is a promotion's continuation — `↳ promoted at …`. */
  promotedFrom: string | null;
}

export interface WeekGroup {
  /** ISO date of the Monday that starts the week. */
  weekStart: string;
  nodes: SessionNode[];
}

function mondayOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * The log: sessions grouped by week, newest first, with interrupts NESTED under
 * the session they interrupted.
 *
 * A promoted session renders as a CONTINUATION of the filler it came from, not as
 * an unexplained duplicate title — the one presentation cost Gap 26 accepted. The
 * filler's own row stays visible with `kind: 'filler'` intact, because promotion
 * inserts rather than relabels, and those minutes are the number A10 is written
 * against.
 */
export function groupByWeek(
  sessions: readonly Session[],
  checkIns: readonly CheckIn[],
  now: Date,
): WeekGroup[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const childrenOf = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.parentSessionId === null) continue;
    const kids = childrenOf.get(s.parentSessionId) ?? [];
    kids.push(s);
    childrenOf.set(s.parentSessionId, kids);
  }

  const checkInsBySession = new Map<string, CheckIn[]>();
  for (const c of checkIns) {
    const rows = checkInsBySession.get(c.sessionId) ?? [];
    rows.push(c);
    checkInsBySession.set(c.sessionId, rows);
  }

  function build(session: Session): SessionNode {
    const kids = (childrenOf.get(session.id) ?? []).sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    );
    const parent = session.parentSessionId === null ? null : byId.get(session.parentSessionId);
    return {
      session,
      children: kids.map(build),
      focusedMs: focusedTimeMs(
        session,
        kids,
        checkInsBySession.get(session.id) ?? [],
        now,
      ),
      // A `focus` row whose parent is a closed `filler` is a promotion.
      promotedFrom:
        session.kind === "focus" && parent?.kind === "filler" ? parent.id : null,
    };
  }

  const roots = sessions.filter(
    (s) => s.parentSessionId === null || !byId.has(s.parentSessionId),
  );

  const weeks = new Map<string, SessionNode[]>();
  for (const root of roots) {
    const key = mondayOf(root.startedAt);
    const nodes = weeks.get(key) ?? [];
    nodes.push(build(root));
    weeks.set(key, nodes);
  }

  return [...weeks.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekStart, nodes]) => ({
      weekStart,
      nodes: nodes.sort((a, b) => Date.parse(b.session.startedAt) - Date.parse(a.session.startedAt)),
    }));
}
