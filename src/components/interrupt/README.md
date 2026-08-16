# `components/interrupt/` — the seven-cell tap, filler wait picker, stack view

**Budget: one tap. Two for `filler`.** Anything more is friction at the worst
possible moment and the model fails on adoption (A8).

The grid writes `kind` **and** `interruptTag` in **one gesture** (Gap 17a) —
five `pulled` cells (PR / Alert / DM / Meeting / Other), plus `Filler` and
`I drifted`. Seven targets. If you find yourself asking twice, the budget is
broken.

`I drifted` closes the parent `status = 'drifted'` and starts **no** session —
drift is a status, not a `kind`.

Stack view: depth 3+ renders a **warning** that the day has gone sideways
(Rule 20). Never blocked, never optimised as a workflow.
