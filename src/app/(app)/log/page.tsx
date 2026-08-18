"use client";

/**
 * `/log` — THE RECORD. This is what answers "what did you do?", which is failure
 * mode #3 from ADR-0001. Half the build gate is measured on this screen: a week
 * must be reconstructable in UNDER 2 MINUTES, without relying on memory
 * (project-spec.md:53, :590).
 *
 * REDESIGNED per feature-brief-log-view-information-architecture.md (2026-08-18)
 * around Shneiderman's mantra — overview (week/day summaries), zoom (day
 * grouping, `Load older weeks`), details on demand (the `why` disclosure). No
 * schema change, nothing becomes editable, nothing gains a delete affordance
 * (Rules 5, 14).
 *
 * Sessions grouped by week, then by day within the week, newest first, with
 * interrupts NESTED under the session they interrupted. Paginated by week —
 * `Load older weeks` fetches an explicit older page with `before`; there is no
 * infinite scroll, deliberately (NN/g's guidance against it for goal-oriented
 * reading — Research Basis R11).
 *
 * A PROMOTED session renders as a continuation of the filler it came from
 * (`↳ promoted`, in the badge row, not the title — item K), not as an
 * unexplained duplicate title. That is the one presentation cost Gap 26
 * accepted: the filler's own row stays visible with `kind: 'filler'` intact,
 * because promotion INSERTS rather than relabels.
 *
 * NOTHING HERE IS EDITABLE. Closed sessions are immutable (Rule 5) and there is
 * no delete endpoint (Rule 14) — a mistaken session is closed `abandoned` with a
 * note. The `why` disclosure (item H) is a read-only reveal, not an edit
 * affordance. "Never edit a card after the session. A tidied log is a useless
 * log."
 *
 * REACTIVE UI (feature-brief-reactive-ui-writes-invalidate-reads.md): the
 * primary (newest) page is a `useLive("sessions", …)` subscriber, so a session
 * written from another surface (or this same tab) appears without navigating
 * away and back. Older pages loaded via `Load older weeks` are one-off fetches
 * held in local state, not live — the check-in fetch cost of re-requesting them
 * is noted and deliberately not optimised (Risk 5).
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Badge, Button, formatDuration, formatTimeRange, type BadgeVariant } from "@/components/ui";
import { addDays, dateKey, dayParts } from "@/lib/time";
import type { SessionNode, WeekGroup } from "@/lib/facts";
import type { Session } from "@/types/db";

// ── Pure helpers — date math for the day grouping (item B) ────────────────────
//
// EVERY DATE HERE IS APP-ZONE (`lib/time`), NEVER THE BROWSER'S. The week
// grouping this screen renders is computed on the server, so a day key read off
// the viewer's clock put a session under a date it did not happen on whenever the
// two zones disagreed — which is every session started before 08:00 GMT+8.

export function localDateKey(d: Date): string {
  return dateKey(d);
}

/** `TODAY · MON 17 AUG` / `YESTERDAY · SUN 16 AUG` / `SAT 15 AUG` (Gap, resolved 2026-08-18). */
export function dayLabel(key: string, today: string, yesterday: string): string {
  const { weekday, month, dayOfMonth } = dayParts(key);
  const absolute = `${weekday.toUpperCase()} ${dayOfMonth} ${month.toUpperCase()}`;
  if (key === today) return `TODAY · ${absolute}`;
  if (key === yesterday) return `YESTERDAY · ${absolute}`;
  return absolute;
}

export function formatWeekOf(weekStart: string): string {
  const { weekday, month, dayOfMonth } = dayParts(weekStart);
  return `Week of ${weekday} ${dayOfMonth} ${month}`;
}

export function flattenTree(nodes: readonly SessionNode[]): SessionNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Focused total, session count, interrupt count — item I / item B's day total. */
export function summarize(nodes: readonly SessionNode[]): {
  focusedMs: number;
  sessionCount: number;
  interruptCount: number;
} {
  const flat = flattenTree(nodes);
  return {
    focusedMs: flat.reduce((sum, n) => sum + n.focusedMs, 0),
    sessionCount: flat.length,
    interruptCount: flat.filter((n) => n.session.kind !== "focus").length,
  };
}

