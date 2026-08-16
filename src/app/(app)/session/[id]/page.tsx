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
 */

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { flattenWeeks } from "@/lib/session-tree";
import { SessionView } from "@/components/session/SessionView";
import type { WeekGroup } from "@/lib/facts";
import type { Session } from "@/types/db";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<Session | null>(null);
  const [parent, setParent] = useState<Session | null>(null);

  useEffect(() => {
    void api.get<{ weeks: WeekGroup[] }>("/api/sessions?limit=100").then((payload) => {
      const all = flattenWeeks(payload.weeks);
      const found = all.find((s) => s.id === id) ?? null;
      setSession(found);
      setParent(
        found === null || found.parentSessionId === null
          ? null
          : (all.find((s) => s.id === found.parentSessionId) ?? null),
      );
    });
  }, [id]);

  if (session === null) return <main className="p-6 text-sm opacity-60">Loading…</main>;
  return <SessionView initial={session} parent={parent} />;
}
