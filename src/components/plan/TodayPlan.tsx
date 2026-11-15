"use client";
// Client component because the add input, the cross-out control and End day are
// interactive, and because "today" is the BROWSER's local date, which a Server
// Component cannot know (`new Date()` on the server is UTC).

/**
 * THE DAY PLAN — a plain-text list to look at between sessions (Rule 27,
 * ADR-0004 Amendment 1, FOCUS-14).
 *
 * ⚠️ WHAT THIS DELIBERATELY IS NOT — each of these was designed, built in the
 * brief, and removed on 2026-11-15, and each reverses the amendment if re-added:
 *   · NOT tappable. A line can't open the gate or start anything. Work starts only
 *     through ⌘K, which this component does not touch.
 *   · NO status, count, percentage, streak or "added later" marker. A status that
 *     only updates when work starts FROM the line reads `not started` for work that
 *     was started with ⌘K — it would be wrong the moment it's most looked at.
 *   · NO link to a Task or Session. Lines are plain text.
 *   · NO editing. A line is written once; to change it, cross it out and add another.
 *   · NO reordering — lines stay in the order written (Rule 27f).
 *   · NO automatic end of day. Only the End day button ends a plan. Nothing here is
 *     scheduled (and `guardrails.test.ts` bans timers in the store; there is none
 *     here either — `subscribe` listens for focus and visibility, it does not poll).
 *
 * THE ONE PLAN, AND THE FORGOTTEN ONE. At most one plan is open. If it was opened
 * on an EARLIER local day, it is STALE: shown as "Plan from Fri 13 Nov", read-only,
 * with the add input replaced by a prompt to End day first. The server refuses a
 * line for another day too (409 `plan_locked`, `0008` Rule 27b) — this is the
 * friendly half of that rule, not a second copy of it. Nothing carries over, so a
 * forgotten plan blocks the next one instead of growing into a backlog.
 *
 * WRITES FAIL LOUDLY (ADR-0002). Nothing here is optimistic: a line appears when
 * the server has it, a failed add keeps your text and says why.
 *
 * Neutral colour only: `Topic.color` is the one hue in this app and means "which
 * topic", and a plan line has no topic. Four type roles, no `compact:` sizing.
 */

