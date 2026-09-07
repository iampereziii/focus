/**
 * PREFILL THE GATE ON RESTART — feature-brief-gate-prefill-on-restart.md.
 *
 * The feature is one missing write. `GateForm` has always seeded WHY and FINISH
 * LINE from the task; nothing ever wrote those columns, so the seed read null on
 * every restart. 0006 adds the write, 0007 backfills the tasks that predate it.
 *
 * Two things these tests exist to protect, and both are one plausible one-liner
 * from being lost:
 *
 *   1. THE GATE IS FILLED IN, NOT RELAXED. The sheet still opens, the fields are
 *      still required non-empty, `Start` is still a deliberate second act. A
 *      skip-the-sheet Resume was proposed and withdrawn (Risk 1) — it needs a
 *      superseding ADR, not a commit.
 *   2. `null` MEANS `off`, AND SURVIVES THE ROUND TRIP. Rule 26a makes `off` a
 *      first-class choice. `?? 60` anywhere on this path silently re-arms a
 *      probe the architect switched off, and it is exactly the shape of thing
 *      that gets added to make a type error go away.
 *
 * The write itself is plpgsql and needs a live Supabase (tests/README.md), so
 * the SQL assertions below are source-text guards on the migration — the same
 * shape and the same job as `start-on-capture.test.ts`'s.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toTask } from "../src/lib/store/mappers";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** Source-text guards must read CODE, not the prose around it. */
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readCode = (p: string) => stripComments(read(p));
const readSql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const taskRow = {
  id: "11111111-1111-4111-8111-111111111111",
  topic_id: "22222222-2222-4222-8222-222222222222",
  what: "Rename the sync job",
  why: "It is blocking two tickets",
  finish_line: "Renamed and deployed to staging",
  check_in_interval_minutes: 30,
  status: "backlog",
  estimate_minutes: null,
  created_at: "2026-08-26T09:00:00.000Z",
  completed_at: null,
};

describe("the task carries the last stated gate values", () => {
  it("maps all three carried columns onto the Task", () => {
    const task = toTask(taskRow);
    expect(task.why).toBe("It is blocking two tickets");
    expect(task.finishLine).toBe("Renamed and deployed to staging");
    expect(task.checkInIntervalMinutes).toBe(30);
  });

  it("carries `off` as null — never as a defaulted 60 (Rule 26a)", () => {
    // The whole point of Risk 3. `off` is a choice, not an absence.
    expect(toTask({ ...taskRow, check_in_interval_minutes: null }).checkInIntervalMinutes).toBe(
      null,
    );
  });

  it("rejects an interval nobody could have chosen at the gate", () => {
    // A value outside 30/60/90/off means something WROTE one. Rule 26a says the
    // interval is stated, never invented — so this throws rather than rounding.
    expect(() => toTask({ ...taskRow, check_in_interval_minutes: 45 })).toThrow(/Rule 26a/);
  });

  it("still maps a task whose values were never stated — nulls, not throws", () => {
    // Pre-0007 rows, and any task 0007 could not source from a session.
    const bare = toTask({ ...taskRow, why: null, finish_line: null, check_in_interval_minutes: null });
    expect(bare.why).toBe(null);
    expect(bare.finishLine).toBe(null);
    expect(bare.checkInIntervalMinutes).toBe(null);
  });

  it("narrows the interval ONCE, for both sessions and tasks", () => {
    // Two copies of the 30/60/90/null check is how the two drift, and the tasks
    // column exists precisely to mirror the sessions one. Same argument as the
    // single push code path.
    const mappers = readCode("src/lib/store/mappers.ts");
    expect(mappers.match(/Rule 26a/g)).toHaveLength(1);
    expect(mappers.match(/checkInInterval\(row, "check_in_interval_minutes"\)/g)).toHaveLength(2);
  });
});

describe("GateForm — pre-filled, never pre-empted", () => {
  const gate = readCode("src/components/session/GateForm.tsx");

  it("seeds WHY and FINISH LINE from the task", () => {
    expect(gate).toMatch(/useState\(task\?\.why \?\? ""\)/);
    expect(gate).toMatch(/useState\(task\?\.finishLine \?\? ""\)/);
  });

  it("seeds the interval by MODE, not by coalescing null away", () => {
    // `task?.checkInIntervalMinutes ?? 60` is the tempting one-liner and it
    // un-chooses `off`. The branch is the fix; this pins it.
    expect(gate).toMatch(/newTaskMode \? 60 : task\.checkInIntervalMinutes/);
    expect(gate).not.toMatch(/checkInIntervalMinutes \?\? \d+/);
  });

  it("still rejects a cleared field — prefill does not make it optional", () => {
    // Rules 2 and 3. Clearing a pre-filled WHY and pressing Start must fail
    // exactly as a blank one always did.
    expect(gate).toMatch(/if \(why\.trim\(\) === ""\)/);
    expect(gate).toMatch(/if \(finishLine\.trim\(\) === ""\)/);
  });

  it("renders both carried fields as ordinary editable inputs", () => {
    // No `readOnly`, no `disabled`, no placeholder-style dimming on the two
    // pre-filled fields — a dimmed value reads as "this will not submit", which
    // is the opposite of what happens. Only WHAT is read-only.
    expect(gate.match(/readOnly/g)).toHaveLength(1);
    // Matched as separate props rather than as one `value={why} onChange` run:
    // both textareas gained an auto-grow `ref` and a `className` on 2026-09-07,
    // so the props are on their own lines now. What is being asserted is
    // unchanged — the value is bound and the field is editable.
    expect(gate).toMatch(/value=\{why\}/);
    expect(gate).toMatch(/onChange=\{\(e\) => setWhy\(e\.target\.value\)\}/);
    expect(gate).toMatch(/value=\{finishLine\}/);
    expect(gate).toMatch(/onChange=\{\(e\) => setFinishLine\(e\.target\.value\)\}/);
  });

  it("adds NO sixth field — the sheet is at its ceiling", () => {
    // Five is the edge of the safe band (CLAUDE.md #2). The rejected follow-on
    // was showing the previous session's outcome note above WHY (Risk 4).
    expect(gate.match(/<Field label=/g)).toHaveLength(5);
    expect(gate).not.toMatch(/outcomeNote/);
  });

  it("keeps `Start` a deliberate second act — no auto-submit on open", () => {
    // The withdrawn one-tap Resume (Risk 1) would appear here as a start fired
    // from an effect or on mount rather than from the button.
    expect(gate).not.toMatch(/useEffect/);
    expect(gate).toMatch(/onClick=\{\(\) => void start\(\)\}/);
  });
});

