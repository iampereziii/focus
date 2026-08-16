/**
 * `lib/store/` — THE SINGLE WRITE PATH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FOLDER EXISTS
 *
 * ADR-0002 defers offline sync out of v1 and calls the deferral REVERSIBLE. The
 * entire basis for that claim is this seam: every read and write funnels through
 * here, so a local write queue can be added later without touching a single
 * component. A Supabase call anywhere else voids the argument.
 *
 * The ESLint guardrail in eslint.config.mjs makes that a build failure rather
 * than a convention. Never `eslint-disable` it to unblock a task.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT GOES HERE (as the build proceeds — one module per aggregate):
 *
 *   topics.ts    listTopics, createTopicByName  → GET/POST /api/topics
 *                `color` is assigned from PALETTE below; never picked by the
 *                user in v1 (Gap 14). Called inline from quick capture — it must
 *                not open a screen or add a step to the capture path.
 *
 *   tasks.ts     listTasks, createTask, updateTask
 *                Rule 9: create requires ONLY `what` + `topicId`.
 *
 *   sessions.ts  startSession, closeSession, suspendAndStartInterrupt,
 *                resumeSession, rearmFiller, promoteFiller, correctKind
 *
 *                ⚠️ THE TRANSACTIONAL PATHS LIVE HERE AND ARE THE HIGHEST-RISK
 *                CODE IN THE APP. `suspendAndStartInterrupt` moves the parent to
 *                `suspended` AND starts the child `active` in ONE transaction
 *                (Rule 16) — a partial failure leaving zero or two `active` rows
 *                violates Rule 1 and must roll back. `promoteFiller` has four
 *                effects in one transaction (Rule 18 / Gap 17b) and NEVER
 *                mutates a `kind` (Gap 26) — it closes the filler `switched`
 *                and INSERTS a new `focus` row parented to it. Both need
 *                explicit integration tests, not unit tests.
 *
 *                Rule 26f: the child COPIES `checkInIntervalMinutes` from the
 *                parent inside that same transaction — copied, not read through,
 *                so correcting the parent later never rewrites the child. A
 *                parentless `pulled` gets null.
 *
 *   checkins.ts  recordPrompt, recordAnswer  → Rule 26e, one row per prompt,
 *                answered or not.
 *
 *   push.ts      upsertSubscription, listSubscriptions, dropStale
 *                ONE implementation serves Rule 18 AND Rule 26. If you are
 *                writing a second push code path, stop (Rule 26c).
 *
 * WHAT NEVER GOES HERE: judgment. Derived quantities — focused time, the day
 * split, counts, date math — are computed in `lib/facts/`, which is pure and has
 * no I/O. `store` fetches rows; `facts` derives numbers from them.
 *
 * WHAT NEVER GOES HERE, PART 2: a delete path for sessions. Rule 14 — the log is
 * append-only, there is no delete endpoint, and the migration deliberately grants
 * no delete policy. A mistaken session is closed `abandoned` with a note.
 *
 * AND: nothing that closes a session the architect did not close. No timeout, no
 * cron, no cleanup job, no "stale session" sweep (Rule 7, Convention #9).
 */

export * from "./mappers";

/**
 * The fixed topic palette. `POST /api/topics` cycles this — the user never picks
 * a colour in v1, because there is no topic editor (Gap 14). Index by
 * `topicCount % PALETTE.length`.
 */
export const PALETTE = [
  "#64748b", // slate — seeded 'Inbox' takes this one (supabase/seed.sql)
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
] as const;
