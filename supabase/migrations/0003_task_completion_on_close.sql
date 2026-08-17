-- Focus — mark the Task done when its focus session closes done
--
-- close_session() only ever wrote to `sessions`. A finished focus session left
-- its Task stuck at `status = 'backlog'` forever, so `/` kept showing a "Start"
-- button for work that was already done (feature-brief-task-done-on-session-close.md).
--
-- The new branch fires on the exact combination `kind = 'focus'` + `task_id is not
-- null` + `p_status = 'done'` — `partial`/`abandoned` closes and interrupts
-- (`taskId` is always null for `pulled`/`filler`) are untouched. Done inside the
-- same function body as the rest of close_session() so it's one transaction, not a
-- second client call — same reasoning as every other function in
-- 0002_session_transactions.sql.

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

  if s.kind = 'focus' and s.task_id is not null and p_status = 'done' then
    update tasks
       set status       = 'done',
           completed_at = now()
     where id = s.task_id;
  end if;

  return s;
end;
$$;
