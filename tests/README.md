# Tests — what is covered, and what is not

**Status 2026-08-18:** 125 tests, 8 files, all passing. `npm run build`,
`npm run lint` and `tsc --noEmit` are all clean.

---

## What these tests cover

| File | Covers |
|---|---|
| `validators.test.ts` | Every API boundary schema. The discriminated union on `kind` — three arms, never a fourth. |
| `facts.test.ts` | `durationMs`, `unansweredWindows`, `stackDepth`. |
| `day-split.test.ts` | Interval arithmetic, `focusedTimeMs` (Rule 22), `groupByWeek` (log tree + promotion continuity). |
| `guardrails.test.ts` | ADR-0002's two lint rules, the schema's shape (5 tables, RLS predicate, no owner column, `kind` immutability with no exception, no delete policy on sessions), seed = reference data only, and **Rule 7**. |
| `session-continuity.test.ts` | The log tree's parent/child shape and `lib/session-tree.ts`'s recursive flatten — including the **one-level flatten as an explicit failing case**. Plus `formatElapsed` (the running `mm:ss` clock) and proof `formatDuration` still renders settled durations without seconds. |
| `interrupt-return.test.ts` | `resumeSessionSchema` (incl. `drifted`, and the refusal to reopen), that close-out routes on `parentSessionId` rather than `kind`, that `close_session` stays single-row, that Rule 18's three dispositions are controls rather than prose — and **the dead-endpoint trap**: every `/api/sessions` sub-route must have a caller. |
| `task-completion.test.ts` | `close_session`'s task-done branch is guarded (`kind='focus'` + `task_id` + `p_status='done'` only, not a bare unconditional write); `SessionView.close()` checks `parent.status === 'suspended'`, not just `parentId !== null`, before resuming; `apiFailure()` maps a non-`suspended` resume target to a `409` ahead of the generic `500` fallback; the backlog row's `Drop` action writes `status: 'dropped'` via `PATCH /api/tasks/[id]` and touches no `Session` row. |

`lib/facts/` is pure with no I/O, so all of the derived-number work above is
fully testable from fixtures. That purity is deliberate — it is what makes the
v1.1 AI layer addable without rework, the same way `lib/store/` is the offline
seam.

---

## ⚠️ What is NOT covered here, and why

**The transaction rules are enforced in Postgres and need a live Supabase.**
They cannot be exercised by unit tests, and pretending otherwise would be worse
than the gap. Convention #4 and the Acceptance Criteria both require these to be
**integration**-tested — not unit-tested:

| Rule | What an integration test must prove |
|---|---|
| **1** | The partial unique index rejects a second `active` row. |
| **2, 3** | The DB `CHECK` rejects an empty `why`/`finishLine` on a `focus` row, independent of the API. |
| **5** | A closed session rejects every edit with 409. |
| **16, 17** | Suspend + start is ONE transaction — a forced mid-way failure leaves **exactly one** `active` row, never zero or two. This is named in the spec as the highest-risk write path in the app. **And its mirror:** `resume_session` settles the live child and reactivates the parent in one transaction, so closing an interrupt leaves exactly one `active` row — and a forced failure leaves the child open and the parent suspended, never a closed child with nothing running. |
| **18 (promote)** | `promote_filler`'s four effects are one transaction: filler closed `switched`, Task created, new `focus` row parented to the closed filler, grandparent closed. A partial failure must leave all four untouched. Untestable here for the same reason as the rest — and until 2026-08-17 it had never run at all, because nothing called it. |
| **18** | The 4th re-arm returns 409, and `rearmCount` survives a reload / restart / device switch. A cap that silently resets reads as working, which is worse than no cap. |
| **20** | Depth 3+ warns and is never blocked. |
| **21** | A second `kind` correction returns 409; the original `kind` is unchanged; **any** `kind` UPDATE is rejected by the trigger. |
| **26f** | An interrupt inherits `checkInIntervalMinutes` from the session it suspended, copied in the same transaction, transitive at depth 2 — and editing the parent later does **not** rewrite the child. |
| **RLS** | The anon key reads nothing from any of the five tables while signed out. |
| **task-done-on-close** | `close_session`'s task update commits in the SAME transaction as the session close — a forced mid-way failure must leave both the session and the task exactly as they were, never a `done` task with a still-open session or the reverse. |

The plpgsql functions in `supabase/migrations/0002_session_transactions.sql`
carry these guarantees. Reviewing that file is not a substitute for testing it.

**Also not covered:** `/`'s redirect and the shell's active-session indicator as
*rendered behaviour*. `session-continuity.test.ts` pins the tree shape and the
flatten that broke, which is where the bug actually lived — but that a client
component then navigates on the result is a Playwright assertion, and Playwright
is deferred to v1.1. The residual risk is small and named: the data layer is
covered, the redirect wiring is one line, and the repro is written down.

**Also not covered:** the two timed build-gate measurements — a gated session
started in **under 20 seconds**, and a week reconstructed from `/log` in **under
2 minutes**. Those are measured by hand against the real app (FOCUS-13). The
first one blocks ship.

---

## The Rule 7 guardrail was sharpened, not loosened

`guardrails.test.ts` previously banned `setInterval` anywhere under `src/`. That
is broader than Rule 7, and it forbade two things the same spec requires: Rule
26's probe is a client-side timer by definition, and the spec asks for a running
elapsed display. Being scoped to `.ts`/`.tsx`, it would also have passed a real
server-side sweep written in plain JS.

It now checks the distinction Rule 26d actually rests on — **a timer that asks is
fine; a timer that ends a session is not** — as three tests:

1. **No timer at all** in `src/lib/store/` or `src/app/api/`. That is where an
   unattended background job could live.
2. **No file owns both a timer and a session-ending call.** That adjacency is
   what an auto-close would be built from. It is why the elapsed clock lives in
   `components/ui/useElapsed.ts` and not in `SessionView.tsx`, which can close.
3. **The probe stays interrogative** — `CheckInPrompt.tsx` touches
   `/api/checkins/` and never the session-closing endpoint (Rule 26b).

**Widened again 2026-08-17.** `close_session` was never the only way a row gets an
`ended_at`: `resume_session` settles the live child on its way to reactivating the
parent, and `promote_filler` closes both the filler and the grandparent. Check 2
could not see either, so a timer sitting next to a resume call would have passed.
It now recognises all three. It caught `PromoteForm.tsx` immediately — that file
named a state setter `setInterval`, shadowing the global in a file that ends two
sessions. The setter was renamed rather than the check exempted.

If a future change needs any of these relaxed, that is an ADR question, not a
commit.

---

## The dead-endpoint trap

`interrupt-return.test.ts` ends with a check that has no equivalent elsewhere:
**every `/api/sessions` sub-route must be referenced by something the user can
reach.**

It exists because the bug it was written for was not a wrong line of code — it was
an absent one. `POST /api/sessions/[id]/resume` was correct from the day it was
written: correct transaction, correct store function, correct route, correct
validator. Nothing called it. `promote` was in the same state. Both typechecked,
both linted, both read correctly in review, and neither had ever run.

`tsc` cannot see this. ESLint cannot see this. A reviewer opening the route file
cannot see it either, because the file is right. Only the absence of a caller
gives it away, and absence is what nobody greps for.
