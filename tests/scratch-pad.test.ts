/**
 * THE SCRATCH PAD (feature-brief-session-scratch-pad.md) — a thinking aid, not
 * a record. It went through a revision mid-brief that cut a `scratch_note`
 * column, a migration, and three RPC signature changes down to exactly this:
 * unsent input, kept only in `localStorage`, wiped on close. Nothing here ever
 * reaches `sessions`, so there is no Postgres behaviour to integration-test —
 * unlike `interrupt-return.test.ts`'s neighbours, everything worth pinning is
 * unit-testable.
 *
 * Two kinds of check, same split as `reactive-ui.test.ts`:
 *   - the draft functions themselves, against a fake `Storage`
 *   - "does anything call it" wiring checks against the component source, the
 *     same dead-endpoint concern `interrupt-return.test.ts` names directly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A minimal in-memory `Storage`, so these tests need no jsdom dependency. */
function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** A `Storage` whose every method throws — the private-window / blocked-storage case. */
function throwingStorage(): Storage {
  const boom = () => {
    throw new Error("storage blocked");
  };
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    get length(): number {
      throw new Error("storage blocked");
    },
  } as Storage;
}

describe("scratch-draft — the draft functions against a fake Storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("round-trips a draft: empty by default, then written, then read back", async () => {
    const { readScratchDraft, writeScratchDraft } = await import("@/lib/scratch-draft");
    expect(readScratchDraft("s1")).toBe("");
    writeScratchDraft("s1", "thinking out loud");
    expect(readScratchDraft("s1")).toBe("thinking out loud");
  });

  it("keeps two sessions' drafts independent", async () => {
    const { readScratchDraft, writeScratchDraft } = await import("@/lib/scratch-draft");
    writeScratchDraft("s1", "for session one");
    writeScratchDraft("s2", "for session two");
    expect(readScratchDraft("s1")).toBe("for session one");
    expect(readScratchDraft("s2")).toBe("for session two");
  });

  it("writing an empty string clears the draft rather than storing empty", async () => {
    const { readScratchDraft, writeScratchDraft } = await import("@/lib/scratch-draft");
    writeScratchDraft("s1", "something");
    writeScratchDraft("s1", "");
    expect(readScratchDraft("s1")).toBe("");
  });

  it("clearScratchDraft removes exactly the named session's draft", async () => {
    const { clearScratchDraft, readScratchDraft, writeScratchDraft } = await import(
      "@/lib/scratch-draft"
    );
    writeScratchDraft("s1", "keep me gone");
    writeScratchDraft("s2", "leave me alone");
    clearScratchDraft("s1");
    expect(readScratchDraft("s1")).toBe("");
    expect(readScratchDraft("s2")).toBe("leave me alone");
  });

  it("moveScratchDraft (promotion) carries the text to the new id and empties the old one", async () => {
    const { moveScratchDraft, readScratchDraft, writeScratchDraft } = await import(
      "@/lib/scratch-draft"
    );
    writeScratchDraft("filler-1", "this filler turned into real work");
    moveScratchDraft("filler-1", "promoted-1");
    expect(readScratchDraft("filler-1")).toBe("");
    expect(readScratchDraft("promoted-1")).toBe("this filler turned into real work");
  });

  it("moveScratchDraft is a no-op when there was nothing to carry", async () => {
    const { moveScratchDraft, readScratchDraft } = await import("@/lib/scratch-draft");
    moveScratchDraft("empty-filler", "promoted-2");
    expect(readScratchDraft("promoted-2")).toBe("");
  });

  it("sweepScratchDrafts keeps only the active session's draft", async () => {
    const { readScratchDraft, sweepScratchDrafts, writeScratchDraft } = await import(
      "@/lib/scratch-draft"
    );
    writeScratchDraft("active-1", "still going");
    writeScratchDraft("stray-1", "orphaned by a closed tab");
    writeScratchDraft("stray-2", "orphaned another way");
    sweepScratchDrafts("active-1");
    expect(readScratchDraft("active-1")).toBe("still going");
    expect(readScratchDraft("stray-1")).toBe("");
    expect(readScratchDraft("stray-2")).toBe("");
  });

  it("sweepScratchDrafts with no active session clears every draft", async () => {
    const { readScratchDraft, sweepScratchDrafts, writeScratchDraft } = await import(
      "@/lib/scratch-draft"
    );
    writeScratchDraft("stray-1", "nothing is running");
    sweepScratchDrafts(null);
    expect(readScratchDraft("stray-1")).toBe("");
  });

  it("the sweep never touches storage keys outside its own prefix", async () => {
    const { sweepScratchDrafts } = await import("@/lib/scratch-draft");
    const storage = window.localStorage;
    storage.setItem("some-other-app-key", "untouched");
    sweepScratchDrafts(null);
    expect(storage.getItem("some-other-app-key")).toBe("untouched");
  });
});

