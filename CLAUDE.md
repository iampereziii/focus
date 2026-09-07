# CLAUDE.md — Focus

## Purpose

A personal focus app that encodes one specific thinking framework — **WHAT → WHY → FINISH LINE** — as the mechanism for starting work, not as optional metadata. You cannot begin a work session without stating what you're doing, why it matters, and what "done" looks like. Every session produces a permanent log entry, so "what did you do?" is answerable by reading rather than remembering.

- **Client:** Personal — single user, no multi-tenancy, no sharing
- **Primary users:** The owner, solo
- **Core goal — one gate, one verdict:** the **build gate** is that starting a gated session takes under 20 seconds and any week's work is reconstructable from the log in under 2 minutes. That is the friction guard, and it blocks ship. The **verdict** is whether unfinished work feels like it can wait tomorrow without consequences — judged after real use, not tested. A build that passes the gate and fails the verdict has failed.

**The behavioural contract lives outside this repo:** [ADR-0001 in the `ais` repo](../ais/projects/focus/decisions/adr-0001-single-task-sessions-gated-by-what-why-finish-line.md). Business Rules 1–7 in the [project spec](../ais/projects/focus/project-spec.md) are that contract in code form. If a change would make single-threading optional or the WHY skippable, **stop** — that's not a feature decision, it breaks the ADR and needs a superseding one.

---

## Stack

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| Frontend | Next.js | 16.x, App Router |
| Backend | Route Handlers + Server Actions | No separate API service |
| Database | Supabase (Postgres) | `@supabase/supabase-js` v2. **RLS on every table, predicate `auth.uid() IS NOT NULL` — no owner column anywhere** |
| Auth | Supabase Auth | Magic link, single user |
| ~~AI~~ | — | **No AI in v1.** No SDK, no `lib/ai/`, no API key, no model call anywhere. Deferred to v1.1. |
| Infra | Vercel | |
| Styling | Tailwind CSS | v4 |
| Validation | Zod | v4 — every API boundary |
| Testing | Vitest | Playwright deferred to v1.1 |
| Package manager | npm | |
| Language | TypeScript | strict, no `any` |

**Online-only in v1.** No offline sync, no write queue, no precache, no offline shell. Installable PWA, but the network is assumed — writes fail loudly rather than optimistically. Decided in [ADR-0002](../ais/projects/focus/decisions/adr-0002-online-only-pwa-single-write-path.md); `lib/store/` is the single seam that keeps it reversible.

**One exception, and it is narrow: `public/sw.js` is a push-only service worker.** It contains a `push` handler and a `notificationclick` handler — that is all it may ever contain. It exists to fire **both** prompt rules: the `filler` return prompt (Rule 18), which ADR-0003 calls *"the entire protection,"* and the check-in prompt (Rule 26), which is the more frequent of the two. **One implementation serves both — a second push code path is a bug.** **It must never gain a `fetch` handler.** A `fetch` handler is not an optimisation, a caching win, or a performance fix — it is a reversal of ADR-0002, and it needs a new ADR rather than a commit. This is lint-enforced.

---

## Structure

```
focus/
  src/
    app/
      (app)/
        page.tsx              # Home — UNFINISHED work, grouped by topic (Rule 12, re-scoped by ADR-0004)
        session/[id]/page.tsx # Active session: timer, interrupt tap, close-out
        log/page.tsx          # Sessions grouped by week, interrupts nested
      api/
        topics/               # GET list + POST create-by-name (inline from capture)
        tasks/ sessions/
        sessions/[id]/resume/ rearm/ promote/
        push/subscribe/       # Push subscription for Rules 18 + 26
      manifest.ts
    components/
      ui/                     # Primitives
      capture/                # QuickCapture — now the GATE itself (ADR-0004); the friction-critical path
      session/ interrupt/ review/ log/
    lib/
      store/                  # SINGLE write path — all mutations go here
      facts/                  # Deterministic fact computation (no AI, no writes)
      validators/ supabase/
    types/
  public/sw.js                # PUSH-ONLY service worker — no fetch handler, ever
  supabase/migrations/
  tests/
  eslint.config.mjs           # Ships in the scaffold commit — carries both guardrails
  .env.example
```

**Five tables:** `Topic`, `Task`, `Session` (the domain model) plus `CheckIn` and `PushSubscription` (plumbing — no business rules, no views).

**Not in v1, and not to be scaffolded:** `lib/ai/`, `api/plan/today/`, **`topics/` *pages or components***, a `DailyPlan` table, a `Pomodoro` table or timer ring. Each was cut or deferred deliberately on 2026-08-16 — if a task seems to need one, it's a spec question, not a missing folder. **Note the one exception in that list: `api/topics/` *does* exist.** The topic *board* is cut; topic *creation* survives, inline in quick capture, one field and no screen — so don't delete the API route while removing the pages.

