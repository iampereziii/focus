-- Focus — seed data
--
-- REFERENCE DATA ONLY. THE APP STARTS EMPTY (spec Gap 5).
--
-- No seeded sessions, no backdated rows, no import from sessions.md. The log
-- begins at the first session actually started in the app. `sessions.md` (ais
-- repo) holds exactly one real card and stays the paper fallback and historical
-- record; hand-entering it here was considered and overruled.
--
-- /log's week-grouping still needs multi-week data to test against — that is a
-- TEST FIXTURE in tests/, never seed data.

begin;

-- Rule 8: no orphan tasks. The default topic is why capture never blocks on
-- classification, and it is the topic a promoted `filler` session's new Task
-- lands in (Rule 18 / Gap 17b).
--
-- `color` is assigned from the fixed palette in src/lib/store/ — this seeded row
-- takes the first entry. `why` stays null (Rule 15 deferred with the topic board);
-- `status` is 'active' because nothing in v1 parks or completes a Topic.
insert into topics (name, color, status)
values ('Inbox', '#64748b', 'active')
on conflict do nothing;

commit;
