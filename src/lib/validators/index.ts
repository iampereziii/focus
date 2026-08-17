/**
 * Zod schemas — every API boundary.
 *
 * The load-bearing one is `startSessionSchema`. Convention #10: `kind` drives
 * everything on Session — validation, DB constraints, gating and the day split
 * all branch on it — so it is modelled as a DISCRIMINATED UNION, never as an
 * optional-fields bag. Three arms. Never a fourth (`drift` is a status, not a
 * kind).
 *
 * The union is the API half of Rules 2 and 3; the DB CHECKs in
 * supabase/migrations/0001_init.sql are the other half. Both exist on purpose —
 * the gate is enforced at the database level, not just in application code.
 */

import { z } from "zod";

/** Non-empty after trimming. A whitespace-only WHY is not a WHY (Rule 2). */
const gateText = z.string().trim().min(1);

/**
 * Rule 26a — the interval is STATED at the gate, never invented by the app.
 * `null` is off, and off is a first-class choice, not a degraded one. The client
 * pre-selects a default so the common path costs zero extra taps; the 20-second
 * gate is not negotiable.
 */
export const checkInIntervalSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
  z.null(),
]);

export const interruptTagSchema = z.enum(["pr", "alert", "dm", "meeting", "other"]);

// ── Topics ────────────────────────────────────────────────────────────────────

/**
 * Created inline from quick capture — ONE FIELD, not a board (Gap 14).
 * `color` is assigned server-side from the fixed palette, `status` defaults to
 * `active`, `why` stays null (Rule 15 deferred). Nothing else is collected: this
 * sits on the friction-critical path.
 */
export const createTopicSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

/**
 * Rule 9 — CAPTURE IS CHEAP. Only `what` + `topicId`.
 * Do not add required fields here. This is the friction-critical path, and the
 * whole project exists because a higher-friction version was abandoned the day
 * it was written.
 */
export const createTaskSchema = z.object({
  what: z.string().trim().min(1).max(200),
  topicId: z.uuid(),
});

export const updateTaskSchema = z
  .object({
    what: z.string().trim().min(1).max(200),
    why: z.string().nullable(),
    finishLine: z.string().nullable(),
    status: z.enum(["backlog", "today", "done", "dropped"]),
    estimateMinutes: z.number().int().positive().nullable(),
  })
  .partial();

// ── Sessions: the gate ────────────────────────────────────────────────────────

/**
 * `kind: 'focus'` — THE GATE. Four fields, not three: WHAT / WHY / FINISH LINE
 * plus the check-in interval (ADR-0001 as amended 2026-08-16).
 *
 * The fourth is nullable by design and NOT DB-enforced — `off` is a legitimate
 * answer. A fourth *required* field is how the ~3-minute gate budget breaks.
 *
 * There is no `plannedMinutes`. Sessions have NO TIMEBOX — the written
 * `finishLine` is the bound (Rule 13, retired).
 */
const startFocusSchema = z.object({
  kind: z.literal("focus"),
  taskId: z.uuid(),
  what: z.string().trim().min(1).max(200),
  why: gateText,
  finishLine: gateText,
  checkInIntervalMinutes: checkInIntervalSchema,
});

/**
 * `kind: 'pulled'` — ungated by design (ADR-0003 Invariant 3). An interrupt
 * cannot be asked for a WHY at the moment it arrives; that is the worst possible
 * moment to demand reflection.
 *
 * `interruptTag` is REQUIRED and costs nothing: the seven-cell grid writes `kind`
 * AND `interruptTag` in ONE gesture (Gap 17a). If the build ends up asking twice,
 * the one-tap budget is broken and assumption A8 is live.
 *
 * `parentSessionId` is OPTIONAL — Rule 19: a PR review at 9am with nothing else
 * open is a valid top-level `pulled` session. Without that, the interrupt metric
 * silently undercounts the days that were entirely claimed by others.
 *
 * No `checkInIntervalMinutes` field: interrupts INHERIT it from the session they
 * suspend, server-side, inside the suspend transaction (Rule 26f). A parentless
 * `pulled` gets null. Accepting one from the client would be the app inventing a
 * number, which 26a forbids.
 */
const startPulledSchema = z.object({
  kind: z.literal("pulled"),
  what: z.string().trim().min(1).max(200),
  interruptTag: interruptTagSchema,
  parentSessionId: z.uuid().nullable().optional(),
});

