-- Focus — carry the stated gate onto the Task (feature-brief-gate-prefill-on-restart.md)
--
-- WHY THIS EXISTS
--
-- `GateForm.tsx:73-74` has always seeded WHY and FINISH LINE from `task.why` /
-- `task.finishLine`. Nothing ever wrote those two columns, so the seed read
-- `null` on every restart and the architect re-typed both sentences from blank —
-- for a task they had already stated a WHY for, sometimes the same day.
--
-- The gap is a missing write, not a missing mechanism. `start_focus_session`
-- (0002:104) snapshots what/why/finish_line into `sessions` and stops there. This
-- adds the second half: the same three values are also carried onto the `tasks`
-- row, where the NEXT start can read them.
--
-- ⚠️ THIS IS A FILL-IN, NOT A RELAXATION OF ADR-0001.
--
-- The sheet still opens, both fields are still present, still editable, still
-- rejected when empty (`sessions_focus_is_gated` is untouched, and so is
-- `GateForm`'s own validation). `Start` remains a deliberate second act. What
-- changes is where the default text in the box comes from — nothing about what
-- the gate demands before it lets you through.
--
-- A one-tap "Resume" that skips the sheet was proposed and WITHDRAWN the same
-- session (brief Risk 1). It is genuinely faster on the app's most common path,
-- and it removes the gate from every start after the first — which is a
-- relaxation of ADR-0001 and needs a superseding ADR, not a commit. If you are
-- about to add it, that is the conversation to have first.
--
-- ⚠️ RULE 4 IS THE THING THIS COULD BREAK.
--
-- The direction of the write is Task ← gate. NEVER Session ← Task. Sessions
-- snapshot at start and never follow a later Task edit, so nothing here may
-- touch a `sessions` row other than the one it is inserting. `updateTask()` in
-- src/lib/store/tasks.ts carries the same warning for the same reason.
--
-- IT GOES IN THE CALLEE, WHICH IS WHY BOTH START PATHS GET IT.
--
-- plpgsql has no body reuse, so 0004's `start_focus_on_new_task` DELEGATES to
-- `start_focus_session` rather than copying its insert. Putting the task write
-- in the callee means the ⌘K path inherits it for free; putting it in the caller
-- would have covered one of the two doors. Do not paste it into 0004.

-- ============================================================================
-- tasks.check_in_interval_minutes — the third carried value (brief Risk 3)
-- ============================================================================
-- Rule 26a: the interval is CHOSEN at the gate and never invented. Carrying it
-- forward keeps it chosen — it arrives as a PRE-SELECTION in a sheet that is
-- open anyway, so "30 min because I was tired that day" costs exactly one tap to
-- undo rather than sticking to the task forever. That is the answer to the
-- "it is a per-sitting choice, not a task property" objection.
--
-- NULLABLE, AND null MEANS `off`. `off` is a first-class answer (Rule 26a), not
-- a degraded one, so it must round-trip as itself. `coalesce(..., 60)` is
-- FORBIDDEN anywhere on this path, in SQL and in TypeScript: it would silently
-- un-choose `off` and re-arm a probe the architect switched off.
--
-- The CHECK mirrors `sessions.check_in_interval_minutes` (0001:140) exactly. A
-- fourth interval would have to be added in both places and in `CheckInInterval`
-- in src/types/db.ts — it is a spec question, not a column change.
--
-- The one ambiguity, stated rather than papered over: a null here cannot be
-- distinguished from "never written". It does not matter in practice, because
-- every task reachable from `/` has been through a start — 0007 backfills the
-- ones that predate this migration, this function writes every one after it, and
-- 0005 already retired the pre-ADR-0004 captures that have no session at all.

alter table tasks
  add column check_in_interval_minutes int
    check (check_in_interval_minutes in (30, 60, 90));

-- ============================================================================
-- start_focus_session — unchanged gate, plus the carry-forward write
-- ============================================================================
-- Rules 1, 2, 3, 4, 6, 26a. The body below is 0002's verbatim, with one new
-- statement after the session insert. The Rule 1 conflict check, the error
-- string it raises (which src/lib/http.ts `apiFailure()` maps to a 409), and the
-- snapshot insert are all untouched.
--
-- The carry-forward is written AFTER the insert on purpose: the session is the
-- record, and the task copy is prefill for the next start. If the gate is
-- refused — Rule 1, or a CHECK on an empty why — the raise aborts the whole
-- transaction and the task keeps whatever it had. There is no path where a
-- rejected start rewrites the task's stated WHY.

create or replace function start_focus_session(
  p_task_id     uuid,
  p_what        text,
  p_why         text,
  p_finish_line text,
  p_interval    int
)
returns sessions
language plpgsql
as $$
declare
  blocking sessions;
  s        sessions;
begin
  select * into blocking from sessions where status = 'active' limit 1;
  if found then
    raise exception
      'Rule 1: session % is already active (%). Close it first.',
      blocking.id, blocking.what
      using errcode = 'unique_violation';
  end if;

  insert into sessions (task_id, kind, what, why, finish_line,
                        status, check_in_interval_minutes)
  values (p_task_id, 'focus', p_what, p_why, p_finish_line,
          'active', p_interval)
  returning * into s;

  -- Task ← gate. The values the architect just stated become the prefill the
  -- next restart reads. `p_interval` is assigned straight, not coalesced: a
  -- null is the architect choosing `off`, and it must survive as one.
  --
  -- `what` is deliberately NOT written back. In existing-task mode it is
  -- read-only in the sheet and comes from this row already; in new-task mode
  -- 0004 has just inserted the row with this exact value. Writing it would be a
  -- no-op that looks like an edit path.
  update tasks
     set why                       = p_why,
         finish_line               = p_finish_line,
         check_in_interval_minutes = p_interval
   where id = p_task_id;

  return s;
end;
$$;

-- ============================================================================
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
-- ============================================================================
-- · `promote_filler` (0002:370) already writes `why` / `finish_line` onto the
--   Task it creates — it is the one path that got this right from the start, and
--   it is why these columns existed at all. It does NOT write the new interval
--   column, and it is left alone: replacing that 70-line function to add one
--   assignment would put a second copy of it in the tree, and the second copy is
--   the one that rots (0004's argument, verbatim). The consequence is reachable
--   only in theory — `promote_filler` creates its Task at status 'today', `/`
--   lists 'backlog' exclusively, so a promoted task never reaches the restart
--   path this migration serves.
--
-- · every `sessions` row that already exists. Rule 5: closed sessions are
--   immutable. This migration adds a column to `tasks` and replaces one
--   function; it cannot alter the log.
--
-- · the CHECK constraints, the partial unique index, and both ESLint guardrails.
--   Nothing here relaxes a gate.
