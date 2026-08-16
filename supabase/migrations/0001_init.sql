-- Focus — initial schema
--
-- Source of truth: ais repo → projects/focus/project-spec.md § Data Model.
-- Behavioural contract: ADR-0001 (Rules 1–7), ADR-0003 (Rules 16–25), Rule 26.
--
-- THE GATE IS ENFORCED HERE, NOT ONLY IN APPLICATION CODE. The partial unique
-- index and the kind-scoped CHECK constraints below ARE Rules 1, 2 and 3. If a
-- change requires relaxing one, that supersedes ADR-0001 — it is not a code change.
--
-- Five tables: three domain entities (topics, tasks, sessions) plus two plumbing
-- tables (check_ins, push_subscriptions). Pomodoro and DailyPlan are DEFERRED to
-- v1.1 and must not appear in the schema (spec Gaps 2/8 and 3/4).
--
-- Naming: snake_case here, camelCase in src/types/db.ts. The mapping lives in
-- src/lib/store/ and nowhere else.

create extension if not exists pgcrypto; -- gen_random_uuid

-- ============================================================================
-- topics
-- ============================================================================
-- The unit of "what's on my plate."
-- v1 note (Gap 14): a Topic is CREATED inline in quick capture, by name only,
-- and managed nowhere. `color` is assigned server-side from a fixed palette;
-- `status` is always 'active'; `why` is always null (Rule 15 defers with the
-- board); `archived_at` is always null. The enum and columns ship intact so the
-- v1.1 board can use them.

create type topic_status as enum ('active', 'parked', 'done');

create table topics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 80),
  why         text,                    -- nullable and UNENFORCED in v1 (Rule 15 deferred)
  color       text not null,           -- hex, assigned server-side
  status      topic_status not null default 'active',
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create unique index topics_name_ci on topics (lower(name));

-- ============================================================================
-- tasks
-- ============================================================================
-- Rule 9: capture is cheap. Creating a Task requires ONLY `what` + `topic_id`.
-- `why` and `finish_line` are collected at the GATE, not at capture — that is
-- the rule reconciling frictionless capture with ADR-0001's hard gate.

create type task_status as enum ('backlog', 'today', 'done', 'dropped');

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  -- Rule 8: NO ORPHAN TASKS. Every Task belongs to exactly one Topic; the
  -- seeded 'Inbox' topic is why capture never blocks on classification.
  topic_id         uuid not null references topics(id),
  what             text not null check (length(what) between 1 and 200),
  why              text,
  finish_line      text,
  status           task_status not null default 'backlog',
  -- Planning aid only. Does NOT feed a timebox default — there is no timebox
  -- (Rule 13, retired 2026-08-16).
  estimate_minutes int check (estimate_minutes is null or estimate_minutes > 0),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index tasks_topic_id on tasks (topic_id);
create index tasks_status on tasks (status);

-- ============================================================================
-- sessions
-- ============================================================================
-- THE LOG ENTRY. This is what answers "what did you do?".
-- Interrupts are Sessions, not a separate entity (ADR-0003 Invariant 2): a
-- `pulled` PR review is real work and belongs in the record.

-- EXACTLY THREE MEMBERS. Never a fourth (Rule 16).
-- `drift` is NOT a kind — it is a status, a correction target, and a day-split
-- bucket. Adding a fourth arm here propagates into the TS/Zod discriminated
-- union, every CHECK below, and the five-way split.
create type session_kind as enum ('focus', 'pulled', 'filler');

create type session_status as enum (
  'active',     -- exactly one row, ever (Rule 1)
  'suspended',  -- ADR-0003: an interrupt suspended this; NOT active, so it does
                -- not occupy the single-active slot (Rule 17)
  'done',
  'partial',
  'switched',   -- focus → focus (Rule 6)
  'drifted',    -- ADR-0003. Drift is a STATUS, not a kind (Rule 16)
  'abandoned'
);

create type interrupt_tag as enum ('pr', 'alert', 'dm', 'meeting', 'other');

