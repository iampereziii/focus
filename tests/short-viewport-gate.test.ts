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
const css = read("src/app/globals.css");

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

describe("the compact pass is keyed on the WINDOW, and on one threshold", () => {
  /**
   * RE-EXPRESSED, NOT RELAXED (feature-brief-design-system-pass.md, 2026-09-07).
   *
   * This block used to assert the literal string `[@media(max-height:800px)]` in
   * two component files. The threshold has not moved — it is still 800 px, still
   * the number measured on a 1366×768 laptop in the brief that introduced it —
   * but it is now declared ONCE, as a `compact` variant in `globals.css`, and the
   * components spell it `compact:`. So the assertions moved with it: the number
   * is pinned where it is defined, and the components are pinned to using the
   * shared variant rather than a threshold of their own.
   *
   * A width arm was ADDED alongside it. That is a genuine widening of when the
   * pass fires and it is deliberate: the gate brief only ever had a height
   * problem, but the interval row overflows on WIDTH, and the app is used in a
   * narrow window. Neither arm may be removed without re-opening a brief.
   */
  it("declares the threshold exactly once, in the stylesheet", () => {
    const declarations = css.match(/@custom-variant compact/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it("keeps 800 px as the height arm — the measured, decided number", () => {
    expect(css).toMatch(/@media \(max-height: 800px\)/);
  });

  it("adds a width arm, because the axis that overflows the interval row is width", () => {
    expect(css).toMatch(/@media \(max-width: 520px\)/);
  });

  it("leaves no second copy of the threshold in the components", () => {
    // Two copies of a number is how a threshold drifts. This is the assertion
    // that keeps one from growing back.
    // The CLASS form only. Both files still describe the 800 px measurement in
    // prose, which is the history of the decision and worth keeping.
    for (const source of [ui, gate]) {
      expect(source).not.toContain("[@media(max-height:800px)]:");
    }
  });

  it("reclaims the decorative top offset on small viewports only", () => {
    // 96 px of top offset is a design choice that costs 14% of a 681 px
    // viewport. Kept above the threshold, gone below it — the sheet is
    // full-bleed there, so the overlay's own inset goes too.
    expect(overlay).toContain("pt-24");
    expect(overlay).toContain("compact:p-0");
  });

  it("sizes the sheet's padding and title gap off the FLUID ramp, not a step", () => {
    // These were `compact:p-3` and `compact:mb-1.5` — one number, chosen for one
    // height. The window's height is a RANGE (337–815 px), so the same 12 px of
    // padding was simultaneously right at the bottom of it and mean at the top.
    // `p-gutter` is 10 px at 337 and ~24 px by 815; `mb-rhythm` likewise.
    //
    // The trade this protects is unchanged: raising the type floor to 12 px cost
    // the gate ~48 px and it was paid back out of RHYTHM rather than out of
    // type. Rhythm is still what yields; it just yields proportionally now.
    expect(ui).toContain("p-gutter");
    expect(ui).toContain("mb-rhythm");
  });

  it("gives the gate's fields the SAME fluid rhythm as the sheet around them", () => {
    // One ramp, one source. Divergent rhythms would make the sheet tighten while
    // the form inside it stayed roomy at some window heights — the same class of
    // bug as the two thresholds this variant was consolidated to stop.
    expect(gate).toContain("space-y-rhythm");
  });

  it("never keys the gate off a width breakpoint", () => {
    // A 1366×768 laptop is WIDE and SHORT. `sm:`/`md:`/`lg:` read it as a
    // desktop and would change nothing on the axis that ran out. The `compact`
    // variant's width arm is a max-width, which is the opposite thing.
    expect(overlay).not.toMatch(/\b(sm|md|lg|xl):pt-/);
    expect(gate).not.toMatch(/\b(sm|md|lg|xl):space-y-/);
    // And the fluid ramp keys on `vh` — the viewport's HEIGHT — for the same
    // reason: it is the axis that runs out, and the one that is actually resized.
    expect(css).toContain("vh");
  });
});

describe("the compact pass removes nothing from the gate", () => {
  it("still renders all five fields — ADR-0004's ceiling, not its budget", () => {
    for (const label of ['label="What"', 'label="Topic"', 'label="Why"', 'label="Finish line"', 'label="Check in every"']) {
      expect(gate).toContain(label);
    }
  });

  it("keeps two rows of room to write the WHY and the FINISH LINE in", () => {
    /**
     * THE MECHANISM CHANGED; THE ROOM DID NOT (2026-09-07).
     *
     * This used to count two `rows={2}`. Both textareas are `rows={1}` now with
     * a CSS floor and auto-grow, which renders the SAME two rows of writing space
     * on a comfortable viewport — `min-h-[3.5rem]` is the two-row box — and opens
     * at one row only under `compact`, growing the moment a second line is typed.
     *
     * The original assertion's reasoning was that `rows={1}` "would buy 40 px by
     * making the one moment the app asks you to think look like a search box".
     * That still holds where there is room, which is why the comfortable floor is
     * pinned below. In a 500 px window the 40 px is not decoration — and nothing
     * about the gate's demand relaxed: the field is still required, still
     * rejected when empty, and still grows to hold whatever is written.
     */
    // ONE FLOOR, FLUID, replacing the fixed pair (2026-09-07). It used to be
    // `min-h-[3.5rem]` with a `compact:min-h-[2.25rem]` override — the two-row
    // box and the one-row box, switched at a threshold. `--spacing-writing` is
    // the same two numbers as the ends of a `clamp()`: one row at 337 px of
    // viewport, two rows by ~800. Same room, granted in proportion to the height
    // there is, rather than switched between two states.
    const floors = gate.match(/className="min-h-writing resize-none overflow-hidden"/g) ?? [];
    expect(floors).toHaveLength(2);

    expect(css).toMatch(/--spacing-writing:\s*clamp\(\s*2\.25rem[^;]*3\.5rem\s*\)/);

    // Auto-grow is what makes the one-row floor non-lossy — without it the
    // compact gate would clip a long WHY instead of growing to hold it.
    expect(gate).toContain("useAutoGrow");
    expect(gate).toContain("ref={whyRef}");
    expect(gate).toContain("ref={finishLineRef}");
  });

  it("keeps the inline error slot — the reason the gate grows when it rejects", () => {
    expect(ui).toContain("mt-rhythm-tight text-label text-red-600");
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
