/**
 * feature-brief-log-view-information-architecture.md — the multi-week fixture.
 *
 * Closes project-spec.md:583's explicitly-flagged gap: week grouping across
 * weeks (as opposed to within one) had never been exercised. This fixture spans
 * THREE weeks, FIVE distinct days each (Gap 5 — a test fixture, never seed
 * data), and exercises the three new `SessionNode` fields (`wallMs`,
 * `unansweredMs`, `unansweredCount`) plus the pure day-grouping / summary /
 * badge helpers `log/page.tsx` exports for testability, since `lib/facts/`
 * deliberately keeps grouping-by-day out (item B: "grouping happens in the
 * component, not in `groupByWeek`").
 */

import { describe, expect, it } from "vitest";
import { groupByWeek } from "@/lib/facts";
import {
  badgeVariant,
  dayLabel,
  formatWeekOf,
  groupByDay,
  mergeWeeks,
  summarize,
} from "@/app/(app)/log/page";
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

// ── The multi-week, multi-day fixture ──────────────────────────────────────
// Three weeks, five distinct working days each, one root focus session a day.
// Week 1 (this week, Mon 17 Aug) additionally carries an interrupt and an
// unanswered check-in so the wall/focused split and the counts are exercised.

const WEEK_DAYS = ["27", "28", "29", "30", "31"]; // Mon–Fri, week of 2026-07-27
const fixtureSessions: Session[] = [];
const fixtureCheckIns: CheckIn[] = [];

// Week of 2026-08-17 (this week)
for (const day of ["17", "18", "19", "20", "21"]) {
  fixtureSessions.push(
    session({
      id: `w1-${day}`,
      startedAt: `2026-08-${day}T09:00:00Z`,
      endedAt: `2026-08-${day}T10:30:00Z`, // 90m wall
      taskId: "t",
      why: "because",
      finishLine: "ship it",
    }),
  );
}
// One interrupt nested under Monday's session.
fixtureSessions.push(
  session({
    id: "w1-17-interrupt",
    kind: "pulled",
    interruptTag: "pr",
    parentSessionId: "w1-17",
    startedAt: "2026-08-17T09:20:00Z",
    endedAt: "2026-08-17T09:35:00Z", // 15m
  }),
);
// One unanswered check-in on Tuesday's session: prompted 09:40, never answered,
// session closes 10:30 → a 50m unaccounted window.
fixtureCheckIns.push(checkIn("w1-18", "2026-08-18T09:40:00Z", null));

// Week of 2026-08-10
for (const day of ["10", "11", "12", "13", "14"]) {
  fixtureSessions.push(
    session({
      id: `w2-${day}`,
      startedAt: `2026-08-${day}T09:00:00Z`,
      endedAt: `2026-08-${day}T10:00:00Z`, // 60m wall, no interrupts
      taskId: "t",
      why: "because",
      finishLine: "ship it",
    }),
  );
}

// Week of 2026-07-27
for (const day of WEEK_DAYS) {
  fixtureSessions.push(
    session({
      id: `w3-${day}`,
      startedAt: `2026-07-${day}T09:00:00Z`,
      endedAt: `2026-07-${day}T09:45:00Z`, // 45m wall
      taskId: "t",
      why: "because",
      finishLine: "ship it",
    }),
  );
}

describe("groupByWeek — multi-week span (project-spec.md:583)", () => {
  const weeks = groupByWeek(fixtureSessions, fixtureCheckIns, NOW);

  it("produces three distinct weeks, newest first", () => {
    expect(weeks).toHaveLength(3);
    expect(weeks[0].weekStart).toBe("2026-08-17");
    expect(weeks[1].weekStart).toBe("2026-08-10");
    expect(weeks[2].weekStart).toBe("2026-07-27");
  });

  it("each week carries its five root sessions", () => {
    for (const week of weeks) {
      expect(week.nodes).toHaveLength(5);
    }
  });
});

describe("SessionNode.wallMs / unansweredMs / unansweredCount", () => {
  const weeks = groupByWeek(fixtureSessions, fixtureCheckIns, NOW);
  const thisWeek = weeks[0];

  it("wallMs >= focusedMs holds for every node, including the interrupt child", () => {
    for (const node of thisWeek.nodes) {
      expect(node.wallMs).toBeGreaterThanOrEqual(node.focusedMs);
      for (const child of node.children) {
        expect(child.wallMs).toBeGreaterThanOrEqual(child.focusedMs);
      }
    }
  });

  it("a session with a nested interrupt: wallMs is untouched, focusedMs is reduced by the child", () => {
    const monday = thisWeek.nodes.find((n) => n.session.id === "w1-17");
    expect(monday?.wallMs).toBe(90 * MIN);
    expect(monday?.focusedMs).toBe(75 * MIN); // 90m − 15m interrupt
    expect(monday?.unansweredMs).toBe(0);
    expect(monday?.unansweredCount).toBe(0);
    expect(monday?.children).toHaveLength(1);
  });

  it("a session with an unanswered check-in: the window is counted and subtracted", () => {
    const tuesday = thisWeek.nodes.find((n) => n.session.id === "w1-18");
    expect(tuesday?.wallMs).toBe(90 * MIN);
    expect(tuesday?.unansweredMs).toBe(50 * MIN);
    expect(tuesday?.unansweredCount).toBe(1);
    expect(tuesday?.focusedMs).toBe(40 * MIN); // 90m − 50m unanswered
  });

  it("a clean session (no children, no unanswered check-ins) has wallMs === focusedMs", () => {
    const wednesday = thisWeek.nodes.find((n) => n.session.id === "w1-19");
    expect(wednesday?.wallMs).toBe(wednesday?.focusedMs);
    expect(wednesday?.unansweredCount).toBe(0);
  });
});

