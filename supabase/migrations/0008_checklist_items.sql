-- Focus — the in-session scratchpad (feature-brief-session-scratchpad-checklist.md)
--
-- A live checklist on the active session screen: freeform sub-steps you add and
-- tick while working, so "where I left off" doesn't have to be held in memory or
-- squeezed into `outcome_note` at close.
--
-- THE SIXTH TABLE. `project-spec.md` and both CLAUDE.md files describe five, and
-- that phrasing needs amending alongside this migration. It is a spec amendment,
-- not an ADR: the table is additive, single-user, has no production rows, is read
-- by nothing else, and rolls back with `drop table`.
--
-- WHY A CHILD TABLE AND NOT A COLUMN ON `sessions`: per-item `done` state is the
-- feature. A newline-separated text column gives you a notes field you cannot tick,
-- and ticking is also the interaction that re-arms the Rule 26 probe (see below).
--
-- SCOPED TO THE SESSION, NOT THE TOPIC. Topics still have no page and no board
-- (Gap 1, ADR-0004). Nothing here reopens that, and nothing here weakens
-- single-threading (Rule 1) or touches the gate (Rules 2, 3).

create table checklist_items (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  -- 1–200 chars, mirroring `tasks.what` (0001_init.sql:57) rather than inventing a
  -- second convention. It is a scratchpad line, not a document.
  text       text not null check (length(text) between 1 and 200),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- NO `position` COLUMN, deliberately. Append order only: a scratchpad reads
  -- chronologically, and the order you thought of things is itself the "where I'm
  -- at" signal. Reordering is out of scope, not unimplemented.
);

-- Every read is "this session's items, oldest first". One index, matching that.
create index checklist_items_session_created on checklist_items (session_id, created_at);

-- ── Rule 6, scoped ────────────────────────────────────────────────────────────
--
-- Sessions are append-only and closed sessions are immutable — INCLUDING their
-- checklist. But Rule 6 governs the RECORD OF WORK DONE, not the surface used to
-- do it: while a session is `active` you may edit and even DELETE an item, because
-- erasing a line you no longer need is wiping a whiteboard, not rewriting history.
--
-- The instant `ended_at` is set, the checklist freezes exactly like `outcome_note`.
-- Enforced HERE rather than only in the route handler, for the same reason the gate
-- is: a rule that lives only in application code is a convention, not a constraint.
create or replace function checklist_items_session_must_be_open()
returns trigger
language plpgsql
as $$
declare
  open_at timestamptz;
  sid     uuid := coalesce(new.session_id, old.session_id);
begin
  select ended_at into open_at from sessions where id = sid;
  if not found then
    raise exception 'No such session %', sid using errcode = 'no_data_found';
  end if;
  if open_at is not null then
    raise exception 'Rule 6: session % is closed; its checklist is immutable', sid
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- An item never moves between sessions.
    if new.session_id is distinct from old.session_id then
      raise exception 'checklist_items.session_id is immutable'
        using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger checklist_items_guard
  before insert or update or delete on checklist_items
  for each row execute function checklist_items_session_must_be_open();

-- ── RLS (Rule 15) ─────────────────────────────────────────────────────────────
--
-- Same predicate as every other table: `auth.uid() is not null`, NO owner column.
-- Single user, not multi-tenant — the anon key is client-safe BECAUSE RLS is on,
-- not because rows are partitioned.
--
-- ⚠️ THE TEST SUITE WILL NOT CATCH THIS IF IT IS MISSING. `tests/guardrails.test.ts`
-- reads only `0001_init.sql` and iterates a hardcoded five-name list, so no table
-- added after `0001` is covered by the RLS assertion — not this one, and not
-- 0002–0007. Verified by hand instead; fixing the suite to scan this directory is
-- its own change.
alter table checklist_items enable row level security;

create policy checklist_items_select_signed_in on checklist_items
  for select to authenticated using (auth.uid() is not null);
create policy checklist_items_insert_signed_in on checklist_items
  for insert to authenticated with check (auth.uid() is not null);
create policy checklist_items_update_signed_in on checklist_items
  for update to authenticated using (auth.uid() is not null)
                                with check (auth.uid() is not null);

-- The second delete policy in the schema, and the reason is narrow: an item you
-- typed by mistake never represented completed work, so removing it while the
-- session is still open erases nothing from the record. The trigger above is what
-- stops this from reaching a closed session.
create policy checklist_items_delete_signed_in on checklist_items
  for delete to authenticated using (auth.uid() is not null);
