import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startSessionSchema } from "../src/lib/validators";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/**
 * Source-text guards must read CODE, not the prose around it. Every assertion
 * below that says "this file does not mention X" is about what the file DOES;
 * the comments in these files discuss the rejected designs at length, on
 * purpose, and a guard that trips on an explanation of why something was not
 * built is a guard that punishes documentation.
 */
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readCode = (p: string) => stripComments(read(p));

const TASK = "11111111-1111-4111-8111-111111111111";
const TOPIC = "22222222-2222-4222-8222-222222222222";

const gate = {
  kind: "focus" as const,
  what: "Rename the sync job",
  why: "It is blocking two tickets",
  finishLine: "Renamed and deployed to staging",
  checkInIntervalMinutes: 60 as const,
};

/**
 * ADR-0004 — the gate is the only door. These tests pin the two properties the
 * decision actually rests on: exactly one start target, and a Task that cannot
 * outlive a failed start.
 */
describe("ADR-0004 — one gate, two targets, exactly one of them", () => {
  it("accepts a start on an existing task (the `/` path)", () => {
    expect(startSessionSchema.safeParse({ ...gate, taskId: TASK }).success).toBe(true);
  });

  it("accepts a start on a new task by topic (the ⌘K path)", () => {
    expect(startSessionSchema.safeParse({ ...gate, topicId: TOPIC }).success).toBe(true);
  });

  it("rejects BOTH targets — the gate must know what it is starting", () => {
    expect(
      startSessionSchema.safeParse({ ...gate, taskId: TASK, topicId: TOPIC }).success,
    ).toBe(false);
  });

  it("rejects NEITHER target", () => {
    expect(startSessionSchema.safeParse(gate).success).toBe(false);
  });

  it("still enforces Rules 2 and 3 on the NEW-TASK target, not just the old one", () => {
    // The gate forking is the failure mode this whole shape exists to prevent:
    // a second target that quietly asks for less than the first.
    expect(startSessionSchema.safeParse({ ...gate, topicId: TOPIC, why: "" }).success).toBe(
      false,
    );
    expect(
      startSessionSchema.safeParse({ ...gate, topicId: TOPIC, why: "   " }).success,
    ).toBe(false);
    expect(
      startSessionSchema.safeParse({ ...gate, topicId: TOPIC, finishLine: "" }).success,
    ).toBe(false);
  });

  it("keeps `kind` to three arms — ADR-0004 added a target, never a fourth kind", () => {
    const validators = readCode("src/lib/validators/index.ts");
    expect(validators).toContain('z.discriminatedUnion("kind"');
    expect(validators).not.toMatch(/z\.literal\("drift"\)/);
    // The three arms, and nothing else.
    expect(validators.match(/kind: z\.literal\("[a-z]+"\)/g)).toEqual([
      'kind: z.literal("focus")',
      'kind: z.literal("pulled")',
      'kind: z.literal("filler")',
    ]);
  });

  it("adds NO new copy of WHY / FINISH LINE — the gate must not fork", () => {
    // Two declarations exist and both are correct: the START gate and the
    // PROMOTE gate (`promoteSessionSchema`). ADR-0004 gave the start gate a
    // second TARGET, and the point of doing it with one object rather than two
    // shapes is that it did not give it a second declaration of Rules 2 and 3.
    // A third copy appearing here is the fork: one of them will be relaxed.
    const validators = readCode("src/lib/validators/index.ts");
    expect(validators.match(/why: gateText/g)).toHaveLength(2);
    expect(validators.match(/finishLine: gateText/g)).toHaveLength(2);
  });
});

describe("ADR-0004 — a blocked start leaves no task behind", () => {
  const migration = read("supabase/migrations/0004_start_focus_on_new_task.sql");
  const body = migration.replace(/^\s*--.*$/gm, "");

  it("COMPOSES start_focus_session rather than copying its insert", () => {
    expect(body).toMatch(/select \* into s from start_focus_session\(/);
    // The Rules 2/3/4 focus-insert shape must live in exactly one migration.
    expect(body).not.toMatch(/insert into sessions/);
  });

  it("inserts the task inside the same function body — one transaction", () => {
    expect(body).toMatch(/insert into tasks/);
  });

  it("catches nothing — an exception must abort the whole transaction", () => {
    // A `begin ... exception when others` block here would let the outer
    // transaction survive a failed start, which is precisely how an orphan task
    // would get committed. That is the bug this function exists to prevent.
    expect(body).not.toMatch(/exception\s+when/i);
  });

  it("is not security definer — RLS applies to the one new write path", () => {
    const sql = migration.replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/security\s+definer/i);
  });
});

describe("ADR-0004 — the app has one door", () => {
  const quickCapture = readCode("src/components/capture/QuickCapture.tsx");

  it("QuickCapture renders the gate, not a capture-only form", () => {
    expect(quickCapture).toContain("GateForm");
    // It must not create a Task on its own: that would put a task insert in
    // front of Rule 1's conflict check.
    expect(quickCapture).not.toMatch(/\/api\/tasks/);
  });

  it("keeps the gate reachable by chord from every page", () => {
    expect(quickCapture).toMatch(/metaKey \|\| e\.ctrlKey/);
  });

  it("does NOT wire ⌘K to a destructive control while a session runs", () => {
    // Rebinding the chord onto the interrupt grid was designed and rejected:
    // `I drifted` closes the session in one unconfirmed tap and Rule 5 makes
    // that permanent. ⌘K navigates instead.
    expect(quickCapture).not.toContain("InterruptGrid");
    expect(quickCapture).toMatch(/router\.push\(`\/session\/\$\{active\.id\}`\)/);
  });

  it("decides what ⌘K does from a prop, not a fetch — the 150 ms open budget", () => {
    expect(quickCapture).not.toMatch(/api\.get.*sessions\/active/);
  });
});

describe("ADR-0004 — the one-time data migration is reversible", () => {
  const retire = read("supabase/migrations/0005_retire_pre_adr_0004_captures.sql");
  const retireBody = retire.replace(/^\s*--.*$/gm, "");

  it("marks pre-ADR-0004 captures `dropped` — it never deletes them", () => {
    expect(retireBody).toMatch(/set status = 'dropped'/);
    expect(retireBody).not.toMatch(/delete\s+from/i);
  });

  it("only touches backlog tasks that have no session at all", () => {
    expect(retireBody).toMatch(/t\.status = 'backlog'/);
    expect(retireBody).toMatch(
      /not exists \(select 1 from sessions s where s\.task_id = t\.id\)/,
    );
  });

  it("carries its own exact inverse, so the undo needs no bookkeeping", () => {
    expect(retire).toMatch(/set status = 'backlog'/);
  });

  it("cannot touch the log", () => {
    expect(retireBody).not.toMatch(/update sessions/i);
  });
});