export function groupByDay(nodes: readonly SessionNode[]): { dateKey: string; nodes: SessionNode[] }[] {
  const byDay = new Map<string, SessionNode[]>();
  for (const node of nodes) {
    const key = localDateKey(new Date(node.session.startedAt));
    const list = byDay.get(key) ?? [];
    list.push(node);
    byDay.set(key, list);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, dayNodes]) => ({
    dateKey: key,
    nodes: dayNodes,
  }));
}

/**
 * Merges pages by `weekStart`, not just concatenates — a week can straddle a
 * page boundary (pagination is by session count, not by week), so the same
 * `weekStart` can arrive from both the live page and an older `Load older
 * weeks` fetch and must combine into one section rather than two.
 */
export function mergeWeeks(...pages: (readonly WeekGroup[])[]): WeekGroup[] {
  const byWeek = new Map<string, SessionNode[]>();
  for (const page of pages) {
    for (const week of page) {
      byWeek.set(week.weekStart, [...(byWeek.get(week.weekStart) ?? []), ...week.nodes]);
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekStart, nodes]) => ({
      weekStart,
      nodes: [...nodes].sort((a, b) => Date.parse(b.session.startedAt) - Date.parse(a.session.startedAt)),
    }));
}

/**
 * The badge reads as `drift` — not the original `kind` — whenever a correction
 * says so, so the badge always shows what actually happened. Rule 21's "the
 * correction sits beside it" is what keeps the original `kind` from being
 * hidden: `SessionRow` adds it back into the tertiary text whenever the badge
 * diverges from it.
 */
export function badgeVariant(s: Session): BadgeVariant {
  if (s.status === "drifted" || s.kindCorrectedTo === "drift") return "drift";
  return s.kind;
}

// ── Rows ────────────────────────────────────────────────────────────────────