/**
 * `kind: 'filler'` — requires a parent AND an expected wait (Rule 18).
 * The wait is one tap: 2 / 5 / 10 / 30 minutes. Without a return prompt, `filler`
 * is parallel work wearing a tag — if the prompt cannot be built, ADR-0003 says
 * cut the category and fold it into `pulled`.
 */
export const fillerWaitMinutesSchema = z.union([
  z.literal(2),
  z.literal(5),
  z.literal(10),
  z.literal(30),
]);

const startFillerSchema = z.object({
  kind: z.literal("filler"),
  what: z.string().trim().min(1).max(200),
  parentSessionId: z.uuid(),
  waitMinutes: fillerWaitMinutesSchema,
});

/** THE discriminated union. Three arms. A fourth would propagate everywhere. */
export const startSessionSchema = z.discriminatedUnion("kind", [
  startFocusSchema,
  startPulledSchema,
  startFillerSchema,
]);

export type StartSessionInput = z.infer<typeof startSessionSchema>;

// ── Sessions: close-out and dispositions ──────────────────────────────────────

/**
 * Close-out only: `status` + `outcomeNote`. Rule 5 — once `endedAt` is set, NO
 * field may change, including the outcome note. A tidied log is a useless log.
 *
 * `active` and `suspended` are absent on purpose: this endpoint closes, it does
 * not reopen.
 */
export const closeSessionSchema = z.object({
  status: z.enum(["done", "partial", "switched", "drifted", "abandoned"]),
  outcomeNote: z.string().trim().max(1000).nullable(),
});

/**
 * Rules 16/17 — settle the live child and hand the parent back, in one
 * transaction. Posted to the PARENT's id; the child is found by the RPC.
 *
 * `childStatus` carries the SAME five members as `closeSessionSchema.status`,
 * because closing an interrupt and closing a root session are the same act with
 * different consequences. `drifted` in particular has to be here: the check-in
 * probe can settle a child that way, and a drifted interrupt must still return the
 * session it suspended (Rule 16 — drift is a status, not a kind).
 *
 * `active` and `suspended` stay out, exactly as they do above. This endpoint
 * resumes ONE named parent; it does not reopen arbitrary rows.
 *
 * Whole-body default: the common path posts nothing at all and means "settle as
 * `partial`, no note" — one tap, which is the budget an interrupt's end has.
 */
export const resumeSessionSchema = z
  .object({
    childStatus: z
      .enum(["done", "partial", "switched", "drifted", "abandoned"])
      .default("partial"),
    childOutcomeNote: z.string().trim().max(1000).nullable().default(null),
  })
  .default({ childStatus: "partial", childOutcomeNote: null });

/**
 * Rule 18 / Gap 17b — PROMOTION IS THE GATE, not an escape hatch from it.
 * 422 without `why` and `finishLine`.
 *
 * Gap 26: promotion does NOT relabel anything. One transaction, four effects:
 * close the filler `switched`, create the Task (topic defaults to Inbox), INSERT
 * a new `focus` session parented to the closed filler, and close the GRANDPARENT
 * with `grandparentStatus`. No row's `kind` is ever mutated.
 *
 * `checkInIntervalMinutes` is pre-selected from the filler's inherited value
 * (Rule 26f) — present on the form so the new focus session is gated like any
 * other (Rule 26a), but costing zero extra taps on the common path.
 */
export const promoteSessionSchema = z.object({
  why: gateText,
  finishLine: gateText,
  checkInIntervalMinutes: checkInIntervalSchema,
  grandparentStatus: z.enum(["partial", "abandoned"]).default("partial"),
  topicId: z.uuid().optional(),
});

// ── Rule 26: the check-in probe ───────────────────────────────────────────────

/**
 * "Still on <what>?" → Yes / Done / I drifted.
 *
 * The app ASKS; it never decides (26b). An IGNORED prompt changes nothing about
 * the session — no close, no status change, no classification. It changes only a
 * derived figure at review, where it shows as a bare fact.
 *
 * Every prompt writes a CheckIn row, answered or not (26e).
 */
export const answerCheckInSchema = z.object({
  answer: z.enum(["yes", "done", "drifted"]),
});

// ── Push ──────────────────────────────────────────────────────────────────────

/**
 * The subscription behind BOTH prompt rules — 18 and 26 — served by ONE
 * implementation. A second push code path is a bug.
 */
export const pushSubscribeSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
