/**
 * Domain types — the shape the app reasons in.
 *
 * NAMING SEAM: Postgres columns are snake_case (see supabase/migrations/);
 * these types are camelCase, matching the project spec's Data Model. The
 * mapping lives in `src/lib/store/` and nowhere else — it is the same seam
 * that makes ADR-0002's offline deferral reversible.
 *
 * Source of truth: ais repo → projects/focus/project-spec.md § Data Model.
 * Nothing here is invented. If a field seems missing, it is a spec question.
 */

// ── Topic ─────────────────────────────────────────────────────────────────────

/** v1: always `active`. Nothing parks or completes a Topic — the board is cut. */
export type TopicStatus = "active" | "parked" | "done";

export interface Topic {
  id: string;
  /** Max 80 chars. The only field the user supplies at capture (Gap 14). */
  name: string;
  /** Always null in v1 — Rule 15 defers with the topic board. */
  why: string | null;
  /** Hex. Assigned server-side from a fixed palette; never picked by the user in v1. */
  color: string;
  status: TopicStatus;
  createdAt: string;
  /** Always null in v1 — nothing archives. */
  archivedAt: string | null;
}

// ── Task ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "today" | "done" | "dropped";

/**
 * ⚠️ `why` / `finishLine` / `checkInIntervalMinutes` ARE PREFILL, NOT THE RECORD.
 *
 * The record is the `Session` row, which snapshots all three at start and never
 * follows a later Task edit (Rule 4). These three columns carry the LAST STATED
 * values forward so a restart opens the gate pre-filled instead of blank
 * (feature-brief-gate-prefill-on-restart.md, 0006). They are read by exactly one
 * thing — `GateForm`'s initial state — and they must never be rendered on `/`,
 * which Rule 12 keeps to title, topic and status.
 *
 * They were permanently null before 0006, so anything written against the
 * assumption that they are always null is now wrong.
 */
export interface Task {
  id: string;
  /** Rule 8: no orphan tasks. Every Task belongs to exactly one Topic. */
  topicId: string;
  /**
   * Max 200 chars. The one field the gate does not re-ask on a restart — it is
   * read-only in existing-task mode (ADR-0004 retired Rule 9's "cheap capture";
   * a Task is now born inside `start_focus_on_new_task`, never before it).
   */
  what: string;
  /** Last stated at the gate, carried forward for the next start (0006). */
  why: string | null;
  finishLine: string | null;
  /**
   * Rule 26a: `null` means `off`, which is a first-class choice. Never coalesce
   * this to a default — doing so re-arms a probe the architect switched off.
   */
  checkInIntervalMinutes: CheckInInterval;
  status: TaskStatus;
  /** Planning aid only. There is no timebox (Rule 13, retired). */
  estimateMinutes: number | null;
  createdAt: string;
  completedAt: string | null;
}

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * EXACTLY THREE MEMBERS. Never a fourth.
 *
 * `drift` is NOT a kind — it is a `status` (`drifted`), a `kindCorrectedTo`
 * value, and a bucket in the five-way day split (Rule 16 / CLAUDE.md #12).
 * Validation, DB constraints, gating and the day split all branch on this,
 * so a fourth arm propagates everywhere.
 */
export type SessionKind = "focus" | "pulled" | "filler";

export type SessionStatus =
  | "active"
  | "suspended"
  | "done"
  | "partial"
  | "switched"
  | "drifted"
  | "abandoned";

/** The claimant axis. Only meaningful when `kind = 'pulled'` (Rule 21). */
export type InterruptTag = "pr" | "alert" | "dm" | "meeting" | "other";

/**
 * Correction targets at day review. Wider than `SessionKind` on purpose:
 * `drift` and `unaccounted` are valid corrections but are not kinds.
 */
export type KindCorrection = SessionKind | "drift" | "unaccounted";

/** Rule 26a: stated at the gate, never invented. `null` = off, and off is first-class. */
export type CheckInInterval = 30 | 60 | 90 | null;

export interface Session {
  id: string;
  /** Required when `kind = 'focus'`; null for interrupts, which are not Tasks (Gap 10). */
  taskId: string | null;
  kind: SessionKind;
  /** Self-referencing. The session this one interrupted. Required for `filler`. */
  parentSessionId: string | null;
  /** Snapshot at start — never follows later Task edits (Rule 4). */
  what: string;
  /** Snapshot. Non-empty enforced at the DB only when `kind = 'focus'` (Rule 2). */
  why: string | null;
  /** Snapshot. Same conditional enforcement as `why` (Rule 3). */
  finishLine: string | null;
  startedAt: string;
  /** Null = still open. Rule 7: never auto-closed, however long it runs. */
  endedAt: string | null;
  status: SessionStatus;
  /** Non-null ⇒ the suspension is an external wait. Drives Rule 18's return prompt. */
  expectedResumeAt: string | null;
  /** Required for `pulled`, null otherwise. Written by the same tap as `kind` (Gap 17a). */
  interruptTag: InterruptTag | null;
  /** Write-once, day review only. The original `kind` is NEVER overwritten (Rule 21). */
  kindCorrectedTo: KindCorrection | null;
  kindCorrectedAt: string | null;
  /** Event-phrased resume plan — preferred over a clock time (Rule 23). */
  resumeCue: string | null;
  /** The day/slot this pins to the top of `/`. Fires NOTHING — passive placement only. */
  resumePlannedAt: string | null;
  /** App interaction, not OS activity. Arms the Rule 26 probe. */
  lastInteractionAt: string;
  /**
   * Rule 26a: chosen at the gate from 30/60/90/off.
   * Rule 26f: interrupts INHERIT this from the session they suspended, copied in
   * the same transaction as the suspend. A parentless `pulled` gets null.
   */
  checkInIntervalMinutes: CheckInInterval;
  /** The one closing line. Immutable once set (Rule 5). */
  outcomeNote: string | null;
  /**
   * Rule 18's re-arm cap (Gap 25). The 4th re-arm returns 409 and the UI must
   * present a forced disposition — never an auto-close (Rule 7).
   *
   * Stored rather than derived or client-side: the cap has to survive a reload
   * and a device switch, and the tally is the evidence A10 needs at the
   * 2026-09-05 checkpoint ("do filler waits routinely run long?" → cut `filler`).
   */
  rearmCount: number;
}

// ── CheckIn (plumbing) ────────────────────────────────────────────────────────

export type CheckInAnswer = "yes" | "done" | "drifted";

/**
 * One row per Rule 26 prompt, ANSWERED OR NOT (Rule 26e).
 * An unanswered row marks `promptedAt` → the next answer (or close) as an
 * `unaccounted` window that Rule 22 subtracts from focused time. That is the
 * honest-number machinery.
 */
export interface CheckIn {
  id: string;
  sessionId: string;
  promptedAt: string;
  /** Null = never answered. This is the field that matters. */
  answeredAt: string | null;
  answer: CheckInAnswer | null;
}

// ── PushSubscription (plumbing) ───────────────────────────────────────────────

/**
 * Rows are devices, not people — single user, no relationships.
 * An EMPTY table is a UI state, not just an absence: without a subscription,
 * Rules 18 and 26 cannot reach the user while the app is backgrounded (which is
 * their normal state), and Rule 18 requires the app to SURFACE that.
 */
export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
  lastSeenAt: string;
}
