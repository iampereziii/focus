/**
 * The derived numbers — Rules 22, 24, 25 and the log tree.
 *
 * `lib/facts/` is pure, so all of this is testable with fixtures and no database.
 * The transaction rules (1, 16, 17, 18, 21, 23, 26f) are enforced in Postgres and
 * need integration tests against a live Supabase — see tests/README.md.
 */

import { describe, expect, it } from "vitest";
import {
  coveredWallTimeMs,
  daySplit,
  driftCapturePaths,
  focusInterruptRatio,
  focusedTimeMs,
  groupByWeek,
  splitBalances,
  subtract,
  union,
} from "@/lib/facts";
import type { CheckIn, Session } from "@/types/db";

const MIN = 60_000;
const DAY = new Date("2026-08-17T00:00:00Z");
const NOW = new Date("2026-08-17T18:00:00Z");

function session(over: Partial<Session> & Pick<Session, "id" | "startedAt">): Session {
  return {
    taskId: null,
    kind: "focus",
    parentSessionId: null,
    what: "work",
    why: null,
    finishLine: null,
    endedAt: null,
    status: "done",
    expectedResumeAt: null,
    interruptTag: null,
    kindCorrectedTo: null,
    kindCorrectedAt: null,
    resumeCue: null,
    resumePlannedAt: null,
    lastInteractionAt: over.startedAt,
    checkInIntervalMinutes: null,
    outcomeNote: null,
    rearmCount: 0,
    ...over,
  };
}

function checkIn(sessionId: string, promptedAt: string, answeredAt: string | null): CheckIn {
  return {
    id: crypto.randomUUID(),
    sessionId,
    promptedAt,
    answeredAt,
    answer: answeredAt === null ? null : "yes",
  };
}

describe("interval arithmetic — the split is built by subtraction, not addition", () => {
  it("merges overlapping intervals", () => {
    expect(union([{ from: 0, to: 10 }, { from: 5, to: 20 }])).toEqual([{ from: 0, to: 20 }]);
  });

  it("splits an interval around a hole", () => {
    expect(subtract({ from: 0, to: 100 }, [{ from: 40, to: 60 }])).toEqual([
      { from: 0, to: 40 },
      { from: 60, to: 100 },
    ]);
  });
});

describe("focusedTimeMs — Rule 22, derived and never stored", () => {
  const parent = session({
    id: "p",
    startedAt: "2026-08-17T09:00:00Z",
    endedAt: "2026-08-17T12:00:00Z",
  });

  it("subtracts a child's whole duration from the parent", () => {
    const child = session({
      id: "c",
      kind: "pulled",
      interruptTag: "pr",
      parentSessionId: "p",
      startedAt: "2026-08-17T10:00:00Z",
      endedAt: "2026-08-17T10:30:00Z",
    });
    expect(focusedTimeMs(parent, [child], [], NOW)).toBe(150 * MIN);
  });

  it("subtracts an unanswered check-in window as well", () => {
    const unanswered = checkIn("p", "2026-08-17T11:00:00Z", null);
    // 3h total − 60m unanswered (11:00 → close at 12:00)
    expect(focusedTimeMs(parent, [], [unanswered], NOW)).toBe(120 * MIN);
  });

  it("subtracts NOTHING when the probe was off — the honest cost of that choice", () => {
    // A session run with `checkInIntervalMinutes = null` produces no rows, so its
    // focused time reads high. That is visible in the split, not hidden.
    expect(focusedTimeMs(parent, [], [], NOW)).toBe(180 * MIN);
  });
});

