"use client";

/**
 * `/review` — THE DAY CLOSE. Five jobs.
 *
 * ADR-0003 flags this screen as the design's bottleneck, and A12 is the bet that
 * it actually happens. Its own Revisit Trigger fires if the review is skipped 3+
 * days in a week.
 *
 * ⚠️ IF THIS SCREEN HAS TO BE CUT DOWN, CUT JOB 1 FIRST (stack disposal — the
 * newest), NEVER THE REVIEW ITSELF. ADR-0003 makes that ordering explicit.
 *
 * The app STATES FACTS; the architect does the reading. No interpretation, no
 * blocking, no extra questions. Reclassification is offered and NEVER forced —
 * forcing a classification the architect cannot recall manufactures data.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Input, formatDuration } from "@/components/ui";
import type { Session } from "@/types/db";

type Bucket = "focused" | "pulled" | "filler" | "drift" | "unaccounted";

interface ReviewPayload {
  day: string;
  suspended: Session[];
  uncorrected: Session[];
  split: Record<Bucket, number>;
  coveredWallTimeMs: number;
  dayWallTimeMs: number;
  balances: boolean;
  drift: {
    byTap: number;
    byProbe: number;
    byCorrection: number;
    sessionsArmed: number;
    sessionsTotal: number;
    promptsAnswered: number;
    promptsTotal: number;
  };
  ratio: { focus: number; interrupt: number };
  promptReachable: boolean;
}

const BUCKETS: Bucket[] = ["focused", "pulled", "filler", "drift", "unaccounted"];
const CORRECTIONS = ["focus", "pulled", "filler", "drift", "unaccounted"] as const;

export default function ReviewPage() {
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [cue, setCue] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    void api.get<ReviewPayload>("/api/review/today").then(setData);
  }, []);

  useEffect(load, [load]);

  if (data === null) return <main className="p-6 text-sm opacity-60">Loading…</main>;

  async function dispose(id: string, body: unknown) {
    await api.post(`/api/sessions/${id}/dispose`, body);
    load();
  }

  async function correct(id: string, to: string) {
    await api.patch(`/api/sessions/${id}/kind`, { kindCorrectedTo: to });
    load();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Review — {data.day}</h1>

      {!data.promptReachable && (
        // Rule 18: an empty subscriptions table is a UI STATE, not just an
        // absence. Without it both prompt rules degrade to foreground-only, and
        // the app must say so rather than pretend it is working.
        <p className="rounded-lg border border-amber-400 p-3 text-sm">
          Notifications can&apos;t reach this device, so the check-in probe and the
          filler return prompt only work while the app is open.
        </p>
      )}

      {/* ── Job 1 — stack disposal. Nothing survives the day undecided. ───── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">1 · Suspended sessions</h2>
        {data.suspended.length === 0 ? (
          <p className="text-sm opacity-60">Nothing suspended. The day is clean.</p>
        ) : (
          data.suspended.map((s) => (
            <div key={s.id} className="space-y-2 rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
              <p className="text-sm font-medium">{s.what}</p>
              <Input
                placeholder="Resume cue — “after standup”, not a clock time"
                value={cue[s.id] ?? ""}
                onChange={(e) => setCue({ ...cue, [s.id]: e.target.value })}
              />
              <div className="flex gap-2">
                <Button
                  disabled={(cue[s.id] ?? "").trim() === ""}
                  onClick={() =>
                    void dispose(s.id, {
                      disposition: "resume",
                      resumeCue: cue[s.id],
                      resumePlannedAt: new Date(Date.now() + 86_400_000).toISOString(),
                    })
                  }
                >
                  Resume tomorrow
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void dispose(s.id, { disposition: "partial", outcomeNote: null })}
                >
                  Close partial
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void dispose(s.id, { disposition: "abandon", outcomeNote: null })}
                >
                  Abandon
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* ── Job 2 — kind correction. Write-once, optional, never forced. ──── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">2 · Correct a tap</h2>
        {data.uncorrected.length === 0 ? (
          <p className="text-sm opacity-60">Nothing to review.</p>
        ) : (
          data.uncorrected.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">
                {s.what} <span className="opacity-60">· {s.kind}</span>
              </span>
              {CORRECTIONS.map((c) => (
                <Button key={c} variant="ghost" onClick={() => void correct(s.id, c)}>
                  {c}
                </Button>
              ))}
            </div>
          ))
        )}
        <p className="text-xs opacity-60">
          Optional and one-time. The original tap is never overwritten.
        </p>
      </section>

      {/* ── Job 3 — the day split. Bare facts. ───────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">3 · The day</h2>
        <ul className="space-y-1 text-sm">
          {BUCKETS.map((b) => (
            <li key={b} className="flex justify-between">
              <span className="capitalize opacity-70">{b}</span>
              <span className="font-mono tabular-nums">{formatDuration(data.split[b])}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-60">
          Covered: {formatDuration(data.coveredWallTimeMs)} · span:{" "}
          {formatDuration(data.dayWallTimeMs)}
          {!data.balances && " · ⚠ buckets do not balance"}
        </p>
        <p className="text-xs opacity-60">
          A large unaccounted slice is a finding, not a defect in the log.
        </p>
      </section>

      {/* ── Job 4 — drift capture. BOTH halves, or A9 is unreadable. ──────── */}
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">4 · Drift</h2>
        <p className="font-mono text-sm">
          Drift recorded: {data.drift.byTap + data.drift.byProbe + data.drift.byCorrection} (tap{" "}
          {data.drift.byTap} · probe {data.drift.byProbe} · correction{" "}
          {data.drift.byCorrection})
        </p>
        <p className="font-mono text-sm">
          Check-in probe: armed on {data.drift.sessionsArmed} of {data.drift.sessionsTotal}{" "}
          sessions, answered {data.drift.promptsAnswered} of {data.drift.promptsTotal}
        </p>
      </section>

      {/* ── Job 5 — the ratio. Two lines, no interpretation. ─────────────── */}
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">5 · Balance</h2>
        <p className="font-mono text-sm">Focus sessions: {data.ratio.focus}</p>
        <p className="font-mono text-sm">Interrupt sessions: {data.ratio.interrupt}</p>
      </section>
    </main>
  );
}
