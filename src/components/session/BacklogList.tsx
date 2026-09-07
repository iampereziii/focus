"use client";

/**
 * The interactive half of `/`.
 *
 * `(app)/page.tsx` is a Server Component (feature-brief-cookie-session-ssr-swap.md)
 * that resolves Rule 1's redirect and fetches topics/tasks/the pinned list in one
 * server-side pass. This owns only what a Server Component can't: which task's
 * gate Sheet is open, and which row is mid-drop.
 *
 * A PLAIN list grouped by topic: title, topic, status. Deliberately NO age and NO
 * displacement annotations (Rule 12) — see `(app)/page.tsx` for the full framing.
 *
 * ── RENAMED, NOT RE-SOURCED (ADR-0004, 2026-08-20) ──────────────────────────
 *
 * The rows arriving here are the same query as before: tasks with
 * `status = 'backlog'`. What changed is what that set MEANS. A finished task
 * goes `done` on close and a dropped one goes `dropped`, and after ADR-0004 no
 * task exists without a session — so `backlog` now denotes exactly "started and
 * not finished". The header, sub-line and empty state were the three places
 * still claiming otherwise ("Backlog" / "Survey it, then commit to one." /
 * "Capture is cheap"); they were false the moment the gate became the only
 * door, so they were rewritten. The nav label in `AppShell` was a fourth.
 *
 * NO FILTER WAS ADDED to earn that name — see `lib/store/tasks.ts` for why a
 * "has at least one session" join would have been a no-op on the SSR path.
 *
 * REACTIVE UI (feature-brief-reactive-ui-writes-invalidate-reads.md, 2026-08-18):
 * `tasks` is shadowed into local state so `dropTask` can remove a row locally
 * without waiting on a round trip — but `useState(initialTasks)` only reads its
 * argument on the FIRST render. `router.refresh()` (fired by `AppShell` after a
 * capture) gives this component a fresh `tasks` prop, and without resyncing,
 * that fresh prop is silently ignored — this component just keeps rendering
 * whatever it had at mount. That's this brief's exact bug, one layer deeper
 * than where the brief originally went looking for it: the SSR swap fixed the
 * SERVER half (the fetch is fresh) but not this CLIENT half (the local copy of
 * it isn't). Resynced during render, not in a `useEffect` — see the identical
 * fix and its rationale in `SessionView.tsx`.
 *
 * ── REDESIGNED 2026-08-18 (feature-brief-backlog-ui-redesign.md) ─────────────
 *
 * The brief's one hard rule, and the thing to check any future edit against:
 * **every piece of information rendered here was rendered before the redesign.**
 * The redesign changes how the same facts FEEL, not what facts are present. That
 * is the line between "craft" (admissible) and "mechanics" (Rule 12's business).
 *
 * What that rules out, permanently and by decision rather than by oversight:
 *   · age or displacement per row — Rule 12, and the named A4 fallback that is
 *     judged at the 2026-09-05 checkpoint against logged data this app does not
 *     have yet. Adding it here pre-empts that checkpoint.
 *   · task counts, anywhere — not on group headers, not in the page header
 *     (brief Risk 3). A number that only grows is pressure, which Discovery
 *     Decision 2's "no nagging" clause forbids; a per-group count additionally
 *     ranks topics by size, an ordering the app did not choose.
 *   · streaks, progress bars, completion percentages, badges — retention
 *     mechanics aimed at a churn problem a solo tool does not have. The SDT
 *     research the brief cites finds they frustrate autonomy rather than
 *     support it.
 *   · ranking, scoring, invented sort order, or a "recommended next" affordance.
 *
 * What it licenses, and what is actually implemented below:
 *   · TYPE HIERARCHY — the task title is the dominant element; topic and section
 *     labels recede to small caps. Three type sizes on the screen, no more.
 *   · ONE HUE — `topic.color` is the only colour, as a group spine and a dot.
 *     There is no accent token (brief Gap 5).
 *   · AFFORDANCE WEIGHT — `Start` and `Drop` used to be the same `ghost` button,
 *     so the destructive action had equal pull with the committing one: two
 *     decisions per row rather than one. `Start` is now the whole row; `Drop`
 *     recedes by WEIGHT.
 *   · `Start` CARRIES ITS EMPHASIS AT REST, not on `group-hover`. The first cut
 *     of this redesign put the contrast on hover and a screenshot showed the two
 *     controls reading as identical twins at rest — which is the ORIGINAL defect
 *     wearing new type. Hover emphasis is invisible on touch and absent until
 *     you are already pointing at the row, i.e. after the scan that was supposed
 *     to be cheap. Weight, size and contrast are all resolved before the pointer
 *     arrives.
 *   · `Drop` IS ALWAYS RENDERED (brief Risk 2, decided 2026-08-18). No
 *     hover-reveal, no `@media (hover: none)` branch, no `:focus-visible`
 *     special case — hover-reveal has no meaning on touch, and the failure mode
 *     is one you never see on the laptop you build it on. Demoted by weight,
 *     never by presence.
 *   · MOTION on the one state change that already existed (a row leaving after
 *     `Drop`), suppressed globally under `prefers-reduced-motion` in
 *     `globals.css`.
 */

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GateForm } from "@/components/session/GateForm";
import { Sheet } from "@/components/ui";
import type { Session, Task, Topic } from "@/types/db";

