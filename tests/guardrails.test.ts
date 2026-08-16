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
  /** Anything that actually ends a session. */
  const ENDS_A_SESSION = /closeSession\s*\(|api\.patch<Session>\(\s*`\/api\/sessions\//;

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