describe("scratch-draft — degrades silently when storage throws (brief Risk 6)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: throwingStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("every function swallows the failure instead of throwing", async () => {
    const {
      clearScratchDraft,
      moveScratchDraft,
      readScratchDraft,
      sweepScratchDrafts,
      writeScratchDraft,
    } = await import("@/lib/scratch-draft");

    expect(() => readScratchDraft("s1")).not.toThrow();
    expect(readScratchDraft("s1")).toBe("");
    expect(() => writeScratchDraft("s1", "x")).not.toThrow();
    expect(() => clearScratchDraft("s1")).not.toThrow();
    expect(() => moveScratchDraft("s1", "s2")).not.toThrow();
    expect(() => sweepScratchDrafts("s1")).not.toThrow();
  });
});

describe("wiring — the pad is rendered, and every close path clears its draft", () => {
  it("SessionView renders an always-visible pad, not gated behind `closing` or `kind`", () => {
    const body = stripComments(read("src/components/session/SessionView.tsx"));
    // The pad must sit outside the `!closing` / `closing` branch, which starts
    // at `promoting ? (` — so it has to appear textually before that branch.
    const padIndex = body.indexOf("onScratchChange");
    const modeBranchIndex = body.indexOf("promoting ? (");
    expect(padIndex).toBeGreaterThan(-1);
    expect(modeBranchIndex).toBeGreaterThan(-1);
    expect(padIndex).toBeLessThan(modeBranchIndex);
  });

  it("SessionView clears the draft on BOTH close branches — resume and plain PATCH", () => {
    const body = stripComments(read("src/components/session/SessionView.tsx"));
    const resumeBranch = body.slice(
      body.indexOf("if (willResume)"),
      body.indexOf("await api.patch<Session>(`/api/sessions/${session.id}`, { status, outcomeNote });"),
    );
    expect(resumeBranch).toMatch(/clearScratchDraft\(session\.id\)/);

    const patchBranch = body.slice(
      body.indexOf("await api.patch<Session>(`/api/sessions/${session.id}`, { status, outcomeNote });"),
    );
    expect(patchBranch.slice(0, 200)).toMatch(/clearScratchDraft\(session\.id\)/);
  });

  it("SessionView never clears the draft inside the failure (`catch`) branch", () => {
    // A failed close must leave the draft intact so a retry still has the text
    // (brief Risk 4's replacement — "clear on success only").
    const body = stripComments(read("src/components/session/SessionView.tsx"));
    const catchBlock = body.slice(body.indexOf("} catch (err) {"), body.indexOf("async function rearm"));
    expect(catchBlock).not.toMatch(/clearScratchDraft/);
  });

  it("InterruptGrid clears the draft when recording drift", () => {
    const body = stripComments(read("src/components/interrupt/InterruptGrid.tsx"));
    const driftFn = body.slice(body.indexOf("const recordDrift"), body.indexOf("if (pickingWait)"));
    expect(driftFn).toMatch(/api\.patch<Session>/);
    expect(driftFn).toMatch(/clearScratchDraft\(parentSessionId\)/);
  });

  it("PromoteForm carries the draft forward on a successful promote", () => {
    const body = stripComments(read("src/components/session/PromoteForm.tsx"));
    expect(body).toMatch(/moveScratchDraft\(filler\.id, promoted\.id\)/);
    // Must run AFTER the promote call succeeds, not before — a promote that 404s
    // or 500s must not have already moved the draft off the still-open filler.
    expect(body.indexOf("const promoted = await api.post")).toBeLessThan(
      body.indexOf("moveScratchDraft(filler.id, promoted.id)"),
    );
  });

  it("AppShell sweeps stray drafts", () => {
    const body = stripComments(read("src/components/AppShell.tsx"));
    expect(body).toMatch(/sweepScratchDrafts\(/);
  });

  it("no scratch-draft write reaches `lib/store/` — it is not a database write", () => {
    // ADR-0002's guardrail already blocks a Supabase import outside lib/store/;
    // this is the brief's own narrower claim — the draft mechanism itself must
    // never be filed into the write seam, since routing it there would imply
    // it belongs on the list of things ADR-0002 governs.
    const storeIndex = read("src/lib/store/index.ts");
    expect(storeIndex).not.toMatch(/scratch/i);
  });
});
