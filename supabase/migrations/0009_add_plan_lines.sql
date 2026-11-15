-- Focus — add_plan_lines: save a text area's lines together, in the order typed
--
-- Source of truth: ais repo → ADR-0004 Amendment 1 / project-spec.md Rule 27.
-- Follows 0008_plan_lines.sql (FOCUS-14), which is already merged and may already
-- be applied, so this is its own migration rather than an edit to 0008.
--
-- The day plan is typed into ONE text area, one item per line, and saved together.
-- A plain multi-row insert would give every row the same `created_at` (`now()` is
-- the transaction's time), and `created_at` IS the display order (there is no
-- position column, Rule 27f), so their order would be arbitrary. This inserts them
-- in ONE statement (all or nothing) and spaces their timestamps a millisecond
-- apart in the order typed. Both 0008 triggers still run for every row: one open
-- plan (27b) and written once (27c).
--
-- Not `security definer`, no grants: it runs as the caller, under 0008's RLS.
--
-- ⚠️ HOW TO UNDO IT. Touches no table or row:
--
--   drop function add_plan_lines(date, text[]);

create or replace function add_plan_lines(p_plan_date date, p_lines text[])
returns setof plan_lines
language sql
as $$
  insert into plan_lines (plan_date, text, created_at)
  select p_plan_date, line, now() + (n - 1) * interval '1 millisecond'
    from unnest(p_lines) with ordinality as u(line, n)
  returning *;
$$;
