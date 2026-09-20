/**
 * feature-brief-close-out-already-closed.md — the close-out converges on the
 * server's state instead of dead-ending, and a closed session never renders as a
 * live one.
 *
 * The bug class here is ABSENCE — a catch branch that isn't there, a refresh that
 * is never called — and nothing in the toolchain greps for absence, so these read
 * the source, in the same style as tests/reactive-ui.test.ts. Playwright is
 * deferred to v1.1; the rendered behaviour is a hand check.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const view = stripComments(read("src/components/session/SessionView.tsx"));

/** The body of `close()`'s catch, up to the next top-level function. */
const catchBlock = view.slice(view.indexOf("} catch (err) {"), view.indexOf("function leave("));

describe("an already-closed session arrives instead of dead-ending", () => {
  it("`session_closed` navigates away and does not clear the in-flight flag", () => {
    const branch = catchBlock.slice(0, catchBlock.indexOf("isActiveConflict"));
    expect(branch).toContain('err.code === "session_closed"');
    expect(branch).toMatch(/leave\(destination\)/);
    // Clearing it would re-enable buttons that can only ever fail again — the
    // reason one stale tap turned into several.
    expect(branch).not.toContain("setClosingStatus(null)");
    expect(branch).not.toContain("setError(");
  });

  it("the resume branch's duplicate (`session_not_suspended`) converges too", () => {
    // Without a branch here the duplicate falls through to "Nothing was saved —
    // this session is still open", which is false: the first tap landed.
    expect(catchBlock).toContain('err.code === "session_not_suspended"');
    expect(catchBlock).toMatch(/willResume && err\.code === "session_not_suspended"/);
  });

  it("a failed write is re-read before it is called unsaved", () => {
    const afterConflict = catchBlock.slice(catchBlock.indexOf("isActiveConflict"));
    expect(afterConflict).toMatch(/await isClosedOnServer\(\)/);
    // Order matters: the read decides the message, so it comes first.
    expect(afterConflict.indexOf("isClosedOnServer()")).toBeLessThan(
      afterConflict.indexOf("Nothing was saved"),
    );
    // And when it can't find out, it says so rather than picking a side.
    expect(afterConflict).toContain("Couldn't confirm whether this saved");
  });

  it("the re-read is a GET — it changes nothing (Rule 7)", () => {
    const helper = view.slice(view.indexOf("async function isClosedOnServer"));
    expect(helper.slice(0, 400)).toMatch(/api\.get</);
    expect(helper.slice(0, 400)).not.toMatch(/api\.(post|patch)/);
  });
});

describe("the shell stops naming a session that has closed", () => {
  it("every way out of a close refreshes the server-rendered shell", () => {
    // The nav indicator and ⌘K's target are a Server Component prop
    // (`(app)/layout.tsx`); client navigation keeps the layout, so only a
    // refresh re-runs it.
    const leave = view.slice(view.indexOf("function leave("));
    expect(leave.slice(0, 400)).toContain("router.push(to)");
    expect(leave.slice(0, 400)).toContain("router.refresh()");
  });

  it("close-out success and `I drifted` both go through it", () => {
    const closeFn = view.slice(view.indexOf("async function close("), view.indexOf("function leave("));
    // Two success arms (resume, plain) + the already-closed arms + the re-read arm.
    expect(closeFn.match(/leave\(destination\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(closeFn).not.toMatch(/router\.push\(/);
    // The interrupt grid's own drift close navigates from SessionView.
    expect(view).toMatch(/onDrifted=\{\(\) => \{\s*router\.push\("\/"\);\s*router\.refresh\(\);/);
  });
});

describe("a closed session never renders as a live one", () => {
  it("reads `endedAt` and leaves for `/`", () => {
    expect(view).toMatch(/session\.endedAt !== null/);
    expect(view).toMatch(/router\.replace\("\/"\)/);
    expect(view).toMatch(/if \(leaving\) return null;/);
  });

  it("does not race its own close or promote to a different destination", () => {
    // A close in flight and a promote in flight both end this row and then
    // navigate somewhere that is NOT `/` — the redirect must stand aside.
    expect(view).toMatch(/closingStatus === null && !promoting/);
  });
});
