/**
 * The snake_case ↔ camelCase boundary.
 *
 * Postgres columns are snake_case (supabase/migrations/); the app reasons in
 * camelCase (src/types/db.ts). This file is the ONLY place that knows both, and
 * it lives inside `lib/store/` because that is the single write path — the same
 * seam ADR-0002's offline deferral is reversible behind.
 *
 * Rows come back from supabase-js as `unknown`-shaped records. Convention #3
 * forbids `any`, so every mapper narrows explicitly.
 */

import type {
  CheckIn,
  CheckInAnswer,
  CheckInInterval,
  InterruptTag,
  KindCorrection,
  PushSubscriptionRecord,
  Session,
  SessionKind,
  SessionStatus,
  Task,
  TaskStatus,
  Topic,
  TopicStatus,
} from "@/types/db";

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const v = row[key];
  if (typeof v !== "string") {
    throw new TypeError(`Expected string at column "${key}", got ${typeof v}`);
  }
  return v;
}

function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    throw new TypeError(`Expected string|null at column "${key}", got ${typeof v}`);
  }
  return v;
}

function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v !== "number") {
    throw new TypeError(`Expected number at column "${key}", got ${typeof v}`);
  }
  return v;
}

function numOrNull(row: Row, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number") {
    throw new TypeError(`Expected number|null at column "${key}", got ${typeof v}`);
  }
  return v;
}

/**
 * Rule 26a: the interval is stated at the gate, never invented. A value outside
 * the stated set means something wrote one the architect never chose, so this
 * throws rather than rounding it to the nearest legal option.
 *
 * ONE narrowing serves both `sessions` and `tasks`. The tasks column arrived in
 * 0006 carrying the same three values plus null-means-`off`, and a second copy
 * of this check is how the two drift — the same "one implementation serves
 * both" argument the push path is held to.
 *
 * `null` is returned as `null`, never defaulted. `?? 60` here would un-choose
 * `off` on every read.
 */
function checkInInterval(row: Row, key: string): CheckInInterval {
  const v = numOrNull(row, key);
  if (v !== null && v !== 30 && v !== 60 && v !== 90) {
    throw new TypeError(`Unexpected ${key} "${v}" (Rule 26a)`);
  }
  return v;
}

/** Narrows a DB enum column against the TS union that mirrors it. */
function enumOf<T extends string>(row: Row, key: string, members: readonly T[]): T {
  const v = str(row, key);
  if (!(members as readonly string[]).includes(v)) {
    throw new TypeError(`Unexpected value "${v}" at enum column "${key}"`);
  }
  return v as T;
}

function enumOrNull<T extends string>(
  row: Row,
  key: string,
  members: readonly T[],
): T | null {
  const v = strOrNull(row, key);
  if (v === null) return null;
  if (!(members as readonly string[]).includes(v)) {
    throw new TypeError(`Unexpected value "${v}" at enum column "${key}"`);
  }
  return v as T;
}

const TOPIC_STATUSES = ["active", "parked", "done"] as const satisfies readonly TopicStatus[];
const TASK_STATUSES = [
  "backlog",
  "today",
  "done",
  "dropped",
] as const satisfies readonly TaskStatus[];
/** Three members. Never a fourth — see src/types/db.ts. */
const SESSION_KINDS = ["focus", "pulled", "filler"] as const satisfies readonly SessionKind[];
const SESSION_STATUSES = [
  "active",
  "suspended",
  "done",
  "partial",
  "switched",
  "drifted",
  "abandoned",
] as const satisfies readonly SessionStatus[];
const INTERRUPT_TAGS = [
  "pr",
  "alert",
  "dm",
  "meeting",
  "other",
] as const satisfies readonly InterruptTag[];
const KIND_CORRECTIONS = [
  "focus",
  "pulled",
  "filler",
  "drift",
  "unaccounted",
] as const satisfies readonly KindCorrection[];
const CHECK_IN_ANSWERS = [
  "yes",
  "done",
  "drifted",
] as const satisfies readonly CheckInAnswer[];

export function toTopic(row: Row): Topic {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    why: strOrNull(row, "why"),
    color: str(row, "color"),
    status: enumOf(row, "status", TOPIC_STATUSES),
    createdAt: str(row, "created_at"),
    archivedAt: strOrNull(row, "archived_at"),
  };
}

export function toTask(row: Row): Task {
  return {
    id: str(row, "id"),
    topicId: str(row, "topic_id"),
    what: str(row, "what"),
    why: strOrNull(row, "why"),
    finishLine: strOrNull(row, "finish_line"),
    // Prefill for the NEXT start, not the record (0006). See src/types/db.ts.
    checkInIntervalMinutes: checkInInterval(row, "check_in_interval_minutes"),
    status: enumOf(row, "status", TASK_STATUSES),
    estimateMinutes: numOrNull(row, "estimate_minutes"),
    createdAt: str(row, "created_at"),
    completedAt: strOrNull(row, "completed_at"),
  };
}

export function toSession(row: Row): Session {
  return {
    id: str(row, "id"),
    taskId: strOrNull(row, "task_id"),
    kind: enumOf(row, "kind", SESSION_KINDS),
    parentSessionId: strOrNull(row, "parent_session_id"),
    what: str(row, "what"),
    why: strOrNull(row, "why"),
    finishLine: strOrNull(row, "finish_line"),
    startedAt: str(row, "started_at"),
    endedAt: strOrNull(row, "ended_at"),
    status: enumOf(row, "status", SESSION_STATUSES),
    expectedResumeAt: strOrNull(row, "expected_resume_at"),
    interruptTag: enumOrNull(row, "interrupt_tag", INTERRUPT_TAGS),
    kindCorrectedTo: enumOrNull(row, "kind_corrected_to", KIND_CORRECTIONS),
    kindCorrectedAt: strOrNull(row, "kind_corrected_at"),
    resumeCue: strOrNull(row, "resume_cue"),
    resumePlannedAt: strOrNull(row, "resume_planned_at"),
    lastInteractionAt: str(row, "last_interaction_at"),
    checkInIntervalMinutes: checkInInterval(row, "check_in_interval_minutes"),
    outcomeNote: strOrNull(row, "outcome_note"),
    rearmCount: num(row, "rearm_count"),
  };
}

export function toCheckIn(row: Row): CheckIn {
  return {
    id: str(row, "id"),
    sessionId: str(row, "session_id"),
    promptedAt: str(row, "prompted_at"),
    answeredAt: strOrNull(row, "answered_at"),
    answer: enumOrNull(row, "answer", CHECK_IN_ANSWERS),
  };
}

export function toPushSubscription(row: Row): PushSubscriptionRecord {
  return {
    id: str(row, "id"),
    endpoint: str(row, "endpoint"),
    p256dh: str(row, "p256dh"),
    auth: str(row, "auth"),
    createdAt: str(row, "created_at"),
    lastSeenAt: str(row, "last_seen_at"),
  };
}
