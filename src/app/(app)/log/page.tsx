"use client";

/**
 * `/log` — THE RECORD. This is what answers "what did you do?", which is failure
 * mode #3 from ADR-0001.
 *
 * Sessions grouped by week, newest first, with interrupts NESTED under the session
 * they interrupted. Paginated by week — it never loads the full history.
 *
 * A PROMOTED session renders as a continuation of the filler it came from
 * (`↳ promoted`), not as an unexplained duplicate title. That is the one
 * presentation cost Gap 26 accepted, and it is worth it: the filler's own row
 * stays visible with `kind: 'filler'` intact, because promotion INSERTS rather
 * than relabels. Those minutes are the number A10 is written against.
 *
 * NOTHING HERE IS EDITABLE. Closed sessions are immutable (Rule 5) and there is no
 * delete endpoint (Rule 14) — a mistaken session is closed `abandoned` with a
 * note. "Never edit a card after the session. A tidied log is a useless log."
 *
 * Half the build gate is measured on this screen: a week must be reconstructable
 * in UNDER 2 MINUTES, without relying on memory.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDuration } from "@/components/ui";
import type { Session } from "@/types/db";

interface Node {
  session: Session;
  children: Node[];
  focusedMs: number;
  promotedFrom: string | null;
}

interface WeekGroup {
  weekStart: string;
  nodes: Node[];
}

function SessionRow({ node, depth }: { node: Node; depth: number }) {
  const s = node.session;
  return (
    <>
      <li style={{ paddingLeft: depth * 16 }} className="py-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm">
            {node.promotedFrom !== null && <span className="opacity-60">↳ promoted · </span>}
            {s.what}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums opacity-60">
            {formatDuration(node.focusedMs)}
          </span>
        </div>
        <div className="text-xs opacity-60">
          {new Date(s.startedAt).toLocaleString()} · {s.kind}
          {s.interruptTag !== null && ` · ${s.interruptTag}`} · {s.status}
          {/* The original kind is never overwritten — the correction sits beside it. */}
          {s.kindCorrectedTo !== null && ` · corrected → ${s.kindCorrectedTo}`}
        </div>
        {s.outcomeNote !== null && <p className="mt-1 text-xs">{s.outcomeNote}</p>}
      </li>
      {node.children.map((child) => (
        <SessionRow key={child.session.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function LogPage() {
  const [weeks, setWeeks] = useState<WeekGroup[]>([]);

  useEffect(() => {
    void api
      .get<{ weeks: WeekGroup[] }>("/api/sessions?limit=100")
      .then((payload) => setWeeks(payload.weeks));
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Log</h1>

      {weeks.length === 0 && (
        <p className="text-sm opacity-60">No sessions yet. The log begins at the first one.</p>
      )}

      {weeks.map((week) => (
        <section key={week.weekStart}>
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Week of {week.weekStart}
          </h2>
          <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
            {week.nodes.map((node) => (
              <SessionRow key={node.session.id} node={node} depth={0} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
