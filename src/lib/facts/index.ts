/**
 * `lib/facts/` — PURE AND DETERMINISTIC.
 *
 * Date math, counts, derived focused time, the log tree. Computed in code,
 * unit-tested, NO I/O beyond reads passed in as arguments. If something needs
 * judgment, it isn't a fact (Rule 11, Convention #7).
 *
 * Consumers: `/` (`groupByWeek`, via `flattenWeeks`) and `/api/sessions` (which
 * backs `/log`). Keeping it pure is what makes the v1.1 AI layer addable
 * without rework — treat it as a seam, the way `lib/store/` is the offline
 * seam.
 *
 * THERE IS NO AI IN v1. No SDK, no `lib/ai/`, no API key, no model call. The
 * layer was cut deliberately (spec Gaps 3 & 4): the problem is flattening and
 * protection, not ranking, and there is no logged data to rank against yet. If a
 * task here looks like it wants a model, it is a v1.1 question.
 */

import type { CheckIn, Session } from "@/types/db";

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
// `focusedTimeMs()` is built by subtracting intervals rather than by adding
// numbers, so every millisecond is attributed by construction rather than by
// a running total that could drift from it.

export interface Interval {
  from: number;
  to: number;
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

// ── The log ───────────────────────────────────────────────────────────────────

export interface SessionNode {
  session: Session;
  children: SessionNode[];
  /** Rule 22, for this node. Displayed, never stored. */
  focusedMs: number;
  /**
   * This node's own wall time — `startedAt` to `endedAt`/`now`, before any
   * subtraction. Computed against the SAME `now` as `focusedMs`, so
   * `wallMs >= focusedMs` holds by construction; nothing client-side can make
   * focused time exceed wall time (feature-brief-log-view-information-
   * architecture.md, item G).
   */
  wallMs: number;
  /** Sum of this node's own unanswered check-in windows — the other half of Rule 22's subtraction. */
  unansweredMs: number;
  /** Count of distinct unanswered-window stretches (consecutive unanswered check-ins merge into one). */
  unansweredCount: number;
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
    const ownCheckIns = checkInsBySession.get(session.id) ?? [];
    const windows = unansweredWindows(ownCheckIns, session.endedAt, now);
    const own = intervalOf(session, now);
    return {
      session,
      children: kids.map(build),
      focusedMs: focusedTimeMs(session, kids, ownCheckIns, now),
      wallMs: own.to - own.from,
      unansweredMs: windows.reduce((sum, w) => sum + (w.toMs - w.fromMs), 0),
      unansweredCount: windows.length,
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
