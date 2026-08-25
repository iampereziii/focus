-- Focus — backfill the carried gate values onto existing tasks (one-time)
--
-- ⚠️ THIS IS THE ONLY FILE IN THIS CHANGE THAT TOUCHES EXISTING DATA.
--    Review it before applying. Deleting this file loses nothing else — it costs
--    one re-typed WHY on the first restart of each pre-existing task.
--
-- WHAT IT DOES
--
-- 0006 makes every start carry its WHY / FINISH LINE / interval onto the Task.
-- That only helps tasks started AFTER it ships. Every task already in the
-- database has the values in its sessions and null in its columns, so without
-- this the feature would arrive empty and stay empty until each task happened to
-- be started again.
--
-- The values already exist — in `sessions`, which is the actual record. This
-- copies the most recent focus session's three values onto its task, once.
--
-- WHY "MOST RECENT", WITH NO OUTCOME FILTERING (brief Risk 5)
--
-- A task can have several focus sessions: started, closed `partial`, restarted.
-- Preferring a `partial` close over an `abandoned` one was considered and
-- rejected — it is a ranking the app would INVENT rather than read, which is the
-- same instinct Rule 12 rules out on `/`, and it is a rule that would need
-- re-reading in three months to understand.
--
-- `distinct on (task_id) ... order by task_id, started_at desc` reproduces
-- exactly what a restart would have shown anyway: the last thing you said about
-- this task. The failure mode is benign and self-correcting — inheriting the
-- wording from an attempt you abandoned thirty seconds in still hands you a
-- sentence you actually typed, in a sheet that is open with the field editable
-- before `Start`.
--
-- `null` IN THE INTERVAL COLUMN MEANS `off`, AND IT IS COPIED AS null
--
-- Rule 26a makes `off` a real choice. A session run with the check-in off has
-- `check_in_interval_minutes = null`, and that null is copied straight across.
-- `coalesce(s.check_in_interval_minutes, 60)` would silently convert "I turned
-- it off" into "check in hourly" — the exact un-choosing 26a forbids. There is
-- no coalesce on this column anywhere in this change.
--
-- ⚠️ HOW TO UNDO IT — exactly, with no bookkeeping
--
-- Revert 0006's `create or replace` (re-apply 0002's body), then:
--
--   update tasks
--      set why = null, finish_line = null, check_in_interval_minutes = null;
--
-- That is the whole undo, and it is unusually safe: NOTHING in the app reads
-- these three columns except `GateForm`'s prefill, which this change is what
-- introduced. Blanking them restores exactly the prior behaviour — a gate that
-- opens empty on restart.
--
-- The one nuance worth writing down while it is still obvious: `promote_filler`
-- has always written `why` / `finish_line` on the tasks it creates, so those two
-- columns are not universally this migration's work. The undo above blanks them
-- too. That is deliberate and costs nothing — they were unread before this
-- change, which is exactly the state the undo is returning to. Preserving them
-- would need a marker that does not exist, to protect a value nobody looked at.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
--   · tasks with no focus session — nothing to copy from. (After 0005 these are
--     the retired pre-ADR-0004 captures, already `dropped`.)
--   · `why` / `finish_line` that are already set — `promote_filler`'s tasks keep
--     what it wrote. `coalesce` below preserves them; only the genuinely-new
--     interval column is written unconditionally.
--   · every `sessions` row. Rule 5 — this migration READS the log and can never
--     write it. There is no `update sessions` in this file and there must not be.

update tasks t
   set why                       = coalesce(t.why, s.why),
       finish_line               = coalesce(t.finish_line, s.finish_line),
       check_in_interval_minutes = s.check_in_interval_minutes
  from (
        select distinct on (task_id)
               task_id,
               why,
               finish_line,
               check_in_interval_minutes
          from sessions
         where kind = 'focus'
           and task_id is not null
         order by task_id, started_at desc
       ) s
 where s.task_id = t.id
   -- Only rows this migration has not already served. The column is brand new in
   -- 0006, so at deploy time this is every task with a session; re-running the
   -- file later is a no-op on anything the gate has since written itself.
   and t.check_in_interval_minutes is null;
