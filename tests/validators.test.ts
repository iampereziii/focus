/**
 * The gate, at the API boundary.
 *
 * Rules 2 and 3 are enforced twice on purpose — here (Zod, so the UI can surface
 * a 422 inline on the gate form) and in the database (CHECK constraints, so the
 * gate cannot be bypassed by anything at all). These tests cover the first half;
 * the DB half needs integration tests against a real Postgres.
 */

import { describe, expect, it } from "vitest";
import {
  answerCheckInSchema,
  checkInIntervalSchema,
  closeSessionSchema,
  createTaskSchema,
  createTopicSchema,
  promoteSessionSchema,
  startSessionSchema,
} from "@/lib/validators";

const TASK = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

describe("Rule 9 — capture is cheap", () => {
  it("accepts a task with only `what` + `topicId`", () => {
    expect(createTaskSchema.safeParse({ what: "Draft the ADR", topicId: TASK }).success)
      .toBe(true);
  });

  it("creates a topic from a name alone (Gap 14)", () => {
    expect(createTopicSchema.safeParse({ name: "Sanofi" }).success).toBe(true);
  });

  it("rejects a whitespace-only task title", () => {
    expect(createTaskSchema.safeParse({ what: "   ", topicId: TASK }).success).toBe(false);
  });
});

describe("Rules 2 & 3 — no WHY, no start; no FINISH LINE, no start", () => {
  const gated = {
    kind: "focus" as const,
    taskId: TASK,
    what: "Draft the ADR",
    why: "The decision is blocking two tickets",
    finishLine: "ADR-0004 written and marked Proposed",
    checkInIntervalMinutes: 60,
  };

  it("accepts a fully gated focus session", () => {
    expect(startSessionSchema.safeParse(gated).success).toBe(true);
  });

  it("rejects an empty WHY", () => {
    expect(startSessionSchema.safeParse({ ...gated, why: "" }).success).toBe(false);
  });

  it("rejects a WHITESPACE-ONLY why — that is not a WHY", () => {
    expect(startSessionSchema.safeParse({ ...gated, why: "   " }).success).toBe(false);
  });

  it("rejects a missing FINISH LINE", () => {
    const { finishLine: _omitted, ...withoutFinishLine } = gated;
    expect(startSessionSchema.safeParse(withoutFinishLine).success).toBe(false);
  });

  it("rejects a focus session with no taskId", () => {
    const { taskId: _omitted, ...withoutTask } = gated;
    expect(startSessionSchema.safeParse(withoutTask).success).toBe(false);
  });
});

describe("Rule 26a — the check-in interval is stated, never invented", () => {
  it("accepts 30 / 60 / 90", () => {
    for (const v of [30, 60, 90]) {
      expect(checkInIntervalSchema.safeParse(v).success).toBe(true);
    }
  });

  it("accepts null — `off` is a first-class choice, not a degraded one", () => {
    expect(checkInIntervalSchema.safeParse(null).success).toBe(true);
  });

  it("rejects an interval the architect never stated", () => {
    expect(checkInIntervalSchema.safeParse(45).success).toBe(false);
    expect(checkInIntervalSchema.safeParse(0).success).toBe(false);
  });

  it("is REQUIRED on the gate — the gate has four fields, not three", () => {
    const { checkInIntervalMinutes: _omitted, ...threeFields } = {
      kind: "focus" as const,
      taskId: TASK,
      what: "Draft the ADR",
      why: "Blocking two tickets",
      finishLine: "ADR written",
      checkInIntervalMinutes: 60,
    };
    expect(startSessionSchema.safeParse(threeFields).success).toBe(false);
  });
});