describe("daySplit — five buckets that BALANCE (Gap 21)", () => {
  it("puts an unanswered window AND a day-boundary tail in the one bucket, and balances", () => {
    // This is the fixture the acceptance criterion names by hand.
    const overnight = session({
      id: "tail",
      startedAt: "2026-08-16T23:00:00Z", // started YESTERDAY
      endedAt: "2026-08-17T01:00:00Z", // ran an hour into today
      status: "abandoned",
    });
    const focus = session({
      id: "f",
      startedAt: "2026-08-17T09:00:00Z",
      endedAt: "2026-08-17T12:00:00Z",
      checkInIntervalMinutes: 60,
    });
    const pulled = session({
      id: "pr",
      kind: "pulled",
      interruptTag: "pr",
      parentSessionId: "f",
      startedAt: "2026-08-17T10:00:00Z",
      endedAt: "2026-08-17T10:30:00Z",
    });
    const sessions = [overnight, focus, pulled];
    const checkIns = [checkIn("f", "2026-08-17T11:00:00Z", null)];

    const split = daySplit(sessions, checkIns, DAY, NOW);

    // (a) the overnight tail — 60 min of today nobody was present for
    // (b) the unanswered window — 11:00 → 12:00
    expect(split.unaccounted).toBe(120 * MIN);
    expect(split.pulled).toBe(30 * MIN);
    // 3h parent − 30m child − 60m unanswered
    expect(split.focused).toBe(90 * MIN);
    expect(split.drift).toBe(0);

    // AND IT BALANCES. This is the test Gap 21 exists for.
    // The denominator is clipped to the same day window the split uses — the
    // overnight session's hours before midnight belong to yesterday.
    const covered = coveredWallTimeMs(sessions, NOW, {
      from: DAY.getTime(),
      to: DAY.getTime() + 24 * 60 * MIN,
    });
    expect(splitBalances(split, covered)).toBe(true);
  });

  it("balances across a gap with no session open — the denominator correction", () => {
    // Two sessions with three hours of nothing between them. Against the ORIGINAL
    // denominator (first startedAt → last endedAt) the buckets could never sum,
    // because the gap belongs to no bucket. Against covered wall time they do.
    const a = session({
      id: "a",
      startedAt: "2026-08-17T09:00:00Z",
      endedAt: "2026-08-17T10:00:00Z",
    });
    const b = session({
      id: "b",
      startedAt: "2026-08-17T13:00:00Z",
      endedAt: "2026-08-17T14:00:00Z",
    });
    const split = daySplit([a, b], [], DAY, NOW);

    expect(split.focused).toBe(120 * MIN);
    expect(splitBalances(split, coveredWallTimeMs([a, b], NOW))).toBe(true);
  });

  it("routes a drifted session to the drift bucket — drift is a status, not a kind", () => {
    const drifted = session({
      id: "d",
      startedAt: "2026-08-17T09:00:00Z",
      endedAt: "2026-08-17T09:40:00Z",
      status: "drifted",
    });
    const split = daySplit([drifted], [], DAY, NOW);
    expect(split.drift).toBe(40 * MIN);
    expect(split.focused).toBe(0);
  });

  it("lets a correction move the bucket without touching the original kind", () => {
    const corrected = session({
      id: "c",
      kind: "pulled",
      interruptTag: "dm",
      startedAt: "2026-08-17T09:00:00Z",
      endedAt: "2026-08-17T09:30:00Z",
      kindCorrectedTo: "drift",
      kindCorrectedAt: "2026-08-17T18:00:00Z",
    });
    const split = daySplit([corrected], [], DAY, NOW);

    expect(split.drift).toBe(30 * MIN);
    expect(split.pulled).toBe(0);
    // The original tap is still on the row — that is what keeps it auditable.
    expect(corrected.kind).toBe("pulled");
  });
});

