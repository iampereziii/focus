"use client";

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
 * DO NOT re-add ranking, scoring, or a "recommended next" affordance. That
 * reintroduces the choosing problem the app exists to remove. (See A4 for what
 * would falsify this and what the next move is if it does.)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { GateForm } from "@/components/session/GateForm";
import { Button, Sheet } from "@/components/ui";
import type { Session, Task, Topic } from "@/types/db";

interface WeekPayload {
  weeks: { nodes: { session: Session }[] }[];
}

export default function BacklogPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pinned, setPinned] = useState<Session[]>([]);
  const [gating, setGating] = useState<Task | null>(null);

  useEffect(() => {
    void (async () => {
      const [topicRows, taskRows, log] = await Promise.all([
        api.get<Topic[]>("/api/topics"),
        api.get<Task[]>("/api/tasks?status=backlog"),
        api.get<WeekPayload>("/api/sessions?limit=50"),
      ]);

      const all = log.weeks.flatMap((w) => w.nodes.map((n) => n.session));

      // Rule 1 — an active session takes over the screen entirely.
      const active = all.find((s) => s.status === "active");
      if (active !== undefined) {
        router.replace(`/session/${active.id}`);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      setPinned(
        all.filter(
          (s) => s.resumePlannedAt !== null && s.resumePlannedAt.slice(0, 10) <= today,
        ),
      );
      setTopics(topicRows);
      setTasks(taskRows);
    })();
  }, [router]);

  const byTopic = topics
    .map((topic) => ({ topic, items: tasks.filter((t) => t.topicId === topic.id) }))
    .filter((group) => group.items.length > 0);

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
                <Button variant="ghost" onClick={() => setGating(task)}>
                  Start
                </Button>
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
