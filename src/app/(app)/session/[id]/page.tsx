"use client";

/**
 * `/session/[id]` — the workspace. One task, a derived timer, the interrupt tap,
 * and the close-out. Nothing else.
 */

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SessionView } from "@/components/session/SessionView";
import type { Session } from "@/types/db";

interface WeekPayload {
  weeks: { nodes: { session: Session; children: { session: Session }[] }[] }[];
}

function flatten(payload: WeekPayload): Session[] {
  const out: Session[] = [];
  const walk = (node: { session: Session; children?: { session: Session }[] }) => {
    out.push(node.session);
    for (const child of node.children ?? []) walk(child);
  };
  for (const week of payload.weeks) for (const node of week.nodes) walk(node);
  return out;
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    void api
      .get<WeekPayload>("/api/sessions?limit=100")
      .then((payload) => setSession(flatten(payload).find((s) => s.id === id) ?? null));
  }, [id]);

  if (session === null) return <main className="p-6 text-sm opacity-60">Loading…</main>;
  return <SessionView initial={session} />;
}