---

## Conventions

### Git
- Branch naming: `feat|fix|chore/<short-description>` — no ticket numbers, personal project
- PRs target: `main`
- Commit style: free-form, imperative mood

### Code Style
- TypeScript strict — `tsc --noEmit` must pass
- No `any` — use `unknown` + type guards
- ESLint via `npm run lint` before pushing
- Prefer server components; `'use client'` only where interactivity demands it, with a comment saying why
- **Density goes through the `compact` variant** declared once in `globals.css` (`max-width: 520px`, `max-height: 800px`) — never a per-component media query or a `sm:`/`md:` width breakpoint. The app is used in a small, frequently-resized window, and the 800 px arm is a measured, decided number. **`compact:` may only change how a fact looks, never whether it is there:** `compact:hidden` occurs exactly once in the whole tree (the WHY on the session screen, shipped with its reveal) and `compact-density.test.ts` counts it. Anything pressable carries `tap`, which holds a 40 px floor on `(pointer: coarse)` — that floor is ADR-0003's one-tap budget, not a style. **The compact type ramp is four sizes with a 12 px floor** — `text-xs` (12, labels/meta/hints) · `text-[0.8125rem]` (13, body, rows, controls) · `text-[0.9375rem]` (15, screen and session titles) · `text-xl` (20, the clock). Nothing below 12 px, and a fifth size is a regression — `compact-density.test.ts` enumerates the set. Buy height from layout, never from type: shaving type is what produced seven sizes and a 10 px floor the first time. **Colour is `Topic.color` and nothing else** — `globals.css` declares eight neutral custom properties and a ninth is the accent token this repo decided not to have. The scratch pad's tint is that same hue carrying that same meaning (which topic this belongs to), which is why it was allowed; an interrupt has no task, so no topic, and falls back to the neutral spine

### Naming
- Components: `PascalCase` · Hooks: `useCamelCase` · Utilities: `camelCase` · Files: `kebab-case`
- API routes: RESTful, plural nouns

### Testing
- Unit + integration: Vitest — `npm test`
- **All 23 v1 business rules need at least one test.** Rules 1–7 are the ADR-0001 contract, Rules 16–25 are the ADR-0003 interruption model, and Rule 26 is the check-in probe — **all three sets integration-tested**, not just unit-tested. Rules 16, 17, 18, 23 and 26f touch the suspend/resume transaction and are the highest-risk paths in the app. *(Numbering runs to 26: Rule 13 is retired, Rules 10 and 15 are deferred — build and test nothing for those three.)*

---

## Key Integrations

| Integration | Purpose | Notes |
|-------------|---------|-------|
| Supabase | Postgres + Auth | Anon key is client-safe (RLS enforced). **Service role key is server-only.** |
| Web Push | Fires Rule 18's `filler` return prompt **and Rule 26's check-in** | The **only** reason a service worker exists — and **one implementation serves both rules**; a second push code path is a bug. Requires OS notification permission, and the app must **surface** whether the prompt can actually reach the user, because a declined permission silently degrades both rules to foreground-only. |
| Vercel | Hosting | |

*(No OpenAI integration in v1 — the AI layer is deferred.)*

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client-safe anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Never in client code. |
| `NEXT_PUBLIC_SITE_URL` | No | Origin the magic link returns to (`/auth/callback`). Defaults to the deployed app, `https://focus-blue-psi.vercel.app` — a `localhost` origin is unreachable from the mail client that opens the link. Must be allow-listed in Supabase Auth → URL Configuration. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Yes | Web Push signing for **both** prompt rules — 18 (`filler` return) and 26 (check-in). Private key server-only. |

**No `OPENAI_*` variables in v1** — don't add them to `.env.example`; they return with the v1.1 AI layer.

Copy `.env.example` → `.env.local`. Never commit `.env.local`.

---

## How to Engage

1. **The gate is not negotiable.** A session cannot start without a non-empty `why` and `finishLine`, and only one session may be `active` at a time. These are enforced at the database level (CHECK constraints + a partial unique index), not just in application code. If a change requires relaxing them, that's an ADR conversation, not a code change.
   **The gate form has four fields, not three** — WHAT / WHY / FINISH LINE plus `checkInIntervalMinutes` (ADR-0001, amended 2026-08-16). The fourth is **nullable by design and not DB-enforced**: `off` is a legitimate answer, and a parentless `pulled` gets `null`. Pre-select it to a default so the common path costs zero extra taps — the gate is budgeted at ~3 minutes total and a fourth *required* field is how that budget breaks.

