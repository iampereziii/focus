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
    expect(session).toContain("hidden shrink-0 text-xs underline decoration-dotted");
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

describe("the landscape pass — the window is filled, not just fitted", () => {
  /**
   * Measured at 500 px wide (the real window is 500 × 375–485), by rendering the
   * components to static markup and reading `getBoundingClientRect` in headless
   * Chromium — not by arithmetic, which was wrong by 46 px the first time:
   *
   *   gate form      393.1 px → 282.6 px
   *   backlog main   320.7 px → 230.3 px
   *   session main   324.4 px → 327.4 px  (its problem was dead space, not height)
   *
   * None of that is assertable here — Vitest has no layout engine — so what is
   * pinned instead is the small set of classes those numbers depend on.
   */
  it("pairs fields with a MIN-WIDTH, never bare flex-1", () => {
    // This is the assertion that matters. `flex-1` alone does not wrap, it
    // SQUASHES: two fields would keep sitting side by side at 320 px, each 150 px
    // wide, instead of stacking. The min-width is what makes the pair degrade
    // rather than break, and it is why this pass needed no second breakpoint.
    // 11rem, not 13rem. 208 px each meant a pair needed 426 px before it would
    // wrap — wider than the 480 px window minus its padding, so the row pushed
    // instead of breaking. 176 px needs 362 px, which breaks first.
    for (const source of [gate, read("src/components/session/PromoteForm.tsx")]) {
      const pairs = codeOnly(source).match(/compact:min-w-\[11rem\] compact:flex-1/g) ?? [];
      expect(pairs.length).toBeGreaterThanOrEqual(2);
      // Every `flex-1` in a pairing row is accompanied by the min-width.
      const rows = codeOnly(source).match(/compact:flex compact:flex-wrap/g) ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }
    expect(codeOnly(read("src/components/session/BacklogList.tsx"))).toContain(
      "compact:min-w-[13rem] compact:flex-1",
    );
  });

  it("makes the session screen as tall as the window, without a second copy of the nav height", () => {
    // `body` is already `min-h-full flex flex-col` with the nav and this as its
    // only two children, so `flex-1` needs no `calc()` — and there is no nav
    // height written down twice to drift apart.
    // Asserted as separate classes, not as one contiguous run: `compact:max-w-none`
    // now sits between them in the same string.
    for (const cls of ["compact:flex", "compact:flex-1", "compact:flex-col"]) {
      expect(session).toContain(cls);
    }
    expect(session).not.toMatch(/calc\(100dvh/);
  });

  it("distributes the slack with a spacer, not with `mt-auto`", () => {
    // `space-y-*` sets `margin-top` on every sibling at a higher specificity than
    // `mt-auto`, so the auto margin loses silently and the controls stay wherever
    // the content ended. `flex-grow` is not a margin.
    expect(session).toContain('aria-hidden className="hidden compact:block compact:flex-1"');
    expect(session).not.toContain("compact:mt-auto");
  });

  it("does NOT pair `Filler` with `I drifted` to save a row", () => {
    // It was drawn that way and rejected on measurement: the screen already fits
    // 375 px, so the 30 px was buying nothing — and `I drifted` closes the
    // session irreversibly (Rule 5), so a 50/50 mis-tap target beside it is the
    // one trade this pass will not make.
    expect(grid.match(/className="w-full py-3 compact:py-1\.5"/g)).toHaveLength(2);
  });

  it("keeps all three check-in answers when the prompt becomes one row", () => {
    expect(checkIn).toContain("compact:flex compact:items-center");
    for (const label of ['label: "Yes"', 'label: "Done"', 'label: "I drifted"']) {
      expect(checkIn).toContain(label);
    }
  });
});

describe("the type ramp — four sizes, floor at 12 px", () => {
  /**
   * The compact pass bought height by shaving type, which is the cheapest lever
   * and the wrong one. It left SEVEN sizes — 10 px used twelve times, 11 px
   * sixteen — where `feature-brief-backlog-ui-redesign.md` says in as many words
   * "Three type sizes on the screen, no more". Everything from 10 to 13 px read
   * as one grey texture, so nothing led.
   *
   * Raising the floor collapses the ramp on its own: 10 and 11 both become 12.
   */
  const ALLOWED = ["text-xs", "text-[0.8125rem]", "text-[0.9375rem]", "text-xl"];

  it("has nothing below 12 px anywhere", () => {
    for (const { rel, source } of allComponentSources()) {
      expect(codeOnly(source), rel).not.toContain("text-[0.625rem]");
      expect(codeOnly(source), rel).not.toContain("text-[0.6875rem]");
    }
  });

  it("keeps the compact ramp to four sizes", () => {
    const sizes = new Set<string>();
    for (const { source } of allComponentSources()) {
      for (const m of codeOnly(source).matchAll(/compact:(text-\[[0-9.]+rem\]|text-(?:xs|sm|base|lg|xl|2xl))/g)) {
        sizes.add(m[1]);
      }
    }
    expect([...sizes].sort()).toEqual([...ALLOWED].sort());
  });
});

describe("the window is filled, and nothing exceeds it", () => {
  const mains = [
    ["src/components/session/SessionView.tsx", session],
    ["src/components/session/BacklogList.tsx", read("src/components/session/BacklogList.tsx")],
    ["src/app/(app)/log/page.tsx", read("src/app/(app)/log/page.tsx")],
  ] as const;

  it("gives every screen the full height, not just the session one", () => {
    // The first cut of this applied `flex-1` to SessionView alone, which is why
    // `/` sat in 185 px of nothing in a 430 px window.
    for (const [rel, source] of mains) {
      expect(codeOnly(source), rel).toContain("compact:flex-1");
    }
  });

  it("drops the mx-auto centring under compact on every screen", () => {
    // A centred container splits overflow EVENLY, so half goes off the left —
    // where every label sits. This is what rendered "Unfinished" as "nfinished".
    for (const [rel, source] of mains) {
      expect(codeOnly(source), rel).toContain("compact:max-w-none");
    }
  });

  it("uses no fixed pixel width under compact", () => {
    // A fixed width cannot shrink, so it pushes the row instead of yielding.
    for (const { rel, source } of allComponentSources()) {
      expect(codeOnly(source), rel).not.toMatch(/compact:w-\[[0-9.]+rem\]/);
    }
  });

  it("centres the empty state instead of pinning it to the top", () => {
    expect(read("src/components/session/BacklogList.tsx")).toContain(
      "compact:flex compact:flex-1 compact:items-center",
    );
  });

  it("puts the gate's action row on the floor, behind a rule", () => {
    expect(gate).toContain("compact:border-t compact:border-border compact:pt-2.5");
    expect(gate).toContain('aria-hidden className="hidden compact:block compact:flex-1"');
  });
});

describe("the scratch pad's colour is the topic's, not a new one", () => {
  /**
   * `globals.css` reserves colour for `Topic.color` and says so at length: there
   * is deliberately no accent token, because a second colour system would compete
   * for the eye and force the reader to learn which of the two carries data.
   *
   * Tinting the scratch pad is allowed only because it renders THAT hue, carrying
   * THAT meaning. These are the checks that keep it that way — "add some colour"
   * is exactly the request that would otherwise erode the rule one element at a
   * time.
   */
  it("declares no new colour custom property", () => {
    // The eight neutrals, and nothing else. A ninth is the accent token this
    // repo decided not to have.
    const declared = [...css.matchAll(/^\s*--([a-z-]+):\s*#/gm)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual([
      "background",
      "border",
      "border-strong",
      "foreground",
      "muted",
      "surface",
      "surface-hover",
      "surface-raised",
    ]);
  });

  it("takes the pad's colour from `topic.color`, never from a literal", () => {
    expect(session).toContain("borderLeftColor: topic.color");
    expect(session).toContain("color-mix(in srgb, ${topic.color} 8%, var(--background))");
    // No hex anywhere in the component — the hue arrives as data or not at all.
    expect(codeOnly(session)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("falls back to the neutral spine for an interrupt", () => {
    // A `pulled` or `filler` session has no task and therefore no topic. The
    // neutral spine is the honest answer, not a degraded one.
    expect(session).toContain("border-l-2 border-border-strong");
    expect(session).toContain("topic === null");
  });

  it("keeps the pad ephemeral — colour is presentation, not persistence", () => {
    expect(session).toContain("useAutoGrow(scratch)");
    expect(session).toContain("writeScratchDraft");
    expect(session).not.toMatch(/topic[^\n]*writeScratchDraft/);
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
