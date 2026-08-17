/**
 * TASK COMPLETION ON SESSION CLOSE — feature-brief-task-done-on-session-close.md.
 *
 * Three things wired up together, because the second and third were found while
 * scoping the first:
 *
 * 1. Closing a `focus` session `done` now also marks its Task `done`, in the same
 *    `close_session()` transaction. Before this, `/` kept showing "Start" for
 *    work that was already finished — the session closed correctly, the Task
 *    never did.
 * 2. A promoted session's `parentSessionId` points at its already-closed filler.
 *    `SessionView.close()` used to branch on `parentSessionId !== null` alone, so
 *    closing a promoted session tried to resume a non-`suspended` parent — which
 *    `resume_session` correctly rejects, but nothing in `apiFailure()` recognised
 *    the rejection, so it surfaced as a raw 500 instead of a clean error. Fixed by
 *    checking the parent's actual status, not just its presence.
 * 3. `dropped` was a `TaskStatus` value with no writer anywhere in the app — same
 *    shape as (1). The backlog row gained a `Drop` action for it.
 *
 * The transaction guarantee itself (that the task update commits atomically with
 * the session close) is Postgres territory and needs a live Supabase — see
 * tests/README.md. What's checked here is the same class of thing
 * interrupt-return.test.ts checks for resume/promote: that the wiring exists and
 * is guarded correctly, by reading the source rather than running it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("close_session — marks the Task done, guarded", () => {
  const fn = read("supabase/migrations/0003_task_completion_on_close.sql")
    .split("create or replace function close_session")[1];

  it("only touches tasks when kind=focus, task_id is set, and the close is done", () => {
    expect(fn).toContain("s.kind = 'focus'");
    expect(fn).toContain("s.task_id is not null");
    expect(fn).toContain("p_status = 'done'");
  });

  it("sets both status and completed_at on the task", () => {
    expect(fn).toMatch(/status\s*=\s*'done'/);
    expect(fn).toMatch(/completed_at\s*=\s*now\(\)/);
  });

  it("the task update sits inside a conditional, not unconditionally after the session update", () => {
    // A `partial` or `abandoned` close must never flip the task — the guard has to
    // gate the write, not just document intent in a comment.
    const guardIndex = fn.indexOf("if s.kind = 'focus'");
    const updateTasksIndex = fn.indexOf("update tasks");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(updateTasksIndex).toBeGreaterThan(guardIndex);
  });

  it("stays single-row on the sessions side — still returns the session, no cascade elsewhere", () => {
    expect(fn).not.toMatch(/status\s*=\s*'active'/);
    expect(fn).not.toContain("parent_session_id");
  });
});

describe("SessionView.close() — resume only when the parent is actually live", () => {
  const view = read("src/components/session/SessionView.tsx");

  it("checks the parent's status, not just its presence", () => {
    // The old bug: any non-null parentSessionId was treated as resumable,
    // including a promoted session's already-closed filler.
    expect(view).toMatch(/parent\.status === ["']suspended["']/);
  });

  it("still branches on parentId being non-null as part of that check", () => {
    expect(view).toContain("parentId !== null");
  });

  it("falls through to the normal PATCH close when the parent isn't suspended", () => {
    expect(view).toMatch(/api\.patch<Session>\(\s*`\/api\/sessions\/\$\{session\.id\}`/);
  });
});

describe("apiFailure — a non-suspended resume target fails legibly", () => {
  const http = read("src/lib/http.ts");

  it("maps resume_session's rejection to a 409, not the generic 500 fallback", () => {
    const branch = http.split('message.includes("is not suspended")')[1]?.slice(0, 80) ?? "";
    expect(http).toContain('message.includes("is not suspended")');
    expect(branch).toMatch(/apiError\(\s*409/);
  });

  it("the branch sits before the generic internal-error fallback", () => {
    const guardIndex = http.indexOf('message.includes("is not suspended")');
    const fallbackIndex = http.indexOf('"internal", "Something went wrong."');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(guardIndex);
  });
});

describe("the backlog row — a Drop action for the unused `dropped` status", () => {
  // The interactive backlog list moved from `(app)/page.tsx` (a Server Component
  // now, per feature-brief-cookie-session-ssr-swap.md) into `BacklogList.tsx` —
  // that's where the row markup, and this Drop action, actually live.
  const list = read("src/components/session/BacklogList.tsx");

  it("drops a task via PATCH /api/tasks/[id] with status: dropped", () => {
    expect(list).toMatch(/api\.patch<Task>\(\s*`\/api\/tasks\/\$\{task\.id\}`,\s*\{\s*status:\s*"dropped"\s*\}/);
  });

  it("renders both Start and Drop on every row — additive, not a replacement", () => {
    const rowBlock = list.split("items.map((task)")[1]?.split("</ul>")[0] ?? "";
    expect(rowBlock).toContain("Start");
    expect(rowBlock).toContain("Drop");
  });

  it("never touches a Session — dropping is a Task-only write", () => {
    const fn = list.split("async function dropTask")[1]?.split("\n\n")[0] ?? "";
    expect(fn).not.toContain("/api/sessions");
  });
});
