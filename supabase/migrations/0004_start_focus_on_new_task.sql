-- Focus — start-on-capture (ADR-0004)
--
-- WHY THIS FUNCTION EXISTS
--
-- ADR-0004 collapses capture into the gate: entering a focus IS starting one, and
-- nothing may enter the system without starting. That turns "create a Task" and
-- "start a Session on it" into a single user act — so they must be a single
-- DATABASE act too.
--
-- The failure this prevents is specific. Done client-side as two calls, a Rule 1
-- conflict (another session already active) lands on the SECOND call, after the
-- task row is already committed. The result is a task in the backlog that was
-- never started — exactly what ADR-0004 exists to make impossible. The decision
-- would leak out through its own error path.
--
-- IT COMPOSES `start_focus_session`; IT DOES NOT COPY IT.
--
-- This is the whole design. plpgsql has no body reuse, so the tempting shortcut
-- is to paste the INSERT from 0002:104 and adjust it. Don't: that puts the
-- Rules 2/3/4 focus-insert shape in two places, and the second copy is the one
-- that rots. Instead the Task is inserted here and the gate is DELEGATED —
-- `start_focus_session` still owns the Rule 1 conflict check, the snapshot of
-- what/why/finish_line (Rule 4), and the insert itself.
--
-- The rollback guarantee falls out of that for free: a plpgsql function body is
-- one transaction, and a `raise` inside the callee aborts the whole outer
-- statement, so the Task insert above it rolls back with everything else. There
-- is no `begin/exception` block here on purpose — catching would BREAK the
-- guarantee by letting the outer transaction continue past the failure.
--
-- Because the Rule 1 check lives in the callee, its error message is emitted
-- once, in one place, and both start paths map onto the same 409 in
-- src/lib/http.ts `apiFailure()` with no second branch to keep in sync.
-- Changing that message changes an HTTP status.
--
-- NOT security definer, and no grants — same as 0002 and 0003. It runs as the
-- invoker so RLS (`auth.uid() is not null`, every table) applies unchanged. A
-- `security definer` here would quietly become the one write path in the app
-- that bypasses RLS.
--
-- WHAT IS DELIBERATELY *NOT* IN THIS TRANSACTION: the Topic.
-- The caller still resolves-or-creates it first, via `createTopicByName` in
-- src/lib/store/topics.ts. Pulling that in here would remove one round trip and
-- one orphan-Topic failure mode — both real — but it would also mean copying
-- the colour PALETTE into SQL, giving the app two sources of truth for topic
-- colour. An orphan Topic is invisible (empty groups are filtered out of `/`)
-- and costs a row; a forked palette is a bug that renders. Considered and
-- rejected 2026-08-20, on review.

-- ============================================================================
-- start_focus_on_new_task — the gate, for a task that does not exist yet
-- ============================================================================
-- Rules 1, 2, 3, 4, 8 + ADR-0004.
--
-- Rule 8 (no orphan tasks) is why `p_topic_id` is required rather than nullable:
-- the caller resolves-or-creates the topic first, exactly as capture always did.
--
-- The task is created with status 'backlog', NOT a new status. It is immediately
-- superseded by the active session and returns to visibility on `/` only if the
-- session closes `partial`. A task that is never finished stays 'backlog'
-- forever, and that is correct: 'backlog' means "not done", not "never started".
-- After this migration, "never started" is not a reachable state for any NEW
-- task — every task is born inside a start.

create or replace function start_focus_on_new_task(
  p_topic_id    uuid,
  p_what        text,
  p_why         text,
  p_finish_line text,
  p_interval    int
)
returns sessions
language plpgsql
as $$
declare
  t tasks;
  s sessions;
begin
  insert into tasks (topic_id, what, status)
  values (p_topic_id, p_what, 'backlog')
  returning * into t;

  -- Delegated, not duplicated. Raises on Rule 1; the raise aborts this
  -- transaction, taking the task insert above with it.
  select * into s from start_focus_session(
    t.id, p_what, p_why, p_finish_line, p_interval
  );

  return s;
end;
$$;
