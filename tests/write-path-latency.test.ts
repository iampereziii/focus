/**
 * THE WRITE PATH — one auth call, one session, and never a silent tap.
 *
 * Standing checks for feature-brief-write-path-latency-and-in-flight-feedback.md,
 * in the same shape as `guardrails.test.ts` and `reactive-ui.test.ts`: some of
 * this is behaviour, but most of it is a decision that stays decided only if
 * something fails when it stops being true.
 *
 * Two of these guard SECURITY properties rather than latency, and they are the
 * reason this file leans on source assertions at all:
 *
 *   1. The proxy strips a client-supplied identity header before setting its own.
 *      Reorder those two lines and the app trusts a header anyone can send. The
 *      unit test below proves the function; the source assertion proves the
 *      function is the only thing that sets one.
 *   2. `currentUserId` keeps its `getUser()` fallback. Delete it as "dead code
 *      now" and a route reached without the proxy fails OPEN instead of closed.
 *
 * Both are the kind of obviously-tidy one-liner an AI-paired session produces at
 * speed, which is exactly the failure mode CLAUDE.md § 3 warns about.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IDENTITY_HEADER, forwardedIdentity } from "@/lib/identity";
import { BUDGETS } from "@/lib/perf";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the forwarded identity header cannot be forged", () => {
  it("carries the verified id downstream", () => {
    const out = forwardedIdentity(new Headers(), "user-1");
    expect(out.get(IDENTITY_HEADER)).toBe("user-1");
  });

  it("DISCARDS a client-supplied value rather than merging it", () => {
    const incoming = new Headers({ [IDENTITY_HEADER]: "someone-else" });
    const out = forwardedIdentity(incoming, "user-1");
    expect(out.get(IDENTITY_HEADER)).toBe("user-1");
  });

  it("strips the header entirely when the caller is NOT signed in", () => {
    // The dangerous case: a signed-out caller sets the header themselves and the
    // proxy passes it through because it has no id of its own to write. The
    // delete is unconditional precisely so this returns null.
    const incoming = new Headers({ [IDENTITY_HEADER]: "user-1" });
    expect(forwardedIdentity(incoming, null).get(IDENTITY_HEADER)).toBeNull();
  });

  it("leaves every other header alone", () => {
    const incoming = new Headers({ "content-type": "application/json", cookie: "sb=1" });
    const out = forwardedIdentity(incoming, "user-1");
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("cookie")).toBe("sb=1");
  });

  it("is the ONLY thing that sets the header — the proxy never sets one itself", () => {
    const proxy = stripComments(read("src/proxy.ts"));
    expect(proxy).toContain("forwardedIdentity(request.headers");
    // A hand-rolled `headers.set("x-focus-user", …)` anywhere would bypass the
    // delete that makes the header trustworthy.
    expect(proxy).not.toMatch(/\.set\(\s*['"`]x-focus-user/i);
  });
});

describe("removing a round trip never removes a check", () => {
  const authServer = stripComments(read("src/lib/store/auth-server.ts"));

  it("`currentUserId` still falls back to getUser() when nothing was forwarded", () => {
    // Fail CLOSED. Without this, a route somehow reached without the proxy would
    // see no header and — if the fallback were deleted — wave the caller through.
    expect(authServer).toContain("auth.getUser()");
  });

  it("prefers the forwarded header, so the fallback is the exception not the rule", () => {
    expect(authServer).toContain("IDENTITY_HEADER");
    expect(authServer).toMatch(/forwarded[\s\S]*?return forwarded/);
  });
});

describe("`/session/[id]` reads one session, not the whole log", () => {
  const page = stripComments(read("src/app/(app)/session/[id]/page.tsx"));

  it("no longer requests a page of the log", () => {
    // reactive-UI Risk 4: this fetched `?limit=100` and hunted for its row, so a
    // session past the hundredth was unreachable and every invalidation
    // re-downloaded a hundred rows to update one screen.
    expect(page).not.toContain("limit=");
    expect(page).toContain("/api/sessions/${id}");
  });

  it("subscribes with the id as a SCOPE, keeping the domain key coarse", () => {
    // The write vocabulary must not learn about URLs: `invalidate("sessions")`
    // still has to reach this screen.
    expect(page).toMatch(/useLive<[^>]*>\(\s*\n?\s*"sessions"/);
  });

  it("shows a shaped skeleton rather than the word Loading", () => {
    expect(page).not.toMatch(/Loading…/);
    expect(page).toContain("animate-pulse");
  });

  it("has a GET route to read from, and it is read-only", () => {
    const route = read("src/app/api/sessions/[id]/route.ts");
    expect(route).toMatch(/export async function GET\(/);
    // The write half of this file stays the only write half.
    expect(route).not.toMatch(/export async function (POST|DELETE)\(/);
  });
});

describe("`/` stops computing the log to find its pinned rows", () => {
  const page = stripComments(read("src/app/(app)/page.tsx"));

  it("fetches no session page, no check-ins, and groups nothing", () => {
    expect(page).not.toContain("listSessionsPage");
    expect(page).not.toContain("checkInsForSessions");
    expect(page).not.toContain("groupByWeek");
    expect(page).not.toContain("flattenWeeks");
  });

  it("asks the database the Rule 23 question directly", () => {
    expect(page).toContain("sessionsPlannedForResume");
  });

  it("keeps the pinned query matching its PARTIAL index", () => {
    // `sessions_resume_planned` is partial (`where resume_planned_at is not
    // null`, 0001_init.sql:208). Postgres only uses a partial index when the
    // query's predicate implies the index's — drop this line and the plan
    // silently degrades to a sequential scan.
    const store = read("src/lib/store/sessions.ts");
    expect(store).toMatch(/\.not\(\s*"resume_planned_at",\s*"is",\s*null\s*\)/);
  });

  it("dedupes the active-session read across layout and page", () => {
    const store = read("src/lib/store/sessions.ts");
    expect(store).toMatch(/export const activeSession = cache\(/);
  });
});

describe("`invalidate` still reaches a scoped subscriber", () => {
  it("matches both a bare domain key and a scoped one", async () => {
    const mutate = vi.fn();
    vi.doMock("swr", () => ({
      default: vi.fn(),
      mutate,
      __esModule: true,
    }));
    const { invalidate } = await import("@/lib/live");

    invalidate("sessions");
    expect(mutate).toHaveBeenCalledTimes(1);

    const matcher = mutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher("sessions")).toBe(true);
    expect(matcher(["sessions", "abc-123"])).toBe(true);
    // And does not over-reach into a different domain noun.
    expect(matcher("tasks")).toBe(false);
    expect(matcher(["tasks", "abc-123"])).toBe(false);

    vi.doUnmock("swr");
    vi.resetModules();
  });
});

describe("every write control reports itself in flight", () => {
  it("`Button` has a pending state that implies disabled", () => {
    const ui = read("src/components/ui/index.tsx");
    expect(ui).toContain("pending?: boolean");
    expect(ui).toMatch(/disabled=\{props\.disabled === true \|\| pending\}/);
    expect(ui).toContain("aria-busy");
  });

  it("the close-out is guarded in the HANDLER, not only by the buttons", () => {
    // The one write path in the app that had no guard at all — and the slowest.
    const view = stripComments(read("src/components/session/SessionView.tsx"));
    expect(view).toMatch(/if \(closingStatus !== null\) return;/);
  });

  it("a second close-out tap is told the truth, not that nothing was saved", () => {
    // A 409 `session_closed` here means an EARLIER tap succeeded. Reporting that
    // as "Nothing was saved" is factually backwards and invites a third tap.
    const view = read("src/components/session/SessionView.tsx");
    const closedBranch = view.slice(view.indexOf('err.code === "session_closed"'));
    expect(closedBranch.slice(0, 600)).toContain("already closed");
    expect(closedBranch.slice(0, 600)).not.toContain("Nothing was saved");
  });

  it("the gate resolves a known topic locally instead of posting twice", () => {
    // MOVED, NOT WEAKENED (ADR-0004, 2026-08-20). This assertion used to read
    // `QuickCapture.tsx`, because that is where the topic was resolved when
    // capture and the gate were two separate acts. They are one act now — ⌘K
    // opens the gate itself — so the local resolve moved into `GateForm` with
    // the rest of the submit. Same two matchers, same property: the common
    // path, starting into a topic that already exists, does no topic write.
    const gate = stripComments(read("src/components/session/GateForm.tsx"));
    expect(gate).toMatch(/topics\.find\(/);
    expect(gate).toContain("known?.id ??");
  });
});

describe("the budgets exist as numbers, not as prose", () => {
  it("names all four, with the tap-feedback threshold at 100 ms", () => {
    // `captureCommit` was retired with Rule 9 (ADR-0004): there is no longer a
    // capture commit to time — ⌘K opens the gate, so that tap is a `gateSubmit`
    // like any other. A budget with no call site measures nothing.
    expect(Object.keys(BUDGETS).sort()).toEqual(
      ["closeOut", "gateSubmit", "interruptTap", "tapFeedback"].sort(),
    );
    expect(BUDGETS.tapFeedback).toBe(100);
    // ADR-0001's budget, carried over unchanged.
    expect(BUDGETS.gateSubmit).toBe(1_000);
  });

  it("measures the gate submit ADR-0001 has always asserted and never checked", () => {
    const gate = stripComments(read("src/components/session/GateForm.tsx"));
    expect(gate).toMatch(/measure\("gateSubmit"/);
  });

  it("adds no analytics dependency to do it", () => {
    // A measurement is not a reason to start reporting the architect's behaviour
    // to a third party, or to add v1's first new runtime dependency.
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const names = Object.keys(pkg.dependencies).join(" ");
    expect(names).not.toMatch(/analytics|sentry|posthog|datadog|mixpanel/i);
  });
});

describe("ADR-0002 is untouched by all of it", () => {
  it("the service worker still has no fetch handler", () => {
    // The whole brief is a latency fix, which is the exact pretext under which a
    // `fetch` handler gets added. It is a reversal of ADR-0002, not an
    // optimisation — lint-enforced, and asserted here too.
    expect(read("public/sw.js")).not.toMatch(/addEventListener\(\s*['"`]fetch/);
  });

  it("no guardrail was disabled to land any of this", () => {
    const files = [
      "src/proxy.ts",
      "src/lib/identity.ts",
      "src/lib/perf.ts",
      "src/lib/live.ts",
      "src/lib/store/auth-server.ts",
      "src/lib/store/sessions.ts",
      "src/app/(app)/page.tsx",
      "src/app/(app)/session/[id]/page.tsx",
      "src/components/session/SessionView.tsx",
      "src/components/capture/QuickCapture.tsx",
    ];
    for (const file of files) {
      expect(read(file), `${file} disables a lint rule`).not.toContain("eslint-disable");
    }
  });
});
