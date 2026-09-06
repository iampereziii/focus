/**
 * The in-session scratchpad (feature-brief-session-scratchpad-checklist.md).
 *
 * Same split as the rest of this suite: schema-level rules are asserted by reading
 * the migration (the DB is the contract, and there is no live Supabase here — see
 * tests/README.md), behaviour that lives in TypeScript is asserted directly.
 *
 * TWO OF THESE ARE STANDING TRAPS rather than tests of this feature:
 *
 *   - the RLS check, because `guardrails.test.ts` reads ONLY `0001_init.sql` and
 *     iterates a hardcoded five-name list, so it does not — and did not — cover
 *     any table added after the initial migration. Rule 15 says RLS is on every
 *     table; until that check scans the directory, each new table has to bring
 *     its own. This one brings its own.
 *   - the `touchSession()` caller check, because that function shipped with the
 *     Rule 26 work and sat with ZERO callers until this feature — the same
 *     dead-write-path class as `resume` and `promote`
 *     (feature-brief-resume-parent-on-interrupt-close.md).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createChecklistItemSchema, updateChecklistItemSchema } from "@/lib/validators";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const migration = read("supabase/migrations/0008_checklist_items.sql");

describe("schema — checklist_items", () => {
  it("creates the table with a session FK", () => {
    expect(migration).toMatch(/create table checklist_items/);
    expect(migration).toMatch(/session_id\s+uuid not null references sessions\(id\)/);
  });

  it("caps item text at 200 chars, mirroring tasks.what", () => {
    expect(migration).toMatch(/check \(length\(text\) between 1 and 200\)/);
    // The constraint it mirrors still says the same thing — if `tasks.what` moves,
    // this pair should be re-decided rather than silently diverging.
    expect(read("supabase/migrations/0001_init.sql")).toMatch(
      /check \(length\(what\) between 1 and 200\)/,
    );
  });

  it("has NO position column — append order is the whole ordering model", () => {
    expect(migration).not.toMatch(/^\s*position\s/m);
  });

  it("freezes the checklist when the session closes (Rule 6, scoped)", () => {
    expect(migration).toMatch(/create trigger checklist_items_guard/);
    expect(migration).toMatch(/before insert or update or delete on checklist_items/);
    // The message must carry the rule number: `apiFailure` matches on "Rule 6" to
    // turn this into a 409 rather than a 500.
    expect(migration).toMatch(/Rule 6: session % is closed/);
  });

  it("enables RLS with the same predicate as every other table (Rule 15)", () => {
    expect(migration).toMatch(/alter table checklist_items enable row level security/);
    for (const verb of ["select", "insert", "update", "delete"]) {
      expect(migration).toMatch(
        new RegExp(`create policy checklist_items_${verb}_signed_in`),
      );
    }
    expect(migration).toMatch(/auth\.uid\(\) is not null/);
    // No owner column, ever — single user, not multi-tenant.
    expect(migration).not.toMatch(/user_id|owner_id/);
  });

  it("is the only new table in this migration", () => {
    const tables = [...migration.matchAll(/create table (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["checklist_items"]);
  });
});

describe("RLS covers every table, including ones added after 0001 (Rule 15)", () => {
  /**
   * The check `guardrails.test.ts` cannot make, because it reads a single file.
   * Every `create table` anywhere in the migrations directory must be followed —
   * in the same file — by `enable row level security` for that table.
   */
  it("no migration creates a table without enabling RLS on it", () => {
    const dir = path.join(root, "supabase/migrations");
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      for (const [, table] of sql.matchAll(/create table (?:if not exists )?(\w+)/g)) {
        const enabled = new RegExp(`alter table\\s+${table}\\s+enable row level security`);
        if (!enabled.test(sql)) offenders.push(`${file}: ${table}`);
      }
    }

    expect(offenders, `tables created without RLS: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("validators", () => {
  it("accepts a normal line and trims it", () => {
    const parsed = createChecklistItemSchema.parse({ text: "  wire the store  " });
    expect(parsed.text).toBe("wire the store");
  });

  it("rejects empty and whitespace-only text", () => {
    expect(createChecklistItemSchema.safeParse({ text: "" }).success).toBe(false);
    expect(createChecklistItemSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects text over 200 chars, matching the DB check", () => {
    expect(createChecklistItemSchema.safeParse({ text: "x".repeat(200) }).success).toBe(true);
    expect(createChecklistItemSchema.safeParse({ text: "x".repeat(201) }).success).toBe(false);
  });

  it("allows a toggle, a retitle, or both", () => {
    expect(updateChecklistItemSchema.safeParse({ done: true }).success).toBe(true);
    expect(updateChecklistItemSchema.safeParse({ text: "revised" }).success).toBe(true);
    expect(updateChecklistItemSchema.safeParse({ text: "revised", done: true }).success).toBe(
      true,
    );
  });

  it("rejects an empty PATCH rather than silently no-opping", () => {
    expect(updateChecklistItemSchema.safeParse({}).success).toBe(false);
  });
});

describe("Rule 26 — deferred by working, never silenced by working", () => {
  const store = read("src/lib/store/checklist-items.ts");

  it("bumps the probe clock on every write", () => {
    // create / update / delete — all three call it.
    expect(store.match(/touchSession\(/g)?.length).toBeGreaterThanOrEqual(4); // 3 calls + import
  });

  it("never writes answered_at — an unanswered prompt stays unanswered", () => {
    // Comments stripped first: this file's doc block discusses `answered_at` at
    // length precisely to say it must not be written. The prose is the point; the
    // assertion is about the CODE.
    const code = store.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/answered_at|answeredAt|recordAnswer/);
  });

  it("gives touchSession() its first caller — it shipped dead", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(full, "utf8"));
      }
      return out;
    };
    const callers = walk(path.join(root, "src"))
      .filter((src) => /touchSession\(/.test(src))
      .filter((src) => !/export async function touchSession/.test(src));

    expect(callers.length, "touchSession() has no callers — a dead write path").toBeGreaterThan(
      0,
    );
  });
});

describe("Rule 6 surfaces as a 409, not a 500", () => {
  it("apiFailure maps the trigger's message", () => {
    expect(read("src/lib/http.ts")).toMatch(/message\.includes\("Rule 6"\)/);
  });
});

describe("delete stays narrow", () => {
  it("no delete route exists for sessions themselves", () => {
    const base = path.join(root, "src/app/api/sessions");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name === "route.ts") out.push(full);
      }
      return out;
    };

    for (const file of walk(base)) {
      if (file.includes("checklist-items")) continue; // the one exception, by design
      expect(
        readFileSync(file, "utf8"),
        `${path.relative(root, file)} exports DELETE — sessions are append-only (Rule 6)`,
      ).not.toMatch(/export (async )?function DELETE\(/);
    }
  });
});
