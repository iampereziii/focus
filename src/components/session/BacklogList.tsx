"use client";

/**
 * The interactive half of `/`.
 *
 * `(app)/page.tsx` is a Server Component (feature-brief-cookie-session-ssr-swap.md)
 * that resolves Rule 1's redirect and fetches topics/tasks/the pinned list in one
 * server-side pass. This owns only what a Server Component can't: which task's
 * gate Sheet is open.
 *
 * A PLAIN list grouped by topic: title, topic, status. Deliberately NO age and NO
 * displacement annotations (Rule 12) — see `(app)/page.tsx` for the full framing.
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
 */

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GateForm } from "@/components/session/GateForm";
import { Button, Sheet } from "@/components/ui";
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

  const byTopic = topics
    .map((topic) => ({ topic, items: tasks.filter((t) => t.topicId === topic.id) }))
    .filter((group) => group.items.length > 0);

  // One tap, no confirmation, no note (Rule 9 — capture is cheap, and so is
  // giving up on it). Drops locally rather than reloading: the row is gone the
  // instant the write succeeds.
  async function dropTask(task: Task) {
    await api.patch<Task>(`/api/tasks/${task.id}`, { status: "dropped" });
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Backlog</h1>

      {pinned.length > 0 && (
        <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
          <h2 className="text-xs uppercase tracking-wide opacity-60">Planned for today</h2>
          {pinned.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>
                {s.what}
                {s.resumeCue !== null && (
                  <span className="ml-2 opacity-60">· {s.resumeCue}</span>
                )}
              </span>
              <Link className="underline" href={`/session/${s.id}`}>
                Resume
              </Link>
            </div>
          ))}
        </section>
      )}

      {byTopic.length === 0 && (
        <p className="text-sm opacity-60">
          Nothing captured yet. The app starts empty — press ⌘K.
        </p>
      )}

      {byTopic.map(({ topic, items }) => (
        <section key={topic.id} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: topic.color }}
            />
            {topic.name}
          </h2>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {items.map((task) => (
              <li key={task.id} className="flex items-center justify-between py-2">
                {/* Title, topic and status only. No age, no displacement. */}
                <span className="text-sm">{task.what}</span>
                <span className="flex items-center gap-1">
                  <Button variant="ghost" onClick={() => setGating(task)}>
                    Start
                  </Button>
                  <Button variant="ghost" onClick={() => void dropTask(task)}>
                    Drop
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Sheet open={gating !== null} onClose={() => setGating(null)} title="Start a session">
        {gating !== null && <GateForm task={gating} />}
      </Sheet>
    </main>
  );
}
