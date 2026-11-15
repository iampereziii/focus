-- Focus — plan_lines: the plain-text "what to hit today" list
--
-- Source of truth: ais repo → ADR-0004 Amendment 1 (Accepted 2026-11-15) and
-- projects/focus/project-spec.md Rule 27 / § PlanLine. Build ticket: FOCUS-14.
--
-- A plan line is ONE HAND-WRITTEN LINE OF TEXT for one day. It is a reference to
-- look at between sessions and nothing else:
--   · it is NOT a Task and links to nothing — no task_id, no session_id. The gate
--     stays the only door (ADR-0004); a line can't start work or carry a status.
--   · it is NOT the shelved `DailyPlan` entity (spec Gaps 3 & 4). That recorded an
--     AI's ranking. This records the architect's own words, in the order written.
--
-- THE THREE RULES THAT KEEP IT FROM BECOMING A SECOND BACKLOG ARE ENFORCED HERE,
-- not only in the app (Rule 27b, 27c):
--   1. ONE OPEN PLAN. A line can't be inserted for a different day while an
--      earlier plan is still open. A forgotten plan therefore BLOCKS the next one
--      instead of growing. (plan_lines_one_open_plan)
--   2. THE DAY ENDS WHEN THE ARCHITECT ENDS IT — `ended_at` is set by the End day
--      button, never by a clock. Nothing here is scheduled, and nothing may be.
--   3. WRITTEN ONCE. `text`, `plan_date` and `created_at` never change; a dropped
--      line stays dropped; an ended line is frozen entirely. To change a line you
--      drop it and add another. (plan_lines_write_once)
--
-- No `position` column: `created_at` is the display order, and there is no
-- reordering (Rule 27f). No delete policy: nothing is deleted, only dropped or
-- ended (the log-is-append-only instinct, extended).
--
-- `plan_date` is the architect's LOCAL date when the plan was opened, supplied by
-- the browser. It is a label and the stale check, never derived from this server's
-- clock (which is UTC) — the same reason `/`'s `resumePlannedAt` pins are a known
-- UTC bug that this table deliberately does not inherit.
--
-- ⚠️ HOW TO UNDO IT. This migration touches no existing table or row. To remove it:
--
--   drop function add_plan_lines(date, text[]);
--   drop table plan_lines;
--   drop function plan_lines_write_once();
--   drop function plan_lines_one_open_plan();

create table plan_lines (
  id         uuid primary key default gen_random_uuid(),
  plan_date  date not null,
  text       text not null check (length(btrim(text)) between 1 and 200),
  created_at timestamptz not null default now(),
  dropped_at timestamptz,
  ended_at   timestamptz
);

-- The open plan is the only thing ever read on the hot path (`/`).
create index plan_lines_open on plan_lines (created_at) where ended_at is null;

-- ── Rule 27b: ONE open plan ──────────────────────────────────────────────────
create or replace function plan_lines_one_open_plan()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from plan_lines
     where ended_at is null
       and plan_date <> new.plan_date
  ) then
    raise exception
      'Rule 27b: an earlier plan is still open — end that day before starting another'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger plan_lines_one_open_plan
  before insert on plan_lines
  for each row execute function plan_lines_one_open_plan();

-- ── Rule 27c: a line is WRITTEN ONCE ─────────────────────────────────────────
-- The only legal updates are: dropped_at null -> a time, and ended_at null -> a
-- time. Everything else is an error, and the API maps it to 409.
create or replace function plan_lines_write_once()
returns trigger
language plpgsql
as $$
begin
  if old.ended_at is not null then
    raise exception
      'Rule 27c: this plan line was ended at % and can no longer change', old.ended_at
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.text is distinct from old.text
     or new.plan_date is distinct from old.plan_date
     or new.created_at is distinct from old.created_at then
    raise exception
      'Rule 27c: a plan line is written once — drop it and add a new one'
      using errcode = 'check_violation';
  end if;

  if old.dropped_at is not null and new.dropped_at is distinct from old.dropped_at then
    raise exception
      'Rule 27c: a dropped plan line stays dropped'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger plan_lines_write_once
  before update on plan_lines
  for each row execute function plan_lines_write_once();

-- ── Adding lines: several at once, in the order typed ────────────────────────
-- The plan is typed into ONE text area, one item per line, and saved together.
-- A plain multi-row insert would give every row the same `created_at` (`now()` is
-- the transaction's time), and `created_at` IS the display order (there is no
-- position column), so their order would be arbitrary. This inserts them in ONE
-- statement (all or nothing) and spaces their timestamps a millisecond apart in
-- the order typed. Both triggers above still run for every row.
-- Not `security definer`, no grants: the same as every other function here.
create or replace function add_plan_lines(p_plan_date date, p_lines text[])
returns setof plan_lines
language sql
as $$
  insert into plan_lines (plan_date, text, created_at)
  select p_plan_date, line, now() + (n - 1) * interval '1 millisecond'
    from unnest(p_lines) with ordinality as u(line, n)
  returning *;
$$;

-- ── RLS: same predicate as every table, no owner column ──────────────────────
alter table plan_lines enable row level security;

create policy plan_lines_select_signed_in on plan_lines
  for select to authenticated using (auth.uid() is not null);
create policy plan_lines_insert_signed_in on plan_lines
  for insert to authenticated with check (auth.uid() is not null);
create policy plan_lines_update_signed_in on plan_lines
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
-- Deliberately NO delete policy.
