-- Focus — the transactional session paths
--
-- WHY THESE ARE SQL FUNCTIONS AND NOT APPLICATION CODE
--
-- supabase-js has no multi-statement transaction. Rules 16, 18 and 23 all require
-- "in a single transaction" in so many words, and the spec names suspend/resume as
-- "the highest-risk write path in the app" — a partial failure leaving zero or two
-- `active` rows violates Rule 1. A plpgsql function body IS a transaction, so the
-- guarantee lives where it can actually be kept.
--
-- ORDERING IS LOAD-BEARING IN EVERY FUNCTION BELOW.
-- `sessions_single_active` is a PARTIAL UNIQUE INDEX, and indexes cannot be
-- deferred. (A deferrable equivalent exists — EXCLUDE ... WHERE ... DEFERRABLE plus
-- btree_gist — but that is more machinery than this needs.) So every function that
-- both closes and opens a session must CLOSE FIRST. Reversed, it fails at runtime
-- with a unique violation, not at review. Do not "tidy" the statement order.
--
-- Errors raised here are matched by string in src/lib/http.ts `apiFailure()` and
-- mapped onto the API envelope. Changing a message changes an HTTP status.

-- ============================================================================
-- close_session — the close-out (Rule 5)
-- ============================================================================
-- Rule 5: once `ended_at` is set, NO field may change, including `outcome_note`.
-- "Never edit a card after the session. A tidied log is a useless log."
--
-- ⚠️ OPEN SPEC QUESTION (FOCUS-0, raised by the schema audit 2026-08-17):
-- Rule 5 is enforced HERE and in the store layer, NOT by a blanket table trigger.
-- 0001_init.sql enforces `kind` immutability and correction write-once, but not
-- Rule 5 itself — so a direct SQL UPDATE can still edit or reopen a closed
-- session. That asymmetry is odd, because Rule 21 calls itself "the one narrow,
-- auditable exception to Rule 5" — the schema implements the exception to a rule
-- it does not implement.
--
-- Left as-is DELIBERATELY: the project spec names only the gate and
-- single-threading as DB-enforced, so promoting Rule 5 to a trigger is the
-- architect's call, not a build decision. If the answer is "yes, enforce it",
-- that is a small migration and this comment comes out.

create or replace function close_session(
  p_session_id  uuid,
  p_status      session_status,
  p_outcome_note text
)
returns sessions
language plpgsql
as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then
    raise exception 'No such session %', p_session_id using errcode = 'no_data_found';
  end if;
  if s.ended_at is not null then
    raise exception 'Rule 5: session % is closed and immutable', p_session_id
      using errcode = 'check_violation';
  end if;

  update sessions
     set status       = p_status,
         ended_at     = now(),
         outcome_note = p_outcome_note
   where id = p_session_id
  returning * into s;

  return s;
end;
$$;

-- ============================================================================
-- start_focus_session — the gate (Rules 1, 2, 3, 4, 6)
-- ============================================================================
-- Rule 1 returns 409 rather than silently closing whatever was running: the NFR
-- requires the UI to say WHICH session is blocking, with a link to close it. The
-- switch is then recorded as `switched` by a deliberate act (Rule 6) — recorded,
-- not hidden.
--
-- Rule 4: `what` / `why` / `finish_line` are SNAPSHOT here. Later edits to the
-- Task never reach this row.

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

  return s;
end;
$$;

-- ============================================================================
-- suspend_and_start_interrupt — Rules 16, 17, 19, 26f
-- ============================================================================
-- An interrupt SUSPENDS the parent; it never closes it. Roughly half of all
-- switches are mandatory client-facing work, and logging those as `switched` made
-- the log an indictment — an indictment gets abandoned, taking the record and the
-- metric with it.
--
-- Rule 17: `suspended` is not `active`, so the single-active index survives
-- VERBATIM. This model does not relax single-threading; it makes it survivable.
--
-- Rule 26f: the child COPIES `check_in_interval_minutes` from the parent — copied,
-- not read through, so correcting the parent later never rewrites the child. A
-- parentless `pulled` (Rule 19) gets null, which is the one uncovered case:
-- there is nothing to inherit and inventing a number is what 26a forbids.

create or replace function suspend_and_start_interrupt(
  p_kind          session_kind,
  p_what          text,
  p_interrupt_tag interrupt_tag,
  p_parent_id     uuid,
  p_wait_minutes  int
)
returns sessions
language plpgsql
as $$
declare
  parent   sessions;
  child    sessions;
  v_interval int := null;
  v_resume timestamptz := null;