2. **There is one door, and it is the gate** (Rule 9 retired by [ADR-0004](../ais/projects/focus/decisions/adr-0004-starting-is-the-only-way-in.md), 2026-08-20). This used to read *"capture is cheap; starting is gated"* — creating a task needed only `what` + `topicId`, and starting it was a second act. It isn't any more: **`⌘K` opens the gate itself**, and a Task is created only inside `start_focus_on_new_task`, in the same transaction as its Session. Nothing enters this app un-started, because the architect's backlog lives in a different tool and an un-started task here was only ever a start that didn't happen.
   **What did NOT change, and is still the whole point:** the sheet must open in **under 150 ms**, it must be reachable by keyboard from **every page**, and the whole start must land inside the **20-second build gate**. The field count is now **five** and that is its ceiling — completion holds from three to six fields and falls past five to seven. A sixth field is not a design tweak, it is the build gate being spent; if the sheet proves heavy, ADR-0004's named fallback is to **chunk it into two steps**, never to re-add an un-gated capture.
   **`⌘K` with a session already running navigates to that session.** It does not open the gate (Rule 1 would only reject it) and it must **never** be rebound to the interrupt grid — that grid is already on the session screen, and from `/log` the chord would aim a one-tap, unconfirmed, irreversible `I drifted` at a session you cannot see.

3. **All writes go through `lib/store/`, and the lint rule that enforces it is not optional.** No Supabase mutation calls in components or route handlers. This is the seam that keeps offline sync addable later without touching the UI. Two ESLint rules guard ADR-0002 and both fail the build: the Supabase client cannot be imported outside `src/lib/store/`, and `public/sw.js` cannot register a `fetch` handler. **Never disable, `eslint-disable`, or route around either rule to unblock a task.** They are not style rules — they are the two constraints the whole "we can add offline later cheaply" argument rests on, and the most likely way they break is an obviously-trivial one-liner added under time pressure by an AI-paired session. If a task appears to require breaking one, stop and flag it as an ADR question.

4. **`lib/facts/` is pure and deterministic.** Date math, counts, the five-bucket day split, derived focused time — computed in code, unit-tested, no I/O beyond reads. If something needs judgment, it isn't a fact. **In v1 it has exactly one consumer: `/api/review/today`.** Keeping it pure is what makes the v1.1 AI layer addable without rework — treat it as a seam, the way `lib/store/` is the offline seam.

5. **There is no AI in v1, and adding one is not a code change.** No SDK, no `lib/ai/`, no API key, no model call. The layer was cut deliberately: the problem is flattening and protection, not ranking, and there is no logged data to rank against yet. If a task looks like it wants a model, it is a v1.1 question. When the layer does return, the guardrail is already decided — **it suggests, it never acts**: nothing may start a session, change a status, or reorder anything without an explicit user action.

6. **Sessions are append-only.** No delete endpoint exists, and none should be added. Closed sessions are immutable — including the outcome note. **Sessions have no timebox** (ADR-0001, amended 2026-08-16 — the `finishLine` is the bound, and `plannedMinutes` no longer exists); an open session is never auto-closed however long it runs, and stays open as evidence. Durations derive from `startedAt` / `endedAt`, never from a client-side running timer — a backgrounded PWA has no guaranteed timer.

7. **`/` shows unfinished work; the session screen shows one thing.** `/` is a **plain list grouped by topic** — title, topic, status, and deliberately **no age or displacement annotations**. Once a session starts, the list collapses out of view and the app shows that one task only. **Single-threading is enforced during the work, not by blinding the user beforehand.** Don't re-add ranking, scoring, or a "recommended next" affordance; that reintroduces the choosing problem the app exists to remove.
   **Re-scoped by ADR-0004 (2026-08-20).** The rendering rules above stand verbatim — what changed is the contents. Since no task can exist without a session, `status = 'backlog'` now means exactly *"started and not finished"*, so the screen was **renamed** ("Unfinished") and **not re-sourced**. **Do not add a "has at least one session" filter** — it was proposed, reviewed and rejected as a no-op that would sit on `/`'s SSR path forever. The *survey before committing* step this rule was built for now happens in the architect's own backlog tool, outside this app; if this screen feels like it's missing something, the missing thing is deliberately somewhere else.

8. **Don't build past the spec.** If it isn't in the spec's Business Rules or Routes, it isn't v1 — flag it rather than adding it.

9. **Surface gaps proactively.** Flag ambiguity rather than guessing, especially where a choice would touch Rules 1–7.

10. **For "what's current best practice" questions** — use WebSearch. Training knowledge goes stale on this stack.

11. **Interrupts suspend; they don't close.** A `pulled` or `filler` session moves its parent to `suspended` and starts as its child **in one transaction** — exactly one row is `active` at all times, and a partial failure that leaves zero or two must roll back. This is the highest-risk write path in the app and needs an explicit integration test. Classifying an interrupt is budgeted at **one tap** (two for `filler`); anything more is friction at the worst possible moment and the model fails on adoption. That budget is why the tap is a **seven-cell grid** that writes `kind` *and* `interruptTag` in one gesture — if you find yourself asking twice, the budget is broken. Nothing is ever auto-closed — the `filler` return prompt and every day-review disposition only ever *ask*.

