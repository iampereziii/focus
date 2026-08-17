/**
 * The derived numbers — Rule 22 and the log tree.
 *
 * `lib/facts/` is pure, so all of this is testable with fixtures and no database.
 * The transaction rules (1, 16, 17, 18, 21, 23, 26f) are enforced in Postgres and
 * need integration tests against a live Supabase — see tests/README.md.
 */

import { describe, expect, it } from "vitest";
import { focusedTimeMs, groupByWeek, subtract, union } from "@/lib/facts";
import type { CheckIn, Session } from "@/types/db";

const MIN = 60_000;
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