export function BacklogList({
  topics,
  tasks: initialTasks,
  pinned,
}: {
  topics: Topic[];
  tasks: Task[];
  pinned: Session[];
}) {
  const [gating, setGating] = useState<Task | null>(null);
  const [tasks, setTasks] = useState(initialTasks);
  const [prevInitialTasks, setPrevInitialTasks] = useState(initialTasks);
  if (initialTasks !== prevInitialTasks) {
    setPrevInitialTasks(initialTasks);
    setTasks(initialTasks);
  }

  // Rows mid-drop. Purely presentational — the row is still in `tasks` until the
  // write returns, so a failed drop puts it back rather than lying about it.
  const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set());

  const byTopic = topics
    .map((topic) => ({ topic, items: tasks.filter((t) => t.topicId === topic.id) }))
    .filter((group) => group.items.length > 0);

  // One tap, no confirmation, no note (Rule 9 — capture is cheap, and so is
  // giving up on it). Drops locally rather than reloading: the row is gone the
  // instant the write succeeds.
  //
  // The exit animation runs DURING the request, not after it, so the row reads
  // as leaving immediately. If the write fails, the mark is cleared and the row
  // settles back into the list — the error still propagates exactly as it did
  // before, this only stops a failed drop from leaving a row stuck invisible.
  async function dropTask(task: Task) {
    setDropping((prev) => new Set(prev).add(task.id));
    try {
      await api.patch<Task>(`/api/tasks/${task.id}`, { status: "dropped" });
    } catch (err) {
      setDropping((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      throw err;
    }
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  return (
    // FILLS THE WINDOW, AND IS NOT CENTRED (2026-09-07). Two separate fixes,
    // both visible in the screenshot this came from:
    //
    //   `compact:flex-1` — the full-height treatment shipped on the session
    //     screen only, so this one stopped where its content stopped and left
    //     185 px of nothing under a card in a 430 px window.
    //   `compact:max-w-none` — `mx-auto` splits any overflow EVENLY, so half of
    //     it goes off the left, which is exactly where every label sits ("Unfinished"
    //     rendered as "nfinished"). Un-centred, overflow can only go right.
    <main className="mx-auto w-full max-w-2xl space-y-8 px-5 py-8 compact:flex compact:max-w-none compact:flex-1 compact:flex-col compact:space-y-3 compact:px-2.5 compact:py-2.5 sm:px-6">
      {/*
        The sub-line stays. It is the sentence that stopped "Unfinished" reading
        like an inbox after ADR-0004, so it is content, not decoration — it just
        gets smaller.
      */}
      <header className="space-y-1 compact:space-y-0">
        <h1 className="text-2xl font-semibold tracking-tight compact:text-[0.9375rem]">Unfinished</h1>
        <p className="text-sm text-muted compact:text-xs">Picked up, not finished.</p>
      </header>

      {/*
        Rule 23's pinned placement. Given its OWN SURFACE so it reads as a
        different KIND of thing than the backlog — but deliberately EQUAL WEIGHT:
        no larger type, no accent colour, no primary-styled `Resume` (brief Risk
        4, decided 2026-08-18). The rule of thumb: it announces "this is already
        open", it never says "do this next". A louder treatment would be a
        "recommended next" affordance, which Rule 12 prohibits.

        Still fires NOTHING — no notification, no second prompt class.
      */}
      {pinned.length > 0 && (
        <section
          aria-labelledby="planned-today"
          className="space-y-3 rounded-xl border border-border bg-surface-raised p-4 compact:space-y-1.5 compact:rounded-lg compact:p-2"
        >
          <h2
            id="planned-today"
            className="text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Planned for today
          </h2>
          <ul className="space-y-2.5 compact:space-y-1">
            {pinned.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm compact:text-xs">{s.what}</span>
                  {s.resumeCue !== null && (
                    <span className="mt-0.5 block truncate text-xs text-muted compact:mt-0">
                      {s.resumeCue}
                    </span>
                  )}
                </span>
                <Link
                  href={`/session/${s.id}`}
                  className="tap shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-surface-hover compact:rounded-md compact:px-2 compact:py-1"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Centred in the leftover height rather than pinned to the top of it.
        Stretching the panel to fill would be worse than either — an empty state
        is a statement, not a container.
      */}
      {byTopic.length === 0 && (
        <div className="compact:flex compact:flex-1 compact:items-center">
        <div className="w-full rounded-xl border border-dashed border-border-strong px-6 py-12 text-center compact:rounded-lg compact:px-3 compact:py-6">
          <p className="text-sm font-medium compact:text-xs">Nothing open.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted compact:text-xs">
            Empty is the finished state here, not the starting one — nothing you began
            is still waiting.
          </p>
          <p className="mt-5 text-xs text-muted compact:mt-3">
            Press{" "}
            <kbd className="rounded border border-border-strong bg-surface-raised px-1.5 py-0.5 font-sans text-xs">
              ⌘
            </kbd>{" "}
            <kbd className="rounded border border-border-strong bg-surface-raised px-1.5 py-0.5 font-sans text-xs">
              K
            </kbd>{" "}
            to start something.
          </p>
        </div>
        </div>
      )}

      {/*
        TWO COLUMNS OF GROUPS UNDER `compact` (revised 2026-09-07). Measured at
        500 px wide this screen was 350 px of single column, which shows about
        six rows in the 420-tall window it is actually used in while the other
        half of the width carries nothing. Same groups, same order, same rows —
        laid into the width instead of down it.

        Still Rule 12's plain list: no counts, no age, no ranking, and the group
        order is untouched. A wrapping row with `min-w-[14rem]`, so it collapses
        back to one column on its own in a narrow window.
      */}
      <div className="space-y-8 compact:flex compact:flex-wrap compact:items-start compact:gap-x-3 compact:gap-y-2.5 compact:space-y-0">
      {byTopic.map(({ topic, items }) => (
        <section key={topic.id} className="space-y-2 compact:min-w-[13rem] compact:flex-1 compact:space-y-1">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted compact:gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full compact:h-1.5 compact:w-1.5"
              style={{ backgroundColor: topic.color }}
            />
            {topic.name}
          </h2>

          {/*
            The group's common region. Rule 12's grouping is REAL grouping, not
            decoration (spec, Gap 14), so colouring it is reinforcement of a fact
            rather than invention of one. Muted with `color-mix` so a screen with
            several topics reads as a list, not a paint chart — the dot above
            carries the colour at full strength.
          */}
          <ul
            className="space-y-0.5 border-l-2 pl-2.5 compact:space-y-0 compact:pl-2"
            style={{ borderLeftColor: `color-mix(in srgb, ${topic.color} 55%, transparent)` }}
          >
            {items.map((task) => (
              <li
                key={task.id}
                className={`group flex items-center rounded-lg border border-transparent transition hover:border-border hover:bg-surface-hover ${
                  dropping.has(task.id) ? "focus-row-out" : ""
                }`}
              >
                {/*
                  Fitts: the commit target is the ROW, not a small button inside
                  it. Kept as a real sibling `<button>` rather than a stretched
                  absolutely-positioned overlay, so `Drop` does not have to fight
                  it with z-index and both controls stay ordinary focusable
                  elements.

                  The visible "Start" is `aria-hidden`, so WITHOUT an explicit
                  label this button's accessible name would be the bare task
                  title — a screen reader would announce what the row is and
                  never what pressing it does. Caught by an ambiguous Playwright
                  selector, not by reading.

                  Title, and nothing else. No age, no displacement, no count.
                  Status is carried by the FILTER — `/` lists `status: "backlog"`
                  exclusively (`page.tsx`), so a per-row badge would repeat one
                  identical word down the whole list, which costs scanning speed
                  and adds no information. FOCUS-3's acceptance criterion was
                  amended to record this on 2026-08-18.
                */}
                <button
                  type="button"
                  aria-label={`Start a session: ${task.what}`}
                  onClick={() => setGating(task)}
                  className="tap flex min-w-0 flex-1 items-center justify-between gap-6 rounded-lg py-3 pl-3 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground compact:gap-3 compact:rounded-md compact:py-1 compact:pl-2"
                >
                  <span className="min-w-0 truncate text-[0.9375rem] font-medium compact:text-[0.8125rem]">
                    {task.what}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-sm font-semibold text-foreground compact:text-xs"
                  >
                    Start
                  </span>
                </button>

                {/*
                  ALWAYS RENDERED (Risk 2). Demoted by weight — smaller, muted,
                  borderless — never by presence. `aria-label` disambiguates it
                  from every other `Drop` on the screen.
                */}
                <button
                  type="button"
                  aria-label={`Drop: ${task.what}`}
                  onClick={() => void dropTask(task)}
                  className="tap mr-1 shrink-0 rounded-md px-2 py-1.5 text-xs font-normal text-muted outline-none transition hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground compact:mr-0.5 compact:px-1.5 compact:py-1"
                >
                  Drop
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </div>

      <Sheet open={gating !== null} onClose={() => setGating(null)} title="Start a session">
        {gating !== null && <GateForm task={gating} onStarted={() => setGating(null)} />}
      </Sheet>
    </main>
  );
}