begin
  if p_kind = 'focus' then
    raise exception 'suspend_and_start_interrupt is for interrupts only, not focus';
  end if;

  if p_parent_id is not null then
    select * into parent from sessions where id = p_parent_id for update;
    if not found then
      raise exception 'No such parent session %', p_parent_id using errcode = 'no_data_found';
    end if;
    if parent.status <> 'active' then
      raise exception 'Parent session % is not active (it is %)', p_parent_id, parent.status
        using errcode = 'check_violation';
    end if;

    -- Rule 26f — inherit, transitively (the parent's own value may itself be
    -- inherited). Copied inside this transaction, per the spec.
    v_interval := parent.check_in_interval_minutes;

    -- CLOSE-BEFORE-OPEN: the parent leaves `active` before the child enters it.
    update sessions set status = 'suspended' where id = p_parent_id;
  end if;

  if p_kind = 'filler' then
    if p_parent_id is null or p_wait_minutes is null then
      raise exception 'Rule 18: filler requires a parent and an expected wait'
        using errcode = 'check_violation';
    end if;
    v_resume := now() + make_interval(mins => p_wait_minutes);
  end if;

  insert into sessions (kind, what, interrupt_tag, parent_session_id,
                        status, expected_resume_at, check_in_interval_minutes)
  values (p_kind, p_what, p_interrupt_tag, p_parent_id,
          'active', v_resume, v_interval)
  returning * into child;

  return child;
end;
$$;

-- ============================================================================
-- resume_session — Rules 16, 17, 26g
-- ============================================================================
-- Settles the child, returns the parent to `active`. Rule 26g: the check-in clock
-- resets to ZERO and runs the session's own interval again — a session suspended
-- for three hours must not prompt the instant it returns, which would train the
-- prompt to be ignored. `last_interaction_at = now()` IS that reset; there is no
-- second timer and no post-resume interval anywhere.

create or replace function resume_session(
  p_parent_id    uuid,
  p_child_status session_status,
  p_child_note   text
)
returns sessions
language plpgsql
as $$
declare
  parent sessions;
  child  sessions;
begin
  select * into parent from sessions where id = p_parent_id for update;
  if not found then
    raise exception 'No such session %', p_parent_id using errcode = 'no_data_found';
  end if;
  if parent.status <> 'suspended' then
    raise exception 'Session % is not suspended (it is %)', p_parent_id, parent.status
      using errcode = 'check_violation';
  end if;

  -- CLOSE-BEFORE-OPEN: settle any live child first, or the update below collides
  -- with the single-active index.
  select * into child
    from sessions
   where parent_session_id = p_parent_id and status = 'active'
   limit 1;

  if found then
    update sessions
       set status = p_child_status, ended_at = now(), outcome_note = p_child_note
     where id = child.id;
  end if;

  update sessions
     set status              = 'active',
         -- Rule 26g: re-arm from zero, at this session's own interval.
         last_interaction_at = now()
   where id = p_parent_id
  returning * into parent;

  return parent;
end;
$$;

-- ============================================================================
-- rearm_filler — Rule 18's capped return prompt (Gap 25)
-- ============================================================================
-- One tap re-arms for another interval; the app is silent in between. AFTER 3
-- RE-ARMS it stops asking and forces a disposition — resume the parent, close it,
-- or promote the child.
--
-- The cap counts in a STORED column because it has to survive a reload, a restart
-- and a device switch: a cap that silently resets is worse than no cap, because it
-- reads as working. The tally is also the evidence A10 needs at the 2026-09-05
-- checkpoint, where the action on falsification is to CUT `filler`, not tune it.

create or replace function rearm_filler(
  p_session_id   uuid,
  p_wait_minutes int
)
returns sessions
language plpgsql
as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then
    raise exception 'No such session %', p_session_id using errcode = 'no_data_found';
  end if;
  if s.kind <> 'filler' then
    raise exception 'Rule 18: only a filler session can be re-armed' using errcode = 'check_violation';
  end if;
  if s.ended_at is not null then
    raise exception 'Rule 5: session % is closed and immutable', p_session_id
      using errcode = 'check_violation';
  end if;
  if s.rearm_count >= 3 then
    -- The UI must respond by presenting the forced disposition. NEVER by
    -- auto-closing — Rule 7 is not negotiable here.
    raise exception 'Rule 18: re-arm cap reached (3). Choose a disposition.'
      using errcode = 'check_violation';
  end if;

  update sessions
     set rearm_count       = s.rearm_count + 1,
         expected_resume_at = now() + make_interval(mins => p_wait_minutes)
   where id = p_session_id
  returning * into s;

  return s;
