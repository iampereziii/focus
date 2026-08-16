/**
 * SESSION CONTINUITY — the regression that made a running session look closed.
 *
 * Reported 2026-08-17 as "clicking Log or Review closes the session". It did not.
 * Nothing closed anything: `/` read the log tree ONE LEVEL DEEP, and an interrupt
 * is a CHILD of the session it suspended, so an active `pulled` row was invisible
 * to Rule 1's redirect. The backlog rendered as though nothing were running and
 * the only apparent way back to live work was to start it over — which is worse
 * than a close, because the original session stayed `active` in the database.
 *
 * The fixtures below are the reported repro, in order: start work, get pulled onto
 * a PR, wander off to /log, come back.
 *
 * Rule 1 itself is enforced by a partial unique index and needs an integration
 * test against a live Supabase (tests/README.md). What is unit-testable — and what
 * actually broke — is the SHAPE of the tree and whether a caller walks all of it.
 */

import { describe, expect, it } from "vitest";
import { groupByWeek } from "@/lib/facts";
import { flattenNodes, flattenWeeks } from "@/lib/session-tree";
import { formatDuration, formatElapsed } from "@/components/ui";
import type { Session } from "@/types/db";

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

/** The repro: a focus session suspended by a `pulled` interrupt that is still live. */
const parent = session({
  id: "parent",
  what: "Wire up the topics route",
  startedAt: "2026-08-17T10:00:00Z",
  status: "suspended",
  checkInIntervalMinutes: 30,
});

const interrupt = session({
  id: "interrupt",
  what: "Review Dana's PR",
  startedAt: "2026-08-17T10:05:00Z",
  status: "active",
  kind: "pulled",
  parentSessionId: "parent",
  interruptTag: "pr",
  checkInIntervalMinutes: 30,
});

describe("the log tree nests interrupts — callers must recurse", () => {
  const weeks = groupByWeek([parent, interrupt], [], NOW);

  it("puts only ROOT sessions at the top level", () => {
    expect(weeks[0].nodes.map((n) => n.session.id)).toEqual(["parent"]);
  });

  it("hangs the active interrupt off its parent", () => {
    expect(weeks[0].nodes[0].children.map((n) => n.session.id)).toEqual(["interrupt"]);
  });

  it("REGRESSION: the one-level flatten that shipped cannot see the active session", () => {
    // Exactly the expression that was in src/app/(app)/page.tsx. Kept here as the
    // failing case, so the bug has to be re-introduced deliberately to come back.
    const oneLevel = weeks.flatMap((w) => w.nodes.map((n) => n.session));

    expect(oneLevel.find((s) => s.status === "active")).toBeUndefined();
  });

  it("flattenWeeks finds it, which is what Rule 1's redirect needs", () => {
    expect(flattenWeeks(weeks).find((s) => s.status === "active")?.id).toBe("interrupt");
  });

  it("returns every session exactly once", () => {
    expect(flattenWeeks(weeks).map((s) => s.id).sort()).toEqual(["interrupt", "parent"]);
  });
});

describe("flattening survives depth", () => {
  it("reaches a stacked interrupt three levels down (Rule 20 — depth is warned, never blocked)", () => {
    const deep = session({
      id: "deep",
      what: "Prod alert",
      startedAt: "2026-08-17T10:12:00Z",
      status: "active",
      kind: "pulled",
      parentSessionId: "interrupt",
      interruptTag: "alert",
    });

    const weeks = groupByWeek(
      [parent, session({ ...interrupt, status: "suspended" }), deep],
      [],
      NOW,
    );

    expect(flattenWeeks(weeks).find((s) => s.status === "active")?.id).toBe("deep");
  });

  it("finds a resume cue set on an interrupt, not just on a root session", () => {
    // Day review can give any suspended session a resume cue, and a suspended
    // session is often itself a child. `/`'s "planned for today" pin reads this.
    const weeks = groupByWeek(
      [
        parent,
        session({
          ...interrupt,
          status: "suspended",
          resumeCue: "after standup",
          resumePlannedAt: "2026-08-18T09:00:00Z",
        }),
      ],
      [],
      NOW,
    );

    const pinned = flattenWeeks(weeks).filter((s) => s.resumePlannedAt !== null);
    expect(pinned.map((s) => s.id)).toEqual(["interrupt"]);
  });

  it("is empty for an empty page rather than throwing", () => {
    expect(flattenWeeks([])).toEqual([]);
    expect(flattenNodes([])).toEqual([]);
  });
});

describe("formatElapsed — the running clock shows seconds", () => {
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;

  it("pads to mm:ss below the hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(7 * SEC)).toBe("00:07");
    expect(formatElapsed(65 * SEC)).toBe("01:05");
    expect(formatElapsed(59 * MIN + 59 * SEC)).toBe("59:59");
  });

  it("rolls to h:mm:ss at the hour", () => {
    expect(formatElapsed(HOUR)).toBe("1:00:00");
    expect(formatElapsed(HOUR + 5 * MIN + 7 * SEC)).toBe("1:05:07");
    expect(formatElapsed(13 * HOUR + 2 * SEC)).toBe("13:00:02");
  });

  it("floors rather than rounds — a clock must never show time not yet elapsed", () => {
    expect(formatElapsed(999)).toBe("00:00");
    expect(formatElapsed(1999)).toBe("00:01");
  });

  it("clamps a negative interval instead of rendering a minus sign", () => {
    // Possible for a moment if the device clock sits behind the server's.
    expect(formatElapsed(-5000)).toBe("00:00");
  });
});

describe("formatDuration is unchanged — settled durations stay at minute resolution", () => {
  it("still renders the log and the day split without seconds", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(59_000)).toBe("0m");
  });
});