12. **`kind` has exactly three members: `focus | pulled | filler`. Never add a fourth.** Model it as a discriminated union in TypeScript and Zod, never as an optional-fields bag — validation, DB constraints, gating and the day split all branch on it. **`drift` is not a `kind`**: it is a `status` (`drifted`), a `kindCorrectedTo` value, and a bucket in the five-way day split. The spec's Rule 16 used to imply otherwise; it doesn't now.
    **And `kind` is immutable on every row, with no exceptions** (spec Gap 26). A DB trigger blocks every `kind` update. **Promotion is not an exception to that** — `POST /api/sessions/[id]/promote` **closes** the filler `switched` and **inserts** a new `focus` row parented to it; it never relabels. If you find yourself wanting to loosen that trigger so `promote` is easier to write, stop: you are about to merge two activities into one log row, which is precisely the undercount the two-row shape was chosen to avoid (spec Research Notes — self-report diaries log 19.2 activities/day where cameras show 41.1; the *switches* are what get lost). It also costs the user nothing — the whole close/create/close is one server-side transaction behind one form.

13. **The app asks; it never decides (Rule 26).** While a session is active and its `checkInIntervalMinutes` elapses with no interaction, the app prompts *"still on this?"* — **Yes / Done / I drifted**. An ignored prompt changes **nothing** about the session: no close, no status change, no classification. Three things to get right: the interval is **chosen at the gate** and never invented (`30/60/90/off`, and `off` is a legitimate choice, not a degraded one); **interrupts inherit it from the parent they suspended** (a parentless `pulled` gets `null`); and **a resume re-arms it from zero** — there is no separate post-resume nudge and no second timer. **Reuse Rule 18's prompt machinery verbatim** — same push-only service worker, same *"always a question, never a claim"* phrasing. **If you are writing a second push code path, stop.**

14. **Every prompt writes a `CheckIn` row, answered or not** — and an **unanswered** one marks `promptedAt` → the next answer (or close) as an `unaccounted` window that Rule 22 subtracts from focused time. This is the honest-number machinery: focused time is **parent wall time − children − unanswered check-in windows − day-boundary tails**, computed from the tree and **never stored**. A session run with the check-in `off` gets no subtraction and reads high — that is a visible consequence of a choice, not a bug to fix. **The five day-split buckets must sum to the day's wall time**; if they don't, something being subtracted has no bucket.

15. **RLS is on every table, predicate `auth.uid() IS NOT NULL` — no table has an owner column.** Single user, not multi-tenant. Don't "fix" this by adding a `userId`: the anon key is safe because RLS is enabled, not because rows are partitioned. A second user would read the first's rows, so adding one is a migration **and** an ADR, not a setting.

---

## What Doesn't Belong Here

- **Architecture decisions and planning docs** — those live in the `ais` repo at `projects/focus/`. ADRs are written there, not here.
- **Multi-user features** — sharing, teams, permissions, roles. Single user by design.
- **Timesheet or billing logic** — the log records what was accomplished, not hours against a client code. Explicitly out of scope per ADR-0001.
- **Offline sync, precache, offline read caches, or anything else needing a `fetch` handler** — deliberately deferred in v1. Adding any of it is an ADR decision, not a feature. This includes making the day-review screen readable offline, which was asked and answered (ADR-0002 Gap 4, 2026-08-16: no — the review happens at the desk).
- Credentials, API keys, or `.env` values — never commit.

---

## References

- [ADR-0001](../ais/projects/focus/decisions/adr-0001-single-task-sessions-gated-by-what-why-finish-line.md) — the behavioural contract
- [ADR-0003](../ais/projects/focus/decisions/adr-0003-pulled-filler-drift-interruption-model.md) — the `pulled` / `filler` / `drift` interruption model; source of Rules 16–25 and the `/review` screen
- [ADR-0004](../ais/projects/focus/decisions/adr-0004-starting-is-the-only-way-in.md) — start-on-capture: the gate is the only door. **Retires Rule 9, re-scopes Rule 12.** `Proposed` — ratify before relying on it
- [Project Spec](../ais/projects/focus/project-spec.md) — data model, routes, **23 v1 business rules**, falsifiable assumptions. **Ready to Build as of 2026-08-16**; the one knowingly-unmitigated risk is Gap 9 (a failed write leaves no row, so it reads like un-gated work in the log) — revisited 2026-09-05.
- [sessions.md](../ais/projects/focus/sessions.md) — the manual protocol this replaces; reference definition of correct behaviour