end;
$$;

-- ============================================================================
-- promote_filler — Gap 17b as reshaped by Gap 26
-- ============================================================================
-- The interrupt became the real work.
--
-- NO ROW'S `kind` IS EVER MUTATED. Promotion CLOSES the filler and OPENS a new
-- focus session. Rule 21 therefore stands absolutely, the immutability trigger is
-- the simplest possible one, and label-immutability stays enforced in the database
-- rather than demoted to application code.
--
-- Decided against research (spec Research Notes): the promotion moment is a
-- genuine EVENT BOUNDARY (a goal change), and memory is better at boundaries and
-- disrupted across them; and self-report diaries validated against wearable
-- cameras log 19.2 activities/day where cameras show 41.1 — aggregate hours
-- survive, SWITCHING is what gets lost. Merging the filler into the focus row is
-- that exact undercount, built into the schema, by an app whose premise is that
-- memory cannot answer "what did you do?".
--
-- FOUR EFFECTS, ONE TRANSACTION, IN THIS ORDER:
--   1. close the filler child           `switched`
--   2. create a Task from its `what`    (topic defaults to Inbox)
--   3. INSERT a new `focus` session     parented to the closed filler (lineage)
--   4. close the grandparent            with the submitted disposition
--
-- Effect 1 precedes effect 3 because of the single-active index. Both ancestors
-- end closed, so the depth walk stops immediately and a promoted session does not
-- count toward Rule 20's stack depth.

create or replace function promote_filler(
  p_filler_id          uuid,
  p_why                text,
  p_finish_line        text,
  p_interval           int,
  p_grandparent_status session_status,
  p_topic_id           uuid
)
returns sessions
language plpgsql
as $$
declare
  filler      sessions;
  grandparent sessions;
  v_topic_id  uuid := p_topic_id;
  v_task_id   uuid;
  promoted    sessions;
begin
  select * into filler from sessions where id = p_filler_id for update;
  if not found then
    raise exception 'No such session %', p_filler_id using errcode = 'no_data_found';
  end if;
  if filler.kind <> 'filler' then
    raise exception 'Only a filler session can be promoted' using errcode = 'check_violation';
  end if;
  if filler.status <> 'active' then
    raise exception 'Filler session % is not active (it is %)', p_filler_id, filler.status
      using errcode = 'check_violation';
  end if;

  select * into grandparent from sessions where id = filler.parent_session_id for update;
  if not found or grandparent.status <> 'suspended' then
    raise exception 'The suspended parent of filler % is not available to close', p_filler_id
      using errcode = 'check_violation';
  end if;

  -- (1) close the filler. `switched` is the existing meaning of Rule 6's status —
  -- a session that ended because you moved to something else, with the move
  -- recorded rather than hidden. Its minutes stay visible as their own row, which
  -- is the number A10 is written against.
  update sessions
     set status = 'switched', ended_at = now()
   where id = p_filler_id;

  -- (2) the Task. Topic defaults to the seeded Inbox.
  if v_topic_id is null then
    select id into v_topic_id from topics where lower(name) = 'inbox' limit 1;
    if v_topic_id is null then
      raise exception 'Seeded Inbox topic is missing — run supabase/seed.sql';
    end if;
  end if;

  insert into tasks (topic_id, what, why, finish_line, status)
  values (v_topic_id, filler.what, p_why, p_finish_line, 'today')
  returning id into v_task_id;

  -- (3) the new focus session. `parent_session_id` points at the CLOSED filler:
  -- the lineage record, so the chain reads grandparent → filler → promoted work.
  -- It must satisfy the same kind='focus' CHECK as any other gated session —
  -- promotion IS the gate, not a bypass of Rules 2 and 3.
  insert into sessions (task_id, kind, parent_session_id, what, why, finish_line,
                        status, check_in_interval_minutes)
  values (v_task_id, 'focus', p_filler_id, filler.what, p_why, p_finish_line,
          'active', p_interval)
  returning * into promoted;

  -- (4) close the grandparent with the submitted disposition.
  update sessions
     set status = p_grandparent_status, ended_at = now()
   where id = grandparent.id;

  return promoted;
end;
$$;

-- ============================================================================
-- correct_kind — Rule 21, write-once, day review only
-- ============================================================================
-- The original `kind` is NEVER overwritten. A correction relabels what a finished
-- block WAS, and it goes in `kind_corrected_to` precisely so the original stays
-- auditable. The write-once guarantee itself is enforced by the trigger in
-- 0001_init.sql; this function exists to give the API a clean 409 path.