describe("0006 — the write-through goes in the callee", () => {
  const sql = readSql("supabase/migrations/0006_carry_the_gate_onto_the_task.sql");

  it("adds the interval column to tasks, nullable, with the sessions CHECK", () => {
    expect(sql).toMatch(/alter table tasks\s+add column check_in_interval_minutes int/);
    expect(sql).toMatch(/check \(check_in_interval_minutes in \(30, 60, 90\)\)/);
    // Nullable is load-bearing: null is `off`. A NOT NULL here would make the
    // architect's "off" unrepresentable.
    expect(sql).not.toMatch(/check_in_interval_minutes int not null/);
  });

  it("writes the task inside start_focus_session, so BOTH doors get it", () => {
    // 0004's `start_focus_on_new_task` delegates here. Putting the write in the
    // caller would have covered one of the two start paths.
    expect(sql).toMatch(/create or replace function start_focus_session\(/);
    expect(sql).toMatch(/update tasks/);
    expect(sql).toMatch(/set why\s+= p_why/);
    expect(sql).toMatch(/finish_line\s+= p_finish_line/);
    expect(sql).toMatch(/check_in_interval_minutes = p_interval/);
  });

  it("assigns the interval straight — no coalesce to a default (Rule 26a)", () => {
    expect(sql).not.toMatch(/coalesce\s*\(\s*p_interval/i);
  });

  it("does not duplicate start_focus_on_new_task", () => {
    // plpgsql has no body reuse, so the tempting shortcut is to paste 0004's
    // body and add the write. That is two copies of the composition, and the
    // second is the one that rots.
    expect(sql).not.toMatch(/create or replace function start_focus_on_new_task/);
    expect(sql).not.toMatch(/insert into tasks/);
  });

  it("leaves Rule 1's conflict check and its error string untouched", () => {
    // The string maps to a 409 in src/lib/http.ts `apiFailure()`. Changing it
    // changes an HTTP status.
    expect(sql).toMatch(/Rule 1: session % is already active/);
    expect(sql).toMatch(/errcode = 'unique_violation'/);
  });

  it("cannot break Rule 4 — it writes no existing sessions row", () => {
    // The direction is Task <- gate, never Session <- Task. The only sessions
    // statement in the file is the gate's own insert.
    expect(sql).not.toMatch(/update sessions/i);
    expect(sql.match(/insert into sessions/g)).toHaveLength(1);
  });

  it("is not security definer — RLS still applies", () => {
    expect(sql).not.toMatch(/security\s+definer/i);
  });
});

describe("0007 — the backfill is one-time, reversible, and reads the log only", () => {
  const backfill = read("supabase/migrations/0007_backfill_task_gate_values.sql");
  const sql = readSql("supabase/migrations/0007_backfill_task_gate_values.sql");

  it("takes the most recent focus session per task, with no outcome ranking", () => {
    // Preferring `partial` over `abandoned` was rejected as a ranking the app
    // would invent rather than read (Risk 5) — the same instinct Rule 12 rules
    // out on `/`.
    expect(sql).toMatch(/distinct on \(task_id\)/);
    expect(sql).toMatch(/order by task_id, started_at desc/);
    expect(sql).toMatch(/where kind = 'focus'/);
    expect(sql).not.toMatch(/status\s*(=|in)\s*'?\(?\s*'partial'/);
  });

  it("copies `off` across as null (Rule 26a)", () => {
    expect(sql).not.toMatch(/coalesce\s*\([^)]*check_in_interval_minutes[^)]*,\s*\d+\s*\)/i);
    expect(sql).toMatch(/check_in_interval_minutes = s\.check_in_interval_minutes/);
  });

  it("preserves what promote_filler already wrote", () => {
    // `promote_filler` (0002:370) is the one path that has always written
    // why/finish_line. The backfill must not overwrite it.
    expect(sql).toMatch(/coalesce\(t\.why, s\.why\)/);
    expect(sql).toMatch(/coalesce\(t\.finish_line, s\.finish_line\)/);
  });

  it("touches nothing with no focus session, and deletes nothing", () => {
    expect(sql).toMatch(/from sessions/);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("cannot touch the log — Rule 5", () => {
    expect(sql).not.toMatch(/update sessions/i);
    expect(sql).not.toMatch(/insert into sessions/i);
  });

  it("carries its own undo, the way 0005 does", () => {
    // Trivial today, not trivial in six months. That is the argument FOR
    // writing it down, not against.
    expect(backfill).toMatch(/HOW TO UNDO IT/);
    expect(backfill).toMatch(
      /set why = null, finish_line = null, check_in_interval_minutes = null/,
    );
  });
});
