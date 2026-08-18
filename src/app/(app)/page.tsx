/**
 * `/` — HOME IS THE BACKLOG (Rule 12, rewritten 2026-08-16).
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
 * topic/task/log reads happen in ONE server-side pass, before anything
 * client-side mounts — no more duplicate `/api/sessions/active` call racing the
 * layout's. The interactive half (the gate Sheet) is `BacklogList`.
 */

import { redirect } from "next/navigation";
import { activeSession, listSessionsPage } from "@/lib/store/sessions";
import { listTopics } from "@/lib/store/topics";
import { listTasks } from "@/lib/store/tasks";
import { checkInsForSessions } from "@/lib/store/checkins";
import { groupByWeek } from "@/lib/facts";
import { flattenWeeks } from "@/lib/session-tree";
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

  const [topics, tasks, sessions] = await Promise.all([
    listTopics(),
    listTasks({ status: "backlog" }),
    listSessionsPage(50),
  ]);
  const checkIns = await checkInsForSessions(sessions.map((s) => s.id));
  const weeks = groupByWeek(sessions, checkIns, new Date());

  // Depth-first: a suspended session given a resume cue at day review can be
  // an interrupt, and interrupts are children.
  const all = flattenWeeks(weeks);

  const today = new Date().toISOString().slice(0, 10);
  const pinned = all.filter(
    (s) => s.resumePlannedAt !== null && s.resumePlannedAt.slice(0, 10) <= today,
  );

  return <BacklogList topics={topics} tasks={tasks} pinned={pinned} />;
}