create or replace function correct_kind(
  p_session_id uuid,
  p_corrected_to kind_correction
)
returns sessions
language plpgsql
as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then
    raise exception 'No such session %', p_session_id using errcode = 'no_data_found';
  end if;
  if s.kind_corrected_at is not null then
    raise exception 'Rule 21: session % was already corrected at %', p_session_id, s.kind_corrected_at
      using errcode = 'check_violation';
  end if;

  update sessions
     set kind_corrected_to = p_corrected_to,
         kind_corrected_at = now()
   where id = p_session_id
  returning * into s;

  return s;
end;
$$;

-- ============================================================================
-- dispose_suspended — Rule 23
-- ============================================================================
-- Day review forces a disposition on every still-suspended session. NOTHING
-- SURVIVES THE DAY UNDECIDED. Three dispositions:
--
--   resume  — stays `suspended`, but captures a WHEN: an EVENT CUE (`resume_cue`)
--             preferred over a clock time, plus a day/slot (`resume_planned_at`).
--             That is what converts "resume tomorrow" from a wish into an
--             implementation intention. `resume_planned_at` FIRES NOTHING — on the
--             planned day the session simply sits at the top of `/`.
--   partial — closed.
--   abandon — closed.
--
-- ⚠️ This function is the writer FOCUS-0 identified as missing: `resume_cue` and
-- `resume_planned_at` had no route. PATCH /api/sessions/[id] is close-out only,
-- and POST .../resume resumes NOW, which is a different act.

create or replace function dispose_suspended(
  p_session_id       uuid,
  p_disposition      text,
  p_resume_cue       text,
  p_resume_planned_at timestamptz,
  p_outcome_note     text
)
returns sessions
language plpgsql
as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then
    raise exception 'No such session %', p_session_id using errcode = 'no_data_found';
  end if;
  if s.status <> 'suspended' then
    raise exception 'Rule 23: session % is not suspended (it is %)', p_session_id, s.status
      using errcode = 'check_violation';
  end if;

  if p_disposition = 'resume' then
    update sessions
       set resume_cue = p_resume_cue, resume_planned_at = p_resume_planned_at
     where id = p_session_id
    returning * into s;
  elsif p_disposition = 'partial' then
    update sessions
       set status = 'partial', ended_at = now(), outcome_note = p_outcome_note
     where id = p_session_id
    returning * into s;
  elsif p_disposition = 'abandon' then
    update sessions
       set status = 'abandoned', ended_at = now(), outcome_note = p_outcome_note
     where id = p_session_id
    returning * into s;
  else
    raise exception 'Unknown disposition "%"', p_disposition using errcode = 'check_violation';
  end if;

  return s;
end;
$$;

-- ============================================================================
-- record_check_in / answer_check_in — Rule 26e
-- ============================================================================
-- ONE ROW PER PROMPT, ANSWERED OR NOT. An unanswered row marks `prompted_at` →
-- the next answer (or session close) as an `unaccounted` window that Rule 22
-- subtracts and Rule 24 buckets.
--
-- 26b: the app never acts on silence — no close, no status change, no forced
-- classification. It only stops CREDITING it. Nothing in either function below
-- touches `sessions.status`, and nothing ever should.

create or replace function record_check_in(p_session_id uuid)
returns check_ins
language plpgsql
as $$
declare
  s sessions;
  c check_ins;
begin
  select * into s from sessions where id = p_session_id;
  if not found then
    raise exception 'No such session %', p_session_id using errcode = 'no_data_found';
  end if;
  if s.ended_at is not null then
    raise exception 'Rule 5: session % is closed', p_session_id using errcode = 'check_violation';
  end if;

  insert into check_ins (session_id) values (p_session_id) returning * into c;
  return c;
end;
$$;

create or replace function answer_check_in(
  p_check_in_id uuid,
  p_answer      check_in_answer
)
returns check_ins
language plpgsql
as $$
declare
  c check_ins;
begin
  select * into c from check_ins where id = p_check_in_id for update;
  if not found then
    raise exception 'No such check-in %', p_check_in_id using errcode = 'no_data_found';
  end if;
  if c.answered_at is not null then
    raise exception 'Check-in % was already answered', p_check_in_id using errcode = 'check_violation';
  end if;

  update check_ins set answered_at = now(), answer = p_answer
   where id = p_check_in_id
  returning * into c;

  -- The answer touches the session's interaction clock (re-arming the probe) and
  -- NOTHING else. 'done' and 'drifted' route to close-out through the normal
  -- close_session path, by an explicit act — never from inside here.
  update sessions set last_interaction_at = now() where id = c.session_id;

  return c;
end;
$$;
