# `components/session/` — gate form, elapsed timer, close-out

**The gate form has four fields, not three:** WHAT / WHY / FINISH LINE +
`checkInIntervalMinutes` (ADR-0001 as amended). The fourth is nullable by design
and not DB-enforced — `off` is a legitimate answer — and must be **pre-selected
to a default** so the common path costs zero extra taps.

The gate is budgeted at ~3 minutes of thinking and **under 20 seconds** of
interaction. That 20 s number is the **build gate**; it blocks ship.

There is **no timebox** and no planned-duration field (Rule 13, retired). The
written `finishLine` is the bound.
