/**
 * `lib/facts/` is pure, so it is fully unit-testable with fixtures. These cover
 * the helpers that ship in the scaffold; `focusedTimeMs` and `daySplit` are still
 * to build, and the balance test below is the shape their tests must take.
 */

import { describe, expect, it } from "vitest";
import {
  DAY_SPLIT_BUCKETS,
  dayWallTimeMs,
  durationMs,
  splitBalances,
  stackDepth,
  unansweredWindows,
} from "@/lib/facts";
import type { CheckIn, Session } from "@/types/db";

const MIN = 60_000;
const at = (iso: string) => iso;

function checkIn(promptedAt: string, answeredAt: string | null): CheckIn {
  return {
    id: crypto.randomUUID(),
    sessionId: "s1",
    promptedAt,
    answeredAt,
    answer: answeredAt === null ? null : "yes",
  };
}

function session(over: Partial<Session> & Pick<Session, "id" | "startedAt">): Session {
  return {
    taskId: null,
    kind: "focus",
    parentSessionId: null,
    what: "work",
    why: null,
    finishLine: null,
    endedAt: null,
    status: "active",
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

describe("durationMs — derived, never stored (ADR-0002)", () => {
  it("measures a closed session end minus start", () => {
    expect(
      durationMs(at("2026-08-16T09:00:00Z"), at("2026-08-16T10:30:00Z"), new Date()),
    ).toBe(90 * MIN);
  });

  it("measures an OPEN session against now — Rule 7, it is never auto-closed", () => {
    const now = new Date("2026-08-16T11:00:00Z");
    expect(durationMs(at("2026-08-16T09:00:00Z"), null, now)).toBe(120 * MIN);
  });
});

describe("unansweredWindows — Rule 26e, the honest-number machinery", () => {
  it("credits an answered prompt with nothing — it is the positive signal", () => {
    const windows = unansweredWindows(
      [checkIn("2026-08-16T10:00:00Z", "2026-08-16T10:01:00Z")],
      "2026-08-16T11:00:00Z",
      new Date(),
    );
    expect(windows).toHaveLength(0);
  });

  it("runs an unanswered prompt to the session close when nothing follows", () => {
    const windows = unansweredWindows(
      [checkIn("2026-08-16T10:00:00Z", null)],
      "2026-08-16T11:00:00Z",
      new Date(),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].toMs - windows[0].fromMs).toBe(60 * MIN);
  });

  it("runs an unanswered prompt to the NEXT ANSWER, not the next prompt", () => {
    const windows = unansweredWindows(
      [
        checkIn("2026-08-16T10:00:00Z", null),
        checkIn("2026-08-16T11:00:00Z", "2026-08-16T11:05:00Z"),
      ],
      "2026-08-16T12:00:00Z",
      new Date(),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].toMs - windows[0].fromMs).toBe(65 * MIN);
  });

  it("treats a RUN of unanswered prompts as ONE uncredited stretch, not four", () => {
    const windows = unansweredWindows(
      [
        checkIn("2026-08-16T10:00:00Z", null),
        checkIn("2026-08-16T11:00:00Z", null),
        checkIn("2026-08-16T12:00:00Z", null),
        checkIn("2026-08-16T13:00:00Z", "2026-08-16T13:00:00Z"),
      ],
      "2026-08-16T14:00:00Z",
      new Date(),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].toMs - windows[0].fromMs).toBe(180 * MIN);
  });

  it("is order-independent", () => {
    const rows = [
      checkIn("2026-08-16T11:00:00Z", "2026-08-16T11:05:00Z"),
      checkIn("2026-08-16T10:00:00Z", null),
    ];
    expect(unansweredWindows(rows, "2026-08-16T12:00:00Z", new Date())).toEqual(
      unansweredWindows([...rows].reverse(), "2026-08-16T12:00:00Z", new Date()),
    );
  });

  it("subtracts NOTHING when the check-in was set to `off`", () => {
    // A session with the probe off produces no rows and gets no subtraction, so
    // its focused time reads high. That is a visible consequence of a choice at
    // the gate, not a bug to fix.
    expect(unansweredWindows([], "2026-08-16T11:00:00Z", new Date())).toHaveLength(0);
  });
});

