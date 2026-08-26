/**
 * THE GATE FITS A SMALL LAPTOP — source-text guards for
 * feature-brief-gate-sheet-short-viewport.md (2026-08-26).
 *
 * Same shape and job as `guardrails.test.ts` and `backlog-plainness.test.ts`:
 * not a unit test of behaviour, but a standing check that a decision stays
 * decided. Vitest has no layout engine, so height cannot be asserted here — the
 * measurements live in the brief. What CAN be pinned is the small set of classes
 * and the threshold those measurements depend on, and that is what breaks first.
 *
 * The one that must never be removed is `overflow-y-auto` on the overlay. It is
 * the only reason a control inside the gate is reachable at ANY viewport height,
 * and `Sheet` is `position: fixed` — so without it, content past the fold is not
 * merely off-screen, it is unreachable by any gesture, with the page behind it
 * scrolling uselessly. That is how `Start` became unpressable on a 1366×768
 * laptop the moment the gate raised its inline errors.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const ui = read("src/components/ui/index.tsx");
const gate = read("src/components/session/GateForm.tsx");

// The overlay's `className` string — matched rather than the whole file, so an
// `overflow-y-auto` added anywhere else cannot satisfy these assertions.
const overlay = /className="focus-overlay-in fixed inset-0[^"]*"/.exec(ui)?.[0] ?? "";

describe("Sheet — nothing in the gate is ever out of reach", () => {
  it("has an overlay className to assert against at all", () => {
    expect(overlay).not.toBe("");
  });

  it("scrolls the overlay — the guarantee, at any viewport height", () => {
    // THE load-bearing class. A `fixed` container with clipped overflow puts its
    // own controls beyond every gesture the user has.
    expect(overlay).toContain("overflow-y-auto");
  });

  it("keeps the sheet top-anchored, so scrolling starts at the first field", () => {
    // `items-center` would centre a too-tall sheet and cut off BOTH ends — the
    // `what` field as well as `Start`. Top-anchored, only the tail overflows.
    expect(overlay).toContain("items-start");
    expect(overlay).not.toContain("items-center");
  });

  it("does not swallow the page's own scroll behind the gate", () => {
    expect(overlay).toContain("overscroll-contain");
  });
});

describe("the compact pass is keyed on HEIGHT, and on one threshold", () => {
  const THRESHOLD = "[@media(max-height:800px)]";

  it("reclaims the decorative top offset on short viewports only", () => {
    // 96 px of top offset is a design choice that costs 14% of a 681 px
    // viewport. Kept above the threshold, halved-and-then-some below it.
    expect(overlay).toContain("pt-24");
    expect(overlay).toContain(`${THRESHOLD}:pt-8`);
  });

  it("tightens the sheet's own padding and title gap below the threshold", () => {
    expect(ui).toContain(`${THRESHOLD}:p-4`);
    expect(ui).toContain(`${THRESHOLD}:mb-3`);
  });

  it("tightens the gate's field rhythm below the SAME threshold", () => {
    // One decision expressed in two files. Divergent thresholds would make the
    // sheet compact while the form inside it stayed roomy, at some heights.
    expect(gate).toContain(`${THRESHOLD}:space-y-3`);
  });

  it("uses a height query, never a width breakpoint", () => {
    // A 1366×768 laptop is WIDE and SHORT. `sm:`/`md:`/`lg:` read it as a
    // desktop and would change nothing on the axis that ran out.
    for (const cls of [`${THRESHOLD}:pt-8`, `${THRESHOLD}:p-4`, `${THRESHOLD}:mb-3`]) {
      expect(ui).toContain(cls);
    }
    expect(overlay).not.toMatch(/\b(sm|md|lg|xl):pt-/);
  });
});

describe("the compact pass removes nothing from the gate", () => {
  it("still renders all five fields — ADR-0004's ceiling, not its budget", () => {
    for (const label of ['label="What"', 'label="Topic"', 'label="Why"', 'label="Finish line"', 'label="Check in every"']) {
      expect(gate).toContain(label);
    }
  });

  it("keeps two rows of room to write the WHY and the FINISH LINE in", () => {
    // Shrinking these to `rows={1}` would buy 40 px by making the one moment
    // the app asks you to think look like a search box. ADR-0001, not styling.
    // Counted on code lines only — this file's own prose mentions `rows={2}`.
    const code = gate.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
    expect(code.join("\n").match(/rows=\{2\}/g)?.length).toBe(2);
  });

  it("keeps the inline error slot — the reason the gate grows when it rejects", () => {
    expect(ui).toContain("mt-1 text-xs text-red-600");
  });
});

describe("dismiss-on-backdrop survives the overlay becoming scrollable", () => {
  it("ignores a click that lands on the overlay's own scrollbar", () => {
    // A scrollbar click reports the overlay as its target, so the backdrop
    // handler would fire on it — and dismissing the gate discards everything
    // typed into it. The scrollbar exists only because of this change.
    expect(ui).toContain("e.nativeEvent.offsetX > e.currentTarget.clientWidth");
  });
});
