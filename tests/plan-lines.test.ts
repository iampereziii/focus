/**
 * FOCUS-14 — the plain-text day plan (Rule 27, ADR-0004 Amendment 1).
 *
 * Same shape and job as `backlog-plainness.test.ts`: some of this is behaviour,
 * and some of it is a standing check that a decision stays decided. The decision
 * here is the one that was reached by BUILDING the richer version and removing it
 * on 2026-11-15: a plan line is plain text. It isn't tappable, carries no status
 * or count, links to no Task or Session, can't be edited or reordered, and a day
 * ends only when the architect presses End day. Every one of those is one
 * plausible-looking commit away from coming back ("just show whether it was
 * started"), and each reverses the amendment — so each is asserted below.
 *
 * Not covered here, and why: the database's own rules (one open plan, written
 * once). They are triggers in `0008_plan_lines.sql`; a unit test can't fire one.
 * See `plan-lines-store.test.ts`, `guardrails.test.ts` (the migration's text) and
 * `tests/README.md`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  listOpenPlan: vi.fn(),
  addPlanLine: vi.fn(),
  dropPlanLine: vi.fn(),
  endDay: vi.fn(),
}));

vi.mock("@/lib/store/auth-server", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("@/lib/store/plan-lines", () => ({
  listOpenPlan: mocks.listOpenPlan,
  addPlanLine: mocks.addPlanLine,
  dropPlanLine: mocks.dropPlanLine,
  endDay: mocks.endDay,
}));

import { GET, POST } from "@/app/api/plan-lines/route";
import { POST as dropRoute } from "@/app/api/plan-lines/[id]/drop/route";
import { POST as endDayRoute } from "@/app/api/plan-lines/end-day/route";
import { createPlanLineSchema } from "@/lib/validators";
import { toPlanLine } from "@/lib/store/mappers";
import { apiFailure } from "@/lib/http";
import { EFFECTS, keysFor } from "@/lib/api";
import { isStalePlan, localDateKey, planDateLabel } from "@/lib/local-date";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ID = "6f1c1f0e-3d2a-4b7a-9c55-0a7e5f2b8d11";
const line = {
  id: ID,
  planDate: "2026-11-14",
  text: "Review the checkout PR",
  createdAt: "2026-11-14T09:00:00.000Z",
  droppedAt: null,
  endedAt: null,
};
const post = (body: unknown) =>
  new Request("http://x/api/plan-lines", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.currentUserId.mockResolvedValue("user-1");
});

// ── the boundary ──────────────────────────────────────────────────────────────

describe("createPlanLineSchema — text and the browser's date, nothing else", () => {
  it("accepts a line and trims it", () => {
    const r = createPlanLineSchema.parse({ text: "  Review the PR  ", planDate: "2026-11-14" });
    expect(r).toEqual({ text: "Review the PR", planDate: "2026-11-14" });
  });

  it("rejects blank text — a whitespace-only line isn't a line", () => {
    expect(createPlanLineSchema.safeParse({ text: "   ", planDate: "2026-11-14" }).success).toBe(false);
    expect(createPlanLineSchema.safeParse({ text: "", planDate: "2026-11-14" }).success).toBe(false);
  });

  it("caps text at 200 characters, matching the column", () => {
    expect(createPlanLineSchema.safeParse({ text: "x".repeat(200), planDate: "2026-11-14" }).success).toBe(true);
    expect(createPlanLineSchema.safeParse({ text: "x".repeat(201), planDate: "2026-11-14" }).success).toBe(false);
  });

  it("requires a REAL calendar date, not just the right shape", () => {
    for (const planDate of ["2026-02-30", "14-11-2026", "2026-11-14T09:00:00Z", "tomorrow", ""]) {
      expect(createPlanLineSchema.safeParse({ text: "x", planDate }).success, planDate).toBe(false);
    }
    expect(createPlanLineSchema.safeParse({ text: "x" }).success).toBe(false);
  });

  it("drops anything that would link a line to work — it is plain text (27a)", () => {
    const r = createPlanLineSchema.parse({
      text: "x",
      planDate: "2026-11-14",
      taskId: ID,
      sessionId: ID,
      status: "started",
      position: 3,
    });
    expect(Object.keys(r).sort()).toEqual(["planDate", "text"]);
  });
});

// ── the browser's date ────────────────────────────────────────────────────────

describe("local date — the BROWSER's day, never the server's clock", () => {
  it("formats the LOCAL calendar date, regardless of what UTC says", () => {
    // Built from local parts, so this holds in any timezone the test runs in.
    expect(localDateKey(new Date(2026, 10, 14, 23, 59))).toBe("2026-11-14");
    expect(localDateKey(new Date(2026, 10, 15, 0, 1))).toBe("2026-11-15");
    expect(localDateKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05"); // zero-padded
  });

  it("calls a plan stale only when it was opened on a strictly earlier day", () => {
    expect(isStalePlan("2026-11-13", "2026-11-14")).toBe(true);
    expect(isStalePlan("2025-12-31", "2026-01-01")).toBe(true); // across a year
    expect(isStalePlan("2026-11-14", "2026-11-14")).toBe(false);
  });

  it("does not call a future-dated plan stale — it is simply still the open plan", () => {
    // The architect travelled west or changed the clock. Nothing is forgotten.
    expect(isStalePlan("2026-11-15", "2026-11-14")).toBe(false);
  });

  it("answers false while either side is unknown, so nothing flashes stale on hydration", () => {
    expect(isStalePlan(null, "2026-11-14")).toBe(false);
    expect(isStalePlan("2026-11-13", null)).toBe(false);
    expect(isStalePlan(null, null)).toBe(false);
  });

  it("labels a plan date without shifting it a day with the timezone", () => {
    expect(planDateLabel("2026-11-13")).toBe("Fri 13 Nov");
    expect(planDateLabel("2026-12-01")).toBe("Tue 1 Dec");
    expect(planDateLabel("2026-01-01")).toBe("Thu 1 Jan");
  });
});

// ── the mapper ────────────────────────────────────────────────────────────────

describe("toPlanLine — six fields, and no way to link or rank", () => {
  const rowOf = (over: Record<string, unknown> = {}) => ({
    id: ID,
    plan_date: "2026-11-14",
    text: "Review the checkout PR",
    created_at: "2026-11-14T09:00:00.000Z",
    dropped_at: null,
    ended_at: null,
    ...over,
  });

  it("maps snake_case to camelCase", () => {
    expect(toPlanLine(rowOf())).toEqual(line);
  });

  it("carries exactly six keys — no taskId, sessionId, status or position", () => {
    expect(Object.keys(toPlanLine(rowOf())).sort()).toEqual(
      ["createdAt", "droppedAt", "endedAt", "id", "planDate", "text"],
    );
  });

  it("round-trips dropped and ended timestamps", () => {
    const l = toPlanLine(rowOf({ dropped_at: "2026-11-14T10:00:00Z", ended_at: "2026-11-14T18:00:00Z" }));
    expect(l.droppedAt).toBe("2026-11-14T10:00:00Z");
    expect(l.endedAt).toBe("2026-11-14T18:00:00Z");
  });

  it("throws on a malformed row instead of inventing a value", () => {
    expect(() => toPlanLine(rowOf({ text: undefined }))).toThrow(TypeError);
    expect(() => toPlanLine(rowOf({ plan_date: 20261114 }))).toThrow(TypeError);
  });
});

// ── the routes ────────────────────────────────────────────────────────────────

describe("/api/plan-lines — every route is signed-in only", () => {
  it("answers 401 to all four when nobody is signed in", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    expect((await GET(new Request("http://x"))).status).toBe(401);
    expect((await POST(post({ text: "x", planDate: "2026-11-14" }))).status).toBe(401);
    expect((await dropRoute(post({}), params(ID))).status).toBe(401);
    expect((await endDayRoute(post({}))).status).toBe(401);
    expect(mocks.addPlanLine).not.toHaveBeenCalled();
    expect(mocks.endDay).not.toHaveBeenCalled();
  });
});

describe("GET /api/plan-lines", () => {
  it("returns the open plan in the { data } envelope, with no date parameter", async () => {
    mocks.listOpenPlan.mockResolvedValue({ planDate: "2026-11-14", lines: [line] });
    const res = await GET(new Request("http://x/api/plan-lines"));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ data: { planDate: "2026-11-14", lines: [line] } });
    expect(mocks.listOpenPlan).toHaveBeenCalledWith(); // called with nothing
  });
});

describe("POST /api/plan-lines", () => {
  it("creates a line and answers 201", async () => {
    mocks.addPlanLine.mockResolvedValue(line);
    const res = await POST(post({ text: " Review the checkout PR ", planDate: "2026-11-14" }));
    expect(res.status).toBe(201);
    expect(mocks.addPlanLine).toHaveBeenCalledWith({
      text: "Review the checkout PR",
      planDate: "2026-11-14",
    });
  });

  it("answers 422 for a bad body and writes nothing", async () => {
    for (const body of [null, {}, { text: "x" }, { text: "", planDate: "2026-11-14" }, { text: "x", planDate: "nope" }]) {
      expect((await POST(post(body))).status).toBe(422);
    }
    expect(mocks.addPlanLine).not.toHaveBeenCalled();
  });

  it("answers 409 plan_locked when an earlier day's plan is still open (27b)", async () => {
    mocks.addPlanLine.mockRejectedValue(
      new Error("Rule 27b: an earlier plan is still open — end that day before starting another"),
    );
    const res = await POST(post({ text: "tomorrow", planDate: "2026-11-15" }));
    expect(res.status).toBe(409);
    expect(((await json(res)).error as { code: string }).code).toBe("plan_locked");
  });
});

describe("POST /api/plan-lines/[id]/drop", () => {
  it("crosses a line out", async () => {
    const dropped = { ...line, droppedAt: "2026-11-14T10:00:00.000Z" };
    mocks.dropPlanLine.mockResolvedValue(dropped);
    const res = await dropRoute(post({}), params(ID));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ data: dropped });
    expect(mocks.dropPlanLine).toHaveBeenCalledWith(ID);
  });

  it("answers 404 for a malformed id without ever reaching the database", async () => {
    const res = await dropRoute(post({}), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(mocks.dropPlanLine).not.toHaveBeenCalled();
  });

  it("answers 404 for a line that doesn't exist", async () => {
    mocks.dropPlanLine.mockResolvedValue(null);
    expect((await dropRoute(post({}), params(ID))).status).toBe(404);
  });

  it("answers 409 for a line that has been ended (27c)", async () => {
    mocks.dropPlanLine.mockRejectedValue(new Error("Rule 27c: this plan line was ended at … and can no longer change"));
    expect((await dropRoute(post({}), params(ID))).status).toBe(409);
  });
});

describe("POST /api/plan-lines/end-day", () => {
  it("ends the day and says how many lines it ended", async () => {
    mocks.endDay.mockResolvedValue(4);
    const res = await endDayRoute(post({}));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ data: { ended: 4 } });
  });

  it("is safe to press twice — the second press reports zero", async () => {
    mocks.endDay.mockResolvedValue(0);
    expect(await json(await endDayRoute(post({})))).toEqual({ data: { ended: 0 } });
  });

  it("takes no body — there is nothing to choose", () => {
    expect(codeOnly(read("src/app/api/plan-lines/end-day/route.ts"))).not.toMatch(/req\.json/);
  });
});

describe("there is no edit or delete endpoint for a plan line (27c)", () => {
  const routeFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "route.ts") out.push(full);
      }
    };
    walk(path.join(root, "src/app/api/plan-lines"));
    return out;
  };

  it("exports only GET and POST — never PATCH, PUT or DELETE", () => {
    const files = routeFiles();
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(codeOnly(readFileSync(f, "utf8")), path.relative(root, f)).not.toMatch(
        /export\s+(async\s+)?function\s+(PATCH|PUT|DELETE)\b/,
      );
    }
  });

  it("has no delete anywhere in the plan's store", () => {
    expect(codeOnly(read("src/lib/store/plan-lines.ts"))).not.toMatch(/\.delete\s*\(/);
  });
});

// ── the error mapping, against the migration's REAL strings ───────────────────

describe("apiFailure maps the trigger's own messages to 409", () => {
  // Pulled from the migration, so a reworded trigger message that stops matching
  // the mapping fails here instead of surfacing as a 500 in production.
  const migration = read("supabase/migrations/0008_plan_lines.sql");
  const messages = [...migration.matchAll(/'(Rule 27[bc]:[^']*)'/g)].map((m) => m[1]);

  it("finds the trigger messages it is about to check", () => {
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it("answers 409 plan_locked for every one of them, never a 500", async () => {
    for (const message of messages) {
      const res = apiFailure(new Error(message));
      expect(res.status, message).toBe(409);
      expect(((await json(res)).error as { code: string }).code, message).toBe("plan_locked");
    }
  });

  it("does not swallow other Rule messages into plan_locked", async () => {
    expect(apiFailure(new Error("Rule 21: kind correction is write-once")).status).toBe(409);
    expect(((await json(apiFailure(new Error("Rule 21: x")))).error as { code: string }).code).toBe(
      "already_corrected",
    );
    expect(((await json(apiFailure(new Error("Rule 18: x")))).error as { code: string }).code).toBe(
      "rearm_cap_reached",
    );
  });
});

describe("the API client", () => {
  it("registers plan-lines in EFFECTS as 'checked, nothing to invalidate'", () => {
    expect(EFFECTS["plan-lines"]).toEqual([]);
    expect(keysFor("/api/plan-lines")).toEqual([]);
    expect(keysFor(`/api/plan-lines/${ID}/drop`)).toEqual([]);
    expect(keysFor("/api/plan-lines/end-day")).toEqual([]);
  });
});

// ── the component and the page: plain text, and nothing else ──────────────────

describe("TodayPlan — plain text to look at (Rule 27)", () => {
  const source = read("src/components/plan/TodayPlan.tsx");
  const code = codeOnly(source);

  it("exists, is a client component, and says why", () => {
    expect(existsSync(path.join(root, "src/components/plan/TodayPlan.tsx"))).toBe(true);
    expect(source.startsWith('"use client";')).toBe(true);
    expect(source.split("\n")[1]).toMatch(/^\/\/ Client component because/);
  });

  it("does not make a line tappable — no link, no row-level click", () => {
    expect(code).not.toMatch(/<Link\b/);
    expect(code).not.toMatch(/\bhref\s*=/);
    expect(code).not.toMatch(/<li[^>]*onClick/);
    expect(code).not.toMatch(/<span[^>]*onClick/);
  });

  it("does not touch the gate or start anything", () => {
    expect(code).not.toMatch(/GateForm|QuickCapture|Sheet\b|\/api\/sessions|\/api\/tasks|router\.push/);
  });

  it("shows no status, count, percentage or 'added later' marker", () => {
    for (const word of [
      /not started/i,
      /\bstarted\b/i,
      /\bfinished\b/i,
      /added later/i,
      /\bplanned \d/i,
      /\bstreak\b/i,
      /%/,
      /\.length\s*}/, // no `{plan.lines.length}` rendered as a count
    ]) {
      expect(code, String(word)).not.toMatch(word);
    }
  });

  it("links to no Task or Session and carries no taskId or sessionId", () => {
    expect(code).not.toMatch(/taskId|sessionId|task_id|session_id/);
  });

  it("offers no way to edit or reorder a line", () => {
    expect(code).not.toMatch(/contentEditable|onDrag|draggable|\.sort\s*\(|api\.patch/);
  });

  it("owns no timer — nothing here can end a day by itself", () => {
    expect(code).not.toMatch(/\bsetInterval\b|\bsetTimeout\b|\bcron\b/);
  });

  it("reaches the database only through the API, never the store or Supabase", () => {
    expect(code).not.toMatch(/@\/lib\/store|@\/lib\/supabase|@supabase/);
    expect(code).toContain('"/api/plan-lines"');
    expect(code).toContain("/api/plan-lines/end-day");
  });

  it("has an End day button, and only when there is something to end", () => {
    expect(code).toContain("End day");
    // The button lives inside the `hasLines` branch, so an empty plan shows only the input.
    const branch = code.slice(code.indexOf("{hasLines && ("));
    expect(branch.indexOf("End day")).toBeGreaterThan(-1);
    const beforeBranch = code.slice(0, code.indexOf("{hasLines && ("));
    expect(beforeBranch).not.toContain("End day</Button>");
  });

  it("goes read-only when stale: no cross-out, no add input, and a prompt to End day", () => {
    expect(code).toContain("isStalePlan(plan.planDate, today)");
    expect(code).toContain("{!crossed && !stale && (");
    expect(code).toMatch(/stale \? \(\s*<p[^>]*>End this day to start today&rsquo;s plan\./);
  });

  it("adds to the OPEN plan's own date, so a same-plan add can never look like another day", () => {
    expect(code).toContain("plan.planDate ?? today");
  });

  it("keeps a failed add's text, because writes fail loudly rather than optimistically", () => {
    const add = code.slice(code.indexOf("async function add"), code.indexOf("async function crossOut"));
    // The draft is cleared on success only, after the awaited write.
    expect(add.indexOf("await api.post")).toBeLessThan(add.indexOf('setDraft("")'));
    expect(add).toContain("catch (err)");
  });

  it("uses neutral colour and the four type roles only", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\btext-(?:sm|xs|base|lg|xl)\b|text-\[/);
    expect(code).not.toMatch(/compact:(?:text-|p[trblxy]?-\d|m[trblxy]?-\d|gap-\d)/);
    expect(code).not.toContain("compact:hidden");
  });

  it("puts the 40 px touch floor on every pressable thing it renders", () => {
    // `(?:=>|[^>])*`, arrow FIRST, so an arrow function in `onClick` doesn't end the tag early.
    const buttons = code.match(/<button(?:=>|[^>])*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toMatch(/\btap\b/);
    expect(code).toMatch(/<input[\s\S]*?className="tap /);
  });

  it("scrolls inside itself, with a cap that TRACKS WINDOW HEIGHT — a fixed cap pushed the list off 337 px", () => {
    // Measured at 500×337: a fixed 12.5rem cap put the first Unfinished topic at
    // 394 px (below the fold). The cap must be height-relative (vh), floored and capped.
    expect(code).toMatch(/max-h-\[clamp\(4rem,22vh,12\.5rem\)\][^"]*overflow-y-auto/);
    expect(code).not.toMatch(/max-h-\[12\.5rem\]/);
  });
});

describe("`/` — the plan is a third placement, and the list itself stays plain", () => {
  const page = read("src/app/(app)/page.tsx");
  const backlog = read("src/components/session/BacklogList.tsx");

  it("renders the plan ABOVE the Unfinished list", () => {
    const code = codeOnly(page);
    expect(code.indexOf("<TodayPlan")).toBeGreaterThan(-1);
    expect(code.indexOf("<TodayPlan")).toBeLessThan(code.indexOf("<BacklogList"));
  });

  it("reads the open plan in the same parallel pass, adding no round trip of its own", () => {
    const code = codeOnly(page);
    const all = code.slice(code.indexOf("Promise.all(["), code.indexOf("]);", code.indexOf("Promise.all([")));
    expect(all).toContain("listOpenPlan()");
  });

  it("passes the plan no date — staleness is the browser's call", () => {
    expect(codeOnly(page)).not.toMatch(/listOpenPlan\(\s*[^)\s]/);
  });

  it("lets NOTHING from the plan reach the Unfinished list (Rule 12)", () => {
    expect(codeOnly(backlog)).not.toMatch(/PlanLine|plan-lines|TodayPlan|OpenPlan|planDate/);
  });
});
