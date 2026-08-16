/**
 * RETURNING FROM AN INTERRUPT — and the dead-endpoint class of bug behind it.
 *
 * Reported 2026-08-17 as "when I close out a pulled task, the main focus closes
 * out as well". It did not close. `SessionView.close()` `PATCH`ed every session
 * alike, which ends that one row and only that row — so the interrupt ended, the
 * session it had suspended stayed `suspended` with nothing `active`, and the app
 * returned to the backlog. From the outside that is indistinguishable from having
 * closed the morning's real work, and the only route back was the next day's
 * review.
 *
 * THE TRANSACTION WAS NEVER THE PROBLEM. `resume_session` is correct and has been
 * since it was written; `POST /api/sessions/[id]/resume` is correct; the store
 * function is correct. NOTHING CALLED THEM. The same was true of `promote`, which
 * is why Rule 18's post-cap disposition offered three choices and rendered no
 * controls for any of them.
 *
 * So the standing check here is not "does resume work" — Postgres owns that, and
 * tests/README.md names it as integration territory. It is: DOES ANYTHING CALL IT.
 * A route with no caller passes typecheck, passes lint, passes review, and does
 * nothing. That is the bug class, and the last describe block is the trap for it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { resumeSessionSchema } from "@/lib/validators";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("resumeSessionSchema — settling the child on the way back", () => {
  it("defaults to `partial` with no note when the body is empty", () => {
    // The one-tap path posts nothing. An interrupt's end is the tightest tap
    // budget in the app (ADR-0003), so "no body" has to mean something sensible.
    expect(resumeSessionSchema.parse(undefined)).toEqual({
      childStatus: "partial",
      childOutcomeNote: null,
    });
  });

  it("accepts `drifted` — a drifted interrupt still hands the parent back", () => {
    // Rule 16: drift is a STATUS, not a kind. The check-in probe can settle a
    // child this way, and before this was allowed the drift button was a second
    // doorway to the exact bug this file is named after.
    const parsed = resumeSessionSchema.parse({ childStatus: "drifted" });
    expect(parsed.childStatus).toBe("drifted");
  });

  it("accepts every status a close-out offers", () => {
    for (const childStatus of ["done", "partial", "switched", "drifted", "abandoned"]) {
      expect(resumeSessionSchema.safeParse({ childStatus }).success).toBe(true);
    }
  });

  it("refuses to REOPEN — `active` and `suspended` are not settlements", () => {
    expect(resumeSessionSchema.safeParse({ childStatus: "active" }).success).toBe(false);
    expect(resumeSessionSchema.safeParse({ childStatus: "suspended" }).success).toBe(false);
  });

  it("bounds the outcome note like every other note", () => {
    expect(
      resumeSessionSchema.safeParse({ childOutcomeNote: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});

describe("the close-out routes on `parentSessionId`", () => {
  const view = read("src/components/session/SessionView.tsx");

  it("sends a parented close to the PARENT's resume endpoint", () => {
    expect(view).toMatch(/api\.post<Session>\(\s*`\/api\/sessions\/\$\{parentId\}\/resume`/);
  });

  it("still PATCHes a root session — that path is unchanged", () => {
    expect(view).toMatch(/api\.patch<Session>\(\s*`\/api\/sessions\/\$\{session\.id\}`/);
  });

  it("branches on the parent rather than on `kind`", () => {
    // `kind` is the wrong discriminator: Rule 19 allows a PARENTLESS `pulled`,
    // which must close like a root session and land on the backlog. Branching on
    // kind would try to resume a parent that was never there.
    expect(view).toContain("parentId !== null");
  });

  it("never teaches close_session to cascade — that function stays single-row", () => {
    // The tempting "simplification" is to make close_session reactivate parents.
    // It sits next to Rule 5's immutability check and must not grow a second job.
    const closeSession = read("supabase/migrations/0002_session_transactions.sql")
      .split("create or replace function close_session")[1]
      .split("create or replace function")[0];
    expect(closeSession).not.toMatch(/status\s*=\s*'active'/);
    expect(closeSession).not.toContain("parent_session_id");
  });
});

describe("Rule 18's forced disposition is reachable", () => {
  const view = read("src/components/session/SessionView.tsx");

  it("offers all three choices as controls, not as prose", () => {
    // It used to say "Choose: resume the parent, close this, or promote it" in a
    // <p>, with nothing behind any of the three.
    expect(view).toContain("setPromoting(true)");
    expect(view).toContain("setClosing(true)");
    expect(view).toMatch(/void close\("partial"\)/);
  });

  it("gates a promotion instead of bypassing the gate (Rules 2/3)", () => {
    const form = read("src/components/session/PromoteForm.tsx");
    expect(form).toContain("finishLine");
    expect(form).toContain("why");
    // Promotion INSERTS a gated focus row; it never relabels a kind (Gap 26).
    expect(form).not.toMatch(/\bkind\s*:/);
  });

  it("pre-selects the inherited check-in interval (Rule 26f)", () => {
    expect(read("src/components/session/PromoteForm.tsx")).toContain(
      "filler.checkInIntervalMinutes",
    );
  });
});

describe("no session write path is left without a caller", () => {
  /**
   * THE STANDING TRAP. Both halves of this fix were endpoints that existed,
   * typechecked, and were called from nowhere — `resume` for the whole life of the
   * app, `promote` likewise. Neither lint nor `tsc` can see that, and a reviewer
   * reading the route file sees correct code.
   *
   * So: every session sub-route must be referenced by something the user can
   * actually reach. If a future route is added and never wired, this fails at the
   * moment the route lands rather than the day someone needs it.
   */

  const sessionRoutes = (): string[] => {
    const base = path.join(root, "src/app/api/sessions");
    const names: string[] = [];
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== "[id]") {
        names.push(entry.name);
        continue;
      }
      for (const sub of readdirSync(path.join(base, entry.name), { withFileTypes: true })) {
        if (sub.isDirectory()) names.push(sub.name);
      }
    }
    return names;
  };

  const clientSources = (): string => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(full, "utf8"));
      }
    };
    walk(path.join(root, "src/components"));
    walk(path.join(root, "src/app/(app)"));
    return out.join("\n");
  };

  it("finds a caller for every /api/sessions sub-route", () => {
    const callers = clientSources();
    for (const name of sessionRoutes()) {
      expect(callers, `/api/sessions/…/${name} has no caller — a dead endpoint`).toContain(
        `/${name}`,
      );
    }
  });

  it("covers resume and promote specifically — the two that were dead", () => {
    const routes = sessionRoutes();
    expect(routes).toContain("resume");
    expect(routes).toContain("promote");
  });
});
