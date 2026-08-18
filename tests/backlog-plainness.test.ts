/**
 * RULE 12 GUARDRAILS — the backlog stays PLAIN through the redesign.
 *
 * Added 2026-08-18 with feature-brief-backlog-ui-redesign.md. Same shape and
 * same job as `guardrails.test.ts`: not a unit test of behaviour, but a standing
 * check that a decision stays decided.
 *
 * The redesign's whole claim is that it changes how the backlog FEELS without
 * changing what it SHOWS — craft, not mechanics. That claim is one commit away
 * from quietly becoming false, and the way it breaks is not a rewrite: it is a
 * plausible-looking one-liner ("just show how long it's been sitting there",
 * "just show the count") added by someone who has not read Gap 12. Rule 12
 * decided the list is plain; A4 names the annotated variant as the FALLBACK, to
 * be judged at the 2026-09-05 checkpoint against logged data — so adding it
 * early does not just break a rule, it spends a checkpoint that has not arrived.
 *
 * These assert against `BacklogList.tsx` only. `page.tsx` legitimately uses
 * `new Date()` — Rule 23's pinning needs today's date — and that is the server
 * half, which renders nothing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Rule 12 — `/` stays a plain list through the redesign", () => {
  const backlog = read("src/components/session/BacklogList.tsx");

  it("invents no ordering — no sort anywhere in the rendered list", () => {
    // Grouping is by Topic and nothing else. A sort here would be a ranking the
    // app chose, which is the choosing problem the app exists to remove.
    expect(backlog).not.toMatch(/\.sort\s*\(/);
  });

  it("computes no age — no date arithmetic in the list component", () => {
    // "14 days, 0 sessions" is Discovery Decision 2's deliberately-uncomfortable
    // variant. Considered and NOT taken (Gap 12); it is A4's fallback, not v1.
    expect(backlog).not.toMatch(/new Date\s*\(/);
    expect(backlog).not.toMatch(/\bDate\.now\s*\(/);
    expect(backlog).not.toMatch(/\bcreatedAt\b/);
  });

  it("renders no count — not per group, not in the page header", () => {
    // `.length` is fine as a CONDITION (`pinned.length > 0`, dropping an empty
    // group). What is banned is rendering the number: a count that only grows is
    // pressure, and Decision 2 requires the list stay neutral — "no nagging, no
    // red, no scolding copy". Brief Risk 3, decided 2026-08-18.
    expect(backlog).not.toMatch(/\{[^{}]*\.length\s*\}/);
  });

  it("keeps the reactive-UI resync identifiers the source-text guard pins", () => {
    // tests/reactive-ui.test.ts asserts this block by regex, so a rename would
    // fail there with a message about SWR rather than about this redesign. This
    // says the quiet part out loud at the place a redesign would break it.
    expect(backlog).toMatch(/if\s*\(\s*initialTasks\s*!==\s*prevInitialTasks\s*\)/);
  });

  it("adds no data path — the list still receives everything as props", () => {
    // The redesign is rendering-only. No store import, no fetch, no API read:
    // `page.tsx` remains the only thing that asks the database anything.
    expect(backlog).not.toMatch(/@\/lib\/store/);
    expect(backlog).not.toMatch(/\buseLive\b/);
    expect(backlog).not.toMatch(/api\.get\s*\(/);
  });
});

describe("motion is suppressed under prefers-reduced-motion", () => {
  it("globals.css carries a reduce block", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});
