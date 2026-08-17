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
 * The tree is flattened through `lib/session-tree.ts` rather than a local walker.
 * The log is a TREE — only roots sit in `weeks[].nodes` — and every place that
 * forgot to recurse has cost the same bug: live work invisible, and the app reading
 * as though it had closed a session behind your back.
 *
 * REACTIVE UI (feature-brief-reactive-ui-writes-invalidate-reads.md, 2026-08-18):
 * added as a fifth stale screen during that brief's Gap resolution — this fetched
 * once at mount, same as `/log` did, so a change made elsewhere (a check-in
 * answered from a notification, a promote, a close from another tab) left this
 * screen showing the stale row. Now a `useLive("sessions", …)` subscriber, like
 * `/log`. `SessionView` resyncs its own local state from `initial` on every fresh
 * value — see the comment there.
 */

import { use, useMemo } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { flattenWeeks } from "@/lib/session-tree";
import { SessionView } from "@/components/session/SessionView";
import type { WeekGroup } from "@/lib/facts";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useLive<{ weeks: WeekGroup[] }>("sessions", () =>
    api.get<{ weeks: WeekGroup[] }>("/api/sessions?limit=100"),
  );

  const all = useMemo(() => (data === undefined ? [] : flattenWeeks(data.weeks)), [data]);
  const session = useMemo(() => all.find((s) => s.id === id) ?? null, [all, id]);
  const parent = useMemo(
    () =>
      session === null || session.parentSessionId === null
        ? null
        : (all.find((s) => s.id === session.parentSessionId) ?? null),
    [all, session],
  );

  if (session === null) return <main className="p-6 text-sm opacity-60">Loading…</main>;
  return <SessionView initial={session} parent={parent} />;
}
