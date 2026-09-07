/**
 * THE COMPACT DENSITY PASS — standing guards
 * (feature-brief-design-system-pass.md, 2026-09-07).
 *
 * Same shape and job as `guardrails.test.ts` and `backlog-plainness.test.ts`:
 * not unit tests of behaviour, but standing checks that a decision stays
 * decided. Vitest has no layout engine, so no height or width can be asserted
 * here — the measurements live in the brief and in the mockups. What CAN be
 * pinned is the small set of classes and structures those measurements rest on,
 * and those are what break first.
 *
 * The load-bearing claim of the whole pass is that it is a RENDERING pass:
 * density changes what the same facts feel like, never which facts are present.
 * The `compact:hidden` census below is the assertion that keeps it honest — the
 * one place anything is hidden is the WHY on the session screen, and it ships
 * with the control that reveals it.
 *
 * `short-viewport-gate.test.ts` owns the threshold itself and the gate's own
 * reachability guarantee. This file owns everything else the pass touched.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const css = read("src/app/globals.css");
const ui = read("src/components/ui/index.tsx");
const shell = read("src/components/AppShell.tsx");
const capture = read("src/components/capture/QuickCapture.tsx");
const grid = read("src/components/interrupt/InterruptGrid.tsx");
const session = read("src/components/session/SessionView.tsx");
const gate = read("src/components/session/GateForm.tsx");
const checkIn = read("src/components/session/CheckInPrompt.tsx");

/**
 * Comments stripped, so a census counts what SHIPS rather than what is
 * described. Every file in this pass documents the class it replaced — a count
 * that included prose would be counting the explanation.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every `.tsx` under `src/`, so a census can cover files not named above. */
function allComponentSources(): { rel: string; source: string }[] {
  const out: { rel: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".tsx")) out.push({ rel, source: read(rel) });
    }
  };
  walk("src");
  return out;
}

describe("density never removes information", () => {
  it("hides exactly one thing under `compact`, and it is the WHY", () => {
    // `compact:hidden` is the only way this pass could quietly drop something,
    // so it is counted rather than trusted. One occurrence, in SessionView, on
    // the WHY paragraph — and the FINISH LINE is never a candidate: it is the
    // bound the check-in asks you to judge against.
    const uses = allComponentSources().filter((f) => codeOnly(f.source).includes("compact:hidden"));
    expect(uses.map((f) => f.rel)).toEqual(["src/components/session/SessionView.tsx"]);
    expect(codeOnly(session).match(/compact:hidden/g)).toHaveLength(1);
  });

  it("ships the reveal alongside the thing it hides", () => {
    // A collapse with no control is a deletion. The toggle is `/log`'s
    // affordance verbatim, and it exists ONLY where something is collapsed —
    // `hidden compact:inline`, so a comfortable viewport never renders it.
    expect(session).toContain("hidden shrink-0 text-[0.6875rem] underline decoration-dotted");
    expect(session).toContain("compact:inline");
    expect(session).toContain("aria-expanded={showWhy}");
  });

  it("keeps the sub-line on `/`, which is content and not decoration", () => {
    // It is the sentence that stopped "Unfinished" reading like an inbox after
    // ADR-0004. It shrinks; it does not go.
    expect(read("src/components/session/BacklogList.tsx")).toContain("Picked up, not finished.");
  });
});

