-- Focus — drop the day plan (FOCUS-14, Rule 27)
--
-- Source of truth: ais repo → projects/focus/investigation/day-plan-keep-simplify-drop.md
-- (2026-11-17) and ADR-0004, whose Amendments 1 and 2 are withdrawn. Rule 27 is
-- retired (number kept). The schema goes back to five tables.
--
-- 0008 and 0009 stay in the repo because they may already be applied. This
-- migration undoes them in the order 0008's own "how to undo it" note gives, plus
-- 0009's function. The rows go with the table: at most a few one-day plans, and
-- the architect chose to drop rather than export them.
--
-- Touches no other table or row.

drop function if exists add_plan_lines(date, text[]);
drop table if exists plan_lines;
drop function if exists plan_lines_write_once();
drop function if exists plan_lines_one_open_plan();
