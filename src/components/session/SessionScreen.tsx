"use client"; // SWR subscription for live updates, plus a hydration guard — both need the browser

import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { SessionSkeleton } from "@/components/session/SessionSkeleton";
import { SessionView } from "@/components/session/SessionView";
import type { Session, Topic } from "@/types/db";

export type SessionWithRelations = {
  session: Session;
  parent: Session | null;
  children: Session[];
  /** Tints the scratch pad. `null` for an interrupt, which has no task. */
  topic: Topic | null;
};

const subscribeNever = () => () => {};

/**
 * The session workspace, arriving WITH its data.
 *
 * `page.tsx` reads the session on the server and hands it in as `initial`, so the
 * screen no longer loads its code first and then asks for its data (FOCUS-16 /
 * Finding 11) — one request instead of two on Start, an interrupt tap and
 * `Back to "<parent>"`.
 *
 * LIVE UPDATES ARE UNCHANGED. `useLive("sessions", …, id)` is still the
 * subscription, so a check-in answer, a promote or a close still lands here, and
 * the id is still the SCOPE so two sessions never share an entry. `initial` is
 * only the first value. The mount still re-asks the server in the background
 * (SWR's default), which is deliberate: nothing here answers a read from memory
 * (ADR-0002), and it corrects a stale entry left by an earlier visit to the same
 * session.
 *
 * THE HYDRATION GUARD. `SessionView` was never rendered on the server before —
 * the old page showed a skeleton until its data arrived — and it reads the clock
 * (`useElapsed`) and `localStorage` (the scratch pad) while rendering. On a hard
 * load of `/session/<id>` the server's HTML would disagree with the browser's
 * first render and React would report a hydration mismatch. So until hydration
 * has finished this shows the skeleton, exactly as the old page did. On a normal
 * in-app navigation there is no hydration, and the view renders at once.
 */
export function SessionScreen({
  id,
  initial,
}: {
  id: string;
  initial: SessionWithRelations;
}) {
  const { data } = useLive<SessionWithRelations>(
    "sessions",
    () => api.get<SessionWithRelations>(`/api/sessions/${id}`),
    id,
    { fallbackData: initial },
  );

  // `false` while the server renders and while the browser hydrates that HTML,
  // `true` for every client-side render after it.
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  if (!ready) return <SessionSkeleton />;

  const current = data ?? initial;
  return <SessionView initial={current.session} parent={current.parent} topic={current.topic} />;
}