function SessionRow({ node }: { node: SessionNode }) {
  const s = node.session;
  const [showWhy, setShowWhy] = useState(false);
  const variant = badgeVariant(s);
  const showWallLine = node.wallMs > node.focusedMs;

  const tertiary: string[] = [];
  if (variant !== s.kind) tertiary.push(s.kind);
  if (s.interruptTag !== null) tertiary.push(s.interruptTag);
  tertiary.push(s.status);
  if (s.kindCorrectedTo !== null) tertiary.push(`corrected → ${s.kindCorrectedTo}`);

  const wallParts: string[] = [];
  if (node.children.length > 0) {
    wallParts.push(`${node.children.length} interrupt${node.children.length === 1 ? "" : "s"}`);
  }
  if (node.unansweredCount > 0) {
    wallParts.push(
      `${node.unansweredCount} check-in${node.unansweredCount === 1 ? "" : "s"} unanswered`,
    );
  }

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{s.what}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums opacity-70">
          {showWallLine ? `${formatDuration(node.focusedMs)} focused` : formatDuration(node.focusedMs)}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs opacity-60">
          <span className="font-mono">{formatTimeRange(s.startedAt, s.endedAt)}</span>
          <Badge variant={variant} />
          {tertiary.length > 0 && <span>{tertiary.join(" · ")}</span>}
          {node.promotedFrom !== null && <span>↳ promoted</span>}
        </span>
        {showWallLine && (
          <span className="shrink-0 text-xs opacity-60">
            of {formatDuration(node.wallMs)}
            {wallParts.length > 0 ? ` · ${wallParts.join(" · ")}` : ""}
          </span>
        )}
      </div>

      {s.kind === "focus" && s.finishLine !== null && (
        <div className="mt-1 flex items-baseline justify-between gap-4 text-xs opacity-70">
          <span>Finish line — {s.finishLine}</span>
          {s.why !== null && (
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              className="shrink-0 underline decoration-dotted opacity-70 hover:opacity-100"
            >
              why {showWhy ? "︿" : "⌄"}
            </button>
          )}
        </div>
      )}
      {showWhy && s.why !== null && <p className="mt-1 text-xs opacity-70">{s.why}</p>}

      {s.outcomeNote !== null && (
        <blockquote className="mt-1.5 border-l-2 border-neutral-300 pl-3 text-sm dark:border-neutral-700">
          “{s.outcomeNote}”
        </blockquote>
      )}

      {node.children.length > 0 && (
        <div className="mt-2 space-y-1 divide-y divide-neutral-200 border-l-2 border-neutral-200 pl-4 dark:divide-neutral-800 dark:border-neutral-800">
          {node.children.map((child) => (
            <SessionRow key={child.session.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayGroup({ nodes }: { nodes: SessionNode[] }) {
  return (
    <div>
      {nodes.map((node, i) => (
        <div
          key={node.session.id}
          className={i > 0 ? "border-t border-neutral-200 dark:border-neutral-800" : ""}
        >
          <SessionRow node={node} />
        </div>
      ))}
    </div>
  );
}

function WeekSection({ week }: { week: WeekGroup }) {
  const summary = summarize(week.nodes);
  const today = localDateKey(new Date());
  const yesterday = addDays(today, -1);
  const days = groupByDay(week.nodes);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{formatWeekOf(week.weekStart)}</h2>
        <span className="shrink-0 text-xs opacity-60">
          {formatDuration(summary.focusedMs)} focused · {summary.sessionCount} sessions ·{" "}
          {summary.interruptCount} interrupts
        </span>
      </div>
      <div className="mt-2 border-t-2 border-neutral-900 dark:border-neutral-100" />

      <div className="mt-4 space-y-5">
        {days.map((day) => {
          const daySummary = summarize(day.nodes);
          return (
            <div key={day.dateKey}>
              <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200 pb-1 text-xs font-medium uppercase tracking-wide opacity-60 dark:border-neutral-800">
                <span>{dayLabel(day.dateKey, today, yesterday)}</span>
                <span>{formatDuration(daySummary.focusedMs)} focused</span>
              </div>
              <DayGroup nodes={day.nodes} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Loading / empty / error states (item A) ────────────────────────────────

/** Week/day-SHAPED placeholders, not a spinner — disambiguates loading from
 * empty (Research Basis R6). No shimmer: the perceived-speed claim is
 * contested, so this rests on disambiguation alone. */
function LogSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {[0, 1].map((week) => (
        <div key={week} className="space-y-3">
          <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-0.5 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
          {[0, 1].map((day) => (
            <div key={day} className="space-y-2">
              <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-10 w-full rounded bg-neutral-100 dark:bg-neutral-900" />
              <div className="h-10 w-full rounded bg-neutral-100 dark:bg-neutral-900" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function LogPage() {
  const {
    data,
    error,
    isLoading,
    mutate: retry,
  } = useLive<{ weeks: WeekGroup[] }>("sessions", () =>
    api.get<{ weeks: WeekGroup[] }>("/api/sessions?limit=100"),
  );

  const [olderWeeks, setOlderWeeks] = useState<WeekGroup[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const weeks = mergeWeeks(data?.weeks ?? [], olderWeeks);

  async function loadOlder() {
    const flat = flattenTree(weeks.flatMap((w) => w.nodes));
    if (flat.length === 0) return;
    const oldest = flat.reduce((min, n) =>
      Date.parse(n.session.startedAt) < Date.parse(min.session.startedAt) ? n : min,
    );

    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await api.get<{ weeks: WeekGroup[] }>(
        `/api/sessions?limit=100&before=${encodeURIComponent(oldest.session.startedAt)}`,
      );
      if (page.weeks.length === 0) setExhausted(true);
      setOlderWeeks((prev) => [...prev, ...page.weeks]);
    } catch {
      setOlderError("Could not load older weeks.");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Log</h1>

      {isLoading && <LogSkeleton />}

      {!isLoading && error !== undefined && (
        <div className="rounded-lg border border-red-300 p-4 text-sm dark:border-red-800">
          <p className="text-red-700 dark:text-red-400">Could not load the log.</p>
          <button
            type="button"
            className="mt-2 text-xs underline"
            onClick={() => void retry()}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && error === undefined && weeks.length === 0 && (
        <p className="text-sm opacity-60">No sessions yet. The log begins at the first one.</p>
      )}

      {!isLoading && error === undefined && weeks.length > 0 && (
        <>
          <div className="space-y-8">
            {weeks.map((week) => (
              <WeekSection key={week.weekStart} week={week} />
            ))}
          </div>

          {!exhausted && (
            <div className="flex flex-col items-center gap-2">
              <Button variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? "Loading…" : "Load older weeks"}
              </Button>
              {olderError !== null && <p className="text-xs text-red-600">{olderError}</p>}
            </div>
          )}
        </>
      )}
    </main>
  );
}
