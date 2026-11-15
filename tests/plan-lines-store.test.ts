/**
 * FOCUS-14 — the day plan's STORE, against a fake Supabase client.
 *
 * What this proves and what it cannot. It proves what `lib/store/plan-lines.ts`
 * itself decides: which columns it writes, that End day is ONE statement, that
 * dropping is idempotent, that a missing line is `null`. It does NOT prove the
 * rules the DATABASE enforces — one open plan (27b) and written-once (27c) are
 * triggers in `0008_plan_lines.sql`, and a fake client can't fire a trigger.
 * Those were verified against a real Postgres engine when the migration was
 * written, and they still need a live Supabase (see `tests/README.md`, which
 * lists this alongside every other DB-enforced rule). The migration's TEXT is
 * pinned in `guardrails.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Call = { op: string; args: unknown[] };
  type Result = { data: unknown; error: { message: string } | null };
  type Entry = { table: string; calls: Call[] };

  const queries: Entry[] = [];
  const results: Result[] = [];

  class Query implements PromiseLike<Result> {
    constructor(private readonly entry: Entry) {}
    private rec(op: string, args: unknown[]): this {
      this.entry.calls.push({ op, args });
      return this;
    }
    select(...a: unknown[]) { return this.rec("select", a); }
    insert(...a: unknown[]) { return this.rec("insert", a); }
    update(...a: unknown[]) { return this.rec("update", a); }
    eq(...a: unknown[]) { return this.rec("eq", a); }
    is(...a: unknown[]) { return this.rec("is", a); }
    order(...a: unknown[]) { return this.rec("order", a); }
    maybeSingle(...a: unknown[]) { return this.rec("maybeSingle", a); }
    single(...a: unknown[]) { return this.rec("single", a); }
    then<R1 = Result, R2 = never>(
      onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      const next = results.shift() ?? { data: null, error: null };
      return Promise.resolve(next).then(onfulfilled, onrejected);
    }
  }

  return {
    queries,
    results,
    from(table: string) {
      const entry: Entry = { table, calls: [] };
      queries.push(entry);
      return new Query(entry);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => ({ from: fake.from }),
}));

import { addPlanLine, dropPlanLine, endDay, listOpenPlan } from "@/lib/store/plan-lines";

const row = (over: Record<string, unknown> = {}) => ({
  id: "6f1c1f0e-3d2a-4b7a-9c55-0a7e5f2b8d11",
  plan_date: "2026-11-14",
  text: "Review the checkout PR",
  created_at: "2026-11-14T09:00:00.000Z",
  dropped_at: null,
  ended_at: null,
  ...over,
});
const ok = (data: unknown) => fake.results.push({ data, error: null });
const fail = (message: string) => fake.results.push({ data: null, error: { message } });
const opsOf = (i: number) => fake.queries[i].calls.map((c) => c.op);
const callOf = (i: number, op: string) => fake.queries[i].calls.find((c) => c.op === op);

beforeEach(() => {
  fake.queries.length = 0;
  fake.results.length = 0;
});

describe("listOpenPlan", () => {
  it("reads only open lines, in the order written, from plan_lines", async () => {
    ok([row()]);
    await listOpenPlan();
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].table).toBe("plan_lines");
    expect(callOf(0, "is")?.args).toEqual(["ended_at", null]);
    expect(callOf(0, "order")?.args).toEqual(["created_at", { ascending: true }]);
  });

  it("takes planDate from the first line — one round trip, no second query", async () => {
    ok([row({ id: "a" }), row({ id: "b", text: "Reply to vendor contract" })]);
    const plan = await listOpenPlan();
    expect(plan.planDate).toBe("2026-11-14");
    expect(plan.lines.map((l) => l.text)).toEqual([
      "Review the checkout PR",
      "Reply to vendor contract",
    ]);
    expect(fake.queries).toHaveLength(1);
  });

  it("returns an empty plan with a null date when nothing is open", async () => {
    ok([]);
    expect(await listOpenPlan()).toEqual({ planDate: null, lines: [] });
  });

  it("keeps crossed-out lines in the plan — they stay visible all day", async () => {
    ok([row({ dropped_at: "2026-11-14T10:00:00.000Z" })]);
    const { lines } = await listOpenPlan();
    expect(lines).toHaveLength(1);
    expect(lines[0].droppedAt).toBe("2026-11-14T10:00:00.000Z");
  });

  it("throws the database's message rather than returning a half-answer", async () => {
    fail("boom");
    await expect(listOpenPlan()).rejects.toThrow("boom");
  });
});

describe("addPlanLine", () => {
  it("writes ONLY text and plan_date — nothing links a line to anything", async () => {
    ok(row());
    await addPlanLine({ text: "Review the checkout PR", planDate: "2026-11-14" });
    expect(callOf(0, "insert")?.args).toEqual([
      { text: "Review the checkout PR", plan_date: "2026-11-14" },
    ]);
  });

  it("returns the created line, mapped to camelCase", async () => {
    ok(row({ id: "x" }));
    const line = await addPlanLine({ text: "Review the checkout PR", planDate: "2026-11-14" });
    expect(line).toEqual({
      id: "x",
      planDate: "2026-11-14",
      text: "Review the checkout PR",
      createdAt: "2026-11-14T09:00:00.000Z",
      droppedAt: null,
      endedAt: null,
    });
  });

  it("surfaces the trigger's Rule 27b refusal untouched, for apiFailure to map to 409", async () => {
    fail("Rule 27b: an earlier plan is still open — end that day before starting another");
    await expect(
      addPlanLine({ text: "tomorrow", planDate: "2026-11-15" }),
    ).rejects.toThrow("Rule 27b");
  });

  it("does not pre-check the rule itself — the trigger is the one copy", async () => {
    ok(row());
    await addPlanLine({ text: "x", planDate: "2026-11-15" });
    // One insert and nothing else: no read of the open plan before writing.
    expect(fake.queries).toHaveLength(1);
    expect(opsOf(0)).not.toContain("is");
  });
});

describe("dropPlanLine", () => {
  const id = "6f1c1f0e-3d2a-4b7a-9c55-0a7e5f2b8d11";

  it("returns null for a line that doesn't exist, and writes nothing", async () => {
    ok(null);
    expect(await dropPlanLine(id)).toBeNull();
    expect(fake.queries).toHaveLength(1);
    expect(opsOf(0)).not.toContain("update");
  });

  it("crosses a fresh line out by writing ONLY dropped_at", async () => {
    ok(row());
    ok(row({ dropped_at: "2026-11-14T10:00:00.000Z" }));
    const line = await dropPlanLine(id);
    expect(fake.queries).toHaveLength(2);
    const update = callOf(1, "update");
    expect(Object.keys(update?.args[0] as object)).toEqual(["dropped_at"]);
    expect(line?.droppedAt).not.toBeNull();
  });

  it("is idempotent — dropping a dropped line returns it without a second write", async () => {
    ok(row({ dropped_at: "2026-11-14T10:00:00.000Z" }));
    const line = await dropPlanLine(id);
    expect(fake.queries).toHaveLength(1);
    expect(line?.droppedAt).toBe("2026-11-14T10:00:00.000Z");
  });

  it("still attempts the write for an ENDED line, so the trigger refuses it (27c)", async () => {
    ok(row({ ended_at: "2026-11-14T18:00:00.000Z", dropped_at: "2026-11-14T10:00:00.000Z" }));
    fail("Rule 27c: this plan line was ended at 2026-11-14 and can no longer change");
    await expect(dropPlanLine(id)).rejects.toThrow("Rule 27c");
    expect(fake.queries).toHaveLength(2);
  });
});

describe("endDay", () => {
  it("ends every open line in ONE statement and reports how many", async () => {
    ok([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(await endDay()).toBe(3);
    // One query, not a loop over lines: the plan can't be left half-ended.
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].table).toBe("plan_lines");
  });

  it("targets open lines only, and writes ONLY ended_at", async () => {
    ok([]);
    await endDay();
    expect(callOf(0, "is")?.args).toEqual(["ended_at", null]);
    expect(Object.keys(callOf(0, "update")?.args[0] as object)).toEqual(["ended_at"]);
    // No `eq`: it is not scoped to a line or a date, it ends the whole open plan.
    expect(opsOf(0)).not.toContain("eq");
  });

  it("is idempotent — with nothing open it touches nothing and returns 0", async () => {
    ok([]);
    expect(await endDay()).toBe(0);
  });

  it("touches no table but plan_lines — no session, no task", async () => {
    ok([{ id: "a" }]);
    await endDay();
    expect(fake.queries.map((q) => q.table)).toEqual(["plan_lines"]);
  });
});