describe("ADR-0003 Invariant 3 — interrupts are ungated", () => {
  it("accepts a `pulled` session with no why, no finishLine, no taskId", () => {
    const result = startSessionSchema.safeParse({
      kind: "pulled",
      what: "PR review",
      interruptTag: "pr",
      parentSessionId: PARENT,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a PARENTLESS `pulled` — Rule 19", () => {
    const result = startSessionSchema.safeParse({
      kind: "pulled",
      what: "PR review at 9am, nothing else open",
      interruptTag: "pr",
    });
    expect(result.success).toBe(true);
  });

  it("REQUIRES an interruptTag for `pulled` (Gap 17a) — the grid always supplies one", () => {
    const result = startSessionSchema.safeParse({
      kind: "pulled",
      what: "PR review",
      parentSessionId: PARENT,
    });
    expect(result.success).toBe(false);
  });

  it("does NOT accept a check-in interval from the client — interrupts inherit it (Rule 26f)", () => {
    const result = startSessionSchema.safeParse({
      kind: "pulled",
      what: "PR review",
      interruptTag: "pr",
      checkInIntervalMinutes: 30,
    });
    // Zod strips unknown keys rather than failing; what matters is that the
    // parsed value carries no interval for the store to write.
    expect(result.success).toBe(true);
    expect(result.success && "checkInIntervalMinutes" in result.data).toBe(false);
  });
});

describe("Rule 18 — `filler` needs a parent and an expected wait", () => {
  it("accepts a filler with a parent and a one-tap wait", () => {
    const result = startSessionSchema.safeParse({
      kind: "filler",
      what: "Review the open PR",
      parentSessionId: PARENT,
      waitMinutes: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a filler with no parent", () => {
    const result = startSessionSchema.safeParse({
      kind: "filler",
      what: "Review the open PR",
      waitMinutes: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a filler with no expected wait", () => {
    const result = startSessionSchema.safeParse({
      kind: "filler",
      what: "Review the open PR",
      parentSessionId: PARENT,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wait the tap cannot produce", () => {
    const result = startSessionSchema.safeParse({
      kind: "filler",
      what: "Review the open PR",
      parentSessionId: PARENT,
      waitMinutes: 7,
    });
    expect(result.success).toBe(false);
  });
});

describe("Rule 16 — `kind` has exactly three members", () => {
  it("rejects `drift` as a kind — drift is a status, not a kind", () => {
    const result = startSessionSchema.safeParse({
      kind: "drift",
      what: "Went sideways",
    });
    expect(result.success).toBe(false);
  });
});

describe("Rule 18 / Gaps 17b + 26 — promotion IS the gate, and never relabels", () => {
  const promotion = {
    why: "It turned into the real work",
    finishLine: "The hotfix is merged",
    checkInIntervalMinutes: 60,
  };

  it("rejects a promotion with no why or finishLine", () => {
    expect(promoteSessionSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a gated promotion and defaults the grandparent to `partial`", () => {
    const result = promoteSessionSchema.safeParse(promotion);
    expect(result.success).toBe(true);
    expect(result.success && result.data.grandparentStatus).toBe("partial");
  });

  it("gates the new focus session on its own interval (Rules 26a, 26f)", () => {
    // The new row is a `focus` session, so it takes an interval like any other.
    // The form pre-selects the filler's inherited value — zero extra taps — but
    // the field has to be there, or the promoted session silently gets `off`.
    const { checkInIntervalMinutes: _omitted, ...withoutInterval } = promotion;
    expect(promoteSessionSchema.safeParse(withoutInterval).success).toBe(false);
  });

  it("takes no `kind` — promotion inserts a new row, it does not relabel one", () => {
    const result = promoteSessionSchema.safeParse({ ...promotion, kind: "focus" });
    expect(result.success).toBe(true);
    expect(result.success && "kind" in result.data).toBe(false);
  });
});

describe("Rule 5 — close-out closes; it does not reopen", () => {
  it("accepts a terminal status with a note", () => {
    const result = closeSessionSchema.safeParse({
      status: "done",
      outcomeNote: "Shipped",
    });
    expect(result.success).toBe(true);
  });

  it("rejects reopening a session to `active` or `suspended`", () => {
    expect(closeSessionSchema.safeParse({ status: "active", outcomeNote: null }).success)
      .toBe(false);
    expect(
      closeSessionSchema.safeParse({ status: "suspended", outcomeNote: null }).success,
    ).toBe(false);
  });
});

describe("Rule 26 — the app asks; it never decides", () => {
  it("accepts exactly the three answers", () => {
    for (const answer of ["yes", "done", "drifted"]) {
      expect(answerCheckInSchema.safeParse({ answer }).success).toBe(true);
    }
  });

  it("has no `snooze`, `dismiss`, or anything that lets the app act on silence", () => {
    expect(answerCheckInSchema.safeParse({ answer: "snooze" }).success).toBe(false);
  });
});