-- Wider than session_kind on purpose: `drift` and `unaccounted` are valid
-- correction targets at day review but are not kinds (Rules 21, 24).
create type kind_correction as enum ('focus', 'pulled', 'filler', 'drift', 'unaccounted');

create table sessions (
  id                       uuid primary key default gen_random_uuid(),
  -- Null for interrupts — they are not captured Tasks (Gap 10). Auto-creating a
  -- Task per interrupt was REJECTED: it would fill the backlog, which is now the
  -- home screen, with work you never chose.
  task_id                  uuid references tasks(id),
  kind                     session_kind not null default 'focus',
  -- The session this one interrupted. Self-referencing; cycle-guarded by trigger
  -- below. Depth is NOT constrained — Rule 20 says depth 3+ is a SIGNAL about the
  -- day, surfaced as a warning, never blocked.
  parent_session_id        uuid references sessions(id),
  -- Rule 4: SNAPSHOT at start. Later edits to the parent Task must never alter
  -- an existing Session row.
  what                     text not null check (length(what) >= 1),
  why                      text,
  finish_line              text,
  started_at               timestamptz not null default now(),
  -- Null = still open. Rule 7: NEVER auto-closed. No timeout, no cron, no
  -- "stale session" sweep. An open session stays open as evidence.
  ended_at                 timestamptz,
  status                   session_status not null default 'active',
  -- Non-null ⇒ the suspension is an external wait. Drives Rule 18's return prompt.
  expected_resume_at       timestamptz,
  interrupt_tag            interrupt_tag,
  -- Write-once, day review only (Rule 21). The original `kind` is NEVER
  -- overwritten — that is what keeps the mid-interrupt tap cheap.
  kind_corrected_to        kind_correction,
  kind_corrected_at        timestamptz,
  -- Rule 23: the event-phrased half of a resume plan, preferred over a clock time.
  resume_cue               text,
  -- The day/slot this pins to the top of `/`. FIRES NOTHING — passive placement.
  resume_planned_at        timestamptz,
  -- App interaction, not OS activity. Arms the Rule 26 probe and carries the
  -- day-boundary `unaccounted` case (Rule 24).
  last_interaction_at      timestamptz not null default now(),
  -- Rule 26a: STATED AT THE GATE, never invented by the app. null = off, and off
  -- is a first-class choice, not a degraded one.
  -- Rule 26f: interrupts INHERIT this from the session they suspend, copied in
  -- the same transaction as the suspend. A parentless `pulled` gets null.
  check_in_interval_minutes int check (check_in_interval_minutes in (30, 60, 90)),
  -- The one closing line. Immutable once the session is closed (Rule 5).
  outcome_note             text,
  -- Rule 18's re-arm cap (Gap 25, resolved 2026-08-16). Incremented by
  -- POST /api/sessions/[id]/rearm; the 4th returns 409 and the UI forces a
  -- disposition. Nothing else could hold the tally — `expected_resume_at` is
  -- OVERWRITTEN by each re-arm, so it knows the current wait and never how many
  -- there have been.
  --
  -- STORED, not derived and not client-side, for two reasons: the cap has to
  -- survive a reload, a restart and a device switch (a cap that silently resets
  -- is worse than no cap, because it reads as working); and the number is
  -- EVIDENCE — a stored tally is what makes "do filler waits routinely run
  -- long?" answerable at the 2026-09-05 checkpoint, which is exactly what
  -- assumption A10 needs. A10's action on falsification is to CUT `filler`.
  rearm_count              int not null default 0 check (rearm_count >= 0),

  -- ── Rule 2 + Rule 3, kind-scoped (ADR-0003 Invariant 3) ────────────────────
  -- NO WHY, NO START — for focus sessions. An interrupt cannot be asked for a
  -- WHY at the moment it arrives; that is the worst possible moment to demand
  -- reflection. Interrupts carry a `what` and nothing else.
  constraint sessions_focus_is_gated check (
    kind <> 'focus' or (
      task_id is not null
      and why is not null and btrim(why) <> ''
      and finish_line is not null and btrim(finish_line) <> ''
    )
  ),

  -- ── Rule 18 ────────────────────────────────────────────────────────────────
  -- `filler` requires a parent and an expected wait. Without a return prompt,
  -- `filler` is parallel work wearing a tag.
  constraint sessions_filler_needs_parent_and_wait check (
    kind <> 'filler' or (parent_session_id is not null and expected_resume_at is not null)
  ),

  -- ── Gap 17a ────────────────────────────────────────────────────────────────
  -- The seven-cell grid always supplies a tag, so a null here means something
  -- bypassed the tap. Null for `focus` and `filler`.
  constraint sessions_pulled_needs_tag check (
    (kind = 'pulled' and interrupt_tag is not null)
    or (kind <> 'pulled' and interrupt_tag is null)
  ),

  -- ── Rule 21 ────────────────────────────────────────────────────────────────
  -- Both null or both set. Write-once is enforced by trigger below — a CHECK
  -- alone cannot express it.
  constraint sessions_correction_pair check (
    (kind_corrected_to is null) = (kind_corrected_at is null)
  ),

  constraint sessions_no_self_parent check (parent_session_id is distinct from id),

  constraint sessions_ended_after_started check (
    ended_at is null or ended_at >= started_at
  )
);

