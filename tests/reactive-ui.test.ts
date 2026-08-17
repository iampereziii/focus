/**
 * THE REACTIVE-UI SEAM (feature-brief-reactive-ui-writes-invalidate-reads.md).
 *
 * The bug this brief fixes is a class of ABSENCE: `router.refresh()` sat at
 * `layout.tsx:70` for the life of the app, typechecked, passed review, and did
 * nothing — because nothing announced what a write had changed. Nothing in the
 * toolchain greps for "this route exists and nothing reads it after a write."
 *
 * So the standing check here (mirroring `interrupt-return.test.ts`'s dead-
 * endpoint trap) is: does every write route have an entry in `EFFECTS`
 * (`lib/api.ts`)? A forgotten entry is silent — the write still succeeds, it
 * just invalidates nothing — which is exactly this brief's bug returning
 * through a new door (Risk 6, superseded by Risk 7).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { EFFECTS, keysFor } from "@/lib/api";

const root = path.resolve(__dirname, "..");

describe("EFFECTS covers every write route — the absence trap", () => {
  /** Every `src/app/api/**` directory whose route.ts exports POST or PATCH. */
  const writeRouteSegments = (): Set<string> => {
    const segments = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name !== "route.ts") continue;
        const body = readFileSync(full, "utf8");
        if (!/export (async )?function (POST|PATCH)\(/.test(body)) continue;

        // `src/app/api/<segment>/...` — the first segment under /api/.
        const rel = path.relative(path.join(root, "src/app/api"), dir).split(path.sep);
        segments.add(rel[0]);
      }
    };
    walk(path.join(root, "src/app/api"));
    return segments;
  };

  it("has an EFFECTS entry for every route folder that exports POST or PATCH", () => {
    for (const segment of writeRouteSegments()) {
      expect(
        Object.prototype.hasOwnProperty.call(EFFECTS, segment),
        `/api/${segment}/... has a POST or PATCH but no EFFECTS entry — a write here would invalidate nothing, silently`,
      ).toBe(true);
    }
  });

  it("has no EFFECTS entry for a segment that doesn't exist — no dead rows either", () => {
    const real = writeRouteSegments();
    for (const segment of Object.keys(EFFECTS)) {
      expect(real, `EFFECTS["${segment}"] has no matching /api/${segment} write route`).toContain(
        segment,
      );
    }
  });

  it("records `push` as a deliberate no-op, not a forgotten one", () => {
    // An empty array is a decision (checked, nothing to invalidate); a missing
    // key is the bug class this test exists to catch. They must read differently.
    expect(EFFECTS.push).toEqual([]);
  });
});

describe("keysFor — deriving invalidation from a written URL", () => {
  it("maps each segment to its coarse domain-noun keys", () => {
    expect(keysFor("/api/topics")).toEqual(["topics"]);
    expect(keysFor("/api/checkins/abc")).toEqual(["sessions"]);
  });

  it("carries the one wrinkle: starting a session also frees its Task", () => {
    expect(keysFor("/api/sessions")).toEqual(
      expect.arrayContaining(["sessions", "active-session", "review", "tasks"]),
    );
  });

  it("also carries the wrinkle for resume and promote — both move a Task too", () => {
    expect(keysFor("/api/sessions/abc/resume")).toContain("tasks");
    expect(keysFor("/api/sessions/abc/promote")).toContain("tasks");
  });

  it("does NOT invent a `tasks` key for rearm, dispose or kind", () => {
    expect(keysFor("/api/sessions/abc/rearm")).not.toContain("tasks");
    expect(keysFor("/api/sessions/abc/dispose")).not.toContain("tasks");
    expect(keysFor("/api/sessions/abc/kind")).not.toContain("tasks");
  });

  it("returns nothing for an unrecognised segment rather than throwing", () => {
    expect(keysFor("/api/nonexistent")).toEqual([]);
  });
});

const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the dead router.refresh() is gone, not kept as a belt-and-braces call", () => {
  it("layout.tsx no longer calls router.refresh()", () => {
    const layout = readFileSync(path.join(root, "src/app/(app)/layout.tsx"), "utf8");
    expect(stripComments(layout)).not.toMatch(/router\.refresh\(/);
  });

  it("QuickCapture no longer takes an onCaptured prop — nothing needs to call it", () => {
    const quickCapture = readFileSync(
      path.join(root, "src/components/capture/QuickCapture.tsx"),
      "utf8",
    );
    expect(quickCapture).not.toContain("onCaptured");
  });
});

describe("the four mandatory SWR opt-outs live in exactly one place (Risk 1)", () => {
  const layout = readFileSync(path.join(root, "src/app/(app)/layout.tsx"), "utf8");

  it("sets all four inside layout.tsx's single <SWRConfig>", () => {
    expect(layout).toContain("revalidateOnFocus: false");
    expect(layout).toContain("revalidateOnReconnect: false");
    expect(layout).toContain("dedupingInterval: 0");
    expect(layout).toContain("keepPreviousData: false");
  });

  it("no other file re-declares SWRConfig — one provider, not one per screen", () => {
    const appRoot = path.join(root, "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full === path.join(root, "src/app/(app)/layout.tsx")) continue;
        if (readFileSync(full, "utf8").includes("<SWRConfig")) offenders.push(full);
      }
    };
    walk(appRoot);
    expect(offenders).toEqual([]);
  });
});

describe("the /review day gate survives invalidation (Risk 3)", () => {
  it("gates the fetch key on `started`, null otherwise — merely opening /review must not compute the day", () => {
    const review = readFileSync(path.join(root, "src/app/(app)/review/page.tsx"), "utf8");
    expect(review).toMatch(/useLive[^(]*\(\s*started\s*\?\s*"review"\s*:\s*null/);
  });

  it("`started` stays ordinary component state — useLive must never own it", () => {
    const review = readFileSync(path.join(root, "src/app/(app)/review/page.tsx"), "utf8");
    expect(review).toContain("useState(false)");
  });
});

describe("the Rule 1 redirect stays mount-time only (Risk 2)", () => {
  it("`/` never subscribes the redirect probe to `active-session`", () => {
    const backlog = readFileSync(path.join(root, "src/app/(app)/page.tsx"), "utf8");
    expect(backlog).not.toMatch(/useLive[^(]*\(\s*"active-session"/);
  });
});
