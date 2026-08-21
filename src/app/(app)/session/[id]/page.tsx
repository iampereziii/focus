"use client";

/**
 * `/session/[id]` — the workspace. One task, a derived timer, the interrupt tap,
 * and the close-out. Nothing else.
 *
 * It also resolves the session's PARENT, when there is one, and hands it down
 * read-only. Closing an interrupt resumes that parent (Rules 16/17), and both the
 * confirmation and the failure message have to NAME it — "back to the session it
 * interrupted" is the phrasing of an app that lost track of which session that was.
 *
 * REACTIVE UI (feature-brief-reactive-ui-writes-invalidate-reads.md, 2026-08-18):
 * a `useLive("sessions", …)` subscriber, so a change made elsewhere — a check-in
 * answered from a notification, a promote, a close from another tab — lands here
 * rather than leaving a stale row on screen. `SessionView` resyncs its own local
 * state from `initial` on every fresh value; see the comment there.
 *
 * ONE SESSION PER REQUEST since 2026-08-21 (feature-brief-write-path-latency-and-
 * in-flight-feedback.md, Slice B). This used to fetch `?limit=100` and hunt for
 * its row in the flattened week tree, which meant (a) the entire recent log
 * downloaded to render one screen, (b) the same hundred rows re-downloaded on
 * every `sessions` invalidation — including one fired by answering a check-in on
 * THIS screen — and (c) a session older than the hundredth being unreachable
 * outright. `GET /api/sessions/[id]` answers all three. That last one was a
 * correctness bug hiding inside a performance one, which is why the fix belongs
 * here and not in the invalidation map.
 *
 * The `id` is passed as the live key's SCOPE, not folded into the domain noun:
 * writes still announce `sessions` and still reach this screen, but navigating
 * between two sessions can no longer serve the previous one's response.
 */

import { use } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { SessionView } from "@/components/session/SessionView";
import type { Session } from "@/types/db";

type SessionWithRelations = {
  session: Session;
  parent: Session | null;
  children: Session[];
};

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useLive<SessionWithRelations>(
    "sessions",
    () => api.get<SessionWithRelations>(`/api/sessions/${id}`),
    id,
  );

  if (data === undefined) return <SessionSkeleton />;
  return <SessionView initial={data.session} parent={data.parent} />;
}

/**
 * A SHAPED skeleton, not the word "Loading…".
 *
 * `/log` has had one since the log-view brief, justified on disambiguation
 * grounds — a reader can tell "still arriving" from "there is nothing here". The
 * same argument applies with more force to the screen opened most (brief Gap,
 * resolved 2026-08-21).
 *
 * It matches the real layout's blocks — kind line, title, timer, why/finish-line
 * — so arrival does not reflow the page under a thumb already moving toward a
 * control. Deliberately shows no controls: an interrupt cell or a close button
 * that appears before the session it acts on would be a tap target aimed at
 * nothing.
 */
function SessionSkeleton() {
  return (
    <main aria-busy className="mx-auto max-w-xl space-y-6 p-6">
      <span className="sr-only">Loading this session</span>
      <header className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-7 w-3/5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-10 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <section className="space-y-2">
        <div className="h-4 w-4/5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </section>
    </main>
  );
}
