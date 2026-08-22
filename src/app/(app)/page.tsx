/**
 * `/` — HOME IS THE UNFINISHED LIST (Rule 12, re-scoped by ADR-0004 2026-08-20;
 * rewritten 2026-08-16 before that).
 *
 * ADR-0004 made the gate the only door: nothing enters the app without starting
 * a session. That does not change a single line of the data flow below — the
 * query is still tasks at `status = 'backlog'` — but it changes what that set
 * contains. "Captured and never started" stopped being a reachable state, so
 * what is left is work that was begun and closed `partial`. The screen was
 * renamed to say so; it was NOT re-sourced. A "has at least one session" join
 * was proposed, reviewed and rejected as a no-op (see `lib/store/tasks.ts`).
 *
 * The survey step Rule 12 was built for now happens in the architect's own
 * backlog tool, outside this app. That is the fact ADR-0004 turns on, and it is
 * the thing to re-read if this screen ever feels like it is missing something:
 * the missing thing is deliberately somewhere else.
 *
 * A PLAIN list grouped by topic: title, topic, status. Deliberately NO age and
 * NO displacement annotations — displacement needs logged data that does not
 * exist at v1, and the "deliberately uncomfortable" variant was considered and
 * not taken (Discovery Decision 2).
 *
 * This is the LAUNCHPAD, not the workspace. You survey the backlog *before*
 * committing, which is what lets a block be defended. Once a session starts, the
 * list collapses out of view and the app shows that one task only —
 * single-threading is enforced DURING the work, not by blinding you beforehand.
 *
 * Two placements sit above the list:
 *   1. an ACTIVE session → redirect to /session/[id] (Rule 1)
 *   2. any session whose `resumePlannedAt` falls today → pinned at the top,
 *      passively. It fires NOTHING — no notification, no second prompt class
 *      (Rule 23).
 *
 * BOTH of those used to read the log tree ONE LEVEL DEEP, and an interrupt is a
 * CHILD of the session it suspended — so neither could see a `pulled` or `filler`
 * row. Tapping an interrupt and then visiting /log left the architect back here
 * with a backlog list and no sign of live work, as though the session had been
 * closed. It never was. Fixed 2026-08-17: (1) asks the database for the one row it
 * wants, and (2) flattens the tree properly via `lib/session-tree.ts`.
 *
 * DO NOT re-add ranking, scoring, or a "recommended next" affordance. That
 * reintroduces the choosing problem the app exists to remove. (See A4 for what
 * would falsify this and what the next move is if it does.)
 *
 * REDESIGNED 2026-08-18 (feature-brief-backlog-ui-redesign.md) — and note what
 * did NOT change: this file. The redesign is rendering-only, so Rule 1's
 * redirect, every fetch, and the `pinned` computation are untouched, and no
 * store method, route, migration or dependency was added. The whole of it lives
 * in `BacklogList`, `ui/index.tsx` and `globals.css`. If a future change to `/`
 * appears to need a new field HERE, that is the signal it has stopped being
 * craft and become the annotated-list variant Rule 12 rules out — see
 * `BacklogList.tsx` for the full boundary.
 *
 * SSR since 2026-08-18 (feature-brief-cookie-session-ssr-swap.md): a Server
 * Component now, per the project-spec Routes table. Rule 1's redirect and the
 * topic/task reads happen in ONE server-side pass, before anything client-side
 * mounts — no more duplicate `/api/sessions/active` call racing the layout's.
 * The interactive half (the gate Sheet) is `BacklogList`.
 *
 * IT NO LONGER READS THE LOG TO FIND ITS PINNED ROWS (feature-brief-write-path-
 * latency-and-in-flight-feedback.md, Slice C, 2026-08-21). Rule 23's placement
 * used to cost 50 sessions, every check-in belonging to them, `groupByWeek` and
 * `flattenWeeks` — four steps to filter on one column, on the app's most-loaded
 * route. `sessionsPlannedForResume` asks the database the question directly.
 *
 * That also fixed a quiet correctness bug: filtering the last 50 sessions meant a
 * resume cue older than those 50 silently stopped being pinned, so a session
 * deferred long enough disappeared from the one placement designed to bring it
 * back. The targeted query has no such horizon.
 *
 * `activeSession()` is `cache()`d in the store, so this call and the layout's
 * identical one are ONE query per request rather than two.
 */

import { redirect } from "next/navigation";
import { activeSession, sessionsPlannedForResume } from "@/lib/store/sessions";
import { listTopics } from "@/lib/store/topics";
import { listTasks } from "@/lib/store/tasks";
import { BacklogList } from "@/components/session/BacklogList";

/**
 * Nothing here touches a Next.js dynamic API (no `cookies()`, no
 * `searchParams`), so without this Next.js has no signal that Rule 1's redirect
 * and the backlog list depend on live DB state — it will happily prerender this
 * at BUILD time and serve that one frozen snapshot to every request forever.
 * Caught by `npm run build` showing `/` as `○ (Static)`.
 */
export const dynamic = "force-dynamic";

export default async function BacklogPage() {
  // Rule 1 — an active session takes over the screen entirely. Asked as a
  // one-row question, so the answer cannot depend on how deep in the tree the
  // session happens to sit, or on it falling inside the log page's limit.
  const active = await activeSession();
  if (active !== null) redirect(`/session/${active.id}`);

  // "Due" means the cue falls on today or earlier, so the bound is the end of
  // today — expressed as an instant rather than as a date-string comparison.
  //
  // THIS IS THE SERVER'S TODAY, NOT THE ARCHITECT'S, and that is deliberately
  // unchanged: this is a Server Component, `new Date()` here is the Vercel
  // clock (UTC), and the code it replaces compared UTC date-parts on both sides.
  // Same behaviour, one query instead of four steps.
  //
  // It is also STILL WRONG west of UTC, in exactly the way
  // feature-brief-day-review-local-day-boundary.md describes: a cue can pin a
  // day early or late depending on offset (that brief's AC 7 names this very
  // line). Fixing it needs the browser's date, which a Server Component cannot
  // know — so it belongs to that brief, with the rest of the local-day work,
  // not smuggled into a latency change where nobody would look for it.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const [topics, tasks, pinned] = await Promise.all([
    listTopics(),
    listTasks({ status: "backlog" }),
    sessionsPlannedForResume(endOfToday),
  ]);

  return <BacklogList topics={topics} tasks={tasks} pinned={pinned} />;
}