describe("groupByDay — the component-level day grouping (item B)", () => {
  const weeks = groupByWeek(fixtureSessions, fixtureCheckIns, NOW);
  const days = groupByDay(weeks[0].nodes);

  it("splits the week's five root sessions into five distinct days, newest first", () => {
    expect(days).toHaveLength(5);
    expect(days.map((d) => d.dateKey)).toEqual([
      "2026-08-21",
      "2026-08-20",
      "2026-08-19",
      "2026-08-18",
      "2026-08-17",
    ]);
  });

  it("each day carries exactly one root session", () => {
    for (const day of days) {
      expect(day.nodes).toHaveLength(1);
    }
  });
});

describe("summarize — the week/day header agrees with the rows beneath it", () => {
  const weeks = groupByWeek(fixtureSessions, fixtureCheckIns, NOW);
  const thisWeek = weeks[0];

  it("week summary's session count includes nested interrupts", () => {
    const summary = summarize(thisWeek.nodes);
    expect(summary.sessionCount).toBe(6); // 5 roots + 1 interrupt
    expect(summary.interruptCount).toBe(1);
  });

  it("week summary's focused total equals the sum of every node's own focusedMs", () => {
    const summary = summarize(thisWeek.nodes);
    const monday = thisWeek.nodes.find((n) => n.session.id === "w1-17")!;
    const interrupt = monday.children[0];
    const tuesday = thisWeek.nodes.find((n) => n.session.id === "w1-18")!;
    const rest = thisWeek.nodes.filter((n) => n.session.id !== "w1-17" && n.session.id !== "w1-18");
    const expected =
      monday.focusedMs +
      interrupt.focusedMs +
      tuesday.focusedMs +
      rest.reduce((sum, n) => sum + n.focusedMs, 0);
    expect(summary.focusedMs).toBe(expected);
  });

  it("a day's summary matches the summary of exactly that day's nodes", () => {
    const days = groupByDay(thisWeek.nodes);
    const monday = days.find((d) => d.dateKey === "2026-08-17")!;
    const daySummary = summarize(monday.nodes);
    expect(daySummary.sessionCount).toBe(2); // the root + its interrupt
    expect(daySummary.interruptCount).toBe(1);
  });
});

describe("mergeWeeks — a week straddling a page boundary combines into one section", () => {
  // Week 2 (2026-08-10) has five independent roots and no parent/child links, so
  // splitting it cleanly across two pages — as `before`-pagination by session
  // count would in production — is representable without a partial tree.
  const week2 = fixtureSessions.filter((s) => s.id.startsWith("w2-"));
  const pageOneSessions = week2.slice(0, 3);
  const pageTwoSessions = week2.slice(3);

  it("merges two pages sharing a weekStart instead of producing a duplicate section", () => {
    const pageOne = groupByWeek(pageOneSessions, [], NOW);
    const pageTwo = groupByWeek(pageTwoSessions, [], NOW);
    const merged = mergeWeeks(pageOne, pageTwo);

    expect(merged).toHaveLength(1);
    expect(merged[0].weekStart).toBe("2026-08-10");
    expect(merged[0].nodes).toHaveLength(5);
  });

  it("keeps merged nodes sorted newest-first", () => {
    const merged = mergeWeeks(
      groupByWeek(pageOneSessions, [], NOW),
      groupByWeek(pageTwoSessions, [], NOW),
    );
    const startedAts = merged[0].nodes.map((n) => Date.parse(n.session.startedAt));
    expect(startedAts).toEqual([...startedAts].sort((a, b) => b - a));
  });
});

describe("dayLabel — TODAY / YESTERDAY landmarks, absolute date always alongside", () => {
  it("labels today", () => {
    expect(dayLabel("2026-08-18", "2026-08-18", "2026-08-17")).toBe("TODAY · TUE 18 AUG");
  });

  it("labels yesterday", () => {
    expect(dayLabel("2026-08-17", "2026-08-18", "2026-08-17")).toBe("YESTERDAY · MON 17 AUG");
  });

  it("falls back to the absolute weekday + date for anything older", () => {
    expect(dayLabel("2026-08-15", "2026-08-18", "2026-08-17")).toBe("SAT 15 AUG");
  });
});

describe("formatWeekOf", () => {
  it("renders the Monday as a weekday + date, not a raw ISO string", () => {
    expect(formatWeekOf("2026-08-17")).toBe("Week of Mon 17 Aug");
  });
});

describe("badgeVariant — the badge reads as drift without hiding the original kind (Rule 21)", () => {
  it("renders the raw kind for an uncorrected session", () => {
    expect(badgeVariant(session({ id: "a", startedAt: NOW.toISOString(), kind: "pulled" }))).toBe(
      "pulled",
    );
  });

  it("renders drift when the status is drifted, even with no kindCorrectedTo", () => {
    expect(
      badgeVariant(session({ id: "a", startedAt: NOW.toISOString(), status: "drifted" })),
    ).toBe("drift");
  });

  it("renders drift when kindCorrectedTo is drift", () => {
    expect(
      badgeVariant(
        session({ id: "a", startedAt: NOW.toISOString(), kind: "pulled", kindCorrectedTo: "drift" }),
      ),
    ).toBe("drift");
  });
});