describe("driftCapturePaths — Rule 25 job 4, and A9 needs BOTH halves", () => {
  it("splits drift by which of the three paths caught it", () => {
    const byTap = session({
      id: "t",
      startedAt: "2026-08-17T09:00:00Z",
      status: "drifted",
    });
    const byProbe = session({
      id: "p",
      startedAt: "2026-08-17T10:00:00Z",
      status: "drifted",
      checkInIntervalMinutes: 30,
    });
    const byCorrection = session({
      id: "c",
      kind: "pulled",
      interruptTag: "other",
      startedAt: "2026-08-17T11:00:00Z",
      kindCorrectedTo: "drift",
      kindCorrectedAt: "2026-08-17T18:00:00Z",
    });
    const probeRow: CheckIn = {
      id: "ci",
      sessionId: "p",
      promptedAt: "2026-08-17T10:30:00Z",
      answeredAt: "2026-08-17T10:31:00Z",
      answer: "drifted",
    };

    const capture = driftCapturePaths([byTap, byProbe, byCorrection], [probeRow]);

    expect(capture.byTap).toBe(1);
    expect(capture.byProbe).toBe(1);
    expect(capture.byCorrection).toBe(1);
  });

  it("reports whether the probe was armed and answered — without it, drift≈0 means nothing", () => {
    // A9's falsifier is "drift ≈ 0 WHILE the probe is armed and being answered".
    // A near-zero count on its own proves nothing: low meta-awareness is a
    // documented alternative explanation for the same number.
    const armed = session({
      id: "a",
      startedAt: "2026-08-17T09:00:00Z",
      checkInIntervalMinutes: 60,
    });
    const off = session({ id: "b", startedAt: "2026-08-17T11:00:00Z" });
    const capture = driftCapturePaths(
      [armed, off],
      [checkIn("a", "2026-08-17T10:00:00Z", "2026-08-17T10:01:00Z"), checkIn("a", "2026-08-17T11:00:00Z", null)],
    );

    expect(capture.sessionsArmed).toBe(1);
    expect(capture.sessionsTotal).toBe(2);
    expect(capture.promptsAnswered).toBe(1);
    expect(capture.promptsTotal).toBe(2);
  });
});

describe("focusInterruptRatio — Rule 25, two bare counts", () => {
  it("counts focus against everything else", () => {
    const rows = [
      session({ id: "1", startedAt: "2026-08-17T09:00:00Z" }),
      session({ id: "2", startedAt: "2026-08-17T10:00:00Z", kind: "pulled", interruptTag: "pr" }),
      session({
        id: "3",
        startedAt: "2026-08-17T11:00:00Z",
        kind: "filler",
        parentSessionId: "1",
        expectedResumeAt: "2026-08-17T11:10:00Z",
      }),
    ];
    expect(focusInterruptRatio(rows)).toEqual({ focus: 1, interrupt: 2 });
  });
});

describe("groupByWeek — the log tree", () => {
  it("nests interrupts under the session they interrupted", () => {
    const parent = session({
      id: "p",
      startedAt: "2026-08-17T09:00:00Z",
      endedAt: "2026-08-17T12:00:00Z",
    });
    const child = session({
      id: "c",
      kind: "pulled",
      interruptTag: "alert",
      parentSessionId: "p",
      startedAt: "2026-08-17T10:00:00Z",
      endedAt: "2026-08-17T10:20:00Z",
    });

    const weeks = groupByWeek([parent, child], [], NOW);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].nodes).toHaveLength(1);
    expect(weeks[0].nodes[0].children[0].session.id).toBe("c");
  });

  it("marks a promoted session as a continuation, and the filler keeps kind='filler'", () => {
    // Gap 26: promotion CLOSES the filler and INSERTS a new focus row. No row's
    // `kind` is ever mutated, so the filler's minutes stay countable — which is
    // the number A10 is written against.
    const filler = session({
      id: "f",
      kind: "filler",
      parentSessionId: null,
      startedAt: "2026-08-17T09:20:00Z",
      endedAt: "2026-08-17T09:45:00Z",
      expectedResumeAt: "2026-08-17T09:30:00Z",
      status: "switched",
    });
    const promoted = session({
      id: "n",
      parentSessionId: "f",
      startedAt: "2026-08-17T09:45:00Z",
      taskId: "t",
      why: "It became the real work",
      finishLine: "Hotfix merged",
      status: "active",
      endedAt: null,
    });

    const weeks = groupByWeek([filler, promoted], [], NOW);
    const fillerNode = weeks[0].nodes.find((n) => n.session.id === "f");

    expect(fillerNode?.session.kind).toBe("filler");
    expect(fillerNode?.children[0].promotedFrom).toBe("f");
  });
});