-- ── Rule 1: ONE ACTIVE SESSION, GLOBALLY ─────────────────────────────────────
-- At most one row with status = 'active' across the whole table. Enforced by a
-- partial unique index, not just application code. `suspended` is not `active`,
-- which is exactly what lets ADR-0003 add interrupts WITHOUT relaxing
-- single-threading (Rule 17 — this index survives verbatim).
create unique index sessions_single_active on sessions (status) where status = 'active';

create index sessions_started_at on sessions (started_at desc);
create index sessions_parent on sessions (parent_session_id);
create index sessions_task on sessions (task_id);
create index sessions_resume_planned on sessions (resume_planned_at)
  where resume_planned_at is not null;
create index sessions_suspended on sessions (id) where status = 'suspended';

-- ── Rule 21: the correction is WRITE-ONCE ────────────────────────────────────
-- The one narrow, auditable exception to Rule 5. A second attempt is an error,
-- not a silent overwrite (the API returns 409).
create or replace function sessions_correction_is_write_once()
returns trigger
language plpgsql
as $$
begin
  if old.kind_corrected_at is not null
     and (new.kind_corrected_to is distinct from old.kind_corrected_to
          or new.kind_corrected_at is distinct from old.kind_corrected_at) then
    raise exception
      'Rule 21: kind correction is write-once (session % already corrected at %)',
      old.id, old.kind_corrected_at
      using errcode = 'check_violation';
  end if;

  -- Rule 21: `kind` IS IMMUTABLE ON EVERY ROW, WITH NO EXCEPTIONS.
  --
  -- A correction relabels what a finished block *was*, and it goes in
  -- `kind_corrected_to` precisely so the original stays auditable.
  --
  -- This once looked like it collided with promotion (Gap 17b), which read as
  -- flipping a child `filler` -> `focus`. It doesn't, because PROMOTION NO
  -- LONGER MUTATES ANYTHING (Gap 26, resolved 2026-08-16): it closes the filler
  -- `switched` and INSERTS a new `focus` row parented to it. A correction and a
  -- promotion are separate operations that now touch separate rows — so this
  -- trigger needs no exception, and none should ever be added to it.
  if new.kind is distinct from old.kind then
    raise exception
      'Rule 21: session.kind is immutable (% -> %) — correct via kind_corrected_to, or promote by inserting a new row',
      old.kind, new.kind
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger sessions_correction_write_once
  before update on sessions
  for each row execute function sessions_correction_is_write_once();

-- ── No cycles in the interrupt tree ──────────────────────────────────────────
-- Depth is deliberately NOT capped (Rule 20: depth 3+ is a signal, never blocked).
-- A cycle, however, would make the focused-time walk non-terminating.
create or replace function sessions_parent_has_no_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.parent_session_id;
  hops int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'parent_session_id would create a cycle at session %', new.id
        using errcode = 'check_violation';
    end if;
    hops := hops + 1;
    if hops > 64 then
      raise exception 'parent_session_id chain exceeded 64 hops — assuming a cycle'
        using errcode = 'check_violation';
    end if;
    select parent_session_id into cursor_id from sessions where id = cursor_id;
  end loop;
  return new;