describe("the touch floor — density may not shrink a tap target", () => {
  it("declares a 40 px floor on coarse pointers only", () => {
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toMatch(/min-height: 40px/);
  });

  it("puts the floor on every pressable primitive", () => {
    // ADR-0003 budgets an interrupt at ONE TAP. A target too small to hit is
    // that budget failing, not a cosmetic regression.
    expect(ui).toMatch(/className=\{`tap inline-flex items-center justify-center gap-2 rounded-lg/);
    expect(ui).toMatch(/className=\{`tap grid overflow-hidden rounded-lg/);
    expect(capture).toContain("tap inline-flex");
  });
});

describe("the start affordance is laid out, not floating", () => {
  it("has no fixed floating button anywhere", () => {
    // The FAB was the app's only `position: fixed` control outside the gate
    // overlay, and in a small window it landed on `Close out` and on
    // `Load older weeks`. Nothing may float over the primary control again.
    for (const { source } of allComponentSources()) {
      expect(codeOnly(source)).not.toMatch(/fixed bottom-\d/);
    }
  });

  it("renders the trigger in the nav, and hides it where it is a no-op", () => {
    expect(shell).toContain("showTrigger={!onSessionScreen}");
    expect(capture).toContain("{showTrigger && (");
  });

  it("leaves ⌘K bound from every page, including the session screen", () => {
    // The chord is what the 150 ms budget is measured from, and on the session
    // screen it NAVIGATES rather than opening the gate — so the component stays
    // mounted even when its button is not rendered.
    expect(capture).toMatch(/e\.key\.toLowerCase\(\) === "k"/);
    expect(capture).toContain("router.push(`/session/${active.id}`)");
    expect(shell).toContain("<QuickCapture");
  });
});

describe("SegmentedControl — the row that cannot overflow", () => {
  it("lays out equal columns rather than intrinsic flex children", () => {
    // `flex gap-2` with `px-4` children is what wrapped "30 min" onto two lines
    // in a 360 px window. `1fr` columns are as wide as the container, never
    // as wide as the labels.
    expect(ui).toContain("repeat(${options.length}, minmax(0, 1fr))");
    expect(ui).toContain('<span className="truncate">{opt.label}</span>');
  });

  it("names WHICH segment is in flight, like every other write control", () => {
    expect(ui).toContain("const busy = pending !== null && pending === opt.value;");
    expect(ui).toContain("animate-spin");
  });

  it("replaced all four hand-rolled button rows", () => {
    for (const source of [gate, grid, session, checkIn]) {
      expect(source).toContain("SegmentedControl");
    }
    // And none of them kept the shape that broke.
    expect(gate).not.toMatch(/<div className="flex gap-2">\s*\{INTERVALS/);
    expect(grid).not.toContain('grid grid-cols-4 gap-2');
    expect(session).not.toMatch(/<div className="flex gap-2">\s*\{CLOSE_STATUSES/);
  });
});

describe("ADR-0003's interrupt budget survives the compaction", () => {
  it("still offers all seven targets", () => {
    for (const tag of ['tag: "pr"', 'tag: "alert"', 'tag: "dm"', 'tag: "meeting"', 'tag: "other"']) {
      expect(grid).toContain(tag);
    }
    expect(grid).toContain(">\n        Filler\n      </Button>");
    expect(grid).toContain(">\n        I drifted\n      </Button>");
  });

  it("keeps `Filler` and `I drifted` full-width on their own rows (Gap 24c)", () => {
    // Filler beside `Meeting` and `Other` read as though all three produced a
    // filler session; that draft was rejected and is not re-proposed here. And
    // `I drifted` closes the session irreversibly (Rule 5) — it never
    // neighbours a routine control.
    expect(grid.match(/className="w-full py-3 compact:py-1\.5"/g)).toHaveLength(2);
  });

  it("dropped the decorative non-target cell rather than shrinking it", () => {
    // It existed only to fill the hole a 3-column grid left under five cells.
    // Five equal columns have no hole.
    expect(grid).not.toContain("Keeps the grid square");
    expect(grid).not.toContain("border-dashed");
  });

  it("still writes `kind` and `interruptTag` in one gesture", () => {
    expect(grid).toContain('kind: "pulled"');
    expect(grid).toContain("interruptTag: tag");
  });
});

describe("the session screen keeps its one-task shape", () => {
  it("puts the clock beside the title only under `compact`", () => {
    // Comfortable is `flex-col`, which renders identically to the block layout
    // it replaced. Nothing above the threshold moved.
    expect(session).toContain("flex flex-col compact:flex-row");
    expect(session).toContain("compact:text-xl");
  });

  it("separates `Close out` from `I drifted` with a rule, not just space", () => {
    expect(session).toContain("compact:border-t compact:border-border compact:pt-2.5");
  });

  it("still derives the clock rather than storing one (ADR-0002)", () => {
    expect(session).toContain("<ElapsedClock");
    expect(session).not.toMatch(/setInterval\(/);
  });
});