describe("the day split — five buckets that must sum to wall time", () => {
  it("has exactly five buckets, and `unaccounted` is one of them", () => {
    expect(DAY_SPLIT_BUCKETS).toHaveLength(5);
    expect(DAY_SPLIT_BUCKETS).toContain("unaccounted");
    // `drift` is a bucket here — but never a `kind`.
    expect(DAY_SPLIT_BUCKETS).toContain("drift");
  });

  it("balances when both unaccounted sources land in the one bucket (Gap 21)", () => {
    // A day-boundary tail (30 min) and an unanswered check-in window (45 min)
    // share the `unaccounted` bucket rather than earning a sixth.
    const wallTimeMs = 8 * 60 * MIN;
    const split = {
      focused: 5 * 60 * MIN,
      pulled: 90 * MIN,
      filler: 15 * MIN,
      drift: 0,
      unaccounted: 30 * MIN + 45 * MIN,
    };
    expect(splitBalances(split, wallTimeMs)).toBe(true);
  });

  it("FAILS when something subtracted has no bucket — the Gap 21 defect", () => {
    const wallTimeMs = 8 * 60 * MIN;
    const split = {
      focused: 5 * 60 * MIN,
      pulled: 90 * MIN,
      filler: 15 * MIN,
      drift: 0,
      unaccounted: 30 * MIN, // the 45-minute unanswered window fell out
    };
    expect(splitBalances(split, wallTimeMs)).toBe(false);
  });
});

describe("dayWallTimeMs — first startedAt to last endedAt, nothing invented", () => {
  it("spans the day's real edges, not a working day", () => {
    const sessions = [
      session({
        id: "a",
        startedAt: "2026-08-16T09:00:00Z",
        endedAt: "2026-08-16T10:00:00Z",
        status: "done",
      }),
      session({
        id: "b",
        startedAt: "2026-08-16T13:00:00Z",
        endedAt: "2026-08-16T14:30:00Z",
        status: "done",
      }),
    ];
    expect(dayWallTimeMs(sessions, new Date())).toBe(5.5 * 60 * MIN);
  });

  it("returns 0 for an empty day — the app starts empty (Gap 5)", () => {
    expect(dayWallTimeMs([], new Date())).toBe(0);
  });
});

describe("stackDepth — Rule 20, depth 3+ is a signal, never a block", () => {
  const parent = session({
    id: "p",
    startedAt: "2026-08-16T09:00:00Z",
    status: "suspended",
  });
  const child = session({
    id: "c",
    startedAt: "2026-08-16T09:30:00Z",
    kind: "pulled",
    interruptTag: "pr",
    parentSessionId: "p",
    status: "suspended",
  });
  const grandchild = session({
    id: "g",
    startedAt: "2026-08-16T09:45:00Z",
    kind: "pulled",
    interruptTag: "alert",
    parentSessionId: "c",
  });
  const byId = new Map([parent, child, grandchild].map((s) => [s.id, s]));

  it("reports 0 for a top-level session", () => {
    expect(stackDepth("p", byId)).toBe(0);
  });

  it("reports 2 at the supported depth", () => {
    expect(stackDepth("g", byId)).toBe(2);
  });

  it("does NOT count a promoted session's closed ancestors (Gaps 17b + 26)", () => {
    // Promotion closes BOTH the filler and the grandparent in the same
    // transaction, then inserts the new focus row parented to the closed filler.
    // The walk stops immediately, so a promoted session never inflates the
    // depth warning — and note the filler row keeps `kind: 'filler'`, because
    // promotion inserts rather than relabels.
    const grandparent = session({
      id: "gp",
      startedAt: "2026-08-16T09:00:00Z",
      status: "partial",
      endedAt: "2026-08-16T09:45:00Z",
    });
    const closedFiller = session({
      id: "f",
      startedAt: "2026-08-16T09:20:00Z",
      kind: "filler",
      parentSessionId: "gp",
      expectedResumeAt: "2026-08-16T09:30:00Z",
      status: "switched",
      endedAt: "2026-08-16T09:45:00Z",
    });
    const promoted = session({
      id: "n",
      startedAt: "2026-08-16T09:45:00Z",
      parentSessionId: "f",
      taskId: "t",
      why: "It became the real work",
      finishLine: "Hotfix merged",
    });
    const map = new Map([grandparent, closedFiller, promoted].map((s) => [s.id, s]));

    expect(stackDepth("n", map)).toBe(0);
    // The lineage is still readable even though the depth is 0.
    expect(promoted.parentSessionId).toBe("f");
    expect(closedFiller.kind).toBe("filler");
  });
});