import { useState, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";
import { useAutoGrow } from "@/components/ui/useAutoGrow";
import { isStalePlan, localDateKey, planDateLabel } from "@/lib/local-date";
import type { OpenPlan, PlanLine } from "@/types/db";

/**
 * The browser's local date as an external store. `getServerSnapshot` is `null`, so
 * the server render and the first client render agree (no hydration mismatch) and
 * the real date arrives one commit later. It re-reads when the tab regains focus or
 * visibility — which is how a plan left open overnight turns stale — and never on a
 * timer.
 */
function subscribeToDate(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** A day's plan, not a backlog: the same cap the API enforces. */
const MAX_LINES_PER_ADD = 20;
const MAX_LINE_LENGTH = 200;

/** One item per line of the text area; blank lines are ignored. */
function itemsIn(draft: string): string[] {
  return draft
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.code === "plan_locked") {
    return "A plan from an earlier day is still open. End that day first.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function TodayPlan({ initialPlan }: { initialPlan: OpenPlan }) {
  const [plan, setPlan] = useState(initialPlan);
  // Resync when the server hands down a fresh plan (`router.refresh()`), during
  // render rather than in an effect — `useState(initial)` reads its argument once.
  const [prevInitial, setPrevInitial] = useState(initialPlan);
  if (initialPlan !== prevInitial) {
    setPrevInitial(initialPlan);
    setPlan(initialPlan);
  }

  const today = useSyncExternalStore(
    subscribeToDate,
    () => localDateKey(new Date()),
    () => null,
  );
  const stale = isStalePlan(plan.planDate, today);

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState(false);
  const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const draftRef = useAutoGrow(draft);
  const items = itemsIn(draft);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    // An open plan keeps its own date, so a midnight or timezone change never makes
    // a same-plan add look like a different day. An empty plan opens on today.
    const planDate = plan.planDate ?? today;
    if (items.length === 0 || planDate === null || adding) return;
    if (items.length > MAX_LINES_PER_ADD) {
      setError(`Add up to ${MAX_LINES_PER_ADD} lines at a time.`);
      return;
    }
    if (items.some((item) => item.length > MAX_LINE_LENGTH)) {
      setError(`Each line can be up to ${MAX_LINE_LENGTH} characters.`);
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const added = await api.post<PlanLine[]>("/api/plan-lines", { lines: items, planDate });
      setPlan((p) => ({ planDate: added[0]?.planDate ?? p.planDate, lines: [...p.lines, ...added] }));
      setDraft("");
    } catch (err) {
      setError(messageFor(err)); // the draft stays, so nothing typed is lost
    } finally {
      setAdding(false);
    }
  }

  async function crossOut(line: PlanLine) {
    setDropping((prev) => new Set(prev).add(line.id));
    setError(null);
    try {
      const dropped = await api.post<PlanLine>(`/api/plan-lines/${line.id}/drop`);
      setPlan((p) => ({
        ...p,
        lines: p.lines.map((l) => (l.id === dropped.id ? dropped : l)),
      }));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setDropping((prev) => {
        const next = new Set(prev);
        next.delete(line.id);
        return next;
      });
    }
  }

  async function endDay() {
    setEnding(true);
    setError(null);
    try {
      await api.post<{ ended: number }>("/api/plan-lines/end-day");
      setPlan({ planDate: null, lines: [] });
      setDraft("");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setEnding(false);
    }
  }

  const hasLines = plan.lines.length > 0;

  return (
    <section
      aria-label="Today's plan"
      className="mx-auto w-full max-w-2xl space-y-rhythm px-gutter pt-gutter compact:max-w-none"
    >
      {hasLines && (
        <>
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-label font-semibold uppercase tracking-wider text-muted">
              {stale && plan.planDate !== null
                ? `Plan from ${planDateLabel(plan.planDate)}`
                : "Today"}
            </h2>
            <Button variant="ghost" onClick={() => void endDay()} pending={ending}>
              End day
            </Button>
          </header>

          {/*
            Scrolls INSIDE ITSELF, so a long plan can't push the Unfinished list off
            the window — the brief's rule, and the reason for it ("so the Unfinished
            list stays in view at 337 px").

            THE CAP TRACKS WINDOW HEIGHT, not a fixed row count. A fixed 200 px cap
            ("five rows") was built first and MEASURED at 500×337: with eight lines
            the first Unfinished topic landed at 394 px, below the fold. Five rows
            and a visible list can't both hold at the shortest window, so the cap
            follows height like the rest of the ramp: about two rows at 337, growing
            to five by ~800 px (22vh, floored at 4rem, capped at 12.5rem). Measured,
            not guessed — this repo's arithmetic has been wrong before.

            Plain text on a neutral spine: a plan line has no topic, so no hue.
          */}
          <ul className="max-h-[clamp(4rem,22vh,12.5rem)] space-y-0.5 overflow-y-auto border-l-2 border-border-strong pl-2.5">
            {plan.lines.map((line) => {
              const crossed = line.droppedAt !== null;
              return (
                <li key={line.id} className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 break-words py-control-y text-body ${
                      crossed ? "text-muted line-through" : ""
                    }`}
                  >
                    {line.text}
                  </span>
                  {!crossed && !stale && (
                    <button
                      type="button"
                      aria-label={`Cross out: ${line.text}`}
                      title={`Cross out: ${line.text}`}
                      disabled={dropping.has(line.id)}
                      onClick={() => void crossOut(line)}
                      className="tap mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted outline-none transition hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-40"
                    >
                      <span aria-hidden className="text-body leading-none">&times;</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {stale ? (
        <p className="text-body text-muted">End this day to start today&rsquo;s plan.</p>
      ) : (
        <form onSubmit={(e) => void add(e)} className="flex items-end gap-2">
          {/*
            A TEXT AREA, ONE ITEM PER LINE (2026-11-15, the architect: "an area
            field, not enter per line"). Enter starts a new line, so a whole plan
            can be typed at once; Add (or ⌘/Ctrl+Enter) saves every line together,
            in the order typed, all or none.

            One row while it holds one line and grows as lines are typed
            (`useAutoGrow`, the same as the gate's WHY), so the empty block stays
            short at 337 px. `readOnly` while adding, not `disabled`: disabling
            drops focus.
          */}
          <textarea
            ref={draftRef}
            rows={1}
            value={draft}
            readOnly={adding}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void add();
              }
            }}
            aria-label="Add to today's plan, one item per line"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            placeholder={hasLines ? "Add more, one per line" : "What do you plan to hit today? One per line."}
            className="tap min-h-writing min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-border-strong bg-transparent px-3 py-control-y text-body outline-none focus:border-foreground compact:rounded-md"
          />
          <Button type="submit" variant="ghost" pending={adding} disabled={items.length === 0}>
            Add
          </Button>
        </form>
      )}

      {error !== null && (
        <p role="alert" className="text-label text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
