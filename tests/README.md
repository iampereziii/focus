# Tests — what is covered, and what is not

**Status 2026-08-17:** 84 tests, 4 files, all passing. `npm run build`,
`npm run lint` and `tsc --noEmit` are clean.

---

## What these tests cover

| File | Covers |
|---|---|
| `validators.test.ts` | Every API boundary schema. The discriminated union on `kind` — three arms, never a fourth. |
| `facts.test.ts` | `durationMs`, `unansweredWindows`, `stackDepth`, `splitBalances`, `dayWallTimeMs`. |
| `day-split.test.ts` | Interval arithmetic, `focusedTimeMs` (Rule 22), the five-bucket split incl. **the Gap 21 balance fixture**, `driftCapturePaths` (Rule 25 job 4, both halves), `focusInterruptRatio`, `groupByWeek` (log tree + promotion continuity). |
| `guardrails.test.ts` | ADR-0002's two lint rules, the schema's shape (5 tables, RLS predicate, no owner column, `kind` immutability with no exception, no delete policy on sessions), seed = reference data only, and **Rule 7**. |

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
| **16, 17** | Suspend + start is ONE transaction — a forced mid-way failure leaves **exactly one** `active` row, never zero or two. This is named in the spec as the highest-risk write path in the app. |
| **18** | The 4th re-arm returns 409, and `rearmCount` survives a reload / restart / device switch. A cap that silently resets reads as working, which is worse than no cap. |
| **20** | Depth 3+ warns and is never blocked. |
| **21** | A second `kind` correction returns 409; the original `kind` is unchanged; **any** `kind` UPDATE is rejected by the trigger. |
| **23** | `/review` refuses to complete while any session is still `suspended` and undisposed. |
| **26f** | An interrupt inherits `checkInIntervalMinutes` from the session it suspended, copied in the same transaction, transitive at depth 2 — and editing the parent later does **not** rewrite the child. |
| **RLS** | The anon key reads nothing from any of the five tables while signed out. |

The plpgsql functions in `supabase/migrations/0002_session_transactions.sql`
carry these guarantees. Reviewing that file is not a substitute for testing it.

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

If a future change needs any of these relaxed, that is an ADR question, not a
commit.
