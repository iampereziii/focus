/**
 * SCAFFOLD GUARDRAILS.
 *
 * These are not unit tests of behaviour — they are the standing checks that the
 * v1 cuts and the two ADR-0002 constraints stay cut and stay enforced. Every one
 * of them corresponds to a line in the spec's Acceptance Criteria that says
 * "grep the codebase".
 *
 * They are cheap, they run on every `npm test`, and the failure mode they catch
 * is the documented one: an obviously-trivial one-liner added under time
 * pressure by an AI-paired session.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("ADR-0002 — the service worker is push-only", () => {
  const sw = read("public/sw.js");

  it("registers push and notificationclick", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
  });

  it("has NO fetch handler — a fetch handler reverses ADR-0002", () => {
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(sw).not.toMatch(/\bonfetch\s*=/);
  });

  it("has no cache API usage — no precache, no offline shell, no read cache", () => {
    expect(sw).not.toMatch(/\bcaches\s*\./);
  });

  it("is the ONLY service worker in the repo (Rule 26c: one prompt implementation)", () => {
    const swFiles = readdirSync(path.join(root, "public")).filter((f) =>
      /^(sw|service-worker)\b.*\.js$/.test(f),
    );
    expect(swFiles).toEqual(["sw.js"]);
  });
});

describe("v1 cuts — things that must not exist", () => {
  it("has no lib/ai/ folder (spec Gaps 3 & 4)", () => {
    expect(existsSync(path.join(root, "src/lib/ai"))).toBe(false);
  });

  it("has no /api/plan/today route", () => {
    expect(existsSync(path.join(root, "src/app/api/plan"))).toBe(false);
  });

  it("has no /topics pages or components — the board is cut (Gap 1)", () => {
    expect(existsSync(path.join(root, "src/app/(app)/topics"))).toBe(false);
    expect(existsSync(path.join(root, "src/components/topics"))).toBe(false);
  });

  it("KEEPS /api/topics — topic creation survives the board (Gap 14)", () => {
    expect(existsSync(path.join(root, "src/app/api/topics/route.ts"))).toBe(true);
  });

  it("declares no OPENAI_* variables (.env.example, Convention #2)", () => {
    // A *declaration*, commented out or not — the prose at the top of the file
    // deliberately names them to say they are cut.
    expect(read(".env.example")).not.toMatch(/^\s*#?\s*OPENAI_\w+\s*=/m);
  });

  it("declares no AI SDK dependency", () => {
    const pkg = read("package.json");
    expect(pkg).not.toMatch(/"(openai|@anthropic-ai\/sdk|ai)"\s*:/);
  });
});

describe("schema — the contract lives in the database", () => {
  const migration = read("supabase/migrations/0001_init.sql");

  it("creates exactly the five v1 tables", () => {
    const tables = [...migration.matchAll(/create table (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      "check_ins",
      "push_subscriptions",
      "sessions",
      "tasks",
      "topics",
    ]);
  });

  it("has no Pomodoro or DailyPlan table — both deferred to v1.1", () => {
    expect(migration).not.toMatch(/create table (pomodoros?|daily_plans?)/i);
  });

  it("gives `kind` exactly three members and never a fourth (Rule 16)", () => {
    expect(migration).toContain(
      "create type session_kind as enum ('focus', 'pulled', 'filler')",
    );
    // `drift` is a status, a correction target, and a day-split bucket — never a kind.
    expect(migration).not.toMatch(/session_kind as enum[^;]*'drift'/);
  });

  it("enforces Rule 1 with a partial unique index on the active session", () => {
    expect(migration).toMatch(
      /create unique index \w+ on sessions \(status\) where status = 'active'/,
    );
  });

  it("enforces the gate at the DB, kind-scoped (Rules 2, 3)", () => {
    expect(migration).toContain("sessions_focus_is_gated");
    expect(migration).toMatch(/btrim\(why\)\s*<>\s*''/);
    expect(migration).toMatch(/btrim\(finish_line\)\s*<>\s*''/);
  });

  it("requires a parent and an expected wait for `filler` (Rule 18)", () => {
    expect(migration).toContain("sessions_filler_needs_parent_and_wait");
  });

  it("requires an interruptTag for `pulled` and forbids it otherwise (Gap 17a)", () => {
    expect(migration).toContain("sessions_pulled_needs_tag");
  });

  it("enables RLS on all five tables (Gap 22)", () => {
    for (const t of [
      "topics",
      "tasks",
      "sessions",
      "check_ins",
      "push_subscriptions",
    ]) {
      expect(migration).toMatch(
        new RegExp(`alter table\\s+${t}\\s+enable row level security`),
      );
    }
  });

  it("uses the signed-in predicate and adds NO owner column (Gap 22)", () => {
    expect(migration).toContain("auth.uid() is not null");
    expect(migration).not.toMatch(/\buser_id\b/);
    expect(migration).not.toMatch(/\bowner_id\b/);
  });

  it("makes `kind` immutable with NO exception (Gap 26)", () => {
    // Promotion inserts a new row rather than relabelling one, so the trigger
    // needs no carve-out. If someone adds one back to make `promote` easier,
    // this fails — that is the point.
    expect(migration).toMatch(/if new\.kind is distinct from old\.kind then/);
    expect(migration).not.toMatch(/old\.kind\s*=\s*'filler'\s+and\s+new\.kind\s*=\s*'focus'/);
  });

  it("grants no delete policy on sessions — the log is append-only (Rule 14)", () => {
    expect(migration).not.toMatch(/create policy[^;]*on sessions[^;]*for delete/i);
  });

  it("seeds reference data only — the app starts empty (Gap 5)", () => {
    const seed = read("supabase/seed.sql");
    expect(seed).toMatch(/insert into topics/i);
    expect(seed).not.toMatch(/insert into sessions/i);
    expect(seed).not.toMatch(/insert into tasks/i);
  });
});

describe("schema after v1 — `plan_lines` (FOCUS-14, Rule 27, ADR-0004 Amendment 1)", () => {
  /**
   * The 0001 tests above still say "five tables" because they read 0001 alone, and
   * that is still true of 0001. The schema as a WHOLE now has six, and these pin it
   * so a seventh arrives deliberately. `plan_lines` is plain text for one day: the
   * columns, triggers and policies below are the amendment in SQL, and the
   * amendment says loosening any of them reverses ADR-0004.
   */
  const migrationsDir = path.join(root, "supabase/migrations");
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const allSql = migrationFiles.map((f) => readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
  const plan = read("supabase/migrations/0008_plan_lines.sql");
  const table = plan.slice(plan.indexOf("create table plan_lines"), plan.indexOf(");", plan.indexOf("create table plan_lines")));

  it("brings the schema to exactly six tables, and the sixth is plan_lines", () => {
    const tables = [...allSql.matchAll(/create table (\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      "check_ins",
      "plan_lines",
      "push_subscriptions",
      "sessions",
      "tasks",
      "topics",
    ]);
  });

  it("is NOT the shelved DailyPlan — no such table in ANY migration (spec Gaps 3 & 4)", () => {
    expect(allSql).not.toMatch(/create table (pomodoros?|daily_plans?)/i);
  });

  it("defines a plan line as plain text with six columns and no link to work", () => {
    const columns = [...table.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columns).toEqual(["id", "plan_date", "text", "created_at", "dropped_at", "ended_at"]);
    for (const forbidden of ["task_id", "session_id", "status", "position", "user_id", "owner_id"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });

  it("caps text at 1–200 characters, matching the validator", () => {
    expect(table).toMatch(/check \(length\(btrim\(text\)\) between 1 and 200\)/);
  });

  it("enforces ONE open plan in the database (Rule 27b)", () => {
    expect(plan).toContain("create trigger plan_lines_one_open_plan");
    expect(plan).toMatch(/before insert on plan_lines/);
    expect(plan).toContain("Rule 27b:");
  });

  it("enforces write-once in the database (Rule 27c) — a line is never edited", () => {
    expect(plan).toContain("create trigger plan_lines_write_once");
    expect(plan).toMatch(/before update on plan_lines/);
    expect(plan).toContain("Rule 27c:");
    for (const col of ["text", "plan_date", "created_at"]) {
      expect(plan, col).toMatch(new RegExp(`new\\.${col} is distinct from old\\.${col}`));
    }
  });

  it("freezes an ended line completely and never lets a dropped line un-drop", () => {
    expect(plan).toMatch(/if old\.ended_at is not null then/);
    expect(plan).toMatch(/old\.dropped_at is not null and new\.dropped_at is distinct from old\.dropped_at/);
  });

  it("has no clock in it — only the architect's End day ends a plan", () => {
    // No scheduled job, no pg_cron, no trigger that sets ended_at by itself.
    expect(plan).not.toMatch(/pg_cron|cron\.schedule|\bpg_sleep\b/i);
    expect(plan).not.toMatch(/new\.ended_at\s*:?=/);
  });

  it("uses the signed-in predicate with RLS on, and NO delete policy", () => {
    expect(plan).toMatch(/alter table plan_lines enable row level security/);
    expect(plan).toContain("auth.uid() is not null");
    expect(plan).not.toMatch(/create policy[^;]*on plan_lines[^;]*for delete/i);
    expect(plan).not.toMatch(/create policy plan_lines_delete/i);
  });

  it("touches no existing table or row — the whole change is undoable by dropping it", () => {
    expect(plan).not.toMatch(/^\s*(alter table|update|delete from|insert into)\s+(?!plan_lines)\w+/im);
    expect(plan).toContain("drop table plan_lines;");
  });

  it("0009 adds a text area's lines in ONE statement, in the order typed, with no privilege escalation", () => {
    // Its own migration: 0008 was merged (and may be applied) before the text area.
    const batch = read("supabase/migrations/0009_add_plan_lines.sql");
    const fn = batch.slice(batch.indexOf("create or replace function add_plan_lines"), batch.indexOf("$$;", batch.indexOf("create or replace function add_plan_lines")));
    expect(batch).toContain("drop function add_plan_lines(date, text[]);");
    // Adds a function and nothing else: no table, policy or row is touched.
    expect(batch).not.toMatch(/^\s*(create table|alter table|create policy|update|delete from)\b/im);
    expect(fn).toContain("returns setof plan_lines");
    // created_at IS the display order; ordinality is what keeps the typed order.
    expect(fn).toMatch(/with ordinality/);
    expect(fn).toMatch(/now\(\)\s*\+\s*\(n - 1\) \* interval '1 millisecond'/);
    // One insert, never a loop: all or nothing.
    expect(fn.match(/insert into/g)).toHaveLength(1);
    expect(fn).not.toMatch(/\bloop\b/i);
    expect(fn).not.toMatch(/security definer/i);
  });

  it("has no day-plan route that ranks or suggests (the cut /api/plan/today stays cut)", () => {
    expect(existsSync(path.join(root, "src/app/api/plan"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/api/plan-lines"))).toBe(true);
  });
});

describe("Rule 7 — no session is ever auto-closed", () => {
  /**
   * SHARPENED 2026-08-17, and deliberately not loosened.
   *
   * This test used to ban `setInterval` anywhere under `src/`. That is broader
   * than Rule 7 and it forbids two things the SAME SPEC requires:
   *
   *   - Rule 26's probe. "While a session is active, if `checkInIntervalMinutes`
   *     elapses with no interaction, the app ASKS." That is a client-side timer by
   *     definition; the rule cannot be built without one.
   *   - The running elapsed display ("gate submit → running timer", under 1 s).
   *
   * The distinction Rule 7 actually protects is the one Rule 26d rests on:
   * A TIMER THAT ASKS IS FINE. A TIMER THAT ENDS A SESSION IS NOT. The old grep
   * could not tell them apart — and, being scoped to `.ts`/`.tsx` under `src/`,
   * it would happily have passed a real server-side sweep written in plain JS.
   *
   * So it now checks two sharper things instead of one blunt one.
   */

  const sourceFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(root, "src"));
    return files;
  };

  const stripComments = (body: string): string =>
    body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const TIMER = /\bsetInterval\b|\bnode-cron\b|\bcron\b|\bsetTimeout\b/;
  /**
   * Anything that actually ends a session.
   *
   * WIDENED 2026-08-17. `close_session` is no longer the only way a row gets an
   * `ended_at`: `resume_session` settles the live child on its way to reactivating
   * the parent, and `promote_filler` closes both the filler and the grandparent. A
   * timer next to either would be an auto-close just as surely as one next to a
   * `PATCH` — and before the widening, this guardrail could not see them.
   */
  const ENDS_A_SESSION =
    /closeSession\s*\(|resumeSession\s*\(|promoteFiller\s*\(|api\.patch<Session>\(\s*`\/api\/sessions\/|\/(resume|promote)`/;

  it("has NO timer at all on the server — that is where a sweep would live", () => {
    // `lib/store/` and the route handlers are the only places a background job
    // could run unattended. Nothing there may schedule anything, ever.
    for (const file of sourceFiles()) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      if (!rel.startsWith("src/lib/store/") && !rel.startsWith("src/app/api/")) continue;

      expect(stripComments(readFileSync(file, "utf8")), `${rel} schedules work server-side`).not.toMatch(
        TIMER,
      );
    }
  });

  it("never puts a timer in the same file as a session-ending call", () => {
    // A file may own a clock, or it may close a session. Never both — that
    // adjacency is what an auto-close would be built from.
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(file, "utf8"));
      const rel = path.relative(root, file).replace(/\\/g, "/");

      if (!TIMER.test(code)) continue;
      expect(code, `${rel} owns a timer AND ends a session — Rule 7 has no exceptions`).not.toMatch(
        ENDS_A_SESSION,
      );
    }
  });

  it("keeps the check-in probe purely interrogative (Rule 26b)", () => {
    // The probe is the one client timer the design asks for. It must ask and
    // nothing else: an ignored prompt leaves the session exactly as it was.
    const probe = read("src/components/session/CheckInPrompt.tsx");
    expect(probe).not.toMatch(ENDS_A_SESSION);
    expect(probe).toContain("/api/checkins/");
  });
});