end;
$$;

create trigger sessions_parent_no_cycle
  before insert or update of parent_session_id on sessions
  for each row when (new.parent_session_id is not null)
  execute function sessions_parent_has_no_cycle();

-- ============================================================================
-- check_ins  (plumbing — no business rules of its own, appears in no view)
-- ============================================================================
-- Rule 26e: ONE ROW PER PROMPT, ANSWERED OR NOT.
-- An unanswered row marks prompted_at → the next answered_at (or session close)
-- as an `unaccounted` window that Rule 22 SUBTRACTS from focused time and Rule 24
-- puts in the `unaccounted` bucket. Subtracted time has to land somewhere, or the
-- five buckets stop summing to the day (Gap 21).
--
-- Bounded by construction: a 60-minute interval produces one row an hour, not one
-- per tap. That boundedness is exactly what the rejected interaction-ping table
-- could not offer (Gap 18).

create type check_in_answer as enum ('yes', 'done', 'drifted');

create table check_ins (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id),
  prompted_at timestamptz not null default now(),
  -- NULL = never answered. This is the field that matters.
  answered_at timestamptz,
  answer      check_in_answer,
  constraint check_ins_answer_pair check ((answered_at is null) = (answer is null)),
  constraint check_ins_answered_after_prompt check (
    answered_at is null or answered_at >= prompted_at
  )
);

create index check_ins_session on check_ins (session_id, prompted_at);
create index check_ins_unanswered on check_ins (session_id) where answered_at is null;

-- ============================================================================
-- push_subscriptions  (plumbing)
-- ============================================================================
-- Rows are DEVICES, not people — single user, no relationships.
-- Fires BOTH prompt rules from ONE implementation: Rule 18's `filler` return
-- prompt and Rule 26's check-in probe. A second push code path is a bug (26c).
--
-- An EMPTY table is a UI state, not just an absence: without a subscription,
-- both rules degrade to foreground-only *silently*, and Rule 18 requires the app
-- to SURFACE that rather than pretend it is working.

create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- PREDICATE IS `auth.uid() IS NOT NULL`. NO TABLE HAS AN OWNER COLUMN (Gap 22).
--
-- Single user, explicitly NOT multi-tenant. Adding a userId FK to five tables to
-- key a policy that would only ever match one value is complexity with no buyer.
-- The anon key is safe because RLS is ON, not because rows are partitioned.
--
-- WHAT THIS COSTS, STATED PLAINLY: a second user would read the first user's
-- rows. Adding one is a MIGRATION AND AN ADR, not a setting — an owner column,
-- a backfill, and a rewritten predicate on all five tables. It stays cheap to
-- reach because RLS is already on and every write funnels through lib/store/.
--
-- NOTE ON DELETE: sessions and check_ins get no delete policy. Rule 14 — the log
-- is append-only, there is no delete endpoint, and a mistaken session is closed
-- `abandoned` with a note. topics/tasks likewise have no delete surface in v1.
-- push_subscriptions DOES get one: stale endpoints must be droppable.

alter table topics             enable row level security;
alter table tasks              enable row level security;
alter table sessions           enable row level security;
alter table check_ins          enable row level security;
alter table push_subscriptions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['topics', 'tasks', 'sessions', 'check_ins', 'push_subscriptions']
  loop
    execute format(
      'create policy %I on %I for select to authenticated using (auth.uid() is not null)',
      t || '_select_signed_in', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (auth.uid() is not null)',
      t || '_insert_signed_in', t);
    execute format(
      'create policy %I on %I for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)',
      t || '_update_signed_in', t);
  end loop;
end;
$$;

-- The one delete policy in the schema.
create policy push_subscriptions_delete_signed_in on push_subscriptions
  for delete to authenticated using (auth.uid() is not null);
